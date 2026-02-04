import { isPlainObject, toNonEmptyString } from "../../../shared/index.js";
import { estimateTokensCached } from "../../../shared/index.js";
import { robustParseJson } from "../../../shared/index.js";
import { CicadaEvents } from "../../../runtime/events/events.js";
import { makeSecureTimestampedId } from "../../../shared/index.js";
import { createLogger } from "../../../shared/index.js";

const logger = createLogger("runtime/compression/cicada-compressor");

/**
 * @typedef {{ role?: string, content?: unknown }} CicadaMessage
 * @typedef {Record<string, unknown>} CicadaArchiveEntry
 * @typedef {Object} CicadaModelRouter
 * @property {(payloadOrMessages: unknown, options?: unknown) => Promise<unknown>} [call]
 * @property {(messages: Array<CicadaMessage>) => Promise<unknown>} [chat]
 * @typedef {Object} CicadaArchiveAdapter
 * @property {(key: string, entry: CicadaArchiveEntry) => Promise<unknown>} [store]
 * @property {(key: string, entry: CicadaArchiveEntry) => void} [set]
 * @property {(key: string, entry: CicadaArchiveEntry) => Promise<unknown>} [archive]
 * @property {(key: string) => Promise<CicadaArchiveEntry|null>} [load]
 * @property {(key: string) => CicadaArchiveEntry|null} [get]
 * @property {(key: string) => Promise<CicadaArchiveEntry|null>} [restore]
 * @typedef {Object} CicadaEventBus
 * @property {(eventName: string, payload: Record<string, unknown>) => void} [emit]
 * @typedef {Object} CicadaCompressorOptions
 * @property {CicadaModelRouter} [modelRouter]
 * @property {CicadaArchiveAdapter} [archive]
 * @property {number} [maxTokens]
 * @property {string[]} [layers]
 * @property {CicadaEventBus} [eventBus]
 * @property {number} [maxArchives]
 * @property {number|null} [archiveRetentionDays]
 * @typedef {Object} CicadaSharedContext
 * @property {(stageKey: string, summary: string) => void} [setSummary]
 * @property {(stageKey: string, index: { keywords?: string[] }) => void} [setIndex]
 * @property {(stageKey: string, payload: Record<string, unknown>) => void} [signal]
 * @property {() => string} [buildSummaryText]
 * @property {() => string[]} [getDecisions]
 * @property {() => Record<string, unknown>} [getAllSummaries]
 * @typedef {Object} CicadaTodo
 * @property {unknown} [status]
 * @property {unknown} [content]
 * @property {unknown} [title]
 * @property {unknown} [text]
 * @property {unknown} [priority]
 * @typedef {Object} CicadaAgentStateL1
 * @property {{ summary?: unknown, decisionTrace?: unknown }} [condensedMemory]
 * @property {unknown[]} [claims]
 * @typedef {Object} CicadaAgentStateL2
 * @property {unknown[]} [warnings]
 * @typedef {Object} CicadaAgentState
 * @property {CicadaTodo[]} [todos]
 * @property {unknown} [runId]
 * @property {CicadaAgentStateL1} [L1]
 * @property {CicadaAgentStateL2} [L2]
 * @property {unknown} [taskGoal]
 * @property {unknown} [iteration]
 */

export const CompressionLayer = Object.freeze({
  TOOL_OUTPUT: "tool_output",
  SESSION_HISTORY: "session_history",
  LLM_SUMMARY: "llm_summary",
});

const DEFAULT_LAYERS = Object.freeze([
  CompressionLayer.TOOL_OUTPUT,
  CompressionLayer.SESSION_HISTORY,
  CompressionLayer.LLM_SUMMARY,
]);

const DEFAULT_MAX_TOKENS = 2000;
const DEFAULT_MAX_INPUT_CHARS = 12000;

// Schema versioning for forward compatibility
const CICADA_SCHEMA_VERSION = "1.0";
/** @type {Set<string | undefined>} */
const SUPPORTED_SCHEMA_VERSIONS = new Set(["1.0", "0.1", undefined]); // undefined = legacy

// 结构化摘要模板 (from shared/)
const SUMMARY_TEMPLATE = {
  summary: "string",
  keyPoints: ["string"],
  decisions: ["string"],
  errors: ["string"],
  pendingTasks: ["string"],
  nextSteps: ["string"],
};

const IMPORTANT_KEYS = new Set([
  "tool",
  "name",
  "id",
  "status",
  "ok",
  "error",
  "errors",
  "warning",
  "warnings",
  "summary",
  "result",
  "type",
  "meta",
  "metadata",
  "count",
  "total",
]);

const VERBOSE_KEYS = new Set([
  "output",
  "content",
  "data",
  "stdout",
  "stderr",
  "logs",
  "trace",
  "stack",
  "raw",
  "payload",
  "debug",
]);

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function safeStringify(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function estimateTokens(text) {
  return estimateTokensCached(text);
}

function truncateText(text, maxChars) {
  if (typeof text !== "string") return "";
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.max(0, maxChars - head - 3);
  return text.slice(0, head) + "..." + (tail ? text.slice(text.length - tail) : "");
}

function containsCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ""));
}

function normalizeTitleText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function toTitle(text, { maxWords = 10, maxChars = 80 } = {}) {
  const normalized = normalizeTitleText(text);
  if (!normalized) return "";

  const maxW = Number.isFinite(Number(maxWords)) ? Math.max(1, Math.floor(Number(maxWords))) : 10;
  const maxC = Number.isFinite(Number(maxChars)) ? Math.max(10, Math.floor(Number(maxChars))) : 80;

  if (containsCjk(normalized)) {
    const clipped = normalized.slice(0, maxC);
    return clipped + (normalized.length > clipped.length ? "..." : "");
  }

  const words = normalized.split(" ").filter(Boolean);
  const sliced = words.slice(0, maxW).join(" ");
  const clipped = sliced.length > maxC ? sliced.slice(0, maxC) : sliced;
  const truncated = words.length > maxW || normalized.length > clipped.length;
  return clipped + (truncated ? "..." : "");
}

function isThinkingMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.thinking === true || message.internal === true) return true;
  if (message.type === "thinking") return true;
  if (message.meta && message.meta.type === "thinking") return true;
  const content = String(message.content || message.text || "").trim();
  if (!content) return false;
  return /^<(think|analysis)>/i.test(content) || /^(thoughts?|analysis|internal):/i.test(content);
}

/**
 * 从 thinking 消息中提取关键决策点，生成摘要。
 * 用于渐进式压缩（而非完全删除 thinking）。
 *
 * @param {object} message
 * @param {{ maxChars?: number }} [options]
 * @returns {object} 摘要后的消息
 */
function summarizeThinkingMessage(message, { maxChars = 150 } = {}) {
  if (!message || typeof message !== "object") return message;

  const content = String(message.content || message.text || "");
  if (!content) return message;

  const lines = content.split("\n");
  const decisions = [];

  // 提取决策性语句
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // 匹配决策模式（中英文）
    const isDecision =
      /^(决定|选择|确定|采用|使用|将|要|需要|应该|因此|所以|结论|计划|方案)/i.test(trimmed) ||
      /^(decide|choose|will|should|therefore|conclusion|plan|approach|solution)/i.test(trimmed) ||
      /^[-*•]\s*(决定|选择|will|should|plan)/i.test(trimmed);

    if (isDecision) {
      decisions.push(trimmed.slice(0, 80));
    }
  }

  let summary;
  if (decisions.length > 0) {
    // 有明确决策：使用决策点
    summary = `[思考摘要] ${decisions.slice(0, 3).join("; ")}`;
  } else {
    // 无明确决策：保留首尾
    const head = content.slice(0, 60).replace(/\s+/g, " ");
    const tail = content.length > 120 ? content.slice(-40).replace(/\s+/g, " ") : "";
    summary = `[思考摘要] ${head}${tail ? " ... " + tail : ""}`;
  }

  // 确保不超过 maxChars
  if (summary.length > maxChars) {
    if (maxChars <= 3) {
      summary = summary.slice(0, maxChars);
    } else {
      summary = summary.slice(0, maxChars - 3) + "...";
    }
  }

  return {
    ...message,
    content: summary,
    _originalLength: content.length,
    _thinkingSummarized: true,
  };
}

function normalizeMessage(message) {
  if (typeof message === "string") {
    return { role: "assistant", content: message };
  }
  if (message && typeof message === "object") {
    const content = message.content ?? message.text ?? "";
    return { ...message, content: String(content) };
  }
  return { role: "assistant", content: "" };
}

function isToolRoleMessage(message) {
  return !!message && typeof message === "object" && (message.role === "tool" || message.role === "function");
}

function isAssistantToolCallMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.role !== "assistant") return false;
  if (Array.isArray(message.tool_calls) || Array.isArray(message.toolCalls)) return true;
  if (message.function_call && typeof message.function_call === "object") return true;
  if (message.functionCall && typeof message.functionCall === "object") return true;
  return false;
}

function extractToolCallIds(message) {
  const m = message && typeof message === "object" ? message : null;
  const calls = Array.isArray(m?.tool_calls) ? m.tool_calls : Array.isArray(m?.toolCalls) ? m.toolCalls : null;
  if (!calls) return [];
  const ids = [];
  for (const c of calls) {
    const id = typeof c?.id === "string" ? c.id : "";
    if (id) ids.push(id);
  }
  return ids;
}

function extractToolMessageCallId(message) {
  const m = message && typeof message === "object" ? message : null;
  if (!m) return "";
  return (
    (typeof m.tool_call_id === "string" ? m.tool_call_id : "") ||
    (typeof m.toolCallId === "string" ? m.toolCallId : "") ||
    (typeof m.call_id === "string" ? m.call_id : "") ||
    (typeof m.callId === "string" ? m.callId : "")
  );
}

function adjustStartForToolPairs(messages, startIndex) {
  const list = Array.isArray(messages) ? messages : [];
  let start = Number.isFinite(startIndex) ? Math.max(0, Math.floor(startIndex)) : 0;
  if (start <= 0 || start >= list.length) return start;

  // If the kept window would start with tool output(s), include the preceding assistant tool-call message when possible.
  if (isToolRoleMessage(list[start])) {
    let prev = start - 1;
    while (prev >= 0 && isToolRoleMessage(list[prev])) prev -= 1;

    if (prev >= 0 && isAssistantToolCallMessage(list[prev])) {
      return prev;
    }

    // Otherwise, drop leading tool outputs so we don't keep a dangling tool message.
    while (start < list.length && isToolRoleMessage(list[start])) start += 1;
  }

  return start;
}

function removeOrphanedToolMessages(messages) {
  const list = Array.isArray(messages) ? messages.slice() : [];
  if (list.length === 0) return list;

  const referenced = new Set();
  for (const msg of list) {
    for (const id of extractToolCallIds(msg)) referenced.add(id);
  }

  let cleaned = list;
  if (referenced.size) {
    cleaned = cleaned.filter((msg) => {
      if (!isToolRoleMessage(msg)) return true;
      const id = extractToolMessageCallId(msg);
      return !id || referenced.has(id);
    });
  }

  while (cleaned.length && isToolRoleMessage(cleaned[0])) cleaned = cleaned.slice(1);
  return cleaned;
}

function isMergeSafeMessage(message) {
  if (!message || typeof message !== "object") return false;
  const keys = Object.keys(message);
  for (const key of keys) {
    if (key === "role" || key === "content") continue;
    return false;
  }
  return true;
}

function summarizeMessages(messages, lineLimit, { titleOnly = false, titleMaxWords = 10, titleMaxChars = 80 } = {}) {
  const lines = [];
  for (const msg of messages) {
    const role = String(msg.role || "unknown");
    const content = String(msg.content || "").replace(/\s+/g, " ").trim();
    if (!content) continue;
    const line = titleOnly
      ? `${role}: ${toTitle(content, { maxWords: titleMaxWords, maxChars: titleMaxChars })}`
      : `${role}: ${truncateText(content, lineLimit)}`;
    lines.push(line);
  }
  return lines.join("\n");
}

function normalizeLayerList(layers) {
  const list = Array.isArray(layers) ? layers : DEFAULT_LAYERS;
  const requested = new Set(list);
  return DEFAULT_LAYERS.filter((layer) => requested.has(layer));
}

function isContextSummaryMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.role !== "system") return false;
  const content = String(message.content || "").trim();
  return content.startsWith("[Context Summary]");
}

function isSmallValue(value, maxChars) {
  if (value === null || value === undefined) return true;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= maxChars;
  if (Array.isArray(value)) return value.length <= 3;
  if (isPlainObject(value)) return Object.keys(value).length <= 5;
  return false;
}

function compressValue(value, options, stats, depth) {
  const { maxChars, maxArrayItems, maxDepth } = options;
  if (typeof value === "string") {
    if (value.length <= maxChars) return value;
    stats.truncatedFields += 1;
    return truncateText(value, maxChars);
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (value.length <= maxArrayItems) {
      return value.map((item) => compressValue(item, options, stats, depth + 1));
    }
    stats.trimmedArrays += 1;
    return value.slice(0, maxArrayItems).map((item) => compressValue(item, options, stats, depth + 1));
  }
  if (isPlainObject(value)) {
    if (depth >= maxDepth) {
      stats.trimmedObjects += 1;
      const text = safeStringify(value);
      return truncateText(text, maxChars);
    }
    const entries = Object.entries(value);
    const result = Object.create(null);
    for (const [key, val] of entries) {
      if (DANGEROUS_KEYS.has(key)) {
        stats.removedFields += 1;
        continue;
      }
      const keep = IMPORTANT_KEYS.has(key) || VERBOSE_KEYS.has(key) || isSmallValue(val, Math.floor(maxChars / 2));
      if (!keep) {
        stats.removedFields += 1;
        continue;
      }
      result[key] = compressValue(val, options, stats, depth + 1);
    }
    return result;
  }
  return value;
}

function normalizeSummaryPayload(raw, fallback) {
  const src = isPlainObject(raw) ? raw : fallback;
  if (!isPlainObject(src)) {
    return { summary: "", keyPoints: [], decisions: [], errors: [] };
  }
  const summary = toNonEmptyString(src.summary) || "";
  const keyPoints = Array.isArray(src.keyPoints)
    ? src.keyPoints.map((item) => String(item)).filter(Boolean)
    : [];
  const decisions = Array.isArray(src.decisions)
    ? src.decisions.map((item) => String(item)).filter(Boolean)
    : [];
  const errors = Array.isArray(src.errors)
    ? src.errors.map((item) => String(item)).filter(Boolean)
    : [];
  return { summary, keyPoints, decisions, errors };
}

function buildFallbackSummary(text) {
  const trimmed = text.trim();
  if (!trimmed) return { summary: "", keyPoints: [], decisions: [], errors: [] };
  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const summary = truncateText(trimmed.replace(/\s+/g, " "), 280);
  const keyPoints = lines.slice(0, 5).map((line) => truncateText(line, 120));
  const decisions = lines.filter((line) => /decision|decide|chosen|selected|will/i.test(line)).slice(0, 3);
  const errors = lines.filter((line) => /error|failed|exception/i.test(line)).slice(0, 3);
  return { summary, keyPoints, decisions, errors };
}

export class CicadaCompressor {
  /** @type {CicadaModelRouter|null} */
  modelRouter;
  /** @type {CicadaArchiveAdapter|null} */
  archiveAdapter;
  /** @type {number} */
  maxTokens;
  /** @type {string[]} */
  layers;
  /** @type {CicadaEventBus|null} */
  eventBus;
  /** @type {Map<string, CicadaArchiveEntry>} */
  _archiveStore;
  /** @type {number} */
  _maxArchives;
  /** @type {number|null} */
  _archiveRetentionDays;

  /**
   * @param {CicadaCompressorOptions} [options]
   */
  constructor({ modelRouter, archive, maxTokens, layers, eventBus, maxArchives = 200, archiveRetentionDays = null } = {}) {
    this.modelRouter = modelRouter || null;
    this.archiveAdapter = archive || null;
    this.maxTokens = Number.isFinite(maxTokens) ? maxTokens : DEFAULT_MAX_TOKENS;
    this.layers = normalizeLayerList(layers);
    this.eventBus = eventBus || null;
    this._archiveStore = new Map();
    this._maxArchives = (() => {
      if (maxArchives === Infinity) return Infinity;
      const n = typeof maxArchives === "number" ? maxArchives : Number(maxArchives);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 200;
    })();
    this._archiveRetentionDays = (() => {
      if (archiveRetentionDays === null || archiveRetentionDays === undefined) return null;
      const n = typeof archiveRetentionDays === "number" ? archiveRetentionDays : Number(archiveRetentionDays);
      return Number.isFinite(n) ? Math.max(0, n) : null;
    })();
  }

  /**
   * @param {string} name
   * @param {unknown} payload
   * @returns {void}
   */
  _emit(name, payload) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(name, { actor: "cicada", status: "completed", payload });
    }
  }

  /**
   * @param {unknown} value
   * @returns {number|null}
   */
  _toTimestampMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const s = typeof value === "string" ? value.trim() : "";
    if (!s) return null;
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  }

  /**
   * @returns {void}
   */
  _pruneArchiveStore() {
    const max = this._maxArchives;
    const retentionDays = this._archiveRetentionDays;
    if ((max === Infinity || max === null) && (retentionDays === null || retentionDays === undefined)) return;

    const now = Date.now();
    const cutoffMs =
      typeof retentionDays === "number" && Number.isFinite(retentionDays) && retentionDays > 0 ? now - retentionDays * 24 * 60 * 60 * 1000 : null;

    if (cutoffMs !== null) {
      for (const [key, entry] of this._archiveStore.entries()) {
        const ts = this._toTimestampMs(entry?.timestamp) ?? (typeof entry?.timestamp === "number" ? entry.timestamp : null);
        if (ts !== null && ts < cutoffMs) this._archiveStore.delete(key);
      }
    }

    if (max === Infinity) return;
    const limit = typeof max === "number" && Number.isFinite(max) ? Math.max(0, Math.floor(max)) : null;
    if (!limit) return;
    if (this._archiveStore.size <= limit) return;

    const items = Array.from(this._archiveStore.entries()).map(([id, entry]) => {
      const ts = this._toTimestampMs(entry?.timestamp) ?? (typeof entry?.timestamp === "number" ? entry.timestamp : 0);
      return { id, ts };
    });
    items.sort((a, b) => b.ts - a.ts);

    for (let i = limit; i < items.length; i++) {
      this._archiveStore.delete(items[i].id);
    }
  }

  /**
   * @param {unknown} context
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<{ context: Record<string, unknown>, metadata: Record<string, unknown> }>}
   */
  async compress(context, options = {}) {
    const contextObject = isPlainObject(context) ? /** @type {Record<string, unknown>} */ (context) : null;
    /** @type {Record<string, unknown>} */
    const base = contextObject ? { ...contextObject } : { value: context };
    const layers = normalizeLayerList(options.layers || this.layers);
    const metadata = {
      layersApplied: [],
      stats: {},
      llmSummary: null,
      archiveId: null,
    };

    let current = base;
    for (const layer of layers) {
      if (layer === CompressionLayer.TOOL_OUTPUT) {
        const { compressed, stats } = this._compressToolOutput(current, options);
        current = compressed;
        metadata.layersApplied.push(layer);
        metadata.stats.toolOutput = stats;
        this._emit(CicadaEvents.LAYER_COMPLETED, { layer, stats });
      }
      if (layer === CompressionLayer.SESSION_HISTORY) {
        const { compressed, stats } = this._compressSessionHistory(current, options);
        current = compressed;
        metadata.layersApplied.push(layer);
        metadata.stats.sessionHistory = stats;
        this._emit(CicadaEvents.LAYER_COMPLETED, { layer, stats });
      }
      if (layer === CompressionLayer.LLM_SUMMARY) {
        if (!this.modelRouter) continue;
        const llm = await this._compressWithLLM(current, options);
        current = { ...current, llmSummary: llm };
        metadata.layersApplied.push(layer);
        metadata.llmSummary = llm;
        metadata.stats.llmSummary = llm.stats;
        this._emit(CicadaEvents.LAYER_COMPLETED, { layer, stats: llm.stats });
      }
    }

    const contextStageKey =
      context && (typeof context === "object" || typeof context === "function")
        ? /** @type {Record<string, unknown>} */ (context).stageKey
        : undefined;
    const archiveKey = toNonEmptyString(options.archiveKey || options.stageKey || base.stageKey || contextStageKey);
    if (archiveKey) {
      // 关键修正：存档时保留 base (原始全量内容)，而不是 current (压缩后内容)
      metadata.archiveId = await this.archive(archiveKey, {
        context: base, // 存档原件
        metadata,     // 包含压缩统计
        summary: metadata.llmSummary?.summary || "" // 冗余一份 summary 方便 Recall 工具搜索
      });
    }

    // SharedContext 集成 (from shared/)
    const sharedContextRaw = options?.sharedContext;
    const sharedContext =
      sharedContextRaw && (typeof sharedContextRaw === "object" || typeof sharedContextRaw === "function")
        ? /** @type {CicadaSharedContext} */ (sharedContextRaw)
        : null;
    if (sharedContext && archiveKey) {
      const summaryText = metadata.llmSummary?.summary || "";
      if (typeof sharedContext.setSummary === "function" && summaryText) {
        sharedContext.setSummary(archiveKey, summaryText);
      }
      if (typeof sharedContext.setIndex === "function" && metadata.llmSummary?.keyPoints) {
        sharedContext.setIndex(archiveKey, { keywords: metadata.llmSummary.keyPoints });
      }
      if (typeof sharedContext.signal === "function") {
        sharedContext.signal(archiveKey, {
          type: "CICADA_SHED",
          archiveId: metadata.archiveId,
          layersApplied: metadata.layersApplied,
        });
      }
    }

    const result = { context: current, metadata };
    this._emit(CicadaEvents.SHED_COMPLETED, { result, layers: metadata.layersApplied });
    return result;
  }

  /**
   * @param {Record<string, unknown>} context
   * @param {Record<string, unknown>} [options]
   * @returns {{ compressed: Record<string, unknown>, stats: Record<string, number> }}
   */
  _compressToolOutput(context, options = {}) {
    const maxChars = Number.isFinite(options.maxToolOutputChars)
      ? options.maxToolOutputChars
      : Math.max(200, this.maxTokens * 4);
    const maxArrayItems = Number.isFinite(options.maxToolOutputItems)
      ? options.maxToolOutputItems
      : 4;
    const maxDepth = Number.isFinite(options.maxToolOutputDepth)
      ? options.maxToolOutputDepth
      : 2;
    const stats = {
      originalSize: 0,
      compressedSize: 0,
      truncatedFields: 0,
      removedFields: 0,
      trimmedArrays: 0,
      trimmedObjects: 0,
    };

    const updated = { ...context };
    const toolKey = Array.isArray(context.toolOutputs)
      ? "toolOutputs"
      : (Array.isArray(context.tool_outputs) ? "tool_outputs" : (Array.isArray(context.toolOutput) ? "toolOutput" : null));

    if (toolKey) {
      const outputs = context[toolKey];
      if (Array.isArray(outputs)) {
        const compressedOutputs = outputs.map((entry) => {
          const text = safeStringify(entry);
          stats.originalSize += text.length;
          const compressed = compressValue(entry, { maxChars, maxArrayItems, maxDepth }, stats, 0);
          stats.compressedSize += safeStringify(compressed).length;
          return compressed;
        });
        updated[toolKey] = compressedOutputs;
      }
    }

    if (Array.isArray(context.messages)) {
      updated.messages = context.messages.map((message) => {
        if (message && typeof message === "object" && message.role === "tool") {
          const contentText = safeStringify(message.content ?? message.output ?? message.result ?? "");
          stats.originalSize += contentText.length;
          const compressed = compressValue(message.content, { maxChars, maxArrayItems, maxDepth }, stats, 0);
          stats.compressedSize += safeStringify(compressed).length;
          return { ...message, content: compressed };
        }
        return message;
      });
    }

    return { compressed: updated, stats };
  }

  /**
   * @param {Record<string, unknown>} context
   * @param {Record<string, unknown>} [options]
   * @returns {{ compressed: Record<string, unknown>, stats: Record<string, number> }}
   */
  _compressSessionHistory(context, options = {}) {
    const keepLastTurns = (() => {
      const n = typeof options.keepLastTurns === "number" ? options.keepLastTurns : Number(options.keepLastTurns);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 6;
    })();
    const summaryLineChars = (() => {
      const n = typeof options.summaryLineChars === "number" ? options.summaryLineChars : Number(options.summaryLineChars);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 120;
    })();
    const titleOnly = options.titleOnly === true;
    const titleMaxWords = (() => {
      const n = typeof options.titleMaxWords === "number" ? options.titleMaxWords : Number(options.titleMaxWords);
      return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 10;
    })();
    const titleMaxChars = (() => {
      const n = typeof options.titleMaxChars === "number" ? options.titleMaxChars : Number(options.titleMaxChars);
      return Number.isFinite(n) ? Math.max(10, Math.floor(n)) : 80;
    })();
    // 新增：thinking 摘要选项（默认 false 保持向后兼容）
    const summarizeThinking = options.summarizeThinking === true;
    const thinkingSummaryMaxChars = (() => {
      const n = typeof options.thinkingSummaryMaxChars === "number" ? options.thinkingSummaryMaxChars : Number(options.thinkingSummaryMaxChars);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 150;
    })();

    const stats = {
      totalMessages: 0,
      mergedMessages: 0,
      removedThinking: 0,
      summarizedThinking: 0, // 新增：摘要的 thinking 消息数
      keptMessages: 0,
      summarizedMessages: 0,
    };

    const historyKey = Array.isArray(context.messages)
      ? "messages"
      : (Array.isArray(context.sessionHistory) ? "sessionHistory" : (Array.isArray(context.history) ? "history" : null));

    if (!historyKey) return { compressed: context, stats };

    const history = context[historyKey];
    if (!Array.isArray(history)) return { compressed: context, stats };

    const messages = history.map(normalizeMessage);
    stats.totalMessages = messages.length;
    const merged = [];
    for (const message of messages) {
      if (isThinkingMessage(message)) {
        if (summarizeThinking) {
          // 渐进式摘要：提取决策点
          const summarized = summarizeThinkingMessage(message, { maxChars: thinkingSummaryMaxChars });
          merged.push(summarized);
          stats.summarizedThinking += 1;
          continue; // 已处理，跳过合并逻辑
        } else {
          // 向后兼容：完全删除
          stats.removedThinking += 1;
          continue;
        }
      }
      const last = merged[merged.length - 1];
      // Avoid merging system messages; system is reserved for pinned prompts/anchors/summaries.
      // Avoid merging messages carrying extra fields (id/meta/tool_call_id/...) to prevent metadata loss.
      const canMerge =
        last &&
        last.role === message.role &&
        message.role !== "system" &&
        message.role !== "tool" &&
        isMergeSafeMessage(last) &&
        isMergeSafeMessage(message);
      if (canMerge) {
        last.content = [last.content, message.content].filter(Boolean).join("\n");
        stats.mergedMessages += 1;
      } else {
        merged.push({ ...message });
      }
    }

    // Anchors: keep leading system prompts verbatim (except context summaries).
    // This reduces semantic drift by preventing repeated summarization of the initial constraints.
    const anchors = [];
    let anchorEnd = 0;
    while (anchorEnd < merged.length) {
      const msg = merged[anchorEnd];
      if (msg?.role === "system" && !isContextSummaryMessage(msg)) {
        anchors.push(msg);
        anchorEnd += 1;
        continue;
      }
      break;
    }

    const compressible = merged.slice(anchorEnd);
    let start = Math.max(compressible.length - keepLastTurns, 0);
    start = adjustStartForToolPairs(compressible, start);

    const keptTail = removeOrphanedToolMessages(compressible.slice(start));
    const kept = [...anchors, ...keptTail];
    const older = compressible.slice(0, start);
    stats.keptMessages = kept.length;
    stats.summarizedMessages = older.length;

    const updated = { ...context, [historyKey]: kept };
    if (older.length) {
      const summary = summarizeMessages(older, summaryLineChars, { titleOnly, titleMaxWords, titleMaxChars });
      const existing = toNonEmptyString(context.sessionSummary || context.historySummary) || "";
      updated.sessionSummary = existing ? `${existing}\n${summary}` : summary;
    }

    return { compressed: updated, stats };
  }

  /**
   * @param {Record<string, unknown>} context
   * @param {Record<string, unknown>} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async _compressWithLLM(context, options = {}) {
    const maxInputChars = (() => {
      const n = typeof options.maxInputChars === "number" ? options.maxInputChars : Number(options.maxInputChars);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : DEFAULT_MAX_INPUT_CHARS;
    })();
    const contextText = safeStringify(context).slice(0, maxInputChars);
    const currentTime = new Date().toISOString();
    const prompt = [
      "Summarize the agent context into JSON with keys: summary, keyPoints, decisions, errors.",
      "Preserve key decisions, findings, and errors.",
      "",
      "IMPORTANT - Atomization rules for self-contained facts:",
      "1. Coreference Resolution: Replace all pronouns with concrete entities.",
      '   - "他/她/它" → actual name, "那个文件" → actual filename, "这个函数" → actual function name',
      "2. Temporal Normalization: Convert ALL relative time to ISO-8601 absolute timestamps.",
      '   - "明天" → specific date, "刚才" → specific timestamp, "上次" → specific date/time',
      "3. Each fact in keyPoints/decisions MUST be understandable in isolation without context.",
      "",
      `Current time: ${currentTime}`,
      `Max tokens: ${this.maxTokens}.`,
      "Context:",
      contextText,
    ].join("\n");

    let raw = null;
    try {
      raw = await this._callModel([{ role: "user", content: prompt }]);
    } catch (err) {
      logger.warn("CicadaCompressor._compressWithLLM: LLM call failed", { error: err?.message || String(err) });
      raw = null;
    }

    const parsed = typeof raw === "string"
      ? robustParseJson(raw, null)
      : (isPlainObject(raw) ? raw : null);
    const fallback = buildFallbackSummary(contextText);
    const summary = normalizeSummaryPayload(parsed, fallback);
    const stats = {
      promptTokens: estimateTokens(prompt),
      summaryTokens: estimateTokens(summary.summary),
    };
    return { ...summary, stats };
  }

  /**
   * @param {Array<CicadaMessage>} messages
   * @returns {Promise<unknown>}
   */
  async _callModel(messages) {
    if (this.modelRouter && typeof this.modelRouter.call === "function") {
      try {
        const resp = await this.modelRouter.call({ usage: "cicada_summary", messages });
        if (resp && typeof resp === "object") {
          const record = /** @type {Record<string, unknown>} */ (resp);
          return record.content ?? record.text ?? resp;
        }
        return resp;
      } catch (err) {
        if (this.modelRouter.call.length >= 2) {
          const resp = await this.modelRouter.call(messages, { usage: "cicada_summary" });
          if (resp && typeof resp === "object") {
            const record = /** @type {Record<string, unknown>} */ (resp);
            return record.content ?? record.text ?? resp;
          }
          return resp;
        }
        throw err;
      }
    }
    if (this.modelRouter && typeof this.modelRouter.chat === "function") {
      const resp = await this.modelRouter.chat(messages);
      if (resp && typeof resp === "object") {
        const record = /** @type {Record<string, unknown>} */ (resp);
        return record.content ?? record.text ?? resp;
      }
      return resp;
    }
    return null;
  }

  /**
   * @param {string} stageKey
   * @param {CicadaArchiveEntry} data
   * @returns {Promise<string>}
   */
  async archive(stageKey, data) {
    const key = toNonEmptyString(stageKey) || makeSecureTimestampedId("archive");
    const adapter = this.archiveAdapter;

    const metadata = isPlainObject(data?.metadata) ? /** @type {Record<string, unknown>} */ (data.metadata) : null;
    const llmSummary = metadata && isPlainObject(metadata.llmSummary) ? /** @type {Record<string, unknown>} */ (metadata.llmSummary) : null;
    const summaryText = toNonEmptyString(llmSummary?.summary) || toNonEmptyString(data.summary) || "";

    const resolvedTimestamp = (() => {
      const raw = data?.timestamp;
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      const ms = this._toTimestampMs(raw);
      return ms !== null ? ms : Date.now();
    })();

    // 增加元数据：时间戳、摘要、schema version
    const entry = {
      schemaVersion: CICADA_SCHEMA_VERSION,
      ...data,
      timestamp: resolvedTimestamp,
      summary: summaryText,
      stageKey: key,
    };

    // Always track metadata locally so listArchives()/backtrack can work even when using an external adapter.
    const willPersist = !!adapter && (typeof adapter.store === "function" || typeof adapter.set === "function" || typeof adapter.archive === "function");
    this._archiveStore.set(key, willPersist ? { timestamp: entry.timestamp, summary: entry.summary, stageKey: key } : entry);
    this._pruneArchiveStore();

    if (adapter) {
      if (typeof adapter.store === "function") {
        const stored = await adapter.store(key, entry);
        return toNonEmptyString(stored) || key;
      }
      if (typeof adapter.set === "function") {
        adapter.set(key, entry);
        return key;
      }
      if (typeof adapter.archive === "function") {
        const stored = await adapter.archive(key, entry);
        return toNonEmptyString(stored) || key;
      }
    }
    return key;
  }

  /**
   * @param {string} stageKey
   * @returns {Promise<CicadaArchiveEntry|null>}
   */
  async restore(stageKey) {
    const key = toNonEmptyString(stageKey);
    if (!key) return null;
    const adapter = this.archiveAdapter;
    let entry = null;
    if (adapter) {
      if (typeof adapter.load === "function") entry = await adapter.load(key);
      else if (typeof adapter.get === "function") entry = adapter.get(key);
      else if (typeof adapter.restore === "function") entry = await adapter.restore(key);
    }
    if (!entry) entry = this._archiveStore.get(key) ?? null;

    // Schema version validation
    if (entry && typeof entry === "object") {
      const version = /** @type {Record<string, unknown>} */ (entry).schemaVersion;
      /** @type {string | undefined} */
      const normalizedVersion = version === undefined ? undefined : typeof version === "string" ? version : String(version);
      if (!SUPPORTED_SCHEMA_VERSIONS.has(normalizedVersion)) {
        logger.warn(`CicadaCompressor.restore: unsupported schema version "${String(version)}" for key "${key}"`);
        // Return entry anyway but mark as potentially incompatible
        entry._schemaWarning = `Unsupported schema version: ${String(version)}`;
      }
    }

    return entry;
  }

  /**
   * 列出所有存档（支持过滤）
   * @param {{ limit?: number, pattern?: string } | undefined} [options]
   * @returns {Promise<Array<{ id: string, timestamp: unknown, summary: string, stageKey: string }>>}
   */
  async listArchives(options = {}) {
    const { limit = 10, pattern = "" } = options;
    const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 10;
    /** @type {Array<{ id: string, timestamp: number, summary: string, stageKey: string }>} */
    const all = [];

    // 从内存 store 中获取
    for (const [key, entry] of this._archiveStore.entries()) {
      const ts = this._toTimestampMs(entry?.timestamp) ?? (typeof entry?.timestamp === "number" ? entry.timestamp : 0);
      const summary = toNonEmptyString(entry?.summary) || "";
      const stage = toNonEmptyString(entry?.stageKey) || key;
      all.push({
        id: key,
        timestamp: ts,
        summary,
        stageKey: stage,
      });
    }

    // 如果有适配器，可能需要特殊的列出逻辑（这里先处理内存部分）
    let filtered = all;
    if (pattern) {
      // 安全校验：限制 pattern 长度和复杂度，防止 ReDoS
      const safePattern = String(pattern).slice(0, 100);
      let regex;
      try {
        regex = new RegExp(safePattern, "i");
      } catch {
        // 非法正则表达式，转义为字面量匹配
        const escaped = safePattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        regex = new RegExp(escaped, "i");
      }
      filtered = all.filter((e) => regex.test(e.summary) || regex.test(e.id));
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp);
    return filtered.slice(0, safeLimit);
  }

  /**
   * 构建 Handoff 交接文档
   * @param {unknown} state - agent 状态
   * @param {unknown} sharedContext - 共享上下文
   * @returns {Record<string, unknown>} handoff 文档
   */
  buildHandoff(state, sharedContext) {
    /** @type {CicadaAgentState} */
    const stateValue = state && typeof state === "object" ? /** @type {CicadaAgentState} */ (state) : {};
    const sharedValue =
      sharedContext && (typeof sharedContext === "object" || typeof sharedContext === "function")
        ? /** @type {CicadaSharedContext} */ (sharedContext)
        : null;

    const todos = Array.isArray(stateValue.todos) ? stateValue.todos : [];
    const pending = todos.filter(t => t.status !== "done" && t.status !== "completed");
    const completed = todos.filter(t => t.status === "done" || t.status === "completed");

    return {
      runId: stateValue.runId,
      timestamp: new Date().toISOString(),

      // 已完成
      accomplished: {
        summary: sharedValue?.buildSummaryText?.() || stateValue.L1?.condensedMemory?.summary || "",
        completedTodos: completed.map(t => t.content || t.title || t.text),
        claimCount: stateValue.L1?.claims?.length || 0,
      },

      // 待办
      pending: {
        todos: pending.map(t => ({ content: t.content || t.title || t.text, priority: t.priority })),
        taskGoal: stateValue.taskGoal || "",
      },

      // 关键决策（最近5条）
      decisions: sharedValue?.getDecisions?.()?.slice(-5) || stateValue.L1?.condensedMemory?.decisionTrace || [],

      // 继续指南
      resumeGuide: {
        nextAction: pending[0]?.content || pending[0]?.title || pending[0]?.text || null,
        context: sharedValue?.getAllSummaries?.() || {},
        warnings: stateValue.L2?.warnings || [],
        iteration: stateValue.iteration || 0,
      },
    };
  }
}

export default CicadaCompressor;
