use crate::events::ClaudeEvent;
use crate::parser::parse_line;
use std::process::Stdio;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

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

/// Build the `claude` arg vector + working dir from the run options. `--resume`
/// continues a prior session and is prepended so it precedes the prompt; `--model`
/// is appended only when a model is chosen; `cwd` is carried through untouched.
pub fn plan_claude(
    prompt: &str,
    cwd: Option<String>,
    model: Option<String>,
    resume: Option<String>,
) -> ClaudeInvocation {
    let mut args = Vec::new();
    if let Some(id) = resume {
        args.push("--resume".to_string());
        args.push(id);
    }
    args.extend([
        "-p".to_string(),
        prompt.to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
    ]);
    if let Some(model) = model {
        args.push("--model".to_string());
        args.push(model);
    }
    ClaudeInvocation { args, cwd }
}

/// Spawn `claude -p <prompt> --output-format stream-json` and stream parsed
/// events to the frontend through `on_event`. Returns once spawning is done;
/// streaming continues on a background task.
///
/// We spawn via `tokio::process` rather than `tauri-plugin-shell` so we can pin
/// stdin to /dev/null: in `-p` mode `claude` reads piped stdin to append to the
/// prompt and, with an open-but-empty pipe (the plugin always pipes stdin),
/// stalls ~3s before warning "no stdin data received". A null stdin yields an
/// immediate EOF instead. On Windows we still set CREATE_NO_WINDOW so the child
/// (claude.exe, resolved from PATH) spawns without a console window.
#[tauri::command]
pub async fn run_claude(
    prompt: String,
    cwd: Option<String>,
    model: Option<String>,
    resume: Option<String>,
    on_event: Channel<ClaudeEvent>,
) -> Result<(), String> {
    let plan = plan_claude(&prompt, cwd, model, resume);
    let mut command = Command::new("claude");
    command
        .args(plan.args)
        .env_clear()
        .envs(sanitized_env(std::env::vars()))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        // tokio's Command exposes creation_flags inherently on Windows.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    if let Some(dir) = plan.cwd {
        command.current_dir(dir);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to spawn claude: {e}"))?;
    let stdout = child.stdout.take().ok_or("missing stdout pipe")?;
    let stderr = child.stderr.take().ok_or("missing stderr pipe")?;

    tauri::async_runtime::spawn(async move {
        let mut out = Some(BufReader::new(stdout).lines());
        let mut err = Some(BufReader::new(stderr).lines());
        loop {
            tokio::select! {
                res = async { out.as_mut().unwrap().next_line().await }, if out.is_some() => {
                    match res {
                        Ok(Some(line)) => for ev in parse_line(&line) { let _ = on_event.send(ev); },
                        _ => out = None,
                    }
                }
                res = async { err.as_mut().unwrap().next_line().await }, if err.is_some() => {
                    match res {
                        Ok(Some(line)) => { let _ = on_event.send(ClaudeEvent::RunError { message: line }); }
                        _ => err = None,
                    }
                }
                else => break,
            }
        }
        let code = child.wait().await.ok().and_then(|s| s.code()).unwrap_or(-1);
        let _ = on_event.send(ClaudeEvent::RunComplete { exit_code: code });
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{plan_claude, sanitized_env};

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
    fn resume_arg_precedes_prompt_only_when_provided() {
        let with = plan_claude("follow up", None, None, Some("sess-123".to_string()));
        assert_eq!(
            with.args,
            vec![
                "--resume",
                "sess-123",
                "-p",
                "follow up",
                "--output-format",
                "stream-json",
                "--verbose"
            ]
        );

        let without = plan_claude("first", None, None, None);
        assert!(!without.args.iter().any(|a| a == "--resume"));
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
