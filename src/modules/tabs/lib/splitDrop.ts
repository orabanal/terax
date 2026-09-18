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

/** A pane under the pointer, with its rect in content coordinates. */
export type SplitPaneHit = {
  leafId: number;
  rect: SplitDropRect;
};

/** SplitPaneHit tagged with its owning tab, read from the DOM
 *  (`data-pane-tab` on the tab wrapper). */
export type OwnedSplitPaneHit = SplitPaneHit & {
  /** Owning tab id, or null when the pane sits outside a tab wrapper. */
  tabId: number | null;
};

/** Keep only panes owned by the drop-target tab. Hidden tabs stay mounted
 *  with `visibility: hidden` (which preserves layout and rects), so without
 *  this filter a background tab's panes win hit-testing and the drop
 *  silently degrades to a whole-window graft. */
export function panesForTargetTab(
  panes: OwnedSplitPaneHit[],
  targetId: number,
): SplitPaneHit[] {
  return panes
    .filter((p) => p.tabId === targetId)
    .map(({ leafId, rect }) => ({ leafId, rect }));
}

export type SplitDropTarget = {
  zone: SplitDropZone;
  /** Leaf to split, or `null` for a window-level (whole tree) split. */
  leafId: number | null;
  /** Rect the highlight strip is drawn from: the pane, or the whole content. */
  targetRect: SplitDropRect;
  windowLevel: boolean;
};

/** Pointer band (px) along the outer content edge that targets a
 *  window-level split spanning every pane. Inside a pane, edge bands split
 *  that pane only. */
export const WINDOW_EDGE_PX = 12;

/** Resolve a pointer position to a pane-level or window-level drop target.
 *  Returns `null` outside the content rect or over gaps between panes. */
export function resolveSplitTarget(
  contentRect: SplitDropRect,
  panes: SplitPaneHit[],
  x: number,
  y: number,
): SplitDropTarget | null {
  if (contentRect.width <= 0 || contentRect.height <= 0) return null;
  const rx = x - contentRect.left;
  const ry = y - contentRect.top;
  if (rx < 0 || rx >= contentRect.width || ry < 0 || ry >= contentRect.height) {
    return null;
  }
  const dOuter = Math.min(
    rx,
    contentRect.width - rx,
    ry,
    contentRect.height - ry,
  );
  if (dOuter < WINDOW_EDGE_PX) {
    const zone = zoneForPoint(contentRect, x, y);
    if (!zone) return null;
    return { zone, leafId: null, targetRect: contentRect, windowLevel: true };
  }
  const hit = panes.find(
    (p) =>
      x >= p.rect.left &&
      x < p.rect.left + p.rect.width &&
      y >= p.rect.top &&
      y < p.rect.top + p.rect.height,
  );
  if (!hit) return null;
  const zone = zoneForPoint(hit.rect, x, y);
  if (!zone) return null;
  return { zone, leafId: hit.leafId, targetRect: hit.rect, windowLevel: false };
}

type GraftTab = {
  id: number;
  kind: string;
  blocks?: boolean;
};

/** Inset (px) of a pane-level drop strip inside its target pane, so the
 *  strip reads as belonging to that pane and never spans the whole window. */
export const PANE_STRIP_INSET = 6;

/** Edge half of a rect: the drop strip for a window-level (whole content)
 *  target, spanning the full edge. */
export function windowStripStyle(
  zone: SplitDropZone,
  r: SplitDropRect,
): SplitDropRect {
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

/** Edge half of a target pane, pulled inside the pane by `PANE_STRIP_INSET`
 *  on every side. A stacked pane's bottom strip therefore sits visibly
 *  inside that pane instead of bleeding across the whole window. */
export function paneStripStyle(
  zone: SplitDropZone,
  r: SplitDropRect,
  inset: number = PANE_STRIP_INSET,
): SplitDropRect {
  const base = windowStripStyle(zone, r);
  return {
    left: base.left + inset,
    top: base.top + inset,
    width: Math.max(0, base.width - inset * 2),
    height: Math.max(0, base.height - inset * 2),
  };
}

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
