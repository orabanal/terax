import { describe, expect, it } from "vitest";
import { normalizeDistroId, parseOsReleaseId } from "./osIcons";

describe("normalizeDistroId", () => {
  it("maps known distro ids", () => {
    expect(normalizeDistroId("ubuntu")).toBe("ubuntu");
    expect(normalizeDistroId("debian")).toBe("debian");
    expect(normalizeDistroId("Rocky Linux")).toBe("rocky");
    expect(normalizeDistroId("AlmaLinux")).toBe("almalinux");
    expect(normalizeDistroId("rhel")).toBe("redhat");
    expect(normalizeDistroId("Red Hat Enterprise Linux")).toBe("redhat");
    expect(normalizeDistroId("amzn")).toBe("amazon");
    expect(normalizeDistroId("opensuse-tumbleweed")).toBe("opensuse");
    expect(normalizeDistroId("sles")).toBe("opensuse");
    expect(normalizeDistroId("manjaro")).toBe("arch");
    expect(normalizeDistroId("kali")).toBe("kali");
  });

  it("maps OS families", () => {
    expect(normalizeDistroId("Darwin")).toBe("macos");
    expect(normalizeDistroId("windows")).toBe("windows");
    expect(normalizeDistroId("linux")).toBe("linux");
  });

  it("returns empty for unknown or empty input", () => {
    expect(normalizeDistroId("")).toBe("");
    expect(normalizeDistroId(null)).toBe("");
    expect(normalizeDistroId(undefined)).toBe("");
    expect(normalizeDistroId("FreeBSD")).toBe("");
    expect(normalizeDistroId("some-router-os")).toBe("");
  });
});

describe("parseOsReleaseId", () => {
  it("extracts the ID field from /etc/os-release", () => {
    const content = 'NAME="Ubuntu"\nVERSION="22.04 LTS"\nID=ubuntu\nID_LIKE=debian';
    expect(parseOsReleaseId(content)).toBe("ubuntu");
  });

  it("handles quoted values", () => {
    expect(parseOsReleaseId('ID="fedora"')).toBe("fedora");
  });

  it("is case-insensitive on the key", () => {
    expect(parseOsReleaseId("id=arch")).toBe("arch");
  });

  it("falls back to the first token for uname-style output", () => {
    expect(parseOsReleaseId("Darwin")).toBe("darwin");
    expect(parseOsReleaseId("Linux\n")).toBe("linux");
  });

  it("returns empty for empty input", () => {
    expect(parseOsReleaseId("")).toBe("");
  });
});
