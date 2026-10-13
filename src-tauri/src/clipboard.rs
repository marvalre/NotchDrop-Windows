//! Clipboard watcher: emits `clipboard-changed` with the text of each new copy.
//!
//! Windows: the clipboard is only opened when its sequence number changes (opening it every
//! poll can make other apps' copies fail with "clipboard in use"), and the private-copy flags
//! and the text are read in the same open, so they always belong to the same copy.
//! Password managers flag their copies with these formats — the same ones Windows' own Win+V
//! history obeys: "ExcludeClipboardContentFromMonitorProcessing" and "Clipboard Viewer Ignore"
//! (presence = private), and "CanIncludeInClipboardHistory" (a DWORD; 0 = private).

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Text this app put on the clipboard itself ("Copiar" in the history) — not a new copy.
pub type OwnWrite = Arc<Mutex<Option<String>>>;

#[allow(dead_code)]
pub enum Read { Text(String), Private, Nothing }

#[cfg(windows)]
mod win {
    use super::Read;
    use windows::core::w;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    const CF_UNICODETEXT: u32 = 13;

    pub fn sequence() -> u32 { unsafe { GetClipboardSequenceNumber() } }

    fn available(fmt: u32) -> bool { fmt != 0 && unsafe { IsClipboardFormatAvailable(fmt).is_ok() } }

    unsafe fn read_open() -> Read {
        for name in [w!("ExcludeClipboardContentFromMonitorProcessing"), w!("Clipboard Viewer Ignore")] {
            if available(RegisterClipboardFormatW(name)) { return Read::Private; }
        }
        let history = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
        if available(history) {
            if let Ok(h) = GetClipboardData(history) {
                let g = HGLOBAL(h.0);
                let p = GlobalLock(g) as *const u32;
                if !p.is_null() {
                    let allowed = GlobalSize(g) >= 4 && *p != 0;
                    let _ = GlobalUnlock(g);
                    if !allowed { return Read::Private; }
                }
            }
        }
        if !available(CF_UNICODETEXT) { return Read::Nothing; }
        let Ok(h) = GetClipboardData(CF_UNICODETEXT) else { return Read::Nothing };
        let g = HGLOBAL(h.0);
        let p = GlobalLock(g) as *const u16;
        if p.is_null() { return Read::Nothing; }
        let max = GlobalSize(g) / 2;
        let mut len = 0usize;
        while len < max && *p.add(len) != 0 { len += 1; }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
        let _ = GlobalUnlock(g);
        Read::Text(text)
    }

    /// None when another app holds the clipboard right now — try again on the next tick.
    pub fn read() -> Option<Read> {
        unsafe {
            if OpenClipboard(None).is_err() { return None; }
            let r = read_open();
            let _ = CloseClipboard();
            Some(r)
        }
    }
}

pub fn start(app: AppHandle, own_write: OwnWrite) {
    std::thread::spawn(move || {
        let mut last_text: Option<String> = None;
        #[cfg(windows)]
        let mut last_seq = 0u32;
        #[cfg(not(windows))]
        let mut cb = arboard::Clipboard::new().ok();
        loop {
            std::thread::sleep(Duration::from_millis(400));

            #[cfg(windows)]
            let read = {
                let seq = win::sequence();
                if seq == last_seq { continue; }
                match win::read() {
                    Some(r) => { last_seq = seq; r }
                    None => continue, // busy: keep last_seq so the next tick retries
                }
            };
            #[cfg(not(windows))]
            let read = {
                if cb.is_none() { cb = arboard::Clipboard::new().ok(); }
                match cb.as_mut().and_then(|c| c.get_text().ok()) { Some(t) => Read::Text(t), None => Read::Nothing }
            };

            let Read::Text(text) = read else { continue };
            if text.is_empty() || last_text.as_deref() == Some(text.as_str()) { continue; }
            last_text = Some(text.clone());
            let own = own_write.lock().map(|mut o| o.take()).unwrap_or(None);
            if own.as_deref() == Some(text.as_str()) { continue; }
            let _ = app.emit("clipboard-changed", text);
        }
    });
}
