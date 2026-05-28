use praetorium_core::{session_parse, vault};
use std::path::Path;

fn usage() -> ! {
    eprintln!("Usage:");
    eprintln!(
        "  praetorium parse-session <path.jsonl>   Print JSON array of parsed session events"
    );
    eprintln!("  praetorium vault-index <vault-dir>      Print JSON array of vault .md files");
    std::process::exit(2);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        usage();
    }
    match args[1].as_str() {
        "parse-session" => {
            let path = Path::new(&args[2]);
            let raw = match std::fs::read_to_string(path) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("error reading {}: {e}", path.display());
                    std::process::exit(1);
                }
            };
            let events: Vec<_> = raw
                .lines()
                .flat_map(session_parse::parse_transcript_line)
                .collect();
            println!("{}", serde_json::to_string_pretty(&events).unwrap());
        }
        "vault-index" => {
            let dir = Path::new(&args[2]);
            match vault::vault_index_sync(dir) {
                Ok(files) => println!("{}", serde_json::to_string_pretty(&files).unwrap()),
                Err(e) => {
                    eprintln!("error: {e}");
                    std::process::exit(1);
                }
            }
        }
        _ => usage(),
    }
}
