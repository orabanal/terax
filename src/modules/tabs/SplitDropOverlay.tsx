import { cn } from "@/lib/utils";
import {
  paneStripStyle,
  windowStripStyle,
  type SplitDropRect,
  type SplitDropZone,
} from "./lib/splitDrop";

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

/** Drop highlight while a tab is dragged over the content area.
 *
 *  Window-level (outer 12px edge): the strip spans the whole window edge —
 *  the drop grafts against the entire tree.
 *
 *  Pane-level: a spotlight dims everything outside the target pane, the pane
 *  itself gets a solid outline, and the strip sits inset inside that pane —
 *  so "bottom of this panel" can never be mistaken for "bottom of the whole
 *  window", even when the pane spans the full width (stacked splits).
 *
 *  Pointer-events free so the terminal underneath keeps working; the drop
 *  itself is resolved by coordinates on mouseup. */
export function SplitDropOverlay({ zone, valid, highlight, windowLevel }: Props) {
  const strip = windowLevel
    ? windowStripStyle(zone, highlight)
    : paneStripStyle(zone, highlight);
  const tone = valid
    ? { dim: "bg-primary/5", edge: "border-primary/70 bg-primary/15" }
    : { dim: "bg-destructive/5", edge: "border-destructive/50 bg-destructive/10" };
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {windowLevel ? (
        <div className={cn("absolute inset-0", tone.dim)} />
      ) : (
        <div
          className={cn(
            "absolute rounded-md border-2",
            valid ? "border-primary/70" : "border-destructive/50",
          )}
          style={{
            left: highlight.left,
            top: highlight.top,
            width: highlight.width,
            height: highlight.height,
            boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.35)",
          }}
        />
      )}
      <div
        className={cn("absolute rounded-md border-2 border-dashed", tone.edge)}
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
