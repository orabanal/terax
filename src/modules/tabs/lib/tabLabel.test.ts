import { describe, expect, it } from "vitest";
import { labelFor } from "./tabLabel";
import type { TerminalTab } from "./useTabs";

function terminalTab(over: Partial<TerminalTab> = {}): TerminalTab {
  return {
    id: 1,
    kind: "terminal",
    title: "shell",
    paneTree: { kind: "leaf", id: 2 },
    activeLeafId: 2,
    ...over,
  };
}

describe("labelFor (terminal tabs)", () => {
  it("derives the label from the last cwd segment", () => {
    expect(labelFor(terminalTab({ cwd: "/Users/me/projects/terax-ai" }))).toBe(
      "terax-ai",
    );
  });

  it("falls back to the title when there is no cwd", () => {
    expect(labelFor(terminalTab({ title: "private" }))).toBe("private");
  });

  it("prefers a custom title over the cwd-derived name", () => {
    expect(
      labelFor(terminalTab({ cwd: "/Users/me/projects/terax-ai", customTitle: "Server" })),
    ).toBe("Server");
  });

  it("keeps the custom title after the cwd changes (survives cd)", () => {
    const renamed = terminalTab({ cwd: "/Users/me/a", customTitle: "Server" });
    const afterCd = { ...renamed, cwd: "/Users/me/b/c" };
    expect(labelFor(afterCd)).toBe("Server");
  });

  it("handles Windows-style cwd separators", () => {
    expect(labelFor(terminalTab({ cwd: "C:\\Users\\me\\proj" }))).toBe("proj");
  });
});

describe("labelFor static titles (dynamic: false)", () => {
  it("keeps the stored title regardless of cwd", () => {
    const tab = terminalTab({ title: "shell", cwd: "/Users/me/a" });
    expect(labelFor(tab, { dynamic: false })).toBe("shell");
    expect(labelFor({ ...tab, cwd: "/Users/me/b/c" }, { dynamic: false })).toBe(
      "shell",
    );
  });

  it("keeps SSH host names instead of remote directories", () => {
    const tab = terminalTab({
      title: "prod",
      sshHostId: "host-1",
      cwd: "/home/dev/repo",
    });
    expect(labelFor(tab, { dynamic: false })).toBe("prod");
  });

  it("still prefers custom titles and the workspace marker", () => {
    const renamed = terminalTab({ title: "shell", customTitle: "Server" });
    expect(labelFor(renamed, { dynamic: false })).toBe("Server");
    expect(
      labelFor(terminalTab({ title: "shell" }), {
        workspace: true,
        dynamic: false,
      }),
    ).toBe("Workspace");
  });

  it("dynamic: true behaves like the default", () => {
    const tab = terminalTab({
      title: "shell",
      cwd: "/Users/me/projects/terax-ai",
    });
    expect(labelFor(tab, { dynamic: true })).toBe(
      labelFor(tab),
    );
  });
});

describe("labelFor workspace marker", () => {
  it("shows Workspace for mixed-connection tabs without a custom title", () => {
    expect(
      labelFor(terminalTab({ cwd: "/Users/me/proj" }), { workspace: true }),
    ).toBe("Workspace");
  });

  it("still prefers a custom title over the workspace marker", () => {
    expect(
      labelFor(terminalTab({ customTitle: "DB" }), { workspace: true }),
    ).toBe("DB");
  });

  it("ignores a false workspace flag", () => {
    expect(
      labelFor(terminalTab({ cwd: "/Users/me/proj" }), { workspace: false }),
    ).toBe("proj");
  });
});
