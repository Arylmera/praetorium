use crate::events::ClaudeEvent;

/// Parse a single line of `claude --output-format stream-json` output.
/// Returns `None` for blank lines or unparseable JSON (tolerant by design).
pub fn parse_line(line: &str) -> Option<ClaudeEvent> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let ty = v.get("type")?.as_str()?;
    match ty {
        "system" => {
            let session_id = v.get("session_id").and_then(|s| s.as_str()).unwrap_or("").to_string();
            Some(ClaudeEvent::SystemInit { session_id })
        }
        "assistant" => {
            // assistant.message.content is an array of blocks; concatenate text blocks.
            let text = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
                .map(|blocks| {
                    blocks
                        .iter()
                        .filter_map(|b| {
                            if b.get("type")?.as_str()? == "text" {
                                b.get("text")?.as_str().map(|s| s.to_string())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("")
                })
                .unwrap_or_default();
            Some(ClaudeEvent::AssistantText { text })
        }
        "result" => {
            let is_error = v.get("is_error").and_then(|b| b.as_bool()).unwrap_or(false);
            let result = v.get("result").and_then(|s| s.as_str()).unwrap_or("").to_string();
            Some(ClaudeEvent::Result { is_error, result })
        }
        other => Some(ClaudeEvent::Unknown { raw_type: other.to_string() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_assistant_text_block() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi there"}]}}"#;
        assert_eq!(parse_line(line), Some(ClaudeEvent::AssistantText { text: "Hi there".into() }));
    }

    #[test]
    fn parses_system_init_session_id() {
        let line = r#"{"type":"system","subtype":"init","session_id":"abc-123"}"#;
        assert_eq!(parse_line(line), Some(ClaudeEvent::SystemInit { session_id: "abc-123".into() }));
    }

    #[test]
    fn parses_result_line() {
        let line = r#"{"type":"result","is_error":false,"result":"done"}"#;
        assert_eq!(parse_line(line), Some(ClaudeEvent::Result { is_error: false, result: "done".into() }));
    }

    #[test]
    fn unknown_type_is_preserved_not_dropped() {
        let line = r#"{"type":"tool_use_progress","foo":1}"#;
        assert_eq!(parse_line(line), Some(ClaudeEvent::Unknown { raw_type: "tool_use_progress".into() }));
    }

    #[test]
    fn blank_and_garbage_lines_return_none() {
        assert_eq!(parse_line(""), None);
        assert_eq!(parse_line("   "), None);
        assert_eq!(parse_line("not json at all"), None);
    }
}
