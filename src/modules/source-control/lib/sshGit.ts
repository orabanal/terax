import { invoke } from "@tauri-apps/api/core";
import type {
  GitChangedFile,
  GitCommitResult,
  GitDiscardEntry,
  GitDiffResult,
  GitPanelSnapshot,
  GitRepoInfo,
  GitStatusSnapshot,
} from "@/modules/ai/lib/native";

export type SshGitContext = { sshId: number; cwd: string; leafId: number };

type SshExecResult = { stdout: string; stderr: string; exitCode: number | null };

const TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("ssh_git timeout")), ms),
    ),
  ]);
}

async function exec(sshId: number, command: string): Promise<SshExecResult> {
  return withTimeout(
    invoke<SshExecResult>("ssh_exec", { id: sshId, command }),
    TIMEOUT_MS,
  );
}

function q(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

// Parses `git status --porcelain=v2 --branch` output plus a ROOT: prefix line.
function parseV2(stdout: string): {
  root: string;
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  isDetached: boolean;
  files: GitChangedFile[];
} | null {
  const lines = stdout.split("\n");
  let root = "";
  let branch = "";
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let isDetached = false;
  const files: GitChangedFile[] = [];

  for (const line of lines) {
    if (line.startsWith("ROOT:")) {
      root = line.slice(5).trim();
    } else if (line.startsWith("# branch.head ")) {
      branch = line.slice(14).trim();
      isDetached = branch === "(detached)";
      if (isDetached) branch = "HEAD";
    } else if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice(18).trim() || null;
    } else if (line.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        ahead = parseInt(m[1]);
        behind = parseInt(m[2]);
      }
    } else if (line.startsWith("1 ")) {
      // Ordinary changed: "1 XY sub mH mI mW hH hI path"
      const parts = line.split(" ");
      if (parts.length < 9) continue;
      const xy = parts[1];
      const path = parts.slice(8).join(" ");
      const idx = xy[0] === "." ? " " : xy[0];
      const wt = xy[1] === "." ? " " : xy[1];
      files.push({
        path,
        originalPath: null,
        indexStatus: idx,
        worktreeStatus: wt,
        staged: idx !== " ",
        unstaged: wt !== " ",
        untracked: false,
        statusLabel: labelFor(idx !== " " ? idx : wt),
      });
    } else if (line.startsWith("2 ")) {
      // Renamed/copied: "2 XY sub mH mI mW hH hI XScore newPath\torigPath"
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      const meta = line.slice(0, tab).split(" ");
      if (meta.length < 10) continue;
      const xy = meta[1];
      const newPath = meta.slice(9).join(" ");
      const origPath = line.slice(tab + 1);
      const idx = xy[0] === "." ? " " : xy[0];
      const wt = xy[1] === "." ? " " : xy[1];
      files.push({
        path: newPath,
        originalPath: origPath,
        indexStatus: idx,
        worktreeStatus: wt,
        staged: idx !== " ",
        unstaged: wt !== " ",
        untracked: false,
        statusLabel: "Renamed",
      });
    } else if (line.startsWith("? ")) {
      files.push({
        path: line.slice(2),
        originalPath: null,
        indexStatus: "?",
        worktreeStatus: "?",
        staged: false,
        unstaged: true,
        untracked: true,
        statusLabel: "Untracked",
      });
    } else if (line.startsWith("u ")) {
      // Unmerged conflict
      const parts = line.split(" ");
      const path = parts.slice(8).join(" ");
      files.push({
        path,
        originalPath: null,
        indexStatus: "U",
        worktreeStatus: "U",
        staged: false,
        unstaged: true,
        untracked: false,
        statusLabel: "Conflict",
      });
    }
  }

  if (!root) return null;
  return { root, branch, upstream, ahead, behind, isDetached, files };
}

function labelFor(code: string): string {
  switch (code) {
    case "M": return "Modified";
    case "A": return "Added";
    case "D": return "Deleted";
    case "R": return "Renamed";
    case "C": return "Copied";
    case "T": return "Type changed";
    case "U": return "Conflict";
    default: return "Modified";
  }
}

// Runs git status --porcelain=v2 --branch on the remote, returning both
// GitRepoInfo and GitStatusSnapshot (same shape as local native commands).
export async function sshGitPanelSnapshot(ctx: SshGitContext): Promise<GitPanelSnapshot> {
  const script = [
    `cd ${q(ctx.cwd)} 2>/dev/null || exit 0`,
    '_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0',
    'printf "ROOT:%s\\n" "$_root"',
    'git -C "$_root" status --porcelain=v2 --branch 2>/dev/null',
  ].join("; ");

  const result = await exec(ctx.sshId, script);
  if (!result.stdout.trim()) return { repo: null, status: null };

  const parsed = parseV2(result.stdout);
  if (!parsed) return { repo: null, status: null };

  const repo: GitRepoInfo = {
    repoRoot: parsed.root,
    branch: parsed.branch,
    upstream: parsed.upstream,
    isDetached: parsed.isDetached,
  };
  const status: GitStatusSnapshot = {
    repoRoot: parsed.root,
    branch: parsed.branch,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    isDetached: parsed.isDetached,
    truncated: false,
    changedFiles: parsed.files,
  };
  return { repo, status };
}

export async function sshGitStatus(ctx: SshGitContext, repoRoot: string): Promise<GitStatusSnapshot> {
  const script = [
    `printf "ROOT:%s\\n" ${q(repoRoot)}`,
    `git -C ${q(repoRoot)} status --porcelain=v2 --branch 2>/dev/null`,
  ].join("; ");

  const result = await exec(ctx.sshId, script);
  const parsed = parseV2(result.stdout);
  if (!parsed) throw new Error("git status failed");

  return {
    repoRoot: parsed.root,
    branch: parsed.branch,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    isDetached: parsed.isDetached,
    truncated: false,
    changedFiles: parsed.files,
  };
}

export async function sshGitStage(ctx: SshGitContext, repoRoot: string, paths: string[]): Promise<void> {
  const qpaths = paths.map(q).join(" ");
  const result = await exec(ctx.sshId, `git -C ${q(repoRoot)} add -- ${qpaths}`);
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "git add failed");
}

export async function sshGitUnstage(ctx: SshGitContext, repoRoot: string, paths: string[]): Promise<void> {
  const qpaths = paths.map(q).join(" ");
  const result = await exec(ctx.sshId, `git -C ${q(repoRoot)} restore --staged -- ${qpaths}`);
  if (result.exitCode !== 0) {
    // Fallback for git < 2.23
    const r2 = await exec(ctx.sshId, `git -C ${q(repoRoot)} reset HEAD -- ${qpaths}`);
    if (r2.exitCode !== 0) throw new Error(r2.stderr.trim() || "git restore --staged failed");
  }
}

export async function sshGitDiscard(
  ctx: SshGitContext,
  repoRoot: string,
  entries: GitDiscardEntry[],
): Promise<void> {
  const tracked = entries.filter((e) => !e.untracked).map((e) => e.path);
  const untracked = entries.filter((e) => e.untracked).map((e) => e.path);
  const cmds: string[] = [];
  if (tracked.length > 0) {
    cmds.push(`git -C ${q(repoRoot)} restore -- ${tracked.map(q).join(" ")}`);
  }
  if (untracked.length > 0) {
    cmds.push(`git -C ${q(repoRoot)} clean -f -- ${untracked.map(q).join(" ")}`);
  }
  if (cmds.length === 0) return;
  const result = await exec(ctx.sshId, cmds.join(" && "));
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "git discard failed");
}

export async function sshGitCommit(
  ctx: SshGitContext,
  repoRoot: string,
  message: string,
): Promise<GitCommitResult> {
  const result = await exec(
    ctx.sshId,
    `git -C ${q(repoRoot)} commit -m ${q(message)}`,
  );
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || "git commit failed");
  const shaMatch = /([0-9a-f]{40})/i.exec(result.stdout);
  // Extract summary from output like "[main abc1234] message"
  const summaryMatch = /\]\s+(.+)/.exec(result.stdout.split("\n")[0] ?? "");
  return {
    commitSha: shaMatch?.[1] ?? "",
    summary: summaryMatch?.[1]?.trim() ?? message.split("\n")[0],
  };
}

export async function sshGitFetch(ctx: SshGitContext, repoRoot: string): Promise<void> {
  const result = await exec(ctx.sshId, `git -C ${q(repoRoot)} fetch 2>&1`);
  if (result.exitCode !== 0)
    throw new Error(result.stdout.trim() || result.stderr.trim() || "git fetch failed");
}

export async function sshGitPullFfOnly(ctx: SshGitContext, repoRoot: string): Promise<void> {
  const result = await exec(ctx.sshId, `git -C ${q(repoRoot)} pull --ff-only 2>&1`);
  if (result.exitCode !== 0)
    throw new Error(result.stdout.trim() || result.stderr.trim() || "git pull --ff-only failed");
}

export async function sshGitPush(ctx: SshGitContext, repoRoot: string): Promise<void> {
  const result = await exec(ctx.sshId, `git -C ${q(repoRoot)} push 2>&1`);
  if (result.exitCode !== 0)
    throw new Error(result.stdout.trim() || result.stderr.trim() || "git push failed");
}

export async function sshGitDiffContent(
  ctx: SshGitContext,
  repoRoot: string,
  path: string,
  staged: boolean,
  originalPath: string | null,
): Promise<{ originalContent: string; modifiedContent: string; fallbackPatch: string; isBinary: boolean }> {
  const srcPath = originalPath ?? path;
  // Staged: HEAD vs index. Unstaged: HEAD vs working tree.
  const [originalResult, modifiedResult, patchResult] = await Promise.all([
    exec(ctx.sshId, `git -C ${q(repoRoot)} show HEAD:${q(srcPath)} 2>/dev/null`),
    staged
      ? exec(ctx.sshId, `git -C ${q(repoRoot)} show :${q(path)} 2>/dev/null`)
      : exec(ctx.sshId, `cat ${q(repoRoot)}/${q(path)} 2>/dev/null`),
    exec(ctx.sshId, `git -C ${q(repoRoot)} diff --no-color ${staged ? "--cached" : ""} -- ${q(path)} 2>/dev/null`),
  ]);
  return {
    originalContent: originalResult.stdout,
    modifiedContent: modifiedResult.stdout,
    fallbackPatch: patchResult.stdout,
    isBinary: false,
  };
}

export async function sshGitDiff(
  ctx: SshGitContext,
  repoRoot: string,
  path: string | null,
  staged: boolean,
): Promise<GitDiffResult> {
  const pathArg = path ? `-- ${q(path)}` : "";
  const stagedFlag = staged ? "--cached" : "";
  const cmd = `git -C ${q(repoRoot)} diff --no-color ${stagedFlag} HEAD ${pathArg} 2>/dev/null`;
  const result = await exec(ctx.sshId, cmd);
  return { diffText: result.stdout, truncated: false };
}
