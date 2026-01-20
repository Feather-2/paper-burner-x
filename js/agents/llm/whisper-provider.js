/**
 * Whisper Provider - 音频转录适配器
 * 支持 ElevenLabs Scribe、Groq Whisper 等多种后端
 *
 * 设计原则：
 * - 统一接口：transcribe(file, opts) -> { text, segments, language, duration }
 * - 支持故障转移：多 provider 按优先级尝试
 * - 前端友好：纯浏览器调用，无需代理
 */

import { safeJsonParse } from "../shared/index.js";

import { isPlainObject, toNonEmptyString } from "../shared/index.js";

/**
 * Sanitize baseUrl - only clean up URL format, no host allowlist restriction.
 * The host allowlist was removed because users need to use OpenAI-compatible
 * endpoints (LocalAI, ollama, oneapi, etc.) which would be blocked.
 */
function sanitizeBaseUrl(url, fallback) {
  const raw = toNonEmptyString(url) || toNonEmptyString(fallback) || "";
  if (!raw) return "";
  const trimmed = raw.replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    // Only allow http/https protocols
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("protocol");
    }
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname.replace(/\/+$/, "") : "";
    return `${parsed.origin}${path}`;
  } catch {
    const safeFallback = toNonEmptyString(fallback) || "";
    return safeFallback.replace(/\/+$/, "");
  }
}
// ============ Provider Adapters ============

/**
 * ElevenLabs Scribe 适配器
 * Docs: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 */
async function elevenLabsAdapter(file, apiKey, opts = {}) {
  const endpoint = "https://api.elevenlabs.io/v1/speech-to-text";
  const modelId = opts.model || "scribe_v1";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model_id", modelId);

  if (opts.language) {
    formData.append("language_code", opts.language);
  }
  if (opts.diarize) {
    formData.append("diarize", "true");
  }
  if (opts.timestamps !== false) {
    formData.append("timestamps_granularity", opts.timestampGranularity || "word");
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: formData,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    const err = new Error(`ElevenLabs STT failed: ${resp.status} ${errText}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();

  // 标准化输出
  const segments = (data.words || []).map((w, i) => ({
    index: i,
    text: w.text || "",
    startSec: w.start || 0,
    endSec: w.end || 0,
    type: w.type || "word",
    confidence: w.logprob !== undefined ? Math.exp(w.logprob) : undefined,
  }));

  // 计算总时长
  const lastWord = segments[segments.length - 1];
  const durationSec = lastWord ? lastWord.endSec : 0;

  return {
    provider: "elevenlabs",
    model: modelId,
    text: data.text || "",
    language: data.language_code || null,
    languageConfidence: data.language_probability || null,
    segments,
    durationSec,
    transcriptionId: data.transcription_id || null,
    raw: data,
  };
}

/**
 * Groq Whisper 适配器
 * Docs: https://console.groq.com/docs/speech-text
 */
async function groqWhisperAdapter(file, apiKey, opts = {}) {
  const endpoint = "https://api.groq.com/openai/v1/audio/transcriptions";
  const modelId = opts.model || "whisper-large-v3";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", modelId);
  formData.append("response_format", "verbose_json");

  if (opts.language) {
    formData.append("language", opts.language);
  }
  if (opts.prompt) {
    formData.append("prompt", opts.prompt);
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    const err = new Error(`Groq Whisper failed: ${resp.status} ${errText}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();

  // 标准化 segments
  const segments = (data.segments || []).map((seg, i) => ({
    index: i,
    text: seg.text || "",
    startSec: seg.start || 0,
    endSec: seg.end || 0,
    confidence: seg.avg_logprob !== undefined ? Math.exp(seg.avg_logprob) : undefined,
  }));

  return {
    provider: "groq",
    model: modelId,
    text: data.text || "",
    language: data.language || null,
    languageConfidence: null,
    segments,
    durationSec: data.duration || 0,
    transcriptionId: null,
    raw: data,
  };
}

/**
 * OpenAI Whisper 适配器
 */
async function openaiWhisperAdapter(file, apiKey, opts = {}) {
  const baseUrl = sanitizeBaseUrl(opts.baseUrl, "https://api.openai.com");
  const endpoint = `${baseUrl}/v1/audio/transcriptions`;
  const modelId = opts.model || "whisper-1";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("model", modelId);
  formData.append("response_format", "verbose_json");

  if (opts.language) {
    formData.append("language", opts.language);
  }
  if (opts.prompt) {
    formData.append("prompt", opts.prompt);
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    const err = new Error(`OpenAI Whisper failed: ${resp.status} ${errText}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();

  const segments = (data.segments || []).map((seg, i) => ({
    index: i,
    text: seg.text || "",
    startSec: seg.start || 0,
    endSec: seg.end || 0,
    confidence: seg.avg_logprob !== undefined ? Math.exp(seg.avg_logprob) : undefined,
  }));

  return {
    provider: "openai",
    model: modelId,
    text: data.text || "",
    language: data.language || null,
    languageConfidence: null,
    segments,
    durationSec: data.duration || 0,
    transcriptionId: null,
    raw: data,
  };
}

// ============ Provider Registry ============

const PROVIDER_ADAPTERS = {
  elevenlabs: elevenLabsAdapter,
  groq: groqWhisperAdapter,
  openai: openaiWhisperAdapter,
  "openai-compatible": openaiWhisperAdapter,
};

// ============ Main Class ============

export class WhisperProvider {
  /**
   * @param {Object} opts
   * @param {string} opts.provider - 'elevenlabs' | 'groq' | 'openai' | 'openai-compatible'
   * @param {string} opts.apiKey - API key
   * @param {string} [opts.model] - 模型 ID
   * @param {string} [opts.baseUrl] - 自定义 API 基础 URL（openai-compatible）
   */
  constructor(opts = {}) {
    this.provider = toNonEmptyString(opts.provider) || "elevenlabs";
    this.apiKey = toNonEmptyString(opts.apiKey) || "";
    this.model = toNonEmptyString(opts.model);
    this.baseUrl = toNonEmptyString(opts.baseUrl);
    this.baseUrlTrusted = opts.baseUrlTrusted !== false;
    this.id = `whisper_${this.provider}`;
    this.name = opts.name || `Whisper (${this.provider})`;
    this.capabilities = ["transcribe"];
  }

  /**
   * 转录音频文件
   * @param {File|Blob} file - 音频文件
   * @param {Object} [opts] - 附加选项
   * @returns {Promise<Object>} 标准化转录结果
   */
  async transcribe(file, opts = {}) {
    if (!file) {
      throw new TypeError("WhisperProvider.transcribe(): file is required");
    }
    if (!this.apiKey) {
      throw new Error(`WhisperProvider (${this.provider}): API key is required`);
    }

    const adapter = PROVIDER_ADAPTERS[this.provider];
    if (!adapter) {
      throw new Error(`Unknown whisper provider: ${this.provider}`);
    }

    const mergedOpts = {
      model: this.model,
      baseUrl: this.baseUrl,
      baseUrlTrusted: this.baseUrlTrusted,
      ...opts,
    };

    return adapter(file, this.apiKey, mergedOpts);
  }

  /**
   * Unified entrypoint for provider integrations.
   * - call({type:"transcribe", file, opts}) -> transcribe(file, opts)
   * - call(file, opts) -> transcribe(file, opts)
   */
  async call(input, opts = {}) {
    const payload = isPlainObject(input) ? input : null;
    const type = toNonEmptyString(payload?.type || payload?.capability || payload?.method) || "transcribe";
    if (type === "transcribe" || type === "transcribeAudio" || type === "audio") {
      const file = payload?.file || payload?.blob || input;
      const extraOpts = isPlainObject(payload?.opts) ? payload.opts : opts;
      return this.transcribe(file, extraOpts);
    }
    throw new Error(`WhisperProvider.call(): unsupported type "${type}"`);
  }

  /**
   * 检查 provider 是否可用（API key 有效性）
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    if (!this.apiKey) return false;

    try {
      if (this.provider === "elevenlabs") {
        const resp = await fetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": this.apiKey },
        });
        return resp.ok;
      }
      if (this.provider === "groq") {
        const resp = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        return resp.ok;
      }
      // OpenAI / compatible - 不做检查，假设可用
      return true;
    } catch {
      return false;
    }
  }
}

// ============ Factory Function ============

/**
 * 创建 WhisperProvider 实例
 * @param {Object} config
 * @returns {WhisperProvider}
 */
export function createWhisperProvider(config) {
  return new WhisperProvider(config);
}

/**
 * 从全局模型配置创建 WhisperProvider
 * 读取 localStorage 中的配置
 * @param {object} [options] - 配置选项
 * @param {Storage|null} [options.storage] - 存储对象，默认 localStorage
 * @param {((provider: string) => Array<{value: string, status?: string}>)|null} [options.keyLoader] - API 密钥加载器
 * @param {string} [options.storageKey] - 存储键名
 * @returns {WhisperProvider}
 */
export function createWhisperProviderFromConfig({ storage, keyLoader, storageKey = "whisperProviderConfig" } = {}) {
  // 尝试读取已保存的配置
  let config = null;

  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const raw = store?.getItem?.(storageKey);
    if (raw) {
      const parsed = safeJsonParse(raw, { maxChars: 200_000 });
      if (isPlainObject(parsed)) config = parsed;
    }
  } catch {
    // ignore
  }

  // 默认使用 ElevenLabs
  if (!config) {
    config = { provider: "elevenlabs" };
  }
  if (toNonEmptyString(config.baseUrl)) config.baseUrlTrusted = false;

  // 尝试从模型管理获取 API key
  const loader = typeof keyLoader === "function" ? keyLoader : typeof loadModelKeys === "function" ? loadModelKeys : null;
  if (!config.apiKey && loader) {
    const providerKeyMap = {
      elevenlabs: "elevenlabs",
      groq: "groq",
      openai: "openai",
    };
    const modelKey = providerKeyMap[config.provider] || config.provider;
    const keys = loader(modelKey) || [];
    const validKey = keys.find((k) => k.status !== "invalid" && k.value);
    if (validKey) {
      config.apiKey = validKey.value;
    }
  }

  return new WhisperProvider(config);
}

// ============ Utilities ============

/**
 * 将标准化结果转为 LRC 格式
 * @param {Array<{startSec: number, text: string}>} segments - 转录分段
 * @returns {string} LRC 格式字符串
 */
export function segmentsToLrc(segments) {
  return segments
    .map((s) => {
      const mm = Math.floor(s.startSec / 60);
      const ss = (s.startSec % 60).toFixed(2);
      const ts = `[${String(mm).padStart(2, "0")}:${String(ss).padStart(5, "0")}]`;
      return `${ts}${s.text.trim()}`;
    })
    .filter((line) => !line.endsWith("]"))
    .join("\n");
}

/**
 * 将标准化结果转为 SRT 格式
 * @param {Array<{startSec: number, endSec: number, text: string}>} segments - 转录分段
 * @returns {string} SRT 格式字符串
 */
export function segmentsToSrt(segments) {
  return segments
    .map((s, i) => {
      const formatTime = (sec) => {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const secs = sec % 60;
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${secs.toFixed(3).padStart(6, "0").replace(".", ",")}`;
      };
      return `${i + 1}\n${formatTime(s.startSec)} --> ${formatTime(s.endSec)}\n${s.text.trim()}\n`;
    })
    .join("\n");
}
