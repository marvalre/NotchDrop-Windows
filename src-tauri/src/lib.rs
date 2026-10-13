mod clipboard;
mod geometry;
mod media;

use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const ISLAND: &str = "island";

/// Puts the island at the top centre of the monitor it is on, collapsed or expanded.
fn place(window: &WebviewWindow, expanded: bool) -> tauri::Result<()> {
    let monitor = window.current_monitor()?.or(window.primary_monitor()?);
    let Some(m) = monitor else { return Ok(()) };
    let f = geometry::island_frame(m.position().x, m.position().y, m.size().width, m.size().height, m.scale_factor(), expanded);
    window.set_size(PhysicalSize::new(f.w, f.h))?;
    window.set_position(PhysicalPosition::new(f.x, f.y))?;
    Ok(())
}

/// After collapsing, keystrokes must go back to the app the person was using — not to an
/// almost invisible pill. (The macOS version had exactly this bug.) Hiding the focused
/// window makes Windows activate the next one; showing it again without activation keeps it on top.
#[cfg(windows)]
fn release_focus(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE};
    // Tauri hands back its own `windows` crate's HWND; rebuild ours from the raw handle.
    if let Ok(raw) = window.hwnd() {
        let hwnd = HWND(raw.0 as _);
        unsafe {
            if GetForegroundWindow() == hwnd {
                let _ = ShowWindow(hwnd, SW_HIDE);
                let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            }
        }
    }
}
#[cfg(not(windows))]
fn release_focus(_window: &WebviewWindow) {}

#[tauri::command]
fn set_expanded(window: WebviewWindow, expanded: bool, focus: bool) -> Result<(), String> {
    place(&window, expanded).map_err(|e| e.to_string())?;
    if expanded && focus {
        let _ = window.set_focus();
    }
    if !expanded {
        release_focus(&window);
    }
    Ok(())
}

#[tauri::command]
async fn media_state(known_key: String) -> Option<media::MediaInfo> {
    tauri::async_runtime::spawn_blocking(move || media::current(&known_key)).await.ok().flatten()
}

#[tauri::command]
async fn media_command(action: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || media::command(&action)).await.unwrap_or(false)
}

#[tauri::command]
fn copy_text(text: String, own: State<'_, clipboard::OwnWrite>) -> Result<(), String> {
    if let Ok(mut o) = own.lock() { *o = Some(text.clone()); }
    arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

pub fn run() {
    let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyN);
    let own_write: clipboard::OwnWrite = Arc::new(Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = app.emit("toggle-island", ());
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &toggle && event.state() == ShortcutState::Pressed {
                        let _ = app.emit("toggle-island", ());
                    }
                })
                .build(),
        )
        .manage(own_write.clone())
        .setup(move |app| {
            if let Some(w) = app.get_webview_window(ISLAND) {
                place(&w, false)?;
                let _ = w.show();
            }
            // A taken shortcut (another app already uses Ctrl+Alt+N) must not stop the app.
            if let Err(e) = app.global_shortcut().register(toggle) {
                eprintln!("NotchDrop: could not register Ctrl+Alt+N: {e}");
            }
            clipboard::start(app.handle().clone(), own_write.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_expanded, media_state, media_command, copy_text, quit_app])
        .run(tauri::generate_context!())
        .expect("error while running NotchDrop");
}
