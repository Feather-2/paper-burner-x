import { describe, it, expect, vi, beforeEach } from "vitest";
import { webcrypto } from "node:crypto";

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockCreateLogger = vi.hoisted(() => vi.fn(() => mockLogger));
const mockAdapterInstances = vi.hoisted(() => []);
const mockInitialize = vi.hoisted(() => vi.fn());
const mockPreloadPlan = vi.hoisted(() => vi.fn());
const mockExecute = vi.hoisted(() => vi.fn());
const mockTerminate = vi.hoisted(() => vi.fn());

const MockPythonRuntimeAdapter = vi.hoisted(() => {
  return class {
    constructor(options = {}) {
      this.options = options;
      this.initialize = mockInitialize;
      this.preloadPlan = mockPreloadPlan;
      this.execute = mockExecute;
      this.terminate = mockTerminate;
      mockAdapterInstances.push(this);
    }
  };
});

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: mockCreateLogger,
}));

vi.mock("../../../../../js/agents/runtime/core/python-adapter.js", () => ({
  PythonRuntimeAdapter: MockPythonRuntimeAdapter,
}));

import {
  DependencyManager,
  PYODIDE_BUILTIN,
  parsePackageName,
  sha256,
  PythonSkillExecutor,
  createPythonSkillExecutor,
  executePythonSkill,
} from "../../../../../js/agents/plugins/deps/index.js";

const encoder = new TextEncoder();

const buildVfs = (overrides = {}) => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  list: vi.fn(),
  stat: vi.fn(),
  deleteFile: vi.fn(),
  ...overrides,
});

const buildSkill = (overrides = {}) => ({
  metadata: {
    name: "demo",
    runtime: "python",
    dependencies: { builtin: [], micropip: [], wheels: [] },
    entrypoint: "main.py",
  },
  path: "/skills/demo",
  ...overrides,
});

const buildDependencyManager = (overrides = {}) => ({
  resolve: vi.fn().mockResolvedValue({ builtin: [], micropip: [], wheels: [] }),
  cacheWheel: vi.fn(async (wheel) => ({ ...wheel, cached: true, localPath: "/cache/cached.whl" })),
  markLoaded: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockAdapterInstances.length = 0;
  mockCreateLogger.mockImplementation(() => mockLogger);
  mockInitialize.mockResolvedValue(undefined);
  mockPreloadPlan.mockResolvedValue(undefined);
  mockExecute.mockResolvedValue({ success: true, data: { ok: true }, metrics: { steps: 1 } });
  mockTerminate.mockResolvedValue(undefined);

  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    vi.stubGlobal("crypto", webcrypto);
  }
});

describe("PYODIDE_BUILTIN", () => {
  it("exposes a Set with known builtins", () => {
    expect(PYODIDE_BUILTIN).toBeInstanceOf(Set);
    expect(PYODIDE_BUILTIN.has("numpy")).toBe(true);
    expect(PYODIDE_BUILTIN.has("pandas")).toBe(true);
    expect(PYODIDE_BUILTIN.has("not-a-real-package")).toBe(false);
  });

  it("handles empty and boundary values without throwing", async () => {
    const values = [null, undefined, "", "   ", 0, -1, Number.MAX_SAFE_INTEGER];
    const results = await Promise.all(values.map((value) => Promise.resolve().then(() => PYODIDE_BUILTIN.has(value))));
    expect(results).toHaveLength(values.length);
    expect(results.every((value) => value === false)).toBe(true);
  });
});

describe("parsePackageName", () => {
  it("parses version constraints and normalizes case", () => {
    expect(parsePackageName("NumPy>=1.20")).toBe("numpy");
    expect(parsePackageName("PANDAS[all]==2.0")).toBe("pandas");
    expect(parsePackageName("requests~=2.31")).toBe("requests");
  });

  it("returns empty string for empty and whitespace input", () => {
    expect(parsePackageName("")).toBe("");
    expect(parsePackageName("   ")).toBe("");
  });

  it("throws for non-string inputs and object-as-array boundaries", () => {
    expect(() => parsePackageName(null)).toThrow();
    expect(() => parsePackageName(undefined)).toThrow();
    expect(() => parsePackageName({})).toThrow();
    expect(() => parsePackageName([])).toThrow();
  });

  it("handles numeric strings, long strings, and concurrent calls", async () => {
    expect(parsePackageName("123")).toBe("123");

    const long = `Pkg${"a".repeat(50000)}>=1.0`;
    const expected = `pkg${"a".repeat(50000)}`;

    const [a, b] = await Promise.all([
      Promise.resolve().then(() => parsePackageName(long)),
      Promise.resolve().then(() => parsePackageName("requests<=3")),
    ]);

    expect(a).toBe(expected);
    expect(b).toBe("requests");
  });
});

describe("sha256", () => {
  it("hashes Uint8Array input", async () => {
    const data = encoder.encode("abc");
    const digest = await sha256(data);
    expect(digest).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes empty ArrayBuffer input", async () => {
    const digest = await sha256(new ArrayBuffer(0));
    expect(digest).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("rejects invalid input types", async () => {
    await expect(sha256(null)).rejects.toThrow();
    await expect(sha256(undefined)).rejects.toThrow();
    await expect(sha256("123")).rejects.toThrow();
    await expect(sha256({})).rejects.toThrow();
  });

  it("handles large buffers and concurrent calls", async () => {
    const large = new Uint8Array(1024 * 1024);
    large.fill(7);

    const [a, b] = await Promise.all([sha256(large), sha256(large)]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("DependencyManager", () => {
  it("initializes defaults and tracks loaded packages", () => {
    const manager = new DependencyManager();

    expect(manager.vfs).toBe(null);
    expect(manager.cacheDir).toBe("/cache/pyodide-wheels");
    expect(manager.maxCacheBytes).toBe(500 * 1024 * 1024);
    expect(manager.isLoaded("numpy")).toBe(false);

    manager.markLoaded([" NumPy>=1.0 ", "pandas"]);
    expect(manager.isLoaded("numpy")).toBe(true);
    expect(manager.isLoaded("pandas")).toBe(true);

    expect(manager.isBuiltin("NumPy")).toBe(true);
    expect(manager.isBuiltin("nope")).toBe(false);
  });

  it("resolves builtin, micropip, wheels, and empty inputs", async () => {
    const manager = new DependencyManager();

    const plan = await manager.resolve({
      builtin: ["numpy", "Unknown>=1.0"],
      micropip: ["requests>=2"],
      wheels: [{ url: "https://files.pythonhosted.org/demo.whl" }],
    });

    expect(plan).toEqual({
      builtin: ["numpy"],
      micropip: ["Unknown>=1.0", "requests>=2"],
      wheels: [{ url: "https://files.pythonhosted.org/demo.whl" }],
    });
    expect(mockLogger.warn).toHaveBeenCalled();

    const emptyPlan = await manager.resolve({});
    expect(emptyPlan).toEqual({ builtin: [], micropip: [], wheels: [] });

    manager.markLoaded(["numpy"]);
    const skipPlan = await manager.resolve({ builtin: ["numpy"] });
    expect(skipPlan.builtin).toEqual([]);
  });

  it("uses cached wheels when hashes match", async () => {
    const cachedData = new Uint8Array([1, 2, 3]);
    const hash = await sha256(cachedData);
    const vfs = buildVfs({
      readFile: vi.fn().mockResolvedValue(cachedData),
    });
    const manager = new DependencyManager({ vfs });

    const plan = await manager.resolve({
      wheels: [{ url: "https://files.pythonhosted.org/pkg.whl", sha256: hash }],
    });

    expect(plan.wheels[0].cached).toBe(true);
    expect(plan.wheels[0].localPath).toBe("/cache/pyodide-wheels/pkg.whl");
    expect(vfs.readFile).toHaveBeenCalledWith("/cache/pyodide-wheels/pkg.whl");
  });

  it("falls back when cached wheel hash mismatches", async () => {
    const cachedData = new Uint8Array([4, 5, 6]);
    const vfs = buildVfs({
      readFile: vi.fn().mockResolvedValue(cachedData),
    });
    const manager = new DependencyManager({ vfs });

    const plan = await manager.resolve({
      wheels: [{ url: "https://files.pythonhosted.org/pkg.whl", sha256: "deadbeef" }],
    });

    expect(plan.wheels[0]).toEqual({ url: "https://files.pythonhosted.org/pkg.whl", sha256: "deadbeef" });
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("rejects when dependencies use object-as-array types", async () => {
    const manager = new DependencyManager();
    await expect(manager.resolve({ builtin: {} })).rejects.toThrow();
  });

  it("supports concurrent resolve calls", async () => {
    const manager = new DependencyManager();
    const deps = { builtin: ["numpy"], micropip: ["requests>=2"], wheels: [] };

    const [a, b] = await Promise.all([manager.resolve(deps), manager.resolve(deps)]);
    expect(a).toEqual(b);
    expect(a.builtin).toEqual(["numpy"]);
  });

  it("returns original wheel when VFS is unavailable", async () => {
    const manager = new DependencyManager();
    const wheel = { url: "https://files.pythonhosted.org/demo.whl" };

    const result = await manager.cacheWheel(wheel);
    expect(result).toBe(wheel);
  });

  it("validates wheel protocol and host and handles fetch failures", async () => {
    const vfs = buildVfs();
    const manager = new DependencyManager({ vfs });

    await expect(
      manager.cacheWheel({ url: "http://files.pythonhosted.org/insecure.whl" }),
    ).rejects.toThrow(/Insecure protocol/);

    await expect(manager.cacheWheel({ url: "https://evil.com/pkg.whl" })).rejects.toThrow(/Untrusted wheel host/);

    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", fetchMock);

    const wheel = { url: "https://files.pythonhosted.org/missing.whl" };
    const result = await manager.cacheWheel(wheel);
    expect(result).toBe(wheel);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("rejects redirected wheels from untrusted hosts", async () => {
    const vfs = buildVfs();
    const manager = new DependencyManager({ vfs });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://evil.com/redirect.whl",
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(manager.cacheWheel({ url: "https://files.pythonhosted.org/redirect.whl" })).rejects.toThrow(
      /Untrusted wheel host/,
    );
  });

  it("caches wheels with sha256 verification and sanitizes filenames", async () => {
    const data = new Uint8Array(1024 * 1024);
    data.fill(9);
    const hash = await sha256(data);

    const vfs = buildVfs();
    const manager = new DependencyManager({ vfs });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://files.pythonhosted.org/packages/My%20Package-1.0.0-cp39.whl",
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    });
    vi.stubGlobal("fetch", fetchMock);

    const wheel = {
      url: "https://files.pythonhosted.org/packages/My%20Package-1.0.0-cp39.whl?download=1",
      sha256: hash,
    };

    const result = await manager.cacheWheel(wheel);
    expect(result.cached).toBe(true);
    expect(result.localPath).toBe("/cache/pyodide-wheels/My_20Package-1.0.0-cp39.whl");

    expect(vfs.mkdir).toHaveBeenCalledWith("/cache/pyodide-wheels", { recursive: true });
    expect(vfs.writeFile).toHaveBeenCalledWith("/cache/pyodide-wheels/My_20Package-1.0.0-cp39.whl", data);
  });

  it("rejects wheels when sha256 mismatches", async () => {
    const data = new Uint8Array([9, 9, 9]);
    const vfs = buildVfs();
    const manager = new DependencyManager({ vfs });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://files.pythonhosted.org/packages/bad.whl",
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      manager.cacheWheel({ url: "https://files.pythonhosted.org/packages/bad.whl", sha256: "00" }),
    ).rejects.toThrow(/SHA256 mismatch/);
    expect(vfs.writeFile).not.toHaveBeenCalled();
  });

  it("generates load scripts with builtin, micropip, and wheel urls", () => {
    const manager = new DependencyManager();
    const script = manager.generateLoadScript({
      builtin: ["numpy", ""],
      micropip: ["requests>=2", null],
      wheels: [
        { url: "https://files.pythonhosted.org/demo.whl" },
        { cached: true, localPath: "/cache/local.whl" },
      ],
    });

    expect(script).toContain("const __pb_builtin = [\"numpy\"]");
    expect(script).toContain("const __pb_micropip = [\"requests>=2\"]");
    expect(script).toContain("emfs:/cache/local.whl");
    expect(script).toContain("https://files.pythonhosted.org/demo.whl");
  });

  it("handles empty, deep nested, and circular plan data safely", () => {
    const manager = new DependencyManager();
    const emptyScript = manager.generateLoadScript(null);
    expect(emptyScript).toContain("const __pb_builtin = []");

    const deep = { deep: { nested: { value: "x" } } };
    const deepScript = manager.generateLoadScript({ builtin: [deep], wheels: {} });
    expect(deepScript).toContain("nested");

    const circular = {};
    circular.self = circular;
    const circularScript = manager.generateLoadScript({ builtin: [circular] });
    expect(circularScript).toContain("const __pb_builtin = null");
  });

  it("cleans cache using LRU eviction and handles string maxBytes", async () => {
    const vfs = buildVfs({
      list: vi.fn().mockResolvedValue([
        { name: "old.whl", kind: "file" },
        { name: "new.whl", kind: "file" },
      ]),
      stat: vi
        .fn()
        .mockResolvedValueOnce({ size: 40, mtimeMs: 1 })
        .mockResolvedValueOnce({ size: 60, mtimeMs: 2 }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    });
    const manager = new DependencyManager({ vfs });

    await manager.cleanupCache("0");
    expect(vfs.deleteFile).toHaveBeenCalledTimes(2);
    expect(vfs.deleteFile.mock.calls[0][0]).toBe("/cache/pyodide-wheels/old.whl");
  });

  it("skips cleanup when under limit and handles failures", async () => {
    const vfs = buildVfs({
      list: vi.fn().mockResolvedValue([{ name: "keep.whl", kind: "file" }]),
      stat: vi.fn().mockResolvedValue({ size: 5, mtimeMs: 1 }),
      deleteFile: vi.fn(),
    });
    const manager = new DependencyManager({ vfs });

    await manager.cleanupCache(Number.MAX_SAFE_INTEGER);
    expect(vfs.deleteFile).not.toHaveBeenCalled();

    const errorVfs = buildVfs({ list: vi.fn().mockRejectedValue(new Error("boom")) });
    const errorManager = new DependencyManager({ vfs: errorVfs });
    await errorManager.cleanupCache(-1);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("returns cache stats and handles unavailable VFS", async () => {
    const manager = new DependencyManager();
    expect(await manager.getCacheStats()).toEqual({ available: false, totalSize: 0, fileCount: 0 });

    const vfs = buildVfs({
      list: vi.fn().mockResolvedValue([
        { name: "a.whl", kind: "file" },
        { name: "dir", kind: "directory" },
      ]),
      stat: vi.fn().mockResolvedValue({ size: 12 }),
    });
    const managerWithVfs = new DependencyManager({ vfs, maxCacheBytes: 123 });
    const stats = await managerWithVfs.getCacheStats();

    expect(stats).toEqual({ available: true, totalSize: 12, fileCount: 1, maxBytes: 123 });

    const badVfs = buildVfs({ list: vi.fn().mockRejectedValue(new Error("fail")) });
    const badManager = new DependencyManager({ vfs: badVfs });
    expect(await badManager.getCacheStats()).toEqual({ available: false, totalSize: 0, fileCount: 0 });
  });
});

describe("PythonSkillExecutor", () => {
  it("creates adapters on demand and initializes once", async () => {
    const executor = new PythonSkillExecutor({});

    await executor.ensureAdapter();
    await executor.ensureAdapter();

    expect(mockAdapterInstances).toHaveLength(1);
    expect(mockInitialize).toHaveBeenCalledTimes(1);
  });

  it("respects provided pythonAdapter and skips extra construction", async () => {
    const adapter = {
      initialize: vi.fn().mockResolvedValue(undefined),
      preloadPlan: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn().mockResolvedValue({ success: true, data: "ok", metrics: {} }),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    const executor = new PythonSkillExecutor({ pythonAdapter: adapter });

    await executor.ensureAdapter();

    expect(mockAdapterInstances).toHaveLength(0);
    expect(adapter.initialize).toHaveBeenCalledTimes(1);
  });

  it("returns an error for non-python runtimes", async () => {
    const dependencyManager = buildDependencyManager();
    const executor = new PythonSkillExecutor({ dependencyManager, vfs: buildVfs() });

    const result = await executor.execute(
      buildSkill({ metadata: { name: "demo", runtime: "js" }, path: "/skills/demo" }),
      { state: {}, vfs: {} },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Expected Python skill/);
    expect(dependencyManager.resolve).not.toHaveBeenCalled();
  });

  it("returns a VFS-required error when no VFS is available", async () => {
    const dependencyManager = buildDependencyManager();
    const executor = new PythonSkillExecutor({ dependencyManager });

    const result = await executor.execute(buildSkill(), { state: {}, vfs: null });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/VFS required/);
  });

  it("rejects invalid entrypoints", async () => {
    const dependencyManager = buildDependencyManager();
    const executor = new PythonSkillExecutor({ dependencyManager, vfs: buildVfs({ readFile: vi.fn() }) });

    const result = await executor.execute(
      buildSkill({ metadata: { name: "demo", runtime: "python", entrypoint: "sub/main.py" } }),
      { state: {}, vfs: executor.vfs },
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid entrypoint/);
  });

  it("returns an error when dependency resolution fails", async () => {
    const dependencyManager = buildDependencyManager({
      resolve: vi.fn().mockRejectedValue(new Error("bad deps")),
    });
    const executor = new PythonSkillExecutor({ dependencyManager, vfs: buildVfs() });

    const result = await executor.execute(buildSkill(), { state: {}, vfs: executor.vfs });

    expect(result.success).toBe(false);
    expect(result.error).toBe("bad deps");
  });

  it("executes python skills, caches wheels, and returns metrics", async () => {
    const dependencyManager = buildDependencyManager({
      resolve: vi.fn().mockResolvedValue({
        builtin: ["numpy"],
        micropip: ["requests>=2", "pandas==2"],
        wheels: [
          { url: "https://files.pythonhosted.org/a.whl" },
          { url: "https://files.pythonhosted.org/b.whl", cached: true, localPath: "/cache/b.whl" },
        ],
      }),
      cacheWheel: vi.fn(async (wheel) => ({ ...wheel, cached: true, localPath: "/cache/a.whl" })),
    });

    const largeCode = "print('x')".repeat(10000);
    const vfs = buildVfs({ readFile: vi.fn().mockResolvedValue(largeCode) });
    const executor = new PythonSkillExecutor({ dependencyManager, vfs });

    mockExecute.mockResolvedValueOnce({ success: true, data: { answer: 42 }, metrics: { tokens: 9 } });

    const result = await executor.execute(buildSkill(), { state: { runId: "r1" }, vfs });

    expect(dependencyManager.resolve).toHaveBeenCalled();
    expect(dependencyManager.cacheWheel).toHaveBeenCalledTimes(1);
    expect(mockPreloadPlan).toHaveBeenCalledTimes(1);
    const planArg = mockPreloadPlan.mock.calls[0][0];
    expect(planArg.wheels[0].cached).toBe(true);

    expect(dependencyManager.markLoaded).toHaveBeenCalledWith(["numpy", "requests", "pandas"]);
    expect(vfs.readFile).toHaveBeenCalledWith("/skills/demo/main.py");
    expect(mockExecute).toHaveBeenCalledWith(largeCode, { state: { runId: "r1" }, vfs });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ answer: 42 });
    expect(result.metrics).toMatchObject({ tokens: 9, duration: expect.any(Number) });
  });

  it("handles object-as-array dependencies by surfacing errors", async () => {
    const executor = new PythonSkillExecutor({ vfs: buildVfs() });
    const skill = buildSkill({ metadata: { name: "demo", runtime: "python", dependencies: { builtin: {} } } });

    const result = await executor.execute(skill, { state: {}, vfs: executor.vfs });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/is not iterable|cannot read/i);
  });

  it("terminates adapter and resets state", async () => {
    const adapter = { terminate: vi.fn().mockResolvedValue(undefined) };
    const executor = new PythonSkillExecutor({ pythonAdapter: adapter });
    executor._initialized = true;

    await executor.terminate();

    expect(adapter.terminate).toHaveBeenCalledTimes(1);
    expect(executor.pythonAdapter).toBe(null);
    expect(executor._initialized).toBe(false);
  });
});

describe("createPythonSkillExecutor", () => {
  it("creates a new PythonSkillExecutor with provided options", () => {
    const vfs = buildVfs();
    const executor = createPythonSkillExecutor({ vfs });

    expect(executor).toBeInstanceOf(PythonSkillExecutor);
    expect(executor.vfs).toBe(vfs);
  });
});

describe("executePythonSkill", () => {
  it("executes skills and always terminates (including concurrent calls)", async () => {
    const executeSpy = vi.spyOn(PythonSkillExecutor.prototype, "execute").mockResolvedValue({ success: true });
    const terminateSpy = vi.spyOn(PythonSkillExecutor.prototype, "terminate").mockResolvedValue(undefined);

    const skill = buildSkill({ metadata: { name: "demo", runtime: "python" } });
    const context = { state: {}, vfs: {} };

    const [a, b] = await Promise.all([executePythonSkill(skill, context), executePythonSkill(skill, context)]);

    expect(executeSpy).toHaveBeenCalledTimes(2);
    expect(terminateSpy).toHaveBeenCalledTimes(2);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);

    executeSpy.mockRestore();
    terminateSpy.mockRestore();
  });

  it("terminates even when execution throws", async () => {
    const executeSpy = vi
      .spyOn(PythonSkillExecutor.prototype, "execute")
      .mockRejectedValue(new Error("boom"));
    const terminateSpy = vi.spyOn(PythonSkillExecutor.prototype, "terminate").mockResolvedValue(undefined);

    const skill = buildSkill({ metadata: { name: "demo", runtime: "python" } });
    const context = { state: {}, vfs: {} };

    await expect(executePythonSkill(skill, context)).rejects.toThrow("boom");
    expect(terminateSpy).toHaveBeenCalledTimes(1);

    executeSpy.mockRestore();
    terminateSpy.mockRestore();
  });
});
