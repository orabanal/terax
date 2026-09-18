import type { ServerStats } from "./lib/useServerStats";

type Props = {
  stats: ServerStats;
};

/** Mounted disks shown on hover over the disk stat: one row per mount
 *  with usage bar and used/total + percent. */
export function DiskDetailsCard({ stats }: Props) {
  if (stats.disks.length === 0) {
    return (
      <div className="text-[11.5px] text-muted-foreground">
        Discos no disponibles en este host.
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] font-semibold text-foreground">
        Discos montados
      </p>
      <div className="space-y-2.5">
        {stats.disks.map((d) => (
          <div key={d.mount}>
            <div className="flex items-baseline justify-between gap-3 text-[11.5px]">
              <span className="truncate font-mono text-foreground/80">
                {d.mount}
              </span>
              <span className="shrink-0 font-medium text-emerald-400 tabular-nums">
                {d.used}/{d.total}G ({d.pct}%)
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.min(100, Math.max(0, d.pct))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
