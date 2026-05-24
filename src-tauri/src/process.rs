use crate::events::ClaudeEvent;
use crate::parser::parse_line;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Drop env vars that put a spawned `claude` into nested/API mode, so it uses
/// the user's subscription auth. Keeps everything else (PATH, HOME, ...).
pub fn sanitized_env<I: IntoIterator<Item = (String, String)>>(vars: I) -> Vec<(String, String)> {
    vars.into_iter()
        .filter(|(k, _)| k != "CLAUDECODE" && k != "ANTHROPIC_API_KEY" && !k.starts_with("CLAUDE_CODE"))
        .collect()
}

/// A planned `claude` invocation: the CLI args plus an optional working dir.
pub struct ClaudeInvocation {
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

/// A run id → child-process registry, so in-flight `claude` runs can be killed.
pub struct Registry<T>(pub Arc<Mutex<HashMap<String, T>>>);

impl<T> Default for Registry<T> {
    fn default() -> Self {
        Registry(Arc::new(Mutex::new(HashMap::new())))
    }
}

impl<T> Clone for Registry<T> {
    fn clone(&self) -> Self {
        Registry(self.0.clone())
    }
}

impl<T> Registry<T> {
    pub fn insert(&self, id: String, val: T) {
        self.0.lock().unwrap().insert(id, val);
    }
    /// Remove and return the value; a second call for the same id yields `None`.
    pub fn take(&self, id: &str) -> Option<T> {
        self.0.lock().unwrap().remove(id)
    }
}

pub type RunRegistry = Registry<CommandChild>;

/// Build the `claude` arg vector + working dir from the run options. `--model`
/// is appended only when a model is chosen; `cwd` is carried through untouched.
pub fn plan_claude(
    prompt: &str,
    cwd: Option<String>,
    model: Option<String>,
    resume_id: Option<String>,
) -> ClaudeInvocation {
    let mut args = vec![
        "-p".to_string(),
        prompt.to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
    ];
    if let Some(model) = model {
        args.push("--model".to_string());
        args.push(model);
    }
    if let Some(id) = resume_id {
        args.push("--resume".to_string());
        args.push(id);
    }
    ClaudeInvocation { args, cwd }
}

/// Spawn `claude -p <prompt> --output-format stream-json` and stream parsed
/// events to the frontend through `on_event`. Returns once spawning is done;
/// streaming continues on a background task.
#[tauri::command]
pub async fn run_claude(
    app: AppHandle,
    run_id: String,
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    resume_id: Option<String>,
    on_event: Channel<ClaudeEvent>,
    registry: State<'_, RunRegistry>,
) -> Result<(), String> {
    let plan = plan_claude(&prompt, cwd, model, resume_id);
    let shell = app.shell();
    let mut command = shell
        .command("claude")
        .args(plan.args)
        .env_clear()
        .envs(sanitized_env(std::env::vars()));
    if let Some(dir) = plan.cwd {
        command = command.current_dir(dir);
    }
    let (mut rx, child) = command
        .spawn()
        .map_err(|e| format!("failed to spawn claude: {e}"))?;
    registry.insert(run_id.clone(), child);

    let reg = registry.inner().clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    for ev in parse_line(&line) {
                        let _ = on_event.send(ev);
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let msg = String::from_utf8_lossy(&bytes).to_string();
                    let _ = on_event.send(ClaudeEvent::RunError { message: msg });
                }
                CommandEvent::Terminated(payload) => {
                    reg.take(&run_id);
                    let code = payload.code.unwrap_or(-1);
                    let _ = on_event.send(ClaudeEvent::RunComplete { exit_code: code });
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Kill an in-flight run by its run id. No-op if the run already finished.
#[tauri::command]
pub async fn stop_claude(run_id: String, registry: State<'_, RunRegistry>) -> Result<(), String> {
    if let Some(child) = registry.take(&run_id) {
        let _ = child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{plan_claude, sanitized_env};

    #[test]
    fn registry_take_returns_value_once() {
        use super::Registry;
        let r: Registry<u32> = Registry::default();
        r.insert("a".to_string(), 7);
        assert_eq!(r.take("a"), Some(7));
        assert_eq!(r.take("a"), None);
    }

    #[test]
    fn includes_model_arg_only_when_provided() {
        let with = plan_claude("hi", None, Some("opus".to_string()), None);
        assert!(with
            .args
            .windows(2)
            .any(|w| w[0] == "--model" && w[1] == "opus"));

        let without = plan_claude("hi", None, None, None);
        assert!(!without.args.iter().any(|a| a == "--model"));
    }

    #[test]
    fn includes_resume_arg_only_when_provided() {
        let with = plan_claude("hi", None, None, Some("sess-123".to_string()));
        assert!(with
            .args
            .windows(2)
            .any(|w| w[0] == "--resume" && w[1] == "sess-123"));

        let without = plan_claude("hi", None, None, None);
        assert!(!without.args.iter().any(|a| a == "--resume"));
    }

    #[test]
    fn composes_model_and_resume() {
        let plan = plan_claude("hi", None, Some("opus".to_string()), Some("s1".to_string()));
        let joined = plan.args.join(" ");
        assert!(joined.contains("--model opus"));
        assert!(joined.contains("--resume s1"));
    }

    #[test]
    fn sets_cwd_only_when_provided() {
        let with = plan_claude("hi", Some("/tmp/proj".to_string()), None, None);
        assert_eq!(with.cwd, Some("/tmp/proj".to_string()));

        let without = plan_claude("hi", None, None, None);
        assert_eq!(without.cwd, None);
    }

    #[test]
    fn always_includes_base_args() {
        let plan = plan_claude("do thing", None, None, None);
        assert_eq!(
            plan.args,
            vec!["-p", "do thing", "--output-format", "stream-json", "--verbose"]
        );
    }

    #[test]
    fn strips_nested_session_vars_keeps_path() {
        let input = vec![
            ("PATH".to_string(), "/usr/bin".to_string()),
            ("CLAUDECODE".to_string(), "1".to_string()),
            ("CLAUDE_CODE_ENTRYPOINT".to_string(), "claude-desktop".to_string()),
            ("ANTHROPIC_API_KEY".to_string(), "sk-x".to_string()),
            ("HOME".to_string(), "/home/u".to_string()),
        ];
        let out = sanitized_env(input);
        let keys: Vec<_> = out.iter().map(|(k, _)| k.as_str()).collect();
        assert!(keys.contains(&"PATH"));
        assert!(keys.contains(&"HOME"));
        assert!(!keys.contains(&"CLAUDECODE"));
        assert!(!keys.contains(&"CLAUDE_CODE_ENTRYPOINT"));
        assert!(!keys.contains(&"ANTHROPIC_API_KEY"));
    }
}
