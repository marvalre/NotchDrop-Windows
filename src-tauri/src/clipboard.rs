//! Clipboard watcher. Polls the text on the clipboard and emits `clipboard-changed`.
//! Copies a password manager marks as private are never reported: Windows apps flag
//! them with the clipboard formats below (the same flags Windows' own Win+V history obeys).

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
fn marked_private() -> bool {
    use windows::core::w;
    use windows::Win32::System::DataExchange::{IsClipboardFormatAvailable, RegisterClipboardFormatW};
    unsafe {
        for name in [
            w!("ExcludeClipboardContentFromMonitorProcessing"),
            w!("Clipboard Viewer Ignore"),
            w!("CanIncludeInClipboardHistory"),
        ] {
            let fmt = RegisterClipboardFormatW(name);
            if fmt != 0 && IsClipboardFormatAvailable(fmt).is_ok() {
                return true;
            }
        }
    }
    false
}

#[cfg(not(windows))]
fn marked_private() -> bool { false }

/// Text this app put on the clipboard itself ("Copy" in the history) — not a new copy.
pub type OwnWrite = Arc<Mutex<Option<String>>>;

pub fn start(app: AppHandle, own_write: OwnWrite) {
    std::thread::spawn(move || {
        let mut last: Option<String> = None;
        let mut cb = arboard::Clipboard::new().ok();
        loop {
            std::thread::sleep(Duration::from_millis(700));
            if cb.is_none() { cb = arboard::Clipboard::new().ok(); }
            let Some(c) = cb.as_mut() else { continue };
            let Ok(text) = c.get_text() else { continue };
            if last.as_deref() == Some(text.as_str()) { continue; }
            last = Some(text.clone());
            if own_write.lock().map(|mut o| o.take().as_deref() == Some(text.as_str())).unwrap_or(false) { continue; }
            if marked_private() { continue; }
            let _ = app.emit("clipboard-changed", text);
        }
    });
}
