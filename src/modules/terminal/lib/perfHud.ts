/**
 * Minimal throughput HUD for diagnosing terminal slowness on real machines.
 * DEV-only: all recording is gated so production bundles pay nothing.
 *
 * Usage (dev console): `__teraxPerf.sample()` → bytes/s in, term.write/s,
 * rAF fps, plus totals. Compare with background image on/off, WebGL on/off.
 */

// Replaced with `false` at build time outside dev; bundler drops the bodies.
const ENABLED = typeof import.meta !== "undefined" && import.meta.env?.DEV === true;

let bytesIn = 0;
let writes = 0;
let frames = 0;
let framesStarted = false;
let lastT = 0;
let lastBytes = 0;
let lastWrites = 0;
let lastFrames = 0;

export function perfRecordBytes(n: number): void {
  if (!ENABLED) return;
  bytesIn += n;
}

export function perfRecordWrite(): void {
  if (!ENABLED) return;
  writes += 1;
}

function pumpFrames(): void {
  if (!ENABLED) return;
  frames += 1;
  requestAnimationFrame(pumpFrames);
}

export function perfStartFramePump(): void {
  if (!ENABLED || framesStarted) return;
  if (typeof requestAnimationFrame === "undefined") return;
  framesStarted = true;
  lastT = now();
  requestAnimationFrame(pumpFrames);
}

export function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export type PerfSample = {
  /** Wall seconds covered by this sample. */
  dt: number;
  /** PTY bytes received per second. */
  bytesPerSec: number;
  /** term.write calls per second (post-coalescing). */
  writesPerSec: number;
  /** rAF ticks per second (0 when the window is hidden). */
  fps: number;
  totals: { bytesIn: number; writes: number; frames: number };
};

export function perfSample(at?: number): PerfSample {
  const t = at ?? now();
  const dt = lastT > 0 ? Math.max((t - lastT) / 1000, 1e-3) : 1;
  const sample: PerfSample = {
    dt,
    bytesPerSec: Math.round((bytesIn - lastBytes) / dt),
    writesPerSec: Math.round((writes - lastWrites) / dt),
    fps: Math.round((frames - lastFrames) / dt),
    totals: { bytesIn, writes, frames },
  };
  lastT = t;
  lastBytes = bytesIn;
  lastWrites = writes;
  lastFrames = frames;
  return sample;
}

/** Test hook: reset all counters (vitest only — never called in prod). */
export function perfResetForTest(): void {
  bytesIn = 0;
  writes = 0;
  frames = 0;
  framesStarted = false;
  lastT = 0;
  lastBytes = 0;
  lastWrites = 0;
  lastFrames = 0;
}
