import { describe, expect, it } from "vitest";
import { bookmarkKeyFor } from "./useSftpBookmarks";

describe("bookmarkKeyFor", () => {
  it("keys local connections as a single stable scope", () => {
    expect(bookmarkKeyFor({ mode: "local" }, "conn-1")).toBe("local");
    expect(bookmarkKeyFor({ mode: "local" }, "conn-2")).toBe("local");
  });

  it("keys remote connections by stable host id, not sub-tab id", () => {
    expect(
      bookmarkKeyFor({ mode: "remote", hostId: "host-abc" }, "conn-1"),
    ).toBe("ssh:host-abc");
    expect(
      bookmarkKeyFor({ mode: "remote", hostId: "host-abc" }, "conn-9"),
    ).toBe("ssh:host-abc");
  });

  it("shares the scope across panels for the same connection", () => {
    // Left and right panes to the same host must see the same bookmarks.
    expect(
      bookmarkKeyFor({ mode: "remote", hostId: "host-abc" }, "conn-left"),
    ).toBe(bookmarkKeyFor({ mode: "remote", hostId: "host-abc" }, "conn-right"));
  });

  it("falls back to the tab id when a remote has no host yet", () => {
    expect(bookmarkKeyFor({ mode: "remote" }, "conn-4")).toBe("conn-4");
  });
});
