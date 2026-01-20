import { describe, it, expect, vi, beforeEach } from "vitest";

const constants = vi.hoisted(() => ({
  SandboxBackend: {
    BUBBLEWRAP: "bubblewrap",
    SEATBELT: "seatbelt",
    DOCKER: "docker",
    PERMISSION: "permission",
  },
  SandboxPolicy: {
    STRICT: "strict",
    PERMISSIVE: "permissive",
  },
  DefaultSandboxConfig: {
    backend: "permission",
    allowNetwork: false,
  },
  Platform: {
    LINUX: "linux",
    MACOS: "darwin",
    WINDOWS: "win32",
  },
}));

const detectMocks = vi.hoisted(() => ({
  detectAllBackends: vi.fn(),
  detectBestBackend: vi.fn(),
  detectBubblewrap: vi.fn(),
  detectSeatbelt: vi.fn(),
  detectDocker: vi.fn(),
  getPlatform: vi.fn(),
}));

const bubblewrapMocks = vi.hoisted(() => ({
  executeInBubblewrap: vi.fn(),
  createBubblewrapExecutor: vi.fn(),
}));

const seatbeltMocks = vi.hoisted(() => ({
  executeInSeatbelt: vi.fn(),
  createSeatbeltExecutor: vi.fn(),
}));

const dockerMocks = vi.hoisted(() => ({
  executeInDocker: vi.fn(),
  createDockerExecutor: vi.fn(),
  ensureImage: vi.fn(),
}));

const permissionMocks = vi.hoisted(() => ({
  executeWithPermission: vi.fn(),
  createPermissionExecutor: vi.fn(),
  createInteractivePermissionHandler: vi.fn(),
}));

const executorMocks = vi.hoisted(() => ({
  SystemSandboxExecutor: vi.fn(function SystemSandboxExecutor(...args) {
    this.args = args;
  }),
  createSystemSandbox: vi.fn(),
  execInSandbox: vi.fn(),
  shellInSandbox: vi.fn(),
}));

vi.mock("../../../../../../js/agents/core/sandbox/system/constants.js", () => constants);
vi.mock("../../../../../../js/agents/core/sandbox/system/detect.js", () => detectMocks);
vi.mock("../../../../../../js/agents/core/sandbox/system/bubblewrap.js", () => bubblewrapMocks);
vi.mock("../../../../../../js/agents/core/sandbox/system/seatbelt.js", () => seatbeltMocks);
vi.mock("../../../../../../js/agents/core/sandbox/system/docker.js", () => dockerMocks);
vi.mock("../../../../../../js/agents/core/sandbox/system/permission.js", () => permissionMocks);
vi.mock("../../../../../../js/agents/core/sandbox/system/executor.js", () => executorMocks);

import systemDefault, {
  SandboxBackend,
  SandboxPolicy,
  DefaultSandboxConfig,
  Platform,
  detectAllBackends,
  detectBestBackend,
  detectBubblewrap,
  detectSeatbelt,
  detectDocker,
  getPlatform,
  executeInBubblewrap,
  createBubblewrapExecutor,
  executeInSeatbelt,
  createSeatbeltExecutor,
  executeInDocker,
  createDockerExecutor,
  ensureImage,
  executeWithPermission,
  createPermissionExecutor,
  createInteractivePermissionHandler,
  SystemSandboxExecutor,
  createSystemSandbox,
  execInSandbox,
  shellInSandbox,
} from "../../../../../../js/agents/core/sandbox/system/index.js";

const boundary = {
  nullValue: null,
  undefinedValue: undefined,
  emptyString: "",
  whitespaceString: "   ",
  emptyArray: [],
  emptyObject: {},
  zero: 0,
  negativeOne: -1,
  maxSafe: Number.MAX_SAFE_INTEGER,
  stringNumber: "123",
  objectAsArray: { 0: "a", length: 1 },
  longString: "x".repeat(10000),
  deepObject: { level1: { level2: { level3: { value: "deep" } } } },
  largeFile: { name: "big.bin", content: "x".repeat(50000) },
};

beforeEach(() => {
  vi.clearAllMocks();
});

const testFunctionExport = ({ name, fn, mock, boundaryArgs }) => {
  describe(name, () => {
    it("exposes the underlying implementation", () => {
      expect(fn).toBe(mock);
    });

    it("returns the underlying value for normal inputs", () => {
      mock.mockReturnValueOnce("ok");
      const result = fn("input");
      expect(result).toBe("ok");
      expect(mock).toHaveBeenCalledWith("input");
    });

    it("forwards boundary inputs", () => {
      boundaryArgs.forEach((value) => {
        fn(value);
      });
      expect(mock.mock.calls.map((args) => args[0])).toEqual(boundaryArgs);
    });

    it("propagates errors", () => {
      mock.mockImplementationOnce(() => {
        throw new Error("boom");
      });
      expect(() => fn("bad"))
        .toThrow("boom");
    });
  });
};

describe("SandboxBackend", () => {
  it("re-exports the constants module", () => {
    expect(SandboxBackend).toBe(constants.SandboxBackend);
  });
});

describe("SandboxPolicy", () => {
  it("re-exports the constants module", () => {
    expect(SandboxPolicy).toBe(constants.SandboxPolicy);
  });
});

describe("DefaultSandboxConfig", () => {
  it("re-exports the constants module", () => {
    expect(DefaultSandboxConfig).toBe(constants.DefaultSandboxConfig);
  });
});

describe("Platform", () => {
  it("re-exports the constants module", () => {
    expect(Platform).toBe(constants.Platform);
  });
});

testFunctionExport({
  name: "detectAllBackends",
  fn: detectAllBackends,
  mock: detectMocks.detectAllBackends,
  boundaryArgs: [
    boundary.nullValue,
    boundary.undefinedValue,
    boundary.emptyString,
    boundary.whitespaceString,
  ],
});

testFunctionExport({
  name: "detectBestBackend",
  fn: detectBestBackend,
  mock: detectMocks.detectBestBackend,
  boundaryArgs: [
    boundary.zero,
    boundary.negativeOne,
    boundary.maxSafe,
  ],
});

testFunctionExport({
  name: "detectBubblewrap",
  fn: detectBubblewrap,
  mock: detectMocks.detectBubblewrap,
  boundaryArgs: [boundary.stringNumber],
});

testFunctionExport({
  name: "detectSeatbelt",
  fn: detectSeatbelt,
  mock: detectMocks.detectSeatbelt,
  boundaryArgs: [boundary.objectAsArray],
});

testFunctionExport({
  name: "detectDocker",
  fn: detectDocker,
  mock: detectMocks.detectDocker,
  boundaryArgs: [boundary.emptyArray, boundary.emptyObject],
});

testFunctionExport({
  name: "getPlatform",
  fn: getPlatform,
  mock: detectMocks.getPlatform,
  boundaryArgs: [boundary.longString],
});

testFunctionExport({
  name: "executeInBubblewrap",
  fn: executeInBubblewrap,
  mock: bubblewrapMocks.executeInBubblewrap,
  boundaryArgs: [boundary.deepObject],
});

testFunctionExport({
  name: "createBubblewrapExecutor",
  fn: createBubblewrapExecutor,
  mock: bubblewrapMocks.createBubblewrapExecutor,
  boundaryArgs: [boundary.largeFile],
});

testFunctionExport({
  name: "executeInSeatbelt",
  fn: executeInSeatbelt,
  mock: seatbeltMocks.executeInSeatbelt,
  boundaryArgs: [boundary.undefinedValue],
});

testFunctionExport({
  name: "createSeatbeltExecutor",
  fn: createSeatbeltExecutor,
  mock: seatbeltMocks.createSeatbeltExecutor,
  boundaryArgs: [boundary.whitespaceString],
});

testFunctionExport({
  name: "executeInDocker",
  fn: executeInDocker,
  mock: dockerMocks.executeInDocker,
  boundaryArgs: [boundary.emptyString],
});

testFunctionExport({
  name: "createDockerExecutor",
  fn: createDockerExecutor,
  mock: dockerMocks.createDockerExecutor,
  boundaryArgs: [boundary.stringNumber],
});

testFunctionExport({
  name: "ensureImage",
  fn: ensureImage,
  mock: dockerMocks.ensureImage,
  boundaryArgs: [boundary.maxSafe],
});

testFunctionExport({
  name: "executeWithPermission",
  fn: executeWithPermission,
  mock: permissionMocks.executeWithPermission,
  boundaryArgs: [boundary.emptyArray],
});

testFunctionExport({
  name: "createPermissionExecutor",
  fn: createPermissionExecutor,
  mock: permissionMocks.createPermissionExecutor,
  boundaryArgs: [boundary.emptyObject],
});

testFunctionExport({
  name: "createInteractivePermissionHandler",
  fn: createInteractivePermissionHandler,
  mock: permissionMocks.createInteractivePermissionHandler,
  boundaryArgs: [boundary.nullValue],
});

testFunctionExport({
  name: "createSystemSandbox",
  fn: createSystemSandbox,
  mock: executorMocks.createSystemSandbox,
  boundaryArgs: [boundary.longString],
});

describe("SystemSandboxExecutor", () => {
  it("exposes the underlying implementation", () => {
    expect(SystemSandboxExecutor).toBe(executorMocks.SystemSandboxExecutor);
  });

  it("constructs with normal inputs", () => {
    new SystemSandboxExecutor("config");
    expect(executorMocks.SystemSandboxExecutor).toHaveBeenCalledWith("config");
  });

  it("accepts boundary inputs", () => {
    const values = [boundary.undefinedValue, boundary.emptyArray];
    values.forEach((value) => {
      new SystemSandboxExecutor(value);
    });
    expect(executorMocks.SystemSandboxExecutor.mock.calls.map((args) => args[0]))
      .toEqual(values);
  });

  it("propagates constructor errors", () => {
    executorMocks.SystemSandboxExecutor.mockImplementationOnce(function () {
      throw new Error("boom");
    });
    expect(() => new SystemSandboxExecutor("bad")).toThrow("boom");
  });
});

describe("execInSandbox", () => {
  it("exposes the underlying implementation", () => {
    expect(execInSandbox).toBe(executorMocks.execInSandbox);
  });

  it("returns the underlying value for normal inputs", () => {
    executorMocks.execInSandbox.mockReturnValueOnce("ok");
    const result = execInSandbox("input");
    expect(result).toBe("ok");
    expect(executorMocks.execInSandbox).toHaveBeenCalledWith("input");
  });

  it("forwards boundary inputs", () => {
    execInSandbox(boundary.largeFile);
    expect(executorMocks.execInSandbox).toHaveBeenCalledWith(boundary.largeFile);
  });

  it("propagates errors", () => {
    executorMocks.execInSandbox.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => execInSandbox("bad")).toThrow("boom");
  });

  it("handles concurrent calls", async () => {
    executorMocks.execInSandbox
      .mockImplementationOnce(async (value) => `ok:${value}`)
      .mockImplementationOnce(async (value) => `ok:${value}`);

    const results = await Promise.all([
      execInSandbox("alpha"),
      execInSandbox("beta"),
    ]);

    expect(results).toEqual(["ok:alpha", "ok:beta"]);
    expect(executorMocks.execInSandbox).toHaveBeenCalledTimes(2);
  });

  it("handles rapid consecutive calls", () => {
    const values = ["v1", "v2", "v3", "v4", "v5"];
    values.forEach(() => {
      executorMocks.execInSandbox.mockImplementationOnce((value) => `ok:${value}`);
    });

    const results = values.map((value) => execInSandbox(value));

    expect(results).toEqual(values.map((value) => `ok:${value}`));
    expect(executorMocks.execInSandbox).toHaveBeenCalledTimes(values.length);
  });
});

testFunctionExport({
  name: "shellInSandbox",
  fn: shellInSandbox,
  mock: executorMocks.shellInSandbox,
  boundaryArgs: [boundary.deepObject],
});

describe("default export", () => {
  it("exposes the expected surface", () => {
    expect(systemDefault).toEqual({
      createSystemSandbox,
      execInSandbox,
      shellInSandbox,
      detectBestBackend,
      detectAllBackends,
      SandboxBackend,
    });
  });

  it("does not include unexpected keys", () => {
    expect(Object.keys(systemDefault).sort()).toEqual([
      "SandboxBackend",
      "createSystemSandbox",
      "detectAllBackends",
      "detectBestBackend",
      "execInSandbox",
      "shellInSandbox",
    ].sort());
  });
});
