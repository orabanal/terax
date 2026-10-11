import { describe, expect, it } from "vitest";
import {
  applyDiffCounts,
  gateSshFetch,
  mergeBranchSummary,
  parseSshBranch,
  parseSshCwd,
  shouldDeferRemoteFetch,
  SSH_STAGE1_BACKOFF_MS,
} from "./useGitSummary";

const BASE = {
  quietMs: 4_000,
  maxStaleMs: 60_000,
};

describe("shouldDeferRemoteFetch", () => {
  it("proceeds when output has been quiet", () => {
    expect(
      shouldDeferRemoteFetch({
        ...BASE,
        now: 100_000,
        lastActivityAt: 90_000,
        lastFetchAt: 90_000,
      }),
    ).toBe(false);
  });

  it("proceeds on first run (no activity or fetch recorded yet)", () => {
    expect(
      shouldDeferRemoteFetch({
        ...BASE,
        now: 100_000,
        lastActivityAt: 0,
        lastFetchAt: 0,
      }),
    ).toBe(false);
  });

  it("defers while the PTY is actively producing output", () => {
    // Agent streaming: activity 500ms ago, probe from 5s ago.
    expect(
      shouldDeferRemoteFetch({
        ...BASE,
        now: 100_000,
        lastActivityAt: 99_500,
        lastFetchAt: 95_000,
      }),
    ).toBe(true);
  });

  it("forces a probe through once the last fetch goes stale", () => {
    // Endless stream: activity is current but the probe is 61s old.
    expect(
      shouldDeferRemoteFetch({
        ...BASE,
        now: 100_000,
        lastActivityAt: 99_900,
        lastFetchAt: 39_000,
      }),
    ).toBe(false);
  });

  it("treats the exact quiet boundary as quiet", () => {
    expect(
      shouldDeferRemoteFetch({
        ...BASE,
        now: 100_000,
        lastActivityAt: 96_000,
        lastFetchAt: 90_000,
      }),
    ).toBe(false);
  });
});

describe("gateSshFetch", () => {
  it("skips while the agent is working and the probe is fresh", () => {
    expect(
      gateSshFetch({
        now: 100_000,
        agentBusy: true,
        lastActivityAt: 99_900,
        lastFetchAt: 95_000,
      }),
    ).toBe("skip");
  });

  it("runs the slow 30s backup poll while the agent works", () => {
    expect(
      gateSshFetch({
        now: 100_000,
        agentBusy: true,
        lastActivityAt: 99_900,
        lastFetchAt: 69_999,
      }),
    ).toBe("fetch");
  });

  it("treats the exact 30s backup boundary as due", () => {
    expect(
      gateSshFetch({
        now: 100_000,
        agentBusy: true,
        lastActivityAt: 99_900,
        lastFetchAt: 70_000,
      }),
    ).toBe("fetch");
  });

  it("defers on recent output once the agent releases the leaf", () => {
    expect(
      gateSshFetch({
        now: 100_000,
        agentBusy: false,
        lastActivityAt: 99_500,
        lastFetchAt: 95_000,
      }),
    ).toBe("defer");
  });

  it("fetches when idle and quiet", () => {
    expect(
      gateSshFetch({
        now: 100_000,
        agentBusy: false,
        lastActivityAt: 90_000,
        lastFetchAt: 90_000,
      }),
    ).toBe("fetch");
  });

  it("upgrades defer to fetch when the human moved (cd)", () => {
    expect(
      gateSshFetch({
        now: 100_000,
        agentBusy: false,
        lastActivityAt: 99_500,
        lastFetchAt: 95_000,
        cwdChanged: true,
      }),
    ).toBe("fetch");
  });

  it("keeps the working skip even on cd", () => {
    expect(
      gateSshFetch({
        now: 100_000,
        agentBusy: true,
        lastActivityAt: 99_500,
        lastFetchAt: 95_000,
        cwdChanged: true,
      }),
    ).toBe("skip");
  });
});

describe("parseSshCwd", () => {
  it("extracts the CWD line", () => {
    expect(parseSshCwd("CWD:/home/dev/repo\n")).toBe("/home/dev/repo");
  });

  it("finds CWD among other probe output", () => {
    expect(
      parseSshCwd("BRANCH:main\nCWD:/home/dev/repo\nSTAT:\n"),
    ).toBe("/home/dev/repo");
  });

  it("returns null when the line is missing or empty", () => {
    expect(parseSshCwd("")).toBeNull();
    expect(parseSshCwd("BRANCH:main\n")).toBeNull();
    expect(parseSshCwd("CWD:\n")).toBeNull();
    expect(parseSshCwd("CWD:   \n")).toBeNull();
  });
});

describe("stage-1 backoff while streaming", () => {
  // Stage 1 reuses the quiescence gate with its own 30s staleness: while
  // the shell streams, the cwd cannot change, so no exec is spent.
  const stage1Due = (now: number, lastActivityAt: number, lastStage1: number) =>
    !shouldDeferRemoteFetch({
      now,
      lastActivityAt,
      lastFetchAt: lastStage1,
      quietMs: 4_000,
      maxStaleMs: SSH_STAGE1_BACKOFF_MS,
    });

  it("skips while streaming with a fresh stage-1", () => {
    expect(stage1Due(100_000, 99_500, 90_000)).toBe(false);
  });

  it("runs on first sight and after the cap", () => {
    expect(stage1Due(100_000, 99_500, 0)).toBe(true);
    expect(stage1Due(100_000, 99_900, 69_999)).toBe(true);
  });

  it("runs once output goes quiet", () => {
    expect(stage1Due(100_000, 90_000, 95_000)).toBe(true);
  });
});

describe("parseSshBranch", () => {
  it("extracts the branch", () => {
    expect(parseSshBranch("CWD:/r\nBRANCH:main\n")).toBe("main");
    expect(parseSshBranch("BRANCH:feature/x\n")).toBe("feature/x");
  });

  it("returns null when missing, empty or blank", () => {
    expect(parseSshBranch("")).toBeNull();
    expect(parseSshBranch("CWD:/r\n")).toBeNull();
    expect(parseSshBranch("BRANCH:\n")).toBeNull();
    expect(parseSshBranch("BRANCH:   \n")).toBeNull();
  });
});

describe("mergeBranchSummary", () => {
  it("starts from zeros on first sight of a branch", () => {
    expect(mergeBranchSummary(null, "main")).toEqual({
      repoRoot: "",
      branch: "main",
      files: 0,
      added: 0,
      removed: 0,
    });
    expect(mergeBranchSummary(undefined, "main")?.branch).toBe("main");
  });

  it("keeps live counts when the branch is unchanged", () => {
    const prev = {
      repoRoot: "",
      branch: "main",
      files: 3,
      added: 10,
      removed: 2,
    };
    expect(mergeBranchSummary(prev, "main")).toBe(prev);
  });

  it("resets counts on a real move", () => {
    const prev = {
      repoRoot: "",
      branch: "main",
      files: 3,
      added: 10,
      removed: 2,
    };
    expect(mergeBranchSummary(prev, "other")).toEqual({
      repoRoot: "",
      branch: "other",
      files: 0,
      added: 0,
      removed: 0,
    });
  });

  it("hides when there is no branch", () => {
    const prev = {
      repoRoot: "",
      branch: "main",
      files: 3,
      added: 10,
      removed: 2,
    };
    expect(mergeBranchSummary(prev, null)).toBeNull();
    expect(mergeBranchSummary(null, null)).toBeNull();
  });
});

describe("applyDiffCounts", () => {
  const diff = { branch: "main", files: 2, added: 5, removed: 1 };

  it("merges counts when branches match", () => {
    const prev = {
      repoRoot: "",
      branch: "main",
      files: 0,
      added: 0,
      removed: 0,
    };
    expect(applyDiffCounts(prev, diff)).toEqual({
      repoRoot: "",
      branch: "main",
      files: 2,
      added: 5,
      removed: 1,
    });
  });

  it("ignores diffs for another branch (cd mid-flight)", () => {
    const prev = {
      repoRoot: "",
      branch: "other",
      files: 0,
      added: 0,
      removed: 0,
    };
    expect(applyDiffCounts(prev, diff)).toBe(prev);
  });

  it("passes through nulls", () => {
    const prev = {
      repoRoot: "",
      branch: "main",
      files: 0,
      added: 0,
      removed: 0,
    };
    expect(applyDiffCounts(prev, null)).toBe(prev);
    expect(applyDiffCounts(null, diff)).toBeNull();
  });
});
