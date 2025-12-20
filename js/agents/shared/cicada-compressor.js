import { isPlainObject, toNonEmptyString } from "./value-utils.js";
import { robustParseJson } from "./robust-json.js";

export const CompressionPriority = Object.freeze({
  TOOL_OUTPUT: "tool_output",
  CONVERSATION_HISTORY: "conversation_history",
  QUESTION_CONTEXT: "question_context",
  STRUCTURED_OUTPUT: "structured_output",
});

export const MemoryLayer = Object.freeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
  INDEXED: "indexed",
});

const DEFAULT_THRESHOLDS = Object.freeze({
  autoCompressAt: 0.7,
  minRetainRatio: 0.1,
  maxSummaryTokens: 2000,
  maxInputChars: 12000,
});

const SUMMARY_TEMPLATE = {
  primaryIntent: "string",
  technicalConcepts: ["string"],
  filesAndCode: [{ file: "string", action: "string", summary: "string" }],
  errorsAndFixes: [{ error: "string", fix: "string", userFeedback: "string" }],
  problemSolving: "string",
  userMessages: ["string"],
  pendingTasks: ["string"],
  currentWork: "string",
  nextSteps: ["string"],
};

function createEmptySummary() {
  return {
    primaryIntent: "",
    technicalConcepts: [],
    filesAndCode: [],
    errorsAndFixes: [],
    problemSolving: "",
    userMessages: [],
    pendingTasks: [],
    currentWork: "",
    nextSteps: [],
  };
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeFileEntries(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (isPlainObject(item)) {
      return {
        file: String(item.file || "").trim(),
        action: String(item.action || "").trim(),
        summary: String(item.summary || "").trim(),
      };
    }
    return { file: String(item || "").trim(), action: "", summary: "" };
  });
}

function normalizeErrorEntries(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (isPlainObject(item)) {
      return {
        error: String(item.error || "").trim(),
        fix: String(item.fix || "").trim(),
        userFeedback: String(item.userFeedback || "").trim(),
      };
    }
    return { error: String(item || "").trim(), fix: "", userFeedback: "" };
  });
}

function normalizeSummary(raw, fallback) {
  const base = createEmptySummary();
  const src = isPlainObject(raw) ? raw : fallback;
  if (!isPlainObject(src)) return base;

  base.primaryIntent = toNonEmptyString(src.primaryIntent) || toNonEmptyString(src.summary) || "";
  base.technicalConcepts = normalizeList(src.technicalConcepts);
  base.filesAndCode = normalizeFileEntries(src.filesAndCode);
  base.errorsAndFixes = normalizeErrorEntries(src.errorsAndFixes);
  base.problemSolving = toNonEmptyString(src.problemSolving) || "";
  base.userMessages = normalizeList(src.userMessages);
  base.pendingTasks = normalizeList(src.pendingTasks);
  base.currentWork = toNonEmptyString(src.currentWork) || "";
  base.nextSteps = normalizeList(src.nextSteps);

  return base;
}

function safeStringify(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value || "");
  }
}

function collectMatches(text, regex, sink, mapper = (v) => v) {
  const matches = text.matchAll(regex);
  for (const match of matches) {
    const val = mapper(match[1] || match[0]);
    if (val) sink.add(val);
  }
}

function rankKeywords(text, max = 12) {
  const tokens = text.toLowerCase().match(/\b[a-z][a-z0-9_-]{2,}\b/g) || [];
  const stopwords = new Set([
    "the",
    "and",
    "with",
    "from",
    "that",
    "this",
    "which",
    "into",
    "for",
    "use",
    "using",
    "used",
    "are",
    "was",
    "were",
    "has",
    "have",
    "had",
    "then",
    "than",
    "but",
    "not",
    "can",
    "will",
    "should",
    "could",
    "may",
    "might",
  ]);
  const counts = new Map();
  for (const token of tokens) {
    if (stopwords.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([word]) => word);
}

export class CicadaCompressor {
  constructor({ modelRouter, eventBus, archive, thresholds } = {}) {
    this.modelRouter = modelRouter || null;
    this.eventBus = eventBus || null;
    this.archive = archive || null;
    this.thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...(isPlainObject(thresholds) ? thresholds : {}),
    };
  }

  shouldAutoCompress(contextSize, threshold = this.thresholds.autoCompressAt) {
    const size = Number(contextSize);
    const limit = Number(threshold);
    if (!Number.isFinite(size) || !Number.isFinite(limit) || limit <= 0) return false;
    return size >= limit;
  }

  getCompressionStrategy(contentType) {
    const t = String(contentType || "").trim().toLowerCase();
    if (t === "tool_output" || t === "tool-output" || t === "tool") {
      return { priority: CompressionPriority.TOOL_OUTPUT, layer: MemoryLayer.ACTIVE, retain: "recent", keepToolRounds: 2 };
    }
    if (t === "conversation_history" || t === "conversation" || t === "history") {
      return { priority: CompressionPriority.CONVERSATION_HISTORY, layer: MemoryLayer.ARCHIVED, retain: "anchors" };
    }
    if (t === "question_context" || t === "context" || t === "question") {
      return { priority: CompressionPriority.QUESTION_CONTEXT, layer: MemoryLayer.ARCHIVED, retain: "summary" };
    }
    if (t === "structured_output" || t === "structured" || t === "output") {
      return { priority: CompressionPriority.STRUCTURED_OUTPUT, layer: MemoryLayer.INDEXED, retain: "latest" };
    }
    return { priority: CompressionPriority.QUESTION_CONTEXT, layer: MemoryLayer.ARCHIVED, retain: "summary" };
  }

  async compress(stageKey, processMemory, options = {}) {
    const stage = toNonEmptyString(stageKey) || "unknown";
    const content = isPlainObject(processMemory) && "content" in processMemory
      ? processMemory.content
      : processMemory;
    const contentType = options?.contentType || processMemory?.contentType || processMemory?.type;
    const strategy = this.getCompressionStrategy(contentType);
    const rawText = safeStringify(content);
    const originalSize = rawText.length;

    const summary = await this.generateSummary(content, stage);
    const keyIndex = this.extractKeyIndex(content);
    const summaryText = typeof summary === "string" ? summary : JSON.stringify(summary);
    const compressedSize = summaryText.length;
    const compressionRatio = originalSize > 0 ? compressedSize / originalSize : 0;

    let archiveId = null;
    if (this.archive && typeof this.archive.store === "function") {
      try {
        archiveId = await this.archive.store(stage, {
          content,
          meta: { stage, strategy, originalSize, compressedSize, timestamp: Date.now() },
        });
      } catch {
        archiveId = null;
      }
    }

    const sharedContext = options?.sharedContext || null;
    if (sharedContext) {
      if (typeof sharedContext.setSummary === "function") {
        sharedContext.setSummary(stage, summaryText);
      }
      if (typeof sharedContext.setIndex === "function") {
        sharedContext.setIndex(stage, keyIndex);
      }
      if (typeof sharedContext.clearStore === "function") {
        sharedContext.clearStore(stage);
      }
      if (typeof sharedContext.signal === "function") {
        sharedContext.signal(stage, {
          type: "CICADA_SHED",
          timestamp: Date.now(),
          originalSize,
          compressedSize,
          compressionRatio,
          archiveId,
        });
      }
    }

    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit("CICADA_SHED", {
        stageKey: stage,
        summary,
        keyIndex,
        strategy,
        archiveId,
        originalSize,
        compressedSize,
        compressionRatio,
      });
    }

    return { summary, keyIndex, archiveId, strategy, compressionRatio };
  }

  async generateSummary(content, stageKey) {
    const stage = toNonEmptyString(stageKey) || "unknown";
    const contentText = safeStringify(content).slice(0, this.thresholds.maxInputChars);
    const prompt = [
      `Summarize the ${stage} stage content into a JSON object with exactly these keys:`,
      JSON.stringify(SUMMARY_TEMPLATE, null, 2),
      `Constraints: keep critical facts, names, numbers, and decisions.`,
      `Output JSON only. Max ${this.thresholds.maxSummaryTokens} tokens.`,
      `Content:`,
      contentText,
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
    const fallback = this._buildFallbackSummary(content, stage);
    return normalizeSummary(parsed, fallback);
  }

  extractKeyIndex(content) {
    const text = safeStringify(content);
    const ids = new Set();
    const paths = new Set();

    collectMatches(text, /"(?:id|_id|uuid|key)"\s*:\s*"([^\"]+)"/gi, ids, (v) => v.trim());
    collectMatches(text, /"(?:id|_id|uuid|key)"\s*:\s*(\d+)/gi, ids);
    collectMatches(text, /\b[a-z][a-z0-9]+_[0-9]{2,}\b/gi, ids, (v) => v.toLowerCase());
    collectMatches(text, /\b[a-f0-9]{8,}\b/gi, ids, (v) => v.toLowerCase());

    collectMatches(
      text,
      /(?:[A-Za-z]:)?[\\/](?:[^\s"'`]+[\\/])*[^\s"'`]+\.[A-Za-z0-9]+/g,
      paths,
      (v) => v.trim()
    );
    collectMatches(text, /\b[\w.-]+(?:\/[\w.-]+)+\b/g, paths, (v) => v.trim());

    return {
      ids: Array.from(ids).sort(),
      keywords: rankKeywords(text),
      paths: Array.from(paths).sort(),
    };
  }

  _buildFallbackSummary(content, stage) {
    const index = this.extractKeyIndex(content);
    return {
      primaryIntent: `Summarize ${stage} content`,
      technicalConcepts: index.keywords.slice(0, 8),
      filesAndCode: index.paths.map((path) => ({ file: path, action: "referenced", summary: "" })),
      errorsAndFixes: [],
      problemSolving: "",
      userMessages: [],
      pendingTasks: [],
      currentWork: "",
      nextSteps: [],
    };
  }

  async _callModel(messages) {
    if (this.modelRouter && typeof this.modelRouter.call === "function") {
      try {
        const resp = await this.modelRouter.call({ usage: "summarizer", messages });
        return resp?.content ?? resp?.text ?? resp;
      } catch (err) {
        if (this.modelRouter.call.length >= 2) {
          const resp = await this.modelRouter.call(messages, { usage: "summarizer" });
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
}

export default CicadaCompressor;
