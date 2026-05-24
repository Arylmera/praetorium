pub mod events;
pub mod parser;
pub mod process;
pub mod session_parse;
pub mod sessions;
pub mod vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![process::run_claude, vault::read_vault_file, vault::vault_index, vault::read_cartographicum, sessions::list_sessions, sessions::read_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
