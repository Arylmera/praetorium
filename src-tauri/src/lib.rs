pub mod events;
pub mod parser;
pub mod process;
pub mod session_parse;
pub mod session_watch;
pub mod sessions;
pub mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(process::RunRegistry::default())
        .invoke_handler(tauri::generate_handler![process::run_claude, process::stop_claude, vault::read_vault_file, vault::vault_index, vault::vault_links, sessions::list_sessions, sessions::read_session, session_watch::list_live_sessions, session_watch::watch_sessions])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
