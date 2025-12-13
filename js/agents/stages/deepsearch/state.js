import { PlanningTree } from "./planning-tree.js";

const STATE_SCHEMA_VERSION = "0.1";
const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_CHECKPOINT_STRATEGY = "lite";
const DEFAULT_BUDGET_CONFIG = Object.freeze({
  maxTokens: 50_000,
  maxCostUSD: 0.5,
  warnAt: 0.8,
  action: "warn",
});

const DEFAULT_MODEL_PRICES_USD_PER_1K = Object.freeze({
  // OpenAI (placeholder defaults; override via userConfig.budget.prices for exact billing).
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.005, output: 0.015 },
  "gpt-4.1-mini": { input: 0.0003, output: 0.0012 },
  "gpt-4.1": { input: 0.003, output: 0.012 },

  // Anthropic (placeholder defaults; override via userConfig.budget.prices for exact billing).
  "claude-3-5-sonnet": { input: 0.003, output: 0.015 },
  "claude-3-5-haiku": { input: 0.0008, output: 0.004 },

  // Gemini & others: default to unknown/0 unless configured.
});

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function safeNumber(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function normalizeTokenUsage(usage) {
  if (!isPlainObject(usage)) return null;

  const promptTokens = safeInt(
    usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens ?? usage.input ?? usage.prompt ?? usage.promptTokensUsed
  );
  const completionTokens = safeInt(
    usage.completion_tokens ??
      usage.completionTokens ??
      usage.output_tokens ??
      usage.outputTokens ??
      usage.output ??
      usage.completion ??
      usage.completionTokensUsed
  );
  const totalTokens = safeInt(usage.total_tokens ?? usage.totalTokens ?? usage.total);

  const hasAny = promptTokens !== null || completionTokens !== null || totalTokens !== null;
  if (!hasAny) return null;

  const input = Math.max(0, promptTokens ?? 0);
  const output = Math.max(0, completionTokens ?? 0);
  const total = Math.max(0, totalTokens ?? input + output);
  const estimatedCostUSD = safeNumber(usage.estimatedCostUSD ?? usage.costUSD);
  return { input, output, total, ...(estimatedCostUSD !== null ? { estimatedCostUSD: Math.max(0, estimatedCostUSD) } : {}) };
}

function ensureTokenUsage(v) {
  const normalized = normalizeTokenUsage(v);
  if (normalized) {
    return {
      input: normalized.input,
      output: normalized.output,
      total: normalized.total,
      estimatedCostUSD: safeNumber(normalized.estimatedCostUSD) ?? 0,
    };
  }
  return { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };
}

function normalizeCheckpointStrategy(v) {
  const s = toNonEmptyString(v);
  return s === "full" ? "full" : "lite";
}

function normalizeBudgetAction(v) {
  const s = toNonEmptyString(v);
  if (s === "warn" || s === "degrade" || s === "stop") return s;
  return DEFAULT_BUDGET_CONFIG.action;
}

function normalizeModelPrices(raw) {
  const prices = isPlainObject(raw) ? raw : {};
  const out = {};

  for (const [modelId, entry] of Object.entries(prices)) {
    if (!toNonEmptyString(modelId)) continue;
    if (!isPlainObject(entry)) continue;
    const input = safeNumber(entry.input ?? entry.inputPer1K ?? entry.inputUsdPer1K ?? entry.inputUSDPer1K);
    const output = safeNumber(entry.output ?? entry.outputPer1K ?? entry.outputUsdPer1K ?? entry.outputUSDPer1K);
    if (input === null && output === null) continue;
    out[String(modelId)] = { ...(input !== null ? { input: Math.max(0, input) } : {}), ...(output !== null ? { output: Math.max(0, output) } : {}) };
  }

  return out;
}

export function normalizeBudgetConfig(raw) {
  const cfg = isPlainObject(raw) ? raw : {};

  const maxTokens = safeInt(cfg.maxTokens);
  const maxCostUSD = safeNumber(cfg.maxCostUSD);
  const warnAtRaw = safeNumber(cfg.warnAt);
  const warnAt = warnAtRaw === null ? DEFAULT_BUDGET_CONFIG.warnAt : Math.max(0, Math.min(1, warnAtRaw));
  const action = normalizeBudgetAction(cfg.action);

  const mergedPrices = { ...DEFAULT_MODEL_PRICES_USD_PER_1K, ...normalizeModelPrices(cfg.prices) };

  return {
    maxTokens: maxTokens !== null && maxTokens >= 0 ? maxTokens : DEFAULT_BUDGET_CONFIG.maxTokens,
    maxCostUSD: maxCostUSD !== null && maxCostUSD >= 0 ? maxCostUSD : DEFAULT_BUDGET_CONFIG.maxCostUSD,
    warnAt,
    action,
    prices: mergedPrices,
  };
}

function getCheckpointStrategyFromState(state, override) {
  const direct = override !== undefined ? override : state?.userConfig?.checkpointStrategy;
  return normalizeCheckpointStrategy(direct || DEFAULT_CHECKPOINT_STRATEGY);
}

function deepCloneJsonSafe(v) {
  return JSON.parse(JSON.stringify(v));
}

function buildLiteSnapshot(state) {
  const retrievedChunks = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
  const retrievedChunkIds = retrievedChunks.map((r) => toNonEmptyString(r?.chunkId)).filter(Boolean);

  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const hasSourceIndex = Boolean(state?.L0?.sourceIndex);

  return {
    snapshotStrategy: "lite",
    schemaVersion: state.schemaVersion,
    runId: state.runId,
    createdAt: state.createdAt,
    taskGoal: state.taskGoal,
    userConfig: deepCloneJsonSafe(state.userConfig),
    planningTree: state.planningTree?.serialize ? state.planningTree.serialize() : null,
    ...(toNonEmptyString(state.trajectoryId) ? { trajectoryId: state.trajectoryId } : {}),
    ...(isPlainObject(state.trajectoryConfig) ? { trajectoryConfig: deepCloneJsonSafe(state.trajectoryConfig) } : {}),
    iteration: state.iteration,
    maxIterations: state.maxIterations,
    writeBacktrackCount: state.writeBacktrackCount,
    writeSnapshots: deepCloneJsonSafe(state.writeSnapshots),
    L0: {
      sourcesRef: "state.L0.sources",
      sourceIndexRef: "state.L0.sourceIndex",
      sourcesCount: sources.length,
      hasSourceIndex,
    },
    L1: deepCloneJsonSafe(state.L1),
    L2: {
      retrievedChunkIds,
      tokenUsage: deepCloneJsonSafe(ensureTokenUsage(state?.L2?.tokenUsage)),
      incomplete: true,
    },
    todos: deepCloneJsonSafe(state.todos),
    timeline: deepCloneJsonSafe(state.timeline),
  };
}

export function extractJsonCandidate(text) {
  const s = String(text || "").trim();
  if (!s) return null;

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return s.slice(firstBrace, lastBrace + 1);

  const firstBracket = s.indexOf("[");
  const lastBracket = s.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) return s.slice(firstBracket, lastBracket + 1);

  return s;
}

export function makeStageEmitter(stageApi, actor = "deepsearch") {
  const emitFn = stageApi?.emit || stageApi?.eventBus?.emit;
  if (typeof emitFn !== "function") return null;
  return (name, payload, { status = "completed" } = {}) => emitFn.call(stageApi?.eventBus || null, name, { actor, status, payload });
}

export function checkCancelled(stageApi) {
  if (typeof stageApi?.checkCancelled === "function") stageApi.checkCancelled();
  if (stageApi?.signal?.aborted) {
    const reason = stageApi.signal.reason;
    throw new Error(typeof reason === "string" ? reason : "Run cancelled");
  }
}

export class DeepSearchState {
  constructor({
    runId,
    taskGoal,
    userConfig,
    L0,
    L1,
    L2,
    todos,
    timeline,
    createdAt,
    schemaVersion,
    iteration,
    maxIterations,
    checkpoints,
    planningTree,
    trajectoryId,
    trajectoryConfig,
    writeBacktrackCount,
    writeSnapshots,
  } = {}) {
    this.schemaVersion = toNonEmptyString(schemaVersion) || STATE_SCHEMA_VERSION;
    this.runId = toNonEmptyString(runId) || "run_unknown";
    this.createdAt = toNonEmptyString(createdAt) || new Date().toISOString();

    this.taskGoal = toNonEmptyString(taskGoal) || "";
    this.userConfig = isPlainObject(userConfig) ? userConfig : {};
    this.trajectoryId = toNonEmptyString(trajectoryId);
    this.trajectoryConfig = isPlainObject(trajectoryConfig) ? trajectoryConfig : isPlainObject(this.userConfig?.trajectory) ? this.userConfig.trajectory : undefined;
    this.planningTree =
      planningTree instanceof PlanningTree
        ? planningTree
        : isPlainObject(planningTree)
          ? PlanningTree.fromJSON(planningTree)
          : new PlanningTree({ rootGoal: this.taskGoal, runId: this.runId });

    const it = safeInt(iteration);
    this.iteration = it !== null && it >= 0 ? it : 0;
    const maxIt = safeInt(maxIterations);
    this.maxIterations = maxIt !== null && maxIt >= 1 ? maxIt : DEFAULT_MAX_ITERATIONS;
    this.checkpoints = Array.isArray(checkpoints) ? checkpoints : [];

    this.L0 = isPlainObject(L0)
      ? L0
      : {
          sources: [],
          sourceIndex: null,
        };

    this.L1 = isPlainObject(L1)
      ? L1
      : {
          scanSummary: null,
          deepDivePlan: null,
          gaps: [],
          retrieved: [],
          claims: [],
          evidenceLedger: [],
          dataTables: [],
          slideIntents: [],
          outlineCandidates: [],
          report: null,
          conflicts: [],
          openQuestions: [],
          condensedMemory: null,
        };

    this.L2 = isPlainObject(L2)
      ? {
          ...L2,
          retrievedChunks: Array.isArray(L2?.retrievedChunks) ? L2.retrievedChunks : [],
          scratchpad: isPlainObject(L2?.scratchpad) ? L2.scratchpad : {},
          logs: Array.isArray(L2?.logs) ? L2.logs : [],
          tokenUsage: ensureTokenUsage(L2?.tokenUsage),
        }
      : {
          retrievedChunks: [],
          scratchpad: {},
          logs: [],
          tokenUsage: { input: 0, output: 0, total: 0, estimatedCostUSD: 0 },
        };

    this.todos = Array.isArray(todos) ? todos : [];
    this.timeline = Array.isArray(timeline) ? timeline : [];

    const wbc = safeInt(writeBacktrackCount);
    this.writeBacktrackCount = wbc !== null && wbc >= 0 ? wbc : 0;
    this.writeSnapshots = Array.isArray(writeSnapshots) ? writeSnapshots : [];
  }

  addTokenUsage(usage) {
    const delta = normalizeTokenUsage(usage);
    if (!delta) return this?.L2?.tokenUsage || { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };

    if (!isPlainObject(this.L2)) this.L2 = {};
    if (!isPlainObject(this.L2.tokenUsage)) this.L2.tokenUsage = { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };

    const cur = this.L2.tokenUsage;
    const curInput = safeInt(cur.input) ?? 0;
    const curOutput = safeInt(cur.output) ?? 0;
    const curTotal = safeInt(cur.total) ?? 0;
    const curCost = safeNumber(cur.estimatedCostUSD) ?? 0;

    cur.input = curInput + delta.input;
    cur.output = curOutput + delta.output;
    cur.total = curTotal + delta.total;
    if (safeNumber(delta.estimatedCostUSD) !== null) cur.estimatedCostUSD = curCost + (safeNumber(delta.estimatedCostUSD) ?? 0);
    else cur.estimatedCostUSD = curCost;
    return cur;
  }

  getBudgetConfig() {
    return normalizeBudgetConfig(this?.userConfig?.budget);
  }

  addTodo({ todoId, text, status = "open", relatedGapId } = {}) {
    const id = toNonEmptyString(todoId) || `todo_${this.todos.length + 1}`;
    const t = toNonEmptyString(text) || "";
    const st = toNonEmptyString(status) || "open";
    const row = { todoId: id, text: t, status: st, ...(toNonEmptyString(relatedGapId) ? { relatedGapId: String(relatedGapId) } : {}) };
    this.todos.push(row);
    return row;
  }

  addTimeline({ name, status = "info", payload } = {}) {
    const n = toNonEmptyString(name) || "deepsearch.event";
    const st = toNonEmptyString(status) || "info";
    const row = { ts: new Date().toISOString(), name: n, status: st, ...(payload !== undefined ? { payload } : {}) };
    this.timeline.push(row);
    return row;
  }

  saveWriteSnapshot({ timestamp } = {}) {
    const ts = toNonEmptyString(timestamp) || new Date().toISOString();
    const snapshot = {
      snapshotId: `wcp_${this.writeSnapshots.length + 1}`,
      iteration: this.iteration,
      timestamp: String(ts),
      slideIntents: Array.isArray(this?.L1?.slideIntents) ? deepCloneJsonSafe(this.L1.slideIntents) : [],
      report: isPlainObject(this?.L1?.report) ? deepCloneJsonSafe(this.L1.report) : null,
    };
    this.writeSnapshots.push(snapshot);
    return snapshot;
  }

  reopenGaps(gapIds, { reason, timestamp } = {}) {
    const ids = Array.from(new Set((Array.isArray(gapIds) ? gapIds : gapIds ? [gapIds] : []).map((x) => String(x || "").trim()).filter(Boolean)));
    if (!ids.length) return { reopened: [], missing: [] };

    if (!isPlainObject(this.L1)) this.L1 = {};
    if (!Array.isArray(this.L1.gaps)) this.L1.gaps = [];
    const gaps = this.L1.gaps;

    const now = toNonEmptyString(timestamp) || new Date().toISOString();
    const reopened = [];
    const missing = new Set(ids);

    for (const g of gaps) {
      const gid = toNonEmptyString(g?.gapId);
      if (!gid) continue;
      if (!missing.has(gid)) continue;
      missing.delete(gid);

      g.status = "open";
      g.missCount = 0;
      g.reopenedAt = now;
      if (toNonEmptyString(reason)) g.reopenedReason = String(reason);
      delete g.filledAt;
      delete g.filledIteration;
      delete g.blockedAt;
      delete g.blockedReason;

      reopened.push(gid);
    }

    const todoByGapId = new Map();
    for (const t of Array.isArray(this?.todos) ? this.todos : []) {
      const rgid = toNonEmptyString(t?.relatedGapId);
      if (!rgid) continue;
      todoByGapId.set(rgid, t);
    }
    for (const gid of reopened) {
      const t = todoByGapId.get(gid);
      if (t) t.status = "open";
    }

    const tree = this?.planningTree;
    if (tree && typeof tree.getNodesForGap === "function" && typeof tree.updateStatus === "function") {
      for (const gid of reopened) {
        for (const n of tree.getNodesForGap(gid)) tree.updateStatus(n.nodeId, "pending");
      }
    }

    return { reopened, missing: Array.from(missing) };
  }

  addNewGaps(newGaps, { timestamp } = {}) {
    const rows = Array.isArray(newGaps) ? newGaps : [];
    if (!rows.length) return [];

    if (!isPlainObject(this.L1)) this.L1 = {};
    if (!Array.isArray(this.L1.gaps)) this.L1.gaps = [];
    const gaps = this.L1.gaps;

    const existingId = new Set(gaps.map((g) => toNonEmptyString(g?.gapId)).filter(Boolean));
    let max = 0;
    for (const gid of existingId) {
      const m = String(gid).match(/^gap_(\d+)$/);
      if (!m) continue;
      const n = safeInt(Number(m[1]));
      if (n !== null && n > max) max = n;
    }

    const now = toNonEmptyString(timestamp) || new Date().toISOString();
    const added = [];
    for (const g of rows) {
      const question = toNonEmptyString(g?.question);
      if (!question) continue;
      const priority = toNonEmptyString(g?.priority) || "medium";

      let gapId = `gap_${(max += 1)}`;
      while (existingId.has(gapId)) gapId = `gap_${(max += 1)}`;
      existingId.add(gapId);

      const row = {
        gapId,
        type: "write_backtrack",
        question: String(question),
        priority: String(priority),
        status: "open",
        queryHints: [],
        createdAt: now,
      };
      gaps.push(row);
      added.push(row);

      this.addTodo({ text: `Fill gap: ${row.type} — ${row.question}`, relatedGapId: gapId, status: "open" });
      this?.planningTree?.expandFromGap?.(row);
    }
    return added;
  }

  saveCheckpoint({ checkpointId, timestamp, metrics } = {}) {
    const id = toNonEmptyString(checkpointId) || `cp_${this.checkpoints.length + 1}`;
    const ts = toNonEmptyString(timestamp) || new Date().toISOString();

    const checkpointStrategy = getCheckpointStrategyFromState(this);
    const snapshot =
      checkpointStrategy === "full"
        ? DeepSearchState.fromJSON(deepCloneJsonSafe(this.toJSON({ includeCheckpoints: false })))
        : buildLiteSnapshot(this);

    const gaps = Array.isArray(this?.L1?.gaps) ? this.L1.gaps : [];
    const openGapCount = gaps.filter((g) => (g?.status ? String(g.status) : "open") === "open").length;
    const claims = Array.isArray(this?.L1?.claims) ? this.L1.claims : [];
    const evidenceLedger = Array.isArray(this?.L1?.evidenceLedger) ? this.L1.evidenceLedger : [];
    const retrievedChunks = Array.isArray(this?.L2?.retrievedChunks) ? this.L2.retrievedChunks : [];

    const m = isPlainObject(metrics)
      ? metrics
      : {
          gapCount: openGapCount,
          claimCount: claims.length,
          evidenceCount: evidenceLedger.length,
          retrievedCount: retrievedChunks.length,
        };

    const checkpoint = {
      checkpointId: String(id),
      iteration: this.iteration,
      timestamp: String(ts),
      strategy: checkpointStrategy,
      stateSnapshot: snapshot,
      metrics: {
        gapCount: safeInt(m.gapCount) ?? openGapCount,
        claimCount: safeInt(m.claimCount) ?? claims.length,
        evidenceCount: safeInt(m.evidenceCount) ?? evidenceLedger.length,
        retrievedCount: safeInt(m.retrievedCount) ?? retrievedChunks.length,
      },
    };

    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  restoreCheckpoint(checkpointId) {
    const id = toNonEmptyString(checkpointId);
    if (!id) throw new TypeError("DeepSearchState.restoreCheckpoint(checkpointId): checkpointId is required");

    const cp = this.checkpoints.find((c) => toNonEmptyString(c?.checkpointId) === id);
    if (!cp) throw new Error(`Checkpoint not found: ${String(id)}`);

    const explicitStrategy = toNonEmptyString(cp?.strategy);
    const checkpointStrategy = explicitStrategy
      ? normalizeCheckpointStrategy(explicitStrategy)
      : cp?.stateSnapshot instanceof DeepSearchState
        ? "full"
        : toNonEmptyString(cp?.stateSnapshot?.snapshotStrategy) === "lite"
          ? "lite"
          : isPlainObject(cp?.stateSnapshot?.L2) && Array.isArray(cp.stateSnapshot.L2.retrievedChunkIds) && !Array.isArray(cp.stateSnapshot.L2.retrievedChunks)
            ? "lite"
            : "full";
    const preservedL0 = this.L0;
    const snapshot = cp.stateSnapshot instanceof DeepSearchState ? cp.stateSnapshot : DeepSearchState.fromJSON(cp.stateSnapshot);
    const preservedCheckpoints = this.checkpoints;

    const restored = snapshot.toJSON({ includeCheckpoints: false });
    this.schemaVersion = restored.schemaVersion;
    this.runId = restored.runId;
    this.createdAt = restored.createdAt;
    this.taskGoal = restored.taskGoal;
    this.userConfig = restored.userConfig;
    this.iteration = safeInt(restored.iteration) ?? 0;
    this.maxIterations = safeInt(restored.maxIterations) ?? DEFAULT_MAX_ITERATIONS;
    this.L0 = checkpointStrategy === "lite" ? preservedL0 : restored.L0;
    this.L1 = restored.L1;
    this.L2 = restored.L2;
    this.planningTree =
      restored.planningTree instanceof PlanningTree
        ? restored.planningTree
        : isPlainObject(restored.planningTree)
          ? PlanningTree.fromJSON(restored.planningTree)
          : new PlanningTree({ rootGoal: this.taskGoal, runId: this.runId });
    this.todos = restored.todos;
    this.timeline = restored.timeline;
    this.checkpoints = preservedCheckpoints;

    if (checkpointStrategy === "lite") {
      const restoredIds = Array.isArray(restored?.L2?.retrievedChunkIds) ? restored.L2.retrievedChunkIds.map(String).filter(Boolean) : [];
      const tokenUsage = ensureTokenUsage(restored?.L2?.tokenUsage);
      this.L2 = {
        ...this.L2,
        retrievedChunkIds: restoredIds,
        tokenUsage,
        retrievedChunks: [],
        scratchpad: {},
        logs: [],
        incomplete: true,
        restoredFromLiteCheckpoint: true,
      };
    }

    this.addTimeline({ name: "deepsearch.checkpoint.restored", status: "info", payload: { checkpointId: id, iteration: this.iteration } });
    return cp;
  }

  toJSON({ includeCheckpoints = true } = {}) {
    return {
      schemaVersion: this.schemaVersion,
      runId: this.runId,
      createdAt: this.createdAt,
      taskGoal: this.taskGoal,
      userConfig: this.userConfig,
      planningTree: this.planningTree?.serialize ? this.planningTree.serialize() : null,
      ...(toNonEmptyString(this.trajectoryId) ? { trajectoryId: this.trajectoryId } : {}),
      ...(isPlainObject(this.trajectoryConfig) ? { trajectoryConfig: this.trajectoryConfig } : {}),
      iteration: this.iteration,
      maxIterations: this.maxIterations,
      ...(includeCheckpoints ? { checkpoints: this.checkpoints } : {}),
      writeBacktrackCount: this.writeBacktrackCount,
      writeSnapshots: this.writeSnapshots,
      L0: this.L0,
      L1: this.L1,
      L2: this.L2,
      todos: this.todos,
      timeline: this.timeline,
    };
  }

  serialize({ pretty = false } = {}) {
    return JSON.stringify(this.toJSON(), null, pretty ? 2 : 0);
  }

  clone({ includeCheckpoints = true } = {}) {
    const snapshotObj = this.toJSON({ includeCheckpoints });
    return DeepSearchState.fromJSON(deepCloneJsonSafe(snapshotObj));
  }

  static fromJSON(json) {
    if (!isPlainObject(json)) throw new TypeError("DeepSearchState.fromJSON(json): json must be an object");
    const state = new DeepSearchState(json);
    if (isPlainObject(json.planningTree)) state.planningTree = PlanningTree.fromJSON(json.planningTree);
    return state;
  }

  static deserialize(text) {
    const parsed = JSON.parse(String(text || ""));
    return DeepSearchState.fromJSON(parsed);
  }
}
