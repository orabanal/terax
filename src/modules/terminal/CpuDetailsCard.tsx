import type { ServerStats } from "./lib/useServerStats";

type Props = {
  stats: ServerStats;
};

/** Per-core CPU usage shown on hover over the CPU stat: a grid of cores
 *  with mini bars and percentages. */
export function CpuDetailsCard({ stats }: Props) {
  if (stats.cpuCorePcts.length === 0) {
    return (
      <div className="text-[11.5px] text-muted-foreground">
        Uso por núcleo no disponible en este host.
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] font-semibold text-foreground">
        Uso de núcleos de CPU
      </p>
      <div className="grid grid-cols-4 gap-x-4 gap-y-2.5">
        {stats.cpuCorePcts.map((pct, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: core index is the stable identity
          <div key={i} className="min-w-0">
            <p className="truncate text-center text-[11px] text-foreground/70">
              Core {i}
            </p>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
              />
            </div>
            <p className="mt-1 text-center text-[12px] font-semibold text-emerald-400 tabular-nums">
              {Math.round(pct)}%
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
