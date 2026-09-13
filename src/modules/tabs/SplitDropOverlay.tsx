import { cn } from "@/lib/utils";
import type { SplitDropZone } from "./lib/splitDrop";

type Props = {
  zone: SplitDropZone;
  valid: boolean;
};

const LABEL: Record<string, string> = {
  "row-true": "Soltar para dividir: izquierda",
  "row-false": "Soltar para dividir: derecha",
  "col-true": "Soltar para dividir: arriba",
  "col-false": "Soltar para dividir: abajo",
};

function highlightClass(zone: SplitDropZone): string {
  if (zone.dir === "row") {
    return zone.before
      ? "inset-y-0 left-0 w-1/2"
      : "inset-y-0 right-0 w-1/2";
  }
  return zone.before
    ? "inset-x-0 top-0 h-1/2"
    : "inset-x-0 bottom-0 h-1/2";
}

/** Quadrant highlight while a tab is dragged over the content area.
 *  Pointer-events free so the terminal underneath keeps working; the drop
 *  itself is resolved by coordinates on mouseup. */
export function SplitDropOverlay({ zone, valid }: Props) {
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
          highlightClass(zone),
          valid ? "border-primary/70 bg-primary/15" : "border-destructive/50 bg-destructive/10",
        )}
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
            ? LABEL[`${zone.dir}-${zone.before}`]
            : "No se puede soltar aqui"}
        </span>
      </div>
    </div>
  );
}
