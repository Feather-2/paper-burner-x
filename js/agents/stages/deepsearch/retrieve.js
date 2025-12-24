import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";
import { chunkText } from "../textprep/chunk.js";
import { retrieve as retrieveWithRouter } from "../../retrieval/retrieval-router.js";
import { createMcpClient, parseExternalSearchConfig, runExternalSearch } from "./external-search.js";
import { createLogger, trackToolCall } from "./logger.js";
import { extractServices } from "./stage-api.js";
import { search as toolChainSearch, ToolChainStrategy, normalizeToolChainStrategy } from "../../retrieval/tool-chain.js";
import { ShadowAgent, shouldValidateWithShadow } from "./shadow-agent.js";
import { isPlainObject, toNonEmptyString, safeInt } from "../../shared/value-utils.js";
import { LRUMap } from "../../shared/lru-map.js";
import { mapConcurrent } from "../../shared/concurrency.js";
import { CHUNK_CONFIG, RetrievalStrategy, normalizeRetrievalStrategy, normalizeDeepSearchSourceKind } from "./constants.js";
import { DecisionOutcome, DecisionStage } from "./states.js";
import { loadPrompt } from "../../prompts/prompt-loader.js";
import { migratGapToTodo } from "./todo-utils.js";

// 缓存的提示词
let _rerankPrompt = null;

/**
 * 异步获取 rerank prompt
 */
export async function getRerankPrompt() {
  if (_rerankPrompt) return _rerankPrompt;
  try {
    _rerankPrompt = await loadPrompt("deepsearch/rerank");
    return _rerankPrompt;
  } catch (e) {
    console.warn("[retrieve] Failed to load rerank.md:", e.message);
    return RERANK_PROMPT;
  }
}

const defaultLocalRetriever = (...args) => retrieveWithRouter(...args);

function isObjectLike(v) {
  return v !== null && (typeof v === "object" || typeof v === "function");
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function normalizeIdList(value) {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw.map((x) => String(x || "").trim()).filter(Boolean);
}

function ensureTodos(state) {
  const existing = Array.isArray(state?.todos) ? state.todos : [];
  if (existing.length) return existing;

  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  if (!gaps.length) {
    if (!Array.isArray(state?.todos)) state.todos = [];
    return state.todos;
  }

  const migrated = [];
  for (const gap of gaps) {
    const todo = migratGapToTodo(gap);
    if (todo) migrated.push(todo);
  }
  state.todos = migrated;
  return state.todos;
}

function buildTodoLookup(todos) {
  const todoById = new Map();
  const todoIdByGapId = new Map();
  const gapIdByTodoId = new Map();
  for (const t of Array.isArray(todos) ? todos : []) {
    const todoId = toNonEmptyString(t?.todoId);
    if (!todoId) continue;
    todoById.set(todoId, t);
    const gapId = toNonEmptyString(t?.relatedGapId);
    if (gapId) {
      todoIdByGapId.set(gapId, todoId);
      gapIdByTodoId.set(todoId, gapId);
    }
  }
  return { todoById, todoIdByGapId, gapIdByTodoId };
}

function todoQuestion(todo) {
  return toNonEmptyString(todo?.text) || toNonEmptyString(todo?.question) || toNonEmptyString(todo?.title) || "";
}

function todoNeedsNumericEvidence(todo) {
  const expectedRaw = toNonEmptyString(todo?.expectedEvidence);
  const expected = expectedRaw ? expectedRaw.toLowerCase() : "";
  if (!expected) return false;
  return /data|metric|stat|number|numeric|percent|ratio/.test(expected);
}

function emitInvalidInput(emit, name, payload) {
  emit?.(name, payload, { status: "warning" });
}

function normalizeRetrievalConfig(raw, { emit, logger } = {}) {
  const issues = [];
  const cfg = isPlainObject(raw) ? raw : {};
  const config = { ...cfg };

  if (raw !== undefined && raw !== null && !isPlainObject(raw)) {
    issues.push({ path: "retrieval", issue: "must be an object" });
  }

  const numbers = ["chunkSize", "overlap", "topK", "windowSize", "minGrepHits"];
  for (const k of numbers) {
    if (!(k in cfg)) continue;
    if (!isFiniteNumber(cfg[k])) {
      issues.push({ path: `retrieval.${k}`, issue: "must be a finite number" });
      delete config[k];
    }
  }

  if ("maxChunks" in cfg) {
    const n = safeInt(cfg.maxChunks);
    if (n === null) {
      issues.push({ path: "retrieval.maxChunks", issue: "must be an integer" });
      delete config.maxChunks;
    } else {
      config.maxChunks = n;
    }
  }

  const bools = ["enableToolChain", "useBm25", "useGrep", "grepRegex", "caseSensitive", "includeLineNumbers"];
  for (const k of bools) {
    if (!(k in cfg)) continue;
    if (typeof cfg[k] !== "boolean") {
      issues.push({ path: `retrieval.${k}`, issue: "must be a boolean" });
      delete config[k];
    }
  }

  const objects = ["bm25", "toolChain", "iterative", "shadow"];
  for (const k of objects) {
    if (!(k in cfg)) continue;
    if (!isPlainObject(cfg[k])) {
      issues.push({ path: `retrieval.${k}`, issue: "must be an object" });
      delete config[k];
    }
  }

  if (issues.length) {
    emitInvalidInput(emit, "deepsearch.retrieve.config.invalid", { issues });
    logger?.warn?.("Invalid retrievalConfig; falling back to defaults", { stage: "retrieve", data: { issuesCount: issues.length, issues } });
  }

  return { config, issues };
}

export function deduplicateChunks(newChunks, existingChunks) {
  const existingById = new Map();
  const existingByText = new Map();

  for (const c of Array.isArray(existingChunks) ? existingChunks : []) {
    const chunkId = toNonEmptyString(c?.chunkId);
    if (chunkId) existingById.set(chunkId, c);
    const textKey = typeof c?.text === "string" && c.text ? c.text.slice(0, 200) : null;
    if (textKey) existingByText.set(textKey, c);
  }

  const fresh = [];
  for (const c of Array.isArray(newChunks) ? newChunks : []) {
    const chunkId = toNonEmptyString(c?.chunkId);
    const textKey = typeof c?.text === "string" && c.text ? c.text.slice(0, 200) : null;
    const existingByIdMatch = chunkId ? existingById.get(chunkId) : null;
    const existingByTextMatch = textKey ? existingByText.get(textKey) : null;
    const existing = existingByIdMatch || existingByTextMatch;

    if (existing) {
      const newTodoIds = Array.isArray(c?.matchedTodoIds) ? c.matchedTodoIds : c?.todoId ? [c.todoId] : [];
      const existingTodoIds = Array.isArray(existing.matchedTodoIds) ? existing.matchedTodoIds : [];
      const existingTodoIdsNormalized = existingTodoIds.map(String).filter(Boolean);
      const mergedTodoIds = Array.from(new Set([...existingTodoIdsNormalized, ...newTodoIds.map(String).filter(Boolean)]));

      if (mergedTodoIds.length > existingTodoIdsNormalized.length) {
        existing.matchedTodoIds = mergedTodoIds;
        if (!toNonEmptyString(existing.todoId) && mergedTodoIds.length) existing.todoId = mergedTodoIds[0];
        // 重要：清除 consumed 标记，让 understand 阶段能重新处理
        existing.consumed = false;
      }

      const newGapIds = Array.isArray(c?.matchedGapIds) ? c.matchedGapIds : c?.gapId ? [c.gapId] : [];
      const existingGapIds = Array.isArray(existing.matchedGapIds) ? existing.matchedGapIds : [];
      const existingGapIdsNormalized = existingGapIds.map(String).filter(Boolean);
      const mergedGapIds = Array.from(new Set([...existingGapIdsNormalized, ...newGapIds.map(String).filter(Boolean)]));

      if (mergedGapIds.length > existingGapIdsNormalized.length) {
        existing.matchedGapIds = mergedGapIds;
        if (!toNonEmptyString(existing.gapId) && mergedGapIds.length) existing.gapId = mergedGapIds[0];
        // 重要：清除 consumed 标记，让 understand 阶段能重新处理
        existing.consumed = false;
      }
      continue;
    }

    fresh.push(c);
  }

  return fresh;
}

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch retrieve: input.state is required");
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

function collectSourceTypes(sources) {
  const sourceTypes = new Set();
  for (const src of Array.isArray(sources) ? sources : []) {
    const kind = normalizeDeepSearchSourceKind(src?.kind || src?.type || "unknown");
    sourceTypes.add(kind);
  }
  return sourceTypes;
}

function buildStrategyRouterConfig(baseConfig, strategy) {
  const s = normalizeRetrievalStrategy(strategy);
  const out = { ...(baseConfig && typeof baseConfig === "object" ? baseConfig : {}) };

  if (s === RetrievalStrategy.GREP) {
    out.useGrep = true;
    out.useBm25 = false;
  } else if (s === RetrievalStrategy.BM25) {
    out.useBm25 = true;
  } else if (s === RetrievalStrategy.TOOL_CHAIN) {
    // Keep local router permissive; tool-chain is handled separately as an enhancement/override.
    out.useGrep = true;
    out.useBm25 = true;
  }

  return out;
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

  // LRU eviction rule (stable, single decision):
  // 1) Evict oldest consumed chunks first.
  // 2) If still over capacity, evict oldest remaining chunks.
  // 3) Preserve original order; newer chunks are later in the array.
  const toRemove = new Set();
  for (let i = 0; i < arr.length && toRemove.size < over; i++) {
    if (arr[i] && arr[i].consumed) toRemove.add(i);
  }
  for (let i = 0; i < arr.length && toRemove.size < over; i++) {
    if (!toRemove.has(i)) toRemove.add(i);
  }
  return arr.filter((_, i) => !toRemove.has(i));
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
async function rerankWithLLM(chunks, query, { stageApi, state, emit, topK = 10, timeoutMs = 12000, signal } = {}) {
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

  const controller = new AbortController();
  let timeoutId = null;
  let timedOut = false;
  let abortError = null;
  const externalSignal = signal;

  const abortWithReason = (reason, fallbackMessage) => {
    const err =
      reason instanceof Error
        ? reason
        : new Error(typeof reason === "string" && reason ? reason : fallbackMessage);
    abortError = err;
    controller.abort(err);
  };

  const onExternalAbort = () => abortWithReason(externalSignal?.reason, "Rerank LLM cancelled");

  try {
    if (externalSignal) {
      if (externalSignal.aborted) onExternalAbort();
      else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }

    timeoutId = setTimeout(() => {
      timedOut = true;
      abortWithReason(new Error("Rerank LLM timeout"), "Rerank LLM timeout");
    }, timeoutMs);

    const result = await callModel(
      [{ role: "user", content: prompt }],
      {
        temperature: 0.1,
        maxTokens: 600,
        signal: controller.signal,
      }
    );

    if (timedOut || controller.signal.aborted) {
      if (abortError instanceof Error) throw abortError;
      if (controller.signal.reason instanceof Error) throw controller.signal.reason;
      throw new Error(timedOut ? "Rerank LLM timeout" : "Rerank LLM cancelled");
    }

    const candidate = extractJsonCandidate(result?.content);
    if (!candidate) {
      emit?.("deepsearch.rerank.failed", { reason: "parse_failed", inputCount: inputChunks.length });
      const sorted = [...inputChunks].sort((a, b) => (b.score || 0) - (a.score || 0));
      return {
        ranked: sorted.slice(0, topK),
        stats: { inputCount: inputChunks.length, outputCount: Math.min(topK, inputChunks.length), skipped: true, reason: "parse_failed" },
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      emit?.("deepsearch.rerank.failed", { reason: "parse_failed", inputCount: inputChunks.length });
      const sorted = [...inputChunks].sort((a, b) => (b.score || 0) - (a.score || 0));
      return {
        ranked: sorted.slice(0, topK),
        stats: { inputCount: inputChunks.length, outputCount: Math.min(topK, inputChunks.length), skipped: true, reason: "parse_failed" },
      };
    }
    const rankedIds = Array.isArray(parsed?.ranked) ? parsed.ranked : [];

    // 根据 LLM 返回的排序重排 chunks
    const chunkById = new LRUMap();
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
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
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

// ===== 迭代查询重写 =====
/**
 * 使用 LLM 分析检索结果并生成更好的查询词
 */
async function refineQueryHints(gap, retrievedChunks, stageApi, state) {
  const callModel = getModelCaller(stageApi, { usage: "planner", state });
  if (!callModel) return null;

  const question = gap?.question || gap?.text || "";
  const existingHints = Array.isArray(gap?.queryHints) ? gap.queryHints : [];
  const chunks = (retrievedChunks || []).slice(0, 5).map(c => ({
    text: String(c?.text || "").slice(0, 200),
    score: c?.score
  }));

  const messages = [
    {
      role: "system",
      content:
        "You are a search query optimizer. Analyze the retrieval results and suggest better search keywords.\n\n" +
        "If the results are irrelevant or low quality, suggest 3-5 new keywords that would find more relevant content.\n" +
        "If the results are good, return null.\n\n" +
        "Return ONLY JSON: {shouldRetry:boolean,newHints:string[],reason:string}",
    },
    {
      role: "user",
      content: JSON.stringify({
        question,
        currentHints: existingHints,
        retrievedCount: retrievedChunks?.length || 0,
        sampleResults: chunks,
      }, null, 2),
    },
  ];

  try {
    const result = await callModel(messages, { model: "auto", temperature: 0.2, maxTokens: 400 });
    const candidate = extractJsonCandidate(result?.content);
    if (!candidate) return null;
    const parsed = JSON.parse(candidate);
    if (parsed?.shouldRetry && Array.isArray(parsed?.newHints) && parsed.newHints.length > 0) {
      return parsed.newHints.map(h => String(h).trim()).filter(Boolean);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 迭代检索：检索 → 评估 → 调整查询 → 再检索
 */
async function iterativeRetrieve(gap, sourceIndexes, localRetriever, routerConfig, stageApi, state, emit, maxIterations = 2) {
  const gapId = gap?.gapId || "gap_unknown";
  let allRetrieved = [];
  let currentHints = Array.isArray(gap?.queryHints) ? [...gap.queryHints] : [];

  for (let iter = 0; iter < maxIterations; iter++) {
    const currentGap = { ...gap, queryHints: currentHints };
    const roundRetrieved = [];

    for (const sourceIndex of sourceIndexes) {
      const retrieved = localRetriever(sourceIndex, [currentGap], routerConfig);
      roundRetrieved.push(...retrieved);
    }

    // 合并结果（去重）
    const existingIds = new Set(allRetrieved.map(r => r.chunkId));
    for (const r of roundRetrieved) {
      if (!existingIds.has(r.chunkId)) {
        allRetrieved.push(r);
        existingIds.add(r.chunkId);
      }
    }

    // 第一轮如果结果足够好，直接返回
    if (iter === 0 && roundRetrieved.length >= 3) {
      const avgScore = roundRetrieved.reduce((sum, r) => sum + (r.score || 0), 0) / roundRetrieved.length;
      if (avgScore >= 1.0) {
        // 结果质量好，不需要迭代
        break;
      }
    }

    // 最后一轮不需要再调整
    if (iter >= maxIterations - 1) break;

    // 调用 LLM 分析并生成新的查询词
    const newHints = await refineQueryHints(gap, roundRetrieved, stageApi, state);
    if (!newHints || newHints.length === 0) {
      // LLM 认为结果已经足够好，或无法优化
      break;
    }

    emit?.("deepsearch.retrieve.refine", {
      gapId,
      iteration: iter + 1,
      oldHints: currentHints,
      newHints,
      retrievedCount: roundRetrieved.length,
    });

    currentHints = newHints;
  }

  return allRetrieved;
}
// ===== 迭代查询重写结束 =====

/**
 * S4 Retrieval Router wrapper: TOC-scope -> BM25/grep -> readAround.
 *
 * DI injection points (`stageApi`):
 * - `localRetriever(sourceIndex, todos, routerConfig)`: override local retrieval implementation (defaults to `retrieval-router`).
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
  const safeStageApi = isObjectLike(stageApi) ? stageApi : {};
  if (stageApi !== safeStageApi) {
    console.warn("[DeepSearch] retrieve: invalid stageApi; expected an object", { stageApiType: typeof stageApi });
  }

  stageApi = safeStageApi;
  const { emit: rawEmit, logger: injectedLogger } = extractServices(stageApi);
  const emit = makeStageEmitter(safeStageApi, "deepsearch");
  const state = ensureState(runContext, input);
  const logger =
    injectedLogger && typeof injectedLogger.info === "function"
      ? injectedLogger
      : createLogger({
          emit: rawEmit,
          getContext: () => ({ runId: state.runId, iteration: state.iteration || 0, trajectoryId: state.trajectoryId, stage: "retrieve" }),
        });

  const localRetriever =
    typeof stageApi?.localRetriever === "function"
      ? stageApi.localRetriever
      : stageApi?.localRetriever !== undefined
        ? (emitInvalidInput(emit, "deepsearch.retrieve.input.invalid", { field: "stageApi.localRetriever", issue: "must be a function" }), defaultLocalRetriever)
        : defaultLocalRetriever;

  checkCancelled(stageApi);

  const todosAll = ensureTodos(state);
  const gapsAll = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const openGapsCount = gapsAll.filter((g) => String(g?.status || "open") === "open").length;
  const openTodosRaw = (Array.isArray(todosAll) ? todosAll : []).filter((t) => String(t?.status || "open") === "open");

  // 记录 retrieve 阶段开始
  logger.info("Retrieve stage started", {
    stage: "retrieve",
    data: {
      openTodos: openTodosRaw.length,
      openGaps: openGapsCount,
      existingChunks: Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks.length : 0,
    },
  });

  // 发射阶段开始事件
  emitRetrieveProgress(emit, {
    current: 0,
    total: 1,
    msg: "正在启动检索阶段...",
    detail: { step: "init" },
  });

  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const planningTree = state?.planningTree;
  const selectedStrategy = normalizeRetrievalStrategy(planningTree?.getBestStrategy(sources)) || RetrievalStrategy.BM25;
  const sourceTypes = collectSourceTypes(sources);

  logger.debug?.("Selected retrieval strategy", { stage: "retrieve", data: { strategy: selectedStrategy, sourceTypes: [...sourceTypes] } });

  const { todoById, todoIdByGapId, gapIdByTodoId } = buildTodoLookup(todosAll);
  const gapsById = new Map(gapsAll.map((g) => [String(g?.gapId || ""), g]).filter(([id]) => id));
  const resolveMatchedIds = (row, { todoId, gapId } = {}) => {
    const todoIdsFromRow = normalizeIdList(row?.matchedTodoIds || row?.todoId);
    const gapIdsFromRow = normalizeIdList(row?.matchedGapIds || row?.gapId);

    let matchedTodoIds = todoIdsFromRow;
    if (!matchedTodoIds.length && gapIdsFromRow.length) {
      matchedTodoIds = gapIdsFromRow.map((gid) => todoIdByGapId.get(gid)).filter(Boolean);
    }
    if (!matchedTodoIds.length && todoId) matchedTodoIds = [todoId];
    if (todoId && !matchedTodoIds.includes(todoId)) matchedTodoIds.unshift(todoId);

    let matchedGapIds = gapIdsFromRow;
    if (!matchedGapIds.length && matchedTodoIds.length) {
      matchedGapIds = matchedTodoIds.map((tid) => gapIdByTodoId.get(tid)).filter(Boolean);
    }
    if (!matchedGapIds.length && gapId) matchedGapIds = [gapId];
    if (gapId && !matchedGapIds.includes(gapId)) matchedGapIds.unshift(gapId);

    return { matchedTodoIds, matchedGapIds };
  };
  const todos = [];
  for (let i = 0; i < openTodosRaw.length; i++) {
    const t = openTodosRaw[i];
    const todoId = toNonEmptyString(t?.todoId);
    const gapId = toNonEmptyString(t?.relatedGapId) || todoId || null;
    const relatedGap = gapId ? gapsById.get(String(gapId)) : null;
    const question = toNonEmptyString(relatedGap?.question) || todoQuestion(t);
    const queryHints = Array.isArray(t?.queryHints) && t.queryHints.length
      ? t.queryHints
      : Array.isArray(relatedGap?.queryHints)
        ? relatedGap.queryHints
        : [];
    const hasHint = queryHints.some((h) => Boolean(toNonEmptyString(h)));
    if (!todoId || (!question && !hasHint)) {
      emitInvalidInput(emit, "deepsearch.gap.invalid", {
        stage: "retrieve",
        todoIndex: i,
        todoId: todoId || null,
        gapId: gapId || null,
        issue: !todoId ? "missing_todoId" : "missing_text_and_queryHints",
      });
      continue;
    }
    todos.push({
      ...t,
      todoId,
      gapId: gapId || undefined,
      question,
      queryHints,
    });
  }
  const existingChunks = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];

  const { config: retrievalConfig } = normalizeRetrievalConfig(state?.userConfig?.retrieval, { emit, logger });
  const chunkSize = Number.isFinite(retrievalConfig.chunkSize)
    ? Math.max(200, Math.floor(retrievalConfig.chunkSize))
    : CHUNK_CONFIG.DEFAULT_SIZE;
  const overlap = Number.isFinite(retrievalConfig.overlap)
    ? Math.max(0, Math.floor(retrievalConfig.overlap))
    : CHUNK_CONFIG.DEFAULT_OVERLAP;
  const topK = Number.isFinite(retrievalConfig.topK) ? Math.max(1, Math.floor(retrievalConfig.topK)) : CHUNK_CONFIG.DEFAULT_TOP_K;
  const windowSize = Number.isFinite(retrievalConfig.windowSize)
    ? Math.max(0, Math.floor(retrievalConfig.windowSize))
    : CHUNK_CONFIG.DEFAULT_WINDOW_SIZE;
  const maxChunks = safeInt(retrievalConfig.maxChunks) ?? 100;

  // 工具链配置
  const enableToolChain = retrievalConfig.enableToolChain !== false; // 默认启用
  const toolChainConfig = isPlainObject(retrievalConfig.toolChain) ? retrievalConfig.toolChain : {};

  const routerConfig = {
    topK,
    windowSize,
    useBm25: retrievalConfig.useBm25 !== false,
    useGrep: retrievalConfig.useGrep !== false,
    grepRegex: Boolean(retrievalConfig.grepRegex),
    caseSensitive: Boolean(retrievalConfig.caseSensitive),
    bm25: isPlainObject(retrievalConfig.bm25) ? retrievalConfig.bm25 : {},
    minGrepHits: typeof retrievalConfig.minGrepHits === "number" ? retrievalConfig.minGrepHits : 15,
  };

  const sourceIndexes = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const sourceId = toNonEmptyString(s?.sourceId);
    if (!sourceId) {
      emitInvalidInput(emit, "deepsearch.source.invalid", { stage: "retrieve", sourceIndex: i, issue: "missing_sourceId" });
      continue;
    }

    const fullText = typeof s?.sourceTextNormalized === "string" ? s.sourceTextNormalized : "";
    if (!fullText) {
      emitInvalidInput(emit, "deepsearch.source.invalid", { stage: "retrieve", sourceIndex: i, sourceId, issue: "missing_sourceTextNormalized" });
      continue;
    }

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

  const existingByChunkId = new LRUMap();
  for (const r of existingChunks) {
    const cid = toNonEmptyString(r?.chunkId);
    if (cid) existingByChunkId.set(cid, r);
  }

  // 解析迭代检索配置
  const iterativeConfig = isPlainObject(retrievalConfig.iterative) ? retrievalConfig.iterative : {};
  const enableIterative = iterativeConfig.enabled !== false; // 默认启用
  const maxIterations = safeInt(iterativeConfig.maxIterations) ?? 2;

  const retrievedByChunkId = new LRUMap(); // chunkId -> merged row (without retrievedId)
  const allChunksForToolChain = enableToolChain
    ? sourceIndexes.flatMap((sourceIndex) =>
        (Array.isArray(sourceIndex?.chunks) ? sourceIndex.chunks : []).map((chunk) => ({
          ...chunk,
          sourceId: toNonEmptyString(chunk?.sourceId) || sourceIndex.sourceId,
        }))
      )
    : [];
  const allChunksForToolChainById = new Map(allChunksForToolChain.map((c) => [String(c?.chunkId || ""), c]).filter(([id]) => id));

  const latencyByTodoId = new Map();
  const todoResults = await mapConcurrent(todos, async (t, i) => {
      const todoId = toNonEmptyString(t?.todoId) || `todo_${i + 1}`;
      const gapId = toNonEmptyString(t?.gapId) || toNonEmptyString(t?.relatedGapId) || todoId;
      const requiresNumericEvidence = todoNeedsNumericEvidence(t);

      emitRetrieveProgress(emit, {
        current: i + 1,
        total: todos.length,
        msg: `正在检索 ${todoId} 的证据${t?.question ? `：${String(t.question).slice(0, 80)}` : ""}`,
        detail: {
          todoId,
          gapId,
          priority: toNonEmptyString(t?.priority) || "medium",
          text: toNonEmptyString(t?.text) || toNonEmptyString(t?.question) || "",
        },
      });

      // 获取推荐的检索策略
      const retrievalStartTime = Date.now();

      const routerConfigForGap = buildStrategyRouterConfig(routerConfig, selectedStrategy);
      const shouldForceToolChain = enableToolChain && selectedStrategy === RetrievalStrategy.TOOL_CHAIN;

      const queryHints = Array.isArray(t?.queryHints) ? t.queryHints : [];
      const question = toNonEmptyString(t?.question) || "";
      const keywords = [...queryHints.map((h) => String(h || "").trim()).filter(Boolean), ...question.split(/\s+/).slice(0, 5)];

      const runToolChainForGap = async (reasonTag) => {
        if (!enableToolChain) return null;
        if (keywords.length === 0 || allChunksForToolChain.length === 0) return null;

        try {
          const normalizedToolChainStrategy = normalizeToolChainStrategy(toolChainConfig.strategy) || ToolChainStrategy.AUTO;
          const toolChainResult = await trackToolCall(logger, "toolChainSearch", { gapId, todoId, reason: reasonTag, keywords: keywords.slice(0, 10) }, async () =>
            toolChainSearch(
              allChunksForToolChain,
              {
                strategy: normalizedToolChainStrategy,
                patterns: Array.isArray(toolChainConfig.patterns) ? toolChainConfig.patterns : [],
                keywords: keywords.slice(0, 10),
              },
              {
                globTool: stageApi?.globTool,
                basePath: toolChainConfig.basePath,
                regex: Boolean(routerConfigForGap.grepRegex),
                caseSensitive: Boolean(routerConfigForGap.caseSensitive),
                timeoutMs: toolChainConfig.timeoutMs || 200,
              }
            )
          );

          return toolChainResult;
        } catch (err) {
          emit?.("deepsearch.retrieve.toolchain_error", {
            gapId,
            todoId,
            error: String(err?.message || err),
          });
          return null;
        }
      };

      const appendToolChainResults = (retrieved, toolChainResult) => {
        if (!toolChainResult || !Array.isArray(toolChainResult.results)) return 0;
        let added = 0;
        for (const tcr of toolChainResult.results || []) {
          const chunk = allChunksForToolChainById.get(String(tcr?.chunkId || ""));
          if (!chunk) continue;
          if (retrieved.find((r) => r.chunkId === tcr.chunkId)) continue;

          retrieved.push({
            chunkId: tcr.chunkId,
            sourceId: chunk.sourceId || "source_unknown",
            locator: chunk.locator,
            text: chunk.text,
            score: Math.log(1 + (tcr.matchCount || 0)),
            relevance: "hit",
            matchedTodoIds: [todoId],
            matchedGapIds: [gapId],
            toolChainStrategy: tcr.strategy,
          });
          added++;
        }
        return added;
      };

      // 使用迭代检索
      let retrieved;
      if (shouldForceToolChain) {
        retrieved = [];
        const toolChainResult = await runToolChainForGap("primary");
        if (toolChainResult) {
          appendToolChainResults(retrieved, toolChainResult);
          emit?.("deepsearch.retrieve.toolchain", {
            gapId,
            todoId,
            strategy: toolChainResult.strategy,
            hits: toolChainResult.results?.length || 0,
            stats: toolChainResult.stats,
            fallbackReason: toolChainResult.fallbackReason,
          });
        }
      }

      if (enableIterative && maxIterations > 1) {
        const iterativeOut = await trackToolCall(logger, "iterativeRetrieve", { gapId, todoId, maxIterations }, async () =>
          iterativeRetrieve({ ...t, gapId, todoId }, sourceIndexes, localRetriever, routerConfigForGap, stageApi, state, emit, maxIterations)
        );
        retrieved = Array.isArray(retrieved) ? retrieved : [];
        retrieved.push(...(Array.isArray(iterativeOut) ? iterativeOut : []));
      } else {
        // 单次检索（向后兼容）
        retrieved = Array.isArray(retrieved) ? retrieved : [];
        for (const sourceIndex of sourceIndexes) {
          const result = await trackToolCall(logger, "localRetriever", { gapId, todoId, sourceId: sourceIndex.sourceId }, async () =>
            localRetriever(sourceIndex, [{ ...t, gapId, todoId }], routerConfigForGap)
          );
          retrieved.push(...result);
        }
      }

      // 工具链增强：如果 enableToolChain=true 且检索结果不足，使用工具链补充
      if (enableToolChain && retrieved.length < topK) {
        const toolChainResult = await runToolChainForGap("fallback");
        if (toolChainResult) {
          appendToolChainResults(retrieved, toolChainResult);
          emit?.("deepsearch.retrieve.toolchain", {
            gapId,
            todoId,
            strategy: toolChainResult.strategy,
            hits: toolChainResult.results?.length || 0,
            stats: toolChainResult.stats,
            fallbackReason: toolChainResult.fallbackReason,
          });
        }
      }

      // 记录检索策略结果（包含 tool-chain 增强在内的整体耗时）
      const retrievalLatency = Date.now() - retrievalStartTime;
      latencyByTodoId.set(todoId, retrievalLatency);
      if (planningTree) {
        const uniqueHits = new Set(retrieved.map((r) => String(r?.chunkId || "")).filter(Boolean)).size;
        planningTree.recordStrategyResult(selectedStrategy, {
          hits: uniqueHits,
          latency: retrievalLatency,
        });

        emit?.("deepsearch.retrieve.strategy", {
          gapId,
          todoId,
          strategy: selectedStrategy,
          hits: uniqueHits,
          latency: retrievalLatency,
          hitRate: planningTree.getStrategyHitRate(selectedStrategy),
        });
      }

      return { todoId, gapId, requiresNumericEvidence, retrieved, todo: t };
  });

  for (const { todoId, gapId, requiresNumericEvidence, retrieved } of todoResults) {
    for (const r of retrieved) {
      // Heuristic: data/metrics todos should be supported by numeric evidence; avoid
      // attributing non-numeric chunks to data todos to prevent false "hits" and fills.
      if (requiresNumericEvidence) {
        const text = typeof r?.text === "string" ? r.text : "";
        if (!/[0-9]/.test(text)) continue;
      }

      const chunkId = String(r?.chunkId || "");
      if (!chunkId) continue;

      const { matchedTodoIds, matchedGapIds } = resolveMatchedIds(r, { todoId, gapId });

      const existing = retrievedByChunkId.get(chunkId);
      if (!existing) {
        retrievedByChunkId.set(chunkId, {
          chunkId,
          sourceId: String(r?.sourceId || "source_unknown"),
          locator: r?.locator,
          text: String(r?.text || ""),
          ...(typeof r?.score === "number" && Number.isFinite(r.score) ? { score: r.score } : {}),
          ...(toNonEmptyString(r?.relevance) ? { relevance: String(r.relevance) } : {}),
          matchedTodoIds: matchedTodoIds.slice(),
          todoId: matchedTodoIds[0],
          matchedGapIds: matchedGapIds.slice(),
          gapId: matchedGapIds[0],
        });
        continue;
      }

      const mergedTodoIds = Array.from(new Set([...(Array.isArray(existing.matchedTodoIds) ? existing.matchedTodoIds : []), ...matchedTodoIds]));
      if (mergedTodoIds.length) {
        existing.matchedTodoIds = mergedTodoIds;
        existing.todoId = existing.todoId || mergedTodoIds[0];
      }

      const mergedGapIds = Array.from(new Set([...(Array.isArray(existing.matchedGapIds) ? existing.matchedGapIds : []), ...matchedGapIds]));
      if (mergedGapIds.length) {
        existing.matchedGapIds = mergedGapIds;
        existing.gapId = existing.gapId || mergedGapIds[0];
      }
      if (
        (existing.sourceId === "source_unknown" || !toNonEmptyString(existing.sourceId)) &&
        toNonEmptyString(r?.sourceId) &&
        String(r.sourceId) !== "source_unknown"
      ) {
        existing.sourceId = String(r.sourceId);
      }
      if (typeof r?.score === "number" && Number.isFinite(r.score) && (!(typeof existing.score === "number") || r.score > existing.score)) {
        existing.score = r.score;
      }
      if (toNonEmptyString(r?.relevance) && !toNonEmptyString(existing.relevance)) existing.relevance = String(r.relevance);
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
    // 构建 rerank 查询：合并所有 todo 的问题
    const rerankQuery = todos
      .map((t) => toNonEmptyString(t?.question) || toNonEmptyString(t?.text) || "")
      .filter(Boolean)
      .slice(0, 3)
      .join("; ");

    if (rerankQuery) {
      emitRetrieveProgress(emit, {
        current: todos.length,
        total: todos.length,
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

  // ===== Shadow Agent 验证 =====
  const shadowConfig = isPlainObject(state?.userConfig?.retrieval?.shadow) ? state.userConfig.retrieval.shadow : {};
  const enableShadow = shadowConfig.enabled === true; // 默认关闭，需显式启用
  let shadowStats = null;

  if (enableShadow && rerankedChunks.length > 0) {
    const shadowAgent = new ShadowAgent(stageApi, state, shadowConfig);
    const iteration = safeInt(state?.iteration) ?? 0;
    const targetsByTodoId = new Map(todos.map((t) => [String(t?.todoId || ""), t]).filter(([id]) => id));

    emitRetrieveProgress(emit, {
      current: todos.length,
      total: todos.length,
      msg: `正在验证灰色地带 chunks...`,
      detail: { step: "shadow_validation", chunkCount: rerankedChunks.length },
    });

    // 并行验证（但受预算控制）
    const validationPromises = rerankedChunks.map(async (chunk) => {
      const chunkTodoId = toNonEmptyString(chunk?.todoId) || normalizeIdList(chunk?.matchedTodoIds || [])[0];
      const resolvedTodoId = chunkTodoId || todoIdByGapId.get(toNonEmptyString(chunk?.gapId) || "");
      const todo = resolvedTodoId ? targetsByTodoId.get(resolvedTodoId) || todoById.get(resolvedTodoId) : null;

      const decision = shouldValidateWithShadow(chunk, todo, shadowConfig);
      if (!decision.shouldValidate) {
        return { chunk, validated: false, reason: decision.reason };
      }

      const verdict = await shadowAgent.validateRelevance(chunk, todo, { round: iteration });
      if (verdict.skipped) {
        return { chunk, validated: false, reason: verdict.reason };
      }

      // 根据验证结果调整 chunk
      return {
        chunk,
        validated: true,
        verdict,
      };
    });

    const validationResults = await Promise.all(validationPromises);

    // 更新 chunk metadata
    for (const result of validationResults) {
      if (!result.validated || !result.verdict) continue;

      const { chunk, verdict } = result;
      // 添加 shadow 验证结果
      chunk.shadowValidated = true;
      chunk.shadowRelevant = verdict.relevant;
      chunk.shadowConfidence = verdict.confidence;
      if (verdict.keyInfo) {
        chunk.shadowKeyInfo = verdict.keyInfo;
      }

      // 调整 score：如果验证确认相关，提升置信度；否则降低
      if (typeof chunk.score === "number") {
        if (verdict.relevant && verdict.confidence >= 0.7) {
          chunk.score = Math.min(10, chunk.score * 1.3); // 提升 30%
        } else if (!verdict.relevant && verdict.confidence >= 0.7) {
          chunk.score = chunk.score * 0.5; // 降低 50%
        }
      }
    }

    shadowStats = shadowAgent.getStats();
    const validatedCount = validationResults.filter(r => r.validated).length;
    const confirmedRelevant = validationResults.filter(r => r.verdict?.relevant).length;

    emit?.("deepsearch.shadow.completed", {
      totalChunks: rerankedChunks.length,
      validated: validatedCount,
      confirmedRelevant,
      stats: shadowStats,
    });

    logger.info("Shadow validation completed", { stage: "retrieve", data: { validated: validatedCount, confirmedRelevant, stats: shadowStats } });
  }
  // ===== Shadow Agent 验证结束 =====

  // 记录每个 todo 的检索决策（基于最终进入 understand 的 chunks）
  if (planningTree && todos.length > 0) {
    const hitsByTodoId = new Map();
    for (const c of Array.isArray(rerankedChunks) ? rerankedChunks : []) {
      const matchedTodoIds = normalizeIdList(c?.matchedTodoIds || c?.todoId);
      let todoIds = matchedTodoIds;
      if (!todoIds.length) {
        const gapIds = normalizeIdList(c?.matchedGapIds || c?.gapId);
        todoIds = gapIds.map((gid) => todoIdByGapId.get(gid)).filter(Boolean);
      }
      for (const tid of todoIds) hitsByTodoId.set(tid, (hitsByTodoId.get(tid) || 0) + 1);
    }

    for (const todo of todos) {
      const todoId = toNonEmptyString(todo?.todoId);
      if (!todoId) continue;
      const relatedGapId = toNonEmptyString(todo?.gapId) || toNonEmptyString(todo?.relatedGapId);
      const nodes =
        typeof planningTree.getNodesForTodo === "function"
          ? planningTree.getNodesForTodo(todoId, { relatedGapId }) || []
          : [];
      const fallbackNodes =
        !nodes.length && relatedGapId && typeof planningTree.getNodesForGap === "function"
          ? planningTree.getNodesForGap(relatedGapId) || []
          : [];
      const nodeId = (nodes[0] || fallbackNodes[0])?.nodeId;
      if (!nodeId) continue;

      const hits = hitsByTodoId.get(todoId) || 0;
      const latency = latencyByTodoId.get(todoId);
      planningTree.recordDecision(nodeId, {
        stage: DecisionStage.RETRIEVE,
        action: `${selectedStrategy} search`,
        reason: `Todo: ${String(todo?.text || todo?.question || "").slice(0, 50)}`,
        outcome: hits > 0 ? DecisionOutcome.SUCCESS : DecisionOutcome.FAIL,
        metrics: { hits, todoId, gapId: relatedGapId, strategy: selectedStrategy, ...(typeof latency === "number" ? { latency } : {}) },
      });
    }
  }

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
    const existingTodoIds = Array.isArray(existing.matchedTodoIds) ? existing.matchedTodoIds.map(String).filter(Boolean) : [];
    const incomingTodoIds = Array.isArray(r.matchedTodoIds) ? r.matchedTodoIds.map(String).filter(Boolean) : [];
    const mergedTodoIds = Array.from(new Set([...existingTodoIds, ...incomingTodoIds])).filter(Boolean);
    if (mergedTodoIds.length) existing.matchedTodoIds = mergedTodoIds;
    if (!toNonEmptyString(existing.todoId) && toNonEmptyString(r.todoId)) existing.todoId = String(r.todoId);
    if (mergedTodoIds.length) existing.todoId = existing.todoId || mergedTodoIds[0];
    const existingGapIds = Array.isArray(existing.matchedGapIds) ? existing.matchedGapIds.map(String).filter(Boolean) : [];
    const incomingGapIds = Array.isArray(r.matchedGapIds) ? r.matchedGapIds.map(String).filter(Boolean) : [];
    const mergedGapIds = Array.from(new Set([...existingGapIds, ...incomingGapIds])).filter(Boolean);
    if (mergedGapIds.length) existing.matchedGapIds = mergedGapIds;
    if (!toNonEmptyString(existing.gapId) && toNonEmptyString(r.gapId)) existing.gapId = String(r.gapId);
    if (mergedGapIds.length) existing.gapId = existing.gapId || mergedGapIds[0];
    if (mergedGapIds.length > existingGapIds.length) existing.consumed = false;
    if (typeof r?.score === "number" && Number.isFinite(r.score) && (!(typeof existing.score === "number") || r.score > existing.score)) existing.score = r.score;
    if (toNonEmptyString(r?.relevance) && !toNonEmptyString(existing.relevance)) existing.relevance = String(r.relevance);
  }

  const dedupedFresh = deduplicateChunks(rerankedChunks, existingChunks);
  // `retrievedChunkIdsSeen` 仅用于日志统计，不用于过滤新增 chunks
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
      todoId: c.todoId,
      matchedTodoIds: c.matchedTodoIds,
      gapId: c.gapId,
      matchedGapIds: c.matchedGapIds,
      score: c.score,
      isExternal: c.isExternal,
      addedSeq: c.addedSeq,
    })),
    evictedChunkIds: evictedIds || [],
  });

  state.L2.retrievedChunks = trimmed;
  const seenCap = Math.min(CHUNK_CONFIG.MAX_CHUNKS_LRU, Math.max(1000, maxChunks * 50));
  trackSeenChunkIds(
    state,
    [...existingChunks, ...rerankedChunks].map((c) => toNonEmptyString(c?.chunkId)).filter(Boolean),
    { maxSize: seenCap }
  );

  // 记录 retrieve 阶段完成
  logger.info("Retrieve stage completed", {
    stage: "retrieve",
    data: {
      retrievedCount: dedupedFresh.length,
      retrievedBeforeDedupe: roundChunks.length,
      totalRetrieved: trimmed.length,
      evictedCount,
      maxChunks,
      todoCount: todos.length,
      totalTodos: todosAll.length,
      gapCount: openGapsCount,
      totalGaps: gapsAll.length,
      usedRerank: rerankConfig.enabled && rerankStats && !rerankStats.skipped,
      rerankStats: rerankStats || undefined,
    },
  });

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
      todoCount: todos.length,
      totalTodos: todosAll.length,
      gapCount: openGapsCount,
      totalGaps: gapsAll.length,
      ...(rerankStats ? { rerank: rerankStats } : {}),
      ...(shadowStats ? { shadow: shadowStats } : {}),
    },
  });

  emit?.("deepsearch.retrieve.completed", {
    retrievedCount: dedupedFresh.length,
    retrievedBeforeDedupe: roundChunks.length,
    totalRetrieved: trimmed.length,
    evictedCount,
    maxChunks,
    todoCount: todos.length,
    totalTodos: todosAll.length,
    gapCount: openGapsCount,
    totalGaps: gapsAll.length,
    externalSearchTriggered,
    externalChunksCount: externalChunks.length,
    ...(rerankStats ? { rerank: rerankStats } : {}),
    ...(shadowStats ? { shadow: shadowStats } : {}),
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
  rerankWithLLM,
  parseExternalSearchConfig,
  createMcpClient,
  runExternalSearch,
};
