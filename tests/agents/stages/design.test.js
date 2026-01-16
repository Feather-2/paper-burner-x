/**
 * Tests for js/agents/stages/design module
 *
 * Covers:
 * - DesignAgentLoop: phase transitions, tool execution, events, pause/resume
 * - PPT/slide generation pipeline
 * - Edit mode: EditModeAgentLoop, EditHistoryManager, createEditToolExecutor
 * - State machines and validators
 */
import test from "node:test";
import assert from "node:assert/strict";

// ============================================================================
// Helpers
// ============================================================================

function makeContentPackage({ runId = "run_test", slideCount = 2 } = {}) {
  const slideIntents = Array.from({ length: slideCount }, (_, idx) => ({
    slideIntentId: `s_${idx + 1}`,
    pageType: idx === 0 ? "title" : "overview",
    title: `Slide ${idx + 1}`,
    keyPoints: ["Point A", "Point B"],
  }));

  return {
    schemaVersion: "0.1",
    runId,
    mode: "textprep",
    constraints: { pageCount: slideCount, tone: "business" },
    summary: "Test deck",
    slideIntents,
    claims: [],
    evidenceLedger: [],
  };
}

function makeDesignSystem() {
  return {
    designTokens: {
      colors: {
        bg: "#ffffff",
        text: "#111827",
        muted: "#6b7280",
        border: "#e5e7eb",
        panel: "#ffffff",
        primary: "#3b82f6",
        accent: "#8b5cf6",
      },
      fontFamily: "Inter",
      typography: {
        minFont: 12,
        titleFont: 44,
        subtitleFont: 18,
        smallFont: 12,
        headingFont: "Inter",
        bodyFont: "Roboto",
      },
    },
    theme: "light",
  };
}

function makeEditState() {
  return {
    currentSlideIndex: 0,
    slides: [
      {
        id: "slide-1",
        htmlDsl: "<section>one</section>",
        elements: [
          {
            id: "el-1",
            type: "Text",
            text: "Title",
            color: "#000",
            x: 0,
            y: 0,
            width: 100,
            height: 20,
          },
        ],
      },
      { id: "slide-2", htmlDsl: "<section>two</section>", elements: [] },
    ],
    designSystem: makeDesignSystem(),
  };
}

async function makeSlideHtml(slideIntent, designSystem, contentPackage) {
  const { buildSlideHtml } = await import("../../../js/agents/stages/design/dsl/dsl-builder.js");
  return buildSlideHtml(slideIntent, designSystem, contentPackage, { safeMode: true, slideNo: 1 });
}

// ============================================================================
// State Enums and Validators
// ============================================================================

test("DesignPhase enum contains expected values", async () => {
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  assert.equal(DesignPhase.IDLE, "idle");
  assert.equal(DesignPhase.OUTLINE_PARSING, "outline_parsing");
  assert.equal(DesignPhase.GENERATING, "generating");
  assert.equal(DesignPhase.COMPLETED, "completed");
  assert.equal(DesignPhase.FAILED, "failed");
  assert.equal(DesignPhase.EDITING, "editing");
});

test("SlideStatus enum contains expected values", async () => {
  const { SlideStatus } = await import("../../../js/agents/stages/design/states.js");

  assert.equal(SlideStatus.PENDING, "pending");
  assert.equal(SlideStatus.GENERATING, "generating");
  assert.equal(SlideStatus.COMPLETED, "completed");
  assert.equal(SlideStatus.FAILED, "failed");
});

test("EditSessionStatus enum contains expected values", async () => {
  const { EditSessionStatus } = await import("../../../js/agents/stages/design/states.js");

  assert.equal(EditSessionStatus.IDLE, "idle");
  assert.equal(EditSessionStatus.AWAITING_INPUT, "awaiting_input");
  assert.equal(EditSessionStatus.PROCESSING, "processing");
  assert.equal(EditSessionStatus.EXECUTING, "executing");
});

test("isValidDesignPhase validates correctly", async () => {
  const { isValidDesignPhase, DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  assert.equal(isValidDesignPhase(DesignPhase.IDLE), true);
  assert.equal(isValidDesignPhase(DesignPhase.GENERATING), true);
  assert.equal(isValidDesignPhase("invalid_phase"), false);
  assert.equal(isValidDesignPhase(null), false);
  assert.equal(isValidDesignPhase(undefined), false);
});

test("isValidSlideStatus validates correctly", async () => {
  const { isValidSlideStatus, SlideStatus } = await import("../../../js/agents/stages/design/states.js");

  assert.equal(isValidSlideStatus(SlideStatus.PENDING), true);
  assert.equal(isValidSlideStatus(SlideStatus.COMPLETED), true);
  assert.equal(isValidSlideStatus("unknown"), false);
});

test("designPhaseMachine validates state transitions", async () => {
  const { designPhaseMachine, DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  assert.equal(designPhaseMachine.canTransition(DesignPhase.IDLE, DesignPhase.OUTLINE_PARSING), true);
  assert.equal(designPhaseMachine.canTransition(DesignPhase.GENERATING, DesignPhase.COMPLETED), true);
  assert.equal(designPhaseMachine.canTransition(DesignPhase.COMPLETED, DesignPhase.EDITING), true);

  // Invalid transitions
  assert.equal(designPhaseMachine.canTransition(DesignPhase.IDLE, DesignPhase.COMPLETED), false);
});

// ============================================================================
// DesignAgentLoop - Core Functionality
// ============================================================================

test("DesignAgentLoop runs phases, uses tools, emits events", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  const contentPackage = makeContentPackage({ slideCount: 2 });
  const designSystem = makeDesignSystem();

  const calls = [];
  const toolExecutor = async (name, params) => {
    calls.push(name);
    if (name === "parse_outline") {
      return { ok: true, data: { contentPackage, slideIntents: contentPackage.slideIntents } };
    }
    if (name === "extract_style") {
      return { ok: true, data: { designSystem } };
    }
    if (name === "spawn_slide_agent") {
      const slideHtmls = await Promise.all(
        params.slideIntents.map((intent) => makeSlideHtml(intent, designSystem, params.contentPackage))
      );
      return {
        ok: true,
        data: {
          generated: slideHtmls.map((slideHtml) => ({ slideHtml, source: "mock" })),
        },
      };
    }
    if (name === "fill_visual") {
      return { ok: true, data: { deckHtmlDsl: params.slideHtmls.join("\n\n"), pendingImages: [] } };
    }
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = new DesignAgentLoop({ batchSize: 2 });
  const deck = await loop.run(contentPackage, {
    runContext: { runId: "run_test", constraints: contentPackage.constraints },
    toolExecutor,
    emit,
    brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
    skipReview: true,
  });

  assert.equal(deck.schemaVersion, "0.1");
  assert.equal(deck.slidesMeta.length, 2);
  assert.ok(deck.deckHtmlDsl.includes("<section"));

  // Verify tool call order
  assert.deepEqual(calls, ["parse_outline", "extract_style", "spawn_slide_agent", "fill_visual"]);

  // Verify phase transitions
  const transitions = events
    .filter((evt) => evt.name === "design.phase.transition")
    .map((evt) => evt.record.payload.to);

  assert.ok(transitions.includes(DesignPhase.OUTLINE_PARSING));
  assert.ok(transitions.includes(DesignPhase.GENERATING));
  assert.ok(transitions.includes(DesignPhase.COMPLETED));

  // Verify lifecycle events
  assert.ok(events.some((evt) => evt.name === "design.started"));
  assert.ok(events.some((evt) => evt.name === "design.ended"));
});

test("DesignAgentLoop exposes getPhase and getStatus methods", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../js/agents/stages/design/states.js");

  const loop = new DesignAgentLoop();

  // Before run, phase should be IDLE
  assert.equal(loop.getPhase(), DesignPhase.IDLE);
  assert.ok(loop.getStatus());
});

test("DesignAgentLoop handles tool execution errors gracefully", async () => {
  const { DesignAgentLoop } = await import("../../../js/agents/stages/design/agent-loop.js");

  const contentPackage = makeContentPackage({ slideCount: 1 });

  const toolExecutor = async (name) => {
    if (name === "parse_outline") {
      return { ok: false, error: "Parse error" };
    }
    return { ok: false, error: `Unexpected tool: ${name}` };
  };

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const loop = new DesignAgentLoop();

  await assert.rejects(
    async () => {
      await loop.run(contentPackage, {
        runContext: { runId: "run_error_test" },
        toolExecutor,
        emit,
        brainstormResult: { ideaPool: [], selectedIdeas: [], imageSlots: [], candidatesBySlide: [] },
        skipReview: true,
      });
    },
    /Parse error|failed|error/i
  );
});

// ============================================================================
// Edit Mode - EditHistoryManager
// ============================================================================

test("EditHistoryManager supports basic undo/redo", async () => {
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager();
  const state = { value: 0 };

  const op1 = {
    undo: () => (state.value -= 10),
    redo: () => (state.value += 10),
  };

  state.value = 10;
  history.push(op1);

  assert.equal(history.history.length, 1);

  history.undo();
  assert.equal(state.value, 0);

  history.redo();
  assert.equal(state.value, 10);
});

test("EditHistoryManager respects maxHistory limit", async () => {
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager(3);
  const state = { count: 0 };

  for (let i = 1; i <= 5; i++) {
    const delta = i;
    state.count += delta;
    history.push({
      undo: () => (state.count -= delta),
      redo: () => (state.count += delta),
    });
  }

  assert.equal(history.history.length, 3, "history should be limited to maxHistory");
});

test("EditHistoryManager supports transactions", async () => {
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager();
  const state = { count: 0 };

  history.beginTransaction();
  state.count += 5;
  history.push({ undo: () => (state.count -= 5), redo: () => (state.count += 5) });
  state.count += 3;
  history.push({ undo: () => (state.count -= 3), redo: () => (state.count += 3) });
  history.commit();

  assert.equal(history.history.length, 1, "transaction should batch operations");
  assert.equal(state.count, 8);

  history.undo();
  assert.equal(state.count, 0, "undo should revert entire transaction");

  history.redo();
  assert.equal(state.count, 8, "redo should reapply entire transaction");
});

test("EditHistoryManager rollback reverts uncommitted transaction", async () => {
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager();
  const state = { count: 10 };

  history.beginTransaction();
  state.count += 5;
  history.push({ undo: () => (state.count -= 5), redo: () => (state.count += 5) });
  history.rollback();

  assert.equal(state.count, 10, "rollback should revert changes");
  assert.equal(history.history.length, 0, "rollback should not add to history");
});

test("EditHistoryManager handles empty operations gracefully", async () => {
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager();

  // Undo/redo on empty history
  assert.equal(history.undo(), null);
  assert.equal(history.redo(), null);

  // Push invalid operation
  assert.equal(history.push(null), false);
  assert.equal(history.push("not an object"), false);
});

// ============================================================================
// Edit Mode - createEditToolExecutor
// ============================================================================

test("createEditToolExecutor executes edit operations", async () => {
  const { createEditToolExecutor } = await import("../../../js/agents/stages/design/edit-mode/tools.js");
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const state = makeEditState();
  const historyManager = new EditHistoryManager();

  const canvasBridge = {
    screenshot: async () => "data:image/mock",
    canvasToDsl: async () => "<section>parsed</section>",
  };

  const executor = createEditToolExecutor({
    state,
    historyManager,
    canvasBridge,
    idGenerator: () => "el-new",
    slideIdGenerator: () => "slide-new",
  });

  // Test add_slide
  const addResult = await executor("add_slide", { afterIndex: 0, slideId: "slide-3" });
  assert.equal(addResult.success, true);
  assert.equal(state.slides.length, 3);

  // Test edit_element
  const editResult = await executor("edit_element", { elementId: "el-1", changes: { text: "Updated" } });
  assert.equal(editResult.success, true);
  assert.equal(state.slides[0].elements[0].text, "Updated");

  // Test undo
  await executor("undo", {});
  assert.equal(state.slides[0].elements[0].text, "Title");

  // Test redo
  await executor("redo", {});
  assert.equal(state.slides[0].elements[0].text, "Updated");
});

test("createEditToolExecutor handles move and resize operations", async () => {
  const { createEditToolExecutor } = await import("../../../js/agents/stages/design/edit-mode/tools.js");
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const state = makeEditState();
  const historyManager = new EditHistoryManager();
  const canvasBridge = { screenshot: async () => "data:image/mock", canvasToDsl: async () => "<section/>" };

  const executor = createEditToolExecutor({
    state,
    historyManager,
    canvasBridge,
    idGenerator: () => "el-id",
    slideIdGenerator: () => "slide-id",
  });

  // Move element
  await executor("move_element", { elementId: "el-1", x: 50, y: 100 });
  assert.equal(state.slides[0].elements[0].x, 50);
  assert.equal(state.slides[0].elements[0].y, 100);

  // Resize element
  await executor("resize_element", { elementId: "el-1", width: 200, height: 80 });
  assert.equal(state.slides[0].elements[0].width, 200);
  assert.equal(state.slides[0].elements[0].height, 80);
});

test("createEditToolExecutor handles theme and style changes", async () => {
  const { createEditToolExecutor } = await import("../../../js/agents/stages/design/edit-mode/tools.js");
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const state = makeEditState();
  const historyManager = new EditHistoryManager();
  const canvasBridge = { screenshot: async () => "", canvasToDsl: async () => "" };

  const executor = createEditToolExecutor({
    state,
    historyManager,
    canvasBridge,
    idGenerator: () => "id",
    slideIdGenerator: () => "sid",
  });

  // Change color scheme
  await executor("change_color_scheme", { primary: "#ff0000", accent: "#00ff00" });
  assert.equal(state.designSystem.designTokens.colors.primary, "#ff0000");
  assert.equal(state.designSystem.designTokens.colors.accent, "#00ff00");

  // Change font
  await executor("change_font", { headingFont: "Oswald" });
  assert.equal(state.designSystem.designTokens.typography.headingFont, "Oswald");

  // Apply theme
  await executor("apply_theme", { themeName: "dark" });
  assert.equal(state.designSystem.theme, "dark");
});

test("createEditToolExecutor returns error for invalid operations", async () => {
  const { createEditToolExecutor } = await import("../../../js/agents/stages/design/edit-mode/tools.js");
  const { EditHistoryManager } = await import("../../../js/agents/stages/design/edit-mode/history.js");

  const state = makeEditState();
  const historyManager = new EditHistoryManager();
  const canvasBridge = { screenshot: async () => "", canvasToDsl: async () => "" };

  const executor = createEditToolExecutor({
    state,
    historyManager,
    canvasBridge,
    idGenerator: () => "id",
    slideIdGenerator: () => "sid",
  });

  // Delete slide with invalid index
  const result = await executor("delete_slide", { slideIndex: 999 });
  assert.equal(result.success, false);

  // Edit non-existent element
  const editResult = await executor("edit_element", { elementId: "nonexistent", changes: {} });
  assert.equal(editResult.success, false);
});

// ============================================================================
// Edit Mode - EditModeTools
// ============================================================================

test("EditModeTools exports tool definitions", async () => {
  const { EditModeTools } = await import("../../../js/agents/stages/design/edit-mode/tools.js");

  assert.ok(EditModeTools);
  assert.ok(Array.isArray(EditModeTools) || typeof EditModeTools === "object");
});

// ============================================================================
// Module Exports
// ============================================================================

test("design module exports all expected components", async () => {
  const design = await import("../../../js/agents/stages/design/index.js");

  // Core classes
  assert.ok(design.DesignAgentLoop);
  assert.ok(design.DesignStage);
  assert.ok(design.runDesignStage);

  // Generators
  assert.ok(design.generateDesignTokens);
  assert.ok(design.ImageGenerator);
  assert.ok(design.SVGGenerator);

  // DSL
  assert.ok(design.buildSlideHtml);

  // Edit mode
  assert.ok(design.EditModeAgentLoop);
  assert.ok(design.EditHistoryManager);
  assert.ok(design.createEditToolExecutor);
  assert.ok(design.EditModeTools);

  // Sub agents
  assert.ok(design.SlideSubAgent);
  assert.ok(design.VisualSubAgent);

  // State machines
  assert.ok(design.DesignPhase);
  assert.ok(design.SlideStatus);
  assert.ok(design.EditSessionStatus);
  assert.ok(design.designPhaseMachine);
});

test("DESIGN_AGENT_TOOL_DEFINITIONS contains expected tools", async () => {
  const { DESIGN_AGENT_TOOL_DEFINITIONS } = await import("../../../js/agents/stages/design/agent-loop.js");

  assert.ok(Array.isArray(DESIGN_AGENT_TOOL_DEFINITIONS));

  const toolNames = DESIGN_AGENT_TOOL_DEFINITIONS.map((t) => t.name);
  assert.ok(toolNames.includes("parse_outline"));
  assert.ok(toolNames.includes("extract_style"));
  assert.ok(toolNames.includes("spawn_slide_agent"));
});

// ============================================================================
// Generators
// ============================================================================

test("generateDesignTokens creates valid design tokens", async () => {
  const { generateDesignTokens } = await import("../../../js/agents/stages/design/generators/design-tokens.js");

  const tokens = generateDesignTokens({
    theme: "dark",
    accent: "#007AFF",
  });

  assert.ok(tokens);
  assert.ok(tokens.colors || tokens.designTokens);
});

// ============================================================================
// DSL Builder
// ============================================================================

test("buildSlideHtml generates valid HTML from slide intent", async () => {
  const { buildSlideHtml } = await import("../../../js/agents/stages/design/dsl/dsl-builder.js");

  const slideIntent = {
    slideIntentId: "s_1",
    pageType: "title",
    title: "Test Slide",
    keyPoints: ["Point 1", "Point 2"],
  };

  const designSystem = makeDesignSystem();
  const contentPackage = makeContentPackage();

  const html = buildSlideHtml(slideIntent, designSystem, contentPackage, {
    safeMode: true,
    slideNo: 1,
  });

  assert.ok(typeof html === "string");
  assert.ok(html.includes("<section") || html.includes("<div"));
});

// ============================================================================
// Validators (from constants.js)
// ============================================================================

test("constants validators work correctly", async () => {
  const {
    isValidVisualType,
    isValidEditOperationType,
    VisualType,
    EditOperationType,
  } = await import("../../../js/agents/stages/design/constants.js");

  // Visual types - use actual enum values
  assert.equal(isValidVisualType(VisualType.ILLUSTRATION), true);
  assert.equal(isValidVisualType(VisualType.PHOTO), true);
  assert.equal(isValidVisualType(VisualType.ICON), true);
  assert.equal(isValidVisualType("invalid"), false);

  // Edit operation types - use actual enum values
  assert.equal(isValidEditOperationType(EditOperationType.ADD_SLIDE), true);
  assert.equal(isValidEditOperationType(EditOperationType.EDIT_ELEMENT), true);
  assert.equal(isValidEditOperationType("invalid_op"), false);
});

// ============================================================================
// VisualSlotStatus and SubAgentStatus
// ============================================================================

test("VisualSlotStatus enum and validator", async () => {
  const { VisualSlotStatus, isValidVisualSlotStatus } = await import("../../../js/agents/stages/design/states.js");

  assert.equal(VisualSlotStatus.PENDING, "pending");
  assert.equal(VisualSlotStatus.GENERATING, "generating");
  assert.equal(VisualSlotStatus.FILLED, "filled");
  assert.equal(VisualSlotStatus.FAILED, "failed");

  assert.equal(isValidVisualSlotStatus(VisualSlotStatus.PENDING), true);
  assert.equal(isValidVisualSlotStatus("invalid"), false);
});

test("SubAgentStatus enum and validator", async () => {
  const { SubAgentStatus, isValidSubAgentStatus } = await import("../../../js/agents/stages/design/states.js");

  assert.equal(SubAgentStatus.IDLE, "idle");
  assert.equal(SubAgentStatus.RUNNING, "running");
  assert.equal(SubAgentStatus.MERGED, "merged");
  assert.equal(SubAgentStatus.FAILED, "failed");

  assert.equal(isValidSubAgentStatus(SubAgentStatus.RUNNING), true);
  assert.equal(isValidSubAgentStatus("unknown"), false);
});

test("ReviewStatus enum and validator", async () => {
  const { ReviewStatus, isValidReviewStatus } = await import("../../../js/agents/stages/design/states.js");

  assert.equal(ReviewStatus.PENDING, "pending");
  assert.equal(ReviewStatus.PASSED, "passed");
  assert.equal(ReviewStatus.FAILED, "failed");

  assert.equal(isValidReviewStatus(ReviewStatus.PASSED), true);
  assert.equal(isValidReviewStatus("unknown"), false);
});
