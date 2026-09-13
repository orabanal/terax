import { describe, expect, it } from "vitest";
import {
  OpencodeTailBuffer,
  parseOpencodeLine,
} from "./opencodeNotify";

const line = (kind: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    v: 1,
    agent: "opencode",
    kind,
    sessionId: "ses_1",
    directory: "/Users/foo/bar",
    project: "bar",
    detail: null,
    ts: 1,
    ...extra,
  });

describe("parseOpencodeLine", () => {
  it("parses finished/attention/error signals", () => {
    expect(parseOpencodeLine(line("finished"), "local")).toMatchObject({
      kind: "finished",
      sessionId: "ses_1",
      directory: "/Users/foo/bar",
      origin: "local",
      sshId: null,
    });
    expect(
      parseOpencodeLine(line("attention", { detail: "Permission: bash" }), "ssh", 7),
    ).toMatchObject({ kind: "attention", detail: "Permission: bash", sshId: 7 });
    expect(parseOpencodeLine(line("error"), "local")).toMatchObject({
      kind: "error",
    });
  });

  it("rejects foreign, malformed and unknown-kind lines", () => {
    expect(parseOpencodeLine("not json", "local")).toBeNull();
    expect(parseOpencodeLine("{}", "local")).toBeNull();
    expect(parseOpencodeLine(line("started"), "local")).toBeNull();
    expect(
      parseOpencodeLine(
        JSON.stringify({ v: 1, agent: "claude", kind: "finished" }),
        "local",
      ),
    ).toBeNull();
  });
});

describe("OpencodeTailBuffer", () => {
  it("reassembles split chunks and skips garbage", () => {
    const buf = new OpencodeTailBuffer();
    const a = line("finished");
    const b = line("attention");
    // Split mid-line: nothing complete yet.
    expect(buf.push(3, `${a.slice(0, 20)}`)).toEqual([]);
    // Remainder + full line + garbage line.
    const out = buf.push(3, `${a.slice(20)}\n${b}\nnot json\n`);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: "finished", sshId: 3 });
    expect(out[1]).toMatchObject({ kind: "attention", sshId: 3 });
  });

  it("keeps ssh sessions isolated", () => {
    const buf = new OpencodeTailBuffer();
    const a = line("finished");
    buf.push(3, a.slice(0, 10));
    expect(buf.push(4, `${a}\n`)).toHaveLength(1);
    expect(buf.push(3, `${a.slice(10)}\n`)).toHaveLength(1);
  });
});
