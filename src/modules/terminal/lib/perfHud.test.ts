import { describe, expect, it } from "vitest";
import {
  perfRecordBytes,
  perfRecordWrite,
  perfResetForTest,
  perfSample,
} from "./perfHud";

describe("perfHud", () => {
  it("computes per-second rates between samples", () => {
    perfResetForTest();
    perfRecordBytes(1000);
    perfRecordBytes(3000);
    perfRecordWrite();
    perfRecordWrite();
    const first = perfSample(1000);
    expect(first.bytesPerSec).toBe(4000);
    expect(first.writesPerSec).toBe(2);
    expect(first.totals).toEqual({ bytesIn: 4000, writes: 2, frames: 0 });

    perfRecordBytes(2000);
    const second = perfSample(2000);
    expect(second.bytesPerSec).toBe(2000);
    expect(second.writesPerSec).toBe(0);
    expect(second.dt).toBe(1);
  });

  it("is a no-op without activity and never divides by zero", () => {
    perfResetForTest();
    const s = perfSample(5000);
    expect(s.bytesPerSec).toBe(0);
    expect(s.dt).toBeGreaterThan(0);
  });
});
