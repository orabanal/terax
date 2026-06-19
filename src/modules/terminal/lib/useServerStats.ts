import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { ptyIdForLeaf } from "@/modules/terminal/lib/useTerminalSession";

export type ServerStats = {
  cpu: number | null;
  cpuCores: number | null;
  memUsed: number | null;
  memTotal: number | null;
  diskUsed: number | null;
  diskTotal: number | null;
  diskPercent: number | null;
  netRxSpeed: number;
  netTxSpeed: number;
};

type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

// Reads CPU (two samples 300ms apart), memory, root disk, and network speed
// from Linux /proc in a single ssh_exec channel. Total runtime ~300ms.
const STATS_SCRIPT = [
  "s1=$(cat /proc/stat 2>/dev/null)",
  "n1=$(cat /proc/net/dev 2>/dev/null)",
  "sleep 0.3",
  "s2=$(cat /proc/stat 2>/dev/null)",
  "n2=$(cat /proc/net/dev 2>/dev/null)",
  "mem=$(cat /proc/meminfo 2>/dev/null)",
  "df_out=$(df -BG / 2>/dev/null | tail -1)",
  "printf 'STAT1:\\n%s\\nSTAT1END\\n' \"$s1\"",
  "printf 'STAT2:\\n%s\\nSTAT2END\\n' \"$s2\"",
  "printf 'MEM:\\n%s\\nMEMEND\\n' \"$mem\"",
  "printf 'DISK:%s\\n' \"$df_out\"",
  "printf 'NET1:\\n%s\\nNET1END\\n' \"$n1\"",
  "printf 'NET2:\\n%s\\nNET2END\\n' \"$n2\"",
].join("; ");

function parseCpuAggregateLine(statBlock: string): number[] {
  // First line of /proc/stat: "cpu  1234 56 789 ..." — skip label, parse numbers
  const firstLine = statBlock.split("\n")[0] ?? "";
  return firstLine
    .trim()
    .split(/\s+/)
    .slice(1)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
}

function countCpuCores(statBlock: string): number | null {
  const matches = statBlock.match(/^cpu\d+/gm);
  return matches && matches.length > 0 ? matches.length : null;
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

function parseMeminfo(block: string): { used: number | null; total: number | null } {
  const get = (key: string): number | null => {
    const m = new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(block);
    return m ? parseInt(m[1], 10) : null;
  };
  const total = get("MemTotal");
  const free = get("MemFree");
  const buffers = get("Buffers");
  const cached = get("Cached");
  if (total === null || free === null) return { used: null, total: null };
  const used = total - free - (buffers ?? 0) - (cached ?? 0);
  // Convert kB to MB
  return { used: Math.round(used / 1024), total: Math.round(total / 1024) };
}

function parseDisk(line: string): { used: number | null; total: number | null; percent: number | null } {
  // "Filesystem  Size  Used  Avail  Use%  Mounted"
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return { used: null, total: null, percent: null };
  const total = parseInt(parts[1], 10);
  const used = parseInt(parts[2], 10);
  const pct = parseInt(parts[4], 10);
  return {
    used: Number.isFinite(used) ? used : null,
    total: Number.isFinite(total) ? total : null,
    percent: Number.isFinite(pct) ? pct : null,
  };
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
  const diskMatch = /^DISK:(.*)$/m.exec(raw);
  const net1 = extractBlock(raw, "NET1:\n", "\nNET1END");
  const net2 = extractBlock(raw, "NET2:\n", "\nNET2END");

  const fields1 = parseCpuAggregateLine(stat1);
  const fields2 = parseCpuAggregateLine(stat2);
  const cpu = cpuPercent(fields1, fields2);
  const cpuCores = stat1 ? countCpuCores(stat1) : null;

  const mem = memBlock ? parseMeminfo(memBlock) : { used: null, total: null };
  const disk = diskMatch ? parseDisk(diskMatch[1]) : { used: null, total: null, percent: null };
  const net = net1 && net2 ? parseNetSpeed(net1, net2, 300) : { rx: 0, tx: 0 };

  return {
    cpu,
    cpuCores,
    memUsed: mem.used,
    memTotal: mem.total,
    diskUsed: disk.used,
    diskTotal: disk.total,
    diskPercent: disk.percent,
    netRxSpeed: net.rx,
    netTxSpeed: net.tx,
  };
}

const NULL_STATS: ServerStats = {
  cpu: null,
  cpuCores: null,
  memUsed: null,
  memTotal: null,
  diskUsed: null,
  diskTotal: null,
  diskPercent: null,
  netRxSpeed: 0,
  netTxSpeed: 0,
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
