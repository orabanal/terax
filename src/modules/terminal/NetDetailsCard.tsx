import { fmtSpeed } from "./lib/statFormat";
import type { ServerStats } from "./lib/useServerStats";

type Props = {
  stats: ServerStats;
};

/** Network interfaces shown on hover over the net stats: per-interface
 *  download / upload speeds, most active first. */
export function NetDetailsCard({ stats }: Props) {
  if (stats.ifaces.length === 0) {
    return (
      <div className="text-[11.5px] text-muted-foreground">
        Interfaces no disponibles en este host.
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] font-semibold text-foreground">
        Interfaces de red
      </p>
      <div className="space-y-1.5">
        {stats.ifaces.map((iface) => (
          <div
            key={iface.name}
            className="flex items-baseline justify-between gap-3 text-[11.5px]"
          >
            <span className="truncate font-mono text-foreground/80">
              {iface.name}
            </span>
            <span className="flex shrink-0 items-center gap-2 font-medium tabular-nums">
              <span className="text-emerald-400">↓ {fmtSpeed(iface.rx)}</span>
              <span className="text-sky-400">↑ {fmtSpeed(iface.tx)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
