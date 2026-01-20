import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/core/lamport-clock.js", () => {
  let seq = 0;
  const nextTick = vi.fn(() => ({ seq: ++seq }));
  const sync = vi.fn((externalSeq) => {
    if (typeof externalSeq === "number") {
      seq = Math.max(seq, externalSeq);
    }
  });
  const currentSeq = vi.fn(() => seq);
  const __reset = () => {
    seq = 0;
    nextTick.mockClear();
    sync.mockClear();
    currentSeq.mockClear();
  };
  return { nextTick, sync, currentSeq, __reset };
});

vi.mock("../../../../../js/agents/shared/index.js", () => {
  const logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const createLogger = vi.fn(() => logger);
  class DisposableBase {
    constructor() {
      this._disposables = [];
      this._disposed = false;
    }
    _registerDisposable(fn) {
      this._disposables.push(fn);
    }
    _ensureNotDisposed() {
      if (this._disposed) {
        throw new Error("Object disposed");
      }
    }
    dispose() {
      if (this._disposed) return;
      this._disposed = true;
      this._disposables.forEach((fn) => fn());
    }
  }
  const __reset = () => {
    createLogger.mockClear();
    logger.warn.mockClear();
    logger.info.mockClear();
    logger.error.mockClear();
  };
  return { DisposableBase, createLogger, __logger: logger, __reset };
});

vi.mock("../../../../../js/agents/plugins/memory/state-diff.js", () => {
  const cloneJson = vi.fn((value) => JSON.parse(JSON.stringify(value)));
  const __reset = () => {
    cloneJson.mockClear();
  };
  return { cloneJson, __reset };
});

vi.mock("../../../../../js/agents/plugins/memory/state-engine.reducers.js", () => {
  const createInitialState = vi.fn(() => ({
    runId: "run-default",
    count: 0,
    layers: { L0: {}, L1: {}, L2: {}, L3: {} },
  }));
  const defaultRootReducer = (state, action) => {
    if (action.type === "NO_CHANGE") {
      return state;
    }
    if (action.type === "INCREMENT") {
      return {
        ...state,
        count: (state.count || 0) + 1,
        lastAction: action.type,
        payload: action.payload,
      };
    }
    if (action.type === "SET_DEEP") {
      return { ...state, deep: action.payload, lastAction: action.type };
    }
    if (action.type === "SET_PAYLOAD") {
      return { ...state, payload: action.payload, lastAction: action.type };
    }
    if (action.type === "SET_LAYERS") {
      return { ...state, layers: action.payload, lastAction: action.type };
    }
    return { ...state, lastAction: action.type, payload: action.payload };
  };
  const rootReducer = vi.fn(defaultRootReducer);
  const __reset = () => {
    createInitialState.mockClear();
    rootReducer.mockReset();
    rootReducer.mockImplementation(defaultRootReducer);
  };
  return {
    createInitialState,
    rootReducer,
    reduceL0: vi.fn(),
    reduceL1: vi.fn(),
    reduceL2: vi.fn(),
    reduceL3: vi.fn(),
    __reset,
  };
});

vi.mock("../../../../../js/agents/plugins/memory/state-engine.events.js", () => {
  const notifyListeners = vi.fn();
  const notifyListenersBatch = vi.fn();
  const emitStateChange = vi.fn();
  const emitBatchStateChange = vi.fn();
  const __reset = () => {
    notifyListeners.mockClear();
    notifyListenersBatch.mockClear();
    emitStateChange.mockClear();
    emitBatchStateChange.mockClear();
  };
  return {
    notifyListeners,
    notifyListenersBatch,
    emitStateChange,
    emitBatchStateChange,
    __reset,
  };
});

vi.mock("../../../../../js/agents/plugins/memory/state-engine.persistence.js", () => {
  const createSnapshot = vi.fn((state) => ({ state, encoding: "json" }));
  const restoreSnapshot = vi.fn((engine, snapshot) => {
    if (snapshot && snapshot.state) {
      engine._state = snapshot.state;
    }
    return true;
  });
  const saveCheckpoint = vi.fn((engine, options) => ({
    id: "checkpoint-1",
    options,
  }));
  const restoreCheckpoint = vi.fn(() => true);
  const __reset = () => {
    createSnapshot.mockClear();
    restoreSnapshot.mockClear();
    saveCheckpoint.mockClear();
    restoreCheckpoint.mockClear();
  };
  return {
    createSnapshot,
    restoreSnapshot,
    saveCheckpoint,
    restoreCheckpoint,
    __reset,
  };
});

import { StateEngine } from "../../../../../js/agents/plugins/memory/state-engine.js";
import * as lamportClock from "../../../../../js/agents/core/lamport-clock.js";
import * as shared from "../../../../../js/agents/shared/index.js";
import * as stateDiff from "../../../../../js/agents/plugins/memory/state-diff.js";
import * as reducers from "../../../../../js/agents/plugins/memory/state-engine.reducers.js";
import * as events from "../../../../../js/agents/plugins/memory/state-engine.events.js";
import * as persistence from "../../../../../js/agents/plugins/memory/state-engine.persistence.js";

const createDeepObject = (depth) => {
  let obj = { value: "end" };
  for (let i = 0; i < depth; i += 1) {
    obj = { level: i, next: obj };
  }
  return obj;
};

beforeEach(() => {
  lamportClock.__reset();
  shared.__reset();
  stateDiff.__reset();
  reducers.__reset();
  events.__reset();
  persistence.__reset();
});

describe("StateEngine", () => {
  it("initializes state from defaults and returns cloned state", () => {
    const engine = new StateEngine();
    expect(reducers.createInitialState).toHaveBeenCalledTimes(1);

    const state = engine.getState();
    expect(state).toEqual({
      runId: "run-default",
      count: 0,
      layers: { L0: {}, L1: {}, L2: {}, L3: {} },
    });
    expect(state).not.toBe(engine._getStateRef());
    expect(stateDiff.cloneJson).toHaveBeenCalledTimes(1);

    state.count = 99;
    expect(engine._getStateRef().count).toBe(0);
    expect(engine._actorId).toBe("run-default");

    const emptyInit = new StateEngine({ initialState: {} });
    expect(emptyInit._getStateRef().runId).toBe("run-default");
  });

  it("merges initialState and respects actorId overrides", () => {
    const engine = new StateEngine({
      initialState: { runId: "run-custom", count: 5, extra: { ok: true } },
    });

    expect(engine._getStateRef().runId).toBe("run-custom");
    expect(engine._getStateRef().count).toBe(5);
    expect(engine._getStateRef().extra).toEqual({ ok: true });
    expect(engine._actorId).toBe("run-custom");

    const whitespaceEngine = new StateEngine({ actorId: " " });
    const result = whitespaceEngine.dispatchSync({ type: " ", payload: {} });
    expect(result.meta.actorId).toBe(" ");
  });

  it("reports queue metrics accurately", () => {
    const engine = new StateEngine({ maxQueueSize: 4 });
    engine._dispatchQueue.push({ action: { type: "A" } }, { action: { type: "B" } });
    engine._isDispatching = true;

    expect(engine.getQueueMetrics()).toEqual({
      queueSize: 2,
      maxQueueSize: 4,
      isDispatching: true,
      totalDropped: 0,
      utilizationPercent: 50,
    });
  });

  it("throws for invalid actions in dispatch and dispatchSync", () => {
    const engine = new StateEngine();
    const invalidActions = [null, undefined, {}, { type: "" }, { type: 0 }, { type: false }];

    for (const action of invalidActions) {
      expect(() => engine.dispatchSync(action)).toThrow(TypeError);
      expect(() => engine.dispatch(action)).toThrow(TypeError);
    }
  });

  it("dispatches actions with metadata, updates state, and notifies listeners", async () => {
    const eventBus = { emit: vi.fn() };
    const engine = new StateEngine({ eventBus });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(123456);

    const prevState = engine._getStateRef();
    const result = await engine.dispatch({
      type: "INCREMENT",
      payload: 3,
      meta: { source: "test" },
    });
    nowSpy.mockRestore();

    expect(result.meta).toMatchObject({
      ts: 123456,
      seq: 1,
      actorId: "run-default",
      source: "test",
    });
    expect(result.type).toBe("INCREMENT");
    expect(reducers.rootReducer).toHaveBeenCalledTimes(1);

    const nextState = engine._getStateRef();
    expect(nextState).not.toBe(prevState);
    expect(nextState.count).toBe(1);

    expect(events.notifyListeners).toHaveBeenCalledTimes(1);
    expect(events.emitStateChange).toHaveBeenCalledTimes(1);
    expect(events.emitStateChange).toHaveBeenCalledWith(eventBus, result, nextState);

    const history = engine.getActionHistory();
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("INCREMENT");
  });

  it("uses Date.now when meta.ts is 0 and keeps other meta", () => {
    const engine = new StateEngine();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(456);

    const result = engine.dispatchSync({
      type: "SET_PAYLOAD",
      payload: { a: 1 },
      meta: { ts: 0, tag: "zero" },
    });
    nowSpy.mockRestore();

    expect(result.meta.ts).toBe(456);
    expect(result.meta.tag).toBe("zero");
  });

  it("does not notify or record history when state does not change", () => {
    const engine = new StateEngine();
    const prevState = engine._getStateRef();

    const result = engine.dispatchSync({ type: "NO_CHANGE" });
    expect(result.type).toBe("NO_CHANGE");
    expect(engine._getStateRef()).toBe(prevState);
    expect(events.notifyListeners).not.toHaveBeenCalled();
    expect(events.emitStateChange).not.toHaveBeenCalled();
    expect(engine.getActionHistory()).toEqual([]);
  });

  it("caps action history size and returns cloned entries", () => {
    const engine = new StateEngine({ maxActionHistory: 2 });

    engine.dispatchSync({ type: "A", payload: 1 });
    engine.dispatchSync({ type: "B", payload: 2 });
    engine.dispatchSync({ type: "C", payload: 3 });

    const history = engine.getActionHistory();
    expect(history).toHaveLength(2);
    expect(history.map((item) => item.type)).toEqual(["B", "C"]);
    expect(history[0]).not.toBe(engine._actionHistory[0]);
  });

  it("returns empty action history when disabled", () => {
    const engine = new StateEngine({ enableActionHistory: false });
    engine.dispatchSync({ type: "INCREMENT" });

    expect(engine.getActionHistory()).toEqual([]);
    expect(stateDiff.cloneJson).not.toHaveBeenCalled();
  });

  it("handles action history limits for boundary and type values", () => {
    const engine = new StateEngine();
    engine.dispatchSync({ type: "A" });
    engine.dispatchSync({ type: "B" });
    engine.dispatchSync({ type: "C" });

    expect(engine.getActionHistory(0)).toHaveLength(3);
    expect(engine.getActionHistory(-1)).toHaveLength(3);
    expect(engine.getActionHistory(Number.MAX_SAFE_INTEGER)).toHaveLength(3);
    expect(engine.getActionHistory("2")).toHaveLength(3);
  });

  it("returns empty array for invalid or empty batch inputs", async () => {
    const engine = new StateEngine();

    expect(await engine.dispatchBatch([])).toEqual([]);
    expect(await engine.dispatchBatch(null)).toEqual([]);
    expect(await engine.dispatchBatch(undefined)).toEqual([]);
    expect(await engine.dispatchBatch({})).toEqual([]);
    expect(reducers.rootReducer).not.toHaveBeenCalled();
  });

  it("throws when batch contains invalid actions", async () => {
    const engine = new StateEngine();
    await expect(engine.dispatchBatch([{ type: "OK" }, null])).rejects.toThrow(TypeError);
  });

  it("dispatches batch atomically with shared seq and notifies once", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(999);
    const engine = new StateEngine({ actorId: "actor-1" });
    const actions = [
      { type: "INCREMENT", payload: 1 },
      { type: "INCREMENT", payload: 1 },
    ];

    const result = await engine.dispatchBatch(actions);
    nowSpy.mockRestore();

    expect(result).toHaveLength(2);
    expect(result[0].meta.seq).toBe(result[1].meta.seq);
    expect(result[0].meta.ts).toBe(999);
    expect(result[1].meta.batchIndex).toBe(1);
    expect(result[1].meta.batchSize).toBe(2);
    expect(result[0].meta.actorId).toBe("actor-1");

    expect(events.notifyListenersBatch).toHaveBeenCalledTimes(1);
    expect(events.emitBatchStateChange).toHaveBeenCalledTimes(1);
    expect(reducers.rootReducer).toHaveBeenCalledTimes(2);
    expect(reducers.rootReducer.mock.calls[0][0].count).toBe(0);
    expect(reducers.rootReducer.mock.calls[1][0].count).toBe(1);
    expect(engine.getActionHistory()).toHaveLength(2);
  });

  it("skips batch notifications when state does not change", async () => {
    const engine = new StateEngine();
    reducers.rootReducer.mockImplementation((state) => state);

    const result = await engine.dispatchBatch([{ type: "NO_CHANGE" }]);
    expect(result).toHaveLength(1);
    expect(events.notifyListenersBatch).not.toHaveBeenCalled();
    expect(events.emitBatchStateChange).not.toHaveBeenCalled();
    expect(engine.getActionHistory()).toEqual([]);
  });

  it("dispatches batch synchronously and returns enriched actions", () => {
    const engine = new StateEngine({ actorId: "sync-actor" });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(555);

    expect(engine.dispatchBatchSync([])).toEqual([]);
    const result = engine.dispatchBatchSync([{ type: "INCREMENT" }]);
    nowSpy.mockRestore();

    expect(result).toHaveLength(1);
    expect(result[0].meta.batchSize).toBe(1);
    expect(result[0].meta.actorId).toBe("sync-actor");
    expect(events.notifyListenersBatch).toHaveBeenCalledTimes(1);
  });

  it("manages subscriptions and layer subscriptions", () => {
    const engine = new StateEngine();
    expect(() => engine.subscribe(null)).toThrow(TypeError);

    const listener = vi.fn();
    const unsubscribe = engine.subscribe(listener);
    expect(engine._listeners.has(listener)).toBe(true);
    unsubscribe();
    expect(engine._listeners.has(listener)).toBe(false);

    const layerListener = vi.fn();
    const layerUnsub = engine.subscribeLayer("L1", layerListener);
    expect(engine._layerListeners.get("L1").has(layerListener)).toBe(true);
    layerUnsub();
    expect(engine._layerListeners.get("L1").has(layerListener)).toBe(false);
  });

  it("routes layer subscriptions through subscribe", () => {
    const engine = new StateEngine();
    const spy = vi.spyOn(engine, "subscribeLayer");
    const layerListener = vi.fn();

    engine.subscribe("L0", layerListener);
    expect(spy).toHaveBeenCalledWith("L0", layerListener);
  });

  it("validates layer subscription inputs", () => {
    const engine = new StateEngine();
    expect(() => engine.subscribeLayer("L9", vi.fn())).toThrow(Error);
    expect(() => engine.subscribeLayer("L0", null)).toThrow(TypeError);
  });

  it("syncs Lamport clock values", () => {
    const engine = new StateEngine();
    expect(engine.getClockValue()).toBe(0);

    engine.receiveClockValue(10);
    expect(lamportClock.sync).toHaveBeenCalledWith(10);
    expect(lamportClock.nextTick).toHaveBeenCalledTimes(1);
    expect(engine.getClockValue()).toBe(11);
  });

  it("delegates snapshot and checkpoint operations", () => {
    const engine = new StateEngine();
    const snapshot = engine.createSnapshot();
    expect(persistence.createSnapshot).toHaveBeenCalledWith(engine._getStateRef());
    expect(snapshot).toEqual({ state: engine._getStateRef(), encoding: "json" });

    const restoreResult = engine.restoreSnapshot({
      state: { runId: "restored", count: 7, layers: { L0: {}, L1: {}, L2: {}, L3: {} } },
    });
    expect(persistence.restoreSnapshot).toHaveBeenCalled();
    expect(restoreResult).toBe(true);
    expect(engine._getStateRef().runId).toBe("restored");

    const checkpoint = engine.saveCheckpoint({ fullSnapshotEvery: 2 });
    expect(persistence.saveCheckpoint).toHaveBeenCalledWith(engine, { fullSnapshotEvery: 2 });
    expect(checkpoint).toEqual({ id: "checkpoint-1", options: { fullSnapshotEvery: 2 } });

    const restored = engine.restoreCheckpoint("checkpoint-1");
    expect(persistence.restoreCheckpoint).toHaveBeenCalledWith(engine, "checkpoint-1");
    expect(restored).toBe(true);
  });

  it("replays actions from an optional initial state", () => {
    const engine = new StateEngine();
    const actions = [{ type: "INCREMENT" }, { type: "INCREMENT" }];

    const result = engine.replay(actions, { count: 5, runId: "replay-run" });
    expect(result.count).toBe(7);
    expect(reducers.rootReducer).toHaveBeenCalledTimes(2);
  });

  it("resets state and notifies listeners", () => {
    const engine = new StateEngine();
    engine.dispatchSync({ type: "INCREMENT" });
    events.notifyListeners.mockClear();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(777);

    engine.reset({ runId: "reset-run", count: 42 });
    nowSpy.mockRestore();

    expect(engine._getStateRef().runId).toBe("reset-run");
    expect(engine._getStateRef().count).toBe(42);
    expect(engine._actorId).toBe("reset-run");
    expect(engine._actionHistory).toHaveLength(0);
    expect(events.notifyListeners).toHaveBeenCalledTimes(1);
    expect(events.notifyListeners.mock.calls[0][2].type).toBe("@@RESET");
    expect(events.notifyListeners.mock.calls[0][2].meta.seq).toBe(0);
  });

  it("handles deep and large payloads without mutation", () => {
    const engine = new StateEngine();
    const deepPayload = createDeepObject(20);
    const largeString = "x".repeat(100000);
    const payload = { deep: deepPayload, blob: largeString, empty: {} };

    const result = engine.dispatchSync({ type: "SET_DEEP", payload });
    expect(result.payload).toEqual(payload);
    expect(engine._getStateRef().deep).toEqual(payload);
  });

  it("cleans up resources on dispose", () => {
    const engine = new StateEngine();
    const listener = vi.fn();

    engine.subscribe(listener);
    engine.subscribeLayer("L0", vi.fn());
    engine._dispatchQueue.push({ action: { type: "A" } });
    engine._checkpoints.set("c1", { state: {} });
    engine.dispatchSync({ type: "INCREMENT" });
    engine.dispose();

    expect(engine._listeners.size).toBe(0);
    expect(engine._layerListeners.size).toBe(0);
    expect(engine._dispatchQueue).toHaveLength(0);
    expect(engine._checkpoints.size).toBe(0);
    expect(engine._actionHistory).toHaveLength(0);
    expect(() => engine.dispatch({ type: "INCREMENT" })).toThrow();
  });

  it("drops oldest queued action when queue overflows", async () => {
    const eventBus = { emit: vi.fn() };
    const engine = new StateEngine({ maxQueueSize: 1, eventBus });
    engine._isDispatching = true;

    const firstPromise = engine.dispatch({ type: "A" });
    const secondPromise = engine.dispatch({ type: "B" });

    const firstResult = await firstPromise;
    expect(firstResult).toEqual({ dropped: true, reason: "queue_overflow" });
    expect(eventBus.emit).toHaveBeenCalledWith("stateEngine:queueOverflow", {
      dropped: 1,
      totalDropped: 1,
      queueSize: 0,
      maxQueueSize: 1,
    });
    expect(shared.__logger.warn).toHaveBeenCalled();

    engine._isDispatching = false;
    await engine._processQueue();
    const secondResult = await secondPromise;

    expect(secondResult.type).toBe("B");
    expect(engine.getQueueMetrics().totalDropped).toBe(1);
  });

  it("serializes concurrent dispatches and preserves order", async () => {
    const engine = new StateEngine();
    const [first, second] = await Promise.all([
      engine.dispatch({ type: "INCREMENT" }),
      engine.dispatch({ type: "INCREMENT" }),
    ]);

    expect(first.meta.seq).toBe(1);
    expect(second.meta.seq).toBe(2);
    expect(engine._getStateRef().count).toBe(2);
    expect(reducers.rootReducer).toHaveBeenCalledTimes(2);
  });
});
