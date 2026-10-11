import { describe, expect, it } from "vitest";
import type { Tab } from "@/modules/tabs";
import { collectSshLeaves } from "./sshLeaves";

function termTab(
  id: number,
  leafIds: number[],
  extra: Partial<Extract<Tab, { kind: "terminal" }>> = {},
): Tab {
  return {
    id,
    kind: "terminal",
    title: `tab-${id}`,
    activeLeafId: leafIds[0],
    paneTree:
      leafIds.length === 1
        ? { kind: "leaf", id: leafIds[0] }
        : {
            kind: "split",
            id: 1000 + id,
            dir: "row",
            children: leafIds.map((lid) => ({ kind: "leaf" as const, id: lid })),
          },
    ...extra,
  };
}

describe("collectSshLeaves", () => {
  it("finds SSH leaves in pure SSH tabs", () => {
    const tabs = [termTab(1, [11], { sshHostId: "h1" })];
    const out = collectSshLeaves(tabs, { hasSshSession: () => true });
    expect(out).toEqual([{ leafId: 11, tabId: 1 }]);
  });

  it("finds grafted SSH leaves inside local tabs (no tab sshHostId)", () => {
    // SSH pane grafted into a local tab: the tab carries no sshHostId,
    // but leaf 22 keeps its leaf-level SSH session.
    const tabs = [termTab(2, [21, 22])];
    const out = collectSshLeaves(tabs, {
      hasSshSession: (leafId) => leafId === 22,
    });
    expect(out).toEqual([{ leafId: 22, tabId: 2 }]);
  });

  it("skips local leaves and non-terminal tabs", () => {
    const tabs: Tab[] = [
      termTab(3, [31]),
      { id: 4, kind: "editor", title: "e", path: "/f", dirty: false, preview: false },
    ];
    expect(collectSshLeaves(tabs, { hasSshSession: () => false })).toEqual(
      [],
    );
  });
});
