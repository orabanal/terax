import {
  CloudDownloadIcon,
  CloudUploadIcon,
  CpuIcon,
  Database01Icon,
  RamMemoryIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ServerStats } from "./lib/useServerStats";

export const STATS_BAR_HEIGHT = 28;

function fmt(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}M/s`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}K/s`;
  return `${bytes}B/s`;
}

type Props = {
  stats: ServerStats | null;
  /** Shown in the bar when there are no stats to display. Defaults to "Local terminal". */
  emptyLabel?: string;
};

export function ServerStatsBar({ stats, emptyLabel = "Local terminal" }: Props) {
  const hasData =
    stats !== null &&
    (stats.cpu !== null || stats.memUsed !== null || stats.diskPercent !== null);

  if (!hasData) {
    return (
      <div
        className="flex items-center px-2.5 text-[10.5px] select-none text-foreground/35"
        style={{ height: STATS_BAR_HEIGHT }}
      >
        {emptyLabel}
      </div>
    );
  }

  const cpuColor =
    stats.cpu !== null && stats.cpu >= 90
      ? "text-red-400"
      : stats.cpu !== null && stats.cpu >= 70
        ? "text-amber-400"
        : "text-foreground/75";

  const memPct =
    stats.memUsed !== null && stats.memTotal !== null && stats.memTotal > 0
      ? Math.round((stats.memUsed / stats.memTotal) * 100)
      : null;
  const memColor =
    memPct !== null && memPct >= 90
      ? "text-red-400"
      : memPct !== null && memPct >= 70
        ? "text-amber-400"
        : "text-foreground/75";

  const diskColor =
    stats.diskPercent !== null && stats.diskPercent >= 90
      ? "text-red-400"
      : stats.diskPercent !== null && stats.diskPercent >= 70
        ? "text-amber-400"
        : "text-foreground/75";

  return (
    <div
      className="flex items-center gap-3 px-2.5 text-[10.5px] font-medium select-none overflow-hidden"
      style={{ height: STATS_BAR_HEIGHT }}
    >
      {stats.cpu !== null && (
        <span className={`flex items-center gap-1 ${cpuColor}`}>
          <HugeiconsIcon icon={CpuIcon} size={11} strokeWidth={1.75} className="shrink-0 opacity-70" />
          {stats.cpu}%
          {stats.cpuCores !== null && (
            <span className="text-foreground/45">({stats.cpuCores}C)</span>
          )}
        </span>
      )}
      {stats.memUsed !== null && stats.memTotal !== null && (
        <span className={`flex items-center gap-1 ${memColor}`}>
          <HugeiconsIcon icon={RamMemoryIcon} size={11} strokeWidth={1.75} className="shrink-0 opacity-70" />
          {(stats.memUsed / 1024).toFixed(1)}/{(stats.memTotal / 1024).toFixed(1)}G
        </span>
      )}
      {stats.diskUsed !== null && stats.diskTotal !== null && (
        <span className={`flex items-center gap-1 ${diskColor}`}>
          <HugeiconsIcon icon={Database01Icon} size={11} strokeWidth={1.75} className="shrink-0 opacity-70" />
          {stats.diskUsed}/{stats.diskTotal}G
          {stats.diskPercent !== null && (
            <span className="text-foreground/45">({stats.diskPercent}%)</span>
          )}
        </span>
      )}
      {(stats.netRxSpeed > 0 || stats.netTxSpeed > 0) && (
        <>
          <span className="flex items-center gap-1 text-foreground/75">
            <HugeiconsIcon icon={CloudDownloadIcon} size={11} strokeWidth={1.75} className="shrink-0 opacity-70" />
            {fmt(stats.netRxSpeed)}
          </span>
          <span className="flex items-center gap-1 text-foreground/75">
            <HugeiconsIcon icon={CloudUploadIcon} size={11} strokeWidth={1.75} className="shrink-0 opacity-70" />
            {fmt(stats.netTxSpeed)}
          </span>
        </>
      )}
    </div>
  );
}
