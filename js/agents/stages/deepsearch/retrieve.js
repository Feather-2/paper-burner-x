import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";
import { chunkText } from "../textprep/chunk.js";
import { retrieve as retrieveWithRouter } from "../../retrieval/retrieval-router.js";
import { McpClient } from "../../mcp/mcp-client.js";
import { LocalMcpProvider } from "../../mcp/local-mcp-provider.js";
import { McpNexusProvider } from "../../mcp/mcp-nexus-provider.js";

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
 * 解析外搜配置
 */
function parseExternalSearchConfig(userConfig) {
  const cfg = isPlainObject(userConfig?.externalSearch) ? userConfig.externalSearch : {};
  const headersRaw = isPlainObject(cfg.headers) ? cfg.headers : null;
  const headers = headersRaw
    ? Object.fromEntries(
        Object.entries(headersRaw)
          .map(([k, v]) => [String(k), v === undefined || v === null ? "" : String(v)])
          .filter(([k, v]) => k && v)
      )
    : undefined;
  return {
    enabled: cfg.enabled === true, // 默认关闭（显式开启才会进行外部网络调用）
    autoTrigger: cfg.autoTrigger === true, // 默认关闭（显式开启才自动触发）
    minLocalHits: safeInt(cfg.minLocalHits) ?? 3, // 预留：阈值触发策略
    maxExternalResults: safeInt(cfg.maxExternalResults) ?? 5,
    providers: Array.isArray(cfg.providers) ? cfg.providers : [],
    domain: toNonEmptyString(cfg.domain),
    timeRange: toNonEmptyString(cfg.timeRange),
    nexusEndpoint: toNonEmptyString(cfg.nexusEndpoint || cfg.endpoint),
    authToken: toNonEmptyString(cfg.authToken),
    headers,
  };
}

/**
 * 创建 MCP 客户端实例
 * 支持 local-mcp（内置）和 mcp-nexus（外部）两种端点
 */
function createMcpClient(config, { customProviders } = {}) {
  const custom = isPlainObject(customProviders) ? customProviders : {};
  const providers = Array.isArray(config.providers) ? config.providers : ["local-mcp"];

  const mcpClient = new McpClient();

  for (const id of providers) {
    const pid = toNonEmptyString(id);
    if (!pid) continue;

    // 检查是否有自定义 provider
    if (custom[pid]) {
      mcpClient.addProvider(custom[pid]);
      continue;
    }

    // 内置 local-mcp provider
    if (pid === "local-mcp" || pid === "local") {
      mcpClient.addProvider(new LocalMcpProvider({ id: "local-mcp" }));
      continue;
    }

    // mcp-nexus provider（pb-mcpgateway）
    if (pid === "mcp-nexus" || pid === "nexus" || pid === "mcpgateway") {
      const endpoint = toNonEmptyString(config.nexusEndpoint);
      if (!endpoint) {
        console.warn("[MCP] mcp-nexus provider requested but config.nexusEndpoint is missing; skipping");
        continue;
      }
      mcpClient.addProvider(
        new McpNexusProvider({
          id: "mcp-nexus",
          endpoint,
          ...(toNonEmptyString(config.authToken) ? { authToken: config.authToken } : {}),
          ...(isPlainObject(config.headers) ? { headers: config.headers } : {}),
        })
      );
      continue;
    }

    console.warn(`[MCP] Unknown provider: ${pid}, skipping`);
  }

  return mcpClient;
}

/**
 * 执行外部搜索并转换结果为 chunks（使用 MCP 协议）
 */
async function runExternalSearch(gaps, config, { emit, state, stageApi } = {}) {
  const mcpClient = createMcpClient(config, {
    customProviders: state?.userConfig?.externalSearch?.customProviders
  });

  // 检查是否有可用的 provider
  const availableProviders = typeof mcpClient.listProviders === "function" ? mcpClient.listProviders() : [];
  if (availableProviders.length === 0) {
    emit?.("deepsearch.external.skipped", { reason: "no_providers" });
    return { chunks: [], documents: [], evidences: [] };
  }

  const enabled = Boolean(config?.enabled);
  if (!enabled) {
    emit?.("deepsearch.external.skipped", { reason: "disabled" });
    return { chunks: [], documents: [], evidences: [] };
  }

  emit?.("deepsearch.external.started", {
    providerCount: availableProviders.length,
    gapCount: gaps.length,
    providers: availableProviders,
  });

  const chunks = [];
  const documents = [];
  const evidences = [];
  let searchSeq = 0;

  try {
    checkCancelled(stageApi);

    // 从 gaps 生成搜索查询
    const queries = [];
    for (const g of Array.isArray(gaps) ? gaps : []) {
      const query = toNonEmptyString(g?.query) || toNonEmptyString(g?.question) || toNonEmptyString(g?.text);
      if (query) {
        queries.push({ query, gapId: g?.gapId });
      }
    }

    if (queries.length === 0) {
      emit?.("deepsearch.external.skipped", { reason: "no_queries" });
      return { chunks: [], documents: [], evidences: [] };
    }

    emit?.("deepsearch.external.progress", {
      phase: "retrieve",
      step: "mcp_search_start",
      msg: `开始 MCP 搜索：${queries.length} 个查询`,
      detail: { queriesCount: queries.length, providers: availableProviders },
    });

    // 执行搜索
    let providerCursor = 0;
    for (const { query, gapId } of queries) {
      checkCancelled(stageApi);

      const providers = availableProviders.length ? availableProviders : ["local-mcp"];
      let searchResult = null;
      let usedProviderId = null;

      // 简单轮询 provider；遇到失败尝试下一个。
      for (let attempt = 0; attempt < providers.length; attempt++) {
        const pid = providers[(providerCursor + attempt) % providers.length];
        const r = await mcpClient.search(
          { query, domain: config.domain, timeRange: config.timeRange, limit: config.maxExternalResults || 5 },
          { providerId: pid }
        );
        if (r && r.success) {
          searchResult = r;
          usedProviderId = pid;
          providerCursor = (providerCursor + attempt + 1) % providers.length;
          break;
        }
      }

      if (!searchResult || !searchResult.success) {
        console.warn(`[MCP Search] Failed for query "${query}":`, searchResult?.error);
        continue;
      }

      // 解析搜索结果 JSON
      const jsonContent = searchResult.content.find(c => c?.type === "json");
      const results = jsonContent?.data?.results || [];

      // 获取 top K 结果的内容
      const topResults = results.slice(0, Math.min(3, config.maxExternalResults || 3));

      for (const result of topResults) {
        checkCancelled(stageApi);

        const url = toNonEmptyString(result?.url);
        if (!url) continue;

        // 使用 MCP fetch_content 获取页面内容
        let fetchResult = await mcpClient.fetch({ url }, { providerId: usedProviderId || undefined });
        if (!fetchResult?.success) {
          // 兜底：如果 provider 失败，尝试其他 provider
          for (const pid of providers) {
            if (pid === usedProviderId) continue;
            fetchResult = await mcpClient.fetch({ url }, { providerId: pid });
            if (fetchResult?.success) break;
          }
        }

        if (!fetchResult || !fetchResult.success) {
          console.warn(`[MCP Fetch] Failed for URL "${url}":`, fetchResult.error);
          continue;
        }

        searchSeq++;
        const sourceId = `ext_mcp_${searchSeq}_${Date.now().toString(36)}`;
        const text = fetchResult.getText();
        const fetchedAt = new Date().toISOString();

        // 提取 metadata
        const metaContent = fetchResult.content.find(c => c?.type === "json");
        const metadata = metaContent?.data?.metadata || {};
        const title = metadata.title || result.title || url;

        if (!text || text.length < 50) {
          console.warn(`[MCP Fetch] Content too short for URL "${url}"`);
          continue;
        }

        // 创建外部 source
        const externalSource = {
          sourceId,
          kind: "external_url",
          uri: url,
          title,
          sourceTextNormalized: text,
          fetchedAt,
          providerId: usedProviderId || "unknown",
          metadata,
          query,
          gapId,
        };

        // 添加到 L0.sources
        if (!Array.isArray(state?.L0?.sources)) state.L0.sources = [];
        const existingSourceIds = new Set(state.L0.sources.map(s => s?.sourceId));
        if (!existingSourceIds.has(sourceId)) {
          state.L0.sources.push(externalSource);
        }

        documents.push(externalSource);

        // 切分为 chunks，并注入到检索工作集（L2.retrievedChunks）
        const docChunks = chunkText(text, { chunkSize: 1600, overlap: 180 });
        for (let i = 0; i < docChunks.length; i++) {
          const c = docChunks[i];
          const chunkId = `${sourceId}::chunk_${i + 1}`;
          chunks.push({
            retrievedId: `rch_ext_${chunks.length + 1}`,
            chunkId,
            sourceId,
            text: c.text,
            locator: c.locator,
            isExternal: true,
            externalUrl: url,
            externalTitle: title,
            gapId,
            matchedGapIds: [String(gapId || "")].filter(Boolean),
          });
        }
      }
    }

    // 将外搜 chunks 合并进 L2.retrievedChunks，让 Understand 能消费它们。
    if (state && typeof state === "object") {
      if (!isPlainObject(state.L2)) state.L2 = {};
      const existingChunks = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
      const deduped = deduplicateChunks(chunks, existingChunks);
      const seenChunkIds = new Set(normalizeChunkIdList(state?.L2?.retrievedChunkIdsSeen));
      const dedupedFresh = deduped.filter((c) => !seenChunkIds.has(String(c?.chunkId || "")));

      const now = new Date().toISOString();
      ensureAddedMeta(existingChunks, { now, startSeq: 1 });
      const startSeq = nextAddedSeq(existingChunks);
      ensureAddedMeta(dedupedFresh, { now, startSeq });

      const maxChunks = safeInt(state?.userConfig?.retrieval?.maxChunks) ?? 100;
      const combined = [...existingChunks, ...dedupedFresh];
      const trimmed = applyChunkLru(combined, { maxChunks });
      state.L2.retrievedChunks = trimmed;

      trackSeenChunkIds(
        state,
        [...existingChunks, ...chunks].map((c) => toNonEmptyString(c?.chunkId)).filter(Boolean),
        { maxSize: Math.max(1000, maxChunks * 50) }
      );
    }

    emit?.("deepsearch.external.progress", {
      phase: "retrieve",
      step: "mcp_search_complete",
      msg: `MCP 搜索完成：找到 ${documents.length} 个外部资源`,
      detail: {
        documentsCount: documents.length,
        chunksCount: chunks.length,
        evidencesCount: evidences.length,
      },
    });

    emit?.("deepsearch.external.completed", {
      chunksCount: chunks.length,
      documentsCount: documents.length,
      evidencesCount: evidences.length,
    });

    state.addTimeline?.({
      name: "deepsearch.external",
      status: "completed",
      payload: {
        chunksCount: chunks.length,
        documentsCount: documents.length,
        evidencesCount: evidences.length,
        providers: availableProviders,
        protocol: "mcp",
      },
    });

    return { chunks, documents, evidences };

  } catch (err) {
    emit?.("deepsearch.external.error", {
      message: String(err?.message || err),
    });
    state.addTimeline?.({
      name: "deepsearch.external",
      status: "error",
      payload: { message: String(err?.message || err) },
    });
    return { chunks: [], documents: [], evidences: [] };
  }
}

/**
 * S4 Retrieval Router wrapper: TOC-scope -> BM25/grep -> readAround.
 * @param {object} runContext
 * @param {DeepSearchState|{state:DeepSearchState|object}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function}=} stageApi
 */
export async function runDeepSearchRetrieveStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);

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

    emitRetrieveProgress(emit, {
      current: i + 1,
      total: gaps.length,
      msg: `正在检索 ${gapId} 的证据${g?.question ? `：${String(g.question).slice(0, 80)}` : ""}`,
      detail: { gapId, type: toNonEmptyString(g?.type) || "unknown", priority: toNonEmptyString(g?.priority) || "medium", question: toNonEmptyString(g?.question) || "" },
    });

    for (const sourceIndex of sourceIndexes) {
      const retrieved = retrieveWithRouter(sourceIndex, [{ ...g, gapId }], routerConfig);
      for (const r of retrieved) {
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
