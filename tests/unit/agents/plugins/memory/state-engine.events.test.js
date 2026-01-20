// Tests state-engine.events listener notifications and event bus emissions.
// Covers normal paths plus boundary inputs and error handling for memory state changes.
import { describe, it, expect, vi, beforeEach } from "vitest";

const loggerErrorMock = vi.hoisted(() => vi.fn());
const createLoggerMock = vi.hoisted(() => vi.fn(() => ({ error: loggerErrorMock })));
const diffLayersMock = vi.hoisted(() => vi.fn());
const getActionLayerMock = vi.hoisted(() => vi.fn());
const BATCH_CONST = vi.hoisted(() => "BATCH_ACTION");

vi.mock("../../../../../js/agents/shared/index.js", () => ({
  createLogger: createLoggerMock,
}));

vi.mock("../../../../../js/agents/plugins/memory/state-diff.js", () => ({
  diffLayers: diffLayersMock,
}));

vi.mock("../../../../../js/agents/plugins/memory/action-types.js", () => ({
  getActionLayer: getActionLayerMock,
  BATCH: BATCH_CONST,
}));

import {
  notifyListeners,
  notifyListenersBatch,
  emitStateChange,
  emitBatchStateChange,
} from "../../../../../js/agents/plugins/memory/state-engine.events.js";

beforeEach(() => {
  loggerErrorMock.mockClear();
  diffLayersMock.mockReset();
  diffLayersMock.mockReturnValue({});
  getActionLayerMock.mockReset();
});

describe("notifyListeners", () => {
  it("notifies global and layer listeners for changed layers", () => {
    const globalA = vi.fn();
    const globalB = vi.fn();
    const layerA = vi.fn();
    const layerB = vi.fn();
    const listeners = new Set([globalA, globalB]);
    const layerListeners = new Map([
      ["L0", new Set([layerA])],
      ["L1", new Set([layerB])],
    ]);
    const action = { type: "UPDATE", meta: { seq: 0 } };
    const prevState = { L0: { value: 1 }, L1: { value: 10 } };
    const nextState = { L0: { value: 2 }, L1: { value: 10 } };

    diffLayersMock.mockReturnValue({ L0: true, L1: false });

    notifyListeners(listeners, layerListeners, action, prevState, nextState);

    expect(diffLayersMock).toHaveBeenCalledWith(prevState, nextState);
    expect(globalA).toHaveBeenCalledWith(action, prevState, nextState);
    expect(globalB).toHaveBeenCalledWith(action, prevState, nextState);
    expect(layerA).toHaveBeenCalledWith(action, prevState.L0, nextState.L0);
    expect(layerB).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it("skips missing/unchanged layers and handles empty inputs", () => {
    const layerListener = vi.fn();
    const listeners = new Set();
    const layerListeners = new Map([["L1", new Set([layerListener])]]);
    const action = { type: "" };
    const prevState = {};
    const nextState = {};

    diffLayersMock.mockReturnValue({ L1: false, L2: true });

    expect(() => notifyListeners(listeners, layerListeners, action, prevState, nextState)).not.toThrow();

    expect(diffLayersMock).toHaveBeenCalledWith(prevState, nextState);
    expect(layerListener).not.toHaveBeenCalled();
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });

  it("logs listener errors and continues", () => {
    const okListener = vi.fn();
    const badListener = vi.fn(() => {
      throw new Error("boom");
    });
    const badLayerListener = vi.fn(() => {
      throw new Error("layer boom");
    });
    const listeners = new Set([badListener, okListener]);
    const layerListeners = new Map([["L0", new Set([badLayerListener])]]);
    const action = { type: "UPDATE" };
    const prevState = { L0: { v: 1 } };
    const nextState = { L0: { v: 2 } };

    diffLayersMock.mockReturnValue({ L0: true });

    notifyListeners(listeners, layerListeners, action, prevState, nextState);

    expect(okListener).toHaveBeenCalledTimes(1);
    expect(badListener).toHaveBeenCalledTimes(1);
    expect(badLayerListener).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledTimes(2);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "[StateEngine] Listener error:",
      expect.objectContaining({ error: "boom" })
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "[StateEngine] Layer L0 listener error:",
      expect.objectContaining({ error: "layer boom" })
    );
  });

  it("supports concurrent and rapid calls with deep nested state and large payloads", async () => {
    const globalListener = vi.fn();
    const layerListener = vi.fn();
    const listeners = new Set([globalListener]);
    const layerListeners = new Map([["L0", new Set([layerListener])]]);
    const deepPrev = { L0: { nested: { level1: { level2: { value: "start" } } } } };
    const deepNext = { L0: { nested: { level1: { level2: { value: "end" } } } } };
    const huge = "x".repeat(10000);
    const actionA = { type: "   ", meta: { seq: -1 } };
    const actionB = { type: huge, meta: { seq: Number.MAX_SAFE_INTEGER } };
    const actionC = { type: "C", meta: { seq: 0 } };

    diffLayersMock.mockReturnValue({ L0: true });

    await Promise.all(
      [actionA, actionB].map((action) =>
        Promise.resolve().then(() => notifyListeners(listeners, layerListeners, action, deepPrev, deepNext))
      )
    );
    notifyListeners(listeners, layerListeners, actionC, deepPrev, deepNext);

    expect(globalListener).toHaveBeenCalledTimes(3);
    expect(layerListener).toHaveBeenCalledTimes(3);
    expect(globalListener.mock.calls.map((call) => call[0].type)).toEqual(expect.arrayContaining(["   ", huge, "C"]));
    expect(layerListener.mock.calls.every((call) => call[1] === deepPrev.L0 && call[2] === deepNext.L0)).toBe(true);
  });
});

describe("notifyListenersBatch", () => {
  it("builds batch action and notifies listeners for changed layers", () => {
    const globalListener = vi.fn();
    const layerListener = vi.fn();
    const listeners = new Set([globalListener]);
    const layerListeners = new Map([["L1", new Set([layerListener])]]);
    const actions = [
      { type: "A", meta: { seq: 1, ts: 2 } },
      { type: "B", meta: { seq: 2 } },
    ];
    const prevState = { L1: { v: 1 } };
    const nextState = { L1: { v: 2 } };

    diffLayersMock.mockReturnValue({ L1: true });

    notifyListenersBatch(listeners, layerListeners, actions, prevState, nextState);

    expect(globalListener).toHaveBeenCalledTimes(1);
    const batchAction = globalListener.mock.calls[0][0];
    expect(batchAction).toMatchObject({
      type: BATCH_CONST,
      payload: { actions, count: 2 },
      meta: actions[0].meta,
    });
    expect(globalListener).toHaveBeenCalledWith(batchAction, prevState, nextState);
    expect(layerListener).toHaveBeenCalledWith(batchAction, prevState.L1, nextState.L1);
  });

  it("handles empty actions array and empty diff", () => {
    const globalListener = vi.fn();
    const listeners = new Set([globalListener]);
    const layerListeners = new Map();
    const actions = [];
    const prevState = {};
    const nextState = {};

    diffLayersMock.mockReturnValue({});

    notifyListenersBatch(listeners, layerListeners, actions, prevState, nextState);

    expect(globalListener).toHaveBeenCalledTimes(1);
    expect(globalListener.mock.calls[0][0]).toEqual({
      type: BATCH_CONST,
      payload: { actions, count: 0 },
      meta: {},
    });
  });

  it("logs listener errors and continues", () => {
    const okListener = vi.fn();
    const badListener = vi.fn(() => {
      throw new Error("bad");
    });
    const badLayerListener = vi.fn(() => {
      throw new Error("layer bad");
    });
    const listeners = new Set([badListener, okListener]);
    const layerListeners = new Map([["L0", new Set([badLayerListener])]]);
    const actions = [{ type: "A", meta: { seq: 1 } }];
    const prevState = { L0: { v: 1 } };
    const nextState = { L0: { v: 2 } };

    diffLayersMock.mockReturnValue({ L0: true });

    notifyListenersBatch(listeners, layerListeners, actions, prevState, nextState);

    expect(okListener).toHaveBeenCalledTimes(1);
    expect(badListener).toHaveBeenCalledTimes(1);
    expect(badLayerListener).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock).toHaveBeenCalledTimes(2);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "[StateEngine] Listener error (batch):",
      expect.objectContaining({ error: "bad" })
    );
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "[StateEngine] Layer L0 listener error (batch):",
      expect.objectContaining({ error: "layer bad" })
    );
  });

  it("accepts array-like actions object and string count", () => {
    const globalListener = vi.fn();
    const listeners = new Set([globalListener]);
    const layerListeners = new Map();
    const actions = { length: "2", 0: { type: "A", meta: { seq: "0", ts: "1" } } };
    const prevState = {};
    const nextState = {};

    diffLayersMock.mockReturnValue({});

    notifyListenersBatch(listeners, layerListeners, actions, prevState, nextState);

    expect(globalListener).toHaveBeenCalledTimes(1);
    const batchAction = globalListener.mock.calls[0][0];
    expect(batchAction.payload.actions).toBe(actions);
    expect(batchAction.payload.count).toBe("2");
    expect(batchAction.meta).toEqual(actions[0].meta);
  });
});

describe("emitStateChange", () => {
  it("returns early when eventBus is missing", () => {
    const action = { type: "A" };
    const nextState = { runId: "r1" };

    expect(() => emitStateChange(null, action, nextState)).not.toThrow();
    expect(() => emitStateChange(undefined, action, nextState)).not.toThrow();
    expect(() => emitStateChange({}, action, nextState)).not.toThrow();

    expect(getActionLayerMock).not.toHaveBeenCalled();
  });

  it("emits state:changed with action metadata and runId", () => {
    const eventBus = { emit: vi.fn() };
    const action = { type: "TYPE1", meta: { seq: 0, ts: -1 } };
    const nextState = { runId: Number.MAX_SAFE_INTEGER };

    getActionLayerMock.mockReturnValue("L2");

    emitStateChange(eventBus, action, nextState);

    expect(getActionLayerMock).toHaveBeenCalledWith("TYPE1");
    expect(eventBus.emit).toHaveBeenCalledWith("state:changed", {
      action: { type: "TYPE1", layer: "L2", seq: 0, ts: -1 },
      runId: Number.MAX_SAFE_INTEGER,
    });
  });

  it("emits even with empty type and string metadata", () => {
    const eventBus = { emit: vi.fn() };
    const action = { type: "", meta: { seq: "0", ts: "1" } };
    const nextState = { runId: "run" };

    getActionLayerMock.mockReturnValue(undefined);

    emitStateChange(eventBus, action, nextState);

    expect(eventBus.emit).toHaveBeenCalledWith("state:changed", {
      action: { type: "", layer: undefined, seq: "0", ts: "1" },
      runId: "run",
    });
  });
});

describe("emitBatchStateChange", () => {
  it("returns early when eventBus is missing", () => {
    const actions = [{ type: "A" }];
    const nextState = { runId: "r1" };

    expect(() => emitBatchStateChange(null, actions, nextState)).not.toThrow();
    expect(() => emitBatchStateChange(undefined, actions, nextState)).not.toThrow();
    expect(() => emitBatchStateChange({}, actions, nextState)).not.toThrow();

    expect(getActionLayerMock).not.toHaveBeenCalled();
  });

  it("emits batchChanged with unique layers and metadata", () => {
    const eventBus = { emit: vi.fn() };
    const actions = [
      { type: "L1:add", meta: { seq: 1, ts: 2 } },
      { type: "L1:update" },
      { type: "L2:delete" },
      { type: "" },
    ];
    const nextState = { runId: "run-1" };

    getActionLayerMock.mockImplementation((type) => {
      if (type.startsWith("L1")) return "L1";
      if (type.startsWith("L2")) return "L2";
      return null;
    });

    emitBatchStateChange(eventBus, actions, nextState);

    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    expect(eventBus.emit.mock.calls[0][0]).toBe("state:batchChanged");
    const payload = eventBus.emit.mock.calls[0][1];
    expect(payload).toMatchObject({
      count: 4,
      seq: 1,
      ts: 2,
      runId: "run-1",
    });
    expect(payload.layers).toEqual(["L1", "L2"]);
    expect(payload.actions).toEqual([
      { type: "L1:add", layer: "L1" },
      { type: "L1:update", layer: "L1" },
      { type: "L2:delete", layer: "L2" },
      { type: "", layer: null },
    ]);
  });

  it("emits empty batch when actions array is empty", () => {
    const eventBus = { emit: vi.fn() };
    const actions = [];
    const nextState = { runId: "run-empty" };

    emitBatchStateChange(eventBus, actions, nextState);

    expect(getActionLayerMock).not.toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledTimes(1);
    const payload = eventBus.emit.mock.calls[0][1];
    expect(eventBus.emit.mock.calls[0][0]).toBe("state:batchChanged");
    expect(payload.actions).toEqual([]);
    expect(payload.layers).toEqual([]);
    expect(payload.count).toBe(0);
    expect(payload.seq).toBeUndefined();
    expect(payload.ts).toBeUndefined();
    expect(payload.runId).toBe("run-empty");
  });
});
