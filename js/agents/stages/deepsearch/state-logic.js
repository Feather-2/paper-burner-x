import { isPlainObject, safeInt, toNonEmptyString } from "../../shared/index.js";
import { Deque } from "../../shared/index.js";
import { DecisionOutcome, DecisionStage, GapStatus, TodoStatus } from "./states.js";
import { createTodo, transitionTodoStatus } from "./utils/todo-utils.js";
import { cloneValue } from "./internal/checkpoint.js";

/**
 * @typedef {object} SyncTodoOptions
 * @property {string=} runId
 * @property {number=} iteration
 * @property {(eventName:string, payload:any)=>void=} emitFn
 * @property {(todoId:string, updates:any, meta:any)=>any=} updateTodo
 *
 * @typedef {object} ValidateIterationOptions
 * @property {any=} roundHits
 * @property {any=} qualityHitsByGapId
 * @property {number=} blockAfterMisses
 * @property {(eventName:string, payload:any)=>void=} emit
 * @property {number=} minEvidenceToFill
 *
 * @typedef {object} GapDecisionMeta
 * @property {string=} reason
 * @property {string=} outcome
 * @property {any=} metrics
 *
 * @typedef {object} AddTimelineArgs
 * @property {string=} name
 * @property {string=} status
 * @property {any=} payload
 *
 * @typedef {object} TimestampArgs
 * @property {string=} timestamp
 *
 * @typedef {object} ReopenGapsOptions
 * @property {string=} reason
 * @property {string=} timestamp
 *
 * @typedef {object} AddNewGapsOptions
 * @property {string=} timestamp
 */

// ─────────────────────────────────────────────────────────────────────────────
// Gap / Todo business rules (decoupled from DeepSearchState data model)
// ─────────────────────────────────────────────────────────────────────────────

export function transitionGap(gap, newStatus, meta, emitFn) {
  if (!gap) return false;
  const oldStatus = gap.status || GapStatus.OPEN;
  if (oldStatus === newStatus) return false;
  gap.status = newStatus;
  gap.updatedAt = meta?.ts || Date.now();
  if (emitFn) {
    emitFn("deepsearch.gap.transitioned", { gapId: gap.gapId, from: oldStatus, to: newStatus });
  }
  return true;
}

export function computeRoundHitsByGapId(gaps) {
  const result = new Map();
  for (const g of gaps || []) {
    if (g?.gapId) result.set(g.gapId, g.hitCount || 0);
  }
  return result;
}

function normalizeRoundHits(hits) {
  if (hits instanceof Map) return hits;
  if (typeof hits === "object" && hits !== null) return new Map(Object.entries(hits));
  return new Map();
}

function resolveMinEvidenceToFill(state, opts) {
  const configuredMinEvidence = (() => {
    const cfg = isPlainObject(state?.userConfig?.gaps) ? state.userConfig.gaps : {};
    const n = safeInt(cfg.minEvidenceToFill);
    return n !== null && n >= 1 ? n : null;
  })();

  const fromOpts = safeInt(opts?.minEvidenceToFill);
  if (fromOpts !== null && fromOpts >= 1) return fromOpts;

  return configuredMinEvidence ?? 2;
}

function buildRetrievedByChunkId(retrieved) {
  const map = new Map();
  for (const r of Array.isArray(retrieved) ? retrieved : []) {
    const chunkId = toNonEmptyString(r?.chunkId);
    if (chunkId) map.set(chunkId, r);
  }
  return map;
}

function countEvidenceByGapId(evidenceLedger, { retrievedByChunkId }) {
  const evidenceCountByGapId = new Map();

  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
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

  return evidenceCountByGapId;
}

/**
 * @param {any[]} gaps
 * @param {any[]} todos
 * @param {SyncTodoOptions=} options
 * @returns {void}
 */
function syncTodoStatusesFromGaps(gaps, todos, { runId, iteration, emitFn, updateTodo } = {}) {
  const todoByGapId = new Map();
  for (const t of Array.isArray(todos) ? todos : []) {
    const rgid = toNonEmptyString(t?.relatedGapId);
    if (!rgid) continue;
    todoByGapId.set(rgid, t);
  }

  const updateTodoStatus = (todo, nextStatus) => {
    if (!todo) return;
    const from = (toNonEmptyString(todo?.status) || TodoStatus.OPEN).toLowerCase();
    const to = (toNonEmptyString(nextStatus) || TodoStatus.OPEN).toLowerCase();
    if (from === to) return;
    if (typeof updateTodo === "function") {
      const updated = updateTodo(toNonEmptyString(todo?.todoId) || toNonEmptyString(todo?.id), { status: to }, null);
      const didTransition = Boolean(updated && String(updated?.status || "").toLowerCase() === to);
      if (!didTransition) return;
    } else {
      const didTransition = transitionTodoStatus(todo, to);
      if (!didTransition) return;
    }
    emitFn?.("deepsearch.todo.status.changed", {
      runId,
      todoId: toNonEmptyString(todo?.todoId) || "todo_unknown",
      relatedGapId: toNonEmptyString(todo?.relatedGapId),
      from,
      to,
      iteration,
    });
  };

  for (const g of Array.isArray(gaps) ? gaps : []) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid) continue;
    const todo = todoByGapId.get(gid);
    if (!todo) continue;
    if (g.status === GapStatus.FILLED) updateTodoStatus(todo, TodoStatus.COMPLETED);
    if (g.status === GapStatus.BLOCKED) updateTodoStatus(todo, TodoStatus.CANCELLED);
  }
}

/**
 * @param {any[]} gaps
 * @param {any} planningTree
 * @returns {void}
 */
function syncPlanningTreeStatusFromGaps(gaps, planningTree) {
  const tree = planningTree;
  if (typeof tree?.getNodesForGap !== "function" || typeof tree?.updateStatus !== "function") return;

  for (const g of Array.isArray(gaps) ? gaps : []) {
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

/**
 * @param {any} state
 * @param {ValidateIterationOptions=} options
 * @returns {{ filledCount:number, blockedCount:number, openCount:number, stillOpenCount:number }}
 */
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
  const effectiveMinEvidenceToFill = resolveMinEvidenceToFill(state, opts);

  const hitsByGapId = normalizeRoundHits(allHitsRaw);
  const qualityHitsByGapIdMap = normalizeRoundHits(qualityHitsRaw);
  const retrievedByChunkId = buildRetrievedByChunkId(retrieved);
  const evidenceCountByGapId = countEvidenceByGapId(evidenceLedger, { retrievedByChunkId });

  let filledCount = 0;
  let blockedCount = 0;
  let stillOpenCount = 0;
  const now = new Date().toISOString();
  const treeForDecisions = state?.planningTree;
  const canRecordDecision =
    typeof treeForDecisions?.getNodesForGap === "function" && typeof treeForDecisions?.recordDecision === "function";

  /**
   * @param {string} gapId
   * @param {string} newStatus
   * @param {GapDecisionMeta=} meta
   * @returns {void}
   */
  const recordGapTransitionDecision = (gapId, newStatus, meta = {}) => {
    if (!canRecordDecision) return;
    const metaObj = isPlainObject(meta) ? meta : {};
    const reason = metaObj.reason;
    const outcome = metaObj.outcome;
    const metrics = metaObj.metrics;
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
    const evidenceCount = evidenceCountByGapId.get(gid) || 0;
    // 只有当 evidence 数量 >= minEvidenceToFill 时才标记为 filled
    // [增强]: 即使以前是 BLOCKED，如果现在有足够证据，也应允许解封并转为 FILLED
    if (evidenceCount >= effectiveMinEvidenceToFill) {
      const didTransition = transitionGap(g, GapStatus.FILLED, { runId, iteration, ts: now, evidenceCount }, emitFn);
      if (didTransition) {
        recordGapTransitionDecision(gid, GapStatus.FILLED, {
          reason: `unblocked_by_evidence_count:${evidenceCount}`,
          outcome: DecisionOutcome.SUCCESS,
          metrics: { evidenceCount, missCount: safeInt(g?.missCount) ?? 0 },
        });
      }
      filledCount++;
      continue;
    }

    // 如果已经完成或阻塞，且证据不足以解封，则跳过
    if (oldStatus === GapStatus.FILLED || oldStatus === GapStatus.BLOCKED) continue;

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

  const updateTodo = typeof state?.updateTodo === "function" ? state.updateTodo.bind(state) : null;
  syncTodoStatusesFromGaps(gaps, Array.isArray(state?.todos) ? state.todos : [], { runId, iteration, emitFn, updateTodo });
  syncPlanningTreeStatusFromGaps(gaps, state?.planningTree);

  const openCount = gaps.filter((g) => (toNonEmptyString(g?.status) || GapStatus.OPEN) === GapStatus.OPEN).length;
  state?.addTimeline?.({
    name: "deepsearch.validate",
    status: "completed",
    payload: { filledCount, blockedCount, openCount },
  });

  return { filledCount, blockedCount, openCount, stillOpenCount };
}

/**
 * @param {any} state
 * @param {any} params
 * @returns {any}
 */
export function addTodo(state, params = {}) {
  const raw = isPlainObject(params) ? params : {};
  if (!Array.isArray(state?.todos)) state.todos = [];
  const id = toNonEmptyString(raw.todoId) || `todo_${state.todos.length + 1}`;
  const row = createTodo({ ...raw, todoId: id });
  state.todos.push(row);
  if (typeof state?._syncToShared === "function") {
    state._syncToShared("todo", row.todoId, {
      status: row.status || "pending",
      keywords: [row.text?.slice(0, 50)].filter(Boolean),
    });
  }
  return row;
}

/**
 * @param {any} state
 * @param {any} value
 * @param {any} reason
 * @returns {boolean}
 */
export function setAwaitUserFeedback(state, value, reason) {
  if (state?._memoryStore) {
    state._memoryStore.awaitUserFeedback = Boolean(value);
  }
  if (!isPlainObject(state?.L2)) state.L2 = {};
  state.L2.awaitUserFeedback = Boolean(value);
  if (toNonEmptyString(reason)) state.L2.reason = String(reason);
  if (!state.L2.awaitUserFeedback && !state.L2.taskImpossible && !toNonEmptyString(reason)) {
    state.L2.reason = "";
  }
  return state.L2.awaitUserFeedback;
}

/**
 * @param {any} state
 * @param {any} reason
 * @returns {false}
 */
export function setTaskImpossible(state, reason) {
  // Deprecated semantics:
  // Don't let the system declare a task "impossible" (too subjective).
  // Treat this as "blocked, requires user guidance" instead.
  if (state?._memoryStore) {
    state._memoryStore.taskImpossible = false;
  }
  if (!isPlainObject(state?.L2)) state.L2 = {};
  state.L2.taskImpossible = false;
  setAwaitUserFeedback(state, true, reason);
  return false;
}

/**
 * @param {any} state
 * @param {AddTimelineArgs=} entry
 * @returns {any}
 */
export function addTimeline(state, { name, status = "info", payload } = {}) {
  const n = toNonEmptyString(name) || "deepsearch.event";
  const st = toNonEmptyString(status) || "info";
  const row = { ts: new Date().toISOString(), name: n, status: st, ...(payload !== undefined ? { payload } : {}) };

  if (!state) return row;
  if (!state.timeline || typeof state.timeline.push !== "function") state.timeline = [];
  state.timeline.push(row);

  const max = Math.max(0, safeInt(state?.userConfig?.memory?.maxTimeline) ?? 1000);
  if (state.timeline instanceof Deque) {
    while (state.timeline.size > max) state.timeline.shift();
  } else if (Array.isArray(state.timeline)) {
    while (state.timeline.length > max) state.timeline.shift();
  }

  return row;
}

/**
 * @param {any} state
 * @param {TimestampArgs=} options
 * @returns {any}
 */
export function saveWriteSnapshot(state, { timestamp } = {}) {
  const ts = toNonEmptyString(timestamp) || new Date().toISOString();
  if (!Array.isArray(state?.writeSnapshots)) state.writeSnapshots = [];
  const snapshot = {
    snapshotId: `wcp_${state.writeSnapshots.length + 1}`,
    iteration: safeInt(state?.iteration) ?? 0,
    timestamp: String(ts),
    slideIntents: Array.isArray(state?.L1?.slideIntents) ? cloneValue(state.L1.slideIntents) : [],
    report: isPlainObject(state?.L1?.report) ? cloneValue(state.L1.report) : null,
  };
  state.writeSnapshots.push(snapshot);
  return snapshot;
}

/**
 * @param {any} state
 * @param {string[]|string} gapIds
 * @param {ReopenGapsOptions=} options
 * @param {(eventName:string, payload:any)=>void|null} [emit]
 * @returns {{ reopened: string[], missing: string[] }}
 */
export function reopenGaps(state, gapIds, { reason, timestamp } = {}, emit = null) {
  const ids = Array.from(new Set((Array.isArray(gapIds) ? gapIds : gapIds ? [gapIds] : []).map((x) => String(x || "").trim()).filter(Boolean)));
  if (!ids.length) return { reopened: [], missing: [] };

  if (!isPlainObject(state?.L1)) state.L1 = {};
  if (!Array.isArray(state.L1.gaps)) state.L1.gaps = [];
  const gaps = state.L1.gaps;

  const now = toNonEmptyString(timestamp) || new Date().toISOString();
  const reopened = [];
  const missing = new Set(ids);

  for (const g of gaps) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid) continue;
    if (!missing.has(gid)) continue;
    missing.delete(gid);

    const didTransition = transitionGap(g, GapStatus.OPEN, { runId: state.runId, iteration: state.iteration, reason: "backtrack", ts: now }, emit);
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
    if (typeof state?._syncToShared === "function") state._syncToShared("gap", gid, { status: "open" });
  }

  const tree = state?.planningTree;
  if (tree && typeof tree.getNodesForGap === "function" && typeof tree.updateStatus === "function") {
    for (const gid of reopened) {
      const nodes = tree.getNodesForGap(gid) || [];
      for (const n of Array.isArray(nodes) ? nodes : []) {
        const nodeId = toNonEmptyString(n?.nodeId) || toNonEmptyString(n?.planNodeId) || toNonEmptyString(n?.id);
        if (nodeId) tree.updateStatus(nodeId, "pending");
      }
    }
  }

  return { reopened, missing: Array.from(missing) };
}

/**
 * @param {any} state
 * @param {any[]} newGaps
 * @param {AddNewGapsOptions=} options
 * @param {(eventName:string, payload:any)=>void|null} [emit]
 * @returns {any[]}
 */
export function addNewGaps(state, newGaps, { timestamp } = {}, emit = null) {
  const rows = Array.isArray(newGaps) ? newGaps : [];
  if (!rows.length) return [];

  if (!isPlainObject(state?.L1)) state.L1 = {};
  if (!Array.isArray(state.L1.gaps)) state.L1.gaps = [];
  const gaps = state.L1.gaps;

  const existingId = new Set(gaps.map((g) => toNonEmptyString(g?.gapId)).filter(Boolean));
  let max = 0;
  for (const gid of existingId) {
    const m = String(gid).match(/^gap_(\d+)$/);
    if (!m) continue;
    const n = safeInt(Number(m[1]));
    if (n !== null && n > max) max = n;
  }

  const now = toNonEmptyString(timestamp) || new Date().toISOString();
  const maxGapDepth = (() => {
    const cfg = isPlainObject(state?.userConfig?.gaps) ? state.userConfig.gaps : {};
    const raw = safeInt(cfg.maxGapDepth ?? cfg.maxDepth);
    if (raw !== null) {
      if (raw <= 0) return null; // <=0 disables depth cap
      return raw;
    }
    return 3;
  })();
  const added = [];
  for (const g of rows) {
    const question = toNonEmptyString(g?.question);
    if (!question) continue;
    const priority = toNonEmptyString(g?.priority) || "medium";

    const parentGapId = toNonEmptyString(g?.parentGapId) || toNonEmptyString(g?.parentId) || toNonEmptyString(g?.parent);
    const parent = parentGapId ? gaps.find((x) => toNonEmptyString(x?.gapId) === parentGapId) : null;
    const parentDepth = parent ? (safeInt(parent?.depth) ?? 0) : null;
    const explicitDepth = safeInt(g?.depth);
    const depth = parentGapId ? (parentDepth ?? 0) + 1 : explicitDepth !== null ? Math.max(0, explicitDepth) : 0;
    if (maxGapDepth !== null && depth > maxGapDepth) {
      emit?.("deepsearch.gap.skipped", {
        runId: state.runId,
        status: "skipped",
        type: "max_depth",
        depth,
        maxGapDepth,
        ...(parentGapId ? { parentGapId } : {}),
        question: String(question).slice(0, 200),
        iteration: safeInt(state?.iteration) ?? 0,
        trajectoryId: state.trajectoryId,
      });
      continue;
    }

    let gapId = `gap_${(max += 1)}`;
    while (existingId.has(gapId)) gapId = `gap_${(max += 1)}`;
    existingId.add(gapId);

    const row = {
      gapId,
      type: "write_backtrack",
      question: String(question),
      priority: String(priority),
      depth,
      ...(parentGapId ? { parentGapId } : {}),
      status: "open",
      queryHints: [],
      createdAt: now,
    };
    gaps.push(row);
    if (typeof state?._syncToShared === "function") {
      state._syncToShared("gap", gapId, {
        status: "open",
        keywords: [row.question?.slice(0, 50)].filter(Boolean),
      });
    }
    added.push(row);

    emit?.("deepsearch.gap.upserted", {
      runId: state.runId,
      gapId,
      status: "open",
      type: row.type,
      priority: row.priority,
      question: row.question,
      missCount: 0,
      iteration: safeInt(state?.iteration) ?? 0,
      trajectoryId: state.trajectoryId,
    });

    addTodo(state, { text: `Fill gap: ${row.type} — ${row.question}`, relatedGapId: gapId, status: TodoStatus.OPEN });
    state?.planningTree?.expandFromGap?.(row);
  }
  return added;
}
