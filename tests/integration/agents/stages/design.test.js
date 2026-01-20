/**
 * Tests for js/agents/stages/design module
 *
 * Covers:
 * - DesignAgentLoop: phase transitions, tool execution, events, pause/resume
 * - PPT/slide generation pipeline
 * - Edit mode: EditModeAgentLoop, EditHistoryManager, createEditToolExecutor
 * - State machines and validators
 */

// ============================================================================
// Helpers
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";

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
  const { buildSlideHtml } = await import("../../../../js/agents/stages/design/dsl/dsl-builder.js");
  return buildSlideHtml(slideIntent, designSystem, contentPackage, { safeMode: true, slideNo: 1 });
}

// ============================================================================
// State Enums and Validators
// ============================================================================

it("DesignPhase enum contains expected values", async () => {
  const { DesignPhase } = await import("../../../../js/agents/stages/design/states.js");

  expect(DesignPhase.IDLE).toBe("idle");
  expect(DesignPhase.OUTLINE_PARSING).toBe("outline_parsing");
  expect(DesignPhase.GENERATING).toBe("generating");
  expect(DesignPhase.COMPLETED).toBe("completed");
  expect(DesignPhase.FAILED).toBe("failed");
  expect(DesignPhase.EDITING).toBe("editing");
});

it("SlideStatus enum contains expected values", async () => {
  const { SlideStatus } = await import("../../../../js/agents/stages/design/states.js");

  expect(SlideStatus.PENDING).toBe("pending");
  expect(SlideStatus.GENERATING).toBe("generating");
  expect(SlideStatus.COMPLETED).toBe("completed");
  expect(SlideStatus.FAILED).toBe("failed");
});

it("EditSessionStatus enum contains expected values", async () => {
  const { EditSessionStatus } = await import("../../../../js/agents/stages/design/states.js");

  expect(EditSessionStatus.IDLE).toBe("idle");
  expect(EditSessionStatus.AWAITING_INPUT).toBe("awaiting_input");
  expect(EditSessionStatus.PROCESSING).toBe("processing");
  expect(EditSessionStatus.EXECUTING).toBe("executing");
});

it("isValidDesignPhase validates correctly", async () => {
  const { isValidDesignPhase, DesignPhase } = await import("../../../../js/agents/stages/design/states.js");

  expect(isValidDesignPhase(DesignPhase.IDLE)).toBe(true);
  expect(isValidDesignPhase(DesignPhase.GENERATING)).toBe(true);
  expect(isValidDesignPhase("invalid_phase")).toBe(false);
  expect(isValidDesignPhase(null)).toBe(false);
  expect(isValidDesignPhase(undefined)).toBe(false);
});

it("isValidSlideStatus validates correctly", async () => {
  const { isValidSlideStatus, SlideStatus } = await import("../../../../js/agents/stages/design/states.js");

  expect(isValidSlideStatus(SlideStatus.PENDING)).toBe(true);
  expect(isValidSlideStatus(SlideStatus.COMPLETED)).toBe(true);
  expect(isValidSlideStatus("unknown")).toBe(false);
});

it("designPhaseMachine validates state transitions", async () => {
  const { designPhaseMachine, DesignPhase } = await import("../../../../js/agents/stages/design/states.js");

  expect(designPhaseMachine.canTransition(DesignPhase.IDLE, DesignPhase.OUTLINE_PARSING)).toBe(true);
  expect(designPhaseMachine.canTransition(DesignPhase.GENERATING, DesignPhase.COMPLETED)).toBe(true);
  expect(designPhaseMachine.canTransition(DesignPhase.COMPLETED, DesignPhase.EDITING)).toBe(true);

  // Invalid transitions
  expect(designPhaseMachine.canTransition(DesignPhase.IDLE, DesignPhase.COMPLETED)).toBe(false);
});

// ============================================================================
// DesignAgentLoop - Core Functionality
// ============================================================================

it("DesignAgentLoop runs phases, uses tools, emits events", async () => {
  const { DesignAgentLoop } = await import("../../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../../js/agents/stages/design/states.js");

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

  expect(deck.schemaVersion).toBe("0.1");
  expect(deck.slidesMeta.length).toBe(2);
  expect(deck.deckHtmlDsl).toContain("<section");

  // Verify tool call order
  expect(calls).toEqual(["parse_outline", "extract_style", "spawn_slide_agent", "fill_visual"]);

  // Verify phase transitions
  const transitions = events
    .filter((evt) => evt.name === "design.phase.transition")
    .map((evt) => evt.record.payload.to);

  expect(transitions).toContain(DesignPhase.OUTLINE_PARSING);
  expect(transitions).toContain(DesignPhase.GENERATING);
  expect(transitions).toContain(DesignPhase.COMPLETED);

  // Verify lifecycle events
  const eventNames = events.map((evt) => evt.name);
  expect(eventNames).toContain("design.started");
  expect(eventNames).toContain("design.ended");
});

it("DesignAgentLoop exposes getPhase and getStatus methods", async () => {
  const { DesignAgentLoop } = await import("../../../../js/agents/stages/design/agent-loop.js");
  const { DesignPhase } = await import("../../../../js/agents/stages/design/states.js");
  const { AgentStatus } = await import("../../../../js/agents/runtime/core/agent-status.js");

  const loop = new DesignAgentLoop();

  // Before run, phase should be IDLE
  expect(loop.getPhase()).toBe(DesignPhase.IDLE);
  expect(loop.getStatus()).toBe(AgentStatus.IDLE);
});

it("DesignAgentLoop handles tool execution errors gracefully", async () => {
  const { DesignAgentLoop } = await import("../../../../js/agents/stages/design/agent-loop.js");

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

  await expect(async () => {
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

it("EditHistoryManager supports basic undo/redo", async () => {
  const { EditHistoryManager } = await import("../../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager();
  const state = { value: 0 };

  const op1 = {
    undo: () => (state.value -= 10),
    redo: () => (state.value += 10),
  };

  state.value = 10;
  history.push(op1);

  expect(history.history.length).toBe(1);

  history.undo();
  expect(state.value).toBe(0);

  history.redo();
  expect(state.value).toBe(10);
});

it("EditHistoryManager respects maxHistory limit", async () => {
  const { EditHistoryManager } = await import("../../../../js/agents/stages/design/edit-mode/history.js");

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

  expect(history.history.length).toBe(3, "history should be limited to maxHistory");
});

it("EditHistoryManager supports transactions", async () => {
  const { EditHistoryManager } = await import("../../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager();
  const state = { count: 0 };

  history.beginTransaction();
  state.count += 5;
  history.push({ undo: () => (state.count -= 5), redo: () => (state.count += 5) });
  state.count += 3;
  history.push({ undo: () => (state.count -= 3), redo: () => (state.count += 3) });
  history.commit();

  expect(history.history.length).toBe(1, "transaction should batch operations");
  expect(state.count).toBe(8);

  history.undo();
  expect(state.count).toBe(0, "undo should revert entire transaction");

  history.redo();
  expect(state.count).toBe(8, "redo should reapply entire transaction");
});

it("EditHistoryManager rollback reverts uncommitted transaction", async () => {
  const { EditHistoryManager } = await import("../../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager();
  const state = { count: 10 };

  history.beginTransaction();
  state.count += 5;
  history.push({ undo: () => (state.count -= 5), redo: () => (state.count += 5) });
  history.rollback();

  expect(state.count).toBe(10, "rollback should revert changes");
  expect(history.history.length).toBe(0, "rollback should not add to history");
});

it("EditHistoryManager handles empty operations gracefully", async () => {
  const { EditHistoryManager } = await import("../../../../js/agents/stages/design/edit-mode/history.js");

  const history = new EditHistoryManager();

  // Undo/redo on empty history
  expect(history.undo()).toBe(null);
  expect(history.redo()).toBe(null);

  // Push invalid operation
  expect(history.push(null)).toBe(false);
  expect(history.push("not an object")).toBe(false);
});

// ============================================================================
// Edit Mode - createEditToolExecutor
// ============================================================================

it("createEditToolExecutor executes edit operations", async () => {
  const { createEditToolExecutor } = await import("../../../../js/agents/stages/design/edit-mode/tools.js");
  const { EditHistoryManager } = await import("../../../../js/agents/stages/design/edit-mode/history.js");

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
  expect(addResult.success).toBe(true);
  expect(state.slides.length).toBe(3);

  // Test edit_element
  const editResult = await executor("edit_element", { elementId: "el-1", changes: { text: "Updated" } });
  expect(editResult.success).toBe(true);
  expect(state.slides[0].elements[0].text).toBe("Updated");

  // Test undo
  await executor("undo", {});
  expect(state.slides[0].elements[0].text).toBe("Title");

  // Test redo
  await executor("redo", {});
  expect(state.slides[0].elements[0].text).toBe("Updated");
});

it("createEditToolExecutor handles move and resize operations", async () => {
  const { createEditToolExecutor } = await import("../../../../js/agents/stages/design/edit-mode/tools.js");
  const { EditHistoryManager } = await import("../../../../js/agents/stages/design/edit-mode/history.js");

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
  expect(state.slides[0].elements[0].x).toBe(50);
  expect(state.slides[0].elements[0].y).toBe(100);

  // Resize element
  await executor("resize_element", { elementId: "el-1", width: 200, height: 80 });
  expect(state.slides[0].elements[0].width).toBe(200);
  expect(state.slides[0].elements[0].height).toBe(80);
});

it("createEditToolExecutor handles theme and style changes", async () => {
  const { createEditToolExecutor } = await import("../../../../js/agents/stages/design/edit-mode/tools.js");
  const { EditHistoryManager } = await import("../../../../js/agents/stages/design/edit-mode/history.js");

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
  expect(state.designSystem.designTokens.colors.primary).toBe("#ff0000");
  expect(state.designSystem.designTokens.colors.accent).toBe("#00ff00");

  // Change font
  await executor("change_font", { headingFont: "Oswald" });
  expect(state.designSystem.designTokens.typography.headingFont).toBe("Oswald");

  // Apply theme
  await executor("apply_theme", { themeName: "dark" });
  expect(state.designSystem.theme).toBe("dark");
});

it("createEditToolExecutor returns error for invalid operations", async () => {
  const { createEditToolExecutor } = await import("../../../../js/agents/stages/design/edit-mode/tools.js");
  const { EditHistoryManager } = await import("../../../../js/agents/stages/design/edit-mode/history.js");

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
  expect(result.success).toBe(false);

  // Edit non-existent element
  const editResult = await executor("edit_element", { elementId: "nonexistent", changes: {} });
  expect(editResult.success).toBe(false);
});

// ============================================================================
// Edit Mode - EditModeTools
// ============================================================================

it("EditModeTools exports tool definitions", async () => {
  const { EditModeTools } = await import("../../../../js/agents/stages/design/edit-mode/tools.js");

  expect(EditModeTools).not.toBeNull();
  expect(EditModeTools).toBeTypeOf("object");
  expect(Array.isArray(EditModeTools)).toBe(false);
  expect(Object.keys(EditModeTools).length).toBeGreaterThan(0);
});

// ============================================================================
// Module Exports
// ============================================================================

it("design module exports all expected components", async () => {
  const design = await import("../../../../js/agents/stages/design/index.js");

  // Core classes
  expect(design.DesignAgentLoop).toBeTypeOf("function");
  expect(design.DesignStage).toBeTypeOf("function");
  expect(design.runDesignStage).toBeTypeOf("function");

  // Generators
  expect(design.generateDesignTokens).toBeTypeOf("function");
  expect(design.ImageGenerator).toBeTypeOf("function");
  expect(design.SVGGenerator).toBeTypeOf("function");

  // DSL
  expect(design.buildSlideHtml).toBeTypeOf("function");

  // Edit mode
  expect(design.EditModeAgentLoop).toBeTypeOf("function");
  expect(design.EditHistoryManager).toBeTypeOf("function");
  expect(design.createEditToolExecutor).toBeTypeOf("function");
  expect(design.EditModeTools).not.toBeNull();
  expect(design.EditModeTools).toBeTypeOf("object");

  // Sub agents
  expect(design.SlideSubAgent).toBeTypeOf("function");
  expect(design.VisualSubAgent).toBeTypeOf("function");

  // State machines
  expect(design.DesignPhase).not.toBeNull();
  expect(design.DesignPhase).toBeTypeOf("object");
  expect(design.SlideStatus).not.toBeNull();
  expect(design.SlideStatus).toBeTypeOf("object");
  expect(design.EditSessionStatus).not.toBeNull();
  expect(design.EditSessionStatus).toBeTypeOf("object");
  expect(design.designPhaseMachine).not.toBeNull();
  expect(design.designPhaseMachine).toBeTypeOf("object");
  expect(design.designPhaseMachine.canTransition).toBeTypeOf("function");
});

it("DESIGN_AGENT_TOOL_DEFINITIONS contains expected tools", async () => {
  const { DESIGN_AGENT_TOOL_DEFINITIONS } = await import("../../../../js/agents/stages/design/agent-loop.js");

  expect(DESIGN_AGENT_TOOL_DEFINITIONS).toBeInstanceOf(Array);

  const toolNames = DESIGN_AGENT_TOOL_DEFINITIONS.map((t) => t.name);
  expect(toolNames).toContain("parse_outline");
  expect(toolNames).toContain("extract_style");
  expect(toolNames).toContain("spawn_slide_agent");
});

// ============================================================================
// Generators
// ============================================================================

it("generateDesignTokens creates valid design tokens", async () => {
  const { generateDesignTokens } = await import("../../../../js/agents/stages/design/generators/design-tokens.js");

  const tokens = generateDesignTokens({
    theme: "dark",
    accent: "#007AFF",
  });

  expect(tokens).not.toBeNull();
  expect(tokens).toBeTypeOf("object");
  expect(tokens.designTokens).not.toBeNull();
  expect(tokens.designTokens).toBeTypeOf("object");
  expect(tokens.designTokens.colors).not.toBeNull();
  expect(tokens.designTokens.colors).toBeTypeOf("object");
});

// ============================================================================
// DSL Builder
// ============================================================================

it("buildSlideHtml generates valid HTML from slide intent", async () => {
  const { buildSlideHtml } = await import("../../../../js/agents/stages/design/dsl/dsl-builder.js");

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

  expect(html).toBeTypeOf("string");
  expect(html).toMatch(/<(section|div)\b/);
});

// ============================================================================
// Validators (from constants.js)
// ============================================================================

it("constants validators work correctly", async () => {
  const {
    isValidVisualType,
    isValidEditOperationType,
    VisualType,
    EditOperationType,
  } = await import("../../../../js/agents/stages/design/constants.js");

  // Visual types - use actual enum values
  expect(isValidVisualType(VisualType.ILLUSTRATION)).toBe(true);
  expect(isValidVisualType(VisualType.PHOTO)).toBe(true);
  expect(isValidVisualType(VisualType.ICON)).toBe(true);
  expect(isValidVisualType("invalid")).toBe(false);

  // Edit operation types - use actual enum values
  expect(isValidEditOperationType(EditOperationType.ADD_SLIDE)).toBe(true);
  expect(isValidEditOperationType(EditOperationType.EDIT_ELEMENT)).toBe(true);
  expect(isValidEditOperationType("invalid_op")).toBe(false);
});

// ============================================================================
// VisualSlotStatus and SubAgentStatus
// ============================================================================

it("VisualSlotStatus enum and validator", async () => {
  const { VisualSlotStatus, isValidVisualSlotStatus } = await import("../../../../js/agents/stages/design/states.js");

  expect(VisualSlotStatus.PENDING).toBe("pending");
  expect(VisualSlotStatus.GENERATING).toBe("generating");
  expect(VisualSlotStatus.FILLED).toBe("filled");
  expect(VisualSlotStatus.FAILED).toBe("failed");

  expect(isValidVisualSlotStatus(VisualSlotStatus.PENDING)).toBe(true);
  expect(isValidVisualSlotStatus("invalid")).toBe(false);
});

it("SubAgentStatus enum and validator", async () => {
  const { SubAgentStatus, isValidSubAgentStatus } = await import("../../../../js/agents/stages/design/states.js");

  expect(SubAgentStatus.IDLE).toBe("idle");
  expect(SubAgentStatus.RUNNING).toBe("running");
  expect(SubAgentStatus.MERGED).toBe("merged");
  expect(SubAgentStatus.FAILED).toBe("failed");

  expect(isValidSubAgentStatus(SubAgentStatus.RUNNING)).toBe(true);
  expect(isValidSubAgentStatus("unknown")).toBe(false);
});

it("ReviewStatus enum and validator", async () => {
  const { ReviewStatus, isValidReviewStatus } = await import("../../../../js/agents/stages/design/states.js");

  expect(ReviewStatus.PENDING).toBe("pending");
  expect(ReviewStatus.PASSED).toBe("passed");
  expect(ReviewStatus.FAILED).toBe("failed");

  expect(isValidReviewStatus(ReviewStatus.PASSED)).toBe(true);
  expect(isValidReviewStatus("unknown")).toBe(false);
});
