// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod events;
pub mod parser;
pub mod process;
pub mod vault;
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![greet, process::run_claude, vault::read_vault_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
