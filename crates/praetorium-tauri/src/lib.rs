pub mod process;
pub mod session_watch;
pub mod sessions;
pub mod vault;

/// Toggle native window translucency to back the CSS `.is-glass` layer.
/// Windows 11 prefers Mica (clean wallpaper blur), falling back to Acrylic
/// on older builds; macOS uses NSVisualEffectMaterial vibrancy. Linux is a
/// no-op — webkit2gtk has no stable native effect, so the CSS alone carries it.
/// The window must be created with `transparent: true` (tauri.conf.json) for
/// the effect to have a surface to compose against.
fn apply_glass(window: &tauri::WebviewWindow, on: bool) {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};
        if on {
            if apply_mica(window, None).is_err() {
                let _ = apply_acrylic(window, Some((0, 0, 0, 0)));
            }
        } else {
            let _ = clear_mica(window);
            let _ = clear_acrylic(window);
        }
    }
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial};
        if on {
            let _ = apply_vibrancy(
                window,
                NSVisualEffectMaterial::UnderWindowBackground,
                None,
                None,
            );
        } else {
            let _ = clear_vibrancy(window);
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = (window, on);
    }
}

/// Frontend bridge: the `glass()` setting (persisted in localStorage) calls
/// this on toggle and at startup so native vibrancy tracks the CSS state.
#[tauri::command]
fn set_glass(window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
    apply_glass(&window, on);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(process::RunRegistry::default())
        .invoke_handler(tauri::generate_handler![
            set_glass,
            process::run_claude,
            process::stop_claude,
            vault::read_vault_file,
            vault::vault_index,
            vault::vault_links,
            sessions::list_sessions,
            sessions::read_session,
            sessions::list_all_sessions,
            session_watch::list_live_sessions,
            session_watch::watch_sessions,
            session_watch::app_cwd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
