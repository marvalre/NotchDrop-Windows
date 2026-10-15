//! "Now playing" from Windows' System Media Transport Controls (the same source as the
//! volume flyout): Spotify, browsers, the Media Player app — anything that publishes a session.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub app: String,
    pub playing: bool,
    pub position: f64,
    pub duration: f64,
    /// data: URL, only filled when the track changed since the last call (`artwork_key`).
    pub artwork: Option<String>,
    pub artwork_key: String,
}

/// 100-ns ticks since 1601 (Windows FILETIME/DateTime) for "now".
#[allow(dead_code)]
pub fn now_ticks() -> i64 {
    let unix = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as i64 / 100).unwrap_or(0);
    unix + 11_644_473_600 * 10_000_000
}

#[cfg_attr(not(windows), allow(dead_code))]
/// Position right now: SMTC reports where playback was at `last_updated`; while playing,
/// the time since then has to be added (and clamped to the track length).
pub fn live_position(position_s: f64, last_updated_ticks: i64, now_ticks: i64, playing: bool, duration_s: f64) -> f64 {
    let mut p = position_s;
    if playing && last_updated_ticks > 0 && now_ticks > last_updated_ticks {
        p += (now_ticks - last_updated_ticks) as f64 / 10_000_000.0;
    }
    if duration_s > 0.0 { p = p.min(duration_s); }
    if p.is_finite() { p.max(0.0) } else { 0.0 }
}

#[cfg(windows)]
mod imp {
    use super::*;
    use base64::Engine;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::DataReader;

    fn session() -> windows::core::Result<Session> {
        Manager::RequestAsync()?.get()?.GetCurrentSession()
    }

    fn artwork(props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<String> {
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()? as u32;
        if size == 0 || size > 8 * 1024 * 1024 { return None; }
        let mime = stream.ContentType().map(|s| s.to_string()).unwrap_or_else(|_| "image/png".into());
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.LoadAsync(size).ok()?.get().ok()?;
        let mut buf = vec![0u8; size as usize];
        reader.ReadBytes(&mut buf).ok()?;
        let mime = if mime.starts_with("image/") { mime } else { "image/png".into() };
        Some(format!("data:{};base64,{}", mime, base64::engine::general_purpose::STANDARD.encode(buf)))
    }

    pub fn current(known_key: &str) -> Option<MediaInfo> {
        let s = session().ok()?;
        let props = s.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let title = props.Title().map(|h| h.to_string()).unwrap_or_default();
        if title.is_empty() { return None; }
        let artist = props.Artist().map(|h| h.to_string()).unwrap_or_default();
        let album = props.AlbumTitle().map(|h| h.to_string()).unwrap_or_default();
        let app = s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default();
        let playing = s.GetPlaybackInfo().and_then(|i| i.PlaybackStatus()).map(|st| st == Status::Playing).unwrap_or(false);
        let (mut position, mut duration) = (0.0, 0.0);
        if let Ok(tl) = s.GetTimelineProperties() {
            let pos = tl.Position().map(|t| t.Duration as f64 / 1e7).unwrap_or(0.0);
            let start = tl.StartTime().map(|t| t.Duration as f64 / 1e7).unwrap_or(0.0);
            let end = tl.EndTime().map(|t| t.Duration as f64 / 1e7).unwrap_or(0.0);
            let updated = tl.LastUpdatedTime().map(|d| d.UniversalTime).unwrap_or(0);
            duration = (end - start).max(0.0);
            position = live_position(pos - start, updated, now_ticks(), playing, duration);
        }
        let key = format!("{title}\u{1f}{artist}\u{1f}{album}");
        let art = if key != known_key { artwork(&props) } else { None };
        Some(MediaInfo { title, artist, album, app, playing, position, duration, artwork: art, artwork_key: key })
    }

    pub fn seek(seconds: f64) -> bool {
        let Ok(s) = session() else { return false };
        let start = s.GetTimelineProperties().and_then(|t| t.StartTime()).map(|t| t.Duration).unwrap_or(0);
        let ticks = start + (seconds.max(0.0) * 1e7) as i64;
        s.TryChangePlaybackPositionAsync(ticks).and_then(|o| o.get()).unwrap_or(false)
    }

    pub fn command(action: &str) -> bool {
        let Ok(s) = session() else { return false };
        let op = match action {
            "toggle" => s.TryTogglePlayPauseAsync(),
            "next" => s.TrySkipNextAsync(),
            "previous" => s.TrySkipPreviousAsync(),
            _ => return false,
        };
        op.and_then(|o| o.get()).unwrap_or(false)
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn current(_known_key: &str) -> Option<MediaInfo> { None }
    pub fn command(_action: &str) -> bool { false }
    pub fn seek(_seconds: f64) -> bool { false }
}

pub use imp::{command, current, seek};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paused_position_does_not_advance() {
        assert_eq!(live_position(30.0, 100, 100 + 50_000_000, false, 200.0), 30.0);
    }

    #[test]
    fn playing_position_advances_by_elapsed_time() {
        assert!((live_position(30.0, 100, 100 + 50_000_000, true, 200.0) - 35.0).abs() < 1e-9);
    }

    #[test]
    fn clamped_to_track_length_and_never_negative() {
        assert_eq!(live_position(199.0, 1, 1 + 100_000_000, true, 200.0), 200.0);
        assert_eq!(live_position(-5.0, 0, 0, false, 0.0), 0.0);
        assert_eq!(live_position(f64::NAN, 0, 0, false, 0.0), 0.0);
    }
}
