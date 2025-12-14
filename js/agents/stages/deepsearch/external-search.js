/**
 * DeepSearch external search integration.
 *
 * Implements an MCP-backed search/fetch pipeline and converts external documents into DeepSearch chunks.
 * The actual network behavior is controlled via user config and injectable providers.
 */
import { checkCancelled } from "./state.js";
import { chunkText } from "../textprep/chunk.js";
import { McpClient } from "../../mcp/mcp-client.js";
import { LocalMcpProvider } from "../../mcp/local-mcp-provider.js";
import { McpNexusProvider } from "../../mcp/mcp-nexus-provider.js";

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

function deduplicateChunks(newChunks, existingChunks) {
  const existingIds = new Set((Array.isArray(existingChunks) ? existingChunks : []).map((c) => c?.chunkId));
  const existingTexts = new Set((Array.isArray(existingChunks) ? existingChunks : []).map((c) => c?.text?.slice(0, 200)));
  return (Array.isArray(newChunks) ? newChunks : []).filter((c) => !existingIds.has(c?.chunkId) && !existingTexts.has(c?.text?.slice(0, 200)));
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

/**
 * Parses `userConfig.externalSearch` into a normalized config object.
 * @param {object} userConfig
 * @returns {{
 *   enabled: boolean,
 *   autoTrigger: boolean,
 *   minLocalHits: number,
 *   maxExternalResults: number,
 *   providers: string[],
 *   domain?: string,
 *   timeRange?: string,
 *   nexusEndpoint?: string,
 *   authToken?: string,
 *   headers?: Record<string,string>
 * }}
 */
export function parseExternalSearchConfig(userConfig) {
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
 * @param {ReturnType<parseExternalSearchConfig>} config
 * @param {{customProviders?: Record<string, any>}=} options
 * @returns {McpClient}
 */
export function createMcpClient(config, { customProviders } = {}) {
  const custom = isPlainObject(customProviders) ? customProviders : {};
  const providers = Array.isArray(config.providers) ? config.providers : ["local-mcp"];

  const mcpClient = new McpClient();

  for (const id of providers) {
    const pid = toNonEmptyString(id);
    if (!pid) continue;

    if (custom[pid]) {
      mcpClient.addProvider(custom[pid]);
      continue;
    }

    if (pid === "local-mcp" || pid === "local") {
      mcpClient.addProvider(new LocalMcpProvider({ id: "local-mcp" }));
      continue;
    }

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

function createDefaultMcpProvider(config) {
  let mcpClient = null;

  const ensureClient = (ctx) => {
    if (mcpClient) return mcpClient;
    mcpClient = createMcpClient(config, { customProviders: ctx?.state?.userConfig?.externalSearch?.customProviders });
    return mcpClient;
  };

  return {
    listProviders: (ctx) => {
      const client = ensureClient(ctx);
      return typeof client.listProviders === "function" ? client.listProviders() : [];
    },
    search: (params, options, ctx) => ensureClient(ctx).search(params, options),
    fetch: (params, options, ctx) => ensureClient(ctx).fetch(params, options),
  };
}

/**
 * 执行外部搜索并转换结果为 chunks（使用 MCP 协议）
 * @param {Array} gaps
 * @param {ReturnType<parseExternalSearchConfig>} config
 * @param {{emit?:Function,state?:object,stageApi?:object}=} options
 * @returns {Promise<{chunks:Array,documents:Array,evidences:Array}>}
 */
export async function runExternalSearch(gaps, config, { emit, state, stageApi } = {}) {
  const provider = stageApi?.externalSearchProvider ?? createDefaultMcpProvider(config);
  const availableProviders = typeof provider.listProviders === "function" ? provider.listProviders({ config, state, stageApi }) : [];
  if (availableProviders.length === 0) {
    emit?.("deepsearch.external.skipped", { reason: "no_providers" });
    return { chunks: [], documents: [], evidences: [] };
  }

  const enabled = Boolean(config?.enabled);
  if (!enabled) {
    emit?.("deepsearch.external.skipped", { reason: "disabled" });
    return { chunks: [], documents: [], evidences: [] };
  }

  emit?.("deepsearch.external.started", { providerCount: availableProviders.length, gapCount: gaps.length, providers: availableProviders });

  const chunks = [];
  const documents = [];
  const evidences = [];
  let searchSeq = 0;

  try {
    checkCancelled(stageApi);

    const queries = [];
    for (const g of Array.isArray(gaps) ? gaps : []) {
      const query = toNonEmptyString(g?.query) || toNonEmptyString(g?.question) || toNonEmptyString(g?.text);
      if (query) queries.push({ query, gapId: g?.gapId });
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

    let providerCursor = 0;
    for (const { query, gapId } of queries) {
      checkCancelled(stageApi);

      const providers = availableProviders.length ? availableProviders : ["local-mcp"];
      let searchResult = null;
      let usedProviderId = null;

      for (let attempt = 0; attempt < providers.length; attempt++) {
        const pid = providers[(providerCursor + attempt) % providers.length];
        const r = await provider.search(
          { query, domain: config.domain, timeRange: config.timeRange, limit: config.maxExternalResults || 5 },
          { providerId: pid },
          { config, state, stageApi }
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

      const jsonContent = searchResult.content.find((c) => c?.type === "json");
      const results = jsonContent?.data?.results || [];
      const topResults = results.slice(0, Math.min(3, config.maxExternalResults || 3));

      for (const result of topResults) {
        checkCancelled(stageApi);

        const url = toNonEmptyString(result?.url);
        if (!url) continue;

        let fetchResult = await provider.fetch({ url }, { providerId: usedProviderId || undefined }, { config, state, stageApi });
        if (!fetchResult?.success) {
          for (const pid of providers) {
            if (pid === usedProviderId) continue;
            fetchResult = await provider.fetch({ url }, { providerId: pid }, { config, state, stageApi });
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

        const metaContent = fetchResult.content.find((c) => c?.type === "json");
        const metadata = metaContent?.data?.metadata || {};
        const title = metadata.title || result.title || url;

        if (!text || text.length < 50) {
          console.warn(`[MCP Fetch] Content too short for URL "${url}"`);
          continue;
        }

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

        if (!Array.isArray(state?.L0?.sources)) state.L0.sources = [];
        const existingSourceIds = new Set(state.L0.sources.map((s) => s?.sourceId));
        if (!existingSourceIds.has(sourceId)) state.L0.sources.push(externalSource);

        documents.push(externalSource);

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

      trackSeenChunkIds(state, [...existingChunks, ...chunks].map((c) => toNonEmptyString(c?.chunkId)).filter(Boolean), { maxSize: Math.max(1000, maxChunks * 50) });
    }

    emit?.("deepsearch.external.progress", {
      phase: "retrieve",
      step: "mcp_search_complete",
      msg: `MCP 搜索完成：找到 ${documents.length} 个外部资源`,
      detail: { documentsCount: documents.length, chunksCount: chunks.length, evidencesCount: evidences.length },
    });

    emit?.("deepsearch.external.completed", { chunksCount: chunks.length, documentsCount: documents.length, evidencesCount: evidences.length });

    state.addTimeline?.({
      name: "deepsearch.external",
      status: "completed",
      payload: { chunksCount: chunks.length, documentsCount: documents.length, evidencesCount: evidences.length, providers: availableProviders, protocol: "mcp" },
    });

    return { chunks, documents, evidences };
  } catch (err) {
    emit?.("deepsearch.external.error", { message: String(err?.message || err) });
    state.addTimeline?.({ name: "deepsearch.external", status: "error", payload: { message: String(err?.message || err) } });
    return { chunks: [], documents: [], evidences: [] };
  }
}
