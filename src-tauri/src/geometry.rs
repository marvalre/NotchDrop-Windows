//! Where the island sits: centred at the top edge of the monitor it is on.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame { pub x: i32, pub y: i32, pub w: u32, pub h: u32 }

pub const COLLAPSED: (f64, f64) = (280.0, 40.0);
/// Same 2:1 proportion as the macOS panel (520×260 pt), a little roomier for Segoe UI.
pub const EXPANDED: (f64, f64) = (560.0, 290.0);

/// `monitor_*` are physical pixels (what Windows reports); sizes above are logical
/// pixels, scaled by the monitor's DPI factor so the island looks the same at 100 % and 150 %.
/// It never gets wider than the monitor minus a 24px margin each side.
/// `panel` is the "Tamaño del panel" setting (Compacto 0.85 / Estándar 1 / Amplio 1.15); it
/// only affects the expanded panel, never the pill.
pub fn island_frame(monitor_x: i32, monitor_y: i32, monitor_w: u32, monitor_h: u32, scale: f64, expanded: bool, panel: f64) -> Frame {
    let panel = if panel.is_finite() { panel.clamp(0.8, 1.2) } else { 1.0 };
    let (lw, lh) = if expanded { (EXPANDED.0 * panel, EXPANDED.1 * panel) } else { COLLAPSED };
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let max_w = monitor_w.saturating_sub((48.0 * scale) as u32).max(1);
    let w = ((lw * scale).round() as u32).min(max_w);
    let h = ((lh * scale).round() as u32).min(monitor_h.max(1));
    let x = monitor_x + ((monitor_w as i64 - w as i64) / 2) as i32;
    Frame { x, y: monitor_y, w, h }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centred_at_top_100_percent() {
        let f = island_frame(0, 0, 1920, 1080, 1.0, false, 1.0);
        assert_eq!(f, Frame { x: 820, y: 0, w: 280, h: 40 });
    }

    #[test]
    fn scales_with_dpi() {
        let f = island_frame(0, 0, 2880, 1800, 1.5, true, 1.0);
        assert_eq!((f.w, f.h), (840, 435));
        assert_eq!(f.x, (2880 - 840) / 2);
    }

    #[test]
    fn second_monitor_offset_is_respected() {
        let f = island_frame(1920, -200, 1280, 1024, 1.0, false, 1.0);
        assert_eq!((f.x, f.y), (1920 + (1280 - 280) / 2, -200));
    }

    #[test]
    fn never_wider_than_the_screen() {
        let f = island_frame(0, 0, 500, 400, 1.0, true, 1.0);
        assert!(f.w <= 500 - 48);
        assert!(f.x >= 0);
    }

    #[test]
    fn panel_size_setting_scales_only_the_expanded_panel() {
        assert_eq!(island_frame(0, 0, 1920, 1080, 1.0, true, 0.85).w, 476);
        assert_eq!(island_frame(0, 0, 1920, 1080, 1.0, true, 1.15).h, 334);
        assert_eq!(island_frame(0, 0, 1920, 1080, 1.0, false, 1.15).w, 280);
        assert_eq!(island_frame(0, 0, 1920, 1080, 1.0, true, f64::NAN).w, 560);
    }

    #[test]
    fn bad_scale_falls_back_to_one() {
        assert_eq!(island_frame(0, 0, 1920, 1080, f64::NAN, false, 1.0).w, 280);
        assert_eq!(island_frame(0, 0, 1920, 1080, 0.0, false, 1.0).w, 280);
    }
}
