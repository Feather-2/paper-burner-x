import { RouterEvents } from "./events.js";
import { robustParseJson } from "../shared/robust-json.js";

export const ComplexityTier = Object.freeze({
  SIMPLE: "simple",
  MODERATE: "moderate",
  COMPLEX: "complex",
});

export const ModelTier = Object.freeze({
  WEAK: "weak",
  STANDARD: "standard",
  STRONG: "strong",
});

const DEFAULT_PIPELINE = ["scan", "gaps", "retrieve", "understand", "write"];
const RECOMMENDED_PIPELINE = ["scan", "retrieve", "write"];
const ENHANCED_PIPELINE = ["scan", "gaps", "retrieve", "understand", "write", "condense"];

const LARGE_CHAR_THRESHOLD = 200000;
const LARGE_PDF_PAGE_THRESHOLD = 30;
const LARGE_PDF_BYTES_THRESHOLD = 5_000_000;

const COMPLEXITY_SCORE_SIMPLE_MAX = 1;
const COMPLEXITY_SCORE_MODERATE_MAX = 3;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNonEmptyString(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length ? trimmed : "";
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeText(value) {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function toWordSet(text) {
  const words = normalizeText(text).toLowerCase().match(/[a-z0-9]+/g) || [];
  return new Set(words);
}

function scoreCost(cost) {
  if (cost === "low") return 2;
  if (cost === "medium") return 1;
  return 0;
}

export class RouterAgent {
  constructor({ modelRouter, blockRegistry, modelTier = ModelTier.STANDARD, eventBus } = {}) {
    this.modelRouter = modelRouter || null;
    this.blocks = blockRegistry || null;
    this.modelTier = Object.values(ModelTier).includes(modelTier) ? modelTier : ModelTier.STANDARD;
    this.eventBus = eventBus || null;
  }

  _emit(name, payload) {
    if (!this.eventBus || typeof this.eventBus.emit !== "function") return;
    this.eventBus.emit(name, { actor: "router", status: "info", payload });
  }

  _normalizeTaskGoal(task) {
    if (typeof task === "string") return task;
    if (!isPlainObject(task)) return "";
    return toNonEmptyString(task.taskGoal || task.goal || task.intent);
  }

  _extractSources(context) {
    const sources = Array.isArray(context?.sources) ? context.sources : [];
    const assets = Array.isArray(context?.assets) ? context.assets : [];
    return sources.concat(assets);
  }

  _detectHeavyProcessing(sources, context, task) {
    if (task?.requiresOcr || task?.needsOcr || context?.requiresOcr) return true;

    const totalChars = toNumber(context?.totalChars ?? task?.totalChars);
    if (totalChars !== null && totalChars >= LARGE_CHAR_THRESHOLD) return true;

    for (const source of sources) {
      if (!isPlainObject(source)) continue;
      const typeHint = normalizeText(source.kind || source.type || source.sourceType || source.mediaType || source.format);
      const mimeType = normalizeText(source.mimeType || source.mimetype);
      const filename = normalizeText(source.filename || source.name || source.path);
      const pages = toNumber(source.pageCount ?? source.pages ?? source.totalPages);
      const bytes = toNumber(source.sizeBytes ?? source.size ?? source.bytes);
      const isVideo = typeHint.includes("video") || mimeType.startsWith("video/") || /\.(mp4|mkv|mov|webm|avi)$/i.test(filename);
      if (isVideo) return true;

      const isPdf = typeHint.includes("pdf") || mimeType === "application/pdf" || /\.pdf$/i.test(filename);
      const isOcr = typeHint.includes("ocr") || source.ocr === true;
      if (isOcr) return true;
      if (isPdf) {
        if (source.largePdf || source.isLarge || source.large) return true;
        if ((pages !== null && pages >= LARGE_PDF_PAGE_THRESHOLD) || (bytes !== null && bytes >= LARGE_PDF_BYTES_THRESHOLD)) {
          return true;
        }
      }
    }

    return false;
  }

  _collectComplexityMetrics(task, context) {
    const sources = this._extractSources(context);
    const sourceCount = sources.length;
    const goal = this._normalizeTaskGoal(task);
    const goalLength = goal.length;
    const questionCount = (goal.match(/\?/g) || []).length;
    const hasMultipleQuestions = questionCount > 1 || (Array.isArray(task?.questions) && task.questions.length > 1);
    const estimatedTime = toNumber(task?.estimatedTime ?? context?.estimatedTime);
    const totalChars = toNumber(context?.totalChars ?? task?.totalChars);
    const hasHeavyProcessing = this._detectHeavyProcessing(sources, context, task);

    return {
      sourceCount,
      goalLength,
      questionCount,
      hasMultipleQuestions,
      hasHeavyProcessing,
      estimatedTime,
      totalChars,
    };
  }

  async assessComplexity(task, context) {
    const metrics = this._collectComplexityMetrics(task, context);
    let score = 0;

    if (metrics.sourceCount >= 3) score += 1;
    if (metrics.sourceCount >= 8) score += 1;
    if (metrics.goalLength >= 120) score += 1;
    if (metrics.goalLength >= 300) score += 1;
    if (metrics.hasMultipleQuestions) score += 1;
    if (metrics.hasHeavyProcessing) score += 2;
    if (metrics.estimatedTime !== null && metrics.estimatedTime >= 30) score += 1;
    if (metrics.estimatedTime !== null && metrics.estimatedTime >= 60) score += 1;
    if (metrics.totalChars !== null && metrics.totalChars >= 120000) score += 1;

    let tier = ComplexityTier.SIMPLE;
    if (score <= COMPLEXITY_SCORE_SIMPLE_MAX) tier = ComplexityTier.SIMPLE;
    else if (score <= COMPLEXITY_SCORE_MODERATE_MAX) tier = ComplexityTier.MODERATE;
    else tier = ComplexityTier.COMPLEX;

    this._emit(RouterEvents.ROUTER_COMPLEXITY_ASSESSED, { tier, score, metrics });
    return tier;
  }

  async plan(task, context) {
    this._emit(RouterEvents.ROUTER_PLAN_START, {
      modelTier: this.modelTier,
      taskGoal: this._normalizeTaskGoal(task),
    });

    const complexity = await this.assessComplexity(task, context);
    let plan = null;

    if (this.modelTier === ModelTier.WEAK) {
      plan = {
        mode: "fixed_pipeline",
        stages: this.getDefaultPipeline(),
        reason: "weak_model_fallback",
      };
    } else if (complexity === ComplexityTier.SIMPLE) {
      const block = this.selectBestBlock(task);
      const blockName = toNonEmptyString(block?.name || block?.id || "") || "direct";
      this._emit(RouterEvents.ROUTER_BLOCK_SELECTED, { block: blockName });
      plan = {
        mode: "direct",
        stages: [{ name: blockName, dependsOn: [] }],
        block: blockName,
        reason: "simple_task",
      };
    } else if (complexity === ComplexityTier.MODERATE) {
      plan = {
        mode: "recommended_pipeline",
        stages: this.getRecommendedPipeline(task),
        reason: "moderate_complexity",
      };
    } else if (this.modelTier === ModelTier.STRONG) {
      const pipeline = await this.assemblePipeline(task, context);
      plan = {
        mode: pipeline.mode || "assembled_dag",
        stages: pipeline.stages,
        reason: pipeline.reason || "complex_task_ai_assembled",
      };
    } else {
      plan = {
        mode: "enhanced_pipeline",
        stages: this.getEnhancedPipeline(task),
        reason: "complex_task_standard_model",
      };
    }

    this._emit(RouterEvents.ROUTER_PIPELINE_ASSEMBLED, {
      mode: plan.mode,
      stages: plan.stages,
      reason: plan.reason,
      complexity,
      modelTier: this.modelTier,
    });

    return plan;
  }

  selectBestBlock(task) {
    const manifests = this.blocks && typeof this.blocks.getManifests === "function" ? this.blocks.getManifests() : [];
    if (!manifests.length) return { name: "direct" };

    const goal = this._normalizeTaskGoal(task);
    const words = toWordSet(goal);
    let best = manifests[0];
    let bestScore = -Infinity;

    for (const manifest of manifests) {
      const name = normalizeText(manifest?.name).toLowerCase();
      let score = 0;

      if (name && words.has(name)) score += 4;
      const capabilities = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
      for (const cap of capabilities) {
        if (words.has(String(cap).toLowerCase())) score += 2;
      }

      const whenToUse = normalizeText(manifest?.whenToUse).toLowerCase();
      const description = normalizeText(manifest?.description).toLowerCase();
      for (const word of words) {
        if (whenToUse.includes(word)) score += 1;
        if (description.includes(word)) score += 0.5;
      }

      score += scoreCost(manifest?.estimatedCost);

      if (score > bestScore) {
        bestScore = score;
        best = manifest;
      }
    }

    return best;
  }

  getDefaultPipeline() {
    return this._buildLinearPipeline(DEFAULT_PIPELINE);
  }

  getRecommendedPipeline() {
    return this._buildLinearPipeline(RECOMMENDED_PIPELINE);
  }

  getEnhancedPipeline() {
    return this._buildLinearPipeline(ENHANCED_PIPELINE);
  }

  _buildLinearPipeline(names) {
    const list = Array.isArray(names) ? names : [];
    const stages = [];
    let prev = null;
    for (const name of list) {
      if (!toNonEmptyString(name)) continue;
      const dependsOn = prev ? [prev] : [];
      stages.push({ name, dependsOn });
      prev = name;
    }
    return stages;
  }

  async assemblePipeline(task, context) {
    const catalog = this.blocks && typeof this.blocks.buildCatalogPrompt === "function"
      ? this.blocks.buildCatalogPrompt()
      : "";
    const goal = this._normalizeTaskGoal(task);
    const sourceCount = Array.isArray(context?.sources) ? context.sources.length : 0;
    const totalChars = toNumber(context?.totalChars) ?? 0;

    const prompt = [
      "You are a pipeline architect. Design the best execution DAG for the task and available blocks.",
      "",
      "## Task",
      goal || "(empty)",
      "",
      "## Context",
      `- Source count: ${sourceCount}`,
      `- Total chars: ${totalChars}`,
      "",
      "## Available blocks",
      catalog || "(none)",
      "",
      "## Output format",
      "Return JSON only:",
      "{",
      '  "stages": ["stage1", "stage2"],',
      '  "dependsOn": { "stage2": ["stage1"] },',
      '  "reasoning": "design rationale"',
      "}",
    ].join("\n");

    let raw = null;
    try {
      raw = await this._callModel([{ role: "user", content: prompt }]);
    } catch {
      raw = null;
    }

    const parsed = this._parsePipelineResponse(raw);
    if (!parsed || parsed.stages.length === 0) {
      return {
        mode: "enhanced_pipeline",
        stages: this.getEnhancedPipeline(task),
        reason: "assembly_failed_fallback",
      };
    }

    return {
      mode: "assembled_dag",
      stages: parsed.stages,
      reason: parsed.reasoning || "ai_assembled",
      dependsOn: parsed.dependsOn,
    };
  }

  _parsePipelineResponse(raw) {
    if (!raw) return null;
    const parsed = typeof raw === "string" ? robustParseJson(raw, null) : (isPlainObject(raw) ? raw : null);
    if (!parsed) return null;

    const stageList = Array.isArray(parsed.stages) ? parsed.stages.map((s) => normalizeText(s)).filter(Boolean) : [];
    const dependsOnRaw = isPlainObject(parsed.dependsOn) ? parsed.dependsOn : {};
    const dependsOn = {};

    for (const [name, deps] of Object.entries(dependsOnRaw)) {
      const key = normalizeText(name);
      if (!key) continue;
      const list = Array.isArray(deps) ? deps.map((d) => normalizeText(d)).filter(Boolean) : [];
      dependsOn[key] = list;
    }

    const stages = [];
    const seen = new Set();

    const addStage = (name) => {
      if (!name || seen.has(name)) return;
      seen.add(name);
      stages.push({
        name,
        dependsOn: Array.isArray(dependsOn[name]) ? dependsOn[name] : [],
      });
    };

    for (const name of stageList) addStage(name);
    for (const name of Object.keys(dependsOn)) addStage(name);

    if (stages.length === 0 && stageList.length > 0) {
      return { stages: this._buildLinearPipeline(stageList), dependsOn: {}, reasoning: normalizeText(parsed.reasoning || parsed.reason) };
    }

    if (stages.length === 0) return null;

    return {
      stages,
      dependsOn,
      reasoning: normalizeText(parsed.reasoning || parsed.reason),
    };
  }

  async _callModel(messages) {
    if (this.modelRouter && typeof this.modelRouter.call === "function") {
      try {
        const resp = await this.modelRouter.call({ usage: "router", messages });
        return resp?.content ?? resp?.text ?? resp;
      } catch (err) {
        if (this.modelRouter.call.length >= 2) {
          const resp = await this.modelRouter.call(messages, { usage: "router" });
          return resp?.content ?? resp?.text ?? resp;
        }
        throw err;
      }
    }

    if (this.modelRouter && typeof this.modelRouter.chat === "function") {
      const resp = await this.modelRouter.chat(messages);
      return resp?.content ?? resp?.text ?? resp;
    }

    throw new Error("RouterAgent: modelRouter is required for assemblePipeline");
  }
}

export default RouterAgent;
