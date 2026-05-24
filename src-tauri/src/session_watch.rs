use crate::session_parse::{parse_transcript_line, tail_new, SessionEvent};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::Manager;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub project: String,
    pub title: String,
    pub last_activity_ms: u64,
    pub state: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase", tag = "type", content = "data")]
pub enum WatchEvent {
    Session { session_id: String, project: String, agent_ref: String, event: SessionEvent },
    State { session_id: String, state: String },
}

fn home() -> PathBuf {
    std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).map(PathBuf::from).unwrap_or_default()
}
fn projects_root() -> PathBuf { home().join(".claude").join("projects") }

fn is_main_session(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()) == Some("jsonl")
        && !path.components().any(|c| c.as_os_str() == "subagents")
}
fn agent_ref_for(path: &Path) -> String {
    if is_main_session(path) { return "master".into(); }
    path.file_stem().and_then(|s| s.to_str()).unwrap_or("agent").to_string()
}
fn session_id_for(path: &Path) -> Option<String> {
    if is_main_session(path) {
        path.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string())
    } else {
        path.parent()?.parent()?.file_name()?.to_str().map(|s| s.to_string())
    }
}
fn project_for(path: &Path) -> String {
    // main: .../projects/<project>/<id>.jsonl  ; sub: .../projects/<project>/<id>/subagents/agent.jsonl
    let comps: Vec<_> = path.components().filter_map(|c| c.as_os_str().to_str()).collect();
    if let Some(i) = comps.iter().position(|c| *c == "projects") { comps.get(i + 1).map(|s| s.to_string()).unwrap_or_default() } else { String::new() }
}
fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}
const LIVE_WINDOW_MS: u64 = 60_000;

#[tauri::command]
pub fn list_live_sessions() -> Result<Vec<SessionMeta>, String> {
    let root = projects_root();
    let mut out = vec![];
    let projects = std::fs::read_dir(&root).map_err(|e| format!("read projects: {e}"))?;
    for proj in projects.flatten() {
        let pdir = proj.path();
        if !pdir.is_dir() { continue; }
        let project = proj.file_name().to_string_lossy().to_string();
        let files = match std::fs::read_dir(&pdir) { Ok(f) => f, Err(_) => continue };
        for f in files.flatten() {
            let path = f.path();
            if !is_main_session(&path) { continue; }
            let meta = match f.metadata() { Ok(m) => m, Err(_) => continue };
            let mtime = meta.modified().ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64).unwrap_or(0);
            let age = now_ms().saturating_sub(mtime);
            if age > 10 * LIVE_WINDOW_MS { continue; }
            let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let title = std::fs::read_to_string(&path).ok()
                .and_then(|raw| raw.lines().find_map(|l| parse_transcript_line(l).into_iter()
                    .find_map(|e| if let SessionEvent::Turn { role, text } = e { if role == "user" { Some(text) } else { None } } else { None })))
                .map(|t| t.chars().take(80).collect::<String>())
                .unwrap_or_else(|| id.clone());
            let state = if age <= LIVE_WINDOW_MS { "live" } else { "idle" }.to_string();
            out.push(SessionMeta { id, project: project.clone(), title, last_activity_ms: mtime, state });
        }
    }
    out.sort_by(|a, b| b.last_activity_ms.cmp(&a.last_activity_ms));
    Ok(out)
}

#[derive(Default)]
pub struct WatchState(pub Mutex<HashMap<PathBuf, usize>>);

pub struct WatcherHandle(pub Mutex<Option<notify::RecommendedWatcher>>);

fn pump(path: &Path, offsets: &Mutex<HashMap<PathBuf, usize>>, ch: &Arc<Channel<WatchEvent>>) {
    let Some(session_id) = session_id_for(path) else { return; };
    let agent_ref = agent_ref_for(path);
    let project = project_for(path);
    let content = match std::fs::read_to_string(path) { Ok(c) => c, Err(_) => return };
    let mut map = offsets.lock().unwrap();
    let off = *map.get(path).unwrap_or(&0);
    let start = if off > content.len() { 0 } else { off };
    let (lines, new_off) = tail_new(&content, start);
    map.insert(path.to_path_buf(), new_off);
    drop(map);
    for line in lines {
        for event in parse_transcript_line(&line) {
            let _ = ch.send(WatchEvent::Session { session_id: session_id.clone(), project: project.clone(), agent_ref: agent_ref.clone(), event });
        }
    }
}

#[tauri::command]
pub fn watch_sessions(app: tauri::AppHandle, on_event: Channel<WatchEvent>) -> Result<(), String> {
    use notify::{RecursiveMode, Watcher, EventKind};
    let root = projects_root();
    // Seed offsets to END of existing files so we stream only NEW activity.
    let offsets: Arc<Mutex<HashMap<PathBuf, usize>>> = Arc::new(Mutex::new(HashMap::new()));
    if let Ok(rd) = std::fs::read_dir(&root) {
        for proj in rd.flatten() {
            if let Ok(files) = std::fs::read_dir(proj.path()) {
                for f in files.flatten() {
                    let p = f.path();
                    if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                        let len = f.metadata().map(|m| m.len() as usize).unwrap_or(0);
                        offsets.lock().unwrap().insert(p.clone(), len);
                    }
                    // also seed subagent files one level deeper
                    if p.is_dir() {
                        if let Ok(sub) = std::fs::read_dir(p.join("subagents")) {
                            for sf in sub.flatten() {
                                let sp = sf.path();
                                if sp.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                                    let len = sf.metadata().map(|m| m.len() as usize).unwrap_or(0);
                                    offsets.lock().unwrap().insert(sp, len);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let ch = Arc::new(on_event);
    let ch2 = ch.clone();
    let off2 = offsets.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                for p in ev.paths {
                    if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                        pump(&p, &off2, &ch2);
                    }
                }
            }
        }
    }).map_err(|e| format!("watcher: {e}"))?;
    watcher.watch(&root, RecursiveMode::Recursive).map_err(|e| format!("watch: {e}"))?;
    app.manage(WatcherHandle(Mutex::new(Some(watcher))));
    Ok(())
}
