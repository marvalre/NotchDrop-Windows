//! Change format / compress, via ffmpeg (port of FileConverter from the macOS app).
//! Never overwrites: the result lands next to the source with a distinct name.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind { Video, Audio, Image, Unsupported }

pub fn ext_of(p: &Path) -> String { p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default() }

pub fn kind_of(p: &Path) -> Kind {
    match ext_of(p).as_str() {
        "mp4" | "mov" | "m4v" | "avi" | "mkv" | "webm" | "flv" | "wmv" | "mpg" | "mpeg" => Kind::Video,
        "mp3" | "m4a" | "wav" | "aac" | "flac" | "aiff" | "aif" | "ogg" | "opus" | "wma" => Kind::Audio,
        // No HEIC: this ffmpeg build can't open the HEIF container.
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "tiff" | "tif" => Kind::Image,
        _ => Kind::Unsupported,
    }
}

/// What a file can become (its own format left out).
pub fn targets(p: &Path) -> Vec<&'static str> {
    let all: &[&str] = match kind_of(p) {
        Kind::Video => &["mp4", "mov", "webm", "gif", "mp3", "m4a", "wav"],
        Kind::Audio => &["mp3", "m4a", "wav", "flac"],
        Kind::Image => &["png", "jpg", "webp", "bmp", "tiff", "gif"],
        Kind::Unsupported => &[],
    };
    let own = ext_of(p);
    let own = if own == "jpeg" { "jpg".to_string() } else if own == "tif" { "tiff".to_string() } else { own };
    all.iter().copied().filter(|t| *t != own).collect()
}

pub fn output_path(source: &Path, ext: &str, suffix: &str) -> PathBuf {
    let dir = source.parent().unwrap_or(Path::new("."));
    let stem = source.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "archivo".into());
    let first = dir.join(format!("{stem}{suffix}.{ext}"));
    if !first.exists() { return first; }
    (2..).map(|n| dir.join(format!("{stem}{suffix}-{n}.{ext}"))).find(|p| !p.exists()).unwrap()
}

fn s(v: &[&str]) -> Vec<String> { v.iter().map(|x| x.to_string()).collect() }

/// ffmpeg arguments (without input/output) to turn `kind` into `target`.
pub fn convert_args(kind: Kind, target: &str) -> Result<Vec<String>, String> {
    Ok(match (kind, target) {
        (Kind::Video | Kind::Audio, "mp3") => s(&["-vn", "-c:a", "libmp3lame", "-q:a", "2"]),
        (Kind::Video | Kind::Audio, "m4a") => s(&["-vn", "-c:a", "aac", "-b:a", "192k"]),
        (Kind::Video | Kind::Audio, "wav") => s(&["-vn", "-c:a", "pcm_s16le"]),
        (Kind::Audio, "flac") => s(&["-vn", "-c:a", "flac"]),
        (Kind::Video, "mp4" | "mov") => s(&["-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k"]),
        (Kind::Video, "webm") => s(&["-c:v", "libvpx-vp9", "-crf", "33", "-b:v", "0", "-c:a", "libopus"]),
        // Short, small GIF: 12 fps, 480 px wide, so a long clip can't explode.
        (Kind::Video, "gif") => s(&["-vf", "fps=12,scale=480:-1:flags=lanczos", "-loop", "0"]),
        (Kind::Image, "png") => s(&["-frames:v", "1"]),
        (Kind::Image, "jpg") => s(&["-frames:v", "1", "-q:v", "2"]),
        (Kind::Image, "webp") => s(&["-frames:v", "1", "-c:v", "libwebp", "-quality", "90"]),
        (Kind::Image, "bmp") => s(&["-frames:v", "1"]),
        (Kind::Image, "tiff") => s(&["-frames:v", "1"]),
        (Kind::Image, "gif") => s(&["-frames:v", "1"]),
        (Kind::Unsupported, _) => return Err("Ese tipo de archivo no está soportado.".into()),
        _ => return Err(format!("No se puede convertir a {target}.")),
    })
}

/// Container for a compressed file: formats H.264/AAC (or a bitrate) can't live in come out
/// as .mp4 / .m4a, instead of a broken file with the old extension.
pub fn compression_ext(source_ext: &str, kind: Kind) -> &'static str {
    match (kind, source_ext) {
        (Kind::Video, "mov") => "mov",
        (Kind::Video, "mkv") => "mkv",
        (Kind::Video, _) => "mp4",
        (Kind::Audio, "mp3") => "mp3",
        (Kind::Audio, "opus") => "opus",
        (Kind::Audio, _) => "m4a",
        (Kind::Image, _) => "jpg",
        (Kind::Unsupported, _) => "",
    }
}

/// Bitrates aiming at `percent` of the ORIGINAL size (not a quality level — re-encoding an
/// already-compressed file at a quality target made it bigger on the Mac).
/// Returns (video_bps, audio_bps); video is 0 for audio-only.
pub fn target_bitrates(original_bytes: u64, percent: u32, duration_s: f64, is_video: bool) -> Option<(u64, u64)> {
    if original_bytes == 0 || !(duration_s.is_finite() && duration_s > 0.1) { return None; }
    let p = percent.clamp(10, 95) as f64;
    let total = original_bytes as f64 * p / 100.0 * 8.0 / duration_s * 0.95;
    if is_video {
        let audio = (total * 0.15).clamp(48_000.0, 128_000.0);
        let video = (total - audio).max(80_000.0);
        Some((video as u64, audio as u64))
    } else {
        Some((0, total.max(48_000.0) as u64))
    }
}

/// Below ~0.07 bits per pixel per frame H.264 smears; fewer pixels is the only honest way
/// to reach the size. Returns the new even width, or None to keep the resolution.
pub fn downscale_width(w: u32, h: u32, fps: f64, video_bps: u64) -> Option<u32> {
    let need = w as f64 * h as f64 * fps.max(1.0) * 0.07;
    if (video_bps as f64) >= need || w == 0 { return None; }
    let scale = ((video_bps as f64 / need).sqrt()).clamp(0.3, 1.0);
    if scale >= 0.97 { return None; }
    Some(((w as f64 * scale / 2.0).round() as u32 * 2).max(160))
}

pub fn compress_args(kind: Kind, out_ext: &str, bitrates: (u64, u64), new_width: Option<u32>) -> Vec<String> {
    let (v, a) = bitrates;
    let akbps = (a / 1000).max(48);
    match kind {
        Kind::Video => {
            let mut x = vec!["-c:v".into(), "libx264".into(), "-preset".into(), "medium".into(),
                "-b:v".into(), v.to_string(), "-maxrate".into(), ((v as f64 * 1.45) as u64).to_string(),
                "-bufsize".into(), (v * 2).to_string(), "-pix_fmt".into(), "yuv420p".into(),
                "-c:a".into(), "aac".into(), "-b:a".into(), format!("{akbps}k")];
            if let Some(w) = new_width { x.push("-vf".into()); x.push(format!("scale={w}:-2")); }
            x
        }
        _ => {
            let codec = match out_ext { "mp3" => "libmp3lame", "opus" => "libopus", _ => "aac" };
            vec!["-vn".into(), "-c:a".into(), codec.into(), "-b:a".into(), format!("{akbps}k")]
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Done { pub path: String, pub bytes: u64, pub original_bytes: u64 }

fn size(p: &Path) -> u64 { std::fs::metadata(p).map(|m| m.len()).unwrap_or(0) }

fn ffmpeg_run(ffmpeg: &Path, input: &Path, args: Vec<String>, out: &Path) -> Result<(), String> {
    let mut all = vec!["-hide_banner".to_string(), "-y".into(), "-i".into(), input.to_string_lossy().into()];
    all.extend(args);
    all.push(out.to_string_lossy().into());
    let o = crate::proc::run(ffmpeg, &all, Duration::from_secs(1200));
    if o.ok && out.is_file() && size(out) > 0 { return Ok(()); }
    // ffmpeg creates the output before it knows it can finish; don't leave the stub behind.
    let _ = std::fs::remove_file(out);
    let line = o.stderr.lines().map(str::trim).filter(|l| !l.is_empty()).last().unwrap_or("ffmpeg falló.");
    Err(line.chars().take(140).collect())
}

pub fn convert(ffmpeg: &Path, input: &Path, target: &str) -> Result<Done, String> {
    let kind = kind_of(input);
    if !targets(input).contains(&target) { return Err(format!("No se puede convertir a {target}.")); }
    let args = convert_args(kind, target)?;
    let out = output_path(input, target, "");
    ffmpeg_run(ffmpeg, input, args, &out)?;
    Ok(Done { path: out.to_string_lossy().into(), bytes: size(&out), original_bytes: size(input) })
}

fn probe(ffprobe: &Path, input: &Path, entries: &str, stream: bool) -> Vec<String> {
    let mut a: Vec<String> = vec!["-v".into(), "error".into()];
    if stream { a.extend(["-select_streams".into(), "v:0".into()]); }
    a.extend(["-show_entries".into(), entries.into(), "-of".into(), "default=noprint_wrappers=1:nokey=1".into(), input.to_string_lossy().into()]);
    crate::proc::run(ffprobe, &a, Duration::from_secs(30)).stdout.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
}

pub fn parse_fps(r: &str) -> f64 {
    let p: Vec<f64> = r.split('/').filter_map(|x| x.parse().ok()).collect();
    match p.as_slice() { [a, b] if *b != 0.0 => a / b, [a] => *a, _ => 30.0 }.max(1.0)
}

pub fn compress(ffmpeg: &Path, ffprobe: &Path, input: &Path, percent: u32) -> Result<Done, String> {
    let kind = kind_of(input);
    let original = size(input);
    let out_ext = compression_ext(&ext_of(input), kind);
    let out = output_path(input, out_ext, "-comprimido");
    match kind {
        Kind::Unsupported => return Err("Comprimir no aplica a este tipo de archivo.".into()),
        Kind::Image => {
            // JPEG quality doesn't map linearly to size: step down until it fits the target.
            let target = original * percent.clamp(10, 95) as u64 / 100;
            let mut done = false;
            for q in [3, 5, 8, 12, 18, 25, 31] {
                let _ = std::fs::remove_file(&out);
                ffmpeg_run(ffmpeg, input, s(&["-frames:v", "1", "-q:v", &q.to_string()]), &out)?;
                if size(&out) <= target { done = true; break; }
            }
            if !done && size(&out) >= original { let _ = std::fs::remove_file(&out); return Err("Ya está muy comprimida; no se puede reducir más.".into()); }
        }
        Kind::Video | Kind::Audio => {
            let duration = probe(ffprobe, input, "format=duration", false).first().and_then(|d| d.parse::<f64>().ok()).unwrap_or(0.0);
            let rates = target_bitrates(original, percent, duration, kind == Kind::Video).ok_or("No se pudo leer la duración del archivo.")?;
            let width = if kind == Kind::Video {
                let g = probe(ffprobe, input, "stream=width,height,r_frame_rate", true);
                match (g.first().and_then(|w| w.parse().ok()), g.get(1).and_then(|h| h.parse().ok()), g.get(2)) {
                    (Some(w), Some(h), Some(r)) => downscale_width(w, h, parse_fps(r), rates.0),
                    _ => None,
                }
            } else { None };
            ffmpeg_run(ffmpeg, input, compress_args(kind, out_ext, rates, width), &out)?;
        }
    }
    let bytes = size(&out);
    if bytes >= original {
        let _ = std::fs::remove_file(&out);
        return Err("Ya está muy comprimido; no se puede reducir más sin dañar la calidad.".into());
    }
    Ok(Done { path: out.to_string_lossy().into(), bytes, original_bytes: original })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_and_targets() {
        assert_eq!(kind_of(Path::new("a.MP4")), Kind::Video);
        assert_eq!(kind_of(Path::new("a.heic")), Kind::Unsupported, "HEIC can't be read by this ffmpeg");
        assert_eq!(targets(Path::new("a.mp4")), vec!["mov", "webm", "gif", "mp3", "m4a", "wav"]);
        assert!(!targets(Path::new("a.jpeg")).contains(&"jpg"), "jpeg → jpg is a no-op");
        assert!(targets(Path::new("a.txt")).is_empty());
    }

    #[test]
    fn every_offered_target_has_args() {
        for f in ["v.mp4", "a.mp3", "i.png", "i.jpg", "v.webm"] {
            let p = Path::new(f);
            for t in targets(p) { assert!(convert_args(kind_of(p), t).is_ok(), "{f} -> {t}"); }
        }
    }

    #[test]
    fn compression_container() {
        assert_eq!(compression_ext("webm", Kind::Video), "mp4");
        assert_eq!(compression_ext("mov", Kind::Video), "mov");
        assert_eq!(compression_ext("wav", Kind::Audio), "m4a");
        assert_eq!(compression_ext("flac", Kind::Audio), "m4a");
        assert_eq!(compression_ext("mp3", Kind::Audio), "mp3");
        assert_eq!(compression_ext("png", Kind::Image), "jpg");
    }

    #[test]
    fn bitrates_track_requested_size() {
        // 10 MB, 60 s, 50 % → ~633 kbps total.
        let (v, a) = target_bitrates(10_000_000, 50, 60.0, true).unwrap();
        assert!((v + a) as f64 > 600_000.0 && ((v + a) as f64) < 640_000.0, "{v}+{a}");
        assert!((48_000..=128_000).contains(&a));
        assert_eq!(target_bitrates(0, 50, 60.0, true), None);
        assert_eq!(target_bitrates(10, 50, f64::NAN, true), None);
        assert_eq!(target_bitrates(10, 50, 0.0, false), None);
        assert_eq!(target_bitrates(1_000, 50, 60.0, false).unwrap().1, 48_000, "floor");
    }

    #[test]
    fn downscale_only_when_needed_and_even() {
        assert_eq!(downscale_width(1920, 1080, 30.0, 10_000_000), None);
        let w = downscale_width(1920, 1080, 30.0, 500_000).unwrap();
        assert!(w % 2 == 0 && w >= 576 && w < 1920, "{w}");
        assert_eq!(parse_fps("30000/1001").round(), 30.0);
        assert_eq!(parse_fps("x"), 30.0);
        assert_eq!(parse_fps("0/0"), 30.0);
    }

    #[test]
    fn output_never_overwrites() {
        let d = std::env::temp_dir().join(format!("nd-out-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let src = d.join("clip.mp4");
        std::fs::write(&src, b"x").unwrap();
        assert_eq!(output_path(&src, "mp4", "-comprimido"), d.join("clip-comprimido.mp4"));
        std::fs::write(d.join("clip-comprimido.mp4"), b"x").unwrap();
        assert_eq!(output_path(&src, "mp4", "-comprimido"), d.join("clip-comprimido-2.mp4"));
        assert_eq!(output_path(&src, "gif", ""), d.join("clip.gif"));
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Real conversions with a real ffmpeg. Runs when NOTCHDROP_FFMPEG / NOTCHDROP_FFPROBE point
    /// at the binaries (CI downloads the same Windows build the app installs).
    #[test]
    fn real_ffmpeg_conversions() {
        let (Some(ff), Some(fp)) = (std::env::var_os("NOTCHDROP_FFMPEG"), std::env::var_os("NOTCHDROP_FFPROBE")) else {
            eprintln!("skipped: set NOTCHDROP_FFMPEG and NOTCHDROP_FFPROBE");
            return;
        };
        let (ff, fp) = (PathBuf::from(ff), PathBuf::from(fp));
        let d = std::env::temp_dir().join(format!("nd-real-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let video = d.join("clip.mp4");
        let gen = crate::proc::run(&ff, &s(&["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=4",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-crf", "10", "-c:a", "aac", "-b:a", "192k", "-shortest"])
            .into_iter().chain([video.to_string_lossy().to_string()]).collect::<Vec<_>>(), Duration::from_secs(120));
        assert!(gen.ok, "{}", gen.stderr);
        let image = d.join("foto.png");
        assert!(crate::proc::run(&ff, &s(&["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc2=size=800x600", "-frames:v", "1"])
            .into_iter().chain([image.to_string_lossy().to_string()]).collect::<Vec<_>>(), Duration::from_secs(60)).ok);

        for t in targets(&video) {
            let r = convert(&ff, &video, t).unwrap_or_else(|e| panic!("video -> {t}: {e}"));
            assert!(r.bytes > 0 && r.path.ends_with(&format!(".{t}")), "{t}");
        }
        let mp3 = convert(&ff, &video, "mp3").unwrap();
        for t in targets(Path::new(&mp3.path)) { convert(&ff, Path::new(&mp3.path), t).unwrap_or_else(|e| panic!("mp3 -> {t}: {e}")); }
        for t in targets(&image) { convert(&ff, &image, t).unwrap_or_else(|e| panic!("png -> {t}: {e}")); }

        let c = compress(&ff, &fp, &video, 50).unwrap();
        assert!(c.bytes < c.original_bytes, "compressed video smaller: {} vs {}", c.bytes, c.original_bytes);
        let wav = convert(&ff, &video, "wav").unwrap();
        let ca = compress(&ff, &fp, Path::new(&wav.path), 30).unwrap();
        assert!(ca.path.ends_with(".m4a") && ca.bytes < ca.original_bytes);
        let ci = compress(&ff, &fp, &image, 50).unwrap();
        assert!(ci.path.ends_with(".jpg") && ci.bytes < ci.original_bytes);
        assert!(compress(&ff, &fp, Path::new("nada.txt"), 50).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }
}
