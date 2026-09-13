import { describe, expect, it } from "vitest";
import {
  graftNode,
  graftRoot,
  soleOriginTitle,
  stampOriginTitle,
  type PaneNode,
} from "./panes";

const leaf = (id: number): PaneNode => ({ kind: "leaf", id });

describe("graftNode", () => {
  it("wraps a lone leaf into a split with the graft after it", () => {
    const out = graftNode(leaf(1), 1, "row", leaf(9), false, 50);
    expect(out).toEqual({
      kind: "split",
      id: 50,
      dir: "row",
      children: [leaf(1), leaf(9)],
    });
  });

  it("puts the graft first when before is true", () => {
    const out = graftNode(leaf(1), 1, "col", leaf(9), true, 50);
    expect(out).toEqual({
      kind: "split",
      id: 50,
      dir: "col",
      children: [leaf(9), leaf(1)],
    });
  });

  it("appends as sibling in a same-direction split", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 7,
      dir: "row",
      children: [leaf(1), leaf(2)],
    };
    const out = graftNode(tree, 1, "row", leaf(9), false, 50);
    expect(out).toEqual({
      kind: "split",
      id: 7,
      dir: "row",
      children: [leaf(1), leaf(9), leaf(2)],
    });
  });

  it("inserts before the target sibling when before is true", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 7,
      dir: "row",
      children: [leaf(1), leaf(2)],
    };
    const out = graftNode(tree, 2, "row", leaf(9), true, 50);
    expect(out).toEqual({
      kind: "split",
      id: 7,
      dir: "row",
      children: [leaf(1), leaf(9), leaf(2)],
    });
  });

  it("grafts a whole subtree preserving its shape and ids", () => {
    const graft: PaneNode = {
      kind: "split",
      id: 8,
      dir: "col",
      children: [leaf(9), leaf(10)],
    };
    const out = graftNode(leaf(1), 1, "row", graft, false, 50);
    expect(out).toEqual({
      kind: "split",
      id: 50,
      dir: "row",
      children: [leaf(1), graft],
    });
  });

  it("leaves the tree untouched when the target is missing", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 7,
      dir: "row",
      children: [leaf(1), leaf(2)],
    };
    expect(graftNode(tree, 42, "row", leaf(9), false, 50)).toEqual(tree);
  });
});

describe("graftRoot", () => {
  it("wraps the whole tree so the graft lands beside every pane", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 7,
      dir: "row",
      children: [leaf(1), leaf(2)],
    };
    expect(graftRoot(tree, "col", leaf(9), false, 50)).toEqual({
      kind: "split",
      id: 50,
      dir: "col",
      children: [tree, leaf(9)],
    });
    expect(graftRoot(tree, "col", leaf(9), true, 50)).toEqual({
      kind: "split",
      id: 50,
      dir: "col",
      children: [leaf(9), tree],
    });
  });
});

describe("stampOriginTitle", () => {
  it("stamps leaves missing a stamp and keeps existing ones", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 7,
      dir: "row",
      children: [leaf(1), { kind: "leaf", id: 2, originTitle: "B" }],
    };
    expect(stampOriginTitle(tree, "A")).toEqual({
      kind: "split",
      id: 7,
      dir: "row",
      children: [
        { kind: "leaf", id: 1, originTitle: "A" },
        { kind: "leaf", id: 2, originTitle: "B" },
      ],
    });
  });
});

describe("soleOriginTitle", () => {
  it("returns the shared origin only when every leaf carries it", () => {
    const uniform: PaneNode = {
      kind: "split",
      id: 7,
      dir: "row",
      children: [
        { kind: "leaf", id: 1, originTitle: "B" },
        { kind: "leaf", id: 2, originTitle: "B" },
      ],
    };
    expect(soleOriginTitle(uniform)).toBe("B");
    expect(soleOriginTitle(leaf(1))).toBeNull();
    expect(
      soleOriginTitle({
        kind: "split",
        id: 7,
        dir: "row",
        children: [leaf(1), { kind: "leaf", id: 2, originTitle: "B" }],
      }),
    ).toBeNull();
    expect(
      soleOriginTitle({
        kind: "split",
        id: 7,
        dir: "row",
        children: [
          { kind: "leaf", id: 1, originTitle: "A" },
          { kind: "leaf", id: 2, originTitle: "B" },
        ],
      }),
    ).toBeNull();
  });
});
