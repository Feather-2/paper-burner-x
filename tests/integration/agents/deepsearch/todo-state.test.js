import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("TodoStatus transitions update status/history and reject invalid moves", async () => {
  const { createTodo, transitionTodoStatus } = await import("../../../js/agents/stages/deepsearch/utils/todo-utils.js");

  const todo = createTodo({
    todoId: "t1",
    text: "Draft outline",
    status: "open",
    createdAt: "2020-01-01T00:00:00.000Z",
  });
  const createdAt = todo.updatedAt;

  expect(transitionTodoStatus(todo, "pending")).toBe(true);
  expect(todo.status).toBe("pending");
  expect(todo.updatedAt).not.toBe(createdAt);
  expect(todo.history.length >= 2).toBe(true);

  expect(transitionTodoStatus(todo, "completed")).toBe(true);
  expect(todo.status).toBe("completed");

  // 简化后允许任意有效状态转换
  expect(transitionTodoStatus(todo, "cancelled")).toBe(true);
  expect(todo.status).toBe("cancelled");
});

it("validateTodo enforces schema requirements", async () => {
  const { createTodo, validateTodo } = await import("../../../js/agents/stages/deepsearch/utils/todo-utils.js");

  const validTodo = createTodo({
    todoId: "t_valid",
    text: "Collect evidence",
    priority: "high",
    status: "open",
    queryHints: ["alpha", "beta"],
    expectedEvidence: "2 sources",
    source: "user",
  });
  const validResult = validateTodo(validTodo);
  expect(validResult.valid).toBe(true);
  expect(validResult.issues.length).toBe(0);

  const invalidResult = validateTodo({ text: "", status: "weird", queryHints: ["", 1], createdAt: "not-a-date" });
  expect(invalidResult.valid).toBe(false);
  expect(invalidResult.issues.some((issue) => issue.includes("todoId"))).toBe(true);
  expect(invalidResult.issues.some((issue) => issue.includes("status"))).toBe(true);
  expect(invalidResult.issues.some((issue) => issue.includes("queryHints"))).toBe(true);
  expect(invalidResult.issues.some((issue) => issue.includes("createdAt"))).toBe(true);
});

it("L2 control flags serialize/deserialize across minimal checkpoints", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_l2_flags",
    taskGoal: "t",
    userConfig: { checkpointStrategy: "minimal" },
  });
  state.setAwaitUserFeedback(true, "need user input");

  const cp = state.saveCheckpoint({ checkpointId: "cp_l2" });
  expect(cp.stateSnapshot.L2.awaitUserFeedback).toBe(true);
  expect(cp.stateSnapshot.L2.taskImpossible).toBe(false);
  expect(cp.stateSnapshot.L2.reason).toBe("need user input");

  state.setAwaitUserFeedback(false);
  state.L2.taskImpossible = false;
  state.L2.reason = "";
  state.restoreCheckpoint("cp_l2");

  expect(state.L2.awaitUserFeedback).toBe(true);
  expect(state.L2.reason).toBe("need user input");
});

it("loadCheckpoint migrates gaps into todos and stamps L2 flags", async () => {
  const { loadCheckpoint } = await import("../../../js/agents/stages/deepsearch/runtime/checkpoint.js");

  const checkpoint = {
    schemaVersion: "1.0",
    checkpointId: "cp_gap",
    iteration: 0,
    timestamp: new Date().toISOString(),
    stateSnapshot: {
      schemaVersion: "0.1",
      runId: "run_gap",
      createdAt: new Date().toISOString(),
      taskGoal: "t",
      L1: {
        gaps: [
          {
            gapId: "gap_1",
            type: "definition",
            question: "What is X?",
            priority: "high",
            status: "filled",
            queryHints: ["x"],
          },
        ],
      },
      L2: {},
    },
  };

  const loaded = loadCheckpoint(checkpoint);
  expect(loaded.stateSnapshot.todos).toBeInstanceOf(Array);
  expect(loaded.stateSnapshot.todos.length).toBe(1);
  const todo = loaded.stateSnapshot.todos[0];
  expect(todo.relatedGapId).toBe("gap_1");
  expect(todo.status).toBe("completed");
  expect(todo.priority).toBe("high");
  expect(loaded.stateSnapshot.L2.awaitUserFeedback).toBe(false);
  expect(loaded.stateSnapshot.L2.taskImpossible).toBe(false);
});

it("states helpers validate enums", async () => {
  const {
    GapPriority,
    GapStatus,
    TodoStatus,
    PlanNodeStatus,
    PlanNodeType,
    DecisionOutcome,
    DecisionStage,
    isValidGapPriority,
    isValidGapStatus,
    isValidTodoStatus,
    isValidPlanNodeStatus,
    isValidPlanNodeType,
    isValidDecisionOutcome,
    isValidDecisionStage,
  } = await import("../../../js/agents/stages/deepsearch/states.js");
  const { transitionTodoStatus } = await import("../../../js/agents/stages/deepsearch/utils/todo-utils.js");

  expect(isValidGapPriority(GapPriority.HIGH)).toBe(true);
  expect(isValidGapPriority("urgent")).toBe(false);
  expect(isValidGapStatus(GapStatus.OPEN)).toBe(true);
  expect(isValidGapStatus("done")).toBe(false);
  expect(isValidTodoStatus(TodoStatus.OPEN)).toBe(true);
  expect(isValidTodoStatus("waiting")).toBe(false);
  expect(isValidPlanNodeStatus(PlanNodeStatus.ACTIVE)).toBe(true);
  expect(isValidPlanNodeStatus("paused")).toBe(false);
  expect(isValidPlanNodeType(PlanNodeType.QUERY)).toBe(true);
  expect(isValidPlanNodeType("task")).toBe(false);
  expect(isValidDecisionOutcome(DecisionOutcome.SUCCESS)).toBe(true);
  expect(isValidDecisionOutcome("maybe")).toBe(false);
  expect(isValidDecisionStage(DecisionStage.SCAN)).toBe(true);
  expect(isValidDecisionStage("draft")).toBe(false);

  const todo = { status: TodoStatus.OPEN };
  expect(transitionTodoStatus(todo, TodoStatus.PENDING)).toBe(true);
  expect(todo.status).toBe(TodoStatus.PENDING);
});
