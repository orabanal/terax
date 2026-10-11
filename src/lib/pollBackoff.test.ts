import { describe, expect, it } from "vitest";
import { nextPollInterval } from "./pollBackoff";

describe("nextPollInterval", () => {
  it("stays at base while fresh", () => {
    expect(
      nextPollInterval({ baseMs: 10_000, now: 100_000, lastActivityAt: 95_000 }),
    ).toBe(10_000);
  });

  it("stays at base exactly on the boundary", () => {
    expect(
      nextPollInterval({ baseMs: 10_000, now: 100_000, lastActivityAt: 90_000 }),
    ).toBe(10_000);
  });

  it("counts never-observed as fresh, not idle", () => {
    expect(
      nextPollInterval({ baseMs: 10_000, now: 100_000, lastActivityAt: 0 }),
    ).toBe(10_000);
  });

  it("doubles per quiet base-period while idle", () => {
    // idle 15s of 10s base → 1 step → 20s.
    expect(
      nextPollInterval({ baseMs: 10_000, now: 100_000, lastActivityAt: 85_000 }),
    ).toBe(20_000);
    // idle 25s → 2 steps → 40s.
    expect(
      nextPollInterval({ baseMs: 10_000, now: 100_000, lastActivityAt: 75_000 }),
    ).toBe(40_000);
    // idle 45s → 4 steps → 160s → capped at 60s.
    expect(
      nextPollInterval({ baseMs: 10_000, now: 100_000, lastActivityAt: 55_000 }),
    ).toBe(60_000);
  });

  it("caps at maxMs and respects overrides", () => {
    expect(
      nextPollInterval({
        baseMs: 15_000,
        now: 1_000_000,
        lastActivityAt: 100_000,
        maxMs: 30_000,
      }),
    ).toBe(30_000);
  });

  it("clamps degenerate bases", () => {
    expect(
      nextPollInterval({ baseMs: 0, now: 100_000, lastActivityAt: 0 }),
    ).toBe(1);
    expect(
      nextPollInterval({ baseMs: -5, now: 100_000, lastActivityAt: 0 }),
    ).toBe(1);
  });
});
