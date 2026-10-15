mod audio;
mod clipboard;
mod convert;
mod download;
mod geometry;
mod media;
mod proc;
mod tools;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const ISLAND: &str = "island";

static EXPANDED: AtomicBool = AtomicBool::new(false);
/// Panel size setting in percent (85 / 100 / 115).
static PANEL_PCT: AtomicU32 = AtomicU32::new(100);
static DOWNLOADING: AtomicBool = AtomicBool::new(false);

/// Puts the island at the top centre of the monitor it is on, collapsed or expanded.
fn place(window: &WebviewWindow, expanded: bool) -> tauri::Result<()> {
    let monitor = window.current_monitor()?.or(window.primary_monitor()?);
    let Some(m) = monitor else { return Ok(()) };
    let f = geometry::island_frame(m.position().x, m.position().y, m.size().width, m.size().height, m.scale_factor(), expanded,
        PANEL_PCT.load(Ordering::Relaxed) as f64 / 100.0);
    apply_frame(window, f)
}

/// Size and position in ONE call on Windows, so the growing window never sits for a frame
/// at the old x with the new width.
#[cfg(windows)]
fn apply_frame(window: &WebviewWindow, f: geometry::Frame) -> tauri::Result<()> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    if let Ok(raw) = window.hwnd() {
        let hwnd = HWND(raw.0 as _);
        if unsafe { SetWindowPos(hwnd, None, f.x, f.y, f.w as i32, f.h as i32, SWP_NOZORDER | SWP_NOACTIVATE) }.is_ok() {
            return Ok(());
        }
    }
    window.set_size(PhysicalSize::new(f.w, f.h))?;
    window.set_position(PhysicalPosition::new(f.x, f.y))
}
#[cfg(not(windows))]
fn apply_frame(window: &WebviewWindow, f: geometry::Frame) -> tauri::Result<()> {
    window.set_size(PhysicalSize::new(f.w, f.h))?;
    window.set_position(PhysicalPosition::new(f.x, f.y))
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
fn set_expanded(window: WebviewWindow, expanded: bool, focus: bool, panel: Option<f64>) -> Result<(), String> {
    EXPANDED.store(expanded, Ordering::Relaxed);
    if let Some(p) = panel.filter(|p| p.is_finite()) { PANEL_PCT.store((p.clamp(0.8, 1.2) * 100.0).round() as u32, Ordering::Relaxed); }
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
async fn media_seek(seconds: f64) -> bool {
    tauri::async_runtime::spawn_blocking(move || media::seek(seconds)).await.unwrap_or(false)
}

#[tauri::command]
async fn volume_get() -> Option<audio::Volume> {
    tauri::async_runtime::spawn_blocking(audio::get).await.ok().flatten()
}

#[tauri::command]
async fn volume_set(level: f32) -> Option<audio::Volume> {
    tauri::async_runtime::spawn_blocking(move || audio::set_level(level)).await.ok().flatten()
}

#[tauri::command]
async fn volume_mute(muted: bool) -> Option<audio::Volume> {
    tauri::async_runtime::spawn_blocking(move || audio::set_muted(muted)).await.ok().flatten()
}

/// Puts an image from the history back on the clipboard (decoded to pixels; any app can paste it).
#[tauri::command]
async fn copy_image(data_url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        use base64::Engine;
        let b64 = data_url.split_once(',').map(|(_, b)| b).ok_or("Imagen inválida.")?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64).map_err(|e| e.to_string())?;
        let img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?.to_rgba8();
        let (w, h) = img.dimensions();
        clipboard::SKIP_NEXT_IMAGE.store(true, Ordering::Relaxed);
        arboard::Clipboard::new()
            .and_then(|mut c| c.set_image(arboard::ImageData { width: w as usize, height: h as usize, bytes: img.into_raw().into() }))
            .map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}

/// Windows destinations the UI may open: the sound output picker, the Clock app, Downloads.
#[tauri::command]
fn open_special(app: AppHandle, target: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    match target.as_str() {
        "sound" => app.opener().open_url("ms-settings:sound", None::<&str>).map_err(|e| e.to_string()),
        "clock" => app.opener().open_url("ms-clock:", None::<&str>).map_err(|e| e.to_string()),
        "downloads" => app.opener().open_path(downloads_dir(&app)?.to_string_lossy(), None::<&str>).map_err(|e| e.to_string()),
        _ => Err("Destino no permitido.".into()),
    }
}

#[tauri::command]
fn copy_text(text: String, own: State<'_, clipboard::OwnWrite>) -> Result<(), String> {
    if let Ok(mut o) = own.lock() { *o = Some(text.clone()); }
    arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| e.to_string())
}

fn app_bin(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_local_data_dir().map(|d| d.join("bin")).map_err(|e| e.to_string())
}

fn downloads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().download_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

fn need(name: &str, app: &AppHandle) -> Result<PathBuf, String> {
    tools::find(name, &app_bin(app)?).ok_or_else(|| "MISSING_TOOLS".to_string())
}

#[tauri::command]
fn tools_status(app: AppHandle) -> Result<tools::Status, String> {
    Ok(tools::status(&app_bin(&app)?))
}

#[tauri::command]
async fn install_tools(app: AppHandle) -> Result<(), String> {
    let bin = app_bin(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        tools::install_missing(&bin, |msg| { let _ = app.emit("tools-progress", msg); })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn download_media(app: AppHandle, url: String, format: String, cookies: Option<String>) -> Result<String, String> {
    if !download::is_supported_link(&url) { return Err("Eso no parece un enlace válido.".into()); }
    // One download at a time; the flag is cleared however this function exits.
    if DOWNLOADING.swap(true, Ordering::SeqCst) { return Err("Ya hay una descarga en curso.".into()); }
    struct Clear;
    impl Drop for Clear { fn drop(&mut self) { DOWNLOADING.store(false, Ordering::SeqCst); } }
    let _clear = Clear;
    let out = downloads_dir(&app)?;
    if download::is_direct_image(&url) {
        return tauri::async_runtime::spawn_blocking(move || download::download_direct(&url, &out))
            .await.map_err(|e| e.to_string())?.map(|p| p.to_string_lossy().into());
    }
    let ytdlp = need("yt-dlp", &app)?;
    let ffmpeg_dir = tools::find("ffmpeg", &app_bin(&app)?).and_then(|p| p.parent().map(Path::to_path_buf));
    tauri::async_runtime::spawn_blocking(move || {
        download::download_with_tool(&ytdlp, ffmpeg_dir.as_deref(), &url, download::Format::parse(&format), &out, cookies.as_deref(),
            |attempt| { let _ = app.emit("download-retry", attempt); })
    }).await.map_err(|e| e.to_string())?.map(|p| p.to_string_lossy().into())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo { path: String, name: String, bytes: u64, exists: bool, is_dir: bool, kind: convert::Kind, targets: Vec<&'static str> }

#[tauri::command]
fn files_info(paths: Vec<String>) -> Vec<FileInfo> {
    paths.into_iter().map(|p| {
        let pb = PathBuf::from(&p);
        let raw = std::fs::metadata(&pb).ok();
        let is_dir = raw.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let meta = raw.filter(|m| m.is_file());
        FileInfo {
            is_dir,
            name: pb.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p.clone()),
            bytes: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            exists: meta.is_some() || is_dir,
            kind: if is_dir { convert::Kind::Unsupported } else { convert::kind_of(&pb) },
            targets: if is_dir { vec![] } else { convert::targets(&pb) },
            path: p,
        }
    }).collect()
}

#[tauri::command]
async fn convert_file(app: AppHandle, path: String, target: String) -> Result<convert::Done, String> {
    let ffmpeg = need("ffmpeg", &app)?;
    tauri::async_runtime::spawn_blocking(move || convert::convert(&ffmpeg, Path::new(&path), &target)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn compress_file(app: AppHandle, path: String, percent: u32) -> Result<convert::Done, String> {
    let ffmpeg = need("ffmpeg", &app)?;
    let ffprobe = need("ffprobe", &app)?;
    tauri::async_runtime::spawn_blocking(move || convert::compress(&ffmpeg, &ffprobe, Path::new(&path), percent)).await.map_err(|e| e.to_string())?
}

/// Opening and revealing go through Rust so the webview needs no broad file-system scope;
/// only existing files are accepted.
#[tauri::command]
fn open_file(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let p = Path::new(&path);
    if !p.exists() { return Err("El archivo ya no existe.".into()); }
    // The shelf opens media and documents, not programs: a path that came from the webview
    // must never launch an executable or script.
    const BLOCKED: [&str; 14] = ["exe", "bat", "cmd", "com", "scr", "ps1", "vbs", "vbe", "js", "jse", "wsf", "msi", "lnk", "hta"];
    if BLOCKED.contains(&convert::ext_of(p).as_str()) { return Err("Por seguridad, NotchDrop no abre programas.".into()); }
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    if !Path::new(&path).exists() { return Err("El archivo ya no existe.".into()); }
    app.opener().reveal_item_in_dir(path).map_err(|e| e.to_string())
}

/// The drag-out plugin needs a preview image on disk; the app icon, written once to the cache.
#[tauri::command]
fn drag_icon(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let p = dir.join("drag-icon.png");
    if !p.is_file() { std::fs::write(&p, include_bytes!("../icons/64x64.png")).map_err(|e| e.to_string())?; }
    Ok(p.to_string_lossy().into())
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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_drag::init())
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
            // A monitor unplugged or a resolution changed doesn't always raise a window event;
            // re-checking every few seconds is cheap and keeps the pill centred.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last = None;
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    let Some(w) = handle.get_webview_window(ISLAND) else { continue };
                    let key = w.current_monitor().ok().flatten().or_else(|| w.primary_monitor().ok().flatten())
                        .map(|m| (m.position().x, m.position().y, m.size().width, m.size().height, (m.scale_factor() * 100.0) as i64));
                    if key.is_some() && key != last {
                        if last.is_some() { let w2 = w.clone(); let _ = w.run_on_main_thread(move || { let _ = place(&w2, EXPANDED.load(Ordering::Relaxed)); }); }
                        last = key;
                    }
                }
            });
            if let Ok(bin) = app_bin(app.handle()) { tools::remove_leftovers(&bin); }
            // Live output level for the waveform (~12 times a second, only when it changes).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut meter: Option<audio::Meter> = None;
                let (mut level, mut sent, mut retry_at) = (0.0f32, -1.0f32, std::time::Instant::now());
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(80));
                    if meter.is_none() && std::time::Instant::now() >= retry_at {
                        meter = audio::Meter::open();
                        retry_at = std::time::Instant::now() + std::time::Duration::from_secs(2);
                    }
                    let peak = match meter.as_ref().map(|m| m.peak()) { Some(Some(p)) => p, Some(None) => { meter = None; 0.0 } None => 0.0 };
                    level = audio::smooth(level, peak);
                    if (level - sent).abs() > 0.02 || (level == 0.0 && sent != 0.0) {
                        sent = level;
                        let _ = handle.emit("audio-level", level);
                    }
                }
            });
            Ok(())
        })
        // Resolution, DPI or monitor changes: put the island back where it belongs.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::ScaleFactorChanged { .. } = event {
                // tao applies its own suggested size right after this handler; re-place a moment later.
                if let Some(w) = window.app_handle().get_webview_window(ISLAND) {
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(250));
                        let w2 = w.clone();
                        let _ = w.run_on_main_thread(move || { let _ = place(&w2, EXPANDED.load(Ordering::Relaxed)); });
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_expanded, media_state, media_command, media_seek, volume_get, volume_set, volume_mute,
            copy_text, copy_image, open_special, quit_app,
            tools_status, install_tools, download_media, files_info, convert_file, compress_file, open_file, reveal_file, drag_icon
        ])
        .run(tauri::generate_context!())
        .expect("error while running NotchDrop");
}
