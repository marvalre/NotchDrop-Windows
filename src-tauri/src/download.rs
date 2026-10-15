//! Link downloader: yt-dlp for pages (TikTok, Instagram, X, YouTube, Reddit…), a plain
//! HTTP fetch for links that point straight at an image. Port of MediaDownloader (macOS).

use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Format { Mp4, Mp3 }

impl Format {
    pub fn parse(s: &str) -> Format { if s.eq_ignore_ascii_case("mp3") { Format::Mp3 } else { Format::Mp4 } }
    /// MP4 prefers H.264: yt-dlp's default picks AV1 at 4K on YouTube, which most players
    /// and editors can't open. MP3 extracts the best audio.
    pub fn args(self) -> Vec<String> {
        let v: &[&str] = match self {
            Format::Mp4 => &["-S", "vcodec:h264,res,acodec:m4a", "-f", "bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b", "--merge-output-format", "mp4"],
            Format::Mp3 => &["-x", "--audio-format", "mp3", "--audio-quality", "0"],
        };
        v.iter().map(|s| s.to_string()).collect()
    }
}

pub fn is_supported_link(text: &str) -> bool {
    let t = text.trim();
    let lower = t.to_ascii_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://"));
    match rest {
        Some(r) => { let host = r.split(['/', '?', '#']).next().unwrap_or(""); !host.is_empty() && host.contains('.') && !t.contains(char::is_whitespace) }
        None => false,
    }
}

const IMAGE_EXTS: [&str; 9] = ["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "tiff", "avif"];

fn url_path_ext(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or("");
    let after_host = path.splitn(4, '/').nth(3).unwrap_or("");
    let last = after_host.rsplit('/').next().unwrap_or("");
    last.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default()
}

fn url_stem(url: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or("");
    let last = path.splitn(4, '/').nth(3).unwrap_or("").rsplit('/').next().unwrap_or("");
    let stem = last.rsplit_once('.').map(|(s, _)| s).unwrap_or(last);
    let clean: String = stem.chars().map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' }).collect();
    let clean = clean.trim_start_matches(['.', '-']).to_string();
    if clean.is_empty() { "imagen".into() } else { clean.chars().take(80).collect() }
}

pub fn is_direct_image(url: &str) -> bool { IMAGE_EXTS.contains(&url_path_ext(url).as_str()) }

/// Whether a direct-link response is really an image and what to call it. The status must
/// be 2xx and the type an image (or octet-stream vouched for by the URL's own extension);
/// the extension always comes from the URL or the MIME type, never from the server's name.
pub fn direct_verdict(url: &str, status: u16, mime: &str) -> Result<String, String> {
    if !(200..300).contains(&status) { return Err(format!("El servidor respondió {status}; no se descargó nada.")); }
    let mime = mime.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    let url_ext = url_path_ext(url);
    let vouched = (mime.is_empty() || mime == "application/octet-stream") && IMAGE_EXTS.contains(&url_ext.as_str());
    if !mime.starts_with("image/") && !vouched { return Err("El enlace no devolvió una imagen.".into()); }
    let ext = if IMAGE_EXTS.contains(&url_ext.as_str()) { url_ext } else {
        match mime.as_str() {
            "image/jpeg" | "image/jpg" => "jpg", "image/png" => "png", "image/gif" => "gif", "image/webp" => "webp",
            "image/heic" => "heic", "image/bmp" => "bmp", "image/tiff" => "tiff", "image/avif" => "avif",
            _ => return Err("Ese tipo de imagen no es compatible.".into()),
        }.to_string()
    };
    Ok(format!("{}.{ext}", url_stem(url)))
}

/// TikTok blocks the web API more than the app API.
pub fn extractor_args(url: &str) -> Vec<String> {
    if url.to_ascii_lowercase().contains("tiktok.com") {
        vec!["--extractor-args".into(), "tiktok:app_info=7355728856979392262".into()]
    } else { vec![] }
}

/// Browsers yt-dlp can read cookies from (for content that needs a signed-in session).
pub fn cookie_browser(s: &str) -> Option<&'static str> {
    match s.to_ascii_lowercase().as_str() { "firefox" => Some("firefox"), "edge" => Some("edge"), "chrome" => Some("chrome"), "brave" => Some("brave"), _ => None }
}

pub fn build_args(url: &str, format: Format, ffmpeg_dir: Option<&Path>, out_dir: &Path, cookies: Option<&str>) -> Vec<String> {
    let mut a = vec!["--encoding".to_string(), "utf-8".to_string()];
    if let Some(b) = cookies.and_then(cookie_browser) { a.push("--cookies-from-browser".into()); a.push(b.into()); }
    a.extend(extractor_args(url));
    if let Some(d) = ffmpeg_dir { a.push("--ffmpeg-location".into()); a.push(d.to_string_lossy().into()); }
    for s in ["--no-playlist", "--no-warnings", "--restrict-filenames", "--no-simulate", "--print", "after_move:filepath", "--windows-filenames", "-o"] {
        a.push(s.into());
    }
    a.push(out_dir.join("%(title).60s [%(id)s].%(ext)s").to_string_lossy().into());
    a.extend(format.args());
    a.push("--".into());
    a.push(url.trim().into());
    a
}

#[derive(Debug, PartialEq)]
pub enum Failure { MissingConversionTools, CookiesUnreadable, TikTokBlocked, LoginRequired, Unsupported, Unavailable, Other }

pub fn classify(stderr: &str) -> Failure {
    let l = stderr.to_lowercase();
    if l.contains("ffmpeg") && (l.contains("not found") || l.contains("not installed") || l.contains("ffprobe")) { return Failure::MissingConversionTools; }
    if (l.contains("could not copy") && l.contains("cookie")) || l.contains("failed to decrypt") { return Failure::CookiesUnreadable; }
    if l.contains("universal data for rehydration") || l.contains("captcha") { return Failure::TikTokBlocked; }
    if l.contains("private") || l.contains("login") || l.contains("sign in") || l.contains("cookies") { return Failure::LoginRequired; }
    if l.contains("unsupported url") { return Failure::Unsupported; }
    if l.contains("unavailable") || l.contains("404") { return Failure::Unavailable; }
    Failure::Other
}

pub fn friendly_error(stderr: &str) -> String {
    match classify(stderr) {
        Failure::MissingConversionTools => "Faltan las herramientas de conversión (ffmpeg). Pulsa «Instalar herramientas».".into(),
        Failure::CookiesUnreadable => "No se pudieron leer las cookies de ese navegador (ciérralo e inténtalo de nuevo, o elige Firefox en Ajustes).".into(),
        Failure::TikTokBlocked => "TikTok bloqueó la petición. Espera un momento y vuelve a intentar.".into(),
        Failure::LoginRequired => "Contenido privado o que requiere iniciar sesión — prueba las cookies del navegador en Ajustes.".into(),
        Failure::Unsupported => "Ese sitio no está soportado.".into(),
        Failure::Unavailable => "El contenido ya no está disponible.".into(),
        Failure::Other => {
            let line = stderr.lines().map(str::trim).find(|l| l.starts_with("ERROR")).or_else(|| stderr.lines().map(str::trim).find(|l| !l.is_empty()));
            line.map(|l| l.chars().take(140).collect()).unwrap_or_else(|| "Falló la descarga.".into())
        }
    }
}

pub fn is_transient(stderr: &str) -> bool {
    let l = stderr.to_lowercase();
    l.contains("universal data for rehydration") || l.contains("captcha") || l.contains("timed out") || l.contains("temporarily")
}

/// Never overwrite: "foto.jpg", "foto-2.jpg", "foto-3.jpg"…
pub fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let name = if filename.is_empty() { "descarga" } else { filename };
    let first = dir.join(name);
    if !first.exists() { return first; }
    let (stem, ext) = match name.rsplit_once('.') { Some((s, e)) => (s.to_string(), format!(".{e}")), None => (name.to_string(), String::new()) };
    (2..).map(|n| dir.join(format!("{stem}-{n}{ext}"))).find(|p| !p.exists()).unwrap()
}

pub fn download_direct(url: &str, out_dir: &Path) -> Result<PathBuf, String> {
    let c = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(15)).timeout(Duration::from_secs(60))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)").build().map_err(|e| e.to_string())?;
    let r = c.get(url.trim()).send().map_err(|e| e.to_string())?;
    let final_url = r.url().to_string();
    let mime = r.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let name = direct_verdict(&final_url, r.status().as_u16(), &mime)?;
    const MAX: u64 = 100 * 1024 * 1024;
    if r.content_length().map(|n| n > MAX).unwrap_or(false) { return Err("La imagen es demasiado grande.".into()); }
    let mut bytes = Vec::new();
    use std::io::Read;
    r.take(MAX + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX { return Err("La imagen es demasiado grande.".into()); }
    let target = unique_path(out_dir, &name);
    std::fs::write(&target, &bytes).map_err(|e| e.to_string())?;
    Ok(target)
}

pub const RETRY_LIMIT: u32 = 6;

/// Runs yt-dlp, retrying only errors that look transient (TikTok's anti-bot check).
pub fn download_with_tool(ytdlp: &Path, ffmpeg_dir: Option<&Path>, url: &str, format: Format, out_dir: &Path, cookies: Option<&str>, on_retry: impl Fn(u32)) -> Result<PathBuf, String> {
    let args = build_args(url, format, ffmpeg_dir, out_dir, cookies);
    let mut last = "Falló la descarga.".to_string();
    for attempt in 1..=RETRY_LIMIT {
        let o = crate::proc::run(ytdlp, &args, Duration::from_secs(600));
        if o.ok {
            let path = o.stdout.lines().map(str::trim).filter(|l| !l.is_empty()).last().unwrap_or("").to_string();
            let p = PathBuf::from(&path);
            return if !path.is_empty() && p.is_file() { Ok(p) } else { Err("Descargado, pero no se encontró el archivo final.".into()) };
        }
        last = friendly_error(&o.stderr);
        if classify(&o.stderr) == Failure::MissingConversionTools || !is_transient(&o.stderr) || attempt == RETRY_LIMIT { break; }
        on_retry(attempt + 1);
        std::thread::sleep(Duration::from_millis(1500));
    }
    Err(last)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn links() {
        assert!(is_supported_link(" https://www.tiktok.com/@x/video/1 "));
        assert!(is_supported_link("http://youtu.be/abc"));
        assert!(!is_supported_link("ftp://x.com/a"));
        assert!(!is_supported_link("hola mundo"));
        assert!(!is_supported_link("https://localhost"));
        assert!(!is_supported_link("https://x.com/a b"));
    }

    #[test]
    fn mp4_prefers_h264_and_mp3_extracts_audio() {
        let a = Format::Mp4.args();
        assert_eq!(&a[..2], &["-S".to_string(), "vcodec:h264,res,acodec:m4a".to_string()]);
        assert!(a.contains(&"mp4".to_string()));
        assert!(Format::Mp3.args().contains(&"mp3".to_string()));
        assert_eq!(Format::parse("MP3"), Format::Mp3);
        assert_eq!(Format::parse("cualquier"), Format::Mp4);
    }

    #[test]
    fn args_put_url_after_double_dash() {
        // A "link" starting with "-" must never be read by yt-dlp as an option.
        let a = build_args("https://x.com/v", Format::Mp4, Some(Path::new("C:\\bin")), Path::new("C:\\Users\\u\\Downloads"), Some("firefox"));
        let n = a.len();
        assert_eq!(a[n - 2], "--");
        assert_eq!(a[n - 1], "https://x.com/v");
        assert!(a.windows(2).any(|w| w[0] == "--ffmpeg-location" && w[1] == "C:\\bin"));
        assert!(a.contains(&"--no-playlist".to_string()));
        assert!(a.windows(2).any(|w| w[0] == "--encoding" && w[1] == "utf-8"), "UTF-8 output for non-ASCII user folders");
        assert!(a.windows(2).any(|w| w[0] == "--cookies-from-browser" && w[1] == "firefox"));
        let none = build_args("https://x.com/v", Format::Mp4, None, Path::new("C:\\d"), Some("$(evil)"));
        assert!(!none.contains(&"--cookies-from-browser".to_string()), "only known browsers");
    }

    #[test]
    fn tiktok_gets_app_api() {
        assert_eq!(extractor_args("https://www.TikTok.com/@a/video/1").len(), 2);
        assert!(extractor_args("https://youtube.com/watch?v=1").is_empty());
    }

    #[test]
    fn classify_real_errors() {
        assert_eq!(classify("ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install"), Failure::MissingConversionTools);
        assert_eq!(classify("ERROR: You have requested merging of multiple formats but ffmpeg is not installed. Aborting due to --abort-on-error"), Failure::MissingConversionTools);
        assert_eq!(classify("ERROR: Could not copy Chrome cookie database. See  https://github.com/yt-dlp/yt-dlp/issues/7271"), Failure::CookiesUnreadable);
        assert_eq!(classify("ERROR: [youtube] x: Sign in to confirm you're not a bot."), Failure::LoginRequired);
        assert_eq!(classify("ERROR: Unable to extract universal data for rehydration"), Failure::TikTokBlocked);
        assert_eq!(classify("ERROR: Unsupported URL: https://x.com"), Failure::Unsupported);
        assert_eq!(classify("ERROR: Video unavailable"), Failure::Unavailable);
        assert_eq!(classify("ERROR: something else"), Failure::Other);
        assert!(is_transient("Unable to extract universal data for rehydration"));
        assert!(!is_transient("Unsupported URL"));
        assert_eq!(friendly_error("WARNING: a\nERROR: boom happened"), "ERROR: boom happened");
    }

    #[test]
    fn direct_image_verdicts() {
        let u = "https://cdn.example.com/a/foto.jpg?x=1";
        assert!(is_direct_image(u));
        assert!(!is_direct_image("https://youtube.com/watch?v=1"));
        assert_eq!(direct_verdict(u, 200, "image/jpeg").unwrap(), "foto.jpg");
        assert!(direct_verdict(u, 404, "image/jpeg").is_err(), "404 page is not an image");
        assert!(direct_verdict(u, 200, "text/html; charset=utf-8").is_err());
        assert_eq!(direct_verdict(u, 200, "application/octet-stream").unwrap(), "foto.jpg");
        assert!(direct_verdict("https://x.com/run.png", 200, "application/x-msdownload").is_err(), "exe disguised as png");
        assert_eq!(direct_verdict("https://x.com/img", 200, "image/webp").unwrap(), "img.webp");
        assert_eq!(direct_verdict("https://x.com/.hidden.png", 200, "image/png").unwrap(), "hidden.png");
        assert_eq!(direct_verdict("https://x.com/a/..\\..\\evil.png", 200, "image/png").unwrap(), "evil.png", "no path traversal");
    }

    #[test]
    fn unique_paths_never_overwrite() {
        let d = std::env::temp_dir().join(format!("nd-uniq-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("foto.jpg"), b"x").unwrap();
        std::fs::write(d.join("foto-2.jpg"), b"x").unwrap();
        assert_eq!(unique_path(&d, "foto.jpg"), d.join("foto-3.jpg"));
        assert_eq!(unique_path(&d, "nuevo.png"), d.join("nuevo.png"));
        let _ = std::fs::remove_dir_all(&d);
    }
}
