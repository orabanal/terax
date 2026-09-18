import { describe, expect, it } from "vitest";
import {
  parseCpuCores,
  parseDf,
  parseMeminfo,
  parseNetIfaces,
  parseTopProcs,
} from "./useServerStats";

const MEMINFO = `MemTotal:        4024548 kB
MemFree:         2512340 kB
MemAvailable:    3200100 kB
Buffers:           12340 kB
Cached:           512000 kB
SwapCached:            0 kB
SwapTotal:       6234108 kB
SwapFree:        4900000 kB
`;

describe("parseMeminfo", () => {
  it("returns the full breakdown in MB with htop-style used", () => {
    const m = parseMeminfo(MEMINFO);
    expect(m.total).toBe(Math.round(4024548 / 1024));
    expect(m.free).toBe(Math.round(2512340 / 1024));
    expect(m.buffers).toBe(Math.round(12340 / 1024));
    expect(m.cached).toBe(Math.round(512000 / 1024));
    expect(m.used).toBe(
      Math.round((4024548 - 2512340 - 12340 - 512000) / 1024),
    );
    expect(m.swapTotal).toBe(Math.round(6234108 / 1024));
    expect(m.swapUsed).toBe(Math.round((6234108 - 4900000) / 1024));
  });

  it("returns nulls without MemTotal/MemFree", () => {
    expect(parseMeminfo("Buffers: 10 kB\n")).toEqual({
      used: null,
      total: null,
      buffers: null,
      cached: null,
      free: null,
      swapUsed: null,
      swapTotal: null,
    });
  });

  it("tolerates missing optional fields", () => {
    const m = parseMeminfo("MemTotal: 1000 kB\nMemFree: 400 kB\n");
    expect(m.used).toBe(Math.round(600 / 1024));
    expect(m.buffers).toBeNull();
    expect(m.swapTotal).toBeNull();
    expect(m.swapUsed).toBeNull();
  });
});

describe("parseTopProcs", () => {
  it("parses name + %mem lines", () => {
    const procs = parseTopProcs("python  3.1\npostgres  2.2\n");
    expect(procs).toEqual([
      { name: "python", pct: 3.1 },
      { name: "postgres", pct: 2.2 },
    ]);
  });

  it("skips malformed lines", () => {
    expect(parseTopProcs("COMMAND %MEM\n\ntailscaled 1.8\ngarbage\n")).toEqual([
      { name: "tailscaled", pct: 1.8 },
    ]);
  });
});

describe("parseCpuCores", () => {
  const stat1 = [
    "cpu  1000 0 1000 8000 0 0 0 0 0 0",
    "cpu0 500 0 500 4000 0 0 0 0 0 0",
    "cpu1 500 0 500 4000 0 0 0 0 0 0",
    "intr 0",
  ].join("\n");
  const stat2 = [
    "cpu  1100 0 1100 8800 0 0 0 0 0 0",
    "cpu0 600 0 600 4400 0 0 0 0 0 0",
    "cpu1 500 0 500 4400 0 0 0 0 0 0",
    "intr 0",
  ].join("\n");

  it("computes per-core usage from two samples", () => {
    // core0: busy +200 / total +600 = 33%; core1: busy +0 / total +400 = 0%
    expect(parseCpuCores(stat1, stat2)).toEqual([33, 0]);
  });

  it("returns empty when samples mismatch", () => {
    expect(parseCpuCores("", "")).toEqual([]);
    expect(parseCpuCores(stat1, "cpu 1 2 3 4")).toEqual([]);
  });
});

describe("parseDf", () => {
  const DF = [
    "/dev/sda1              111G   42G   64G  40% /",
    "/dev/sda2                1G    1G    1G  19% /boot",
    "garbage line",
  ].join("\n");

  it("parses one entry per mount", () => {
    expect(parseDf(DF)).toEqual([
      { mount: "/", used: 42, total: 111, pct: 40 },
      { mount: "/boot", used: 1, total: 1, pct: 19 },
    ]);
  });

  it("skips headers and malformed lines", () => {
    expect(
      parseDf(`Filesystem Size Used Avail Use% Mounted on\n${DF}`),
    ).toHaveLength(2);
    expect(parseDf("")).toEqual([]);
  });
});

describe("parseNetIfaces", () => {
  const NET1 = [
    "Inter-|   Receive                                                |  Transmit",
    " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
    "eth0: 1000 10 0 0 0 0 0 0 2000 20 0 0 0 0 0 0",
    "lo: 999 9 0 0 0 0 0 0 999 9 0 0 0 0 0 0",
    "tailscale0: 500 5 0 0 0 0 0 0 100 1 0 0 0 0 0 0",
  ].join("\n");
  const NET2 = [
    "Inter-|   Receive                                                |  Transmit",
    " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
    "eth0: 4000 40 0 0 0 0 0 0 2600 26 0 0 0 0 0 0",
    "lo: 1999 19 0 0 0 0 0 0 1999 19 0 0 0 0 0 0",
    "tailscale0: 500 5 0 0 0 0 0 0 100 1 0 0 0 0 0 0",
  ].join("\n");

  it("computes per-interface speeds over 1s, loopback excluded", () => {
    // eth0: rx (4000-1000)/1 = 3000, tx (2600-2000)/1 = 600
    expect(parseNetIfaces(NET1, NET2, 1000)).toEqual([
      { name: "eth0", rx: 3000, tx: 600 },
      { name: "tailscale0", rx: 0, tx: 0 },
    ]);
  });
});
