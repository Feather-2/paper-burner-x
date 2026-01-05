/**
 * PythonSkillExecutor 测试
 *
 * 注意：这些测试使用 mock，不会真正加载 Pyodide
 */

import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert";

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
      assert.strictEqual(executor.vfs, null);
      assert.strictEqual(executor.pythonAdapter, null);
      assert.ok(executor.dependencyManager);
    });

    it("should accept custom options", () => {
      const mockVfs = { readFile: () => {} };
      const mockAdapter = { initialize: () => {} };

      const executor = new PythonSkillExecutor({
        vfs: mockVfs,
        pythonAdapter: mockAdapter,
      });

      assert.strictEqual(executor.vfs, mockVfs);
      assert.strictEqual(executor.pythonAdapter, mockAdapter);
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

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("Expected Python skill"));
    });

    it("should require VFS for code reading", async () => {
      const executor = new PythonSkillExecutor();

      // Mock the adapter to avoid actual initialization
      executor.pythonAdapter = {
        initialize: mock.fn(() => Promise.resolve()),
        preloadPlan: mock.fn(() => Promise.resolve()),
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

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("VFS required"));
    });

    it("should execute Python skill with mocked adapter", async () => {
      const mockCode = 'print("hello")';

      const mockVfs = {
        readFile: mock.fn(() => Promise.resolve(mockCode)),
        mkdir: mock.fn(() => Promise.resolve()),
        list: mock.fn(() => Promise.resolve([])),
      };

      const mockAdapter = {
        initialize: mock.fn(() => Promise.resolve()),
        preloadPlan: mock.fn(() => Promise.resolve()),
        execute: mock.fn(() =>
          Promise.resolve({
            success: true,
            data: "hello",
            metrics: { duration: 10 },
          })
        ),
        _requestId: 0,
        pendingRequests: new Map(),
        worker: {
          postMessage: mock.fn(() => {
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

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data, "hello");
      assert.ok(mockVfs.readFile.mock.calls.length > 0);
      assert.ok(mockAdapter.execute.mock.calls.length > 0);
    });

    it("should use default entrypoint main.py", async () => {
      const mockVfs = {
        readFile: mock.fn((path) => {
          assert.ok(path.endsWith("main.py"));
          return Promise.resolve('print("test")');
        }),
        mkdir: mock.fn(() => Promise.resolve()),
        list: mock.fn(() => Promise.resolve([])),
      };

      const mockAdapter = {
        initialize: mock.fn(() => Promise.resolve()),
        preloadPlan: mock.fn(() => Promise.resolve()),
        execute: mock.fn(() =>
          Promise.resolve({ success: true, data: null, metrics: {} })
        ),
        _requestId: 0,
        pendingRequests: new Map(),
        worker: { postMessage: mock.fn() },
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

      assert.ok(mockVfs.readFile.mock.calls.length > 0);
    });

    it("should handle execution errors gracefully", async () => {
      const mockVfs = {
        readFile: mock.fn(() => Promise.resolve("bad code")),
        mkdir: mock.fn(() => Promise.resolve()),
        list: mock.fn(() => Promise.resolve([])),
      };

      const mockAdapter = {
        initialize: mock.fn(() => Promise.resolve()),
        preloadPlan: mock.fn(() => Promise.resolve()),
        execute: mock.fn(() =>
          Promise.resolve({
            success: false,
            error: "SyntaxError: invalid syntax",
            metrics: { duration: 5 },
          })
        ),
        _requestId: 0,
        pendingRequests: new Map(),
        worker: { postMessage: mock.fn() },
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

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("SyntaxError"));
    });

    it("should decode Uint8Array code", async () => {
      const codeBytes = new TextEncoder().encode('print("bytes")');

      const mockVfs = {
        readFile: mock.fn(() => Promise.resolve(codeBytes)),
        mkdir: mock.fn(() => Promise.resolve()),
        list: mock.fn(() => Promise.resolve([])),
      };

      const mockAdapter = {
        initialize: mock.fn(() => Promise.resolve()),
        preloadPlan: mock.fn(() => Promise.resolve()),
        execute: mock.fn((code) => {
          assert.strictEqual(typeof code, "string");
          assert.ok(code.includes("print"));
          return Promise.resolve({ success: true, data: null, metrics: {} });
        }),
        _requestId: 0,
        pendingRequests: new Map(),
        worker: { postMessage: mock.fn() },
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
      assert.strictEqual(result.success, true);
    });
  });

  describe("terminate", () => {
    it("should terminate adapter", async () => {
      const mockAdapter = {
        terminate: mock.fn(() => Promise.resolve()),
      };

      const executor = new PythonSkillExecutor({
        pythonAdapter: mockAdapter,
      });
      executor._initialized = true;

      await executor.terminate();

      assert.ok(mockAdapter.terminate.mock.calls.length > 0);
      assert.strictEqual(executor.pythonAdapter, null);
      assert.strictEqual(executor._initialized, false);
    });

    it("should handle no adapter", async () => {
      const executor = new PythonSkillExecutor();
      await executor.terminate(); // Should not throw
    });
  });

  describe("createPythonSkillExecutor", () => {
    it("should create executor", () => {
      const executor = createPythonSkillExecutor({ vfs: {} });
      assert.ok(executor instanceof PythonSkillExecutor);
    });
  });

  describe("executePythonSkill (convenience)", () => {
    it("should execute skill with temporary executor", async () => {
      const mockVfs = {
        readFile: mock.fn(() => Promise.resolve("pass")),
        mkdir: mock.fn(() => Promise.resolve()),
        list: mock.fn(() => Promise.resolve([])),
      };

      const skill = {
        metadata: { name: "test", runtime: "js" }, // Wrong runtime
        path: "/test",
      };

      const result = await executePythonSkill(skill, { vfs: mockVfs });

      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes("Expected Python"));
    });
  });
});

describe("SkillRuntime", () => {
  it("should export runtime types", () => {
    assert.strictEqual(SkillRuntime.JS, "js");
    assert.strictEqual(SkillRuntime.PYTHON, "python");
  });
});
