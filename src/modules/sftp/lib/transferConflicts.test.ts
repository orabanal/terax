import { describe, expect, it } from "vitest";
import { isDestinationConflict, renamedPath } from "./transferConflicts";

describe("isDestinationConflict", () => {
  it("detects stable backend destination conflicts", () => {
    expect(isDestinationConflict("destination exists")).toBe(true);
  });

  it("detects common file-exists variants", () => {
    expect(isDestinationConflict("File exists: /tmp/a.txt")).toBe(true);
    expect(isDestinationConflict("target already exists")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isDestinationConflict("permission denied")).toBe(false);
  });
});

describe("renamedPath", () => {
  it("adds a numeric suffix before the extension", () => {
    expect(renamedPath("/tmp/report.txt")).toBe("/tmp/report (1).txt");
  });

  it("increments the numeric suffix", () => {
    expect(renamedPath("/tmp/report.txt", 3)).toBe("/tmp/report (3).txt");
  });

  it("handles names without extensions", () => {
    expect(renamedPath("/tmp/archive", 2)).toBe("/tmp/archive (2)");
  });

  it("preserves windows separators", () => {
    expect(renamedPath("C:\\tmp\\report.txt")).toBe("C:\\tmp\\report (1).txt");
  });
});
