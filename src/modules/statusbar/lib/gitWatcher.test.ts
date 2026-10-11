import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  buildWatcherInstall,
  buildWatcherKill,
  ensureGitWatcher,
  parseGitEventLine,
  stopGitWatcher,
} from "./gitWatcher";

const SEP = "\x1f";
const line = (tok: string, cwd: string, branch: string, stat: string) =>
  `GIT${SEP}${tok}${SEP}${cwd}${SEP}${branch}${SEP}${stat}`;

describe("parseGitEventLine", () => {
  it("parses a well-formed daemon line", () => {
    expect(parseGitEventLine(line("7", "/r/repo", "main", "1 file changed"), 7)).toEqual({
      sshId: 7,
      cwd: "/r/repo",
      branch: "main",
      shortstat: "1 file changed",
    });
  });

  it("maps empty cwd/branch to null (non-repo, undetectable)", () => {
    expect(parseGitEventLine(line("7", "", "", ""), 7)).toEqual({
      sshId: 7,
      cwd: null,
      branch: null,
      shortstat: "",
    });
  });

  it("rejects other tokens, other lines and torn lines", () => {
    expect(parseGitEventLine(line("8", "/r", "main", ""), 7)).toBeNull();
    expect(parseGitEventLine("hello", 7)).toBeNull();
    expect(parseGitEventLine(`GIT${SEP}7${SEP}/r`, 7)).toBeNull();
    expect(parseGitEventLine("", 7)).toBeNull();
  });
});

describe("buildWatcherInstall", () => {
  it("substitutes the token, quotes the heredoc and echoes the pid", () => {
    const cmd = buildWatcherInstall(41, "abc9");
    expect(cmd).not.toContain("__TERAX_TOKEN__");
    expect(cmd).toContain('TERAX_TOK="41"');
    expect(cmd).toContain("<<'TERAX_GIT_WATCH_EOF'");
    expect(cmd).toContain(".terax-git-watch-41-abc9.sh");
    expect(cmd.trimEnd().endsWith("echo $!")).toBe(true);
    // The daemon outlives its installer channel, so the connection sshd
    // pid is baked as argv (runtime $PPID would be stale after reparent).
    expect(cmd).toContain('"$PPID"');
    expect(cmd).toContain('TERAX_SSHD="$1"');
    // The printf separator must be a visible octal escape (remote printf
    // interprets it), never a raw control byte.
    expect(cmd).toContain("GIT\\037%s");
    expect(cmd).not.toMatch(/GIT\x1f/);
  });
});

describe("buildWatcherKill", () => {
  it("guards the kill with a /proc cmdline identity check", () => {
    const cmd = buildWatcherKill(41, "abc9", 555);
    expect(cmd).toContain("TERAX_PID=555");
    expect(cmd).toContain('grep -q "terax-git-watch" "/proc/$TERAX_PID/cmdline"');
    expect(cmd).toContain('rm -f "$HOME/.terax-git-watch-41-abc9.sh"');
    expect(cmd.trimEnd().endsWith("true")).toBe(true);
  });
});

describe("ensure/stopGitWatcher", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("installs, launches (pid from stdout) and tails; idempotent", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ssh_exec") return Promise.resolve({ stdout: "12345\n" });
      if (cmd === "ssh_tail_start") return Promise.resolve(99);
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    expect(await ensureGitWatcher(41)).toBe(true);
    expect(await ensureGitWatcher(41)).toBe(true);
    const execCalls = invokeMock.mock.calls.filter((c) => c[0] === "ssh_exec");
    expect(execCalls).toHaveLength(1);
    expect(String(execCalls[0][1].command)).toContain('TERAX_TOK="41"');
    expect(invokeMock.mock.calls.filter((c) => c[0] === "ssh_tail_start")).toHaveLength(1);
  });

  it("returns false when the pid is unparseable or the tail fails", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ssh_exec") return Promise.resolve({ stdout: "nope\n" });
      return Promise.reject(new Error("nope"));
    });
    expect(await ensureGitWatcher(42)).toBe(false);

    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ssh_exec") return Promise.resolve({ stdout: "77\n" });
      if (cmd === "ssh_tail_start") return Promise.reject(new Error("denied"));
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    expect(await ensureGitWatcher(43)).toBe(false);
  });

  it("cleans up partial success: tail without daemon gets stopped", async () => {
    // Install succeeds (pid 78) but the tail is refused: ensure must kill
    // the orphan daemon instead of leaving it running unread.
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ssh_exec") return Promise.resolve({ stdout: "78\n" });
      if (cmd === "ssh_tail_start") return Promise.reject(new Error("denied"));
      if (cmd === "ssh_tail_stop") return Promise.resolve({});
      return Promise.reject(new Error(`unexpected ${cmd}`));
    });
    expect(await ensureGitWatcher(45)).toBe(false);
    const killExec = invokeMock.mock.calls.find(
      (c) => c[0] === "ssh_exec" && String(c[1].command).includes("TERAX_PID=78"),
    );
    expect(killExec).toBeDefined();
  });

  it("stop kills by pid, removes the script and stops the tail", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ssh_exec") return Promise.resolve({ stdout: "555\n" });
      if (cmd === "ssh_tail_start") return Promise.resolve(100);
      return Promise.resolve({});
    });
    expect(await ensureGitWatcher(44)).toBe(true);
    invokeMock.mockClear();
    invokeMock.mockResolvedValue({});
    await stopGitWatcher(44);
    const stopExec = invokeMock.mock.calls.find((c) => c[0] === "ssh_exec");
    expect(String(stopExec?.[1].command)).toContain("TERAX_PID=555");
    expect(String(stopExec?.[1].command)).toContain(".terax-git-watch-44-");
    const tailStopCall = invokeMock.mock.calls.find((c) => c[0] === "ssh_tail_stop");
    expect(tailStopCall?.[1]).toEqual({ tailId: 100 });
    // Second stop is a no-op.
    invokeMock.mockClear();
    await stopGitWatcher(44);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
