/**
 * @file tests/unit/agents/runtime/core/exec/index.test.js
 * @description Covers exec entrypoint behavior in runtime/core/exec/index.js.
 * Ensures node/browser selection plus boundary/error pass-through stays stable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MODULE_PATH = "../../../../../../js/agents/runtime/core/exec/index.js";
const NODE_IMPL_PATH =
  "../../../../../../js/agents/runtime/core/exec/command-executor.node.js";
const BROWSER_IMPL_PATH =
  "../../../../../../js/agents/runtime/core/exec/command-executor.browser.js";

const ORIGINAL_WINDOW_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, "window");

const setWindow = (value) => {
  Object.defineProperty(globalThis, "window", {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  });
};

const restoreWindow = () => {
  if (ORIGINAL_WINDOW_DESCRIPTOR) {
    Object.defineProperty(globalThis, "window", ORIGINAL_WINDOW_DESCRIPTOR);
    return;
  }
  delete globalThis.window;
};

const setBrowserEnv = (enabled) => {
  if (enabled) {
    setWindow({ document: {} });
    return;
  }
  setWindow(undefined);
};

const hugeString = "x".repeat(1024 * 1024);
const longString = "y".repeat(64 * 1024);
const deepNested = {
  level1: {
    level2: {
      level3: {
        level4: {
          value: "deep",
        },
      },
    },
  },
};

vi.mock(
  "../../../../../../js/agents/runtime/core/exec/command-executor.node.js",
  () => ({
    exec: vi.fn(),
    execShell: vi.fn(),
    execSimple: vi.fn(),
    commandExists: vi.fn(),
    default: { kind: "node-default" },
  })
);

vi.mock(
  "../../../../../../js/agents/runtime/core/exec/command-executor.browser.js",
  () => ({
    exec: vi.fn(),
    execShell: vi.fn(),
    execSimple: vi.fn(),
    commandExists: vi.fn(),
    default: { kind: "browser-default" },
  })
);

const loadExecModule = async ({ browser = false } = {}) => {
  vi.resetModules();
  setBrowserEnv(browser);
  const execModule = await import(MODULE_PATH);
  const nodeImpl = await import(NODE_IMPL_PATH);
  const browserImpl = await import(BROWSER_IMPL_PATH);
  return { execModule, nodeImpl, browserImpl };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  restoreWindow();
});

describe("exec", () => {
  it("uses node implementation in non-browser environments", async () => {
    const { execModule, nodeImpl, browserImpl } = await loadExecModule({ browser: false });
    const result = { success: true, stdout: "ok" };

    nodeImpl.exec.mockResolvedValue(result);

    const output = await execModule.exec("git", ["status"], { cwd: "/tmp" });

    expect(output).toBe(result);
    expect(nodeImpl.exec).toHaveBeenCalledWith("git", ["status"], { cwd: "/tmp" });
    expect(browserImpl.exec).not.toHaveBeenCalled();
  });

  it("forwards boundary values without mutation", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.exec.mockResolvedValue({ success: true });

    const emptyArgs = [];
    const emptyOptions = {};
    await execModule.exec("", emptyArgs, emptyOptions);

    const arrayLikeArgs = { 0: "arg", length: 1 };
    const optionsWithEdges = {
      cwd: "   ",
      timeout: -1,
      maxOutputBytes: Number.MAX_SAFE_INTEGER,
      env: {},
      stdin: "",
      extraNull: null,
      extraUndefined: undefined,
    };
    await execModule.exec("cmd", arrayLikeArgs, optionsWithEdges);

    const numericArgs = [0, -1, Number.MAX_SAFE_INTEGER];
    const optionsTypeEdge = { timeout: "123", cwd: null };
    await execModule.exec("tool", numericArgs, optionsTypeEdge);

    expect(nodeImpl.exec).toHaveBeenCalledTimes(3);
    expect(nodeImpl.exec).toHaveBeenNthCalledWith(1, "", emptyArgs, emptyOptions);
    expect(nodeImpl.exec).toHaveBeenNthCalledWith(2, "cmd", arrayLikeArgs, optionsWithEdges);
    expect(nodeImpl.exec).toHaveBeenNthCalledWith(3, "tool", numericArgs, optionsTypeEdge);
  });

  it("propagates errors from the implementation", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });
    const error = new Error("exec failed");

    nodeImpl.exec.mockRejectedValue(error);

    await expect(execModule.exec("bad", [], {})).rejects.toThrow("exec failed");
  });

  it("handles concurrent calls", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.exec
      .mockResolvedValueOnce({ success: true, stdout: "one" })
      .mockResolvedValueOnce({ success: true, stdout: "two" });

    const [first, second] = await Promise.all([
      execModule.exec("cmd1", [], {}),
      execModule.exec("cmd2", [], {}),
    ]);

    expect(first.stdout).toBe("one");
    expect(second.stdout).toBe("two");
    expect(nodeImpl.exec).toHaveBeenCalledTimes(2);
  });
});

describe("execShell", () => {
  it("uses browser implementation when window is defined", async () => {
    const { execModule, browserImpl, nodeImpl } = await loadExecModule({ browser: true });
    const result = { success: false, stderr: "stub" };

    browserImpl.execShell.mockResolvedValue(result);

    const output = await execModule.execShell("echo hi", { cwd: "/tmp" });

    expect(output).toBe(result);
    expect(browserImpl.execShell).toHaveBeenCalledWith("echo hi", { cwd: "/tmp" });
    expect(nodeImpl.execShell).not.toHaveBeenCalled();
  });

  it("forwards empty inputs and resource-sized commands", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.execShell.mockResolvedValue({ success: true });

    await execModule.execShell("   ", undefined);
    await execModule.execShell("", {});
    await execModule.execShell(longString, { stdin: hugeString });

    expect(nodeImpl.execShell).toHaveBeenCalledTimes(3);
    expect(nodeImpl.execShell).toHaveBeenNthCalledWith(1, "   ", undefined);
    expect(nodeImpl.execShell).toHaveBeenNthCalledWith(2, "", {});
    expect(nodeImpl.execShell).toHaveBeenNthCalledWith(3, longString, { stdin: hugeString });
  });

  it("propagates errors from the implementation", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.execShell.mockRejectedValue(new Error("shell failed"));

    await expect(execModule.execShell("bad", {})).rejects.toThrow("shell failed");
  });

  it("handles rapid successive calls", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.execShell.mockResolvedValue({ success: true });

    const commands = ["a", "b", "c", "d"];
    for (const command of commands) {
      await execModule.execShell(command, {});
    }

    expect(nodeImpl.execShell).toHaveBeenCalledTimes(commands.length);
    expect(nodeImpl.execShell).toHaveBeenNthCalledWith(1, "a", {});
    expect(nodeImpl.execShell).toHaveBeenNthCalledWith(2, "b", {});
    expect(nodeImpl.execShell).toHaveBeenNthCalledWith(3, "c", {});
    expect(nodeImpl.execShell).toHaveBeenNthCalledWith(4, "d", {});
  });
});

describe("execSimple", () => {
  it("returns the underlying result in non-browser environments", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.execSimple.mockResolvedValue("ok");

    const output = await execModule.execSimple("node", ["--version"], { cwd: "/tmp" });

    expect(output).toBe("ok");
    expect(nodeImpl.execSimple).toHaveBeenCalledWith("node", ["--version"], { cwd: "/tmp" });
  });

  it("forwards deep and large payloads", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.execSimple.mockResolvedValue(longString);

    const args = [];
    const options = {
      env: { nested: deepNested },
      timeout: 0,
      stdin: hugeString,
    };

    const output = await execModule.execSimple(longString, args, options);

    expect(output).toBe(longString);
    expect(nodeImpl.execSimple).toHaveBeenCalledWith(longString, args, options);
  });

  it("propagates errors from the implementation", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.execSimple.mockRejectedValue(new Error("simple failed"));

    await expect(execModule.execSimple("bad", [], {})).rejects.toThrow("simple failed");
  });

  it("supports concurrent calls", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.execSimple
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");

    const [first, second] = await Promise.all([
      execModule.execSimple("cmd1", [], {}),
      execModule.execSimple("cmd2", [], {}),
    ]);

    expect(first).toBe("first");
    expect(second).toBe("second");
    expect(nodeImpl.execSimple).toHaveBeenCalledTimes(2);
  });
});

describe("commandExists", () => {
  it("returns the underlying boolean result", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.commandExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const exists = await execModule.commandExists("git");
    const missing = await execModule.commandExists("missing-cmd");

    expect(exists).toBe(true);
    expect(missing).toBe(false);
    expect(nodeImpl.commandExists).toHaveBeenCalledTimes(2);
  });

  it("forwards nullish and empty inputs", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.commandExists.mockResolvedValue(false);

    await execModule.commandExists(null);
    await execModule.commandExists(undefined);
    await execModule.commandExists("");
    await execModule.commandExists("   ");

    expect(nodeImpl.commandExists).toHaveBeenCalledTimes(4);
    expect(nodeImpl.commandExists).toHaveBeenNthCalledWith(1, null);
    expect(nodeImpl.commandExists).toHaveBeenNthCalledWith(2, undefined);
    expect(nodeImpl.commandExists).toHaveBeenNthCalledWith(3, "");
    expect(nodeImpl.commandExists).toHaveBeenNthCalledWith(4, "   ");
  });

  it("propagates errors from the implementation", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    nodeImpl.commandExists.mockRejectedValue(new Error("exists failed"));

    await expect(execModule.commandExists("boom")).rejects.toThrow("exists failed");
  });
});

describe("default", () => {
  it("exports node default implementation in non-browser environments", async () => {
    const { execModule, nodeImpl } = await loadExecModule({ browser: false });

    expect(execModule.default).toBe(nodeImpl.default || nodeImpl);
  });

  it("exports browser default implementation when window is defined", async () => {
    const { execModule, browserImpl } = await loadExecModule({ browser: true });

    expect(execModule.default).toBe(browserImpl.default || browserImpl);
  });
});
