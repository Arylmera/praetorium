use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta { pub id: String, pub mtime_ms: u64, pub title: String, pub size_bytes: u64 }

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Turn { pub role: String, pub text: String, pub ts: String }

/// Flatten a transcript line's message into displayable text, or None if it's
/// not a real conversational turn.
pub fn line_to_turn(line: &str) -> Option<Turn> {
    let v: Value = serde_json::from_str(line.trim()).ok()?;
    let ty = v.get("type")?.as_str()?;
    if ty != "user" && ty != "assistant" { return None; }
    if v.get("isMeta").and_then(|b| b.as_bool()).unwrap_or(false) { return None; }
    // Drop synthetic / API-error lines (e.g. rate-limit notices) — not real turns.
    if v.get("isApiErrorMessage").and_then(|b| b.as_bool()).unwrap_or(false) { return None; }
    let msg = v.get("message")?;
    if msg.get("model").and_then(|m| m.as_str()) == Some("<synthetic>") { return None; }
    let role = msg.get("role")?.as_str()?.to_string();
    let ts = v.get("timestamp").and_then(|s| s.as_str()).unwrap_or("").to_string();
    let content = msg.get("content")?;
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => {
            let parts: Vec<String> = blocks.iter().filter_map(|b| {
                match b.get("type").and_then(|t| t.as_str()) {
                    Some("text") => b.get("text").and_then(|t| t.as_str()).map(|s| s.to_string()),
                    Some("tool_use") => {
                        let name = b.get("name").and_then(|n| n.as_str()).unwrap_or("tool");
                        // Subagent spawns render as their own named branch; skip the
                        // redundant "[Agent]" placeholder here.
                        if name == "Agent" || name == "Task" { return None; }
                        let fp = b.get("input").and_then(|i| i.get("file_path")).and_then(|s| s.as_str());
                        Some(match fp { Some(p) => format!("[{name} {p}]"), None => format!("[{name}]") })
                    }
                    _ => None, // drop tool_result bulk
                }
            }).collect();
            parts.join("\n")
        }
        _ => return None,
    };
    let text = text.trim().to_string();
    if text.is_empty() { return None; }
    if text.contains("local-command-caveat") || text.starts_with("<command-") { return None; }
    Some(Turn { role, text, ts })
}

/// Parse a session jsonl file into displayable turns.
#[tauri::command]
pub async fn read_session(path: String) -> Result<Vec<Turn>, String> {
    let raw = tokio::fs::read_to_string(&path).await.map_err(|e| format!("read failed: {e}"))?;
    Ok(raw.lines().filter_map(line_to_turn).collect())
}

/// List top-level session logs (ignores the subagents/ subdir).
#[tauri::command]
pub async fn list_sessions(project_dir: String) -> Result<Vec<SessionMeta>, String> {
    let dir = Path::new(&project_dir);
    let rd = std::fs::read_dir(dir).map_err(|e| format!("read dir failed: {e}"))?;
    let mut out = vec![];
    for entry in rd.flatten() {
        let path = entry.path();
        // Only top-level files — never recurse into the subagents/ subdir.
        if !path.is_file() { continue; }
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") { continue; }
        let meta = match entry.metadata() { Ok(m) => m, Err(_) => continue };
        let size_bytes = meta.len();
        let mtime_ms = meta.modified().ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64).unwrap_or(0);
        let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        let title = std::fs::read_to_string(&path).ok()
            .and_then(|raw| raw.lines().find_map(line_to_turn))
            .map(|t| t.text.chars().take(80).collect::<String>())
            .unwrap_or_else(|| id.clone());
        out.push(SessionMeta { id, mtime_ms, title, size_bytes });
    }
    out.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    Ok(out)
}
