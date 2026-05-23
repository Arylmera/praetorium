use crate::events::ClaudeEvent;
use crate::parser::parse_line;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

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
        .spawn()
        .map_err(|e| format!("failed to spawn claude: {e}"))?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Some(ev) = parse_line(&line) {
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
