import { cn } from "@/lib/utils";
import type { SplitDropRect, SplitDropZone } from "./lib/splitDrop";

type Props = {
  zone: SplitDropZone;
  valid: boolean;
  /** Target rect (pane or whole content), relative to the content container. */
  highlight: SplitDropRect;
  windowLevel: boolean;
};

const EDGE_LABEL: Record<string, string> = {
  "row-true": "izquierda",
  "row-false": "derecha",
  "col-true": "arriba",
  "col-false": "abajo",
};

/** Half of the target rect at the drop edge, in content coordinates. */
function stripStyle(
  zone: SplitDropZone,
  r: SplitDropRect,
): { left: number; top: number; width: number; height: number } {
  if (zone.dir === "row") {
    const w = Math.max(0, r.width / 2);
    return {
      left: zone.before ? r.left : r.left + r.width - w,
      top: r.top,
      width: w,
      height: r.height,
    };
  }
  const h = Math.max(0, r.height / 2);
  return {
    left: r.left,
    top: zone.before ? r.top : r.top + r.height - h,
    width: r.width,
    height: h,
  };
}

/** Drop highlight while a tab is dragged over the content area. The strip
 *  hugs the hovered pane's edge (pane-level split) or spans the whole
 *  window edge (window-level split), so the landing spot is unambiguous.
 *  Pointer-events free so the terminal underneath keeps working; the drop
 *  itself is resolved by coordinates on mouseup. */
export function SplitDropOverlay({ zone, valid, highlight, windowLevel }: Props) {
  const strip = stripStyle(zone, highlight);
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        className={cn(
          "absolute inset-0",
          valid ? "bg-primary/5" : "bg-destructive/5",
        )}
      />
      <div
        className={cn(
          "absolute rounded-md border-2 border-dashed",
          valid ? "border-primary/70 bg-primary/15" : "border-destructive/50 bg-destructive/10",
        )}
        style={{
          left: strip.left,
          top: strip.top,
          width: strip.width,
          height: strip.height,
        }}
      />
      <div className="absolute inset-x-0 top-3 flex justify-center">
        <span
          className={cn(
            "rounded-md px-2.5 py-1 text-[11px] font-medium shadow-lg ring-1 backdrop-blur-sm",
            valid
              ? "bg-card/95 text-foreground ring-border/50"
              : "bg-card/95 text-destructive ring-destructive/40",
          )}
        >
          {valid
            ? `${windowLevel ? "Dividir ventana" : "Dividir panel"}: ${EDGE_LABEL[`${zone.dir}-${zone.before}`]}`
            : "No se puede soltar aqui"}
        </span>
      </div>
    </div>
  );
}
