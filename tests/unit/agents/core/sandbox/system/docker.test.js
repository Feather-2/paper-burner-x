import { beforeEach, describe, expect, it, vi } from "vitest";

const execCommandMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../../../js/agents/core/sandbox/system/detect.js", () => ({
  execCommand: execCommandMock,
}));

import {
  DefaultSandboxConfig,
  SandboxBackend,
} from "../../../../../../js/agents/core/sandbox/system/constants.js";
import { execCommand } from "../../../../../../js/agents/core/sandbox/system/detect.js";
import {
  createDockerExecutor,
  ensureImage,
  executeInDocker,
} from "../../../../../../js/agents/core/sandbox/system/docker.js";

function getArgValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function getCallsByArgsPrefix(prefix, next) {
  return execCommand.mock.calls.filter(([, args]) => {
    if (!Array.isArray(args)) return false;
    if (args[0] !== prefix) return false;
    if (typeof next === "string" && args[1] !== next) return false;
    return true;
  });
}

beforeEach(() => {
  execCommand.mockReset();
});

describe("executeInDocker", () => {
  it("builds docker args with mounts/env/memory and returns metadata", async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const result = await executeInDocker("echo", ["hello"], {
      workDir: "/work",
      image: "custom:1",
      allowedReadPaths: ["/etc", "relative"],
      allowedWritePaths: [".", "/data", "/work", "./out", "/path/../escape", "../outside"],
      allowNetwork: false,
      timeoutMs: 5000,
      memoryLimit: 256,
      env: { FOO: "bar", EMPTY: "" },
    });

    expect(result).toMatchObject({
      code: 0,
      stdout: "ok",
      stderr: "",
      killed: false,
      backend: SandboxBackend.DOCKER,
    });

    expect(execCommand).toHaveBeenCalledTimes(1);
    const [cmd, dockerArgs, execOpts] = execCommand.mock.calls[0];
    expect(cmd).toBe("docker");
    expect(execOpts).toEqual({ timeout: 5000 });
    expect(dockerArgs.slice(0, 3)).toEqual(["run", "--rm", "-i"]);
    expect(getArgValue(dockerArgs, "--network")).toBe("none");
    expect(getArgValue(dockerArgs, "--memory")).toBe("256");
    expect(getArgValue(dockerArgs, "--memory-swap")).toBe("256");
    expect(dockerArgs).toEqual(
      expect.arrayContaining([
        "--security-opt",
        "no-new-privileges",
        "--cap-drop",
        "ALL",
        "-v",
        "/work:/workspace",
        "-w",
        "/workspace",
      ])
    );
    expect(dockerArgs).toContain("/etc:/mnt/etc:ro");
    expect(dockerArgs).toContain("/data:/mnt/data");
    expect(dockerArgs).toContain("FOO=bar");
    expect(dockerArgs).toContain("EMPTY=");
    expect(dockerArgs).not.toContain("/work/out:/workspace/./out");
    expect(dockerArgs).not.toContain("/path/../escape:/mnt/path/../escape");

    const imageIndex = dockerArgs.indexOf("custom:1");
    expect(imageIndex).toBeGreaterThan(-1);
    expect(dockerArgs[imageIndex + 1]).toBe("echo");
    expect(dockerArgs.slice(imageIndex + 2)).toEqual(["hello"]);
  });

  it("applies defaults for empty collections and undefined options", async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const result = await executeInDocker("cmd", [], {
      workDir: "/work",
      allowedReadPaths: [],
      allowedWritePaths: [],
      env: {},
    });

    const dockerArgs = execCommand.mock.calls[0][1];
    expect(result.backend).toBe(SandboxBackend.DOCKER);
    expect(getArgValue(dockerArgs, "--network")).toBe("none");
    expect(getArgValue(dockerArgs, "--memory")).toBe(`${DefaultSandboxConfig.memoryLimit}`);
    expect(dockerArgs.includes("-e")).toBe(false);
    expect(dockerArgs.some((arg) => arg.endsWith(":ro"))).toBe(false);
  });

  it.each([124, 137, 0])("sets killed correctly for exit code %s", async (code) => {
    execCommand.mockResolvedValue({ code, stdout: "", stderr: "" });

    const result = await executeInDocker("cmd", [], { workDir: "/work" });

    expect(result.killed).toBe(code === 124 || code === 137);
    expect(result.backend).toBe(SandboxBackend.DOCKER);
  });

  it("skips memory and network flags when disabled", async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await executeInDocker("cmd", [], {
      workDir: "/work",
      allowNetwork: true,
      memoryLimit: 0,
    });

    const dockerArgs = execCommand.mock.calls[0][1];
    expect(dockerArgs).not.toContain("--network");
    expect(dockerArgs).not.toContain("--memory");
    expect(dockerArgs).not.toContain("--memory-swap");
  });

  it.each([
    [-1, "-1"],
    [Number.MAX_SAFE_INTEGER, `${Number.MAX_SAFE_INTEGER}`],
    ["1024", "1024"],
  ])("includes memory flags for limit %s", async (memoryLimit, expected) => {
    execCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await executeInDocker("cmd", [], {
      workDir: "/work",
      allowNetwork: true,
      memoryLimit,
    });

    const dockerArgs = execCommand.mock.calls[0][1];
    expect(getArgValue(dockerArgs, "--memory")).toBe(expected);
    expect(getArgValue(dockerArgs, "--memory-swap")).toBe(expected);
  });

  it("propagates execCommand errors", async () => {
    execCommand.mockRejectedValue(new Error("boom"));

    await expect(executeInDocker("cmd", [], { workDir: "/work" })).rejects.toThrow("boom");
  });

  it("throws when path lists are not iterable", async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await expect(
      executeInDocker("cmd", [], {
        workDir: "/work",
        allowedReadPaths: {},
      })
    ).rejects.toThrow(TypeError);

    expect(execCommand).not.toHaveBeenCalled();
  });

  it("throws when options are null", async () => {
    await expect(executeInDocker("cmd", [], null)).rejects.toThrow(TypeError);
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("throws when workDir is missing and process.cwd is unavailable", async () => {
    vi.stubGlobal("process", undefined);
    await expect(executeInDocker("cmd", [], {}))
      .rejects
      .toThrow("workDir is required for Docker sandbox");
    vi.unstubAllGlobals();
  });

  it("keeps long and deeply nested inputs intact", async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const longName = "a".repeat(2048);
    const bigFilePath = `/var/tmp/${longName}`;
    const deepPath = `/var/lib/${"deep/".repeat(20)}leaf`;
    const longArg = "x".repeat(5000);

    await executeInDocker("echo", [longArg], {
      workDir: "/work",
      allowedReadPaths: [bigFilePath],
      allowedWritePaths: [deepPath],
      env: {},
    });

    const dockerArgs = execCommand.mock.calls[0][1];
    expect(dockerArgs).toContain(`${bigFilePath}:/mnt${bigFilePath}:ro`);
    expect(dockerArgs).toContain(`${deepPath}:/mnt${deepPath}`);
    expect(dockerArgs).toContain(longArg);
  });

  it("handles quick consecutive calls with distinct options", async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await executeInDocker("echo", ["one"], { workDir: "/work", timeoutMs: 1 });
    await executeInDocker("echo", ["two"], { workDir: "/work", timeoutMs: 2 });

    expect(execCommand).toHaveBeenCalledTimes(2);
    expect(execCommand.mock.calls[0][2]).toEqual({ timeout: 1 });
    expect(execCommand.mock.calls[1][2]).toEqual({ timeout: 2 });
    expect(execCommand.mock.calls[0][1]).toContain("one");
    expect(execCommand.mock.calls[1][1]).toContain("two");
  });
});

describe("ensureImage", () => {
  it("returns true when inspect succeeds", async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const result = await ensureImage("img:1");

    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith("docker", ["image", "inspect", "img:1"]);
  });

  it("pulls image when inspect fails and returns true on success", async () => {
    execCommand
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "pulled", stderr: "" });

    const result = await ensureImage("img:2");

    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledTimes(2);
    expect(execCommand.mock.calls[1]).toEqual([
      "docker",
      ["pull", "img:2"],
      { timeout: 120000 },
    ]);
  });

  it("returns false when pull fails", async () => {
    execCommand
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });

    const result = await ensureImage("img:3");

    expect(result).toBe(false);
    expect(execCommand).toHaveBeenCalledTimes(2);
  });

  it("uses default image for undefined and passes through empty strings", async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    await ensureImage();
    await ensureImage("");
    await ensureImage("   ");

    expect(execCommand).toHaveBeenCalledTimes(3);
    expect(execCommand.mock.calls[0][1][2]).toBe("alpine:latest");
    expect(execCommand.mock.calls[1][1][2]).toBe("");
    expect(execCommand.mock.calls[2][1][2]).toBe("   ");
  });

  it("propagates execCommand errors", async () => {
    execCommand.mockRejectedValue(new Error("inspect failed"));

    await expect(ensureImage("img:4")).rejects.toThrow("inspect failed");
  });
});

describe("createDockerExecutor", () => {
  it("merges options, ensures image once, and exposes backend", async () => {
    execCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const executor = createDockerExecutor({ image: "default:1", allowNetwork: true });
    expect(executor.backend).toBe(SandboxBackend.DOCKER);

    const result1 = await executor.execute("echo", ["hi"], {
      image: "override:2",
      timeoutMs: 5,
    });
    const result2 = await executor.execute("echo", ["again"], { image: "override:2" });

    expect(result1.backend).toBe(SandboxBackend.DOCKER);
    expect(result2.backend).toBe(SandboxBackend.DOCKER);

    const inspectCalls = getCallsByArgsPrefix("image", "inspect");
    expect(inspectCalls).toHaveLength(1);
    expect(inspectCalls[0][1][2]).toBe("override:2");

    const runCalls = getCallsByArgsPrefix("run");
    expect(runCalls).toHaveLength(2);
    expect(runCalls[0][2]).toEqual({ timeout: 5 });
    expect(runCalls[0][1]).toContain("override:2");
  });

  it("retries image check when previous attempt failed", async () => {
    execCommand
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

    const executor = createDockerExecutor({ image: "default:1" });

    await executor.execute("echo", ["one"]);
    await executor.execute("echo", ["two"]);

    expect(getCallsByArgsPrefix("image", "inspect")).toHaveLength(2);
    expect(getCallsByArgsPrefix("pull")).toHaveLength(2);
    expect(getCallsByArgsPrefix("run")).toHaveLength(2);
  });

  it("handles concurrent execute calls while image is not ready", async () => {
    const inspectResolvers = [];
    execCommand.mockImplementation((cmd, args) => {
      if (Array.isArray(args) && args[0] === "image" && args[1] === "inspect") {
        return new Promise((resolve) => {
          inspectResolvers.push(() => resolve({ code: 0, stdout: "", stderr: "" }));
        });
      }
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    });

    const executor = createDockerExecutor({ image: "default:1" });
    const first = executor.execute("echo", ["one"]);
    const second = executor.execute("echo", ["two"]);

    expect(inspectResolvers).toHaveLength(2);
    inspectResolvers.forEach((resolve) => resolve());

    await Promise.all([first, second]);

    expect(getCallsByArgsPrefix("image", "inspect")).toHaveLength(2);
    expect(getCallsByArgsPrefix("run")).toHaveLength(2);
  });

  it("delegates shell to execute with /bin/sh -c", async () => {
    const executor = createDockerExecutor();
    const executeSpy = vi.spyOn(executor, "execute").mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
      killed: false,
      backend: SandboxBackend.DOCKER,
    });

    await executor.shell("echo hi", { timeoutMs: 7 });

    expect(executeSpy).toHaveBeenCalledWith("/bin/sh", ["-c", "echo hi"], {
      timeoutMs: 7,
    });
  });

  it("propagates errors from ensureImage", async () => {
    execCommand.mockRejectedValue(new Error("docker down"));

    const executor = createDockerExecutor({ image: "default:1" });

    await expect(executor.execute("echo", ["hi"])).rejects.toThrow("docker down");
    expect(execCommand).toHaveBeenCalledTimes(1);
  });

  it("rechecks and recovers image when runtime reports missing image drift", async () => {
    execCommand
      // initial ensureImage inspect
      .mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" })
      // first docker run fails because image disappeared
      .mockResolvedValueOnce({ code: 125, stdout: "", stderr: "Unable to find image 'default:1'" })
      // recovery ensureImage inspect -> miss
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" })
      // pull succeeds
      .mockResolvedValueOnce({ code: 0, stdout: "pulled", stderr: "" })
      // retry run succeeds
      .mockResolvedValueOnce({ code: 0, stdout: "ok", stderr: "" });

    const executor = createDockerExecutor({ image: "default:1" });
    const result = await executor.execute("echo", ["heal"]);

    expect(result.code).toBe(0);
    expect(getCallsByArgsPrefix("image", "inspect")).toHaveLength(2);
    expect(getCallsByArgsPrefix("pull")).toHaveLength(1);
    expect(getCallsByArgsPrefix("run")).toHaveLength(2);
  });
});
