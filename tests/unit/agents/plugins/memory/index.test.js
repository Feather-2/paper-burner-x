import { describe, it, expect, vi, beforeEach } from "vitest";

let lamportSeq = 0;

vi.mock("../../../../../js/agents/core/lamport-clock.js", () => ({
  nextTick: () => ({ seq: ++lamportSeq }),
  sync: vi.fn((value) => {
    if (typeof value === "number" && Number.isFinite(value) && value > lamportSeq) {
      lamportSeq = value;
    }
  }),
  currentSeq: () => lamportSeq,
}));

vi.mock("../../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../../js/agents/shared/index.js");
  class FakeEmbeddingService {
    constructor() {
      this.embedCalls = [];
      this.enqueueCalls = [];
    }
    async embed(texts) {
      this.embedCalls.push(texts);
      return texts.map((text, index) => [String(text).length, index]);
    }
    async enqueue(texts) {
      this.enqueueCalls.push(texts);
      return texts.map((text, index) => [String(text).length, index]);
    }
  }
  class FakeVectorIndex {
    constructor({ maxItems } = {}) {
      this.maxItems = maxItems;
      this._store = new Map();
    }
    upsert(id, vector, meta) {
      this._store.set(id, { vector, meta });
    }
    has(id) {
      return this._store.has(id);
    }
    search(vector, { topK } = {}) {
      const items = Array.from(this._store.keys()).map((id, idx) => ({
        id,
        score: 1 / (idx + 1),
      }));
      if (typeof topK === "number" && topK >= 0) return items.slice(0, topK);
      return items;
    }
  }
  return {
    ...actual,
    EmbeddingService: FakeEmbeddingService,
    VectorIndex: FakeVectorIndex,
  };
});

import MemoryStoreDefault, {
  MemoryStore,
  StateEngine,
  createInitialState,
  rootReducer,
  UnifiedMemoryStore,
  RetrievalEngine,
  L0_SET_SYSTEM_PROMPT,
  L1_ADD_MESSAGE,
  L1_ADD_MESSAGES,
  L1_SET_DECK,
  BATCH,
  RESTORE_SNAPSHOT,
} from "../../../../../js/agents/plugins/memory/index.js";
import { EmbeddingService, VectorIndex } from "../../../../../js/agents/shared/index.js";

const LONG_TEXT = "x".repeat(50000);
const HUGE_TEXT = "y".repeat(100000);

const makeEventBus = () => {
  const handlers = new Map();
  return {
    emit: vi.fn((event, payload) => {
      const set = handlers.get(event);
      if (set) {
        for (const fn of Array.from(set)) {
          fn(payload);
        }
      }
    }),
    on: vi.fn((event, handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      return () => handlers.get(event).delete(handler);
    }),
  };
};

const buildSnapshots = () =>
  new Map([
    ["a1", { summary: "alpha one", data: { text: "file1" }, stageKey: "s1", ts: 1 }],
    ["a2", { summary: HUGE_TEXT, data: { text: "file2" }, stageKey: "s1", ts: 2 }],
    ["a3", { summary: "beta three", data: { text: "file3" }, stageKey: "s2", ts: 3 }],
  ]);

const buildTimeline = () => [
  { id: "a1", summary: "alpha one", ts: 1 },
  { id: "a2", summary: HUGE_TEXT, ts: 2 },
  { id: "a3", summary: "beta three", ts: 3 },
];

const buildKeywordIndex = () =>
  new Map([
    ["alpha", ["a1", "a2"]],
    ["beta", new Set(["a2", "a3"])],
  ]);

const makeMemoryStoreStub = () => ({
  config: { vectorMaxItems: 10 },
  eventBus: makeEventBus(),
  L3: {
    snapshots: buildSnapshots(),
    index: { timeline: buildTimeline(), keywords: buildKeywordIndex(), stages: {} },
    checkpoints: [],
  },
});

beforeEach(() => {
  lamportSeq = 0;
  vi.clearAllMocks();
});

describe("MemoryStore", () => {
  it("initializes with defaults and boundary config", () => {
    const store = new MemoryStore({ runId: "   ", config: { maxMessages: 0 }, tokenCounter: null });
    expect(store.runId.trim().length).toBeGreaterThan(0);
    expect(store.config.maxMessages).toBe(0);
    expect(store.config.maxSignals).toBeGreaterThan(0);
  });

  it("addTodo/updateTodo/removeTodo handle nulls and invalid input", () => {
    const store = new MemoryStore({ tokenCounter: null });
    const added = store.addTodo(null);
    expect(added).toBeTruthy();
    expect(added.id).toBeTruthy();
    expect(store.getTodos().length).toBe(1);

    expect(store.updateTodo("", { status: "done" })).toBeNull();

    const unchanged = store.updateTodo(added.id, "bad");
    expect(unchanged.id).toBe(added.id);
    expect(unchanged.status).toBe("pending");

    const updated = store.updateTodo(added.id, { status: "done", priority: "high" });
    expect(updated.status).toBe("completed");
    expect(updated.priority).toBe("high");

    expect(store.removeTodo(undefined)).toBeNull();
    const removed = store.removeTodo(added.id);
    expect(removed.id).toBe(added.id);
    expect(store.getTodos().length).toBe(0);
  });

  it("addMessage/addMessages handle boundary values and long strings", () => {
    const store = new MemoryStore({ tokenCounter: null });
    const msg0 = store.addMessage(0);
    expect(msg0.content).toBe("0");

    const msgWhitespace = store.addMessage("   ");
    expect(msgWhitespace.content).toBe("   ");

    expect(store.addMessages({})).toEqual([]);
    expect(store.addMessages([])).toEqual([]);

    store.addMessage(LONG_TEXT);
    const messages = store.getMessages();
    expect(messages[messages.length - 1].content.length).toBe(LONG_TEXT.length);
  });

  it("setScratchpad ignores unsafe keys and supports deep nesting", () => {
    const store = new MemoryStore({ tokenCounter: null });
    const deep = { level1: { level2: { level3: { value: 42 } } } };
    store.setScratchpad({ constructor: "bad", safe: deep });
    const scratch = store.getScratchpad();
    expect(Object.prototype.hasOwnProperty.call(scratch, "constructor")).toBe(false);
    expect(scratch.safe.level1.level2.level3.value).toBe(42);
  });
});

describe("default", () => {
  it("is the MemoryStore export and handles numeric runId", () => {
    expect(MemoryStoreDefault).toBe(MemoryStore);
    const store = new MemoryStoreDefault({ runId: 0, tokenCounter: null });
    expect(store.runId).toBe("0");
    const msg = store.addMessage("ok");
    expect(msg.content).toBe("ok");
  });
});

describe("StateEngine", () => {
  it("throws for invalid actions", () => {
    const engine = new StateEngine();
    expect(() => engine.dispatchSync(null)).toThrow(TypeError);
    expect(() => engine.dispatchSync({})).toThrow(TypeError);
    expect(() => engine.dispatch({})).toThrow(TypeError);
  });

  it("dispatchBatch handles empty arrays and validates actions", async () => {
    const engine = new StateEngine();
    await expect(engine.dispatchBatch([])).resolves.toEqual([]);
    await expect(engine.dispatchBatch([{}])).rejects.toThrow(TypeError);
    expect(engine.dispatchBatchSync({})).toEqual([]);
  });

  it("dispatch updates state and records metadata", async () => {
    const engine = new StateEngine({ actorId: "actor-1" });
    const action = await engine.dispatch({ type: L1_ADD_MESSAGE, payload: { message: "hi" } });
    expect(action.meta.actorId).toBe("actor-1");
    expect(action.meta.seq).toBe(1);
    const state = engine.getState();
    expect(state.L1.messages).toHaveLength(1);
    expect(state.L1.messages[0].content).toBe("hi");
  });

  it("handles concurrent dispatches and preserves all actions", async () => {
    const engine = new StateEngine();
    const actions = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        engine.dispatch({ type: L1_ADD_MESSAGE, payload: { message: `m${i}` } })
      )
    );
    expect(actions).toHaveLength(5);
    const seqs = actions.map((a) => a.meta.seq);
    const sorted = [...seqs].sort((a, b) => a - b);
    expect(seqs).toEqual(sorted);
    const state = engine.getState();
    expect(state.L1.messages).toHaveLength(5);
  });

  it("respects action history limits and boundary values", async () => {
    const engine = new StateEngine({ maxActionHistory: 0 });
    await engine.dispatch({ type: L1_ADD_MESSAGE, payload: { message: "x" } });
    expect(engine.getActionHistory()).toEqual([]);

    const engine2 = new StateEngine({ maxActionHistory: Number.MAX_SAFE_INTEGER });
    await engine2.dispatch({ type: L1_ADD_MESSAGE, payload: { message: "y" } });
    expect(engine2.getActionHistory("2").length).toBe(1);
    expect(engine2.getActionHistory(-1).length).toBe(1);
  });

  it("validates subscribers and layers", () => {
    const engine = new StateEngine();
    expect(() => engine.subscribe("bad")).toThrow(TypeError);
    expect(() => engine.subscribeLayer("L9", () => {})).toThrow();
  });
});

describe("createInitialState", () => {
  it("creates default structure", () => {
    const state = createInitialState();
    expect(state.L0.todos).toEqual([]);
    expect(state.L1.messages).toEqual([]);
    expect(state.L2.historySummary).toBe("");
    expect(state.L3.index.timeline).toEqual([]);
    expect(typeof state.runId).toBe("string");
    expect(state.runId.length).toBeGreaterThan(0);
  });

  it("handles runId boundaries and null input", () => {
    const whitespace = createInitialState({ runId: "   " });
    expect(whitespace.runId.trim().length).toBeGreaterThan(0);
    const numeric = createInitialState({ runId: 0 });
    expect(numeric.runId).toBe("0");
    expect(() => createInitialState(null)).toThrow();
  });
});

describe("rootReducer", () => {
  it("returns same state for unknown action", () => {
    const state = createInitialState({ runId: "run" });
    const next = rootReducer(state, { type: "UNKNOWN", payload: {} });
    expect(next).toBe(state);
  });

  it("applies batch actions and handles whitespace prompts", () => {
    const state = createInitialState({ runId: "run" });
    state.L0.systemPrompt = "keep";
    const next = rootReducer(state, {
      type: BATCH,
      payload: {
        actions: [
          { type: L0_SET_SYSTEM_PROMPT, payload: { prompt: "  " } },
          { type: L1_ADD_MESSAGE, payload: { message: "hi" } },
        ],
      },
    });
    expect(next).not.toBe(state);
    expect(next.L0.systemPrompt).toBe("");
    expect(next.L1.messages).toHaveLength(1);
  });

  it("ignores invalid snapshots and normalizes sync tables", () => {
    const state = createInitialState({ runId: "run" });
    const same = rootReducer(state, { type: RESTORE_SNAPSHOT, payload: { snapshot: null } });
    expect(same).toBe(state);

    const snapshot = {
      runId: "snap",
      L1: { syncTable: { discoveries: [], subagents: "bad" } },
    };
    const restored = rootReducer(state, { type: RESTORE_SNAPSHOT, payload: { snapshot } });
    expect(restored).not.toBe(state);
    expect(restored.L1.syncTable.discoveries).toEqual({});
    expect(restored.L1.syncTable.subagents).toEqual({});
  });

  it("ignores non-array messages payload", () => {
    const state = createInitialState({ runId: "run" });
    const next = rootReducer(state, { type: L1_ADD_MESSAGES, payload: { messages: {} } });
    expect(next).toBe(state);
  });

  it("clones deck payload for deep nested objects", () => {
    const state = createInitialState({ runId: "run" });
    const deck = { pages: [{ content: { nested: { value: 1 } } }] };
    const next = rootReducer(state, { type: L1_SET_DECK, payload: { deck } });
    expect(next).not.toBe(state);
    expect(next.L1.deck).toEqual(deck);
    expect(next.L1.deck).not.toBe(deck);
  });
});

describe("UnifiedMemoryStore", () => {
  it("supports write/query methods with boundary values", () => {
    const store = new UnifiedMemoryStore({ runId: " ", tokenCounter: null });
    expect(store.runId.trim().length).toBeGreaterThan(0);
    const msg = store.addMessage(0);
    expect(msg.content).toBe("0");
    expect(store.addMessages({})).toEqual([]);
    expect(store.replaceTodos([])).toEqual([]);
  });

  it("setScratchpad handles deep objects and unsafe keys", () => {
    const store = new UnifiedMemoryStore({ tokenCounter: null });
    const deep = { level1: { level2: { level3: { value: 7 } } } };
    store.setScratchpad({ constructor: "bad", safe: deep });
    const scratch = store.getScratchpad();
    expect(Object.prototype.hasOwnProperty.call(scratch, "constructor")).toBe(false);
    expect(scratch.safe.level1.level2.level3.value).toBe(7);
  });

  it("getDecisions respects limit boundaries", () => {
    const store = new UnifiedMemoryStore({ tokenCounter: null });
    store.recordDecision({ action: "a" });
    store.recordDecision({ action: "b" });
    expect(store.getDecisions(-1).length).toBe(2);
    expect(store.getDecisions(Number.MAX_SAFE_INTEGER).length).toBe(2);
  });
});

describe("RetrievalEngine", () => {
  it("requires a memoryStore", () => {
    expect(() => new RetrievalEngine({})).toThrow();
  });

  it("keywordRecall handles empty query, limit strings, and large summaries", () => {
    const store = makeMemoryStoreStub();
    const engine = new RetrievalEngine({ memoryStore: store, rateLimiter: null, subscribe: false });
    const results = engine.keywordRecall("   ", { limit: "2" });
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("a3");
    expect(results[1].id).toBe("a2");
    expect(results[1].summary.length).toBe(HUGE_TEXT.length);
  });

  it("keywordRecall ranks by keyword matches", () => {
    const store = makeMemoryStoreStub();
    const engine = new RetrievalEngine({ memoryStore: store, rateLimiter: null, subscribe: false });
    const results = engine.keywordRecall("alpha alpha beta", { limit: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("a2");
    expect(results[1].id).toBe("a1");
  });

  it("semanticRecall falls back when embeddings are unavailable", async () => {
    const store = makeMemoryStoreStub();
    const engine = new RetrievalEngine({ memoryStore: store, rateLimiter: null, subscribe: false });
    const fallback = engine.keywordRecall("alpha alpha beta", { limit: 1 });
    const results = await engine.semanticRecall("alpha alpha beta", { limit: 1, fallback: true });
    expect(results).toEqual(fallback);
  });

  it("semanticRecall returns vector results when available", async () => {
    const store = makeMemoryStoreStub();
    const engine = new RetrievalEngine({
      memoryStore: store,
      embeddingService: new EmbeddingService(),
      vectorIndex: new VectorIndex(),
      rateLimiter: null,
      subscribe: false,
    });
    const results = await engine.semanticRecall("alpha", { limit: 1, fallback: false });
    expect(results.length).toBe(1);
    expect(["a1", "a2", "a3"]).toContain(results[0].id);
  });

  it("queueIndexArchive handles rapid calls and queue overflow", async () => {
    const store = makeMemoryStoreStub();
    const engine = new RetrievalEngine({
      memoryStore: store,
      embeddingService: new EmbeddingService(),
      vectorIndex: new VectorIndex(),
      indexQueueMaxSize: 1,
      indexMaxConcurrent: 1,
      rateLimiter: null,
      subscribe: false,
    });
    expect(engine.queueIndexArchive(null)).toBe(false);

    const first = engine.queueIndexArchive("a1");
    const second = engine.queueIndexArchive("a2");
    const third = engine.queueIndexArchive("a3");
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(third).toBe(true);

    const stats = engine.getIndexQueueStats();
    expect(stats.maxSize).toBe(1);
    expect(stats.droppedCount).toBeGreaterThanOrEqual(1);

    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("reports warmup progress and isWarmed state", () => {
    const store = makeMemoryStoreStub();
    const engine = new RetrievalEngine({
      memoryStore: store,
      embeddingService: new EmbeddingService(),
      vectorIndex: new VectorIndex(),
      rateLimiter: null,
      subscribe: false,
    });

    expect(engine.isWarmed).toBe(false);
    engine.vectorIndex.upsert("a1", [1], {});
    engine.vectorIndex.upsert("a2", [1], {});
    engine.vectorIndex.upsert("a3", [1], {});
    expect(engine.isWarmed).toBe(true);

    const progress = engine.getWarmupProgress();
    expect(progress.total).toBe(3);
    expect(progress.indexed).toBe(3);
    expect(progress.coverage).toBe(1);
  });
});
