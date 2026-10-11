import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { clampWindowOpacity } from "@/modules/settings/store";

// localStorage shadow with a {opacity, version} shape (Netcatty parity):
// applied synchronously before the async Tauri store hydrates so there is
// no opaque flash, and kept in sync afterwards for the next launch.
export const WINDOW_OPACITY_SHADOW_KEY = "terax:window-opacity";
export const WINDOW_OPACITY_SHADOW_VERSION = 1;

type OpacityShadow = {
  opacity: number;
  version: number;
};

/** Pure parser — unit-tested without touching localStorage. */
export function parseWindowOpacityShadow(raw: string | null): number | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OpacityShadow>;
    if (typeof parsed.opacity !== "number") return null;
    // Unknown future versions are still honored through the clamp so an
    // old client never strands the user with an invisible window.
    return clampWindowOpacity(parsed.opacity);
  } catch {
    return null;
  }
}

export function readWindowOpacityShadow(): number | null {
  if (typeof window === "undefined") return null;
  try {
    return parseWindowOpacityShadow(
      window.localStorage.getItem(WINDOW_OPACITY_SHADOW_KEY),
    );
  } catch {
    return null;
  }
}

function writeWindowOpacityShadow(v: number): void {
  if (typeof window === "undefined") return;
  try {
    const payload: OpacityShadow = {
      opacity: clampWindowOpacity(v),
      version: WINDOW_OPACITY_SHADOW_VERSION,
    };
    window.localStorage.setItem(
      WINDOW_OPACITY_SHADOW_KEY,
      JSON.stringify(payload),
    );
  } catch {
    /* private mode / quota — the Tauri store remains source of truth */
  }
}

// CSS fallback (Tauri-idiomático): only used when the native command is
// unavailable (browser dev, stripped command). While native works the inline
// style is cleared so there is no double-dimming (OS alpha × CSS opacity).
function applyCssFallback(v: number): void {
  const root =
    document.getElementById("root") ??
    document.getElementById("settings-root");
  if (!root) return;
  if (v >= 1) {
    root.style.removeProperty("opacity");
  } else {
    root.style.opacity = String(v);
  }
}

function clearCssFallback(): void {
  const root =
    document.getElementById("root") ??
    document.getElementById("settings-root");
  root?.style.removeProperty("opacity");
}

/**
 * Bridges the persisted `windowOpacity` pref to the OS (same role as
 * Netcatty's `bridge.setWindowOpacity()` effect): every window runs this
 * hook, so each window attenuates itself — main + settings stay in sync
 * through the shared store event.
 */
export function useWindowOpacity(): void {
  const opacity = usePreferencesStore((s) => s.windowOpacity);
  const hydrated = usePreferencesStore((s) => s.hydrated);

  // Fast path: paint the shadow value before the async store hydrates.
  useEffect(() => {
    const shadow = readWindowOpacityShadow();
    if (shadow !== null && shadow < 1) applyCssFallback(shadow);
  }, []);

  // Steady state: native OS-level on every change.
  useEffect(() => {
    if (!hydrated) return;
    const clamped = clampWindowOpacity(opacity);
    writeWindowOpacityShadow(clamped);
    let cancelled = false;
    void invoke<number>("set_window_opacity", { opacity: clamped })
      .then(() => {
        if (!cancelled) clearCssFallback();
      })
      .catch(() => {
        if (!cancelled) applyCssFallback(clamped);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, opacity]);
}
