/**
 * PythonSkillExecutor 测试
 *
 * 注意：这些测试使用 mock，不会真正加载 Pyodide
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  PythonSkillExecutor,
  createPythonSkillExecutor,
  executePythonSkill,
} from "../../../js/agents/runtime/deps/python-skill-executor.js";
import { SkillRuntime } from "../../../js/agents/skills/model.js";

describe("PythonSkillExecutor", () => {
  describe("constructor", () => {
    it("should create with defaults", () => {
      const executor = new PythonSkillExecutor();
      expect(executor.vfs).toBe(null);
      expect(executor.pythonAdapter).toBe(null);
      expect(executor.dependencyManager).toBeTruthy();
    });

    it("should accept custom options", () => {
      const mockVfs = { readFile: () => {} };
      const mockAdapter = { initialize: () => {} };

      const executor = new PythonSkillExecutor({
        vfs: mockVfs,
        pythonAdapter: mockAdapter,
      });

      expect(executor.vfs).toBe(mockVfs);
      expect(executor.pythonAdapter).toBe(mockAdapter);
    });
  });

  describe("execute", () => {
    it("should reject non-Python skills", async () => {
      const executor = new PythonSkillExecutor();
      const skill = {
        metadata: { name: "test", runtime: "js" },
        path: "/skills/test",
      };

      const result = await executor.execute(skill, {});

      expect(result.success).toBe(false);
      expect(result.error.includes("Expected Python skill")).toBeTruthy();
    });

    it("should require VFS for code reading", async () => {
      const executor = new PythonSkillExecutor();

      // Mock the adapter to avoid actual initialization
      executor.pythonAdapter = {
        initialize: vi.fn(() => Promise.resolve()),
        preloadPlan: vi.fn(() => Promise.resolve()),
        _requestId: 0,
        pendingRequests: new Map(),
        worker: { postMessage: () => {} },
      };
      executor._initialized = true;

      const skill = {
        metadata: {
          name: "test",
          runtime: SkillRuntime.PYTHON,
          dependencies: {},
        },
        path: "/skills/test",
      };

      const result = await executor.execute(skill, { state: {} });

      expect(result.success).toBe(false);
      expect(result.error.includes("VFS required")).toBeTruthy();
    });

    it("should execute Python skill with mocked adapter", async () => {
      const mockCode = 'print("hello")';

      const mockVfs = {
        readFile: vi.fn(() => Promise.resolve(mockCode)),
        mkdir: vi.fn(() => Promise.resolve()),
        list: vi.fn(() => Promise.resolve([])),
      };

      const mockAdapter = {
        initialize: vi.fn(() => Promise.resolve()),
        preloadPlan: vi.fn(() => Promise.resolve()),
        execute: vi.fn(() =>
          Promise.resolve({
            success: true,
            data: "hello",
            metrics: { duration: 10 },
          })
        ),
        _requestId: 0,
        pendingRequests: new Map(),
        worker: {
          postMessage: vi.fn(() => {
            // Simulate preload response
            const id = mockAdapter._requestId;
            const req = mockAdapter.pendingRequests.get(id);
            if (req) {
              req.resolve();
              mockAdapter.pendingRequests.delete(id);
            }
          }),
        },
      };

      const executor = new PythonSkillExecutor({
        vfs: mockVfs,
        pythonAdapter: mockAdapter,
      });
      executor._initialized = true;

      const skill = {
        metadata: {
          name: "test-skill",
          runtime: SkillRuntime.PYTHON,
          dependencies: { builtin: ["numpy"] },
          entrypoint: "main.py",
        },
        path: "/skills/test",
      };

      const result = await executor.execute(skill, { state: { x: 1 } });

      expect(result.success).toBe(true);
      expect(result.data).toBe("hello");
      expect(mockVfs.readFile.mock.calls.length > 0).toBeTruthy();
      expect(mockAdapter.execute.mock.calls.length > 0).toBeTruthy();
    });

    it("should use default entrypoint main.py", async () => {
      const mockVfs = {
        readFile: vi.fn((path) => {
          expect(path.endsWith("main.py")).toBeTruthy();
          return Promise.resolve('print("test")');
        }),
        mkdir: vi.fn(() => Promise.resolve()),
        list: vi.fn(() => Promise.resolve([])),
      };

      const mockAdapter = {
        initialize: vi.fn(() => Promise.resolve()),
        preloadPlan: vi.fn(() => Promise.resolve()),
        execute: vi.fn(() =>
          Promise.resolve({ success: true, data: null, metrics: {} })
        ),
        _requestId: 0,
        pendingRequests: new Map(),
        worker: { postMessage: vi.fn() },
      };

      const executor = new PythonSkillExecutor({
        vfs: mockVfs,
        pythonAdapter: mockAdapter,
      });
      executor._initialized = true;

      const skill = {
        metadata: {
          name: "test",
          runtime: "python",
          // 不指定 entrypoint
        },
        path: "/skills/test",
      };

      await executor.execute(skill, {});

      expect(mockVfs.readFile.mock.calls.length > 0).toBeTruthy();
    });

    it("should handle execution errors gracefully", async () => {
      const mockVfs = {
        readFile: vi.fn(() => Promise.resolve("bad code")),
        mkdir: vi.fn(() => Promise.resolve()),
        list: vi.fn(() => Promise.resolve([])),
      };

      const mockAdapter = {
        initialize: vi.fn(() => Promise.resolve()),
        preloadPlan: vi.fn(() => Promise.resolve()),
        execute: vi.fn(() =>
          Promise.resolve({
            success: false,
            error: "SyntaxError: invalid syntax",
            metrics: { duration: 5 },
          })
        ),
        _requestId: 0,
        pendingRequests: new Map(),
        worker: { postMessage: vi.fn() },
      };

      const executor = new PythonSkillExecutor({
        vfs: mockVfs,
        pythonAdapter: mockAdapter,
      });
      executor._initialized = true;

      const skill = {
        metadata: { name: "test", runtime: "python" },
        path: "/skills/test",
      };

      const result = await executor.execute(skill, {});

      expect(result.success).toBe(false);
      expect(result.error.includes("SyntaxError")).toBeTruthy();
    });

    it("should decode Uint8Array code", async () => {
      const codeBytes = new TextEncoder().encode('print("bytes")');

      const mockVfs = {
        readFile: vi.fn(() => Promise.resolve(codeBytes)),
        mkdir: vi.fn(() => Promise.resolve()),
        list: vi.fn(() => Promise.resolve([])),
      };

      const mockAdapter = {
        initialize: vi.fn(() => Promise.resolve()),
        preloadPlan: vi.fn(() => Promise.resolve()),
        execute: vi.fn((code) => {
          expect(typeof code).toBe("string");
          expect(code.includes("print")).toBeTruthy();
          return Promise.resolve({ success: true, data: null, metrics: {} });
        }),
        _requestId: 0,
        pendingRequests: new Map(),
        worker: { postMessage: vi.fn() },
      };

      const executor = new PythonSkillExecutor({
        vfs: mockVfs,
        pythonAdapter: mockAdapter,
      });
      executor._initialized = true;

      const skill = {
        metadata: { name: "test", runtime: "python" },
        path: "/skills/test",
      };

      const result = await executor.execute(skill, {});
      expect(result.success).toBe(true);
    });
  });

  describe("terminate", () => {
    it("should terminate adapter", async () => {
      const mockAdapter = {
        terminate: vi.fn(() => Promise.resolve()),
      };

      const executor = new PythonSkillExecutor({
        pythonAdapter: mockAdapter,
      });
      executor._initialized = true;

      await executor.terminate();

      expect(mockAdapter.terminate.mock.calls.length > 0).toBeTruthy();
      expect(executor.pythonAdapter).toBe(null);
      expect(executor._initialized).toBe(false);
    });

    it("should handle no adapter", async () => {
      const executor = new PythonSkillExecutor();
      await executor.terminate(); // Should not throw
    });
  });

  describe("createPythonSkillExecutor", () => {
    it("should create executor", () => {
      const executor = createPythonSkillExecutor({ vfs: {} });
      expect(executor instanceof PythonSkillExecutor).toBeTruthy();
    });
  });

  describe("executePythonSkill (convenience)", () => {
    it("should execute skill with temporary executor", async () => {
      const mockVfs = {
        readFile: vi.fn(() => Promise.resolve("pass")),
        mkdir: vi.fn(() => Promise.resolve()),
        list: vi.fn(() => Promise.resolve([])),
      };

      const skill = {
        metadata: { name: "test", runtime: "js" }, // Wrong runtime
        path: "/test",
      };

      const result = await executePythonSkill(skill, { vfs: mockVfs });

      expect(result.success).toBe(false);
      expect(result.error.includes("Expected Python")).toBeTruthy();
    });
  });
});

describe("SkillRuntime", () => {
  it("should export runtime types", () => {
    expect(SkillRuntime.JS).toBe("js");
    expect(SkillRuntime.PYTHON).toBe("python");
  });
});
