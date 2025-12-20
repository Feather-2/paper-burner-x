import { isPlainObject, toNonEmptyString } from "../shared/value-utils.js";
import { robustParseJson } from "../shared/robust-json.js";
import { CicadaEvents } from "./events.js";

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
  return Math.ceil(text.length / 4);
}

function truncateText(text, maxChars) {
  if (typeof text !== "string") return "";
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.max(0, maxChars - head - 3);
  return text.slice(0, head) + "..." + (tail ? text.slice(text.length - tail) : "");
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

function summarizeMessages(messages, lineLimit) {
  const lines = [];
  for (const msg of messages) {
    const role = String(msg.role || "unknown");
    const content = String(msg.content || "").replace(/\s+/g, " ").trim();
    if (!content) continue;
    const line = `${role}: ${truncateText(content, lineLimit)}`;
    lines.push(line);
  }
  return lines.join("\n");
}

function normalizeLayerList(layers) {
  const list = Array.isArray(layers) ? layers : DEFAULT_LAYERS;
  const requested = new Set(list);
  return DEFAULT_LAYERS.filter((layer) => requested.has(layer));
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
  constructor({ modelRouter, archive, maxTokens, layers, eventBus } = {}) {
    this.modelRouter = modelRouter || null;
    this.archiveAdapter = archive || null;
    this.maxTokens = Number.isFinite(maxTokens) ? maxTokens : DEFAULT_MAX_TOKENS;
    this.layers = normalizeLayerList(layers);
    this.eventBus = eventBus || null;
    this._archiveStore = new Map();
  }

  _emit(name, payload) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(name, { actor: "cicada", status: "completed", payload });
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
      metadata.archiveId = await this.archive(archiveKey, { context: current, metadata });
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
      if (last && last.role === message.role) {
        last.content = [last.content, message.content].filter(Boolean).join("\n");
        stats.mergedMessages += 1;
      } else {
        merged.push({ ...message });
      }
    }

    const start = Math.max(merged.length - keepLastTurns, 0);
    const kept = merged.slice(start);
    const older = merged.slice(0, start);
    stats.keptMessages = kept.length;
    stats.summarizedMessages = older.length;

    const updated = { ...context, [historyKey]: kept };
    if (older.length) {
      const summary = summarizeMessages(older, summaryLineChars);
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
    const key = toNonEmptyString(stageKey) || `archive_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const adapter = this.archiveAdapter;
    if (adapter) {
      if (typeof adapter.store === "function") return adapter.store(key, data);
      if (typeof adapter.set === "function") {
        adapter.set(key, data);
        return key;
      }
      if (typeof adapter.archive === "function") return adapter.archive(key, data);
    }
    this._archiveStore.set(key, data);
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
}

export default CicadaCompressor;
