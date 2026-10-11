import { describe, expect, it } from "vitest";
import {
  clampWindowOpacity,
  WINDOW_OPACITY_DEFAULT,
  WINDOW_OPACITY_MAX,
  WINDOW_OPACITY_MIN,
  WINDOW_OPACITY_PRESETS,
} from "@/modules/settings/store";
import {
  parseWindowOpacityShadow,
  WINDOW_OPACITY_SHADOW_VERSION,
} from "./useWindowOpacity";

describe("clampWindowOpacity", () => {
  it("keeps the valid range untouched", () => {
    expect(clampWindowOpacity(1.0)).toBe(1.0);
    expect(clampWindowOpacity(0.5)).toBe(0.5);
    expect(clampWindowOpacity(0.7)).toBe(0.7);
    expect(clampWindowOpacity(0.85)).toBe(0.85);
  });

  it("clamps with min(1, max(0.5, v))", () => {
    expect(clampWindowOpacity(0)).toBe(WINDOW_OPACITY_MIN);
    expect(clampWindowOpacity(0.49)).toBe(WINDOW_OPACITY_MIN);
    expect(clampWindowOpacity(-3)).toBe(WINDOW_OPACITY_MIN);
    expect(clampWindowOpacity(1.01)).toBe(WINDOW_OPACITY_MAX);
    expect(clampWindowOpacity(42)).toBe(WINDOW_OPACITY_MAX);
  });

  it("falls back to opaque for non-finite input", () => {
    expect(clampWindowOpacity(NaN)).toBe(WINDOW_OPACITY_DEFAULT);
    expect(clampWindowOpacity(Infinity)).toBe(WINDOW_OPACITY_DEFAULT);
    expect(clampWindowOpacity(-Infinity)).toBe(WINDOW_OPACITY_DEFAULT);
  });
});

describe("WINDOW_OPACITY_PRESETS", () => {
  it("matches the spec presets", () => {
    expect([...WINDOW_OPACITY_PRESETS]).toEqual([0.5, 0.7, 0.85, 1.0]);
  });

  it("stays inside the valid range", () => {
    for (const p of WINDOW_OPACITY_PRESETS) {
      expect(p).toBeGreaterThanOrEqual(WINDOW_OPACITY_MIN);
      expect(p).toBeLessThanOrEqual(WINDOW_OPACITY_MAX);
    }
  });
});

describe("parseWindowOpacityShadow ({opacity, version})", () => {
  const payload = (opacity: unknown, version = WINDOW_OPACITY_SHADOW_VERSION) =>
    JSON.stringify({ opacity, version });

  it("returns null for empty or corrupt input", () => {
    expect(parseWindowOpacityShadow(null)).toBeNull();
    expect(parseWindowOpacityShadow("")).toBeNull();
    expect(parseWindowOpacityShadow("not-json")).toBeNull();
    expect(parseWindowOpacityShadow(JSON.stringify({}))).toBeNull();
  });

  it("rejects non-numeric opacity", () => {
    expect(parseWindowOpacityShadow(payload("0.7"))).toBeNull();
    expect(parseWindowOpacityShadow(payload(null))).toBeNull();
  });

  it("accepts a well-formed shadow", () => {
    expect(parseWindowOpacityShadow(payload(0.7))).toBe(0.7);
    expect(parseWindowOpacityShadow(payload(1.0))).toBe(1.0);
  });

  it("clamps out-of-range shadows so a stale value can't hide the app", () => {
    expect(parseWindowOpacityShadow(payload(0.2))).toBe(WINDOW_OPACITY_MIN);
    expect(parseWindowOpacityShadow(payload(2))).toBe(WINDOW_OPACITY_MAX);
  });

  it("honors unknown future versions through the clamp", () => {
    expect(parseWindowOpacityShadow(payload(0.85, 999))).toBe(0.85);
  });
});
