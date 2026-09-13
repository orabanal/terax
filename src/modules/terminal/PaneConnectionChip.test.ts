import { describe, expect, it } from "vitest";
import { describePaneConnection, paneConnectionSignature } from "./PaneConnectionChip";

const sshConfig = () => ({
  sshHost: { id: "h1", name: "Discador" },
});

describe("describePaneConnection", () => {
  it("resolves an SSH leaf with name and status", () => {
    const read = {
      config: () => sshConfig(),
      connected: () => true,
      sshDisconnected: () => false,
    };
    expect(describePaneConnection(7, read)).toEqual({
      kind: "ssh",
      name: "Discador",
      hostId: "h1",
      status: "up",
    });
  });

  it("marks connecting and disconnected SSH states", () => {
    const base = {
      config: () => sshConfig(),
      connected: () => false,
      sshDisconnected: () => false,
    };
    expect(describePaneConnection(7, base).status).toBe("starting");
    expect(
      describePaneConnection(7, { ...base, sshDisconnected: () => true })
        .status,
    ).toBe("down");
  });

  it("falls back to host id when the name is empty", () => {
    const read = {
      config: () => ({ sshHost: { id: "h1", name: "" } }),
      connected: () => true,
      sshDisconnected: () => false,
    };
    expect(describePaneConnection(7, read)).toMatchObject({ name: "h1" });
  });

  it("resolves local leaves without a session", () => {    const read = {
      config: () => null,
      connected: () => false,
      sshDisconnected: () => false,
    };
    expect(describePaneConnection(7, read)).toEqual({
      kind: "local",
      status: "starting",
    });
    expect(
      describePaneConnection(7, { ...read, connected: () => true }),
    ).toEqual({ kind: "local", status: "up" });
  });
});

describe("paneConnectionSignature", () => {
  it("distinguishes identity and status changes only", () => {
    expect(
      paneConnectionSignature({ kind: "local", status: "starting" }),
    ).toBe("local:starting");
    expect(paneConnectionSignature({ kind: "local", status: "starting" })).toBe(
      paneConnectionSignature({ kind: "local", status: "starting" }),
    );
    expect(
      paneConnectionSignature({ kind: "local", status: "starting" }),
    ).not.toBe(paneConnectionSignature({ kind: "local", status: "up" }));
    expect(
      paneConnectionSignature({
        kind: "ssh",
        name: "Discador",
        hostId: "h1",
        status: "up",
      }),
    ).toBe("ssh:h1:up");
  });
});
