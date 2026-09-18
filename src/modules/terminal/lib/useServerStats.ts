import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ptyIdForLeaf } from "@/modules/terminal/lib/useTerminalSession";

export type TopProc = {
  name: string;
  /** % of total RAM (RES-based, from ps %MEM). */
  pct: number;
};

export type DiskStat = {
  mount: string;
  /** GB, as reported by df -BG. */
  used: number;
  total: number;
  pct: number;
};

export type NetIfaceStat = {
  name: string;
  /** Bytes/sec. */
  rx: number;
  tx: number;
};

export type ServerStats = {
  cpu: number | null;
  /** Per-core usage %, index = core number. Empty when unavailable. */
  cpuCorePcts: number[];
  memUsed: number | null;
  memTotal: number | null;
  memBuffers: number | null;
  memCached: number | null;
  memFree: number | null;
  swapUsed: number | null;
  swapTotal: number | null;
  topProcs: TopProc[];
  diskUsed: number | null;
  diskTotal: number | null;
  diskPercent: number | null;
  /** All mounted real disks (pseudo filesystems excluded by df -x). */
  disks: DiskStat[];
  netRxSpeed: number;
  netTxSpeed: number;
  /** Per-interface speeds, loopback excluded. */
  ifaces: NetIfaceStat[];
};

type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

// Reads CPU (two samples 300ms apart), memory, disks, and network speed
// from Linux /proc in a single ssh_exec channel, plus a top-10 by %MEM
// snapshot for the memory details card. Total runtime ~400ms.
const STATS_SCRIPT = [
  "s1=$(cat /proc/stat 2>/dev/null)",
  "n1=$(cat /proc/net/dev 2>/dev/null)",
  "sleep 0.3",
  "s2=$(cat /proc/stat 2>/dev/null)",
  "n2=$(cat /proc/net/dev 2>/dev/null)",
  "mem=$(cat /proc/meminfo 2>/dev/null)",
  "df_out=$(df -BG -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null | tail -n +2)",
  "top_out=$(ps -eo comm:24,pmem --sort=-%mem --no-headers 2>/dev/null | head -10)",
  "printf 'STAT1:\\n%s\\nSTAT1END\\n' \"$s1\"",
  "printf 'STAT2:\\n%s\\nSTAT2END\\n' \"$s2\"",
  "printf 'MEM:\\n%s\\nMEMEND\\n' \"$mem\"",
  "printf 'DF:\\n%s\\nDFEND\\n' \"$df_out\"",
  "printf 'NET1:\\n%s\\nNET1END\\n' \"$n1\"",
  "printf 'NET2:\\n%s\\nNET2END\\n' \"$n2\"",
  "printf 'TOP:\\n%s\\nTOPEND\\n' \"$top_out\"",
].join("; ");

function parseCpuFieldsLine(line: string): number[] {
  return line
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

function parseCpuAggregateLine(statBlock: string): number[] {
  // First line of /proc/stat: "cpu  1234 56 789 ..." — skip label, parse numbers
  return parseCpuFieldsLine(statBlock.split("\n")[0] ?? "");
}

/** Per-core usage % from the two /proc/stat samples (cpu0..cpuN lines). */
export function parseCpuCores(block1: string, block2: string): number[] {
  const fieldsOf = (block: string): number[][] =>
    block
      .split("\n")
      .filter((l) => /^cpu\d+\s/.test(l))
      .map(parseCpuFieldsLine);
  const f1 = fieldsOf(block1);
  const f2 = fieldsOf(block2);
  const out: number[] = [];
  for (let i = 0; i < Math.min(f1.length, f2.length); i++) {
    const pct = cpuPercent(f1[i], f2[i]);
    if (pct !== null) out.push(pct);
  }
  return out;
}

function cpuPercent(fields1: number[], fields2: number[]): number | null {
  if (fields1.length < 4 || fields2.length < 4) return null;
  const idle1 = fields1[3];
  const idle2 = fields2[3];
  const total1 = fields1.reduce((a, b) => a + b, 0);
  const total2 = fields2.reduce((a, b) => a + b, 0);
  const dTotal = total2 - total1;
  if (dTotal <= 0) return null;
  const dIdle = idle2 - idle1;
  return Math.round(((dTotal - dIdle) / dTotal) * 100);
}

export type MemDetail = {
  used: number | null;
  total: number | null;
  buffers: number | null;
  cached: number | null;
  free: number | null;
  swapUsed: number | null;
  swapTotal: number | null;
};

/** Full memory picture from /proc/meminfo (values in MB, rounded like the
 *  compact stats). `used` matches htop: total - free - buffers - cache. */
export function parseMeminfo(block: string): MemDetail {
  const get = (key: string): number | null => {
    const m = new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(block);
    return m ? parseInt(m[1], 10) : null;
  };
  const kb = (n: number | null): number | null =>
    n === null ? null : Math.round(n / 1024);
  const total = get("MemTotal");
  const free = get("MemFree");
  const buffers = get("Buffers");
  const cached = get("Cached");
  const swapTotal = get("SwapTotal");
  const swapFree = get("SwapFree");
  if (total === null || free === null) {
    return {
      used: null,
      total: null,
      buffers: null,
      cached: null,
      free: null,
      swapUsed: null,
      swapTotal: null,
    };
  }
  return {
    // Convert kB to MB
    used: Math.round((total - free - (buffers ?? 0) - (cached ?? 0)) / 1024),
    total: kb(total),
    buffers: kb(buffers),
    cached: kb(cached),
    free: kb(free),
    swapUsed:
      swapTotal !== null && swapFree !== null
        ? Math.round((swapTotal - swapFree) / 1024)
        : null,
    swapTotal: kb(swapTotal),
  };
}

/** Parse `ps -eo comm,pmem` lines ("name  3.1") into top-memory processes.
 *  Malformed lines are skipped; callers slice to display size. */
export function parseTopProcs(block: string): TopProc[] {
  const out: TopProc[] = [];
  for (const line of block.split("\n")) {
    const m = /^(.*?)\s+([\d.]+)\s*$/.exec(line);
    if (!m) continue;
    const name = m[1].trim();
    const pct = parseFloat(m[2]);
    if (!name || !Number.isFinite(pct)) continue;
    out.push({ name, pct: Math.round(pct * 10) / 10 });
  }
  return out;
}

/** All df lines ("Filesystem Size Used Avail Use% Mounted"); header and
 *  malformed lines are skipped. Sizes come from df -BG (trailing G). */
export function parseDf(block: string): DiskStat[] {
  const out: DiskStat[] = [];
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("Filesystem")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 6) continue;
    const total = parseInt(parts[1], 10);
    const used = parseInt(parts[2], 10);
    const pct = parseInt(parts[4], 10);
    const mount = parts.slice(5).join(" ");
    if (!Number.isFinite(total) || !Number.isFinite(used) || !Number.isFinite(pct)) {
      continue;
    }
    out.push({ mount, used, total, pct });
  }
  return out;
}

function netTotals(block: string): { rx: number; tx: number } {
  let rx = 0;
  let tx = 0;
  for (const line of block.split("\n")) {
    const parts = line.trim().split(/\s+/);
    // /proc/net/dev: skip header lines (no colon) and loopback
    if (!parts[0].endsWith(":") || parts[0].startsWith("lo:")) continue;
    rx += parseInt(parts[1], 10) || 0;
    tx += parseInt(parts[9], 10) || 0;
  }
  return { rx, tx };
}

function parseNetSpeed(block1: string, block2: string, intervalMs: number): { rx: number; tx: number } {
  const t1 = netTotals(block1);
  const t2 = netTotals(block2);
  const sec = intervalMs / 1000;
  return {
    rx: Math.max(0, Math.round((t2.rx - t1.rx) / sec)),
    tx: Math.max(0, Math.round((t2.tx - t1.tx) / sec)),
  };
}

/** Per-interface speeds from the two /proc/net/dev samples, loopback
 *  excluded, most active first. */
export function parseNetIfaces(
  block1: string,
  block2: string,
  intervalMs: number,
): NetIfaceStat[] {
  const totalsOf = (block: string): Map<string, { rx: number; tx: number }> => {
    const m = new Map<string, { rx: number; tx: number }>();
    for (const line of block.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (!parts[0].endsWith(":") || parts[0].startsWith("lo:")) continue;
      const name = parts[0].slice(0, -1);
      const rx = parseInt(parts[1], 10) || 0;
      const tx = parseInt(parts[9], 10) || 0;
      m.set(name, { rx: (m.get(name)?.rx ?? 0) + rx, tx: (m.get(name)?.tx ?? 0) + tx });
    }
    return m;
  };
  const sec = intervalMs / 1000;
  const t1 = totalsOf(block1);
  const t2 = totalsOf(block2);
  const out: NetIfaceStat[] = [];
  for (const [name, b] of t2) {
    const a = t1.get(name) ?? { rx: 0, tx: 0 };
    out.push({
      name,
      rx: Math.max(0, Math.round((b.rx - a.rx) / sec)),
      tx: Math.max(0, Math.round((b.tx - a.tx) / sec)),
    });
  }
  out.sort((x, y) => y.rx + y.tx - (x.rx + x.tx));
  return out;
}

function extractBlock(raw: string, startMarker: string, endMarker: string): string {
  const start = raw.indexOf(startMarker);
  if (start === -1) return "";
  const contentStart = start + startMarker.length;
  const end = raw.indexOf(endMarker, contentStart);
  return end === -1 ? raw.slice(contentStart) : raw.slice(contentStart, end);
}

function parseOutput(raw: string): ServerStats {
  const stat1 = extractBlock(raw, "STAT1:\n", "\nSTAT1END");
  const stat2 = extractBlock(raw, "STAT2:\n", "\nSTAT2END");
  const memBlock = extractBlock(raw, "MEM:\n", "\nMEMEND");
  const dfBlock = extractBlock(raw, "DF:\n", "\nDFEND");
  const net1 = extractBlock(raw, "NET1:\n", "\nNET1END");
  const net2 = extractBlock(raw, "NET2:\n", "\nNET2END");
  const topBlock = extractBlock(raw, "TOP:\n", "\nTOPEND");

  const fields1 = parseCpuAggregateLine(stat1);
  const fields2 = parseCpuAggregateLine(stat2);
  const cpu = cpuPercent(fields1, fields2);
  const cpuCorePcts = stat1 && stat2 ? parseCpuCores(stat1, stat2) : [];

  const mem = memBlock
    ? parseMeminfo(memBlock)
    : {
        used: null,
        total: null,
        buffers: null,
        cached: null,
        free: null,
        swapUsed: null,
        swapTotal: null,
      };
  const disks = dfBlock ? parseDf(dfBlock).slice(0, 8) : [];
  const root = disks.find((d) => d.mount === "/") ?? null;
  const disk = root
    ? { used: root.used, total: root.total, percent: root.pct }
    : { used: null, total: null, percent: null };
  const net = net1 && net2 ? parseNetSpeed(net1, net2, 300) : { rx: 0, tx: 0 };
  const ifaces = net1 && net2 ? parseNetIfaces(net1, net2, 300).slice(0, 8) : [];

  return {
    cpu,
    cpuCorePcts,
    memUsed: mem.used,
    memTotal: mem.total,
    memBuffers: mem.buffers,
    memCached: mem.cached,
    memFree: mem.free,
    swapUsed: mem.swapUsed,
    swapTotal: mem.swapTotal,
    topProcs: topBlock ? parseTopProcs(topBlock).slice(0, 10) : [],
    diskUsed: disk.used,
    diskTotal: disk.total,
    diskPercent: disk.percent,
    disks,
    netRxSpeed: net.rx,
    netTxSpeed: net.tx,
    ifaces,
  };
}

const NULL_STATS: ServerStats = {
  cpu: null,
  cpuCorePcts: [],
  memUsed: null,
  memTotal: null,
  memBuffers: null,
  memCached: null,
  memFree: null,
  swapUsed: null,
  swapTotal: null,
  topProcs: [],
  diskUsed: null,
  diskTotal: null,
  diskPercent: null,
  disks: [],
  netRxSpeed: 0,
  netTxSpeed: 0,
  ifaces: [],
};

const CONSECUTIVE_FAILURE_LIMIT = 3;
const FETCH_TIMEOUT_MS = 8_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
  ]);
}

type Options = {
  leafId: number | null;
  enabled: boolean;
  intervalSec: number;
  visible: boolean;
};

export function useServerStats({ leafId, enabled, intervalSec, visible }: Options): ServerStats {
  const [stats, setStats] = useState<ServerStats>(NULL_STATS);
  const failuresRef = useRef(0);
  const givenUpRef = useRef(false);
  const mountedRef = useRef(true);
  const genRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    if (!enabled || !visible || leafId === null || givenUpRef.current) return;
    const sshId = ptyIdForLeaf(leafId);
    if (sshId === null) return;

    const gen = ++genRef.current;
    try {
      const result = await withTimeout(
        invoke<SshExecResult>("ssh_exec", { id: sshId, command: STATS_SCRIPT }),
        FETCH_TIMEOUT_MS,
      );
      if (!mountedRef.current || gen !== genRef.current) return;
      if (result.exitCode !== 0 && !result.stdout) {
        throw new Error("no output");
      }
      failuresRef.current = 0;
      setStats(parseOutput(result.stdout));
    } catch {
      if (!mountedRef.current || gen !== genRef.current) return;
      failuresRef.current += 1;
      if (failuresRef.current >= CONSECUTIVE_FAILURE_LIMIT) {
        givenUpRef.current = true;
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }
  }, [leafId, enabled, visible]);

  // Reset on leafId change (new connection)
  useEffect(() => {
    failuresRef.current = 0;
    givenUpRef.current = false;
    setStats(NULL_STATS);
  }, [leafId]);

  useEffect(() => {
    mountedRef.current = true;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!enabled || !visible || leafId === null) {
      setStats(NULL_STATS);
      return () => {
        mountedRef.current = false;
      };
    }

    // Initial fetch after short delay to let SSH settle
    const initial = setTimeout(() => void fetch(), 1_500);
    if (!givenUpRef.current) {
      const ms = Math.max(5, intervalSec) * 1000;
      intervalRef.current = setInterval(() => void fetch(), ms);
    }

    return () => {
      mountedRef.current = false;
      clearTimeout(initial);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, visible, leafId, intervalSec, fetch]);

  return stats;
}
