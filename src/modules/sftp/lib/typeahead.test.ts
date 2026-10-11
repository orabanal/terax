import { describe, expect, it } from "vitest";
import { findTypeaheadMatch } from "./typeahead";

const NAMES = ["..", "Documents", "Downloads", "docker-compose.yml", "api", "README.md"];

describe("findTypeaheadMatch", () => {
  it("matches a prefix case-insensitively from the top", () => {
    expect(findTypeaheadMatch(NAMES, "d", null)).toBe(1); // Documents
    expect(findTypeaheadMatch(NAMES, "D", null)).toBe(1);
    expect(findTypeaheadMatch(NAMES, "do", null)).toBe(1);
    expect(findTypeaheadMatch(NAMES, "rea", null)).toBe(5);
  });

  it("matches multi-character buffers", () => {
    expect(findTypeaheadMatch(NAMES, "down", null)).toBe(2);
    expect(findTypeaheadMatch(NAMES, "api", null)).toBe(4);
  });

  it("matches the parent entry on dot", () => {
    expect(findTypeaheadMatch(NAMES, ".", null)).toBe(0);
  });

  it("returns -1 when nothing matches", () => {
    expect(findTypeaheadMatch(NAMES, "zzz", null)).toBe(-1);
  });

  it("returns -1 for empty input", () => {
    expect(findTypeaheadMatch([], "a", null)).toBe(-1);
    expect(findTypeaheadMatch(NAMES, "", null)).toBe(-1);
  });

  it("cycles same-letter presses from the row after the anchor", () => {
    // Anchor on Documents (1), pressing "d" again → Downloads (2).
    expect(findTypeaheadMatch(NAMES, "dd", 1)).toBe(2);
    // Anchor on Downloads (2) → next "d" match is docker-compose (3).
    expect(findTypeaheadMatch(NAMES, "dd", 2)).toBe(3);
    // Anchor on docker-compose (3) → wraps past api/README to Documents (1).
    expect(findTypeaheadMatch(NAMES, "dd", 3)).toBe(1);
  });

  it("does not cycle multi-character buffers", () => {
    // "do" always resolves from the top even with an anchor past it.
    expect(findTypeaheadMatch(NAMES, "do", 2)).toBe(1);
  });
});
