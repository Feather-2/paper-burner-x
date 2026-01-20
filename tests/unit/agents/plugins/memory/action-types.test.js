import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const timerMocks = vi.hoisted(() => ({
  setTimeout: vi.fn((fn) => {
    if (typeof fn === "function") {
      fn();
    }
    return 0;
  }),
  clearTimeout: vi.fn(),
}));

vi.mock("node:timers", () => timerMocks);

import { setTimeout as mockedSetTimeout } from "node:timers";
import * as actionTypes from "../../../../../js/agents/plugins/memory/action-types.js";

const FIXED_TS = 1_700_000_000_000;
const LONG_STRING = "x".repeat(50_000);
const HUGE_FILE_CONTENT = "f".repeat(1024 * 1024);

const buildExpectedAction = (type, payload, metaOverrides = {}) => ({
  type,
  payload,
  meta: {
    ts: FIXED_TS,
    ...metaOverrides,
  },
});

const buildDeepNested = (depth) => {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  current.leaf = "end";
  return root;
};

let dateNowSpy;

beforeEach(() => {
  vi.clearAllMocks();
  dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(FIXED_TS);
});

afterEach(() => {
  dateNowSpy.mockRestore();
});

describe("createAction", () => {
  it("builds action with timestamped meta", () => {
    const action = actionTypes.createAction("TEST", { value: 1 });

    expect(action).toEqual(buildExpectedAction("TEST", { value: 1 }));
    expect(dateNowSpy).toHaveBeenCalledTimes(1);
  });

  it("merges meta and honors explicit ts override", () => {
    const withMeta = actionTypes.createAction("TYPE", { value: 2 }, {
      seq: 7,
      actor: "tester",
    });

    expect(withMeta).toEqual(
      buildExpectedAction("TYPE", { value: 2 }, { seq: 7, actor: "tester" }),
    );

    const override = actionTypes.createAction("TYPE", { value: 3 }, { ts: 99, seq: 9 });

    expect(override).toEqual({
      type: "TYPE",
      payload: { value: 3 },
      meta: { ts: 99, seq: 9 },
    });
    expect(dateNowSpy).toHaveBeenCalledTimes(2);
  });

  it("supports null payloads and non-string types", () => {
    const action = actionTypes.createAction(0, null);

    expect(action).toEqual(buildExpectedAction(0, null));
  });

  it("handles null meta by defaulting to timestamp", () => {
    const action = actionTypes.createAction("TEST", {}, null);

    expect(action).toEqual(buildExpectedAction("TEST", {}));
  });

  it("creates distinct actions when invoked concurrently", async () => {
    const [first, second] = await Promise.all([
      new Promise((resolve) =>
        mockedSetTimeout(() => resolve(actionTypes.createAction("A", { index: 0 })), 0),
      ),
      new Promise((resolve) =>
        mockedSetTimeout(() => resolve(actionTypes.createAction("B", { index: 1 })), 0),
      ),
    ]);

    expect(first).not.toBe(second);
    expect(mockedSetTimeout).toHaveBeenCalledTimes(2);
  });

  it("handles rapid consecutive calls with sequential timestamps", () => {
    dateNowSpy.mockReset();
    dateNowSpy
      .mockImplementationOnce(() => 1)
      .mockImplementationOnce(() => 2)
      .mockImplementationOnce(() => 3);

    const actions = [
      actionTypes.createAction("FAST", { index: 0 }),
      actionTypes.createAction("FAST", { index: 1 }),
      actionTypes.createAction("FAST", { index: 2 }),
    ];

    expect(actions.map((action) => action.meta.ts)).toEqual([1, 2, 3]);
  });
});

describe("setSystemPrompt", () => {
  it.each([
    ["standard", "system"],
    ["empty", ""],
  ])("creates action for %s prompt", (_label, prompt) => {
    const action = actionTypes.setSystemPrompt(prompt);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L0_SET_SYSTEM_PROMPT, { prompt }),
    );
  });
});

describe("setTaskGoal", () => {
  it.each([
    ["whitespace", "   "],
    ["undefined", undefined],
  ])("creates action for %s goal", (_label, goal) => {
    const action = actionTypes.setTaskGoal(goal);

    expect(action).toEqual(buildExpectedAction(actionTypes.L0_SET_TASK_GOAL, { goal }));
  });
});

describe("addTodo", () => {
  it("creates action for empty todo", () => {
    const action = actionTypes.addTodo({});

    expect(action).toEqual(buildExpectedAction(actionTypes.L0_ADD_TODO, { todo: {} }));
  });

  it("handles huge file payloads", () => {
    const todo = { id: "file-1", content: HUGE_FILE_CONTENT };
    const action = actionTypes.addTodo(todo);

    expect(action).toEqual(buildExpectedAction(actionTypes.L0_ADD_TODO, { todo }));
    expect(action.payload.todo.content.length).toBe(HUGE_FILE_CONTENT.length);
  });
});

describe("updateTodo", () => {
  it("creates action with numeric id and nested updates", () => {
    const updates = buildDeepNested(12);
    const action = actionTypes.updateTodo(0, updates);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L0_UPDATE_TODO, { id: 0, updates }),
    );
  });
});

describe("removeTodo", () => {
  it("creates action for negative id", () => {
    const action = actionTypes.removeTodo(-1);

    expect(action).toEqual(buildExpectedAction(actionTypes.L0_REMOVE_TODO, { id: -1 }));
  });
});

describe("replaceTodos", () => {
  it.each([
    ["empty array", []],
    ["object instead of array", { id: "oops" }],
  ])("creates action for %s", (_label, todos) => {
    const action = actionTypes.replaceTodos(todos);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L0_REPLACE_TODOS, { todos }),
    );
  });
});

describe("addMessage", () => {
  it("creates action for null message", () => {
    const action = actionTypes.addMessage(null);

    expect(action).toEqual(buildExpectedAction(actionTypes.L1_ADD_MESSAGE, { message: null }));
  });
});

describe("addMessages", () => {
  it("creates action for empty message array", () => {
    const action = actionTypes.addMessages([]);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L1_ADD_MESSAGES, { messages: [] }),
    );
  });
});

describe("clearMessages", () => {
  it("creates action with empty payload", () => {
    const action = actionTypes.clearMessages();

    expect(action).toEqual(buildExpectedAction(actionTypes.L1_CLEAR_MESSAGES, {}));
  });
});

describe("setMessages", () => {
  it("creates action for empty list", () => {
    const action = actionTypes.setMessages([]);

    expect(action).toEqual(buildExpectedAction(actionTypes.L1_SET_MESSAGES, { messages: [] }));
  });
});

describe("setDeck", () => {
  it("creates action for empty deck object", () => {
    const deck = {};
    const action = actionTypes.setDeck(deck);

    expect(action).toEqual(buildExpectedAction(actionTypes.L1_SET_DECK, { deck }));
  });
});

describe("addSignal", () => {
  it("creates action for signal payload", () => {
    const signal = { id: "signal-1", status: "new" };
    const action = actionTypes.addSignal(signal);

    expect(action).toEqual(buildExpectedAction(actionTypes.L1_ADD_SIGNAL, { signal }));
  });
});

describe("acknowledgeSignal", () => {
  it("creates action for signal id", () => {
    const action = actionTypes.acknowledgeSignal("signal-1");

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L1_ACKNOWLEDGE_SIGNAL, { id: "signal-1" }),
    );
  });
});

describe("recordDecision", () => {
  it("creates action for decision object", () => {
    const decision = { id: "decision-1", outcome: "approve" };
    const action = actionTypes.recordDecision(decision);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L1_RECORD_DECISION, { decision }),
    );
  });
});

describe("setScratchpad", () => {
  it("creates action for empty key and null value", () => {
    const action = actionTypes.setScratchpad("", null);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L1_SET_SCRATCHPAD, { key: "", value: null }),
    );
  });
});

describe("clearScratchpad", () => {
  it("creates action with empty payload", () => {
    const action = actionTypes.clearScratchpad();

    expect(action).toEqual(buildExpectedAction(actionTypes.L1_CLEAR_SCRATCHPAD, {}));
  });
});

describe("setFlag", () => {
  it("creates action for whitespace name and string value", () => {
    const action = actionTypes.setFlag("   ", "true");

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L1_SET_FLAG, { name: "   ", value: "true" }),
    );
  });
});

describe("syncDiscovery", () => {
  it("creates action for discovery payload", () => {
    const action = actionTypes.syncDiscovery("disc-1", { status: "ready" });

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L1_SYNC_DISCOVERY, {
        id: "disc-1",
        data: { status: "ready" },
      }),
    );
  });
});

describe("syncSubagent", () => {
  it("creates action for subagent payload", () => {
    const action = actionTypes.syncSubagent("agent-1", { status: "ok" });

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L1_SYNC_SUBAGENT, {
        id: "agent-1",
        data: { status: "ok" },
      }),
    );
  });
});

describe("setHistorySummary", () => {
  it("creates action for long summary", () => {
    const action = actionTypes.setHistorySummary(LONG_STRING);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L2_SET_HISTORY_SUMMARY, { summary: LONG_STRING }),
    );
  });
});

describe("appendHistorySummary", () => {
  it("creates action for summary append", () => {
    const action = actionTypes.appendHistorySummary("delta");

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L2_APPEND_HISTORY_SUMMARY, { summary: "delta" }),
    );
  });
});

describe("setStageSummary", () => {
  it("creates action with numeric string stage and undefined summary", () => {
    const action = actionTypes.setStageSummary("1", undefined);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L2_SET_STAGE_SUMMARY, {
        stage: "1",
        summary: undefined,
      }),
    );
  });
});

describe("addSummary", () => {
  it("creates action for empty summary object", () => {
    const summary = {};
    const action = actionTypes.addSummary(summary);

    expect(action).toEqual(buildExpectedAction(actionTypes.L2_ADD_SUMMARY, { summary }));
  });
});

describe("recordCondensedDecision", () => {
  it("creates action for condensed decision", () => {
    const decision = { id: "cd-1", outcome: "reject" };
    const action = actionTypes.recordCondensedDecision(decision);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L2_RECORD_DECISION, { decision }),
    );
  });
});

describe("addClaim", () => {
  it("creates action for claim", () => {
    const claim = { id: "claim-1", text: "evidence" };
    const action = actionTypes.addClaim(claim);

    expect(action).toEqual(buildExpectedAction(actionTypes.L2_ADD_CLAIM, { claim }));
  });
});

describe("replaceClaims", () => {
  it("creates action for object instead of array", () => {
    const claims = { id: "claim-1" };
    const action = actionTypes.replaceClaims(claims);

    expect(action).toEqual(buildExpectedAction(actionTypes.L2_REPLACE_CLAIMS, { claims }));
  });
});

describe("archive", () => {
  it("creates action for deep archive payload", () => {
    const data = buildDeepNested(20);
    const action = actionTypes.archive("stage-1", data, []);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L3_ARCHIVE, {
        stageKey: "stage-1",
        data,
        keywords: [],
      }),
    );
  });
});

describe("addCheckpoint", () => {
  it("creates action for null checkpoint", () => {
    const action = actionTypes.addCheckpoint(null);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.L3_ADD_CHECKPOINT, { checkpoint: null }),
    );
  });
});

describe("compress", () => {
  it("creates action with default options", () => {
    const action = actionTypes.compress();

    expect(action).toEqual(buildExpectedAction(actionTypes.COMPRESS, {}));
  });

  it("creates action with explicit options", () => {
    const options = { level: 0, notes: "" };
    const action = actionTypes.compress(options);

    expect(action).toEqual(buildExpectedAction(actionTypes.COMPRESS, options));
  });
});

describe("restoreSnapshot", () => {
  it("creates action for null snapshot", () => {
    const action = actionTypes.restoreSnapshot(null);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.RESTORE_SNAPSHOT, { snapshot: null }),
    );
  });
});

describe("restoreCheckpoint", () => {
  it("creates action for max safe integer checkpoint id", () => {
    const checkpointId = Number.MAX_SAFE_INTEGER;
    const action = actionTypes.restoreCheckpoint(checkpointId);

    expect(action).toEqual(
      buildExpectedAction(actionTypes.RESTORE_CHECKPOINT, { checkpointId }),
    );
  });
});

describe("batch", () => {
  it("creates action for empty action list", () => {
    const action = actionTypes.batch([]);

    expect(action).toEqual(buildExpectedAction(actionTypes.BATCH, { actions: [] }));
  });
});

describe("isValidActionType", () => {
  it("returns true for known action types", () => {
    const results = actionTypes.ALL_ACTIONS.map((type) =>
      actionTypes.isValidActionType(type),
    );

    expect(results.every(Boolean)).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace", "   "],
    ["unknown", "UNKNOWN"],
    ["number", 123],
    ["object", { type: "L0" }],
    ["array", []],
  ])("returns false for %s", (_label, value) => {
    expect(actionTypes.isValidActionType(value)).toBe(false);
  });
});

describe("getActionLayer", () => {
  it.each([
    ["L0", actionTypes.L0_SET_SYSTEM_PROMPT, "L0"],
    ["L1", actionTypes.L1_ADD_MESSAGE, "L1"],
    ["L2", actionTypes.L2_SET_HISTORY_SUMMARY, "L2"],
    ["L3", actionTypes.L3_ARCHIVE, "L3"],
  ])("returns %s for %s", (_label, type, expected) => {
    expect(actionTypes.getActionLayer(type)).toBe(expected);
  });

  it.each([
    ["invalid", "NOPE"],
    ["null", null],
    ["number", 0],
  ])("returns null for %s", (_label, value) => {
    expect(actionTypes.getActionLayer(value)).toBeNull();
  });
});
