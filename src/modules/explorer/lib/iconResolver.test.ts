import { beforeAll, describe, expect, it } from "vitest";
import { fileIconUrl, folderIconUrl, initIconSet } from "./iconResolver";

beforeAll(async () => {
  await initIconSet();
});

const isDataUrl = (u: string) =>
  u.startsWith("data:image/svg+xml;utf8,%3Csvg");

describe("iconResolver (vscode-icons theme)", () => {
  it("resolves distinctive icons per file type", () => {
    const xlsx = fileIconUrl("report.xlsx");
    const pdf = fileIconUrl("doc.pdf");
    const zip = fileIconUrl("a.zip");
    const ts = fileIconUrl("app.ts");
    for (const u of [xlsx, pdf, zip, ts]) expect(isDataUrl(u)).toBe(true);
    const uniq = new Set([xlsx, pdf, zip, ts]);
    expect(uniq.size).toBe(4);
  });

  it("matches exact filenames (dockerfile, makefile, license)", () => {
    const docker = fileIconUrl("Dockerfile");
    const make = fileIconUrl("Makefile");
    const license = fileIconUrl("LICENSE");
    for (const u of [docker, make, license]) expect(isDataUrl(u)).toBe(true);
    expect(new Set([docker, make, license]).size).toBe(3);
  });

  it("distinguishes folders from files and open from closed", () => {
    const folder = folderIconUrl("src", false);
    const folderOpen = folderIconUrl("src", true);
    const file = fileIconUrl("src.ts");
    expect(isDataUrl(folder)).toBe(true);
    expect(folder).not.toBe(file);
    expect(folderOpen).not.toBe(folder);
  });

  it("falls back to distinct defaults for unknown types", () => {
    const unknownFile = fileIconUrl("weird.unknownext123");
    const unknownFile2 = fileIconUrl("other.unknownext123");
    const unknownFolder = folderIconUrl("nosuchdirname123", false);
    expect(unknownFile).toBe(unknownFile2);
    expect(unknownFile).not.toBe(fileIconUrl("x.xlsx"));
    expect(unknownFolder).not.toBe(unknownFile);
  });
});
