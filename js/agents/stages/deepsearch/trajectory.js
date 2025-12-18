import { DeepSearchState, checkCancelled, computeRoundHitsByGapId, validateIteration } from "./state.js";
import { dedupeClaims } from "../../deepsearch/understanding/dedupe.js";
import { TrajectoryCache } from "./trajectory-cache.js";
import { parseExternalSearchConfig } from "./external-search.js";
import { extractServices } from "./stage-api.js";
import { isPlainObject, safeInt, toNonEmptyString } from "../../shared/value-utils.js";

function cloneValue(v) {
  return typeof structuredClone === "function" ? structuredClone(v) : JSON.parse(JSON.stringify(v));
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
  const cachePolicy = ["share", "off"].includes(String(cfg.cachePolicy)) ? String(cfg.cachePolicy) : "share";
  const cacheMaxSize = clampInt(cfg.cacheMaxSize, { min: 1, max: 5000 }) ?? 100;
  return { n, mergeStrategy, qualityMetrics, divergeAt, cachePolicy, cacheMaxSize };
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

function validateIterationCompat(state, { blockAfterMisses = 2, minEvidenceToFill = 1 } = {}) {
  const retrieved = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
  const roundHits = computeRoundHitsByGapId(retrieved);
  return validateIteration(state, { blockAfterMisses, roundHits, minEvidenceToFill });
}

function getGapBlockAfterMisses(state) {
  const cfg = isPlainObject(state?.userConfig?.gaps) ? state.userConfig.gaps : {};
  const n = safeInt(cfg.blockAfterMisses);
  return n !== null && n >= 1 ? n : 2;
}

function getMinEvidenceToFill(state) {
  const cfg = isPlainObject(state?.userConfig?.gaps) ? state.userConfig.gaps : {};
  const n = safeInt(cfg.minEvidenceToFill);
  return n !== null && n >= 1 ? n : 1;
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
  const oldGapIdsByKey = new Map(); // key -> Set of oldGapIds
  for (const t of trajectories) {
    for (const g of Array.isArray(t?.L1?.gaps) ? t.L1.gaps : []) {
      const key = gapKey(g);
      const oldGapId = String(g?.gapId || "");
      if (!oldGapIdsByKey.has(key)) oldGapIdsByKey.set(key, new Set());
      if (oldGapId) oldGapIdsByKey.get(key).add(oldGapId);

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

  const gaps = [...byKey.values()].sort((a, b) => gapKey(a).localeCompare(gapKey(b)));
  const gapIdMapping = new Map(); // oldGapId -> newGapId

  gaps.forEach((g, i) => {
    const key = gapKey(g);
    const newGapId = `gap_${i + 1}`;
    for (const oldId of oldGapIdsByKey.get(key) || []) gapIdMapping.set(oldId, newGapId);
    g.gapId = newGapId;
  });

  return { gaps, gapIdMapping };
}

function rewriteGapIds(items, gapIdMapping) {
  if (!gapIdMapping || typeof gapIdMapping.get !== "function") return;
  if (!Array.isArray(items)) return;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item.gapIds)) item.gapIds = item.gapIds.map((gid) => gapIdMapping.get(String(gid)) || gid);
    if (item.gapId) item.gapId = gapIdMapping.get(String(item.gapId)) || item.gapId;
    if (Array.isArray(item.matchedGapIds)) item.matchedGapIds = item.matchedGapIds.map((gid) => gapIdMapping.get(String(gid)) || gid);
  }
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
  const referenced = new Set(
    (Array.isArray(claims) ? claims : []).flatMap((c) => (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])).map(String)
  );

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
  constructor({ n = 1, mergeStrategy = "best", qualityMetrics = [], divergeAt = "gap", cachePolicy = "share", cacheMaxSize = 100 } = {}) {
    this.config = toTrajectoryConfig({ n, mergeStrategy, qualityMetrics, divergeAt, cachePolicy, cacheMaxSize });
    this.trajectories = []; // DeepSearchState[]
    this.trajectoryCache = this.config.cachePolicy === "share" ? new TrajectoryCache({ maxSize: this.config.cacheMaxSize }) : null;
    this.emit = null;
  }

  // Fork state into N trajectories
  fork(baseState) {
    this.trajectories = Array.from({ length: this.config.n }, (_, i) => {
      // 轻量克隆：共享 L0，只克隆可变部分
      const clone = new DeepSearchState({
        runId: baseState.runId,
        taskGoal: baseState.taskGoal,
        userConfig: baseState.userConfig,
        iteration: baseState.iteration,
        maxIterations: baseState.maxIterations,
        L0: baseState.L0, // 共享引用（源文档不可变）
        L1: JSON.parse(JSON.stringify(baseState.L1 || {})),
        L2: { retrievedChunks: [], scratchpad: {}, logs: [], tokenUsage: { input: 0, output: 0, total: 0 } },
      });
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
    const runExternalSearch = stages?.runExternalSearch; // 新增：外搜函数
    const baseEmit = typeof stages?.emit === "function" ? stages.emit : null;

    if (!runContext) throw new TypeError("TrajectoryManager.runTrajectory(trajectory, stages): stages.runContext is required");
    if (typeof runGapsStage !== "function") throw new TypeError("TrajectoryManager.runTrajectory(trajectory, stages): stages.runGapsStage must be a function");
    if (typeof runRetrieveStage !== "function") throw new TypeError("TrajectoryManager.runTrajectory(trajectory, stages): stages.runRetrieveStage must be a function");
    if (typeof runUnderstandStage !== "function") throw new TypeError("TrajectoryManager.runTrajectory(trajectory, stages): stages.runUnderstandStage must be a function");

    trajectory.trajectoryConfig = { ...this.config };

    const runId = toNonEmptyString(trajectory?.runId) || toNonEmptyString(runContext?.runId) || "run_unknown";
    const trajectoryId = toNonEmptyString(trajectory?.trajectoryId) || "traj_unknown";

    if (baseEmit) this.emit = baseEmit;
    const emit =
      baseEmit &&
      ((name, payload) =>
        baseEmit(name, {
          ...(isPlainObject(payload) ? payload : {}),
          runId,
          trajectoryId,
        }));

    const seenHitSignatures = new Set();
    let noNewHitsRounds = 0;
    let externalSearchTriggered = false; // 每个 trajectory 只触发一次外搜
    const { signal } = extractServices(stageApi);

    const wrapApiForStage = (name) => {
      const base = stageApi && typeof stageApi === "object" ? stageApi : {};
      const withContext = { ...base, runId, trajectoryId };
      if (!this.trajectoryCache || this.config.cachePolicy !== "share") return withContext;
      return {
        ...withContext,
        trajectoryCache: this.trajectoryCache,
        trajectoryCachePolicy: this.config.cachePolicy,
        trajectoryCacheStageName: String(name || ""),
      };
    };

    emit?.("deepsearch.trajectory.started", {
      runId,
      trajectoryId: trajectory.trajectoryId,
      config: this.config,
      iterationStart: trajectory.iteration,
    });

    try {
      while (trajectory.iteration < trajectory.maxIterations && !signal?.aborted) {
        checkCancelled(stageApi);
        await runGapsStage(runContext, { state: trajectory }, wrapApiForStage("gaps"));

        const gaps = openGaps(trajectory);
        if (gaps.length === 0) break;

        checkCancelled(stageApi);
        const { retrievedChunks } = await runRetrieveStage(runContext, { state: trajectory }, wrapApiForStage("retrieve"));

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
        const understandResult = await runUnderstandStage(runContext, { state: trajectory }, wrapApiForStage("understand"));

        // ===== Reflect-driven 外搜触发 =====
        const reflectResult = understandResult?.reflectResult || trajectory?.L1?.reflectResult;
        const externalSearchConfig = parseExternalSearchConfig(trajectory?.userConfig);
        const externalSearchEnabled = externalSearchConfig.enabled === true && externalSearchConfig.autoTrigger === true;

        // 健壮性检查：
        // 1. reflectResult 存在且 sufficient=false
        // 2. 尚未触发过外搜 (每轨迹最多一次)
        // 3. 外搜已启用
        // 4. 有外搜函数
        // 5. 有建议的搜索词或有 open gaps
        const currentGaps = openGaps(trajectory);
        const hasSuggestedQueries = Array.isArray(reflectResult?.suggestedQueries) && reflectResult.suggestedQueries.length > 0;
        const hasOpenGaps = currentGaps.length > 0;

        const shouldTriggerExternalSearch =
          reflectResult &&
          !reflectResult.sufficient &&
          !externalSearchTriggered &&
          externalSearchEnabled &&
          typeof runExternalSearch === "function" &&
          (hasSuggestedQueries || hasOpenGaps);

        if (shouldTriggerExternalSearch) {
          // LLM 判断证据不足，触发外搜
          emit?.("deepsearch.external.reflecttriggered", {
            reason: reflectResult.reason,
            confidence: reflectResult.confidence,
            suggestedQueries: reflectResult.suggestedQueries,
            iteration: trajectory.iteration,
          });

          // 使用 LLM 建议的搜索词，或从 open gaps 生成
          const defaultGapId = toNonEmptyString(currentGaps?.[0]?.gapId);
          const searchGaps = hasSuggestedQueries
            ? reflectResult.suggestedQueries.map((q, i) => ({
                gapId: defaultGapId || `ext_${i}`,
                query: q,
                question: q,
                type: "external",
              }))
            : currentGaps
                .map((g) => ({
                  gapId: g?.gapId || "gap_unknown",
                  query: g?.question || g?.text || "",
                  question: g?.question || g?.text || "",
                  type: g?.type || "external",
                }))
                .filter((g) => g.query);

          if (searchGaps.length > 0) {
            try {
              checkCancelled(stageApi);
              await runExternalSearch(searchGaps, externalSearchConfig, {
                emit,
                state: trajectory,
                stageApi: wrapApiForStage("external"),
              });
              externalSearchTriggered = true;

              // 外搜后重新运行 Understand 阶段
              checkCancelled(stageApi);
              await runUnderstandStage(runContext, { state: trajectory }, wrapApiForStage("understand"));
            } catch (err) {
              emit?.("deepsearch.external.error", { message: String(err?.message || err) });
              // 外搜失败也标记为已触发，避免重复尝试
              externalSearchTriggered = true;
            }
          } else {
            emit?.("deepsearch.external.skipped", { reason: "no_valid_search_queries" });
          }
        }
        // ===== Reflect-driven 外搜触发结束 =====

        const roundHits = computeRoundHitsByGapId(retrievedChunks);
        validateIteration(trajectory, {
          blockAfterMisses: getGapBlockAfterMisses(trajectory),
          minEvidenceToFill: getMinEvidenceToFill(trajectory),
          roundHits,
          emit,
        });

        const checkpoint = trajectory.saveCheckpoint?.();
        if (checkpoint) {
          emit?.("deepsearch.checkpoint.saved", { checkpointId: checkpoint.checkpointId, iteration: checkpoint.iteration });
        }

        trajectory.iteration += 1;

        if (openGaps(trajectory).length === 0) break;
        if (noNewHitsRounds >= 2) break;
      }

      emit?.("deepsearch.trajectory.completed", {
        runId,
        trajectoryId: trajectory.trajectoryId,
        iterationEnd: trajectory.iteration,
        outcome: "success",
        quality: this.computeQuality(trajectory),
      });

      return trajectory;
    } catch (err) {
      emit?.("deepsearch.trajectory.completed", {
        runId,
        trajectoryId: trajectory.trajectoryId,
        iterationEnd: trajectory.iteration,
        outcome: "failed",
        quality: this.computeQuality(trajectory),
        error: { message: String(err?.message || err) },
      });
      throw err;
    }
  }

  // Merge all trajectory results
  merge() {
    const emit = typeof this.emit === "function" ? this.emit : null;
    const runId = toNonEmptyString(this.trajectories?.[0]?.runId) || "run_unknown";

    if (emit) {
      emit?.("deepsearch.trajectory.merge.started", {
        runId,
        mergeStrategy: this.config.mergeStrategy,
        inputs: this.trajectories.map((t) => ({
          trajectoryId: t.trajectoryId,
          quality: this.computeQuality(t),
        })),
      });
    }

    const merged =
      this.config.mergeStrategy === "best"
        ? this.mergeBest()
        : this.config.mergeStrategy === "union"
          ? this.mergeUnion()
          : this.config.mergeStrategy === "vote"
            ? this.mergeVote()
            : this.mergeBest();

    if (merged && emit) {
      emit?.("deepsearch.trajectory.merge.completed", {
        runId,
        mergeStrategy: this.config.mergeStrategy,
        output: { trajectoryId: "merged", quality: this.computeQuality(merged) },
      });
    }

    return merged;
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
    const { gaps, gapIdMapping } = mergeGaps(this.trajectories);
    merged.L1.gaps = gaps;
    rewriteGapIds(merged.L1.claims, gapIdMapping);
    rewriteGapIds(merged.L1.evidenceLedger, gapIdMapping);
    merged.L1.conflicts = mergeConflicts(this.trajectories);
    merged.L1.openQuestions = mergeOpenQuestions(this.trajectories);
    merged.L2.retrievedChunks = mergeRetrievedChunks(this.trajectories);
    rewriteGapIds(merged.L2.retrievedChunks, gapIdMapping);

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
    const { gaps, gapIdMapping } = mergeGaps(this.trajectories);
    merged.L1.gaps = gaps;
    rewriteGapIds(merged.L1.claims, gapIdMapping);
    rewriteGapIds(merged.L1.evidenceLedger, gapIdMapping);
    merged.L1.conflicts = mergeConflicts(this.trajectories);
    merged.L1.openQuestions = mergeOpenQuestions(this.trajectories);
    merged.L2.retrievedChunks = mergeRetrievedChunks(this.trajectories);
    rewriteGapIds(merged.L2.retrievedChunks, gapIdMapping);

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
  cloneValue,
  clampInt,
  toTrajectoryConfig,
  signatureForRetrievedChunk,
  validateIteration: validateIterationCompat,
  statusRank,
  evidenceKey,
  mergeGaps,
  rewriteGapIds,
  mergeRetrievedChunks,
  mergeConflicts,
  mergeOpenQuestions,
  withUniqueIds,
  reindexEvidenceAndClaims,
  normalizeForKey,
  claimScoreForVote,
};
