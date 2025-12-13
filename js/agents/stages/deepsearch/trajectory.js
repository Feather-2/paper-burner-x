import { checkCancelled } from "./state.js";
import { dedupeClaims } from "../../deepsearch/understanding/dedupe.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function clampInt(n, { min = 1, max = 8 } = {}) {
  const v = safeInt(n);
  if (v === null) return null;
  return Math.min(max, Math.max(min, v));
}

function toTrajectoryConfig(raw) {
  const cfg = isPlainObject(raw) ? raw : {};
  const n = clampInt(cfg.n, { min: 1, max: 8 }) ?? 1;
  const mergeStrategy = ["best", "union", "vote"].includes(String(cfg.mergeStrategy)) ? String(cfg.mergeStrategy) : "best";
  const qualityMetrics = Array.isArray(cfg.qualityMetrics) ? cfg.qualityMetrics : [];
  const divergeAt = typeof cfg.divergeAt === "string" ? cfg.divergeAt : "gap";
  return { n, mergeStrategy, qualityMetrics, divergeAt };
}

function signatureForRetrievedChunk(r) {
  const gapId = String(r?.gapId || "");
  const sourceId = String(r?.sourceId || "");
  const charStart = safeInt(r?.locator?.charStart) ?? -1;
  const charEnd = safeInt(r?.locator?.charEnd) ?? -1;
  return `${gapId}::${sourceId}::${charStart}-${charEnd}`;
}

function isOpenGap(g) {
  return String(g?.status || "open") === "open";
}

function openGaps(state) {
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  return gaps.filter(isOpenGap);
}

function getGapBlockAfterMisses(state) {
  const cfg = isPlainObject(state?.userConfig?.gaps) ? state.userConfig.gaps : {};
  const n = safeInt(cfg.blockAfterMisses);
  return n !== null && n >= 1 ? n : 2;
}

function validateIteration(state, { blockAfterMisses = 2 } = {}) {
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const retrieved = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
  const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];

  const retrievedByChunkId = new Map();
  const hitCountByGapId = new Map();
  for (const r of retrieved) {
    const chunkId = String(r?.chunkId || "");
    if (chunkId) retrievedByChunkId.set(chunkId, r);
    const gid = String(r?.gapId || "");
    if (!gid) continue;
    hitCountByGapId.set(gid, (hitCountByGapId.get(gid) || 0) + 1);
  }

  const filledGapIds = new Set();
  for (const e of evidenceLedger) {
    const chunkId = String(e?.chunkId || "");
    const r = retrievedByChunkId.get(chunkId);
    if (!r) continue;
    const gid = String(r?.gapId || "");
    if (gid) filledGapIds.add(gid);
  }

  let filledCount = 0;
  let blockedCount = 0;
  let stillOpenCount = 0;
  const now = new Date().toISOString();

  for (const g of gaps) {
    const gid = String(g?.gapId || "");
    if (!gid) continue;
    const status = String(g?.status || "open");
    if (status === "filled" || status === "blocked") continue;

    if (filledGapIds.has(gid)) {
      g.status = "filled";
      g.filledAt = now;
      g.filledIteration = state.iteration;
      filledCount++;
      continue;
    }

    const hits = hitCountByGapId.get(gid) || 0;
    if (hits > 0) {
      g.missCount = 0;
      stillOpenCount++;
      continue;
    }

    const priorMisses = safeInt(g?.missCount) ?? 0;
    const misses = Math.max(0, priorMisses) + 1;
    g.missCount = misses;

    if (misses >= blockAfterMisses) {
      g.status = "blocked";
      g.blockedAt = now;
      g.blockedReason = String(g.blockedReason || "no_retrieval_hits");
      blockedCount++;
    } else {
      stillOpenCount++;
    }
  }

  const todos = Array.isArray(state?.todos) ? state.todos : [];
  const todoByGapId = new Map();
  for (const t of todos) {
    const rgid = String(t?.relatedGapId || "");
    if (!rgid) continue;
    todoByGapId.set(rgid, t);
  }
  for (const g of gaps) {
    const gid = String(g?.gapId || "");
    if (!gid) continue;
    const t = todoByGapId.get(gid);
    if (!t) continue;
    if (g.status === "filled") t.status = "done";
    if (g.status === "blocked") t.status = "blocked";
  }

  const tree = state?.planningTree;
  if (typeof tree?.getNodesForGap === "function" && typeof tree?.updateStatus === "function") {
    for (const g of gaps) {
      const gid = String(g?.gapId || "");
      if (!gid) continue;
      if (g.status !== "filled" && g.status !== "blocked") continue;
      const next = g.status === "filled" ? "completed" : "blocked";
      for (const node of tree.getNodesForGap(gid) || []) {
        const nodeId = String(node?.nodeId || node?.planNodeId || "");
        if (nodeId) tree.updateStatus(nodeId, next);
      }
    }
  }

  state.addTimeline?.({
    name: "deepsearch.iteration.validated",
    status: "completed",
    payload: { filledCount, blockedCount, openCount: openGaps(state).length },
  });

  return { filledCount, blockedCount, openCount: openGaps(state).length };
}

function normalizeForKey(s) {
  const t = String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return t.replaceAll(/[^\p{L}\p{N}%]+/gu, " ").trim();
}

function statusRank(status) {
  const s = String(status || "open");
  if (s === "filled") return 2;
  if (s === "open") return 1;
  if (s === "blocked") return 0;
  return 1;
}

function gapKey(g) {
  return `${String(g?.type || "unknown")}::${String(g?.question || "")}`;
}

function evidenceKey(e) {
  const sourceId = String(e?.sourceId || "");
  const charStart = safeInt(e?.locator?.charStart);
  const charEnd = safeInt(e?.locator?.charEnd);
  if (charStart === null || charEnd === null) return `${sourceId}::${String(e?.quote || "")}`;
  return `${sourceId}::${charStart}-${charEnd}`;
}

function mergeGaps(trajectories) {
  const byKey = new Map();
  for (const t of trajectories) {
    for (const g of Array.isArray(t?.L1?.gaps) ? t.L1.gaps : []) {
      const key = gapKey(g);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { ...g });
        continue;
      }
      const rA = statusRank(existing?.status);
      const rB = statusRank(g?.status);
      if (rB > rA) {
        byKey.set(key, { ...existing, ...g });
        continue;
      }
      if (rB === rA) {
        const aMiss = safeInt(existing?.missCount) ?? 0;
        const bMiss = safeInt(g?.missCount) ?? 0;
        if (bMiss < aMiss) byKey.set(key, { ...existing, ...g });
      }
    }
  }

  const gaps = [...byKey.values()];
  return gaps.map((g, i) => ({ ...g, gapId: String(g?.gapId || `gap_${i + 1}`) }));
}

function mergeRetrievedChunks(trajectories) {
  const bySig = new Map();
  for (const t of trajectories) {
    for (const r of Array.isArray(t?.L2?.retrievedChunks) ? t.L2.retrievedChunks : []) {
      const sig = signatureForRetrievedChunk(r);
      if (bySig.has(sig)) continue;
      bySig.set(sig, { ...r });
    }
  }
  return [...bySig.values()].map((r, i) => ({ ...r, retrievedId: String(r?.retrievedId || `rch_${i + 1}`) }));
}

function mergeConflicts(trajectories) {
  const out = [];
  const seen = new Set();
  for (const t of trajectories) {
    for (const c of Array.isArray(t?.L1?.conflicts) ? t.L1.conflicts : []) {
      const key = JSON.stringify(c);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

function mergeOpenQuestions(trajectories) {
  const out = [];
  const seen = new Set();
  for (const t of trajectories) {
    for (const q of Array.isArray(t?.L1?.openQuestions) ? t.L1.openQuestions : []) {
      const key = JSON.stringify(q);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(q);
    }
  }
  return out;
}

function withUniqueIds(trajectory) {
  const prefix = String(trajectory?.trajectoryId || "traj");
  const claims = (Array.isArray(trajectory?.L1?.claims) ? trajectory.L1.claims : []).map((c) => {
    const claimId = `${prefix}::${String(c?.claimId || "") || "c"}`;
    const evidenceIds = (Array.isArray(c?.evidenceIds) ? c.evidenceIds : []).map((e) => `${prefix}::${String(e || "")}`);
    const gapIds = Array.isArray(c?.gapIds) ? c.gapIds.map(String).filter(Boolean) : [];
    return { ...c, claimId, evidenceIds, ...(gapIds.length ? { gapIds } : {}) };
  });

  const evidenceLedger = (Array.isArray(trajectory?.L1?.evidenceLedger) ? trajectory.L1.evidenceLedger : []).map((e) => {
    const evidenceId = `${prefix}::${String(e?.evidenceId || "") || "e"}`;
    const gapIds = Array.isArray(e?.gapIds) ? e.gapIds.map(String).filter(Boolean) : [];
    return { ...e, evidenceId, ...(gapIds.length ? { gapIds } : {}) };
  });

  return { claims, evidenceLedger };
}

function reindexEvidenceAndClaims(claims, evidenceLedger) {
  const referenced = new Set();
  for (const c of claims) for (const eid of Array.isArray(c?.evidenceIds) ? c.evidenceIds : []) referenced.add(String(eid));

  const byKey = new Map();
  const evidenceIdMap = new Map();
  const mergedEvidence = [];

  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    const oldId = String(e?.evidenceId || "");
    if (!referenced.has(oldId)) continue;

    const key = evidenceKey(e);
    const existingId = byKey.get(key);
    if (existingId) {
      evidenceIdMap.set(oldId, existingId);
      continue;
    }
    const newId = `e_${mergedEvidence.length + 1}`;
    byKey.set(key, newId);
    evidenceIdMap.set(oldId, newId);
    mergedEvidence.push({ ...e, evidenceId: newId });
  }

  const mergedClaims = [];
  for (const c of Array.isArray(claims) ? claims : []) {
    const ids = Array.isArray(c?.evidenceIds) ? c.evidenceIds : [];
    const remapped = Array.from(new Set(ids.map((id) => evidenceIdMap.get(String(id))).filter(Boolean)));
    if (!remapped.length) continue;
    mergedClaims.push({ ...c, evidenceIds: remapped });
  }

  const finalClaims = mergedClaims.map((c, i) => ({ ...c, claimId: `c_${i + 1}` }));
  return { claims: finalClaims, evidenceLedger: mergedEvidence };
}

function claimScoreForVote(c) {
  const evidenceCount = Array.isArray(c?.evidenceIds) ? c.evidenceIds.length : 0;
  const imp = String(c?.importance || "").toLowerCase();
  const impRank = imp === "core" ? 2 : imp === "support" ? 1 : 0;
  return impRank * 10 + evidenceCount;
}

export class TrajectoryManager {
  constructor({ n = 1, mergeStrategy = "best", qualityMetrics = [], divergeAt = "gap" } = {}) {
    this.config = toTrajectoryConfig({ n, mergeStrategy, qualityMetrics, divergeAt });
    this.trajectories = []; // DeepSearchState[]
  }

  // Fork state into N trajectories
  fork(baseState) {
    this.trajectories = Array.from({ length: this.config.n }, (_, i) => {
      const clone = baseState.clone();
      clone.trajectoryId = `traj_${i}`;
      clone.trajectoryConfig = { ...this.config };
      return clone;
    });
    return this.trajectories;
  }

  // Run single trajectory iteration loop (post-scan; pre-write)
  async runTrajectory(trajectory, stages, stageApi) {
    const runContext = stages?.runContext;
    const runGapsStage = stages?.runGapsStage;
    const runRetrieveStage = stages?.runRetrieveStage;
    const runUnderstandStage = stages?.runUnderstandStage;
    const emit = typeof stages?.emit === "function" ? stages.emit : null;

    if (!runContext) throw new TypeError("TrajectoryManager.runTrajectory(trajectory, stages): stages.runContext is required");
    if (typeof runGapsStage !== "function") throw new TypeError("TrajectoryManager.runTrajectory(trajectory, stages): stages.runGapsStage must be a function");
    if (typeof runRetrieveStage !== "function") throw new TypeError("TrajectoryManager.runTrajectory(trajectory, stages): stages.runRetrieveStage must be a function");
    if (typeof runUnderstandStage !== "function") throw new TypeError("TrajectoryManager.runTrajectory(trajectory, stages): stages.runUnderstandStage must be a function");

    trajectory.trajectoryConfig = { ...this.config };

    const seenHitSignatures = new Set();
    let noNewHitsRounds = 0;

    while (trajectory.iteration < trajectory.maxIterations && !stageApi?.signal?.aborted) {
      checkCancelled(stageApi);
      await runGapsStage(runContext, { state: trajectory }, stageApi);

      const gaps = openGaps(trajectory);
      if (gaps.length === 0) break;

      checkCancelled(stageApi);
      const { retrievedChunks } = await runRetrieveStage(runContext, { state: trajectory }, stageApi);

      let newHitCount = 0;
      for (const r of Array.isArray(retrievedChunks) ? retrievedChunks : []) {
        const sig = signatureForRetrievedChunk(r);
        if (!seenHitSignatures.has(sig)) {
          seenHitSignatures.add(sig);
          newHitCount++;
        }
      }
      noNewHitsRounds = newHitCount === 0 ? noNewHitsRounds + 1 : 0;

      checkCancelled(stageApi);
      await runUnderstandStage(runContext, { state: trajectory }, stageApi);

      validateIteration(trajectory, { blockAfterMisses: getGapBlockAfterMisses(trajectory) });

      const checkpoint = trajectory.saveCheckpoint?.();
      if (checkpoint && emit) {
        emit("deepsearch.checkpoint.saved", { trajectoryId: trajectory.trajectoryId, checkpointId: checkpoint.checkpointId, iteration: checkpoint.iteration });
      }

      trajectory.iteration += 1;

      if (openGaps(trajectory).length === 0) break;
      if (noNewHitsRounds >= 2) break;
    }

    return trajectory;
  }

  // Merge all trajectory results
  merge() {
    if (this.config.mergeStrategy === "best") return this.mergeBest();
    if (this.config.mergeStrategy === "union") return this.mergeUnion();
    if (this.config.mergeStrategy === "vote") return this.mergeVote();
    return this.mergeBest();
  }

  mergeBest() {
    if (!this.trajectories.length) return null;
    let best = this.trajectories[0];
    let bestQ = this.computeQuality(best);
    for (const t of this.trajectories.slice(1)) {
      const q = this.computeQuality(t);
      if (q.score > bestQ.score) {
        best = t;
        bestQ = q;
        continue;
      }
      if (q.score === bestQ.score && q.coverage > bestQ.coverage) {
        best = t;
        bestQ = q;
      }
    }
    best.trajectoryConfig = { ...this.config };
    return best;
  }

  mergeUnion() {
    const best = this.mergeBest();
    if (!best) return null;
    const merged = best.clone();
    merged.trajectoryId = "merged";
    merged.trajectoryConfig = { ...this.config };
    merged.iteration = Math.max(...this.trajectories.map((t) => safeInt(t?.iteration) ?? 0));
    merged.maxIterations = Math.max(...this.trajectories.map((t) => safeInt(t?.maxIterations) ?? 0), merged.maxIterations);

    const allClaims = [];
    const allEvidence = [];
    for (const t of this.trajectories) {
      const { claims, evidenceLedger } = withUniqueIds(t);
      allClaims.push(...claims);
      allEvidence.push(...evidenceLedger);
    }

    const dedupedClaims = dedupeClaims(allClaims, { mergeEvidence: true });
    const { claims, evidenceLedger } = reindexEvidenceAndClaims(dedupedClaims, allEvidence);

    merged.L1.claims = claims;
    merged.L1.evidenceLedger = evidenceLedger;
    merged.L1.gaps = mergeGaps(this.trajectories);
    merged.L1.conflicts = mergeConflicts(this.trajectories);
    merged.L1.openQuestions = mergeOpenQuestions(this.trajectories);
    merged.L2.retrievedChunks = mergeRetrievedChunks(this.trajectories);

    return merged;
  }

  mergeVote() {
    const best = this.mergeBest();
    if (!best) return null;
    const merged = best.clone();
    merged.trajectoryId = "merged";
    merged.trajectoryConfig = { ...this.config };
    merged.iteration = Math.max(...this.trajectories.map((t) => safeInt(t?.iteration) ?? 0));
    merged.maxIterations = Math.max(...this.trajectories.map((t) => safeInt(t?.maxIterations) ?? 0), merged.maxIterations);

    const allEvidence = [];
    const clusters = new Map(); // key -> { trajIds:Set, claims:[] }

    for (const t of this.trajectories) {
      const { claims, evidenceLedger } = withUniqueIds(t);
      allEvidence.push(...evidenceLedger);
      for (const c of claims) {
        const key = normalizeForKey(c?.text);
        if (!key) continue;
        if (!clusters.has(key)) clusters.set(key, { trajIds: new Set(), claims: [] });
        const bucket = clusters.get(key);
        bucket.trajIds.add(String(t?.trajectoryId || ""));
        bucket.claims.push(c);
      }
    }

    const majority = Math.floor(this.trajectories.length / 2) + 1;
    const votedClaims = [];
    for (const bucket of clusters.values()) {
      if (bucket.trajIds.size < majority) continue;
      const candidates = bucket.claims;
      let winner = candidates[0];
      for (const c of candidates.slice(1)) if (claimScoreForVote(c) > claimScoreForVote(winner)) winner = c;

      const evidenceIds = Array.from(new Set(candidates.flatMap((c) => (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])).map(String).filter(Boolean)));
      const gapIds = Array.from(new Set(candidates.flatMap((c) => (Array.isArray(c?.gapIds) ? c.gapIds : [])).map(String).filter(Boolean)));
      votedClaims.push({ ...winner, evidenceIds, ...(gapIds.length ? { gapIds } : {}) });
    }

    const dedupedClaims = dedupeClaims(votedClaims, { mergeEvidence: true });
    const { claims, evidenceLedger } = reindexEvidenceAndClaims(dedupedClaims, allEvidence);

    merged.L1.claims = claims;
    merged.L1.evidenceLedger = evidenceLedger;
    merged.L1.gaps = mergeGaps(this.trajectories);
    merged.L1.conflicts = mergeConflicts(this.trajectories);
    merged.L1.openQuestions = mergeOpenQuestions(this.trajectories);
    merged.L2.retrievedChunks = mergeRetrievedChunks(this.trajectories);

    return merged;
  }

  // Quality metrics calculation
  computeQuality(trajectory) {
    const gaps = trajectory?.L1?.gaps || [];
    const claims = trajectory?.L1?.claims || [];
    const evidence = trajectory?.L1?.evidenceLedger || [];
    const conflicts = trajectory?.L1?.conflicts || [];

    const coverage = gaps.length ? gaps.filter((g) => g.status === "filled").length / gaps.length : 0;
    const evidenceQuality = claims.length ? claims.filter((c) => c.evidenceIds?.length).length / claims.length : 0;
    const conflictRate = claims.length ? conflicts.length / claims.length : 0;
    const efficiency = trajectory.iteration ? claims.length / trajectory.iteration : 0;

    return {
      coverage,
      evidenceQuality,
      conflictRate,
      efficiency,
      evidenceCount: Array.isArray(evidence) ? evidence.length : 0,
      claimCount: Array.isArray(claims) ? claims.length : 0,
      score: coverage * 0.4 + evidenceQuality * 0.3 - conflictRate * 0.15 + efficiency * 0.001,
    };
  }
}

export const __test = {
  clampInt,
  toTrajectoryConfig,
  signatureForRetrievedChunk,
  validateIteration,
  statusRank,
  evidenceKey,
  mergeGaps,
  mergeRetrievedChunks,
  mergeConflicts,
  mergeOpenQuestions,
  withUniqueIds,
  reindexEvidenceAndClaims,
  normalizeForKey,
  claimScoreForVote,
};
