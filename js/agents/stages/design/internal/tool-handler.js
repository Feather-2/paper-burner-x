import { resolveToolExecutor } from "../../../runtime/index.js";
import { DESIGN_AGENT_TOOL_DEFINITIONS, createDesignToolHandlers } from "../design-tools.js";
import { DesignPhase } from "../states.js";

export function initDesignTooling(loop, tools) {
  const designTools = createDesignToolHandlers(loop);
  loop.registerTools(designTools);
  if (tools) loop.registerTools(tools);
  loop._designTools = designTools;

  // Backward-compatible tool shortcuts used by older tests.
  loop._toolParseOutline = designTools.parse_outline;
  loop._toolExtractStyle = designTools.extract_style;
  loop._toolSpawnSlideAgent = designTools.spawn_slide_agent;
  loop._toolTakeScreenshot = designTools.take_screenshot;
  loop._toolFixSlide = designTools.fix_slide;
  loop._toolFillVisual = designTools.fill_visual;
  loop._toolChatAsk = designTools.chat_ask;

  return designTools;
}

export function getDesignToolDefinitions() {
  return DESIGN_AGENT_TOOL_DEFINITIONS.slice();
}

export function installToolHandler(ctor) {
  Object.assign(ctor.prototype, {
    getToolDefinitions() {
      return getDesignToolDefinitions();
    },
  });
}

export function createResumeToolExecutor({ agentLoop, stageApi, resumeState, contentPackage }) {
  const phaseRank = {
    [DesignPhase.IDLE]: 0,
    [DesignPhase.OUTLINE_PARSING]: 1,
    [DesignPhase.OUTLINE_CONFIRMING]: 1,
    [DesignPhase.STYLE_EXTRACTING]: 1,
    [DesignPhase.STYLE_CONFIRMING]: 2,
    [DesignPhase.DECK_PLANNING]: 2,
    [DesignPhase.PLAN_CONFIRMING]: 2,
    [DesignPhase.LAYOUT_ANALYZING]: 3,
    [DesignPhase.LAYOUT_GENERATING]: 4,
    [DesignPhase.LAYOUT_DEVELOPING]: 4,
    [DesignPhase.LAYOUT_CONFIRMING]: 4,
    [DesignPhase.GENERATING]: 5,
    [DesignPhase.GENERATING_PAUSED]: 5,
    [DesignPhase.REVIEWING]: 6,
    [DesignPhase.FIXING]: 6,
    [DesignPhase.REPAIR]: 6,
    [DesignPhase.VISUAL_FILLING]: 7,
    [DesignPhase.COMPLETED]: 8,
    [DesignPhase.EDITING]: 8,
    [DesignPhase.FAILED]: 0,
  };

  const resumePhase = resumeState?.phase || DesignPhase.IDLE;
  const resumeIndex = phaseRank[resumePhase] ?? 0;
  const canUseOutline = resumeIndex >= phaseRank[DesignPhase.STYLE_EXTRACTING];
  const canUseDesign = resumeIndex >= phaseRank[DesignPhase.STYLE_CONFIRMING];
  const canUseGenerated = resumeIndex >= phaseRank[DesignPhase.VISUAL_FILLING];

  const baseExecutor = resolveToolExecutor(stageApi);
  const outlineContentPackage =
    resumeState?.parsedContentPackage || resumeState?.contentPackage || contentPackage || null;
  const outlineSlideIntents =
    resumeState?.slideIntents ||
    (Array.isArray(outlineContentPackage?.slideIntents) ? outlineContentPackage.slideIntents : null);
  let cachedGenerated = resumeState?.generated;
  if (!cachedGenerated && Array.isArray(resumeState?.slideHtmls)) {
    const sources = Array.isArray(resumeState?.slidesMeta) ? resumeState.slidesMeta : [];
    cachedGenerated = resumeState.slideHtmls.map((slideHtml, index) => ({
      slideHtml,
      source: sources[index]?.source || "resume",
    }));
  }

  return async (name, params, context) => {
    if (name === "parse_outline" && canUseOutline && Array.isArray(outlineSlideIntents)) {
      return { contentPackage: outlineContentPackage, slideIntents: outlineSlideIntents };
    }
    if (name === "extract_style" && canUseDesign && resumeState?.designSystem) {
      return { designSystem: resumeState.designSystem };
    }
    if (name === "spawn_slide_agent" && canUseGenerated && Array.isArray(cachedGenerated)) {
      return { generated: cachedGenerated };
    }
    if (typeof baseExecutor === "function") {
      return baseExecutor(name, params, context);
    }
    const tool = agentLoop?._tools?.[name];
    if (typeof tool === "function") {
      return tool(params, context);
    }
    return { ok: false, error: `Unknown tool: ${name}` };
  };
}
