const test = require("node:test");
const assert = require("node:assert/strict");

function withSilencedConsole(fn) {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function captureConsole(method, fn) {
  const original = console[method];
  const calls = [];
  console[method] = (...args) => calls.push(args);
  try {
    fn();
  } finally {
    console[method] = original;
  }
  return calls;
}

function assertTransitionsCoverStates(enumObj, transitions, label) {
  const states = Object.values(enumObj);
  for (const state of states) {
    assert.ok(Object.prototype.hasOwnProperty.call(transitions, state), `${label} missing transitions for ${state}`);
  }
  for (const key of Object.keys(transitions)) {
    assert.ok(states.includes(key), `${label} transitions include unknown state ${key}`);
  }
}

function assertCanTransitionMatrix(machine, transitions, states, label) {
  for (const from of states) {
    const allowed = transitions[from] || [];
    for (const to of states) {
      const expected = allowed.includes(to);
      assert.equal(
        machine.canTransition(from, to),
        expected,
        `${label} canTransition mismatch: ${from} -> ${to}`
      );
    }
  }
}

function findInvalidTransition(states, transitions) {
  for (const from of states) {
    const allowed = transitions[from] || [];
    const invalidTo = states.find((to) => !allowed.includes(to));
    if (invalidTo) return { from, to: invalidTo };
  }
  return null;
}

function assertValidator(enumObj, isValid, label) {
  for (const value of Object.values(enumObj)) {
    assert.equal(isValid(value), true, `${label} should accept ${value}`);
  }
  assert.equal(isValid("__invalid__"), false, `${label} should reject unknown values`);
}

test("state enums and transition tables are frozen and complete", async () => {
  const {
    DesignPhase,
    DESIGN_PHASE_TRANSITIONS,
    DesignLoopStatus,
    DESIGN_LOOP_TRANSITIONS,
    SlideStatus,
    SLIDE_STATUS_TRANSITIONS,
    VisualSlotStatus,
    VISUAL_SLOT_TRANSITIONS,
    EditSessionStatus,
    EDIT_SESSION_TRANSITIONS,
    SubAgentStatus,
    SUB_AGENT_TRANSITIONS,
    ReviewStatus,
    REVIEW_TRANSITIONS,
  } = await import("../../../js/agents/stages/design/states.js");

  const {
    VisualType,
    InteractionCheckpoint,
    EditOperationType,
    ReviewIssueSeverity,
    ReviewIssueType,
  } = await import("../../../js/agents/stages/design/constants.js");

  const enums = [
    [DesignPhase, "DesignPhase"],
    [DesignLoopStatus, "DesignLoopStatus"],
    [SlideStatus, "SlideStatus"],
    [VisualSlotStatus, "VisualSlotStatus"],
    [EditSessionStatus, "EditSessionStatus"],
    [SubAgentStatus, "SubAgentStatus"],
    [ReviewStatus, "ReviewStatus"],
    [VisualType, "VisualType"],
    [InteractionCheckpoint, "InteractionCheckpoint"],
    [EditOperationType, "EditOperationType"],
    [ReviewIssueSeverity, "ReviewIssueSeverity"],
    [ReviewIssueType, "ReviewIssueType"],
  ];

  for (const [enumObj, label] of enums) {
    assert.equal(Object.isFrozen(enumObj), true, `${label} should be frozen`);
  }

  const transitions = [
    [DesignPhase, DESIGN_PHASE_TRANSITIONS, "DesignPhase"],
    [DesignLoopStatus, DESIGN_LOOP_TRANSITIONS, "DesignLoopStatus"],
    [SlideStatus, SLIDE_STATUS_TRANSITIONS, "SlideStatus"],
    [VisualSlotStatus, VISUAL_SLOT_TRANSITIONS, "VisualSlotStatus"],
    [EditSessionStatus, EDIT_SESSION_TRANSITIONS, "EditSessionStatus"],
    [SubAgentStatus, SUB_AGENT_TRANSITIONS, "SubAgentStatus"],
    [ReviewStatus, REVIEW_TRANSITIONS, "ReviewStatus"],
  ];

  for (const [enumObj, table, label] of transitions) {
    assert.equal(Object.isFrozen(table), true, `${label} transitions should be frozen`);
    assertTransitionsCoverStates(enumObj, table, label);
  }
});

test("design index exports new state machines and enums", async () => {
  const design = await import("../../../js/agents/stages/design/index.js");

  assert.ok(design.DesignPhase, "DesignPhase should be exported");
  assert.ok(design.DesignLoopStatus, "DesignLoopStatus should be exported");
  assert.ok(design.SlideStatus, "SlideStatus should be exported");
  assert.ok(design.VisualSlotStatus, "VisualSlotStatus should be exported");
  assert.ok(design.EditSessionStatus, "EditSessionStatus should be exported");
  assert.ok(design.SubAgentStatus, "SubAgentStatus should be exported");
  assert.ok(design.ReviewStatus, "ReviewStatus should be exported");
  assert.ok(design.VisualType, "VisualType should be exported");
  assert.ok(design.InteractionCheckpoint, "InteractionCheckpoint should be exported");
  assert.ok(design.EditOperationType, "EditOperationType should be exported");
  assert.ok(design.ReviewIssueSeverity, "ReviewIssueSeverity should be exported");
  assert.ok(design.ReviewIssueType, "ReviewIssueType should be exported");

  assert.equal(typeof design.designPhaseMachine?.transition, "function");
  assert.equal(typeof design.designLoopMachine?.transition, "function");
  assert.equal(typeof design.slideStatusMachine?.transition, "function");
  assert.equal(typeof design.visualSlotMachine?.transition, "function");
  assert.equal(typeof design.editSessionMachine?.transition, "function");
  assert.equal(typeof design.subAgentMachine?.transition, "function");
  assert.equal(typeof design.reviewMachine?.transition, "function");

  assert.equal(typeof design.isValidDesignPhase, "function");
  assert.equal(typeof design.isValidSlideStatus, "function");
  assert.equal(typeof design.isValidVisualSlotStatus, "function");
  assert.equal(typeof design.isValidEditSessionStatus, "function");
  assert.equal(typeof design.isValidSubAgentStatus, "function");
  assert.equal(typeof design.isValidReviewStatus, "function");
});

test("state machines expose transition rules", async () => {
  const {
    DesignPhase,
    DESIGN_PHASE_TRANSITIONS,
    designPhaseMachine,
    DesignLoopStatus,
    DESIGN_LOOP_TRANSITIONS,
    designLoopMachine,
    SlideStatus,
    SLIDE_STATUS_TRANSITIONS,
    slideStatusMachine,
    VisualSlotStatus,
    VISUAL_SLOT_TRANSITIONS,
    visualSlotMachine,
    EditSessionStatus,
    EDIT_SESSION_TRANSITIONS,
    editSessionMachine,
    SubAgentStatus,
    SUB_AGENT_TRANSITIONS,
    subAgentMachine,
    ReviewStatus,
    REVIEW_TRANSITIONS,
    reviewMachine,
  } = await import("../../../js/agents/stages/design/states.js");

  const machines = [
    [DesignPhase, DESIGN_PHASE_TRANSITIONS, designPhaseMachine, "DesignPhase"],
    [DesignLoopStatus, DESIGN_LOOP_TRANSITIONS, designLoopMachine, "DesignLoopStatus"],
    [SlideStatus, SLIDE_STATUS_TRANSITIONS, slideStatusMachine, "SlideStatus"],
    [VisualSlotStatus, VISUAL_SLOT_TRANSITIONS, visualSlotMachine, "VisualSlotStatus"],
    [EditSessionStatus, EDIT_SESSION_TRANSITIONS, editSessionMachine, "EditSessionStatus"],
    [SubAgentStatus, SUB_AGENT_TRANSITIONS, subAgentMachine, "SubAgentStatus"],
    [ReviewStatus, REVIEW_TRANSITIONS, reviewMachine, "ReviewStatus"],
  ];

  for (const [enumObj, transitions, machine, label] of machines) {
    const states = Object.values(enumObj);
    assert.deepEqual(machine.getAllStates().sort(), Object.keys(transitions).sort(), `${label} getAllStates mismatch`);
    assert.deepEqual(machine.getTransitions(states[0]), transitions[states[0]], `${label} getTransitions mismatch`);
    assert.deepEqual(machine.getTransitions("__unknown__"), [], `${label} getTransitions should default to []`);
    assertCanTransitionMatrix(machine, transitions, states, label);
  }
});

test("state machines transition entities and reject invalid moves", async () => {
  const {
    DesignPhase,
    DESIGN_PHASE_TRANSITIONS,
    designPhaseMachine,
    DesignLoopStatus,
    DESIGN_LOOP_TRANSITIONS,
    designLoopMachine,
    SlideStatus,
    SLIDE_STATUS_TRANSITIONS,
    slideStatusMachine,
    VisualSlotStatus,
    VISUAL_SLOT_TRANSITIONS,
    visualSlotMachine,
    EditSessionStatus,
    EDIT_SESSION_TRANSITIONS,
    editSessionMachine,
    SubAgentStatus,
    SUB_AGENT_TRANSITIONS,
    subAgentMachine,
    ReviewStatus,
    REVIEW_TRANSITIONS,
    reviewMachine,
  } = await import("../../../js/agents/stages/design/states.js");

  const machines = [
    [DesignPhase, DESIGN_PHASE_TRANSITIONS, designPhaseMachine, "DesignPhase"],
    [DesignLoopStatus, DESIGN_LOOP_TRANSITIONS, designLoopMachine, "DesignLoopStatus"],
    [SlideStatus, SLIDE_STATUS_TRANSITIONS, slideStatusMachine, "SlideStatus"],
    [VisualSlotStatus, VISUAL_SLOT_TRANSITIONS, visualSlotMachine, "VisualSlotStatus"],
    [EditSessionStatus, EDIT_SESSION_TRANSITIONS, editSessionMachine, "EditSessionStatus"],
    [SubAgentStatus, SUB_AGENT_TRANSITIONS, subAgentMachine, "SubAgentStatus"],
    [ReviewStatus, REVIEW_TRANSITIONS, reviewMachine, "ReviewStatus"],
  ];

  withSilencedConsole(() => {
    for (const [enumObj, transitions, machine, label] of machines) {
      const states = Object.values(enumObj);
      for (const from of states) {
        for (const to of transitions[from] || []) {
          const entity = { status: from };
          const ok = machine.transition(entity, to, { reason: `${label}-test` });
          assert.equal(ok, true, `${label} should allow ${from} -> ${to}`);
          assert.equal(entity.status, to, `${label} should update status to ${to}`);
        }
      }
    }
  });

  const stateEntity = { state: DesignPhase.IDLE };
  withSilencedConsole(() => {
    const ok = designPhaseMachine.transition(stateEntity, DesignPhase.OUTLINE_PARSING, { reason: "state-field" });
    assert.equal(ok, true, "transition should work with state field");
    assert.equal(stateEntity.state, DesignPhase.OUTLINE_PARSING, "state field should be updated");
  });

  for (const [enumObj, transitions, machine, label] of machines) {
    const states = Object.values(enumObj);
    const invalid = findInvalidTransition(states, transitions);
    assert.ok(invalid, `${label} should have at least one invalid transition`);

    const entity = { status: invalid.from };
    const errors = captureConsole("error", () => {
      const ok = machine.transition(entity, invalid.to, { reason: "invalid" });
      assert.equal(ok, false, `${label} should reject invalid transition`);
    });

    assert.equal(entity.status, invalid.from, `${label} should not mutate status on invalid transition`);
    assert.ok(errors.length > 0, `${label} should log an error on invalid transition`);
  }
});

test("validators accept valid enum values", async () => {
  const {
    DesignPhase,
    DesignLoopStatus,
    SlideStatus,
    VisualSlotStatus,
    EditSessionStatus,
    SubAgentStatus,
    ReviewStatus,
  } = await import("../../../js/agents/stages/design/states.js");

  const {
    VisualType,
    InteractionCheckpoint,
    EditOperationType,
    ReviewIssueSeverity,
    ReviewIssueType,
    BrainstormStatus,
    isValidDesignPhase,
    isValidDesignLoopStatus,
    isValidSlideStatus,
    isValidVisualSlotStatus,
    isValidEditSessionStatus,
    isValidSubAgentStatus,
    isValidReviewStatus,
    isValidVisualType,
    isValidInteractionCheckpoint,
    isValidEditOperationType,
    isValidReviewIssueSeverity,
    isValidReviewIssueType,
    isValidBrainstormStatus,
  } = await import("../../../js/agents/stages/design/constants.js");

  assertValidator(DesignPhase, isValidDesignPhase, "DesignPhase");
  assertValidator(DesignLoopStatus, isValidDesignLoopStatus, "DesignLoopStatus");
  assertValidator(SlideStatus, isValidSlideStatus, "SlideStatus");
  assertValidator(VisualSlotStatus, isValidVisualSlotStatus, "VisualSlotStatus");
  assertValidator(EditSessionStatus, isValidEditSessionStatus, "EditSessionStatus");
  assertValidator(SubAgentStatus, isValidSubAgentStatus, "SubAgentStatus");
  assertValidator(ReviewStatus, isValidReviewStatus, "ReviewStatus");
  assertValidator(VisualType, isValidVisualType, "VisualType");
  assertValidator(InteractionCheckpoint, isValidInteractionCheckpoint, "InteractionCheckpoint");
  assertValidator(EditOperationType, isValidEditOperationType, "EditOperationType");
  assertValidator(ReviewIssueSeverity, isValidReviewIssueSeverity, "ReviewIssueSeverity");
  assertValidator(ReviewIssueType, isValidReviewIssueType, "ReviewIssueType");
  assertValidator(BrainstormStatus, isValidBrainstormStatus, "BrainstormStatus");
});
