/**
 * Design Agent Tools
 *
 * 从 DesignAgentLoop 提取的工具定义和处理器
 */

import { generateBatch } from "./generators/batch-generator.js";
import { getEmitFn } from "../../runtime/index.js";

function normalizeToolParams(toolName, params, state) {
  const normalized = params && typeof params === "object" ? { ...params } : {};

  if (toolName === "fill_visual") {
    const hasSlotsForRender = Array.isArray(normalized.visualSlotsForRender);
    const hasSlots = Array.isArray(normalized.visualSlots);
    if (!hasSlotsForRender && hasSlots) {
      normalized.visualSlotsForRender = normalized.visualSlots;
    }
  }

  if (toolName === "fix_slide") {
    if (normalized.currentHtml == null && typeof state?.deckHtmlDsl === "string") {
      normalized.currentHtml = state.deckHtmlDsl;
    }
    if (normalized.designSystem == null && state?.designSystem != null) {
      normalized.designSystem = state.designSystem;
    }
  }

  return normalized;
}

/**
 * 工具定义 (给模型选择用)
 */
export const DESIGN_AGENT_TOOL_DEFINITIONS = Object.freeze([
  {
    name: "parse_outline",
    description: "Parse source content into slide intents.",
    parameters: {
      type: "object",
      properties: {
        contentPackage: { type: "object" },
      },
    },
  },
  {
    name: "extract_style",
    description: "Extract or generate design system from inputs.",
    parameters: {
      type: "object",
      properties: {
        contentPackage: { type: "object" },
        constraints: { type: "object" },
        userConfig: { type: "object" },
      },
    },
  },
  {
    name: "spawn_slide_agent",
    description: "Generate slide HTML DSL in parallel batches.",
    parameters: {
      type: "object",
      properties: {
        slideIntents: { type: "array" },
        contentPackage: { type: "object" },
        designSystem: { type: "object" },
      },
    },
  },
  {
    name: "take_screenshot",
    description: "Capture slide screenshots for review.",
    parameters: {
      type: "object",
      properties: {
        slideIndex: { type: "number" },
      },
    },
  },
  {
    name: "fix_slide",
    description: "Apply fixes to a slide based on review feedback.",
    parameters: {
      type: "object",
      properties: {
        slideIndex: { type: "number" },
        issues: { type: "array" },
      },
    },
  },
  {
    name: "fill_visual",
    description: "Fill visuals (images/SVG/assets) for slides.",
    parameters: {
      type: "object",
      properties: {
        visualSlots: { type: "array" },
      },
    },
  },
  {
    name: "chat_ask",
    description: "Ask user for feedback or confirmation.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string" },
        actionName: { type: "string" },
      },
      required: ["message"],
    },
  },
  {
    name: "orchestrate_batch_repair",
    description: "Orchestrate multiple repairs for slides and global style alignment across the deck.",
    parameters: {
      type: "object",
      properties: {
        deckPackage: { type: "object" },
        qaIssues: { type: "array" },
        styleIssues: { type: "array" },
        designSystem: { type: "object" },
      },
      required: ["deckPackage", "designSystem"],
    },
  },
]);

function emitStage(emit, name, status, payload) {
  emit?.(name, { actor: "design", status, payload });
}

/**
 * 创建工具处理器集合
 * @param {object} agentLoop - DesignAgentLoop 实例 (用于访问 batchSize 等配置)
 */
export function createDesignToolHandlers(agentLoop) {
  return {
    parse_outline: async (params = {}) => {
      const pkg = params.contentPackage || null;
      const slideIntents = Array.isArray(pkg?.slideIntents) ? pkg.slideIntents : [];
      return { slideIntents, contentPackage: pkg };
    },

    extract_style: async (params = {}, context = {}) => {
      const contentPackage = params.contentPackage || null;
      const constraints = params.constraints || {};
      const userConfig = params.userConfig || {};
      const designSystem = await agentLoop._initDesignSystem(contentPackage, context, constraints, userConfig);
      return { designSystem };
    },

    spawn_slide_agent: async (params = {}, context = {}) => {
      const slideIntents = Array.isArray(params.slideIntents) ? params.slideIntents : [];
      const contentPackage = params.contentPackage || null;
      const designSystem = params.designSystem || null;
      const generated = await generateBatch(slideIntents, contentPackage, designSystem, {
        batchSize: params.batchSize || agentLoop.batchSize,
        batchConcurrency: params.batchConcurrency || agentLoop.batchConcurrency,
        modelRouter: params.modelRouter || null,
        aiApiService: params.aiApiService || context.aiApiService,
        imageSlots: Array.isArray(params.imageSlots) ? params.imageSlots : [],
        selectedIdeas: Array.isArray(params.selectedIdeas) ? params.selectedIdeas : [],
        emit: params.emit || null,
        signal: params.signal || context.signal,
        dslRules: params.dslRules || null,
      });
      return { generated };
    },

    take_screenshot: async () => {
      return { screenshots: [] };
    },

    fix_slide: async (params = {}, context = {}) => {
      const normalized = normalizeToolParams("fix_slide", params, agentLoop?.state);
      const { slideIndex, currentHtml, issues, designSystem } = normalized;
      const { runSingleSlideRepair } = await import("./refiner/batch-repair-agent.js");
      const fixed = await runSingleSlideRepair(
        { slideIndex, currentHtml, issues, designSystem },
        { aiApiService: context.aiApiService, modelRouter: context.modelRouter, signal: context.signal }
      );
      return { fixedHtml: fixed };
    },

    fill_visual: async (params = {}, context = {}) => {
      const normalized = normalizeToolParams("fill_visual", params, agentLoop?.state);
      return agentLoop._renderVisuals(
        Array.isArray(normalized.visualSlotsForRender) ? normalized.visualSlotsForRender : [],
        normalized.contentPackage || null,
        normalized.designSystem || null,
        Array.isArray(normalized.slideHtmls) ? normalized.slideHtmls : [],
        context,
        normalized.runContext || {},
        normalized.constraints || {},
        Array.isArray(normalized.imageSlots) ? normalized.imageSlots : [],
        Array.isArray(normalized.aiImageSlotIds) ? normalized.aiImageSlotIds : []
      );
    },

    chat_ask: async (params = {}, context = {}) => {
      const emit = getEmitFn(context);
      emitStage(emit, "design.chat.ask", "progress", {
        message: params.message || "",
        actionName: params.actionName || "chat_reply",
      });
      if (!params.actionName) return { actionName: "chat_reply" };
      const payload = await agentLoop.waitForUserAction(params.actionName, {
        eventBus: context.eventBus,
        signal: context.signal,
      });
      return { actionName: params.actionName, payload };
    },

    orchestrate_batch_repair: async (params = {}, context = {}) => {
      const { runBatchRepair } = await import("./refiner/batch-repair-agent.js");
      return runBatchRepair(params, {
        ...context,
        stageApi: agentLoop, // Pass the master agent loop as stageApi for tool execution
      });
    },
  };
}

/**
 * 获取工具定义列表
 */
export function getToolDefinitions() {
  return DESIGN_AGENT_TOOL_DEFINITIONS.slice();
}
