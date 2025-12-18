import { PlanningTree } from "./planning-tree.js";
import { isPlainObject, safeInt, safeNumber, toNonEmptyString } from "../../shared/value-utils.js";

const STATE_SCHEMA_VERSION = "0.1";
const CHECKPOINT_SCHEMA_VERSION = "1.0";
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

export const EVENT_SCHEMA_VERSION = "deepsearch.event.v1";

export const EventStatus = Object.freeze({
  STARTED: "started",
  PROGRESS: "progress",
  COMPLETED: "completed",
  FAILED: "failed",
  WARNING: "warning",
  INFO: "info",
});

export const GapStatus = Object.freeze({
  OPEN: "open",
  FILLED: "filled",
  BLOCKED: "blocked",
});

/**
 * 统一的 gap 状态转换函数，确保字段一致性
 */
export function transitionGap(g, to, { runId, iteration, reason, ts, evidenceCount }, emitFn) {
  const from = toNonEmptyString(g?.status) || GapStatus.OPEN;
  if (from === to) return false; // 无转换

  const gapId = toNonEmptyString(g?.gapId) || "unknown";

  if (to === GapStatus.FILLED) {
    g.status = GapStatus.FILLED;
    g.filledAt = ts;
    g.filledIteration = iteration;
    if (typeof evidenceCount === "number") g.evidenceCount = evidenceCount;
    // 清理 blocked 相关字段
    delete g.blockedAt;
    delete g.blockedReason;
  } else if (to === GapStatus.BLOCKED) {
    g.status = GapStatus.BLOCKED;
    g.blockedAt = ts;
    g.blockedReason = String(g.blockedReason || reason || "no_retrieval_hits");
    // 清理 filled 相关字段
    delete g.filledAt;
    delete g.filledIteration;
    delete g.evidenceCount;
  } else {
    // OPEN
    g.status = GapStatus.OPEN;
    g.missCount = 0;
    delete g.filledAt;
    delete g.filledIteration;
    delete g.evidenceCount;
    delete g.blockedAt;
    delete g.blockedReason;
  }

  emitFn?.("deepsearch.gap.status.changed", {
    runId,
    gapId,
    from,
    to: g.status,
    reason: reason || (to === GapStatus.FILLED ? "evidence" : to === GapStatus.BLOCKED ? "no_hits" : "reopen"),
    iteration,
  });

  return true;
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

function cloneValueFallback(v, seen) {
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v)) return "[Circular]";
  seen.add(v);

  if (Array.isArray(v)) return v.map((item) => cloneValueFallback(item, seen));
  if (v instanceof Date) return new Date(v.getTime());
  if (v instanceof RegExp) return new RegExp(v);
  if (v instanceof Map) {
    const out = new Map();
    for (const [k, val] of v.entries()) out.set(cloneValueFallback(k, seen), cloneValueFallback(val, seen));
    return out;
  }
  if (v instanceof Set) {
    const out = new Set();
    for (const item of v.values()) out.add(cloneValueFallback(item, seen));
    return out;
  }

  const cloned = {};
  for (const [k, val] of Object.entries(v)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    cloned[k] = cloneValueFallback(val, seen);
  }
  return cloned;
}

function hasCycle(root) {
  if (root === null || typeof root !== "object") return false;

  const visited = new WeakSet();
  const stack = new WeakSet();

  const walk = (v) => {
    if (v === null || typeof v !== "object") return false;
    if (stack.has(v)) return true;
    if (visited.has(v)) return false;

    visited.add(v);
    stack.add(v);

    if (Array.isArray(v)) {
      for (const item of v) if (walk(item)) return true;
      stack.delete(v);
      return false;
    }

    if (v instanceof Map) {
      for (const [k, val] of v.entries()) if (walk(k) || walk(val)) return true;
      stack.delete(v);
      return false;
    }

    if (v instanceof Set) {
      for (const item of v.values()) if (walk(item)) return true;
      stack.delete(v);
      return false;
    }

    for (const val of Object.values(v)) if (walk(val)) return true;
    stack.delete(v);
    return false;
  };

  return walk(root);
}

function cloneValue(v, seen = new WeakSet()) {
  if (v === null || typeof v !== "object") return v;
  if (typeof structuredClone === "function") {
    try {
      if (!hasCycle(v)) return structuredClone(v);
    } catch {}
  }

  return cloneValueFallback(v, seen);
}

// Migration registry for checkpoint objects (not DeepSearchState snapshots).
// Keys are the *source* checkpoint schemaVersion, and each migrator returns a checkpoint object compatible with the current schema.
const CHECKPOINT_MIGRATIONS = Object.freeze({
  // Legacy checkpoints had no schemaVersion; treat them as "0.0" and simply stamp the current version.
  "0.0": (checkpoint) => ({ ...checkpoint, schemaVersion: CHECKPOINT_SCHEMA_VERSION }),
});

export function loadCheckpoint(checkpoint) {
  if (!isPlainObject(checkpoint)) throw new TypeError("loadCheckpoint(checkpoint): checkpoint must be an object");

  const version = toNonEmptyString(checkpoint?.schemaVersion) || "0.0";
  if (version === CHECKPOINT_SCHEMA_VERSION) return checkpoint;

  const migrate = CHECKPOINT_MIGRATIONS[version];
  if (typeof migrate === "function") {
    const migrated = migrate(checkpoint);
    if (!isPlainObject(migrated)) throw new TypeError(`Checkpoint migration ${version} -> ${CHECKPOINT_SCHEMA_VERSION} must return an object`);
    return { ...migrated, schemaVersion: CHECKPOINT_SCHEMA_VERSION };
  }

  console.warn(`Unknown checkpoint schema version: ${version} (expected ${CHECKPOINT_SCHEMA_VERSION}); attempting to load anyway`);
  return checkpoint;
}

function buildLiteSnapshot(state) {
  const retrievedChunks = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
  const retrievedChunkIds = retrievedChunks.map((r) => toNonEmptyString(r?.chunkId)).filter(Boolean);

  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const hasSourceIndex = Boolean(state?.L0?.sourceIndex);

  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];

  return {
    snapshotStrategy: "lite",
    schemaVersion: state.schemaVersion,
    checkpointSchemaVersion: CHECKPOINT_SCHEMA_VERSION,
    runId: state.runId,
    createdAt: state.createdAt,
    taskGoal: state.taskGoal,
    userConfig: cloneValue(state.userConfig),
    planningTree: state.planningTree?.serialize ? state.planningTree.serialize() : null,
    ...(toNonEmptyString(state.trajectoryId) ? { trajectoryId: state.trajectoryId } : {}),
    ...(isPlainObject(state.trajectoryConfig) ? { trajectoryConfig: cloneValue(state.trajectoryConfig) } : {}),
    iteration: state.iteration,
    maxIterations: state.maxIterations,
    writeBacktrackCount: state.writeBacktrackCount,
    writeSnapshots: cloneValue(state.writeSnapshots),
    L0: {
      sourcesRef: "state.L0.sources",
      sourceIndexRef: "state.L0.sourceIndex",
      sourcesCount: sources.length,
      hasSourceIndex,
    },
    L1Summary: {
      gapCount: gaps.length,
      claimCount: claims.length,
      gapIds: gaps.map((g) => toNonEmptyString(g?.gapId)).filter(Boolean),
    },
    L2: {
      retrievedChunkIds,
      tokenUsage: cloneValue(ensureTokenUsage(state?.L2?.tokenUsage)),
      incomplete: true,
    },
    todos: cloneValue(state.todos),
    timeline: cloneValue(state.timeline),
  };
}

/**
 * Strip DeepSeek-R1 style <think>...</think> reasoning blocks from LLM output.
 * These blocks contain chain-of-thought reasoning that should not be part of the final output.
 */
export function stripThinkingTags(text) {
  const s = String(text || "");
  // Remove <think>...</think> blocks (non-greedy, handles nested content)
  return s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export function extractJsonCandidate(text) {
  // First strip any <think> reasoning blocks from R1 models
  const stripped = stripThinkingTags(text);
  const s = stripped.trim();
  if (!s) return null;

  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) return fenced[1].trim();

  // Try to extract a valid JSON value (supports {} and []), even when the text
  // contains multiple brace/bracket pairs or trailing noise.
  const pairs = [
    ["{", "}"],
    ["[", "]"],
  ]
    .map(([open, close]) => ({ open, close, first: s.indexOf(open) }))
    .filter((p) => p.first >= 0)
    .sort((a, b) => a.first - b.first);

  for (const { open, close, first } of pairs) {
    for (let j = s.length - 1; j > first; j--) {
      if (s[j] !== close) continue;
      const candidate = s.slice(first, j + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {}
    }
  }

  return s;
}

export function makeStageEmitter(stageApi, actor = "deepsearch", getContext) {
  const emitFn =
    typeof stageApi?.emit === "function"
      ? stageApi.emit.bind(stageApi)
      : typeof stageApi?.eventBus?.emit === "function"
        ? stageApi.eventBus.emit.bind(stageApi.eventBus)
        : null;

  if (!emitFn) return null;

  // 简单限流：同一事件名 100ms 内只发一次
  const lastEmitTime = new Map();
  const MIN_INTERVAL_MS = 100;

  return (name, payload, { status = EventStatus.COMPLETED, throttle = true } = {}) => {
    if (throttle) {
      const now = Date.now();
      const last = lastEmitTime.get(name) || 0;
      if (now - last < MIN_INTERVAL_MS) return; // 限流
      lastEmitTime.set(name, now);
    }

    const ctx = typeof getContext === "function" ? getContext() : {};
    emitFn(name, {
      schemaVersion: EVENT_SCHEMA_VERSION,
      name,
      ts: new Date().toISOString(),
      actor,
      status,
      ...ctx,
      payload,
    });
  };
}

export function generateNodeId(runId, kind, { stage, iteration, trajectoryId } = {}) {
  const parts = [runId || "run", kind];
  if (stage) parts.push(stage);
  if (typeof iteration === "number") parts.push(`i${iteration}`);
  if (trajectoryId) parts.push(trajectoryId);
  return parts.join("_") + "_" + Date.now().toString(36);
}

export function checkCancelled(stageApi) {
  if (typeof stageApi?.checkCancelled === "function") stageApi.checkCancelled();
  if (stageApi?.signal?.aborted) {
    const reason = stageApi.signal.reason;
    throw new Error(typeof reason === "string" ? reason : "Run cancelled");
  }
}

function normalizeRoundHits(roundHits) {
  if (roundHits instanceof Map) return roundHits;

  const hits = new Map();

  if (Array.isArray(roundHits)) {
    for (const gid of roundHits.map((x) => toNonEmptyString(x)).filter(Boolean)) {
      hits.set(gid, (hits.get(gid) || 0) + 1);
    }
    return hits;
  }

  if (isPlainObject(roundHits)) {
    for (const [k, v] of Object.entries(roundHits)) {
      const gid = toNonEmptyString(k);
      if (!gid) continue;
      const n = safeInt(v);
      hits.set(gid, n !== null && n > 0 ? n : 0);
    }
    return hits;
  }

  return hits;
}

export function computeRoundHitsByGapId(roundHits, qualityThreshold = 0.5) {
  const allHits = new Map();
  const qualityHits = new Map();
  const threshold = typeof qualityThreshold === "number" && Number.isFinite(qualityThreshold) ? qualityThreshold : 0.5;

  const bump = (m, gid) => m.set(gid, (m.get(gid) || 0) + 1);

  for (const r of Array.isArray(roundHits) ? roundHits : []) {
    const score = typeof r?.score === "number" && Number.isFinite(r.score) ? r.score : 0;
    const matched = Array.isArray(r?.matchedGapIds) ? r.matchedGapIds.map((x) => toNonEmptyString(x)).filter(Boolean) : [];
    const gids = matched.length ? [...new Set(matched)] : [toNonEmptyString(r?.gapId)].filter(Boolean);
    if (!gids.length) continue;

    for (const gid of gids) {
      bump(allHits, gid);
      if (score >= threshold) bump(qualityHits, gid);
    }
  }

  return { allHits, qualityHits };
}

export function validateIteration(state, options = {}) {
  const runId = toNonEmptyString(state?.runId) || "run_unknown";
  const iteration = safeInt(state?.iteration) ?? 0;
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const retrieved = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
  const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];

  const opts = options && typeof options === "object" ? options : {};
  const roundHits = opts.roundHits;
  const allHitsRaw = roundHits && typeof roundHits === "object" && roundHits.allHits instanceof Map ? roundHits.allHits : roundHits;
  const qualityHitsRaw =
    opts.qualityHitsByGapId ?? (roundHits && typeof roundHits === "object" && roundHits.qualityHits instanceof Map ? roundHits.qualityHits : null);
  const bam = safeInt(opts.blockAfterMisses);
  const effectiveBlockAfterMisses = bam !== null && bam >= 1 ? bam : 2;
  const emitFn = typeof opts.emit === "function" ? opts.emit : null;

  const configuredMinEvidence = (() => {
    const cfg = isPlainObject(state?.userConfig?.gaps) ? state.userConfig.gaps : {};
    const n = safeInt(cfg.minEvidenceToFill);
    return n !== null && n >= 1 ? n : null;
  })();
  const effectiveMinEvidenceToFill = (() => {
    const n = safeInt(opts.minEvidenceToFill);
    if (n !== null && n >= 1) return n;
    return configuredMinEvidence ?? 2;
  })();

  const hitsByGapId = normalizeRoundHits(allHitsRaw);
  const qualityHitsByGapIdMap = normalizeRoundHits(qualityHitsRaw);

  const retrievedByChunkId = new Map();
  for (const r of retrieved) {
    const chunkId = toNonEmptyString(r?.chunkId);
    if (chunkId) retrievedByChunkId.set(chunkId, r);
  }

  // 计算每个 gap 的 evidence 数量
  const evidenceCountByGapId = new Map();
  for (const e of evidenceLedger) {
    const gapIds = Array.isArray(e?.gapIds) ? e.gapIds.map(String).filter(Boolean) : [];
    if (gapIds.length) {
      for (const gid of gapIds) {
        evidenceCountByGapId.set(gid, (evidenceCountByGapId.get(gid) || 0) + 1);
      }
      continue;
    }

    const chunkId = toNonEmptyString(e?.chunkId);
    const row = chunkId ? retrievedByChunkId.get(chunkId) : null;
    if (!row) continue;

    const matched = Array.isArray(row?.matchedGapIds) ? row.matchedGapIds.map(String).filter(Boolean) : [];
    if (matched.length) {
      for (const gid of matched) {
        evidenceCountByGapId.set(gid, (evidenceCountByGapId.get(gid) || 0) + 1);
      }
      continue;
    }

    const gid = toNonEmptyString(row?.gapId);
    if (gid) {
      evidenceCountByGapId.set(gid, (evidenceCountByGapId.get(gid) || 0) + 1);
    }
  }

  let filledCount = 0;
  let blockedCount = 0;
  let stillOpenCount = 0;
  const now = new Date().toISOString();
  const treeForDecisions = state?.planningTree;
  const canRecordDecision =
    typeof treeForDecisions?.getNodesForGap === "function" && typeof treeForDecisions?.recordDecision === "function";

  const recordGapTransitionDecision = (gapId, newStatus, { reason, outcome, metrics } = {}) => {
    if (!canRecordDecision) return;
    const nodes = treeForDecisions.getNodesForGap(gapId) || [];
    const nodeId = toNonEmptyString(nodes?.[0]?.nodeId);
    if (!nodeId) return;

    treeForDecisions.recordDecision(nodeId, {
      stage: "gaps",
      action: `transition to ${newStatus}`,
      reason: String(reason || "auto"),
      outcome,
      metrics: isPlainObject(metrics) ? { ...metrics } : {},
    });
  };

  for (const g of gaps) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid) continue;

    const oldStatus = toNonEmptyString(g?.status) || GapStatus.OPEN;
    if (oldStatus === GapStatus.FILLED || oldStatus === GapStatus.BLOCKED) continue;

    const evidenceCount = evidenceCountByGapId.get(gid) || 0;
    // 只有当 evidence 数量 >= minEvidenceToFill 时才标记为 filled
    if (evidenceCount >= effectiveMinEvidenceToFill) {
      const didTransition = transitionGap(g, GapStatus.FILLED, { runId, iteration, ts: now, evidenceCount }, emitFn);
      if (didTransition) {
        recordGapTransitionDecision(gid, GapStatus.FILLED, {
          reason: `evidence>=${effectiveMinEvidenceToFill}`,
          outcome: "success",
          metrics: { evidenceCount, missCount: safeInt(g?.missCount) ?? 0 },
        });
      }
      filledCount++;
      continue;
    }

    const roundQualityHits = qualityHitsByGapIdMap.get(gid) || 0;
    const roundAllHits = hitsByGapId.get(gid) || 0;
    if (roundQualityHits > 0) {
      g.missCount = 0;
      stillOpenCount++;
      continue;
    }
    if (roundAllHits > 0) {
      stillOpenCount++;
      continue;
    }

    const priorMisses = safeInt(g?.missCount) ?? 0;
    const misses = Math.max(0, priorMisses) + 1;
    g.missCount = misses;

    if (misses >= effectiveBlockAfterMisses) {
      const blockedReason = String(g.blockedReason || "no_retrieval_hits");
      const didTransition = transitionGap(g, GapStatus.BLOCKED, { runId, iteration, reason: blockedReason, ts: now }, emitFn);
      if (didTransition) {
        recordGapTransitionDecision(gid, GapStatus.BLOCKED, {
          reason: blockedReason,
          outcome: "fail",
          metrics: { evidenceCount, missCount: misses },
        });
      }
      blockedCount++;
    } else {
      stillOpenCount++;
    }
  }

  const todos = Array.isArray(state?.todos) ? state.todos : [];
  const todoByGapId = new Map();
  for (const t of todos) {
    const rgid = toNonEmptyString(t?.relatedGapId);
    if (!rgid) continue;
    todoByGapId.set(rgid, t);
  }

  const updateTodoStatus = (todo, nextStatus) => {
    if (!todo) return;
    const from = toNonEmptyString(todo?.status) || "open";
    const to = toNonEmptyString(nextStatus) || "open";
    if (from === to) return;
    todo.status = to;
    emitFn?.("deepsearch.todo.status.changed", {
      runId,
      todoId: toNonEmptyString(todo?.todoId) || "todo_unknown",
      relatedGapId: toNonEmptyString(todo?.relatedGapId),
      from,
      to,
      iteration,
    });
  };

  for (const g of gaps) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid) continue;
    const todo = todoByGapId.get(gid);
    if (!todo) continue;
    if (g.status === GapStatus.FILLED) updateTodoStatus(todo, "done");
    if (g.status === GapStatus.BLOCKED) updateTodoStatus(todo, "blocked");
  }

  const tree = state?.planningTree;
  if (typeof tree?.getNodesForGap === "function" && typeof tree?.updateStatus === "function") {
    for (const g of gaps) {
      const gid = toNonEmptyString(g?.gapId);
      if (!gid) continue;
      if (g.status !== GapStatus.FILLED && g.status !== GapStatus.BLOCKED) continue;
      const next = g.status === GapStatus.FILLED ? "completed" : "blocked";
      const nodes = tree.getNodesForGap(gid) || [];
      for (const n of Array.isArray(nodes) ? nodes : []) {
        const nodeId = toNonEmptyString(n?.nodeId) || toNonEmptyString(n?.planNodeId) || toNonEmptyString(n?.id);
        if (nodeId) tree.updateStatus(nodeId, next);
      }
    }
  }

  const openCount = gaps.filter((g) => (toNonEmptyString(g?.status) || GapStatus.OPEN) === GapStatus.OPEN).length;
  state?.addTimeline?.({
    name: "deepsearch.validate",
    status: "completed",
    payload: { filledCount, blockedCount, openCount },
  });

  return { filledCount, blockedCount, openCount, stillOpenCount };
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
    if (!this.planningTree) {
      this.planningTree = new PlanningTree({ rootGoal: this.taskGoal || "", runId: this.runId });
    }

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

    const max = Math.max(0, safeInt(this?.userConfig?.memory?.maxTimeline) ?? 1000);
    while (this.timeline.length > max) this.timeline.shift();
    return row;
  }

  saveWriteSnapshot({ timestamp } = {}) {
    const ts = toNonEmptyString(timestamp) || new Date().toISOString();
    const snapshot = {
      snapshotId: `wcp_${this.writeSnapshots.length + 1}`,
      iteration: this.iteration,
      timestamp: String(ts),
      slideIntents: Array.isArray(this?.L1?.slideIntents) ? cloneValue(this.L1.slideIntents) : [],
      report: isPlainObject(this?.L1?.report) ? cloneValue(this.L1.report) : null,
    };
    this.writeSnapshots.push(snapshot);
    return snapshot;
  }

  reopenGaps(gapIds, { reason, timestamp } = {}, emit = null) {
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

      const didTransition = transitionGap(g, GapStatus.OPEN, { runId: this.runId, iteration: this.iteration, reason: "backtrack", ts: now }, emit);
      if (!didTransition) {
        // Even when status is already OPEN, normalize fields without emitting.
        g.status = GapStatus.OPEN;
        g.missCount = 0;
        delete g.filledAt;
        delete g.filledIteration;
        delete g.evidenceCount;
        delete g.blockedAt;
        delete g.blockedReason;
      }
      g.reopenedAt = now;
      if (toNonEmptyString(reason)) g.reopenedReason = String(reason);

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
      if (!t) continue;
      const from = toNonEmptyString(t?.status) || "open";
      if (from === "open") continue;
      t.status = "open";
      emit?.("deepsearch.todo.status.changed", {
        runId: this.runId,
        todoId: toNonEmptyString(t?.todoId) || "todo_unknown",
        relatedGapId: toNonEmptyString(t?.relatedGapId),
        from,
        to: "open",
        iteration: this.iteration,
      });
    }

    const tree = this?.planningTree;
    if (tree && typeof tree.getNodesForGap === "function" && typeof tree.updateStatus === "function") {
      for (const gid of reopened) {
        for (const n of tree.getNodesForGap(gid)) tree.updateStatus(n.nodeId, "pending");
      }
    }

    return { reopened, missing: Array.from(missing) };
  }

  addNewGaps(newGaps, { timestamp } = {}, emit = null) {
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

      emit?.("deepsearch.gap.upserted", {
        runId: this.runId,
        gapId,
        status: "open",
        type: row.type,
        priority: row.priority,
        question: row.question,
        missCount: 0,
        iteration: this.iteration,
        trajectoryId: this.trajectoryId,
      });

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
        ? DeepSearchState.fromJSON(this.toJSON({ includeCheckpoints: false }))
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
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
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

    const max = Math.max(0, safeInt(this?.userConfig?.memory?.maxCheckpoints) ?? 30);
    while (this.checkpoints.length > max) this.checkpoints.shift();
    return checkpoint;
  }

  restoreCheckpoint(checkpointId) {
    const id = toNonEmptyString(checkpointId);
    if (!id) throw new TypeError("DeepSearchState.restoreCheckpoint(checkpointId): checkpointId is required");

    const idx = this.checkpoints.findIndex((c) => toNonEmptyString(c?.checkpointId) === id);
    const existing = idx >= 0 ? this.checkpoints[idx] : null;
    const cp = existing ? loadCheckpoint(existing) : null;
    if (existing && cp !== existing) this.checkpoints[idx] = cp;
    if (!cp) throw new Error(`Checkpoint not found: ${String(id)}`);
    if (!("stateSnapshot" in cp)) throw new Error(`Invalid checkpoint: missing stateSnapshot (${String(id)})`);

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
    const preservedL1 = this.L1;
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
    this.L1 = checkpointStrategy === "lite" ? preservedL1 : restored.L1;
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
    return cloneValue({
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
    });
  }

  serialize({ pretty = false } = {}) {
    return JSON.stringify(this.toJSON(), null, pretty ? 2 : 0);
  }

  clone({ includeCheckpoints = true } = {}) {
    const snapshotObj = this.toJSON({ includeCheckpoints });
    return DeepSearchState.fromJSON(snapshotObj);
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
