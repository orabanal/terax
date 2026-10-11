import { describe, expect, it } from "vitest";
import type { SshHost } from "@/modules/ssh/store";
import type { Tab, TerminalTab } from "./useTabs";
import {
  collectSshHostIds,
  deserializeTabs,
  MAX_SNAPSHOT_TABS,
  maxUsedId,
  sanitizeSnapshotCwd,
  serializeTabs,
  SESSIONS_VERSION,
  type ResolvedHost,
  type SessionsSnapshot,
} from "./sessions";

const HOST: SshHost = {
  id: "host-1",
  name: "prod",
  host: "example.com",
  port: 22,
  username: "dev",
  authType: "key",
};

const resolveHost = (id: string): ResolvedHost | undefined =>
  id === HOST.id ? { ...HOST } : undefined;

function restored(
  snap: SessionsSnapshot,
  resolve: (id: string) => ResolvedHost | undefined = resolveHost,
) {
  const out = deserializeTabs(snap, resolve);
  if (!out) throw new Error("expected snapshot to restore");
  return out;
}

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: 2, cwd: "/home/dev" },
    activeLeafId: 2,
    ...over,
  };
}

describe("serializeTabs", () => {
  it("snapshots a terminal leaf with cwd and active index", () => {
    const tabs: Tab[] = [
      terminalTab({
        id: 1,
        paneTree: {
          kind: "split",
          id: 10,
          dir: "row",
          children: [
            { kind: "leaf", id: 11, cwd: "/a" },
            { kind: "leaf", id: 12, cwd: "/b" },
          ],
        },
        activeLeafId: 12,
        customTitle: "mine",
      }),
    ];
    expect(serializeTabs(tabs)).toEqual([
      {
        kind: "terminal",
        title: "mine",
        customTitle: "mine",
        panes: {
          kind: "split",
          dir: "row",
          children: [
            { kind: "leaf", leaf: { cwd: "/a" } },
            { kind: "leaf", leaf: { cwd: "/b" } },
          ],
        },
        activeLeafIndex: 1,
      },
    ]);
  });

  it("keeps ssh identity and command, drops nothing sensitive", () => {
    const tabs: Tab[] = [
      terminalTab({
        sshHostId: HOST.id,
        sshHost: { ...HOST, password: "secret-never-stored" },
        command: ["ssh", " elsewhere"],
      }),
    ];
    const snap = serializeTabs(tabs);
    expect(snap[0]).toMatchObject({
      kind: "terminal",
      sshHostId: HOST.id,
      panes: {
        kind: "leaf",
        leaf: { sshHostId: HOST.id, command: ["ssh", " elsewhere"] },
      },
    });
    expect(JSON.stringify(snap)).not.toContain("secret-never-stored");
  });

  it("keeps persistent editors, previews, markdown; skips transient tabs", () => {
    const tabs: Tab[] = [
      {
        id: 1,
        kind: "editor",
        title: "a.ts",
        path: "/r/a.ts",
        dirty: true,
        preview: false,
      },
      {
        id: 2,
        kind: "editor",
        title: "b.ts",
        path: "/r/b.ts",
        dirty: false,
        preview: true,
      },
      { id: 3, kind: "preview", title: "x", url: "https://x.test" },
      { id: 4, kind: "markdown", title: "r", path: "/r/README.md" },
      {
        id: 5,
        kind: "ai-diff",
        title: "d",
        path: "/r/a.ts",
        originalContent: "",
        proposedContent: "x",
        approvalId: "dead-after-restart",
        status: "pending",
        isNewFile: false,
      },
      {
        id: 6,
        kind: "git-history",
        title: "h",
        repoRoot: "/r",
      },
      { id: 7, kind: "sftp", title: "SFTP" },
    ];
    expect(serializeTabs(tabs)).toEqual([
      { kind: "editor", path: "/r/a.ts" },
      { kind: "preview", url: "https://x.test" },
      { kind: "markdown", path: "/r/README.md" },
    ]);
  });

  it("stores remote cwd sanitized, without quotes", () => {
    const tabs: Tab[] = [
      terminalTab({
        sshHostId: HOST.id,
        paneTree: { kind: "leaf", id: 2, cwd: "'/ruta/rutab'" },
      }),
    ];
    expect(serializeTabs(tabs)).toEqual([
      {
        kind: "terminal",
        title: "shell",
        sshHostId: HOST.id,
        panes: {
          kind: "leaf",
          leaf: { sshHostId: HOST.id, cwd: "/ruta/rutab" },
        },
        activeLeafIndex: 0,
      },
    ]);
  });

  it("caps runaway tab counts", () => {
    const tabs: Tab[] = Array.from({ length: MAX_SNAPSHOT_TABS + 5 }, (_, i) =>
      terminalTab({ id: 100 + i }),
    );
    expect(serializeTabs(tabs)).toHaveLength(MAX_SNAPSHOT_TABS);
  });
});

describe("deserializeTabs", () => {
  const snap: SessionsSnapshot = {
    version: SESSIONS_VERSION,
    activeIndex: 1,
    tabs: [
      {
        kind: "terminal",
        title: "shell",
        panes: {
          kind: "split",
          dir: "col",
          children: [
            { kind: "leaf", leaf: { cwd: "/a", sshHostId: HOST.id } },
            { kind: "leaf", leaf: { cwd: "/b" } },
          ],
        },
        activeLeafIndex: 1,
        sshHostId: HOST.id,
      },
      { kind: "editor", path: "/r/a.ts" },
    ],
  };

  it("rebuilds frames with fresh ids, structure and seeds", () => {
    const out = restored(snap);
    const term = out.tabs[0];
    expect(term.kind).toBe("terminal");
    if (term.kind !== "terminal") return;
    // Fresh ids, none of the snapshot's (snapshots carry no ids at all).
    expect(term.id).toBeGreaterThan(0);
    expect(term.paneTree).toEqual({
      kind: "split",
      id: expect.any(Number),
      dir: "col",
      children: [
        { kind: "leaf", id: expect.any(Number), cwd: "/a" },
        { kind: "leaf", id: expect.any(Number), cwd: "/b" },
      ],
    });
    // Active leaf follows the snapshot index.
    const order =
      term.paneTree.kind === "split"
        ? term.paneTree.children.map((c) => (c.kind === "leaf" ? c.id : -1))
        : [];
    expect(term.activeLeafId).toBe(order[1]);
    // Tab-level host for icon/title; per-leaf seeds for dialing.
    expect(term.sshHostId).toBe(HOST.id);
    expect(term.sshHost?.id).toBe(HOST.id);
    expect(out.seeds).toHaveLength(2);
    expect(out.seeds[0]).toMatchObject({ cwd: "/a" });
    expect(out.seeds[0]?.sshHost?.id).toBe(HOST.id);
    expect(out.seeds[1]).toMatchObject({ cwd: "/b" });
    expect(out.seeds[1]?.sshHost).toBeUndefined();
    // Active tab follows the snapshot position.
    expect(out.activeId).toBe(out.tabs[1]?.id);
    // maxId covers every id handed out.
    expect(out.maxId).toBeGreaterThanOrEqual(maxUsedId(out.tabs));
  });

  it("drops unknown hosts from seeds but keeps the frame", () => {
    const out = restored(snap, () => undefined);
    const term = out.tabs[0];
    expect(term.kind).toBe("terminal");
    if (term.kind !== "terminal") return;
    expect(term.sshHost).toBeUndefined();
    expect(out.seeds[0]?.sshHost).toBeUndefined();
    // Tab-level sshHostId stays so the tab still reads as SSH.
    expect(term.sshHostId).toBe(HOST.id);
  });

  it("rejects empty, wrong-version and garbage snapshots", () => {
    expect(
      deserializeTabs({ version: SESSIONS_VERSION, tabs: [], activeIndex: 0 }, resolveHost),
    ).toBeNull();
    expect(
      deserializeTabs({ version: 999, tabs: snap.tabs, activeIndex: 0 }, resolveHost),
    ).toBeNull();
    expect(
      deserializeTabs(
        {
          version: SESSIONS_VERSION,
          activeIndex: 5,
          tabs: [{ kind: "bogus" } as unknown as never, ...snap.tabs],
        } as SessionsSnapshot,
        resolveHost,
      )?.tabs,
    ).toHaveLength(2);
  });

  it("clamps an out-of-range active index", () => {
    const out = restored({ ...snap, activeIndex: 99 });
    const last = out.tabs[out.tabs.length - 1];
    expect(out.activeId).toBe(last?.id);
  });
});

describe("maxUsedId", () => {
  it("covers tabs, splits and leaves", () => {
    expect(
      maxUsedId([
        terminalTab({
          id: 7,
          paneTree: {
            kind: "split",
            id: 40,
            dir: "row",
            children: [
              { kind: "leaf", id: 9, cwd: "/a" },
              { kind: "leaf", id: 30 },
            ],
          },
          activeLeafId: 9,
        }),
      ]),
    ).toBe(40);
    expect(maxUsedId([])).toBe(0);
  });
});

describe("collectSshHostIds", () => {
  it("collects tab-level and per-leaf host ids, deduped", () => {
    expect(
      collectSshHostIds([
        {
          kind: "terminal",
          title: "a",
          sshHostId: "h1",
          panes: {
            kind: "split",
            dir: "row",
            children: [
              { kind: "leaf", leaf: { sshHostId: "h1" } },
              { kind: "leaf", leaf: { sshHostId: "h2", cwd: "/x" } },
              { kind: "leaf", leaf: {} },
            ],
          },
          activeLeafIndex: 0,
        },
        { kind: "editor", path: "/r/a.ts" },
      ]),
    ).toEqual(["h1", "h2"]);
  });

  it("returns empty when nothing references SSH", () => {
    expect(collectSshHostIds([{ kind: "editor", path: "/r/a.ts" }])).toEqual(
      [],
    );
  });
});

describe("sanitizeSnapshotCwd", () => {
  it("keeps plain paths untouched", () => {
    expect(sanitizeSnapshotCwd("/ruta/rutab")).toBe("/ruta/rutab");
    expect(sanitizeSnapshotCwd("C:\\Users\\dev")).toBe("C:\\Users\\dev");
  });

  it("strips one layer of matching surrounding quotes", () => {
    expect(sanitizeSnapshotCwd("'/ruta/rutab'")).toBe("/ruta/rutab");
    expect(sanitizeSnapshotCwd('"/ruta/rutab"')).toBe("/ruta/rutab");
    expect(sanitizeSnapshotCwd("  '/x'  ")).toBe("/x");
  });

  it("leaves unbalanced or inner quotes alone", () => {
    expect(sanitizeSnapshotCwd("'/ruta/rutab")).toBe("'/ruta/rutab");
    expect(sanitizeSnapshotCwd("/it's/x")).toBe("/it's/x");
  });

  it("returns null for empty results", () => {
    expect(sanitizeSnapshotCwd("")).toBeNull();
    expect(sanitizeSnapshotCwd("   ")).toBeNull();
    expect(sanitizeSnapshotCwd("''")).toBeNull();
  });
});
