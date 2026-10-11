import { describe, expect, it } from "vitest";
import { isWindowActive } from "./useWindowActive";

describe("isWindowActive", () => {
  it("is active only when visible and focused", () => {
    expect(isWindowActive(false, true)).toBe(true);
  });

  it("is inactive when the page is hidden", () => {
    expect(isWindowActive(true, true)).toBe(false);
    expect(isWindowActive(true, false)).toBe(false);
  });

  it("is inactive when the OS focus is elsewhere", () => {
    expect(isWindowActive(false, false)).toBe(false);
  });
});
