use crate::events::ClaudeEvent;
use crate::parser::parse_line;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

/// Drop env vars that put a spawned `claude` into nested/API mode, so it uses
/// the user's subscription auth. Keeps everything else (PATH, HOME, ...).
pub fn sanitized_env<I: IntoIterator<Item = (String, String)>>(vars: I) -> Vec<(String, String)> {
    vars.into_iter()
        .filter(|(k, _)| k != "CLAUDECODE" && k != "ANTHROPIC_API_KEY" && !k.starts_with("CLAUDE_CODE"))
        .collect()
}

/// Spawn `claude -p <prompt> --output-format stream-json` and stream parsed
/// events to the frontend through `on_event`. Returns once spawning is done;
/// streaming continues on a background task.
#[tauri::command]
pub async fn run_claude(
    app: AppHandle,
    prompt: String,
    on_event: Channel<ClaudeEvent>,
) -> Result<(), String> {
    let shell = app.shell();
    let (mut rx, _child) = shell
        .command("claude")
        .args(["-p", &prompt, "--output-format", "stream-json", "--verbose"])
        .env_clear()
        .envs(sanitized_env(std::env::vars()))
        .spawn()
        .map_err(|e| format!("failed to spawn claude: {e}"))?;

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
                    let code = payload.code.unwrap_or(-1);
                    let _ = on_event.send(ClaudeEvent::RunComplete { exit_code: code });
                }
                _ => {}
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::sanitized_env;
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
