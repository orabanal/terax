import { cn } from "@/lib/utils";
import { fmtGigabytes } from "./lib/statFormat";
import type { ServerStats } from "./lib/useServerStats";

const gb = fmtGigabytes;

function Segment({ pct, className }: { pct: number; className: string }) {
  if (pct <= 0) return null;
  return <div className={cn("h-full", className)} style={{ width: `${pct}%` }} />;
}

function LegendDot({ className }: { className: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", className)} />;
}

type Props = {
  stats: ServerStats;
};

/** Memory breakdown shown on hover over the RAM stat: stacked used /
 *  buffers / cache / free bar, swap bar, and top processes by %MEM —
 *  the same picture htop/btop users expect. Values arrive in MB from
 *  the server-stats poll; sections without data stay hidden. */
export function MemoryDetailsCard({ stats }: Props) {
  const totalMb = stats.memTotal ?? 0;
  const hasMem =
    stats.memTotal !== null &&
    stats.memTotal > 0 &&
    stats.memUsed !== null;
  const hasSwap = stats.swapTotal !== null && stats.swapUsed !== null;
  const swapFree =
    hasSwap ? Math.max(0, (stats.swapTotal ?? 0) - (stats.swapUsed ?? 0)) : 0;

  if (!hasMem) {
    return (
      <div className="text-[11.5px] text-muted-foreground">
        Memoria detallada no disponible en este host.
      </div>
    );
  }

  const used = stats.memUsed ?? 0;
  const buffers = stats.memBuffers ?? 0;
  const cached = stats.memCached ?? 0;
  const free = Math.max(0, totalMb - used - buffers - cached);
  const pct = (n: number) => Math.min(100, Math.max(0, (n / totalMb) * 100));
  const swapTotal = stats.swapTotal ?? 0;
  const swapUsed = stats.swapUsed ?? 0;
  const swapPct =
    swapTotal > 0 ? Math.min(100, Math.max(0, (swapUsed / swapTotal) * 100)) : 0;

  return (
    <div className="space-y-3">
      <p className="text-[13px] font-semibold text-foreground">
        Detalles de memoria
      </p>

      <div>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
          <Segment pct={pct(used)} className="bg-emerald-500" />
          <Segment pct={pct(buffers)} className="bg-blue-500" />
          <Segment pct={pct(cached)} className="bg-amber-500" />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/80">
          <span className="flex items-center gap-1">
            <LegendDot className="bg-emerald-500" /> Usado: {gb(used)}
          </span>
          <span className="flex items-center gap-1">
            <LegendDot className="bg-blue-500" /> Buffers: {gb(buffers)}
          </span>
          <span className="flex items-center gap-1">
            <LegendDot className="bg-amber-500" /> Caché: {gb(cached)}
          </span>
          <span className="flex items-center gap-1">
            <LegendDot className="bg-white/25" /> Libre: {gb(free)}
          </span>
        </div>
      </div>

      {hasSwap && (
        <div>
          <p className="mb-1 text-[12px] font-medium text-foreground/90">Swap</p>
          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <Segment pct={swapPct} className="bg-rose-500" />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-foreground/80">
            <span className="flex items-center gap-1">
              <LegendDot className="bg-rose-500" /> Swap usado: {gb(swapUsed)}
            </span>
            <span className="flex items-center gap-1">
              <LegendDot className="bg-white/25" /> Swap libre: {gb(swapFree)}
            </span>
            <span className="text-foreground/60">Total: {gb(swapTotal)}</span>
          </div>
        </div>
      )}

      {stats.topProcs.length > 0 && (
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-foreground/90">
            Procesos principales por memoria
          </p>
          <div className="space-y-1">
            {stats.topProcs.map((p) => (
              <div key={`${p.name}-${p.pct}`} className="flex items-center gap-2 text-[11px]">
                <span className="w-9 shrink-0 text-right text-foreground/60 tabular-nums">
                  {p.pct.toFixed(1)}%
                </span>
                <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-emerald-500"
                    style={{ width: `${Math.min(100, p.pct * 5)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 truncate text-right text-foreground/80">
                  {p.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
