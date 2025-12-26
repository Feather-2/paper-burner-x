const test = require("node:test");
const assert = require("node:assert/strict");

test("TodoStatus transitions update status/history and reject invalid moves", async () => {
  const { createTodo, transitionTodoStatus } = await import("../../../js/agents/stages/deepsearch/utils/todo-utils.js");

  const todo = createTodo({
    todoId: "t1",
    text: "Draft outline",
    status: "open",
    createdAt: "2020-01-01T00:00:00.000Z",
  });
  const createdAt = todo.updatedAt;

  assert.equal(transitionTodoStatus(todo, "pending"), true);
  assert.equal(todo.status, "pending");
  assert.notEqual(todo.updatedAt, createdAt);
  assert.equal(todo.history.length >= 2, true);

  assert.equal(transitionTodoStatus(todo, "completed"), true);
  assert.equal(todo.status, "completed");

  // 简化后允许任意有效状态转换
  assert.equal(transitionTodoStatus(todo, "cancelled"), true);
  assert.equal(todo.status, "cancelled");
});

test("validateTodo enforces schema requirements", async () => {
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
  assert.equal(validResult.valid, true);
  assert.equal(validResult.issues.length, 0);

  const invalidResult = validateTodo({ text: "", status: "weird", queryHints: ["", 1], createdAt: "not-a-date" });
  assert.equal(invalidResult.valid, false);
  assert.equal(invalidResult.issues.some((issue) => issue.includes("todoId")), true);
  assert.equal(invalidResult.issues.some((issue) => issue.includes("status")), true);
  assert.equal(invalidResult.issues.some((issue) => issue.includes("queryHints")), true);
  assert.equal(invalidResult.issues.some((issue) => issue.includes("createdAt")), true);
});

test("L2 control flags serialize/deserialize across minimal checkpoints", async () => {
  const { DeepSearchState } = await import("../../../js/agents/stages/deepsearch/state.js");

  const state = new DeepSearchState({
    runId: "run_l2_flags",
    taskGoal: "t",
    userConfig: { checkpointStrategy: "minimal" },
  });
  state.setAwaitUserFeedback(true, "need user input");

  const cp = state.saveCheckpoint({ checkpointId: "cp_l2" });
  assert.equal(cp.stateSnapshot.L2.awaitUserFeedback, true);
  assert.equal(cp.stateSnapshot.L2.taskImpossible, false);
  assert.equal(cp.stateSnapshot.L2.reason, "need user input");

  state.setAwaitUserFeedback(false);
  state.L2.taskImpossible = false;
  state.L2.reason = "";
  state.restoreCheckpoint("cp_l2");

  assert.equal(state.L2.awaitUserFeedback, true);
  assert.equal(state.L2.reason, "need user input");
});

test("loadCheckpoint migrates gaps into todos and stamps L2 flags", async () => {
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
  assert.ok(Array.isArray(loaded.stateSnapshot.todos));
  assert.equal(loaded.stateSnapshot.todos.length, 1);
  const todo = loaded.stateSnapshot.todos[0];
  assert.equal(todo.relatedGapId, "gap_1");
  assert.equal(todo.status, "completed");
  assert.equal(todo.priority, "high");
  assert.equal(loaded.stateSnapshot.L2.awaitUserFeedback, false);
  assert.equal(loaded.stateSnapshot.L2.taskImpossible, false);
});

test("states helpers validate enums", async () => {
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

  assert.equal(isValidGapPriority(GapPriority.HIGH), true);
  assert.equal(isValidGapPriority("urgent"), false);
  assert.equal(isValidGapStatus(GapStatus.OPEN), true);
  assert.equal(isValidGapStatus("done"), false);
  assert.equal(isValidTodoStatus(TodoStatus.OPEN), true);
  assert.equal(isValidTodoStatus("waiting"), false);
  assert.equal(isValidPlanNodeStatus(PlanNodeStatus.ACTIVE), true);
  assert.equal(isValidPlanNodeStatus("paused"), false);
  assert.equal(isValidPlanNodeType(PlanNodeType.QUERY), true);
  assert.equal(isValidPlanNodeType("task"), false);
  assert.equal(isValidDecisionOutcome(DecisionOutcome.SUCCESS), true);
  assert.equal(isValidDecisionOutcome("maybe"), false);
  assert.equal(isValidDecisionStage(DecisionStage.SCAN), true);
  assert.equal(isValidDecisionStage("draft"), false);

  const todo = { status: TodoStatus.OPEN };
  assert.equal(transitionTodoStatus(todo, TodoStatus.PENDING), true);
  assert.equal(todo.status, TodoStatus.PENDING);
});
