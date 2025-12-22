import { PlanningTree } from "./planning-tree.js";
import { isPlainObject, safeInt, safeNumber, toNonEmptyString } from "../../shared/value-utils.js";
import { EVENT_SCHEMA_VERSION, EventStatus, ensureTokenUsage, extractJsonCandidate, normalizeBudgetConfig, normalizeTokenUsage, stripThinkingTags } from "./state-utils.js";
import { computeRoundHitsByGapId, GapStatus, normalizeRoundHits, transitionGap } from "./gap-utils.js";
import { CheckpointMode } from "./constants.js";
import { DecisionOutcome, DecisionStage, TodoStatus } from "./states.js";
import {
  buildLiteSnapshot,
  buildMinimalSnapshot,
  CHECKPOINT_SCHEMA_VERSION,
  cloneValue,
  getCheckpointStrategyFromState,
  loadCheckpoint,
  normalizeCheckpointStrategy,
} from "./checkpoint.js";

export { EVENT_SCHEMA_VERSION, EventStatus, extractJsonCandidate, normalizeBudgetConfig, stripThinkingTags };
export { computeRoundHitsByGapId, GapStatus, transitionGap };
export { loadCheckpoint };

const STATE_SCHEMA_VERSION = "0.1";
const DEFAULT_MAX_ITERATIONS = 5;

function isWeakCollection(value) {
  return value instanceof WeakMap || value instanceof WeakSet;
}

function sanitizeForJson(value, seen = new WeakSet()) {
  if (value === null) return null;

  const type = typeof value;
  if (type === "string" || type === "boolean") return value;
  if (type === "number") return Number.isFinite(value) ? value : null;
  if (type === "bigint") return value.toString();
  if (type === "undefined" || type === "function" || type === "symbol") return undefined;

  if (type !== "object") return value;
  if (isWeakCollection(value)) return undefined;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.toString();

  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = sanitizeForJson(item, seen);
      return next === undefined ? null : next;
    });
  }

  if (value instanceof Set) {
    return Array.from(value.values()).map((item) => {
      const next = sanitizeForJson(item, seen);
      return next === undefined ? null : next;
    });
  }

  if (value instanceof Map) {
    let allStringKeys = true;
    for (const key of value.keys()) {
      if (typeof key !== "string") {
        allStringKeys = false;
        break;
      }
    }

    if (allStringKeys) {
      const out = {};
      for (const [k, v] of value.entries()) {
        const next = sanitizeForJson(v, seen);
        if (next !== undefined) out[k] = next;
      }
      return out;
    }

    return Array.from(value.entries()).map(([k, v]) => {
      const nextKey = sanitizeForJson(k, seen);
      const nextVal = sanitizeForJson(v, seen);
      return [nextKey === undefined ? null : nextKey, nextVal === undefined ? null : nextVal];
    });
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const next = sanitizeForJson(v, seen);
    if (next === undefined) continue;
    out[k] = next;
  }
  return out;
}

function buildCheckpointReferences(checkpoints) {
  const rows = Array.isArray(checkpoints) ? checkpoints : [];
  return rows.map((checkpoint) => {
    const raw = checkpoint && typeof checkpoint === "object" ? checkpoint : {};
    const { schemaVersion, checkpointId, iteration, timestamp, strategy, metrics } = raw;
    return { schemaVersion, checkpointId, iteration, timestamp, strategy, metrics };
  });
}

function buildStateSnapshot(state, { includeCheckpoints = true, includeCheckpointSnapshots = true } = {}) {
  const snapshot = {
    schemaVersion: state.schemaVersion,
    runId: state.runId,
    createdAt: state.createdAt,
    taskGoal: state.taskGoal,
    userConfig: state.userConfig,
    planningTree: state.planningTree?.serialize ? state.planningTree.serialize() : null,
    ...(toNonEmptyString(state.trajectoryId) ? { trajectoryId: state.trajectoryId } : {}),
    ...(isPlainObject(state.trajectoryConfig) ? { trajectoryConfig: state.trajectoryConfig } : {}),
    iteration: state.iteration,
    maxIterations: state.maxIterations,
    ...(includeCheckpoints
      ? { checkpoints: includeCheckpointSnapshots ? state.checkpoints : buildCheckpointReferences(state.checkpoints) }
      : {}),
    writeBacktrackCount: state.writeBacktrackCount,
    writeSnapshots: state.writeSnapshots,
    L0: state.L0,
    L1: state.L1,
    L2: state.L2,
    todos: state.todos,
    timeline: state.timeline,
  };

  return snapshot;
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
      const last = lastEmitTime.get(name);
      if (typeof last === "number" && now - last < MIN_INTERVAL_MS) return; // 限流
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
      stage: DecisionStage.GAPS,
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
          outcome: DecisionOutcome.SUCCESS,
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
          outcome: DecisionOutcome.FAIL,
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
    const from = toNonEmptyString(todo?.status) || TodoStatus.OPEN;
    const to = toNonEmptyString(nextStatus) || TodoStatus.OPEN;
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
    if (g.status === GapStatus.FILLED) updateTodoStatus(todo, TodoStatus.COMPLETED);
    if (g.status === GapStatus.BLOCKED) updateTodoStatus(todo, TodoStatus.CANCELLED);
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

  addTodo({ todoId, text, status = TodoStatus.OPEN, relatedGapId } = {}) {
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

      this.addTodo({ text: `Fill gap: ${row.type} — ${row.question}`, relatedGapId: gapId, status: TodoStatus.OPEN });
      this?.planningTree?.expandFromGap?.(row);
    }
    return added;
  }

  saveCheckpoint({ checkpointId, timestamp, metrics, strategy } = {}) {
    const id = toNonEmptyString(checkpointId) || `cp_${this.checkpoints.length + 1}`;
    const ts = toNonEmptyString(timestamp) || new Date().toISOString();

    const checkpointStrategy = getCheckpointStrategyFromState(this, strategy);
    const snapshot =
      checkpointStrategy === CheckpointMode.FULL
        ? DeepSearchState.fromJSON(cloneValue(buildStateSnapshot(this, { includeCheckpoints: false })))
        : checkpointStrategy === CheckpointMode.MINIMAL
          ? buildMinimalSnapshot(this)
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
    const snapshotStrategy = toNonEmptyString(cp?.stateSnapshot?.snapshotStrategy);
    const checkpointStrategy = explicitStrategy
      ? normalizeCheckpointStrategy(explicitStrategy)
      : cp?.stateSnapshot instanceof DeepSearchState
        ? CheckpointMode.FULL
        : snapshotStrategy === CheckpointMode.MINIMAL
          ? CheckpointMode.MINIMAL
          : snapshotStrategy === CheckpointMode.LITE
            ? CheckpointMode.LITE
            : isPlainObject(cp?.stateSnapshot?.L2) && Array.isArray(cp.stateSnapshot.L2.retrievedChunkIds) && !Array.isArray(cp.stateSnapshot.L2.retrievedChunks)
              ? CheckpointMode.LITE
              : CheckpointMode.FULL;
    const preservedL0 = this.L0;
    const preservedL1 = this.L1;
    const preservedL2 = this.L2;
    const snapshot = cp.stateSnapshot instanceof DeepSearchState ? cp.stateSnapshot : DeepSearchState.fromJSON(cp.stateSnapshot);
    const preservedCheckpoints = this.checkpoints;

    const restored =
      checkpointStrategy === CheckpointMode.FULL && typeof snapshot?.toSnapshot === "function"
        ? snapshot.toSnapshot({ includeCheckpoints: false })
        : snapshot.toJSON({ includeCheckpoints: false });
    this.schemaVersion = restored.schemaVersion;
    this.runId = restored.runId;
    this.createdAt = restored.createdAt;
    this.taskGoal = restored.taskGoal;
    this.userConfig = restored.userConfig;
    this.iteration = safeInt(restored.iteration) ?? 0;
    this.maxIterations = safeInt(restored.maxIterations) ?? DEFAULT_MAX_ITERATIONS;
    const preserveCore = checkpointStrategy === CheckpointMode.LITE || checkpointStrategy === CheckpointMode.MINIMAL;
    this.L0 = preserveCore ? preservedL0 : restored.L0;
    this.L1 = preserveCore ? preservedL1 : restored.L1;
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

    if (checkpointStrategy === CheckpointMode.LITE) {
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
    if (checkpointStrategy === CheckpointMode.MINIMAL) {
      const tokenUsage = ensureTokenUsage(restored?.L2?.tokenUsage);
      this.L2 = {
        ...preservedL2,
        retrievedChunkIds: [],
        retrievedChunks: [],
        scratchpad: {},
        logs: [],
        tokenUsage,
        incomplete: true,
        restoredFromMinimalCheckpoint: true,
      };
    }

    this.addTimeline({ name: "deepsearch.checkpoint.restored", status: "info", payload: { checkpointId: id, iteration: this.iteration } });
    return cp;
  }

  toJSON({ includeCheckpoints = true } = {}) {
    return sanitizeForJson(buildStateSnapshot(this, { includeCheckpoints, includeCheckpointSnapshots: false }));
  }

  toSnapshot({ includeCheckpoints = true } = {}) {
    return cloneValue(buildStateSnapshot(this, { includeCheckpoints, includeCheckpointSnapshots: true }));
  }

  serialize({ pretty = false } = {}) {
    return JSON.stringify(this.toJSON(), null, pretty ? 2 : 0);
  }

  clone({ includeCheckpoints = true } = {}) {
    const snapshotObj = this.toSnapshot({ includeCheckpoints });
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
