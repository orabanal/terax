//! OS-level window opacity (Netcatty parity).
//!
//! Range `0.5..=1.0`, default `1.0`. Values are clamped with
//! `clamp(v) = min(1, max(0.5, v))` so the window can never go fully
//! transparent (which would strand the user with an invisible app).
//!
//! The effect attenuates the *whole* window at the compositor level,
//! including text — unlike a CSS `opacity` on the root element, the
//! desktop shows through at `0.5`.
//!
//! Platform behavior:
//! - macOS: `NSWindow::setAlphaValue`
//! - Windows: `WS_EX_LAYERED` + `SetLayeredWindowAttributes`
//! - Linux: no compositor-stable API — no-op that warns and returns the
//!   clamped value so callers degrade without error.

pub const MIN_OPACITY: f64 = 0.5;
pub const MAX_OPACITY: f64 = 1.0;
pub const DEFAULT_OPACITY: f64 = 1.0;

pub fn clamp_opacity(v: f64) -> f64 {
    if !v.is_finite() {
        return DEFAULT_OPACITY;
    }
    v.clamp(MIN_OPACITY, MAX_OPACITY)
}

#[tauri::command]
pub fn set_window_opacity(window: tauri::Window, opacity: f64) -> f64 {
    let clamped = clamp_opacity(opacity);
    apply_opacity(&window, clamped);
    clamped
}

fn apply_opacity(window: &tauri::Window, clamped: f64) {
    #[cfg(target_os = "macos")]
    {
        apply_macos(window, clamped);
    }
    #[cfg(target_os = "windows")]
    {
        apply_windows(window, clamped);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = (window, clamped);
        log::warn!(
            "set_window_opacity: per-window opacity is not supported on Linux; ignoring (opacity={clamped})"
        );
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (window, clamped);
        log::warn!("set_window_opacity: unsupported platform; ignoring");
    }
}

#[cfg(target_os = "macos")]
fn apply_macos(window: &tauri::Window, clamped: f64) {
    use objc2_app_kit::NSWindow;

    let ptr = match window.ns_window() {
        Ok(p) => p as *mut NSWindow,
        Err(e) => {
            log::warn!("set_window_opacity: ns_window() failed: {e}");
            return;
        }
    };
    if ptr.is_null() {
        log::warn!("set_window_opacity: null NSWindow pointer");
        return;
    }
    // SAFETY: Tauri guarantees the pointer is a valid NSWindow for the
    // lifetime of the window, and we use it synchronously on this call.
    // setAlphaValue only mutates compositor state — no threading contract.
    unsafe {
        (&*ptr).setAlphaValue(clamped);
    }
}

#[cfg(target_os = "windows")]
fn apply_windows(window: &tauri::Window, clamped: f64) {
    use windows::Win32::{
        Foundation::COLORREF,
        UI::WindowsAndMessaging::{
            GetWindowLongW, SetLayeredWindowAttributes, SetWindowLongW, GWL_EXSTYLE, LWA_ALPHA,
            WS_EX_LAYERED,
        },
    };

    let hwnd = match window.hwnd() {
        Ok(h) => h,
        Err(e) => {
            log::warn!("set_window_opacity: hwnd() failed: {e}");
            return;
        }
    };
    // SAFETY: hwnd comes from Tauri for a live window; the Win32 calls below
    // only mutate that window's style/alpha. No cross-thread aliasing: the
    // HWND value itself is just an integer handle.
    unsafe {
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
        if ex_style & (WS_EX_LAYERED.0 as i32) == 0 {
            SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | (WS_EX_LAYERED.0 as i32));
        }
        let alpha = (clamped * 255.0).round().clamp(0.0, 255.0) as u8;
        if let Err(e) = SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA) {
            log::warn!("set_window_opacity: SetLayeredWindowAttributes failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_keeps_valid_range() {
        assert_eq!(clamp_opacity(1.0), 1.0);
        assert_eq!(clamp_opacity(0.5), 0.5);
        assert_eq!(clamp_opacity(0.7), 0.7);
        assert_eq!(clamp_opacity(0.85), 0.85);
    }

    #[test]
    fn clamp_enforces_bounds() {
        assert_eq!(clamp_opacity(0.0), MIN_OPACITY);
        assert_eq!(clamp_opacity(0.49), MIN_OPACITY);
        assert_eq!(clamp_opacity(-3.0), MIN_OPACITY);
        assert_eq!(clamp_opacity(1.5), MAX_OPACITY);
        assert_eq!(clamp_opacity(42.0), MAX_OPACITY);
    }

    #[test]
    fn clamp_rejects_non_finite() {
        assert_eq!(clamp_opacity(f64::NAN), DEFAULT_OPACITY);
        assert_eq!(clamp_opacity(f64::INFINITY), DEFAULT_OPACITY);
        assert_eq!(clamp_opacity(f64::NEG_INFINITY), DEFAULT_OPACITY);
    }
}
