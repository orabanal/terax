import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { scheduleSshExec, schedulerChainCount } from "./sshExecScheduler";

function okResult(cmd: string) {
  return { stdout: `out:${cmd}`, stderr: "", exitCode: 0 };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation((_cmd: string, args: unknown) =>
    Promise.resolve(
      okResult((args as { command: string }).command),
    ),
  );
});

describe("scheduleSshExec", () => {
  it("serializes concurrent execs on the same session in call order", async () => {
    const order: string[] = [];
    invokeMock.mockImplementation((_c: string, args: unknown) => {
      const cmd = (args as { command: string }).command;
      order.push(cmd);
      return Promise.resolve(okResult(cmd));
    });
    const [a, b, c] = await Promise.all([
      scheduleSshExec(7, "one"),
      scheduleSshExec(7, "two"),
      scheduleSshExec(7, "three"),
    ]);
    expect(order).toEqual(["one", "two", "three"]);
    expect(a.stdout).toBe("out:one");
    expect(b.stdout).toBe("out:two");
    expect(c.stdout).toBe("out:three");
  });

  it("lets different sessions run without chaining on each other", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    invokeMock.mockImplementation(() => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      return new Promise((resolve) =>
        setTimeout(() => {
          concurrent -= 1;
          resolve(okResult("x"));
        }, 5),
      );
    });
    await Promise.all([scheduleSshExec(11, "a"), scheduleSshExec(12, "b")]);
    expect(maxConcurrent).toBe(2);
  });

  it("propagates failures without breaking the chain", async () => {
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    await expect(scheduleSshExec(9, "bad")).rejects.toThrow("boom");
    const res = await scheduleSshExec(9, "good");
    expect(res.stdout).toBe("out:good");
  });

  it("drops settled chains so dead sessions do not pin memory", async () => {
    await scheduleSshExec(21, "x");
    await scheduleSshExec(22, "y");
    // Microtask/macrotask drain for the finally-cleanup above.
    await new Promise((r) => setTimeout(r, 0));
    expect(schedulerChainCount()).toBe(0);
  });
});
