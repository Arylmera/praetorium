use std::path::PathBuf;

/// Read a UTF-8 file from disk. The frontend passes an absolute path under the
/// configured vault. Returns the file contents or an error string.
#[tauri::command]
pub async fn read_vault_file(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if p.extension().and_then(|e| e.to_str()) != Some("md") {
        return Err("only .md files may be read".into());
    }
    tokio::fs::read_to_string(&p).await.map_err(|e| format!("read failed: {e}"))
}
