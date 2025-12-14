import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";
import { chunkText } from "../textprep/chunk.js";
import { retrieve as retrieveWithRouter } from "../../retrieval/retrieval-router.js";
import { createMcpClient, parseExternalSearchConfig, runExternalSearch } from "./external-search.js";

const defaultLocalRetriever = (...args) => retrieveWithRouter(...args);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

export function deduplicateChunks(newChunks, existingChunks) {
  const existingIds = new Set((Array.isArray(existingChunks) ? existingChunks : []).map((c) => c?.chunkId));
  const existingTexts = new Set((Array.isArray(existingChunks) ? existingChunks : []).map((c) => c?.text?.slice(0, 200)));

  return (Array.isArray(newChunks) ? newChunks : []).filter((c) => !existingIds.has(c?.chunkId) && !existingTexts.has(c?.text?.slice(0, 200)));
}

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch retrieve: input.state is required");
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function clampProgress(progress) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function emitRetrieveProgress(emit, { current, total, msg, detail }) {
  emit?.(
    "deepsearch.retrieve.progress",
    {
      phase: "retrieve",
      step: "gap",
      current,
      total: Math.max(1, total),
      progress: clampProgress(total > 0 ? current / total : 1),
      msg: String(msg || ""),
      ...(detail && typeof detail === "object" && !Array.isArray(detail) ? { detail } : {}),
    },
    { status: "progress" }
  );
}

function nextAddedSeq(existingChunks) {
  let maxSeq = 0;
  for (const c of Array.isArray(existingChunks) ? existingChunks : []) {
    const seq = typeof c?.addedSeq === "number" && Number.isFinite(c.addedSeq) ? c.addedSeq : 0;
    if (seq > maxSeq) maxSeq = seq;
  }
  return maxSeq + 1;
}

function ensureAddedMeta(chunks, { now, startSeq } = {}) {
  let seq = safeInt(startSeq) ?? 1;
  const t = typeof now === "string" && now ? now : new Date().toISOString();
  for (const c of Array.isArray(chunks) ? chunks : []) {
    if (!c || typeof c !== "object") continue;
    if (!(typeof c.addedSeq === "number" && Number.isFinite(c.addedSeq))) {
      c.addedSeq = seq;
      seq += 1;
    } else {
      seq = Math.max(seq, c.addedSeq + 1);
    }
    if (!toNonEmptyString(c.addedAt)) c.addedAt = t;
  }
  return seq;
}

function applyChunkLru(chunks, { maxChunks } = {}) {
  const max = safeInt(maxChunks);
  if (max === null || max <= 0) return Array.isArray(chunks) ? chunks : [];
  const arr = Array.isArray(chunks) ? chunks : [];
  if (arr.length <= max) return arr;

  const over = arr.length - max;
  if (over <= 0) return arr;

  const removeConsumedIndexes = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] && arr[i].consumed) removeConsumedIndexes.push(i);
  }

  const consumedToRemove = new Set(removeConsumedIndexes.slice(0, over));
  const afterConsumed = consumedToRemove.size ? arr.filter((_, i) => !consumedToRemove.has(i)) : arr;
  if (afterConsumed.length <= max) return afterConsumed;

  return afterConsumed.slice(afterConsumed.length - max);
}

function normalizeChunkIdList(v) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(v) ? v : []) {
    const id = toNonEmptyString(x);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function trackSeenChunkIds(state, chunkIds, { maxSize } = {}) {
  if (!state || typeof state !== "object") return [];
  if (!isPlainObject(state.L2)) state.L2 = {};
  const existing = normalizeChunkIdList(state.L2.retrievedChunkIdsSeen);
  const next = existing.slice();
  const seen = new Set(existing);

  for (const id of normalizeChunkIdList(chunkIds)) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }

  const cap = safeInt(maxSize);
  if (cap !== null && cap > 0 && next.length > cap) {
    const trimmed = next.slice(next.length - cap);
    state.L2.retrievedChunkIdsSeen = trimmed;
    return trimmed;
  }

  state.L2.retrievedChunkIdsSeen = next;
  return next;
}

// ===== LLM-based Rerank =====

const RERANK_PROMPT = `你是一个检索结果排序助手。根据用户问题，对以下检索结果按相关性从高到低排序。

## 用户问题
{query}

## 检索结果
{chunks}

## 任务
1. 评估每个结果与问题的相关性（0-10分）
2. 按相关性从高到低排序
3. 过滤掉完全不相关的结果（相关性 < 3）

## 输出格式（严格 JSON）
{
  "ranked": [
    { "id": "结果ID", "score": 8, "reason": "简短理由" }
  ]
}

只返回 JSON，不要其他内容。`;

/**
 * 使用小模型对检索结果进行重排
 * @param {Array} chunks - 检索到的 chunks
 * @param {string} query - 查询问题
 * @param {object} options - 配置选项
 * @returns {Promise<{ranked: Array, stats: object}>}
 */
async function rerankWithLLM(chunks, query, { stageApi, state, emit, topK = 10, timeoutMs = 12000 } = {}) {
  const inputChunks = Array.isArray(chunks) ? chunks : [];
  if (inputChunks.length === 0) {
    return { ranked: [], stats: { inputCount: 0, outputCount: 0, skipped: true, reason: "no_chunks" } };
  }

  // 如果 chunks 数量少，直接返回（不值得调用 LLM）
  if (inputChunks.length <= 3) {
    return {
      ranked: inputChunks.slice(0, topK),
      stats: { inputCount: inputChunks.length, outputCount: inputChunks.length, skipped: true, reason: "too_few_chunks" },
    };
  }

  const callModel = getModelCaller(stageApi, { usage: "reranker", state });
  if (!callModel) {
    // 没有模型，按原始 BM25 分数排序
    const sorted = [...inputChunks].sort((a, b) => (b.score || 0) - (a.score || 0));
    return {
      ranked: sorted.slice(0, topK),
      stats: { inputCount: inputChunks.length, outputCount: Math.min(topK, inputChunks.length), skipped: true, reason: "no_model" },
    };
  }

  // 构建 prompt
  const chunksText = inputChunks
    .slice(0, 20) // 最多处理 20 个候选
    .map((c, i) => {
      const id = c.chunkId || c.retrievedId || `chunk_${i}`;
      const text = String(c.text || "").slice(0, 300);
      const score = typeof c.score === "number" ? c.score.toFixed(2) : "N/A";
      return `[${id}] (BM25: ${score})\n${text}`;
    })
    .join("\n\n---\n\n");

  const prompt = RERANK_PROMPT.replace("{query}", String(query || "")).replace("{chunks}", chunksText);

  try {
    // 带超时的 LLM 调用
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const resultPromise = callModel([{ role: "user", content: prompt }], {
      temperature: 0.1,
      maxTokens: 600,
    });

    const result = await Promise.race([
      resultPromise,
      new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new Error("Rerank LLM timeout")));
      }),
    ]);
    clearTimeout(timeoutId);

    const candidate = extractJsonCandidate(result?.content);
    if (!candidate) {
      emit?.("deepsearch.rerank.failed", { reason: "parse_failed", inputCount: inputChunks.length });
      const sorted = [...inputChunks].sort((a, b) => (b.score || 0) - (a.score || 0));
      return {
        ranked: sorted.slice(0, topK),
        stats: { inputCount: inputChunks.length, outputCount: Math.min(topK, inputChunks.length), skipped: true, reason: "parse_failed" },
      };
    }

    const parsed = JSON.parse(candidate);
    const rankedIds = Array.isArray(parsed?.ranked) ? parsed.ranked : [];

    // 根据 LLM 返回的排序重排 chunks
    const chunkById = new Map();
    for (const c of inputChunks) {
      const id = c.chunkId || c.retrievedId;
      if (id) chunkById.set(id, c);
    }

    const reranked = [];
    const seenIds = new Set();
    for (const item of rankedIds) {
      const id = toNonEmptyString(item?.id);
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);

      const chunk = chunkById.get(id);
      if (!chunk) continue;

      const llmScore = typeof item?.score === "number" ? item.score : 5;
      if (llmScore < 3) continue; // 过滤低相关性

      reranked.push({
        ...chunk,
        rerankScore: llmScore,
        rerankReason: toNonEmptyString(item?.reason) || undefined,
      });

      if (reranked.length >= topK) break;
    }

    // 如果 LLM 返回的结果太少，补充原始排序的结果
    if (reranked.length < topK) {
      const sorted = [...inputChunks].sort((a, b) => (b.score || 0) - (a.score || 0));
      for (const c of sorted) {
        const id = c.chunkId || c.retrievedId;
        if (id && seenIds.has(id)) continue;
        if (id) seenIds.add(id);
        reranked.push(c);
        if (reranked.length >= topK) break;
      }
    }

    emit?.("deepsearch.rerank.completed", {
      inputCount: inputChunks.length,
      outputCount: reranked.length,
      llmRankedCount: rankedIds.length,
      filteredCount: rankedIds.filter((r) => (r?.score || 0) < 3).length,
    });

    return {
      ranked: reranked,
      stats: {
        inputCount: inputChunks.length,
        outputCount: reranked.length,
        llmRankedCount: rankedIds.length,
        filteredCount: rankedIds.filter((r) => (r?.score || 0) < 3).length,
        skipped: false,
      },
    };
  } catch (err) {
    emit?.("deepsearch.rerank.failed", { reason: String(err?.message || err), inputCount: inputChunks.length });

    // 失败时回退到 BM25 排序
    const sorted = [...inputChunks].sort((a, b) => (b.score || 0) - (a.score || 0));
    return {
      ranked: sorted.slice(0, topK),
      stats: { inputCount: inputChunks.length, outputCount: Math.min(topK, inputChunks.length), skipped: true, reason: String(err?.message || err) },
    };
  }
}

/**
 * 解析 rerank 配置
 */
function parseRerankConfig(userConfig) {
  const cfg = isPlainObject(userConfig?.retrieval?.rerank) ? userConfig.retrieval.rerank : {};
  return {
    enabled: cfg.enabled === true, // 默认关闭
    topK: safeInt(cfg.topK) ?? 10,
    timeoutMs: safeInt(cfg.timeoutMs) ?? 12000,
    minChunksToRerank: safeInt(cfg.minChunksToRerank) ?? 4, // 少于 4 个不值得 rerank
  };
}

// ===== LLM-based Rerank 结束 =====

/**
 * S4 Retrieval Router wrapper: TOC-scope -> BM25/grep -> readAround.
 *
 * DI injection points (`stageApi`):
 * - `localRetriever(sourceIndex, gaps, routerConfig)`: override local retrieval implementation (defaults to `retrieval-router`).
 * - `modelRouter.call(...)` / `aiApiService.chat(...)`: used by rerank LLM calls (via `getModelCaller`).
 * - `externalSearchProvider`: used by `runExternalSearch` (re-exported from this module).
 * - `emit` / `eventBus`: event emission (via `makeStageEmitter`).
 * - `signal` / `checkCancelled`: cancellation support.
 * @param {object} runContext
 * @param {DeepSearchState|{state:DeepSearchState|object}} input
 * @param {object=} stageApi
 * @param {Function=} stageApi.localRetriever
 * @param {Function=} stageApi.emit
 * @param {object=} stageApi.eventBus
 * @param {AbortSignal=} stageApi.signal
 * @param {Function=} stageApi.checkCancelled
 * @param {object=} stageApi.modelRouter
 * @param {object=} stageApi.aiApiService
 * @param {object=} stageApi.externalSearchProvider
 */
export async function runDeepSearchRetrieveStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);
  const localRetriever = stageApi?.localRetriever ?? defaultLocalRetriever;

  checkCancelled(stageApi);

  // 发射阶段开始事件
  emitRetrieveProgress(emit, {
    current: 0,
    total: 1,
    msg: "正在启动检索阶段...",
    detail: { step: "init" },
  });

  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const gapsAll = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const gaps = gapsAll.filter((g) => String(g?.status || "open") === "open");
  const existingChunks = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];

  const retrievalConfig = isPlainObject(state?.userConfig?.retrieval) ? state.userConfig.retrieval : {};
  const chunkSize = Number.isFinite(retrievalConfig.chunkSize) ? Math.max(200, Math.floor(retrievalConfig.chunkSize)) : 1600;
  const overlap = Number.isFinite(retrievalConfig.overlap) ? Math.max(0, Math.floor(retrievalConfig.overlap)) : 180;
  const topK = Number.isFinite(retrievalConfig.topK) ? Math.max(1, Math.floor(retrievalConfig.topK)) : 6;
  const windowSize = Number.isFinite(retrievalConfig.windowSize) ? Math.max(0, Math.floor(retrievalConfig.windowSize)) : 1;
  const maxChunks = safeInt(retrievalConfig.maxChunks) ?? 100;

  const routerConfig = {
    topK,
    windowSize,
    useBm25: retrievalConfig.useBm25 !== false,
    useGrep: retrievalConfig.useGrep !== false,
    grepRegex: Boolean(retrievalConfig.grepRegex),
    caseSensitive: Boolean(retrievalConfig.caseSensitive),
    bm25: isPlainObject(retrievalConfig.bm25) ? retrievalConfig.bm25 : {},
  };

  const sourceIndexes = [];
  for (const s of sources) {
    const sourceId = toNonEmptyString(s?.sourceId) || "source_unknown";
    const fullText = typeof s?.sourceTextNormalized === "string" ? s.sourceTextNormalized : "";
    if (!fullText) continue;

    const rawChunks = Array.isArray(s?.chunks)
      ? s.chunks
      : chunkText(fullText, { chunkSize, overlap, includeLineNumbers: Boolean(retrievalConfig.includeLineNumbers) });

    const chunks = rawChunks
      .map((c, i) => {
        const cid = toNonEmptyString(c?.chunkId) || `chunk_${i + 1}`;
        const chunkId = cid.startsWith(`${sourceId}::`) ? cid : `${sourceId}::${cid}`;
        const text = typeof c?.text === "string" ? c.text : "";
        const locator = isPlainObject(c?.locator) ? c.locator : null;
        return locator && Number.isFinite(locator.charStart) && Number.isFinite(locator.charEnd)
          ? { chunkId, text, locator: { ...locator } }
          : null;
      })
      .filter(Boolean);

    const sourceIndex = {
      sourceId,
      fullText,
      toc: Array.isArray(s?.toc) ? s.toc : Array.isArray(s?.tocNodes) ? s.tocNodes : undefined,
      chunks,
    };
    sourceIndexes.push(sourceIndex);
  }

  const existingByChunkId = new Map();
  for (const r of existingChunks) {
    const cid = toNonEmptyString(r?.chunkId);
    if (cid) existingByChunkId.set(cid, r);
  }

  const retrievedByChunkId = new Map(); // chunkId -> merged row (without retrievedId)
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i];
    const gapId = toNonEmptyString(g?.gapId) || `gap_${i + 1}`;
    const gapType = toNonEmptyString(g?.type) || "";

    emitRetrieveProgress(emit, {
      current: i + 1,
      total: gaps.length,
      msg: `正在检索 ${gapId} 的证据${g?.question ? `：${String(g.question).slice(0, 80)}` : ""}`,
      detail: { gapId, type: toNonEmptyString(g?.type) || "unknown", priority: toNonEmptyString(g?.priority) || "medium", question: toNonEmptyString(g?.question) || "" },
    });

    for (const sourceIndex of sourceIndexes) {
      const retrieved = localRetriever(sourceIndex, [{ ...g, gapId }], routerConfig);
      for (const r of retrieved) {
        // Heuristic: data/metrics gaps should be supported by numeric evidence; avoid
        // attributing non-numeric chunks to data gaps to prevent false "hits" and fills.
        if (gapType === "data") {
          const text = typeof r?.text === "string" ? r.text : "";
          if (!/[0-9]/.test(text)) continue;
        }

        const chunkId = String(r?.chunkId || "");
        if (!chunkId) continue;

        const matchedGapIds = Array.isArray(r?.matchedGapIds) ? r.matchedGapIds.map(String).filter(Boolean) : [gapId];
        if (!matchedGapIds.includes(gapId)) matchedGapIds.unshift(gapId);

        const existing = retrievedByChunkId.get(chunkId);
        if (!existing) {
          retrievedByChunkId.set(chunkId, {
            chunkId,
            sourceId: String(r?.sourceId || sourceIndex.sourceId),
            locator: r?.locator,
            text: String(r?.text || ""),
            ...(typeof r?.score === "number" && Number.isFinite(r.score) ? { score: r.score } : {}),
            ...(toNonEmptyString(r?.relevance) ? { relevance: String(r.relevance) } : {}),
            matchedGapIds: matchedGapIds.slice(),
            gapId: matchedGapIds[0],
          });
          continue;
        }

        const mergedGapIds = Array.from(new Set([...(Array.isArray(existing.matchedGapIds) ? existing.matchedGapIds : []), ...matchedGapIds]));
        existing.matchedGapIds = mergedGapIds;
        existing.gapId = existing.gapId || mergedGapIds[0];
        if (typeof r?.score === "number" && Number.isFinite(r.score) && (!(typeof existing.score === "number") || r.score > existing.score)) {
          existing.score = r.score;
        }
        if (toNonEmptyString(r?.relevance) && !toNonEmptyString(existing.relevance)) existing.relevance = String(r.relevance);
      }
    }
  }

  const roundChunks = [];
  for (const row of retrievedByChunkId.values()) {
    const retrievedId = `rch_${roundChunks.length + 1}`;
    roundChunks.push({ retrievedId, ...row });
  }

  // ===== LLM Rerank =====
  const rerankConfig = parseRerankConfig(state?.userConfig);
  let rerankStats = null;
  let rerankedChunks = roundChunks;

  if (rerankConfig.enabled && roundChunks.length >= rerankConfig.minChunksToRerank) {
    // 构建 rerank 查询：合并所有 gap 的问题
    const rerankQuery = gaps
      .map((g) => toNonEmptyString(g?.question) || toNonEmptyString(g?.text) || "")
      .filter(Boolean)
      .slice(0, 3)
      .join("; ");

    if (rerankQuery) {
      emitRetrieveProgress(emit, {
        current: gaps.length,
        total: gaps.length,
        msg: `正在使用 LLM 重排 ${roundChunks.length} 个检索结果...`,
        detail: { step: "rerank", inputCount: roundChunks.length },
      });

      const { ranked, stats } = await rerankWithLLM(roundChunks, rerankQuery, {
        stageApi,
        state,
        emit,
        topK: rerankConfig.topK,
        timeoutMs: rerankConfig.timeoutMs,
      });

      rerankedChunks = ranked;
      rerankStats = stats;

      if (!stats.skipped) {
        state.addTimeline({
          name: "deepsearch.rerank",
          status: "completed",
          payload: stats,
        });
      }
    }
  }
  // ===== LLM Rerank 结束 =====

  // === 外搜说明 ===
  // 外搜现在由 Reflect 机制驱动（在 trajectory.js 中）
  // 不再使用 minLocalHits 固定阈值
  // 当 LLM 判断证据不足时，会调用 runExternalSearch
  let externalChunks = [];
  let externalSearchTriggered = false;
  // === 外搜说明结束 ===

  for (const r of rerankedChunks) {
    const existing = existingByChunkId.get(String(r?.chunkId || ""));
    if (!existing) continue;
    const mergedGapIds = Array.from(
      new Set([...(Array.isArray(existing.matchedGapIds) ? existing.matchedGapIds.map(String) : []), ...(Array.isArray(r.matchedGapIds) ? r.matchedGapIds.map(String) : [])])
    ).filter(Boolean);
    if (mergedGapIds.length) existing.matchedGapIds = mergedGapIds;
    if (!toNonEmptyString(existing.gapId) && toNonEmptyString(r.gapId)) existing.gapId = String(r.gapId);
    if (mergedGapIds.length) existing.gapId = existing.gapId || mergedGapIds[0];
    if (typeof r?.score === "number" && Number.isFinite(r.score) && (!(typeof existing.score === "number") || r.score > existing.score)) existing.score = r.score;
    if (toNonEmptyString(r?.relevance) && !toNonEmptyString(existing.relevance)) existing.relevance = String(r.relevance);
  }

  const deduped = deduplicateChunks(rerankedChunks, existingChunks);
  const seenChunkIds = new Set(normalizeChunkIdList(state?.L2?.retrievedChunkIdsSeen));
  const dedupedFresh = deduped.filter((c) => !seenChunkIds.has(String(c?.chunkId || "")));
  emit?.("deepsearch.retrieve.deduped", {
    before: rerankedChunks.length,
    after: dedupedFresh.length,
    dropped: Math.max(0, rerankedChunks.length - dedupedFresh.length),
    existing: existingChunks.length,
  });

  const now = new Date().toISOString();
  ensureAddedMeta(existingChunks, { now, startSeq: 1 });
  const startSeq = nextAddedSeq(existingChunks);
  ensureAddedMeta(dedupedFresh, { now, startSeq });

  const combined = [...existingChunks, ...dedupedFresh];
  const trimmed = applyChunkLru(combined, { maxChunks });
  const evictedCount = Math.max(0, combined.length - trimmed.length);
  const trimmedIds = new Set(trimmed.map((c) => toNonEmptyString(c?.chunkId)).filter(Boolean));
  const evictedIds = [];
  const evictedIdSet = new Set();
  for (const c of combined) {
    const id = toNonEmptyString(c?.chunkId);
    if (!id) continue;
    if (trimmedIds.has(id)) continue;
    if (evictedIdSet.has(id)) continue;
    evictedIdSet.add(id);
    evictedIds.push(id);
  }

  emit?.("deepsearch.chunks.added", {
    runId: toNonEmptyString(state?.runId) || "run_unknown",
    iteration: safeInt(state?.iteration) ?? 0,
    trajectoryId: toNonEmptyString(state?.trajectoryId),
    chunks: dedupedFresh.map((c) => ({
      retrievedId: c.retrievedId,
      chunkId: c.chunkId,
      sourceId: c.sourceId,
      gapId: c.gapId,
      matchedGapIds: c.matchedGapIds,
      score: c.score,
      isExternal: c.isExternal,
      addedSeq: c.addedSeq,
    })),
    evictedChunkIds: evictedIds || [],
  });

  state.L2.retrievedChunks = trimmed;
  trackSeenChunkIds(
    state,
    [...existingChunks, ...rerankedChunks].map((c) => toNonEmptyString(c?.chunkId)).filter(Boolean),
    { maxSize: Math.max(1000, maxChunks * 50) }
  );
  state.addTimeline({
    name: "deepsearch.retrieve",
    status: "completed",
    payload: {
      retrievedCount: dedupedFresh.length,
      retrievedBeforeDedupe: roundChunks.length,
      totalRetrieved: trimmed.length,
      evictedCount,
      maxChunks,
      externalSearchTriggered,
      externalChunksCount: externalChunks.length,
      ...(rerankStats ? { rerank: rerankStats } : {}),
    },
  });

  emit?.("deepsearch.retrieve.completed", {
    retrievedCount: dedupedFresh.length,
    retrievedBeforeDedupe: roundChunks.length,
    totalRetrieved: trimmed.length,
    evictedCount,
    maxChunks,
    gapCount: gaps.length,
    totalGaps: gapsAll.length,
    externalSearchTriggered,
    externalChunksCount: externalChunks.length,
    ...(rerankStats ? { rerank: rerankStats } : {}),
  });
  return { state, retrievedChunks: rerankedChunks };
}

// 导出 runExternalSearch 供 trajectory.js 调用
export { runExternalSearch, parseExternalSearchConfig };

export const __test = {
  applyChunkLru,
  ensureAddedMeta,
  nextAddedSeq,
  trackSeenChunkIds,
  parseExternalSearchConfig,
  createMcpClient,
  runExternalSearch,
};
