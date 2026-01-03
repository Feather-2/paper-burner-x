/**
 * Compression Async - 异步压缩封装
 *
 * 提供 Web Worker 加速的 SESSION_HISTORY 压缩。
 * 在浏览器环境使用 Worker，Node.js 环境回退到同步执行。
 */

function isNodeLike() {
  return typeof process !== "undefined" && !!process.versions?.node;
}

function canUseWorker() {
  return !isNodeLike() && typeof Worker !== "undefined" && typeof URL !== "undefined";
}

let _compressionWorker = null;
let _compressionWorkerSeq = 0;
const _compressionPending = new Map(); // id -> {resolve, reject}

function getCompressionWorker() {
  if (_compressionWorker) return _compressionWorker;
  if (!canUseWorker()) return null;

  try {
    const worker = new Worker(new URL("./compression.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const msg = event?.data;
      const id = msg?.id;
      const pending = _compressionPending.get(id);
      if (!pending) return;
      _compressionPending.delete(id);
      if (msg?.ok) {
        pending.resolve({
          messages: msg.messages,
          sessionSummary: msg.sessionSummary,
          stats: msg.stats,
          afterTokens: msg.afterTokens,
        });
      } else {
        pending.reject(new Error(msg?.error || "compression worker error"));
      }
    };
    worker.onerror = (err) => {
      for (const pending of _compressionPending.values()) {
        try {
          pending.reject(err instanceof Error ? err : new Error(String(err?.message || err)));
        } catch {
          // ignore
        }
      }
      _compressionPending.clear();
      try {
        worker.terminate();
      } catch {
        // ignore
      }
      _compressionWorker = null;
    };
    _compressionWorker = worker;
    return worker;
  } catch {
    return null;
  }
}

/**
 * 终止 Worker（用于清理资源）
 */
export function terminateCompressionWorker() {
  if (!_compressionWorker) return;
  try {
    for (const pending of _compressionPending.values()) {
      pending.reject(new Error("Worker terminated"));
    }
    _compressionPending.clear();
    _compressionWorker.terminate();
  } catch {
    // ignore
  } finally {
    _compressionWorker = null;
  }
}

/**
 * 检查 Worker 是否可用
 */
export function isCompressionWorkerAvailable() {
  return canUseWorker();
}

/**
 * SESSION_HISTORY 同步压缩（作为回退）
 * 复制自 compression.worker.js 核心逻辑
 */
function compressSessionHistorySync(messages, options = {}) {
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

  const normalizeMessage = (msg) => {
    if (typeof msg === "string") return { role: "assistant", content: msg };
    if (msg && typeof msg === "object") {
      const content = msg.content ?? msg.text ?? "";
      return { ...msg, content: String(content) };
    }
    return { role: "assistant", content: "" };
  };

  const isThinkingMessage = (msg) => {
    if (!msg || typeof msg !== "object") return false;
    if (msg.thinking === true || msg.internal === true) return true;
    if (msg.type === "thinking") return true;
    if (msg.meta && msg.meta.type === "thinking") return true;
    const content = String(msg.content || msg.text || "").trim();
    if (!content) return false;
    return /^<(think|analysis)>/i.test(content) || /^(thoughts?|analysis|internal):/i.test(content);
  };

  const isMergeSafeMessage = (msg) => {
    if (!msg || typeof msg !== "object") return false;
    const keys = Object.keys(msg);
    for (const key of keys) {
      if (key === "role" || key === "content") continue;
      return false;
    }
    return true;
  };

  const isContextSummaryMessage = (msg) => {
    if (!msg || typeof msg !== "object") return false;
    if (msg.role !== "system") return false;
    const content = String(msg.content || "").trim();
    return content.startsWith("[Context Summary]");
  };

  const containsCjk = (text) => /[\u4e00-\u9fff]/.test(String(text || ""));

  const toTitle = (text, opts = {}) => {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    const maxW = opts.maxWords || 10;
    const maxC = opts.maxChars || 80;
    if (containsCjk(normalized)) {
      const clipped = normalized.slice(0, maxC);
      return clipped + (normalized.length > clipped.length ? "..." : "");
    }
    const words = normalized.split(" ").filter(Boolean);
    const sliced = words.slice(0, maxW).join(" ");
    const clipped = sliced.length > maxC ? sliced.slice(0, maxC) : sliced;
    const truncated = words.length > maxW || normalized.length > clipped.length;
    return clipped + (truncated ? "..." : "");
  };

  const truncateText = (text, maxChars) => {
    if (typeof text !== "string") return "";
    if (text.length <= maxChars) return text;
    if (maxChars <= 3) return text.slice(0, maxChars);
    const head = Math.floor(maxChars * 0.6);
    const tail = Math.max(0, maxChars - head - 3);
    return text.slice(0, head) + "..." + (tail ? text.slice(text.length - tail) : "");
  };

  const summarizeMessages = (msgs, lineLimit, sopts) => {
    const lines = [];
    for (const msg of msgs) {
      const role = String(msg.role || "unknown");
      const content = String(msg.content || "").replace(/\s+/g, " ").trim();
      if (!content) continue;
      const line = sopts.titleOnly
        ? `${role}: ${toTitle(content, { maxWords: sopts.titleMaxWords, maxChars: sopts.titleMaxChars })}`
        : `${role}: ${truncateText(content, lineLimit)}`;
      lines.push(line);
    }
    return lines.join("\n");
  };

  const normalized = messages.map(normalizeMessage);
  stats.totalMessages = normalized.length;

  // Merge consecutive same-role messages
  const merged = [];
  for (const msg of normalized) {
    if (isThinkingMessage(msg)) {
      stats.removedThinking += 1;
      continue;
    }
    const last = merged[merged.length - 1];
    const canMerge =
      last &&
      last.role === msg.role &&
      msg.role !== "system" &&
      msg.role !== "tool" &&
      isMergeSafeMessage(last) &&
      isMergeSafeMessage(msg);
    if (canMerge) {
      last.content = [last.content, msg.content].filter(Boolean).join("\n");
      stats.mergedMessages += 1;
    } else {
      merged.push({ ...msg });
    }
  }

  // Anchors: keep leading system prompts
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

  let sessionSummary = null;
  if (older.length) {
    const summary = summarizeMessages(older, summaryLineChars, { titleOnly, titleMaxWords, titleMaxChars });
    const existing = String(options.sessionSummary || "").trim();
    sessionSummary = existing ? `${existing}\n${summary}` : summary;
  }

  // Estimate tokens
  let afterTokens = 0;
  for (const msg of kept) {
    const s = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i);
      if (code >= 0x4e00 && code <= 0x9fff) {
        afterTokens += 1.6;
      } else {
        afterTokens += 0.25;
      }
    }
  }
  afterTokens = Math.ceil(afterTokens);

  return {
    messages: kept,
    sessionSummary,
    stats,
    afterTokens,
  };
}

/**
 * 异步压缩 SESSION_HISTORY
 *
 * @param {Array} messages - 消息数组
 * @param {object} options - 压缩选项
 * @param {number} [options.keepLastTurns=6]
 * @param {boolean} [options.titleOnly=false]
 * @param {string} [options.sessionSummary] - 已有摘要
 * @param {object} [runtime] - 运行时选项
 * @param {AbortSignal} [runtime.signal]
 * @param {boolean} [runtime.useWorker=true]
 * @param {number} [runtime.workerThresholdMessages=50]
 * @returns {Promise<{messages:Array,sessionSummary:string|null,stats:object,afterTokens:number}>}
 */
export async function compressSessionHistoryAsync(messages, options = {}, runtime = {}) {
  const signal = runtime?.signal;
  if (signal?.aborted) throw new Error("compressSessionHistoryAsync: aborted");

  const threshold =
    typeof runtime?.workerThresholdMessages === "number" &&
    Number.isFinite(runtime.workerThresholdMessages) &&
    runtime.workerThresholdMessages > 0
      ? Math.floor(runtime.workerThresholdMessages)
      : 50;

  const useWorker = runtime?.useWorker !== false;
  const worker = useWorker ? getCompressionWorker() : null;

  // 消息数量少于阈值，同步执行
  if (!worker || messages.length < threshold) {
    return compressSessionHistorySync(messages, options);
  }

  const id = `compress_${Date.now().toString(36)}_${++_compressionWorkerSeq}`;
  const promise = new Promise((resolve, reject) => {
    _compressionPending.set(id, { resolve, reject });
  });

  const abort = () => {
    const pending = _compressionPending.get(id);
    if (!pending) return;
    _compressionPending.delete(id);
    pending.reject(new Error("aborted"));
  };

  if (signal) {
    signal.addEventListener("abort", abort, { once: true });
  }

  try {
    worker.postMessage({
      id,
      messages,
      options: {
        keepLastTurns: options.keepLastTurns,
        titleOnly: options.titleOnly,
        titleMaxWords: options.titleMaxWords,
        titleMaxChars: options.titleMaxChars,
        summaryLineChars: options.summaryLineChars,
        sessionSummary: options.sessionSummary,
      },
    });
    return await promise;
  } catch (err) {
    // Worker 失败，回退到同步
    console.warn("[compression-async] Worker failed, falling back to sync:", err?.message);
    return compressSessionHistorySync(messages, options);
  } finally {
    if (signal) {
      signal.removeEventListener("abort", abort);
    }
  }
}

function isContextSummaryMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.role !== "system") return false;
  const content = String(message.content || "").trim();
  return content.startsWith("[Context Summary]");
}

function extractContextSummaryBody(message) {
  if (!isContextSummaryMessage(message)) return "";
  const raw = String(message?.content ?? "");
  const newline = raw.indexOf("\n");
  return newline >= 0 ? raw.slice(newline + 1).trim() : "";
}

function stripPersistedOutputPreview(text) {
  const s = String(text || "");
  const persistedIdx = s.indexOf("\"persistedOutput\"");
  if (persistedIdx < 0) return s;

  const previewKey = "\"preview\"";
  const idx = s.indexOf(previewKey, persistedIdx);
  if (idx < 0) return s;

  const colon = s.indexOf(":", idx + previewKey.length);
  if (colon < 0) return s;

  let i = colon + 1;
  while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] !== "\"") return s; // only handle string value

  const start = i + 1;
  i = start;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\"") break;
    i += 1;
  }
  if (i >= s.length) return s;

  const endQuote = i;
  return s.slice(0, start) + "(omitted)" + s.slice(endQuote);
}

function truncateAtLineBoundary(text, maxChars) {
  const s = typeof text === "string" ? text : String(text ?? "");
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(0, Math.floor(Number(maxChars))) : 0;
  if (!limit || s.length <= limit) return { text: s, truncated: false };
  const head = s.slice(0, limit);
  const minKeep = Math.max(0, Math.floor(limit * 0.6));
  const newline = head.lastIndexOf("\n");
  const space = head.lastIndexOf(" ");
  const cut = newline >= minKeep ? newline : space >= minKeep ? space : limit;
  return { text: s.slice(0, cut) + "\n...(truncated)", truncated: true };
}

function sanitizeKeptMessages(messages, maxKeptMessageChars) {
  const maxChars = Number.isFinite(Number(maxKeptMessageChars)) ? Math.max(0, Math.floor(Number(maxKeptMessageChars))) : 0;
  if (!maxChars) return messages;

  return messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    if (msg.role === "system") return msg;
    const raw = stripPersistedOutputPreview(msg.content);
    const { text } = truncateAtLineBoundary(raw, maxChars);
    return text === msg.content ? msg : { ...msg, content: text };
  });
}

/**
 * AgentLoop message compression (SESSION_HISTORY) with Context Summary handling.
 *
 * - Excludes existing "[Context Summary]" messages from the compression input.
 * - Preserves and carries forward any prior summary text.
 * - Appends the summary message at the end to keep the prompt prefix stable.
 */
export async function compressAgentLoopMessagesAsync(messages, options = {}, runtime = {}) {
  const list = Array.isArray(messages) ? messages : [];

  const priorSummaryMsg = list.find(isContextSummaryMessage);
  const priorSummary = extractContextSummaryBody(priorSummaryMsg);

  // Exclude prior summaries from the compression input (they are derived).
  const messagesForCompression = list.filter((msg) => !isContextSummaryMessage(msg));

  const result = await compressSessionHistoryAsync(
    messagesForCompression,
    {
      keepLastTurns: options.keepLastTurns,
      titleOnly: options.titleOnly,
      titleMaxWords: options.titleMaxWords,
      titleMaxChars: options.titleMaxChars,
      summaryLineChars: options.summaryLineChars,
      sessionSummary: priorSummary,
    },
    runtime
  );

  const baseMessages = Array.isArray(result?.messages) ? result.messages : messagesForCompression;
  const sanitized = sanitizeKeptMessages(baseMessages, options.maxKeptMessageChars);

  let sessionSummary = typeof result?.sessionSummary === "string" ? result.sessionSummary.trim() : "";
  if (!sessionSummary && priorSummary) sessionSummary = priorSummary;

  const summaryMsg = sessionSummary
    ? { role: "system", content: `[Context Summary]\n${sessionSummary}` }
    : null;

  return {
    messages: summaryMsg ? [...sanitized, summaryMsg] : sanitized,
    sessionSummary: sessionSummary || null,
    stats: result?.stats || null,
    afterTokens: result?.afterTokens,
  };
}

export { compressSessionHistorySync };
export default compressSessionHistoryAsync;
