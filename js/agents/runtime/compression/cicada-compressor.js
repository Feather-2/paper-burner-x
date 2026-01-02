import { isPlainObject, toNonEmptyString, estimateTokenCount } from "../../shared/utils/value-utils.js";
import { robustParseJson } from "../../shared/utils/robust-json.js";
import { CicadaEvents } from "../events/events.js";
import { makeSecureTimestampedId } from "../../shared/utils/secure-id.js";

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

function safeStringify(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function estimateTokens(text) {
  if (!text) return 0;
  return estimateTokenCount(text);
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
    const result = {};
    for (const [key, val] of entries) {
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

  _emit(name, payload) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(name, { actor: "cicada", status: "completed", payload });
    }
  }

  _toTimestampMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    const s = typeof value === "string" ? value.trim() : "";
    if (!s) return null;
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? ms : null;
  }

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

  async compress(context, options = {}) {
    const base = isPlainObject(context) ? { ...context } : { value: context };
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

    const archiveKey = toNonEmptyString(options.archiveKey || options.stageKey || context?.stageKey);
    if (archiveKey) {
      // 关键修正：存档时保留 base (原始全量内容)，而不是 current (压缩后内容)
      metadata.archiveId = await this.archive(archiveKey, {
        context: base, // 存档原件
        metadata,     // 包含压缩统计
        summary: metadata.llmSummary?.summary || "" // 冗余一份 summary 方便 Recall 工具搜索
      });
    }

    // SharedContext 集成 (from shared/)
    const sharedContext = options?.sharedContext || null;
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
      const compressedOutputs = outputs.map((entry) => {
        const text = safeStringify(entry);
        stats.originalSize += text.length;
        const compressed = compressValue(entry, { maxChars, maxArrayItems, maxDepth }, stats, 0);
        stats.compressedSize += safeStringify(compressed).length;
        return compressed;
      });
      updated[toolKey] = compressedOutputs;
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

  _compressSessionHistory(context, options = {}) {
    const keepLastTurns = Number.isFinite(options.keepLastTurns) ? options.keepLastTurns : 6;
    const summaryLineChars = Number.isFinite(options.summaryLineChars) ? options.summaryLineChars : 120;
    const titleOnly = options.titleOnly === true;
    const titleMaxWords = Number.isFinite(options.titleMaxWords) ? Math.max(1, Math.floor(options.titleMaxWords)) : 10;
    const titleMaxChars = Number.isFinite(options.titleMaxChars) ? Math.max(10, Math.floor(options.titleMaxChars)) : 80;
    const stats = {
      totalMessages: 0,
      mergedMessages: 0,
      removedThinking: 0,
      keptMessages: 0,
      summarizedMessages: 0,
    };

    const historyKey = Array.isArray(context.messages)
      ? "messages"
      : (Array.isArray(context.sessionHistory) ? "sessionHistory" : (Array.isArray(context.history) ? "history" : null));

    if (!historyKey) return { compressed: context, stats };

    const messages = context[historyKey].map(normalizeMessage);
    stats.totalMessages = messages.length;
    const merged = [];
    for (const message of messages) {
      if (isThinkingMessage(message)) {
        stats.removedThinking += 1;
        continue;
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
    const start = Math.max(compressible.length - keepLastTurns, 0);
    const kept = [...anchors, ...compressible.slice(start)];
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

  async _compressWithLLM(context, options = {}) {
    const maxInputChars = Number.isFinite(options.maxInputChars)
      ? options.maxInputChars
      : DEFAULT_MAX_INPUT_CHARS;
    const contextText = safeStringify(context).slice(0, maxInputChars);
    const prompt = [
      "Summarize the agent context into JSON with keys: summary, keyPoints, decisions, errors.",
      "Preserve key decisions, findings, and errors.",
      `Max tokens: ${this.maxTokens}.`,
      "Context:",
      contextText,
    ].join("\n");

    let raw = null;
    try {
      raw = await this._callModel([{ role: "user", content: prompt }]);
    } catch {
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

  async _callModel(messages) {
    if (this.modelRouter && typeof this.modelRouter.call === "function") {
      try {
        const resp = await this.modelRouter.call({ usage: "cicada_summary", messages });
        return resp?.content ?? resp?.text ?? resp;
      } catch (err) {
        if (this.modelRouter.call.length >= 2) {
          const resp = await this.modelRouter.call(messages, { usage: "cicada_summary" });
          return resp?.content ?? resp?.text ?? resp;
        }
        throw err;
      }
    }
    if (this.modelRouter && typeof this.modelRouter.chat === "function") {
      const resp = await this.modelRouter.chat(messages);
      return resp?.content ?? resp?.text ?? resp;
    }
    return null;
  }

  async archive(stageKey, data) {
    const key = toNonEmptyString(stageKey) || makeSecureTimestampedId("archive");
    const adapter = this.archiveAdapter;

    const resolvedTimestamp = (() => {
      const raw = data?.timestamp;
      if (typeof raw === "number" && Number.isFinite(raw)) return raw;
      const ms = this._toTimestampMs(raw);
      return ms !== null ? ms : Date.now();
    })();

    // 增加元数据：时间戳和摘要
    const entry = {
      ...data,
      timestamp: resolvedTimestamp,
      summary: data.metadata?.llmSummary?.summary || data.summary || "",
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

  async restore(stageKey) {
    const key = toNonEmptyString(stageKey);
    if (!key) return null;
    const adapter = this.archiveAdapter;
    if (adapter) {
      if (typeof adapter.load === "function") return adapter.load(key);
      if (typeof adapter.get === "function") return adapter.get(key);
      if (typeof adapter.restore === "function") return adapter.restore(key);
    }
    return this._archiveStore.get(key) ?? null;
  }

  /**
   * 列出所有存档（支持过滤）
   * @param {Object} options 
   * @returns {Promise<Array>}
   */
  async listArchives(options = {}) {
    const { limit = 10, pattern = "" } = options;
    const all = [];

    // 从内存 store 中获取
    for (const [key, entry] of this._archiveStore.entries()) {
      all.push({
        id: key,
        timestamp: entry.timestamp,
        summary: entry.summary,
        stageKey: entry.stageKey,
      });
    }

    // 如果有适配器，可能需要特殊的列出逻辑（这里先处理内存部分）
    let filtered = all;
    if (pattern) {
      const regex = new RegExp(pattern, "i");
      filtered = all.filter(e => regex.test(e.summary) || regex.test(e.id));
    }

    filtered.sort((a, b) => b.timestamp - a.timestamp);
    return filtered.slice(0, limit);
  }

  /**
   * 构建 Handoff 交接文档
   * @param {Object} state - agent 状态
   * @param {Object} sharedContext - 共享上下文
   * @returns {Object} handoff 文档
   */
  buildHandoff(state, sharedContext) {
    const todos = Array.isArray(state?.todos) ? state.todos : [];
    const pending = todos.filter(t => t.status !== "done" && t.status !== "completed");
    const completed = todos.filter(t => t.status === "done" || t.status === "completed");

    return {
      runId: state?.runId,
      timestamp: new Date().toISOString(),

      // 已完成
      accomplished: {
        summary: sharedContext?.buildSummaryText?.() || state?.L1?.condensedMemory?.summary || "",
        completedTodos: completed.map(t => t.content || t.title || t.text),
        claimCount: state?.L1?.claims?.length || 0,
      },

      // 待办
      pending: {
        todos: pending.map(t => ({ content: t.content || t.title || t.text, priority: t.priority })),
        taskGoal: state?.taskGoal || "",
      },

      // 关键决策（最近5条）
      decisions: sharedContext?.getDecisions?.()?.slice(-5) || state?.L1?.condensedMemory?.decisionTrace || [],

      // 继续指南
      resumeGuide: {
        nextAction: pending[0]?.content || pending[0]?.title || pending[0]?.text || null,
        context: sharedContext?.getAllSummaries?.() || {},
        warnings: state?.L2?.warnings || [],
        iteration: state?.iteration || 0,
      },
    };
  }
}

export default CicadaCompressor;
