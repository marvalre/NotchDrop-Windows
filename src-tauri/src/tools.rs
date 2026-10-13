//! yt-dlp, ffmpeg and ffprobe, installed with one click into the app's own folder —
//! no Terminal, no admin password. Every download is checked against a SHA-256 before
//! it is kept: ffmpeg/ffprobe against digests pinned here, yt-dlp against the
//! SHA2-256SUMS file of the same release.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const EXE: &str = if cfg!(windows) { ".exe" } else { "" };

pub struct Spec { pub name: &'static str, pub url: &'static str, pub sha256: Option<&'static str>, pub sums_url: Option<&'static str>, pub sums_entry: Option<&'static str>, pub gunzip: bool }

pub fn specs() -> Vec<Spec> {
    vec![
        Spec { name: "yt-dlp", url: "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe", sha256: None,
               sums_url: Some("https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS"), sums_entry: Some("yt-dlp.exe"), gunzip: false },
        Spec { name: "ffmpeg", url: concat!("https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1", "/ffmpeg-win32-x64.gz"),
               sha256: Some("8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77"), sums_url: None, sums_entry: None, gunzip: true },
        Spec { name: "ffprobe", url: concat!("https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1", "/ffprobe-win32-x64.gz"),
               sha256: Some("f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d"), sums_url: None, sums_entry: None, gunzip: true },
    ]
}

pub fn sha256_hex(data: &[u8]) -> String {
    Sha256::digest(data).iter().map(|b| format!("{b:02x}")).collect()
}

/// "<64 hex>  name" or "<64 hex> *name"; exact name match.
pub fn parse_sums(text: &str, file: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let mut it = line.splitn(2, ' ');
        let (hash, name) = (it.next()?, it.next()?.trim().trim_start_matches('*'));
        (hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()) && name == file).then(|| hash.to_lowercase())
    })
}

/// A tool already on PATH (e.g. installed with winget/scoop) wins; otherwise the app's copy.
pub fn find(name: &str, app_bin: &Path) -> Option<PathBuf> {
    let file = format!("{name}{EXE}");
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            let p = dir.join(&file);
            if p.is_file() { return Some(p); }
        }
    }
    let local = app_bin.join(&file);
    local.is_file().then_some(local)
}

#[derive(Serialize)]
pub struct Status { pub missing: Vec<String> }

pub fn status(app_bin: &Path) -> Status {
    Status { missing: specs().iter().filter(|s| find(s.name, app_bin).is_none()).map(|s| s.name.to_string()).collect() }
}

/// Removes half-finished files left by an install the app was closed in the middle of.
pub fn remove_leftovers(app_bin: &Path) {
    if let Ok(rd) = std::fs::read_dir(app_bin) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.ends_with(".partial") { let _ = std::fs::remove_file(e.path()); }
        }
    }
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        // A whole download, not just an idle gap: a server trickling bytes can't hang the button forever.
        .timeout(Duration::from_secs(900))
        .user_agent("NotchDrop-Windows")
        .build()
        .map_err(|e| e.to_string())
}

fn fetch(c: &reqwest::blocking::Client, url: &str) -> Result<Vec<u8>, String> {
    let r = c.get(url).send().map_err(|e| format!("No se pudo descargar: {e}"))?;
    if !r.status().is_success() { return Err(format!("El servidor respondió {}", r.status().as_u16())); }
    r.bytes().map(|b| b.to_vec()).map_err(|e| e.to_string())
}

/// Installs whatever is missing. `progress` gets human-readable steps.
pub fn install_missing(app_bin: &Path, progress: impl Fn(String)) -> Result<(), String> {
    std::fs::create_dir_all(app_bin).map_err(|e| e.to_string())?;
    remove_leftovers(app_bin);
    let c = client()?;
    for spec in specs().into_iter().filter(|s| find(s.name, app_bin).is_none()) {
        progress(format!("Descargando {}…", spec.name));
        let data = fetch(&c, spec.url)?;
        let expected = match (spec.sha256, spec.sums_url, spec.sums_entry) {
            (Some(h), _, _) => h.to_string(),
            (None, Some(u), Some(entry)) => {
                let text = String::from_utf8_lossy(&fetch(&c, u)?).to_string();
                parse_sums(&text, entry).ok_or_else(|| format!("No se pudo verificar {}.", spec.name))?
            }
            _ => return Err(format!("No hay forma de verificar {}.", spec.name)),
        };
        if sha256_hex(&data) != expected {
            return Err(format!("La descarga de {} no coincide con su firma; no se instaló.", spec.name));
        }
        progress(format!("Preparando {}…", spec.name));
        let bytes = if spec.gunzip {
            let mut out = Vec::new();
            flate2::read::GzDecoder::new(&data[..]).read_to_end(&mut out).map_err(|_| format!("No se pudo descomprimir {}.", spec.name))?;
            out
        } else { data };
        if bytes.len() < 2 || &bytes[..2] != b"MZ" {
            return Err(format!("{} no es un programa de Windows válido.", spec.name));
        }
        let dest = app_bin.join(format!("{}{EXE}", spec.name));
        let partial = app_bin.join(format!("{}{EXE}.partial", spec.name));
        std::fs::write(&partial, &bytes).map_err(|e| e.to_string())?;
        std::fs::rename(&partial, &dest).map_err(|e| { let _ = std::fs::remove_file(&partial); e.to_string() })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sums_exact_name() {
        let t = "66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a  yt-dlp.exe\n30b4c14aafab6082becff7881e41b76df46dc43ea7633479410a91e29da492bf  yt-dlp_win.zip\n";
        assert_eq!(parse_sums(t, "yt-dlp.exe").as_deref(), Some("66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a"));
        assert_eq!(parse_sums(t, "yt-dlp"), None, "no partial matches");
        assert_eq!(parse_sums("0123456789abcdef0123456789abcdef0123456789ABCDEF0123456789abcdef *x.exe", "x.exe").as_deref(),
                   Some("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"), "binary marker, lowercased");
        assert_eq!(parse_sums("tooshort  x.exe", "x.exe"), None);
    }

    #[test]
    fn sha256_known_value() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn every_tool_is_verifiable() {
        for s in specs() {
            assert!(s.sha256.map(|h| h.len() == 64).unwrap_or(false) || (s.sums_url.is_some() && s.sums_entry.is_some()), "{}", s.name);
            assert!(s.url.starts_with("https://github.com/"), "{}", s.url);
        }
    }

    #[test]
    fn leftovers_are_removed_but_tools_kept() {
        let d = std::env::temp_dir().join(format!("nd-left-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        for n in ["ffmpeg.exe.partial", "ffmpeg.exe", "yt-dlp.exe"] { std::fs::write(d.join(n), b"x").unwrap(); }
        remove_leftovers(&d);
        let mut left: Vec<_> = std::fs::read_dir(&d).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        left.sort();
        assert_eq!(left, vec!["ffmpeg.exe", "yt-dlp.exe"]);
        let _ = std::fs::remove_dir_all(&d);
    }
}
