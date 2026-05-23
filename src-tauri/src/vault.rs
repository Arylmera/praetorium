use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultFile {
    pub rel: String,
    pub name: String,
    pub dir: String,
}

fn walk_md(root: &Path, base: &Path, out: &mut Vec<VaultFile>) {
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if file_name == "Archive" || file_name == ".git" || file_name == "node_modules" {
                continue;
            }
            walk_md(&path, base, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let rel = path.strip_prefix(base).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            let name = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            let dir = Path::new(&rel).parent().map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            out.push(VaultFile { rel, name, dir });
        }
    }
}

/// List all .md files under the vault (skips Archive/.git/node_modules).
#[tauri::command]
pub async fn vault_index(vault_path: String) -> Result<Vec<VaultFile>, String> {
    let root = Path::new(&vault_path);
    if !root.is_dir() {
        return Err(format!("not a directory: {vault_path}"));
    }
    let mut out = vec![];
    walk_md(root, root, &mut out);
    Ok(out)
}

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
