import { describe, expect, it } from "vitest";
import type { PaneNode } from "@/modules/terminal/lib/panes";
import {
  canGraftSplit,
  isWorkspaceTree,
  paneStripStyle,
  resolveSplitTarget,
  windowStripStyle,
  zoneForPoint,
} from "./splitDrop";

const rect = { left: 0, top: 0, width: 1000, height: 800 };

describe("zoneForPoint", () => {
  it("resolves the four edge zones", () => {
    expect(zoneForPoint(rect, 50, 400)).toEqual({ dir: "row", before: true });
    expect(zoneForPoint(rect, 950, 400)).toEqual({ dir: "row", before: false });
    expect(zoneForPoint(rect, 500, 40)).toEqual({ dir: "col", before: true });
    expect(zoneForPoint(rect, 500, 760)).toEqual({ dir: "col", before: false });
  });

  it("defaults the center to a right-side split", () => {
    expect(zoneForPoint(rect, 500, 400)).toEqual({ dir: "row", before: false });
  });

  it("returns null outside the rect or for empty rects", () => {
    expect(zoneForPoint(rect, -1, 400)).toBeNull();
    expect(zoneForPoint(rect, 1000, 400)).toBeNull();
    expect(zoneForPoint(rect, 500, 800)).toBeNull();
    expect(zoneForPoint({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBeNull();
  });
});

describe("resolveSplitTarget", () => {
  const content = { left: 0, top: 0, width: 1000, height: 800 };
  const panes = [
    { leafId: 1, rect: { left: 0, top: 0, width: 500, height: 800 } },
    { leafId: 2, rect: { left: 500, top: 0, width: 500, height: 800 } },
  ];

  it("targets the pane under the pointer with a pane-level zone", () => {
    const at = resolveSplitTarget(content, panes, 750, 700);
    expect(at).toMatchObject({
      leafId: 2,
      windowLevel: false,
      zone: { dir: "col", before: false },
    });
    expect(at?.targetRect).toEqual(panes[1].rect);
  });

  it("prefers a window-level split at the outer content edge", () => {
    // Bottom edge spans both panes: whole-window highlight, root graft.
    const at = resolveSplitTarget(content, panes, 250, 795);
    expect(at).toMatchObject({
      leafId: null,
      windowLevel: true,
      zone: { dir: "col", before: false },
    });
    expect(at?.targetRect).toEqual(content);
  });

  it("returns null outside the content or over gaps", () => {
    expect(resolveSplitTarget(content, panes, -1, 400)).toBeNull();
    expect(resolveSplitTarget(content, [], 500, 400)).toBeNull();
  });
});

describe("drop strip geometry", () => {
  it("spans the full edge for window-level targets", () => {
    expect(windowStripStyle({ dir: "col", before: false }, rect)).toEqual({
      left: 0,
      top: 400,
      width: 1000,
      height: 400,
    });
    expect(windowStripStyle({ dir: "row", before: true }, rect)).toEqual({
      left: 0,
      top: 0,
      width: 500,
      height: 800,
    });
  });

  it("insets the strip inside a pane-level target", () => {
    // Stacked bottom pane spanning the full width: the strip must sit
    // inside the pane, narrower and shorter than the whole window edge.
    const pane = { left: 0, top: 400, width: 1000, height: 400 };
    expect(paneStripStyle({ dir: "col", before: false }, pane)).toEqual({
      left: 6,
      top: 606,
      width: 988,
      height: 188,
    });
    // Side-by-side left pane, left edge: inset on every side.
    const side = { left: 0, top: 0, width: 500, height: 800 };
    expect(paneStripStyle({ dir: "row", before: true }, side)).toEqual({
      left: 6,
      top: 6,
      width: 238,
      height: 788,
    });
  });

  it("clamps degenerate strips instead of going negative", () => {
    const tiny = { left: 0, top: 0, width: 8, height: 8 };
    const strip = paneStripStyle({ dir: "row", before: true }, tiny);
    expect(strip.width).toBe(0);
    expect(strip.height).toBe(0);
  });
});

describe("canGraftSplit", () => {
  const local = { id: 1, kind: "terminal" };
  const remote = { id: 2, kind: "terminal" };

  it("allows terminal to terminal within the pane cap", () => {
    expect(canGraftSplit(local, 1, remote, 1, 9)).toBe(true);
    expect(canGraftSplit(local, 3, remote, 6, 9)).toBe(true);
  });

  it("rejects over-cap grafts, self drops, non-terminal and blocks tabs", () => {
    expect(canGraftSplit(local, 5, remote, 5, 9)).toBe(false);
    expect(canGraftSplit(local, 1, local, 1, 9)).toBe(false);
    expect(canGraftSplit({ id: 3, kind: "editor" }, 1, remote, 1, 9)).toBe(false);
    expect(canGraftSplit(local, 1, { id: 4, kind: "preview" }, 1, 9)).toBe(false);
    expect(
      canGraftSplit({ ...local, blocks: true }, 1, remote, 1, 9),
    ).toBe(false);
    expect(
      canGraftSplit(local, 1, { ...remote, blocks: true }, 1, 9),
    ).toBe(false);
    expect(canGraftSplit(local, 0, remote, 1, 9)).toBe(false);
  });
});

describe("isWorkspaceTree", () => {
  const tree: PaneNode = {
    kind: "split",
    id: 7,
    dir: "row",
    children: [
      { kind: "leaf", id: 1 },
      { kind: "leaf", id: 2 },
    ],
  };
  const keys = (id: number) => (id === 1 ? "local" : "ssh:abc");

  it("detects mixed connections", () => {
    expect(isWorkspaceTree(tree, keys)).toBe(true);
  });

  it("stays false for a single connection", () => {
    expect(isWorkspaceTree(tree, () => "local")).toBe(false);
    expect(
      isWorkspaceTree({ kind: "leaf", id: 1 }, keys),
    ).toBe(false);
  });
});
