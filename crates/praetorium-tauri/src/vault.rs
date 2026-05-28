use std::collections::HashMap;
use std::path::{Path, PathBuf};

use regex::Regex;
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

/// A single note's resolved outgoing wikilinks plus a count of dangling targets.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NoteLinks {
    pub rel: String,
    pub links: Vec<String>,
    pub unresolved: u32,
}

/// Wikilink matcher: `[[target]]` / `[[target|alias]]` — same pattern as the
/// frontend `resolveWikilinks`. Capture group 1 is the target (pre-`|`).
fn link_re() -> Regex {
    Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").expect("static regex")
}

/// Extract wikilink targets (trimmed) from note text, in order of appearance.
///
/// LIMITATION (v1, accepted): this is a plain regex scan and does NOT exclude
/// `[[ ]]` occurrences inside fenced/inline code blocks. A wikilink shown as a
/// literal inside ``` ``` ``` will still be counted as a link.
fn extract_targets(content: &str, re: &Regex) -> Vec<String> {
    re.captures_iter(content)
        .map(|c| c[1].trim().to_string())
        .collect()
}

/// Build a name index keyed by lowercased note stem -> rel, matching the
/// frontend resolver's keying for consistency.
fn name_index(files: &[VaultFile]) -> HashMap<String, String> {
    files.iter().map(|f| (f.name.to_lowercase(), f.rel.clone())).collect()
}

/// Resolve a note's targets against the name index. Returns the deduped list of
/// resolved target rels and the count of unresolved (dangling) occurrences.
fn resolve_links(targets: &[String], index: &HashMap<String, String>) -> (Vec<String>, u32) {
    let mut links: Vec<String> = Vec::new();
    let mut unresolved = 0u32;
    for t in targets {
        match index.get(&t.trim().to_lowercase()) {
            Some(rel) => {
                if !links.contains(rel) {
                    links.push(rel.clone());
                }
            }
            None => unresolved += 1,
        }
    }
    (links, unresolved)
}

/// Pure core: given (rel, content) notes and a name index, build the adjacency.
fn build_links(notes: &[(String, String)], index: &HashMap<String, String>, re: &Regex) -> Vec<NoteLinks> {
    notes
        .iter()
        .map(|(rel, content)| {
            let (links, unresolved) = resolve_links(&extract_targets(content, re), index);
            NoteLinks { rel: rel.clone(), links, unresolved }
        })
        .collect()
}

/// Walk the vault's `.md` files and return each note's resolved `[[wikilink]]`
/// adjacency. Notes that fail to read are skipped (contribute no links) rather
/// than failing the whole command.
#[tauri::command]
pub async fn vault_links(vault_path: String) -> Result<Vec<NoteLinks>, String> {
    let root = Path::new(&vault_path);
    if !root.is_dir() {
        return Err(format!("not a directory: {vault_path}"));
    }
    let mut files = vec![];
    walk_md(root, root, &mut files);
    let index = name_index(&files);
    let re = link_re();

    let mut notes: Vec<(String, String)> = Vec::with_capacity(files.len());
    for f in &files {
        let abs = root.join(f.rel.replace('/', std::path::MAIN_SEPARATOR_STR));
        match std::fs::read_to_string(&abs) {
            Ok(content) => notes.push((f.rel.clone(), content)),
            Err(_) => continue, // unreadable note: skip, no links
        }
    }
    Ok(build_links(&notes, &index, &re))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idx(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn extracts_plain_and_aliased_targets() {
        let re = link_re();
        let got = extract_targets("see [[Terra]] and [[Emperor|the law]] here", &re);
        assert_eq!(got, vec!["Terra".to_string(), "Emperor".to_string()]);
    }

    #[test]
    fn resolves_targets_against_name_index() {
        let re = link_re();
        let index = idx(&[("terra", "Terra.md"), ("emperor", "Anamnesis/EMPEROR.md")]);
        let (links, unresolved) =
            resolve_links(&extract_targets("[[Terra]] [[Emperor|x]]", &re), &index);
        assert_eq!(links, vec!["Terra.md".to_string(), "Anamnesis/EMPEROR.md".to_string()]);
        assert_eq!(unresolved, 0);
    }

    #[test]
    fn counts_unresolved_dangling_targets() {
        let re = link_re();
        let index = idx(&[("terra", "Terra.md")]);
        let (links, unresolved) =
            resolve_links(&extract_targets("[[Terra]] [[Ghost]] [[Phantom]]", &re), &index);
        assert_eq!(links, vec!["Terra.md".to_string()]);
        assert_eq!(unresolved, 2);
    }

    #[test]
    fn dedupes_repeated_resolved_links() {
        let re = link_re();
        let index = idx(&[("terra", "Terra.md")]);
        let (links, unresolved) =
            resolve_links(&extract_targets("[[Terra]] [[terra]] [[Terra|home]]", &re), &index);
        assert_eq!(links, vec!["Terra.md".to_string()]);
        assert_eq!(unresolved, 0);
    }

    #[test]
    fn note_with_no_links_yields_empty() {
        let re = link_re();
        let index = idx(&[("terra", "Terra.md")]);
        let notes = vec![("A.md".to_string(), "no links at all".to_string())];
        let out = build_links(&notes, &index, &re);
        assert_eq!(out, vec![NoteLinks { rel: "A.md".into(), links: vec![], unresolved: 0 }]);
    }

    #[test]
    fn code_fence_links_are_not_excluded_documented_limitation() {
        // Documents the accepted v1 limitation: a wikilink inside a code fence is
        // still counted (plain regex, no fence stripping).
        let re = link_re();
        let index = idx(&[("terra", "Terra.md")]);
        let (links, _) =
            resolve_links(&extract_targets("```\n[[Terra]]\n```", &re), &index);
        assert_eq!(links, vec!["Terra.md".to_string()]);
    }

    #[test]
    fn vault_links_honors_skip_list_dirs() {
        // Build a throwaway vault with an Archive dir that must be skipped.
        let base = std::env::temp_dir().join(format!("prae_vault_links_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(base.join("Archive")).unwrap();
        std::fs::write(base.join("A.md"), "[[B]]").unwrap();
        std::fs::write(base.join("B.md"), "hi").unwrap();
        std::fs::write(base.join("Archive").join("Old.md"), "[[A]]").unwrap();

        let mut files = vec![];
        walk_md(&base, &base, &mut files);
        let rels: Vec<&str> = files.iter().map(|f| f.rel.as_str()).collect();
        assert!(rels.contains(&"A.md"));
        assert!(rels.contains(&"B.md"));
        assert!(!rels.iter().any(|r| r.contains("Archive")), "Archive must be skipped");

        let index = name_index(&files);
        let re = link_re();
        let notes: Vec<(String, String)> = files
            .iter()
            .map(|f| (f.rel.clone(), std::fs::read_to_string(base.join(&f.rel)).unwrap()))
            .collect();
        let out = build_links(&notes, &index, &re);
        let a = out.iter().find(|n| n.rel == "A.md").unwrap();
        assert_eq!(a.links, vec!["B.md".to_string()]);

        let _ = std::fs::remove_dir_all(&base);
    }
}
