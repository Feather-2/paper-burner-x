import { describe, it, expect, vi, beforeEach } from "vitest";

const statesMock = vi.hoisted(() => ({
  DesignPhase: Object.freeze({ INIT: "init" }),
  DESIGN_PHASE_TRANSITIONS: {},
  designPhaseMachine: {},
  DesignLoopStatus: Object.freeze({ IDLE: "idle" }),
  DESIGN_LOOP_TRANSITIONS: {},
  designLoopMachine: {},
  SlideStatus: Object.freeze({ DRAFT: "draft" }),
  SLIDE_STATUS_TRANSITIONS: {},
  SLIDE_TRANSITIONS: {},
  slideStatusMachine: {},
  slideMachine: {},
  VisualSlotStatus: Object.freeze({ PENDING: "pending" }),
  VISUAL_SLOT_TRANSITIONS: {},
  visualSlotMachine: {},
  EditSessionStatus: Object.freeze({ OPEN: "open" }),
  EDIT_SESSION_TRANSITIONS: {},
  editSessionMachine: {},
  SubAgentStatus: Object.freeze({ IDLE: "idle" }),
  SUB_AGENT_TRANSITIONS: {},
  subAgentMachine: {},
  ReviewStatus: Object.freeze({ PENDING: "pending" }),
  REVIEW_TRANSITIONS: {},
  reviewMachine: {},
}));

vi.mock("../../../../../js/agents/stages/design/states.js", () => statesMock);

import {
  ImageTaskStatus,
  RenderType,
  VisualType,
  InteractionCheckpoint,
  EditOperationType,
  ReviewIssueSeverity,
  ReviewIssueType,
  EventStatus,
} from "../../../../../js/agents/stages/design/constants.js";

const LARGE_STRING = "x".repeat(100000);
const LARGE_ARRAY = new Array(20000).fill("x");
const LARGE_BINARY = new Uint8Array(1024 * 1024);

function makeDeepObject(depth) {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.child = { level: i };
    cursor = cursor.child;
  }
  return root;
}

const DEEP_OBJECT = makeDeepObject(80);

const BOUNDARY_VALUES = [
  null,
  undefined,
  "",
  "   ",
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  "0",
  "123",
  [],
  {},
  { length: 0 },
  { 0: "x", length: 1 },
  LARGE_STRING,
  LARGE_ARRAY,
  LARGE_BINARY,
  DEEP_OBJECT,
];

function isEnumValue(enumObj, value) {
  return Object.values(enumObj).includes(value);
}

async function readValuesConcurrently(enumObj, count = 24) {
  const tasks = Array.from({ length: count }, () =>
    Promise.resolve().then(() => Object.values(enumObj))
  );
  return Promise.all(tasks);
}

function expectEnumMapping(enumObj, expected) {
  expect(enumObj).toEqual(expected);
  const expectedValues = Object.values(expected);
  expectedValues.forEach((value) => {
    expect(isEnumValue(enumObj, value)).toBe(true);
  });
}

function expectRejectsBoundaryValues(enumObj) {
  BOUNDARY_VALUES.forEach((value) => {
    expect(isEnumValue(enumObj, value)).toBe(false);
  });
}

function expectFrozenAndImmutable(enumObj) {
  expect(Object.isFrozen(enumObj)).toBe(true);
  expect(() =>
    Object.defineProperty(enumObj, "__TEST__", { value: "nope" })
  ).toThrow(TypeError);
  const [firstKey] = Object.keys(enumObj);
  expect(() =>
    Object.defineProperty(enumObj, firstKey, { value: "__mutated__" })
  ).toThrow(TypeError);
}

async function expectStableReads(enumObj) {
  const expected = Object.values(enumObj);
  for (let i = 0; i < 20; i += 1) {
    expect(Object.values(enumObj)).toEqual(expected);
  }
  const concurrentReads = await readValuesConcurrently(enumObj, 20);
  concurrentReads.forEach((values) => {
    expect(values).toEqual(expected);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

function defineEnumTests(name, enumObj, expected) {
  describe(name, () => {
    it("exposes the expected mapping (normal path)", () => {
      expectEnumMapping(enumObj, expected);
    });

    it("rejects invalid inputs and boundary values", () => {
      expectRejectsBoundaryValues(enumObj);
    });

    it("throws on mutation attempts (error handling)", () => {
      expectFrozenAndImmutable(enumObj);
    });

    it("returns consistent values under rapid/concurrent reads", async () => {
      await expectStableReads(enumObj);
    });
  });
}

defineEnumTests("ImageTaskStatus", ImageTaskStatus, {
  PENDING: "pending",
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  SKIPPED: "skipped",
});

defineEnumTests("RenderType", RenderType, {
  AI_IMAGE: "ai-image",
  SVG: "svg",
  ASSET: "asset",
});

defineEnumTests("VisualType", VisualType, {
  ILLUSTRATION: "illustration",
  PHOTO: "photo",
  ICON: "icon",
  BACKGROUND_IMAGE: "bg-image",
  BACKGROUND_GRADIENT: "bg-gradient",
  BACKGROUND_PATTERN: "bg-pattern",
  CHART: "chart",
  DIAGRAM: "diagram",
  INFOGRAPHIC: "infographic",
  DECORATION: "decoration",
  DIVIDER: "divider",
  SVG: "svg",
});

defineEnumTests("InteractionCheckpoint", InteractionCheckpoint, {
  OUTLINE_CONFIRM: "outline_confirm",
  STYLE_CONFIRM: "style_confirm",
  MIDWAY_FEEDBACK: "midway_feedback",
  SLIDE_REVIEW: "slide_review",
  FINAL_CONFIRM: "final_confirm",
});

defineEnumTests("EditOperationType", EditOperationType, {
  ADD_SLIDE: "add_slide",
  DELETE_SLIDE: "delete_slide",
  REORDER_SLIDES: "reorder_slides",
  DUPLICATE_SLIDE: "duplicate_slide",
  CHANGE_COLOR_SCHEME: "change_color_scheme",
  CHANGE_FONT: "change_font",
  APPLY_THEME: "apply_theme",
  EDIT_ELEMENT: "edit_element",
  DELETE_ELEMENT: "delete_element",
  ADD_ELEMENT: "add_element",
  MOVE_ELEMENT: "move_element",
  RESIZE_ELEMENT: "resize_element",
  UNDO: "undo",
  REDO: "redo",
});

defineEnumTests("ReviewIssueSeverity", ReviewIssueSeverity, {
  CRITICAL: "critical",
  MAJOR: "major",
  MINOR: "minor",
  INFO: "info",
});

defineEnumTests("ReviewIssueType", ReviewIssueType, {
  LAYOUT: "layout",
  TEXT: "text",
  COLOR: "color",
  VISUAL: "visual",
  ALIGNMENT: "alignment",
  OVERFLOW: "overflow",
  ACCESSIBILITY: "accessibility",
});

defineEnumTests("EventStatus", EventStatus, {
  STARTED: "started",
  PROGRESS: "progress",
  DATA: "data",
  COMPLETED: "completed",
  FAILED: "failed",
  ERROR: "error",
  GENERATED: "generated",
  SKIPPED: "skipped",
  SUCCEEDED: "succeeded",
});
