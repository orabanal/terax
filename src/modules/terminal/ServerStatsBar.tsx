import {
  CloudDownloadIcon,
  CloudUploadIcon,
  CpuIcon,
  Database01Icon,
  RamMemoryIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { CpuDetailsCard } from "./CpuDetailsCard";
import { DiskDetailsCard } from "./DiskDetailsCard";
import {
  CONNECTION_DOT,
  type PaneConnection,
} from "./lib/paneConnection";
import { fmtSpeed } from "./lib/statFormat";
import type { ServerStats } from "./lib/useServerStats";
import { MemoryDetailsCard } from "./MemoryDetailsCard";
import { NetDetailsCard } from "./NetDetailsCard";

export const STATS_BAR_HEIGHT = 28;

function StatHover({ card, children }: { card: ReactNode; children: ReactNode }) {
  return (
    <HoverCard openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" sideOffset={8} className="w-80 rounded-2xl">
        {card}
      </HoverCardContent>
    </HoverCard>
  );
}

type Props = {
  stats: ServerStats | null;
  /** Shown in the bar when there are no stats to display. Defaults to "Local terminal". */
  emptyLabel?: string;
  /** Connection identity badge (name + status dot). Shown in single-pane
   *  and split alike, so the SSH connection is visible at all times. */
  connection?: PaneConnection | null;
};

/** "Discador QB ●" — identity prefix shared by the empty and stats states. */
function ConnectionBadge({ connection }: { connection: PaneConnection }) {
  return (
    <span
      className="flex max-w-[40%] items-center gap-1.5 text-foreground/85"
      role="status"
      aria-label={`Connection: ${connection.kind === "ssh" ? connection.name : "Local"}`}
    >
      <span className="truncate font-semibold">
        {connection.kind === "ssh" ? connection.name : "Local"}
      </span>
      <span className={cn("size-1.5 shrink-0 rounded-full", CONNECTION_DOT[connection.status])} />
    </span>
  );
}

export const ServerStatsBar = memo(function ServerStatsBar({ stats, emptyLabel = "Local terminal", connection = null }: Props) {
  const hasData =
    stats !== null &&
    (stats.cpu !== null || stats.memUsed !== null || stats.diskPercent !== null);

  if (!hasData) {
    return (
      <div
        className="flex items-center gap-3 px-2.5 text-[10.5px] select-none text-foreground/35"
        style={{ height: STATS_BAR_HEIGHT }}
      >
        {connection ? <ConnectionBadge connection={connection} /> : emptyLabel}
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
      {connection && <ConnectionBadge connection={connection} />}
      {stats.cpu !== null && (
        <StatHover card={<CpuDetailsCard stats={stats} />}>
          <span className={`flex cursor-default items-center gap-1 ${cpuColor}`}>
            <HugeiconsIcon icon={CpuIcon} size={11} strokeWidth={1.75} className="shrink-0 opacity-70" />
            {stats.cpu}%
            {stats.cpuCorePcts.length > 0 && (
              <span className="text-foreground/45">({stats.cpuCorePcts.length}C)</span>
            )}
          </span>
        </StatHover>
      )}
      {stats.memUsed !== null && stats.memTotal !== null && (
        <StatHover card={<MemoryDetailsCard stats={stats} />}>
          <span className={`flex cursor-default items-center gap-1 ${memColor}`}>
            <HugeiconsIcon icon={RamMemoryIcon} size={11} strokeWidth={1.75} className="shrink-0 opacity-70" />
            {(stats.memUsed / 1024).toFixed(1)}/{(stats.memTotal / 1024).toFixed(1)}G
          </span>
        </StatHover>
      )}
      {stats.diskUsed !== null && stats.diskTotal !== null && (
        <StatHover card={<DiskDetailsCard stats={stats} />}>
          <span className={`flex cursor-default items-center gap-1 ${diskColor}`}>
            <HugeiconsIcon icon={Database01Icon} size={11} strokeWidth={1.75} className="shrink-0 opacity-70" />
            {stats.diskUsed}/{stats.diskTotal}G
            {stats.diskPercent !== null && (
              <span className="text-foreground/45">({stats.diskPercent}%)</span>
            )}
          </span>
        </StatHover>
      )}
      {(stats.netRxSpeed > 0 || stats.netTxSpeed > 0) && (
        <StatHover card={<NetDetailsCard stats={stats} />}>
          <span className="flex cursor-default items-center gap-3">
            <span className="flex items-center gap-1 text-foreground/75">
              <HugeiconsIcon icon={CloudDownloadIcon} size={11} strokeWidth={1.75} className="shrink-0 opacity-70" />
              {fmtSpeed(stats.netRxSpeed)}
            </span>
            <span className="flex items-center gap-1 text-foreground/75">
              <HugeiconsIcon icon={CloudUploadIcon} size={11} strokeWidth={1.75} className="shrink-0 opacity-70" />
              {fmtSpeed(stats.netTxSpeed)}
            </span>
          </span>
        </StatHover>
      )}
    </div>
  );
});
