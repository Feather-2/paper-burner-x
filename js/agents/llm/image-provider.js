/**
 * Image Provider - 图像生成适配器（独立 Provider 模式）
 *
 * 设计原则：
 * - 统一接口：generate(request, opts) -> { provider, model, mimeType, base64?, url?, width, height }
 * - 多后端适配：Gemini generateContent / OpenAI images generations
 * - 前端友好：纯 fetch 调用（支持超时、常见错误码）
 */

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function sanitizeBaseUrl(url, fallback) {
  const raw = toNonEmptyString(url) || toNonEmptyString(fallback) || "";
  return raw.replace(/\/+$/, "");
}

function parseSizeString(size) {
  const s = toNonEmptyString(size);
  if (!s) return null;
  const m = s.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

function deriveGeminiDimensions({ aspectRatio, imageSize, width, height } = {}) {
  const explicitW = typeof width === "number" && width > 0 ? Math.floor(width) : null;
  const explicitH = typeof height === "number" && height > 0 ? Math.floor(height) : null;
  if (explicitW && explicitH) return { width: explicitW, height: explicitH };

  const ar = aspectRatio || "1:1";
  const size = imageSize || "1K";
  const scale = size === "2K" ? 2 : 1;

  if (ar === "1:1") return { width: 1024 * scale, height: 1024 * scale };
  if (ar === "16:9") return { width: 1280 * scale, height: 720 * scale };
  if (ar === "4:3") return { width: 1024 * scale, height: 768 * scale };
  return { width: 1024 * scale, height: 1024 * scale };
}

function toTimeoutMs(v, fallback = 30_000) {
  if (typeof v === "number" && v > 0) return Math.floor(v);
  return fallback;
}

function makeTimeoutError(message, { timeoutMs, cause } = {}) {
  const err = new Error(message || "Network timeout");
  err.name = "TimeoutError";
  err.code = "ETIMEDOUT";
  err.timeoutMs = timeoutMs;
  if (cause) err.cause = cause;
  return err;
}

async function fetchWithTimeout(url, init = {}, { timeoutMs } = {}) {
  const ms = toTimeoutMs(timeoutMs);
  const parentSignal = init?.signal;
  const ctrl = new AbortController();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      ctrl.abort();
    } catch {
      // ignore
    }
  }, ms);

  const abortFromParent = () => {
    try {
      ctrl.abort();
    } catch {
      // ignore
    }
  };

  if (parentSignal && typeof parentSignal.addEventListener === "function") {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (timedOut || (e && typeof e === "object" && e.name === "AbortError")) {
      throw makeTimeoutError(`Timed out after ${ms}ms`, { timeoutMs: ms, cause: e });
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (parentSignal && typeof parentSignal.removeEventListener === "function") parentSignal.removeEventListener("abort", abortFromParent);
  }
}

async function buildHttpError(resp, defaultMsg) {
  const status = resp?.status;
  try {
    const contentType = resp?.headers?.get ? resp.headers.get("content-type") || "" : "";
    if (contentType.includes("application/json") && typeof resp.json === "function") {
      const data = await resp.json();
      const msg =
        data?.error?.message ||
        data?.message ||
        data?.error ||
        (typeof data === "string" ? data : null) ||
        `${defaultMsg} (${status})`;
      const err = new Error(String(msg));
      err.status = status;
      err.data = data;
      return err;
    }
    const text = typeof resp.text === "function" ? await resp.text() : "";
    const err = new Error(text || `${defaultMsg} (${status})`);
    err.status = status;
    err.data = text;
    return err;
  } catch (e) {
    const err = new Error(`${defaultMsg} (${status})`);
    err.status = status;
    err.cause = e instanceof Error ? e : undefined;
    return err;
  }
}

export const IMAGE_PROVIDER_STORAGE_KEY = "imageProviderConfig";

export const GEMINI_ASPECT_RATIOS = Object.freeze(["16:9", "1:1", "4:3"]);
export const GEMINI_IMAGE_SIZES = Object.freeze(["1K", "2K"]);

export const OPENAI_SIZES = Object.freeze(["1024x1024", "1792x1024", "1024x1792"]);
export const OPENAI_QUALITIES = Object.freeze(["standard", "hd"]);

function assertEnumValue(value, allowed, { name, fallback } = {}) {
  const v = toNonEmptyString(value) || fallback;
  if (!v) return undefined;
  if (!allowed.includes(v)) throw new TypeError(`${name || "value"} must be one of: ${allowed.join(", ")}`);
  return v;
}

/**
 * Gemini 图像生成适配器：v1beta generateContent
 * @param {Object} request
 * @param {string} apiKey
 * @param {Object} [opts]
 * @returns {Promise<{provider: string, model: string, mimeType: string, base64?: string, url?: string, width: number, height: number}>}
 */
export async function GeminiImageAdapter(request, apiKey, opts = {}) {
  if (!isPlainObject(request)) throw new TypeError("GeminiImageAdapter(request): request must be an object");
  const prompt = toNonEmptyString(request.prompt);
  if (!prompt) throw new TypeError("GeminiImageAdapter(request): request.prompt is required");
  if (!toNonEmptyString(apiKey)) throw new Error("GeminiImageAdapter: API key is required");

  const modelId = toNonEmptyString(request.model) || toNonEmptyString(opts.model) || "gemini-2.5-flash-image";
  const baseUrl = sanitizeBaseUrl(opts.baseUrl, "https://generativelanguage.googleapis.com");
  const endpoint = `${baseUrl}/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const aspectRatio = assertEnumValue(request.aspectRatio ?? opts.aspectRatio, GEMINI_ASPECT_RATIOS, { name: "aspectRatio", fallback: "1:1" });
  const imageSize = assertEnumValue(request.imageSize ?? opts.imageSize, GEMINI_IMAGE_SIZES, { name: "imageSize", fallback: "1K" });

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio, imageSize },
    },
  };

  const resp = await fetchWithTimeout(
    endpoint,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    { timeoutMs: opts.timeoutMs }
  );

  if (!resp.ok) throw await buildHttpError(resp, "Gemini image generation failed");

  const data = await resp.json();
  const parts =
    data?.candidates?.[0]?.content?.parts ||
    data?.candidates?.[0]?.parts ||
    data?.contents?.[0]?.parts ||
    [];

  const imgPart = Array.isArray(parts) ? parts.find((p) => p && (p.inlineData || p.inline_data)) : null;
  const inline = imgPart?.inlineData || imgPart?.inline_data || null;
  const base64 = toNonEmptyString(inline?.data);
  if (!base64) {
    const finish = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || "";
    const detail = toNonEmptyString(finish) || "no image data returned";
    const err = new Error(`Gemini returned no image: ${detail}`);
    err.data = data;
    throw err;
  }

  const mimeType = toNonEmptyString(inline?.mimeType || inline?.mime_type) || "image/png";
  const dims = deriveGeminiDimensions({
    aspectRatio,
    imageSize,
    width: request.width,
    height: request.height,
  });

  return {
    provider: "gemini-image",
    model: modelId,
    mimeType,
    base64,
    url: null,
    width: dims.width,
    height: dims.height,
  };
}

/**
 * OpenAI 图像生成适配器：/v1/images/generations
 * @param {Object} request
 * @param {string} apiKey
 * @param {Object} [opts]
 * @returns {Promise<{provider: string, model: string, mimeType: string, base64?: string, url?: string, width: number, height: number}>}
 */
export async function OpenAIImageAdapter(request, apiKey, opts = {}) {
  if (!isPlainObject(request)) throw new TypeError("OpenAIImageAdapter(request): request must be an object");
  const prompt = toNonEmptyString(request.prompt);
  if (!prompt) throw new TypeError("OpenAIImageAdapter(request): request.prompt is required");
  if (!toNonEmptyString(apiKey)) throw new Error("OpenAIImageAdapter: API key is required");

  const modelId = toNonEmptyString(request.model) || toNonEmptyString(opts.model) || "gpt-image-1";
  const baseUrl = sanitizeBaseUrl(opts.baseUrl, "https://api.openai.com");
  const endpoint = `${baseUrl}/v1/images/generations`;

  const size = assertEnumValue(request.size ?? opts.size, OPENAI_SIZES, { name: "size", fallback: "1024x1024" });
  const quality = assertEnumValue(request.quality ?? opts.quality, OPENAI_QUALITIES, { name: "quality", fallback: "standard" });
  const responseFormat = assertEnumValue(request.responseFormat ?? opts.responseFormat, ["b64_json", "url"], { name: "responseFormat", fallback: "b64_json" });

  const payload = { model: modelId, prompt, size, n: 1, response_format: responseFormat, quality };

  const resp = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    },
    { timeoutMs: opts.timeoutMs }
  );

  if (!resp.ok) throw await buildHttpError(resp, "OpenAI image generation failed");

  const data = await resp.json();
  const first = data?.data?.[0] || null;
  const base64 = toNonEmptyString(first?.b64_json) || null;
  const url = toNonEmptyString(first?.url) || null;

  if (!base64 && !url) {
    const err = new Error("OpenAI returned no image data");
    err.data = data;
    throw err;
  }

  const dims = parseSizeString(size) || { width: 1024, height: 1024 };
  const outW = typeof request.width === "number" && request.width > 0 ? Math.floor(request.width) : dims.width;
  const outH = typeof request.height === "number" && request.height > 0 ? Math.floor(request.height) : dims.height;

  return {
    provider: "openai-image",
    model: modelId,
    mimeType: "image/png",
    base64,
    url,
    width: outW,
    height: outH,
  };
}

// ============ Provider Registry ============

const PROVIDER_ADAPTERS = {
  "gemini-image": GeminiImageAdapter,
  gemini: GeminiImageAdapter,
  "openai-image": OpenAIImageAdapter,
  openai: OpenAIImageAdapter,
};

// ============ Main Class ============

export class ImageProvider {
  /**
   * @param {Object} opts
   * @param {string} opts.provider - 'gemini-image' | 'openai-image' | aliases: 'gemini' | 'openai'
   * @param {string} opts.apiKey
   * @param {string} [opts.model]
   * @param {string} [opts.baseUrl]
   */
  constructor(opts = {}) {
    this.provider = toNonEmptyString(opts.provider)?.toLowerCase() || "gemini-image";
    this.apiKey = toNonEmptyString(opts.apiKey) || "";
    this.model = toNonEmptyString(opts.model);
    this.baseUrl = toNonEmptyString(opts.baseUrl);
    this.id = `image_${this.provider}`;
    this.name = opts.name || `Image (${this.provider})`;
  }

  /**
   * 生成图像
   * @param {Object} request
   * @param {Object} [opts]
   */
  async generate(request, opts = {}) {
    if (!isPlainObject(request)) throw new TypeError("ImageProvider.generate(): request must be an object");
    if (!this.apiKey) throw new Error(`ImageProvider (${this.provider}): API key is required`);

    const adapter = PROVIDER_ADAPTERS[this.provider];
    if (!adapter) throw new Error(`Unknown image provider: ${this.provider}`);

    const mergedOpts = {
      model: this.model,
      baseUrl: this.baseUrl,
      ...opts,
    };
    return adapter(request, this.apiKey, mergedOpts);
  }

  /**
   * 检查 provider 是否可用（API key 有效性）
   * @returns {Promise<boolean>}
   */
  async isAvailable() {
    if (!this.apiKey) return false;

    try {
      if (this.provider === "gemini-image" || this.provider === "gemini") {
        const baseUrl = sanitizeBaseUrl(this.baseUrl, "https://generativelanguage.googleapis.com");
        const endpoint = `${baseUrl}/v1beta/models?key=${encodeURIComponent(this.apiKey)}`;
        const resp = await fetchWithTimeout(endpoint, { method: "GET" }, { timeoutMs: 10_000 });
        return resp.ok;
      }
      if (this.provider === "openai-image" || this.provider === "openai") {
        const baseUrl = sanitizeBaseUrl(this.baseUrl, "https://api.openai.com");
        const endpoint = `${baseUrl}/v1/models`;
        const resp = await fetchWithTimeout(
          endpoint,
          { method: "GET", headers: { Authorization: `Bearer ${this.apiKey}` } },
          { timeoutMs: 10_000 }
        );
        return resp.ok;
      }
      return true;
    } catch {
      return false;
    }
  }
}

// ============ Factory Functions ============

export function createImageProvider(config) {
  return new ImageProvider(config);
}

export function createImageProviderFromConfig({ storage, keyLoader, storageKey = IMAGE_PROVIDER_STORAGE_KEY } = {}) {
  let config = null;
  try {
    const store = storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const raw = store?.getItem?.(storageKey);
    if (raw) config = JSON.parse(raw);
  } catch {
    // ignore
  }

  if (!isPlainObject(config)) config = { provider: "gemini-image" };
  if (!toNonEmptyString(config.provider)) config.provider = "gemini-image";

  const loader = typeof keyLoader === "function" ? keyLoader : typeof loadModelKeys === "function" ? loadModelKeys : null;
  if (!toNonEmptyString(config.apiKey) && loader) {
    const providerKeyMap = {
      "gemini-image": "gemini",
      gemini: "gemini",
      "openai-image": "openai",
      openai: "openai",
    };
    const modelKey = providerKeyMap[String(config.provider).toLowerCase()] || config.provider;
    const keys = loader(modelKey) || [];
    const validKey = keys.find((k) => k && k.status !== "invalid" && toNonEmptyString(k.value));
    if (validKey) config.apiKey = validKey.value;
  }

  return new ImageProvider(config);
}
