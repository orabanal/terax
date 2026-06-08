import { describe, expect, it } from "vitest";
import { directionFor, isValidDrop, joinPath } from "./transferRouting";
import type { SftpPaneRef } from "./types";

const local: SftpPaneRef = {
  side: "left",
  connKey: "a",
  mode: "local",
  path: "/home/me",
  sessionId: null,
};
const remote: SftpPaneRef = {
  side: "right",
  connKey: "b",
  mode: "remote",
  path: "/srv/app",
  sessionId: 1,
};

describe("joinPath", () => {
  it("joins with a single slash", () => {
    expect(joinPath("/home/me", "file.txt")).toBe("/home/me/file.txt");
  });
  it("does not double the slash on a root path", () => {
    expect(joinPath("/", "file.txt")).toBe("/file.txt");
  });
});

describe("directionFor", () => {
  it("local → remote is upload", () => {
    expect(directionFor(local, remote)).toBe("upload");
  });
  it("remote → local is download", () => {
    expect(directionFor(remote, local)).toBe("download");
  });
  it("local → local labels by dest as download", () => {
    expect(directionFor(local, { ...local, connKey: "c" })).toBe("download");
  });
  it("remote → remote labels by dest as upload", () => {
    expect(directionFor(remote, { ...remote, connKey: "d" })).toBe("upload");
  });
});

describe("isValidDrop", () => {
  it("rejects a drop onto the same pane", () => {
    expect(isValidDrop("a", "a")).toBe(false);
  });
  it("accepts a drop onto a different pane", () => {
    expect(isValidDrop("a", "b")).toBe(true);
  });
});
