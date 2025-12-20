const ESTIMATED_CHARS_PER_TOKEN = 4;
const HEAVY_TOKEN_THRESHOLD = 40000;

export const ComplexityLevel = Object.freeze({
  TRIVIAL: "trivial",
  SIMPLE: "simple",
  MODERATE: "moderate",
  COMPLEX: "complex",
  HEAVY: "heavy",
});

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

function toBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(trimmed)) return true;
    if (["false", "0", "no", "n", "off"].includes(trimmed)) return false;
  }
  return false;
}

function estimateTokensFromChars(value) {
  const chars = toNumber(value);
  if (chars === null) return null;
  return Math.ceil(chars / ESTIMATED_CHARS_PER_TOKEN);
}

function normalizeKey(value) {
  if (value === null || value === undefined) return "";
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function resolveSourceType(source) {
  if (!isPlainObject(source)) return "";
  const typeHint = toNonEmptyString(
    source.kind || source.type || source.sourceType || source.mediaType || source.format
  );
  if (typeHint) return typeHint.toLowerCase();
  const mimeType = toNonEmptyString(source.mimeType || source.mimetype);
  if (mimeType) return mimeType.toLowerCase();
  const filename = toNonEmptyString(source.filename || source.name || source.path);
  const extMatch = filename.match(/\.([a-z0-9]+)$/i);
  if (extMatch) return extMatch[1].toLowerCase();
  return "";
}

function normalizeToolList(payload) {
  if (Array.isArray(payload)) return payload;
  if (isPlainObject(payload)) {
    const tools = payload.tools ?? payload.data?.tools ?? payload.result?.tools ?? payload.items ?? payload.data;
    if (Array.isArray(tools)) return tools;
  }
  return [];
}

function normalizeComplexity(value, fallback) {
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if (key === "trivial") return ComplexityLevel.TRIVIAL;
    if (key === "simple") return ComplexityLevel.SIMPLE;
    if (key === "moderate") return ComplexityLevel.MODERATE;
    if (key === "complex") return ComplexityLevel.COMPLEX;
    if (key === "heavy") return ComplexityLevel.HEAVY;
  }
  const numeric = toNumber(value);
  if (numeric !== null) {
    if (numeric <= 0) return ComplexityLevel.TRIVIAL;
    if (numeric === 1) return ComplexityLevel.SIMPLE;
    if (numeric === 2) return ComplexityLevel.MODERATE;
    if (numeric === 3) return ComplexityLevel.COMPLEX;
    return ComplexityLevel.HEAVY;
  }
  return fallback;
}

function normalizeCapabilityList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((cap) => String(cap)).filter((cap) => cap.trim().length > 0);
}

function toolMatchesCapability(tool, capability) {
  const capKey = normalizeKey(capability);
  if (!capKey) return false;
  const name = normalizeKey(tool?.name || tool?.id || "");
  const description = normalizeKey(tool?.description || "");
  const combined = `${name} ${description}`.trim();
  if (!combined) return false;
  if (combined.includes(capKey)) return true;
  if (capKey.includes("web search") && combined.includes("search")) return true;
  if (capKey.includes("external search") && combined.includes("search")) return true;
  if (capKey.includes("search") && combined.includes("search")) return true;
  if (capKey.includes("fetch") && combined.includes("fetch")) return true;
  return false;
}

export class RequirementAnalyzer {
  constructor({ shadowModel, mcpNexus, skillRegistry, blockRegistry } = {}) {
    this.shadowModel = shadowModel || null;
    this.mcpNexus = mcpNexus || null;
    this.skillRegistry = skillRegistry || null;
    this.blockRegistry = blockRegistry || null;
  }

  async analyze(task, context) {
    const assessment = await this._assessWithShadowModel(task, context);
    const explicitRequest = this._parseExplicitRequest(task, context);
    const requiredCapabilities = this._determineRequiredCapabilities(assessment, explicitRequest, task, context);
    const mcpTools = await this._discoverMcpTools(requiredCapabilities);
    const skills = this.skillRegistry ? this._matchCapabilities({ requiredCapabilities }, this.skillRegistry) : [];

    const metrics = assessment.metrics || this._collectMetrics(task, context);
    const baseLevel = this._determineLevel(metrics, explicitRequest);
    const shadowLevel = toNumber(assessment.recommendedLevel);
    const level = shadowLevel !== null ? Math.max(shadowLevel, baseLevel) : baseLevel;
    const complexity = normalizeComplexity(assessment.complexity, this._classifyComplexity(metrics));

    return { level, complexity, requiredCapabilities, mcpTools, skills, explicitRequest };
  }

  async _assessWithShadowModel(task, context) {
    const fallback = this._heuristicAssessment(task, context);
    if (!this.shadowModel) return fallback;

    const payload = {
      taskGoal: this._normalizeTaskGoal(task),
      sourceCount: fallback.metrics.sourceCount,
      sourceTypes: fallback.metrics.sourceTypes,
      estimatedTokens: fallback.metrics.estimatedTokens,
      typeCount: fallback.metrics.typeCount,
      questionCount: fallback.metrics.questionCount,
    };

    let raw = null;
    try {
      if (typeof this.shadowModel.evaluate === "function") {
        raw = await this.shadowModel.evaluate(payload);
      } else if (typeof this.shadowModel.assess === "function") {
        raw = await this.shadowModel.assess(payload);
      } else if (typeof this.shadowModel === "function") {
        raw = await this.shadowModel(payload);
      } else {
        return fallback;
      }
    } catch {
      return fallback;
    }

    if (!isPlainObject(raw)) return fallback;

    const normalized = { ...fallback };
    normalized.complexity = normalizeComplexity(raw.complexity ?? raw.tier ?? raw.level, fallback.complexity);
    const recommendedLevel = toNumber(raw.recommendedLevel ?? raw.level ?? raw.recommended);
    if (recommendedLevel !== null) normalized.recommendedLevel = recommendedLevel;

    const caps = normalizeCapabilityList(raw.requiredCapabilities ?? raw.capabilities ?? raw.capabilityHints);
    if (caps.length > 0) normalized.requiredCapabilities = caps;

    return normalized;
  }

  _parseExplicitRequest(task, context) {
    const requiresWebSearch = toBoolean(
      task?.requiresWebSearch ??
        task?.needsWebSearch ??
        task?.requiresExternalSearch ??
        task?.needsExternalSearch ??
        context?.requiresWebSearch ??
        context?.needsWebSearch ??
        context?.requiresExternalSearch ??
        context?.needsExternalSearch ??
        context?.forceExternal ??
        context?.forceWebSearch
    );

    const requiresStrong = toBoolean(
      task?.requiresStrong ??
        task?.requiresStrongModel ??
        task?.needsStrongModel ??
        context?.requiresStrong ??
        context?.requiresStrongModel ??
        context?.needsStrongModel ??
        context?.forceStrong
    );

    const forceDAG = toBoolean(
      task?.forceDAG ??
        task?.forceDag ??
        task?.requiresDAG ??
        task?.useDAG ??
        context?.forceDAG ??
        context?.forceDag ??
        context?.requiresDAG ??
        context?.useDAG
    );

    return {
      forceDAG,
      requiresWebSearch,
      requiresStrong,
      needsExternalSearch: requiresWebSearch,
      needsStrongModel: requiresStrong,
    };
  }

  _matchCapabilities(assessment, registry) {
    const requiredCapabilities = normalizeCapabilityList(
      Array.isArray(assessment) ? assessment : assessment?.requiredCapabilities
    );
    if (!registry || requiredCapabilities.length === 0) return [];

    const matches = [];
    const seen = new Set();
    const normalizedRequired = requiredCapabilities.map((cap) => normalizeKey(cap));

    const maybeAdd = (name) => {
      if (!name || seen.has(name)) return;
      seen.add(name);
      matches.push(name);
    };

    const matchesCandidate = (candidate) => {
      const candidateKey = normalizeKey(candidate);
      if (!candidateKey) return false;
      for (const required of normalizedRequired) {
        if (!required) continue;
        if (candidateKey.includes(required) || required.includes(candidateKey)) return true;
      }
      return false;
    };

    if (typeof registry.getManifests === "function") {
      const manifests = registry.getManifests() || [];
      for (const manifest of manifests) {
        const candidates = [manifest?.name, ...(Array.isArray(manifest?.capabilities) ? manifest.capabilities : [])];
        if (candidates.some(matchesCandidate)) maybeAdd(manifest?.name);
      }
      return matches;
    }

    if (typeof registry.getAllDefinitions === "function") {
      const definitions = registry.getAllDefinitions() || [];
      for (const def of definitions) {
        const activation = def?.activation || {};
        const metadataCaps = Array.isArray(def?.metadata?.capabilities) ? def.metadata.capabilities : [];
        const candidates = [
          def?.name,
          ...(Array.isArray(activation.keywords) ? activation.keywords : []),
          ...(Array.isArray(activation.tags) ? activation.tags : []),
          ...(Array.isArray(activation.traits) ? activation.traits : []),
          ...metadataCaps,
        ];
        if (candidates.some(matchesCandidate)) maybeAdd(def?.name);
      }
    }

    return matches;
  }

  _normalizeTaskGoal(task) {
    if (typeof task === "string") return task.trim();
    if (!isPlainObject(task)) return "";
    return toNonEmptyString(task.taskGoal || task.goal || task.intent);
  }

  _extractSources(context) {
    const sources = Array.isArray(context?.sources) ? context.sources : [];
    const assets = Array.isArray(context?.assets) ? context.assets : [];
    return sources.concat(assets);
  }

  _collectMetrics(task, context) {
    const sources = this._extractSources(context);
    const typeSet = new Set();
    for (const source of sources) {
      const type = resolveSourceType(source);
      if (type) typeSet.add(type);
    }

    const goal = this._normalizeTaskGoal(task);
    const goalLength = goal.length;
    const questionCount = (goal.match(/\?/g) || []).length;
    const questionListCount = Array.isArray(task?.questions) ? task.questions.length : 0;
    const questionTotal = Math.max(questionCount, questionListCount);
    const totalChars = toNumber(context?.totalChars ?? task?.totalChars);
    const estimatedTokens =
      toNumber(task?.estimatedTokens ?? context?.estimatedTokens) ??
      estimateTokensFromChars(totalChars) ??
      estimateTokensFromChars(goalLength) ??
      0;

    const hasHeavyProcessing = Boolean(
      (totalChars !== null && totalChars >= 200000) ||
        estimatedTokens >= HEAVY_TOKEN_THRESHOLD ||
        sources.some((source) => resolveSourceType(source).includes("video"))
    );

    return {
      sourceCount: sources.length,
      sourceTypes: Array.from(typeSet.values()),
      typeCount: typeSet.size,
      goalLength,
      questionCount: questionTotal,
      hasMultipleQuestions: questionTotal > 1,
      estimatedTokens,
      totalChars,
      hasHeavyProcessing,
    };
  }

  _classifyComplexity(metrics) {
    const sourceCount = toNumber(metrics?.sourceCount) ?? 0;
    const estimatedTokens = toNumber(metrics?.estimatedTokens) ?? 0;
    const typeCount = toNumber(metrics?.typeCount) ?? 0;
    const questionCount = toNumber(metrics?.questionCount) ?? 0;

    if (sourceCount > 20 || estimatedTokens >= HEAVY_TOKEN_THRESHOLD || typeCount >= 4) {
      return ComplexityLevel.HEAVY;
    }

    let score = 0;
    if (sourceCount >= 2) score += 1;
    if (sourceCount >= 5) score += 1;
    if (sourceCount >= 10) score += 1;

    if (estimatedTokens >= 2000) score += 1;
    if (estimatedTokens >= 8000) score += 1;
    if (estimatedTokens >= 20000) score += 1;

    if (typeCount >= 2) score += 1;
    if (typeCount >= 3) score += 1;

    if (questionCount >= 2) score += 1;
    if (questionCount >= 4) score += 1;

    if (score <= 1) return ComplexityLevel.TRIVIAL;
    if (score <= 3) return ComplexityLevel.SIMPLE;
    if (score <= 6) return ComplexityLevel.MODERATE;
    return ComplexityLevel.COMPLEX;
  }

  _heuristicAssessment(task, context) {
    const metrics = this._collectMetrics(task, context);
    const complexity = this._classifyComplexity(metrics);
    const recommendedLevel = this._determineLevel(metrics, {});
    const requiredCapabilities = this._inferCapabilities(metrics, task);
    return { complexity, recommendedLevel, requiredCapabilities, metrics };
  }

  _inferCapabilities(metrics, task) {
    const required = new Set();
    const sourceCount = toNumber(metrics?.sourceCount) ?? 0;
    const typeCount = toNumber(metrics?.typeCount) ?? 0;
    const questionCount = toNumber(metrics?.questionCount) ?? 0;
    const estimatedTokens = toNumber(metrics?.estimatedTokens) ?? 0;

    if (sourceCount > 0) required.add("scan");
    if (sourceCount > 1 || questionCount > 0) required.add("search");
    if (questionCount > 1) required.add("gap_detection");
    if (typeCount >= 2) required.add("segment");
    if (estimatedTokens >= 8000 || typeCount >= 3) required.add("condense");

    const goal = normalizeKey(this._normalizeTaskGoal(task));
    if (goal.includes("summary") || goal.includes("summarize") || goal.includes("report")) {
      required.add("report_generation");
    }

    return Array.from(required.values());
  }

  _determineRequiredCapabilities(assessment, explicitRequest, task, context) {
    const fromShadow = normalizeCapabilityList(assessment?.requiredCapabilities);
    const inferred = fromShadow.length > 0 ? fromShadow : this._inferCapabilities(assessment?.metrics, task, context);
    const required = new Set(inferred);

    if (explicitRequest?.requiresWebSearch) {
      required.add("web_search");
      required.add("search");
    }
    if (explicitRequest?.requiresStrong) required.add("strong_model");
    if (explicitRequest?.forceDAG) required.add("dag");

    return Array.from(required.values());
  }

  _determineLevel(metrics, explicitRequest) {
    const sourceCount = toNumber(metrics?.sourceCount) ?? 0;
    const estimatedTokens = toNumber(metrics?.estimatedTokens) ?? 0;
    const typeCount = toNumber(metrics?.typeCount) ?? 0;
    const hasHeavyProcessing = Boolean(metrics?.hasHeavyProcessing);
    const needsExternalSearch = Boolean(explicitRequest?.requiresWebSearch);
    const needsStrongModel = Boolean(explicitRequest?.requiresStrong);

    let level = 1;
    if (sourceCount <= 3 && estimatedTokens < 5000) {
      level = 0;
    } else if (sourceCount <= 10 && estimatedTokens < 20000) {
      level = 1;
    } else if (needsExternalSearch || needsStrongModel) {
      level = 2;
    } else if (sourceCount > 20 || typeCount >= 3 || hasHeavyProcessing) {
      level = 3;
    }

    if (explicitRequest?.forceDAG) level = 3;
    if (needsExternalSearch || needsStrongModel) level = Math.max(level, 2);

    return level;
  }

  async _discoverMcpTools(requiredCapabilities) {
    if (!this.mcpNexus) return [];
    const tools = await this._listMcpTools();
    return this._filterMcpTools(tools, requiredCapabilities);
  }

  async _listMcpTools() {
    if (!this.mcpNexus) return [];
    try {
      if (typeof this.mcpNexus.listAvailableTools === "function") {
        return normalizeToolList(await this.mcpNexus.listAvailableTools());
      }
      if (typeof this.mcpNexus.listTools === "function") {
        return normalizeToolList(await this.mcpNexus.listTools());
      }
      if (typeof this.mcpNexus.listAllTools === "function") {
        return normalizeToolList(await this.mcpNexus.listAllTools());
      }
    } catch {
      return [];
    }
    return [];
  }

  _filterMcpTools(tools, requiredCapabilities) {
    const list = Array.isArray(tools) ? tools : [];
    const required = normalizeCapabilityList(requiredCapabilities);
    if (required.length === 0) return list;
    return list.filter((tool) => required.some((cap) => toolMatchesCapability(tool, cap)));
  }
}

export default RequirementAnalyzer;
