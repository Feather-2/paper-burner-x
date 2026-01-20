import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { isNodeLikeMock } = vi.hoisted(() => ({
  isNodeLikeMock: vi.fn(),
}));

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  isNodeLike: isNodeLikeMock,
}));

import {
  isWorkerSupported,
  createWorker,
  terminateWorker,
} from "../../../../../js/agents/runtime/core/worker-factory.js";

const originalWorker = globalThis.Worker;

const restoreWorker = () => {
  if (originalWorker === undefined) {
    if ("Worker" in globalThis) delete globalThis.Worker;
    return;
  }
  globalThis.Worker = originalWorker;
};

beforeEach(() => {
  isNodeLikeMock.mockReset();
  isNodeLikeMock.mockReturnValue(false);
  restoreWorker();
});

afterEach(() => {
  restoreWorker();
});

describe("isWorkerSupported", () => {
  it("returns true in node-like environments without global Worker", () => {
    isNodeLikeMock.mockReturnValue(true);
    if ("Worker" in globalThis) delete globalThis.Worker;

    expect(isWorkerSupported()).toBe(true);
  });

  it("returns true when Worker exists in browser environments", () => {
    isNodeLikeMock.mockReturnValue(false);
    globalThis.Worker = function Worker() {};

    expect(isWorkerSupported()).toBe(true);
  });

  it("returns false when Worker is missing in browser environments", () => {
    isNodeLikeMock.mockReturnValue(false);
    if ("Worker" in globalThis) delete globalThis.Worker;

    expect(isWorkerSupported()).toBe(false);
  });

  it("handles rapid consecutive checks", () => {
    isNodeLikeMock.mockReturnValue(false);
    globalThis.Worker = function Worker() {};

    const results = Array.from({ length: 5 }, () => isWorkerSupported());

    expect(results).toEqual([true, true, true, true, true]);
  });
});

describe("createWorker", () => {
  it("creates a node worker and passes workerData", async () => {
    isNodeLikeMock.mockReturnValue(true);

    const workerData = { payload: "ok" };
    const code = `
      const { parentPort, workerData } = require("node:worker_threads");
      parentPort.on("message", () => {
        parentPort.postMessage(workerData);
      });
    `;

    const worker = await createWorker(code, { eval: true, workerData });

    try {
      const message = await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.postMessage("ping");
      });

      expect(message).toEqual(workerData);
    } finally {
      await worker.terminate();
    }
  });

  it("defaults to module type when options are undefined in browser environments", async () => {
    isNodeLikeMock.mockReturnValue(false);
    const BrowserWorkerMock = vi.fn(function WorkerMock(url, options) {
      this.url = url;
      this.options = options;
    });
    globalThis.Worker = BrowserWorkerMock;

    await createWorker("browser-worker.js");

    expect(BrowserWorkerMock).toHaveBeenCalledWith("browser-worker.js", { type: "module" });
  });

  it("rejects when options is null in node-like environments", async () => {
    isNodeLikeMock.mockReturnValue(true);

    await expect(createWorker("worker.js", null)).rejects.toThrow(TypeError);
  });

  it("creates a browser worker with default module type and merges options", async () => {
    isNodeLikeMock.mockReturnValue(false);
    const BrowserWorkerMock = vi.fn(function WorkerMock(url, options) {
      this.url = url;
      this.options = options;
    });
    globalThis.Worker = BrowserWorkerMock;

    const worker = await createWorker("browser-worker.js", { name: "beta" });

    expect(BrowserWorkerMock).toHaveBeenCalledWith("browser-worker.js", {
      type: "module",
      name: "beta",
    });
    expect(worker).toBe(BrowserWorkerMock.mock.instances[0]);

    await createWorker("browser-worker-2.js", { type: "classic", name: "gamma" });

    expect(BrowserWorkerMock).toHaveBeenCalledWith("browser-worker-2.js", {
      type: "classic",
      name: "gamma",
    });
  });

  it("preserves empty string type overrides in browser environments", async () => {
    isNodeLikeMock.mockReturnValue(false);
    const BrowserWorkerMock = vi.fn(function WorkerMock(url, options) {
      this.url = url;
      this.options = options;
    });
    globalThis.Worker = BrowserWorkerMock;

    await createWorker("browser-worker.js", { type: "" });

    expect(BrowserWorkerMock).toHaveBeenCalledWith("browser-worker.js", { type: "" });
  });

  it("propagates constructor errors in browser environments", async () => {
    isNodeLikeMock.mockReturnValue(false);
    const BrowserWorkerMock = vi.fn(function WorkerMock() {
      throw new Error("browser boom");
    });
    globalThis.Worker = BrowserWorkerMock;

    await expect(createWorker("browser-worker.js", {})).rejects.toThrow("browser boom");
  });

  it("handles concurrent browser worker creation with boundary and resource inputs", async () => {
    isNodeLikeMock.mockReturnValue(false);

    const BrowserWorkerMock = vi.fn(function WorkerMock(url, options) {
      this.url = url;
      this.options = options;
    });
    globalThis.Worker = BrowserWorkerMock;

    const deepNested = {
      level1: { level2: { level3: { level4: { value: "deep" } } } },
    };
    const hugeScriptUrl = `file://${"a".repeat(10000)}.js`;
    const cases = [
      { scriptUrl: "", options: {} },
      { scriptUrl: "   ", options: { workerData: "  " } },
      { scriptUrl: null, options: { workerData: null } },
      { scriptUrl: undefined, options: { workerData: undefined } },
      { scriptUrl: [], options: [] },
      { scriptUrl: {}, options: {} },
      { scriptUrl: 0, options: { workerData: 0 } },
      { scriptUrl: -1, options: { workerData: -1 } },
      { scriptUrl: Number.MAX_SAFE_INTEGER, options: { workerData: Number.MAX_SAFE_INTEGER } },
      { scriptUrl: "123", options: { workerData: "456" } },
      { scriptUrl: hugeScriptUrl, options: { workerData: deepNested } },
      { scriptUrl: new URL("file:///tmp/huge-worker.js"), options: { workerData: { size: "huge" } } },
      { scriptUrl: "array-like", options: { 0: "a", length: 1 } },
    ];

    const buildOptions = (options) => ({
      type: options?.type || "module",
      ...(options || {}),
    });

    const workers = await Promise.all(
      cases.map((entry) => createWorker(entry.scriptUrl, entry.options))
    );

    expect(workers).toHaveLength(cases.length);
    expect(BrowserWorkerMock).toHaveBeenCalledTimes(cases.length);

    cases.forEach((entry, index) => {
      const [calledUrl, calledOptions] = BrowserWorkerMock.mock.calls[index];

      expect(calledUrl).toBe(entry.scriptUrl);
      expect(calledOptions).toEqual(buildOptions(entry.options));
    });
  });

  it("handles rapid sequential browser worker creation", async () => {
    isNodeLikeMock.mockReturnValue(false);
    const BrowserWorkerMock = vi.fn(function WorkerMock(url, options) {
      this.url = url;
      this.options = options;
    });
    globalThis.Worker = BrowserWorkerMock;

    for (let i = 0; i < 5; i += 1) {
      await createWorker(`worker-${i}.js`, { name: `w${i}` });
    }

    expect(BrowserWorkerMock).toHaveBeenCalledTimes(5);
    expect(BrowserWorkerMock).toHaveBeenCalledWith("worker-0.js", {
      type: "module",
      name: "w0",
    });
  });
});

describe("terminateWorker", () => {
  it("returns early on nullish workers", async () => {
    await expect(terminateWorker(null)).resolves.toBeUndefined();
    await expect(terminateWorker(undefined)).resolves.toBeUndefined();
  });

  it("ignores non-worker inputs and boundary values", async () => {
    await expect(terminateWorker(0)).resolves.toBeUndefined();
    await expect(terminateWorker(-1)).resolves.toBeUndefined();
    await expect(terminateWorker(Number.MAX_SAFE_INTEGER)).resolves.toBeUndefined();
    await expect(terminateWorker("")).resolves.toBeUndefined();
    await expect(terminateWorker("123")).resolves.toBeUndefined();
    await expect(terminateWorker([])).resolves.toBeUndefined();
    await expect(terminateWorker({})).resolves.toBeUndefined();
    await expect(terminateWorker({ terminate: 123 })).resolves.toBeUndefined();
    await expect(terminateWorker({ 0: "a", length: 1 })).resolves.toBeUndefined();
  });

  it("awaits promise-based terminate", async () => {
    let resolved = false;
    const worker = {
      terminate: vi.fn(() =>
        Promise.resolve().then(() => {
          resolved = true;
        })
      ),
    };

    await terminateWorker(worker);

    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(true);
  });

  it("handles synchronous terminate", async () => {
    const worker = { terminate: vi.fn(() => "done") };

    await expect(terminateWorker(worker)).resolves.toBeUndefined();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("propagates terminate rejection", async () => {
    const worker = { terminate: vi.fn(() => Promise.reject(new Error("fail"))) };

    await expect(terminateWorker(worker)).rejects.toThrow("fail");
  });

  it("supports concurrent termination", async () => {
    const workerA = { terminate: vi.fn(() => Promise.resolve("a")) };
    const workerB = { terminate: vi.fn(() => Promise.resolve("b")) };

    await Promise.all([terminateWorker(workerA), terminateWorker(workerB)]);

    expect(workerA.terminate).toHaveBeenCalledTimes(1);
    expect(workerB.terminate).toHaveBeenCalledTimes(1);
  });
});
