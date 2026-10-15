//! System output volume / mute and the live level used for the waveform, via Windows Core
//! Audio (IAudioEndpointVolume + IAudioMeterInformation on the default render device).
//! The meter reads a peak value the audio engine already computes — nothing is recorded,
//! and unlike the macOS version no screen/audio-capture permission is involved.

use serde::Serialize;

#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Volume { pub level: f32, pub muted: bool }

#[cfg_attr(not(windows), allow(dead_code))]
/// Clamp a requested volume to 0..1 (NaN → 0).
pub fn clamp_level(v: f32) -> f32 { if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 } }

#[cfg(windows)]
mod imp {
    use super::*;
    use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    fn com() { unsafe { let _ = CoInitializeEx(None, COINIT_MULTITHREADED); } }

    fn device() -> windows::core::Result<windows::Win32::Media::Audio::IMMDevice> {
        com();
        unsafe {
            let e: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            e.GetDefaultAudioEndpoint(eRender, eConsole)
        }
    }

    fn endpoint() -> windows::core::Result<IAudioEndpointVolume> { unsafe { device()?.Activate(CLSCTX_ALL, None) } }

    pub fn get() -> Option<Volume> {
        let ep = endpoint().ok()?;
        unsafe { Some(Volume { level: ep.GetMasterVolumeLevelScalar().ok()?, muted: ep.GetMute().ok()?.as_bool() }) }
    }

    pub fn set_level(v: f32) -> Option<Volume> {
        let ep = endpoint().ok()?;
        unsafe {
            ep.SetMasterVolumeLevelScalar(clamp_level(v), std::ptr::null()).ok()?;
            if v > 0.0 { let _ = ep.SetMute(false, std::ptr::null()); }
        }
        get()
    }

    pub fn set_muted(m: bool) -> Option<Volume> {
        let ep = endpoint().ok()?;
        unsafe { ep.SetMute(m, std::ptr::null()).ok()?; }
        get()
    }

    /// A meter bound to the device that is default *now*; re-created by the caller when it fails
    /// (the default output changes when headphones are plugged in).
    pub struct Meter(IAudioMeterInformation);
    impl Meter {
        pub fn open() -> Option<Meter> { unsafe { device().ok()?.Activate(CLSCTX_ALL, None).ok().map(Meter) } }
        pub fn peak(&self) -> Option<f32> { unsafe { self.0.GetPeakValue().ok() } }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;
    pub fn get() -> Option<Volume> { None }
    pub fn set_level(_v: f32) -> Option<Volume> { None }
    pub fn set_muted(_m: bool) -> Option<Volume> { None }
    pub struct Meter;
    impl Meter {
        pub fn open() -> Option<Meter> { None }
        pub fn peak(&self) -> Option<f32> { None }
    }
}

pub use imp::{get, set_level, set_muted, Meter};

/// Smooths the raw peak into the 0..1 level the bars show: fast attack, slower release,
/// and a small floor so near-silence reads as silence.
pub fn smooth(prev: f32, peak: f32) -> f32 {
    let p = if peak.is_finite() { peak.clamp(0.0, 1.0) } else { 0.0 };
    let p = if p < 0.01 { 0.0 } else { p.sqrt() };
    if p > prev { prev + (p - prev) * 0.7 } else { prev + (p - prev) * 0.25 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps() {
        assert_eq!(clamp_level(1.7), 1.0);
        assert_eq!(clamp_level(-1.0), 0.0);
        assert_eq!(clamp_level(f32::NAN), 0.0);
    }

    #[test]
    fn smoothing_rises_fast_falls_slow_and_floors_silence() {
        let up = smooth(0.0, 0.64);
        assert!(up > 0.5, "{up}");
        let down = smooth(0.8, 0.0);
        assert!(down > 0.5 && down < 0.8, "{down}");
        assert_eq!(smooth(0.0, 0.005), 0.0);
        assert_eq!(smooth(0.0, f32::NAN), 0.0);
    }
}
