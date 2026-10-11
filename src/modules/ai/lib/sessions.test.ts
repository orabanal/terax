import { describe, expect, it } from "vitest";
import {
  findRecentSessionForConnection,
  pruneScopesToLiveKeys,
  parseTerminalScope,
  type SessionMeta,
} from "./sessions";

function meta(
  over: Partial<SessionMeta> & { id: string },
): SessionMeta {
  return {
    title: "t",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("parseTerminalScope", () => {
  it("splits leaf and optional ssh host", () => {
    expect(parseTerminalScope("12")).toEqual({ leafId: 12, sshHostId: null });
    expect(parseTerminalScope("12:ssh:host-1")).toEqual({
      leafId: 12,
      sshHostId: "host-1",
    });
    expect(parseTerminalScope("abc")).toBeNull();
    expect(parseTerminalScope("")).toBeNull();
  });
});

describe("findRecentSessionForConnection", () => {
  const sessions: SessionMeta[] = [
    meta({
      id: "old",
      scope: { type: "terminal", targetId: "3:ssh:host-1" },
      updatedAt: 100,
    }),
    meta({
      id: "new",
      scope: { type: "terminal", targetId: "5:ssh:host-1" },
      updatedAt: 200,
    }),
    meta({
      id: "other-host",
      scope: { type: "terminal", targetId: "7:ssh:host-2" },
      updatedAt: 300,
    }),
    meta({
      id: "local",
      scope: { type: "terminal", targetId: "9" },
      updatedAt: 400,
    }),
    meta({
      id: "ws",
      scope: { type: "workspace", targetId: "2" },
      updatedAt: 500,
    }),
  ];

  it("returns the most recent session on the same ssh host", () => {
    const found = findRecentSessionForConnection(sessions, {
      type: "terminal",
      targetId: "99:ssh:host-1",
    });
    expect(found?.id).toBe("new");
  });

  it("ignores other hosts, local and workspace sessions", () => {
    const found = findRecentSessionForConnection(sessions, {
      type: "terminal",
      targetId: "99:ssh:host-9",
    });
    expect(found).toBeNull();
  });

  it("never adopts for local or workspace scopes", () => {
    expect(
      findRecentSessionForConnection(sessions, {
        type: "terminal",
        targetId: "99",
      }),
    ).toBeNull();
    expect(
      findRecentSessionForConnection(sessions, {
        type: "workspace",
        targetId: "99",
      }),
    ).toBeNull();
  });
});

describe("pruneScopesToLiveKeys", () => {
  it("keeps live leaves/tabs and drops everything dead or malformed", () => {
    const map = {
      "terminal:1": "a",
      "terminal:2:ssh:h1": "b",
      "terminal:9": "c",
      "terminal:8:ssh:h1": "d",
      "workspace:10": "e",
      "workspace:99": "f",
      "bogus": "g",
      "terminal:abc": "h",
    };
    expect(
      pruneScopesToLiveKeys(map, new Set([1, 2]), new Set([10])),
    ).toEqual({
      "terminal:1": "a",
      "terminal:2:ssh:h1": "b",
      "workspace:10": "e",
    });
  });
});
