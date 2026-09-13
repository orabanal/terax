import {
  leafIds,
  type PaneNode,
  type SplitDir,
} from "@/modules/terminal/lib/panes";
import { getLeafConnectionKey } from "@/modules/terminal/lib/useTerminalSession";

/** Drop position of a dragged tab inside the content area. `before` puts the
 *  moved panes first (left/top drops). */
export type SplitDropZone = {
  dir: SplitDir;
  before: boolean;
};

export type SplitDropRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

/** Fraction of each edge that counts as an edge zone; the middle resolves to
 *  a right-side split. */
const EDGE_BAND = 0.28;

/** Map a pointer position to a split zone, or `null` when outside `rect`. */
export function zoneForPoint(
  rect: SplitDropRect,
  x: number,
  y: number,
): SplitDropZone | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const rx = (x - rect.left) / rect.width;
  const ry = (y - rect.top) / rect.height;
  if (rx < 0 || rx >= 1 || ry < 0 || ry >= 1) return null;
  const dLeft = rx;
  const dRight = 1 - rx;
  const dTop = ry;
  const dBottom = 1 - ry;
  const nearest = Math.min(dLeft, dRight, dTop, dBottom);
  if (nearest > EDGE_BAND) return { dir: "row", before: false };
  if (dLeft <= dRight && dLeft <= dTop && dLeft <= dBottom) {
    return { dir: "row", before: true };
  }
  if (dRight <= dLeft && dRight <= dTop && dRight <= dBottom) {
    return { dir: "row", before: false };
  }
  if (dTop <= dLeft && dTop <= dRight && dTop <= dBottom) {
    return { dir: "col", before: true };
  }
  return { dir: "col", before: false };
}

type GraftTab = {
  id: number;
  kind: string;
  blocks?: boolean;
};

/** Whether a whole tab's panes may be grafted into another tab's split tree.
 *  Sessions travel with their leaf ids, so mixed connections are supported;
 *  block-mode tabs are excluded on both sides. */export function canGraftSplit(
  source: GraftTab,
  sourceLeafCount: number,
  target: GraftTab,
  targetLeafCount: number,
  maxPanes: number,
): boolean {
  if (source.kind !== "terminal" || target.kind !== "terminal") return false;
  if (source.id === target.id) return false;
  if (source.blocks || target.blocks) return false;
  if (sourceLeafCount < 1) return false;
  return targetLeafCount + sourceLeafCount <= maxPanes;
}

/** True when a pane tree hosts leaves from more than one connection
 *  (local vs SSH hosts vs custom commands). Mixed tabs render as
 *  "Workspace"; the check is dynamic, so detaching back to a single
 *  connection restores the regular name. `getKey` is injectable for tests. */
export function isWorkspaceTree(
  tree: PaneNode,
  getKey: (leafId: number) => string = getLeafConnectionKey,
): boolean {
  const keys = new Set<number | string>();
  for (const id of leafIds(tree)) keys.add(getKey(id));
  return keys.size > 1;
}
