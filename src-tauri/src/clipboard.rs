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

/// Set right before the app puts an image back on the clipboard, so it isn't re-added as new.
pub static SKIP_NEXT_IMAGE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[allow(dead_code)]
pub enum Read { Text(String), Image(Vec<u8>, &'static str), Private, Nothing }

/// Same per-image cap as the macOS app: one screenshot shouldn't eat the history.
pub const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;

#[cfg_attr(not(windows), allow(dead_code))]
/// A CF_DIB (BITMAPINFOHEADER + pixels) becomes a .bmp file by prepending the 14-byte file
/// header, whose only non-trivial field is where the pixel data starts.
pub fn dib_to_bmp(dib: &[u8]) -> Option<Vec<u8>> {
    if dib.len() < 40 { return None; }
    let rd = |o: usize, n: usize| -> u64 { dib[o..o + n].iter().rev().fold(0u64, |a, b| (a << 8) | *b as u64) };
    let header = rd(0, 4) as usize;
    if header < 40 || header > dib.len() { return None; }
    let bit_count = rd(14, 2) as usize;
    let compression = rd(16, 4);
    let clr_used = rd(32, 4) as usize;
    let mut palette = if bit_count <= 8 { (if clr_used > 0 { clr_used } else { 1 << bit_count }) * 4 } else { clr_used * 4 };
    if compression == 3 && header == 40 { palette += 12; } // BI_BITFIELDS masks after a v1 header
    let offset = 14 + header + palette;
    if offset - 14 > dib.len() { return None; }
    let size = (14 + dib.len()) as u32;
    let mut out = Vec::with_capacity(size as usize);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&size.to_le_bytes());
    out.extend_from_slice(&[0, 0, 0, 0]);
    out.extend_from_slice(&(offset as u32).to_le_bytes());
    out.extend_from_slice(dib);
    Some(out)
}

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
        if !available(CF_UNICODETEXT) { return read_image(); }
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

    unsafe fn bytes_of(fmt: u32) -> Option<Vec<u8>> {
        let h = GetClipboardData(fmt).ok()?;
        let g = HGLOBAL(h.0);
        let n = GlobalSize(g);
        if n == 0 || n > super::MAX_IMAGE_BYTES { return None; }
        let p = GlobalLock(g) as *const u8;
        if p.is_null() { return None; }
        let v = std::slice::from_raw_parts(p, n).to_vec();
        let _ = GlobalUnlock(g);
        Some(v)
    }

    /// Screenshots and copied images: the "PNG" format when the app offers it, else the DIB.
    unsafe fn read_image() -> Read {
        const CF_DIB: u32 = 8;
        let png = RegisterClipboardFormatW(w!("PNG"));
        if available(png) {
            if let Some(b) = bytes_of(png) { if b.starts_with(&[0x89, b'P', b'N', b'G']) { return Read::Image(b, "image/png"); } }
        }
        if available(CF_DIB) {
            if let Some(bmp) = bytes_of(CF_DIB).and_then(|d| super::dib_to_bmp(&d)) { return Read::Image(bmp, "image/bmp"); }
        }
        Read::Nothing
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

            let text = match read {
                Read::Text(t) => t,
                Read::Image(bytes, mime) => {
                    let own = SKIP_NEXT_IMAGE.swap(false, std::sync::atomic::Ordering::Relaxed);
                    if !own && bytes.len() <= MAX_IMAGE_BYTES {
                        use base64::Engine;
                        let url = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes));
                        let _ = app.emit("clipboard-image", url);
                    }
                    last_text = None;
                    continue;
                }
                _ => continue,
            };
            if text.is_empty() || last_text.as_deref() == Some(text.as_str()) { continue; }
            last_text = Some(text.clone());
            let own = own_write.lock().map(|mut o| o.take()).unwrap_or(None);
            if own.as_deref() == Some(text.as_str()) { continue; }
            let _ = app.emit("clipboard-changed", text);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dib_becomes_a_bmp_the_image_crate_can_read() {
        // 2x1 32-bit DIB, BI_RGB.
        let mut dib = vec![0u8; 40];
        dib[0] = 40; dib[4] = 2; dib[8] = 1; dib[12] = 1; dib[14] = 32;
        dib.extend_from_slice(&[0, 0, 255, 255, 255, 0, 0, 255]);
        let bmp = dib_to_bmp(&dib).unwrap();
        assert_eq!(&bmp[..2], b"BM");
        assert_eq!(u32::from_le_bytes(bmp[10..14].try_into().unwrap()), 54);
        let img = image::load_from_memory(&bmp).unwrap();
        assert_eq!((img.width(), img.height()), (2, 1));
    }

    #[test]
    fn junk_dib_is_rejected() {
        assert!(dib_to_bmp(&[1, 2, 3]).is_none());
        let mut bad = vec![0u8; 40];
        bad[0] = 200; // header larger than the data
        assert!(dib_to_bmp(&bad).is_none());
    }
}
