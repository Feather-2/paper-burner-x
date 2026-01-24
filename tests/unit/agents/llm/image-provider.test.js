import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", () => {
  const isPlainObject = vi.fn((v) => {
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  });

  const toNonEmptyString = vi.fn((v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  });

  const safeJsonParse = vi.fn((value, options) => {
    const opts = options && typeof options === "object" ? options : {};
    const maxChars = Number.isFinite(opts.maxChars) && opts.maxChars > 0 ? Math.floor(opts.maxChars) : 1_000_000;
    if (value === null || value === undefined) return null;
    if (typeof value === "object") return value;
    const raw = typeof value === "string" ? value : String(value);
    const s = raw.trim();
    if (!s) return null;
    if (maxChars !== Infinity && s.length > maxChars) return null;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  });

  return { safeJsonParse, isPlainObject, toNonEmptyString };
});

import * as shared from "../../../../js/agents/shared/index.js";

import {
  GEMINI_ASPECT_RATIOS,
  GEMINI_IMAGE_SIZES,
  GeminiImageAdapter,
  ImageProvider,
  OpenAIImageAdapter,
  IMAGE_PROVIDER_STORAGE_KEY,
  OPENAI_QUALITIES,
  OPENAI_SIZES,
  createImageProvider,
  createImageProviderFromConfig,
} from "../../../../js/agents/llm/image-provider.js";

function makeHeaders(map = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(map)) lower[String(k).toLowerCase()] = String(v);
  return {
    get: (k) => lower[String(k).toLowerCase()] || null,
  };
}

function makeResponse({ ok = true, status = 200, jsonData, textData, headers } = {}) {
  const hdrs = headers || makeHeaders(jsonData ? { "content-type": "application/json" } : {});
  return {
    ok,
    status,
    headers: hdrs,
    json: async () => jsonData,
    text: async () => (textData !== undefined ? String(textData) : jsonData !== undefined ? JSON.stringify(jsonData) : ""),
  };
}

function makeLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(String(k)),
  };
}

const originalFetch = globalThis.fetch;
const hasLocalStorage = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
const originalLocalStorage = globalThis.localStorage;
const hasLoadModelKeys = Object.prototype.hasOwnProperty.call(globalThis, "loadModelKeys");
const originalLoadModelKeys = globalThis.loadModelKeys;

beforeEach(() => {
  globalThis.fetch = originalFetch;

  if (hasLocalStorage) globalThis.localStorage = originalLocalStorage;
  else {
    try {
      delete globalThis.localStorage;
    } catch {
      // ignore
    }
  }

  if (hasLoadModelKeys) globalThis.loadModelKeys = originalLoadModelKeys;
  else {
    try {
      delete globalThis.loadModelKeys;
    } catch {
      // ignore
    }
  }

  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("exports", () => {
  it("should_export_expected_storage_key", () => {
    expect(IMAGE_PROVIDER_STORAGE_KEY).toBe("imageProviderConfig");
  });

  it("should_export_frozen_gemini_aspect_ratios", () => {
    expect(Object.isFrozen(GEMINI_ASPECT_RATIOS)).toBe(true);
    expect(GEMINI_ASPECT_RATIOS).toEqual(["16:9", "1:1", "4:3"]);
  });

  it("should_export_frozen_gemini_image_sizes", () => {
    expect(Object.isFrozen(GEMINI_IMAGE_SIZES)).toBe(true);
    expect(GEMINI_IMAGE_SIZES).toEqual(["1K", "2K"]);
  });

  it("should_export_frozen_openai_sizes", () => {
    expect(Object.isFrozen(OPENAI_SIZES)).toBe(true);
    expect(OPENAI_SIZES).toEqual(["1024x1024", "1792x1024", "1024x1792"]);
  });

  it("should_export_frozen_openai_qualities", () => {
    expect(Object.isFrozen(OPENAI_QUALITIES)).toBe(true);
    expect(OPENAI_QUALITIES).toEqual(["standard", "hd"]);
  });
});

describe("GeminiImageAdapter", () => {
  it("returns normalized result and sends aspectRatio/imageSize", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({
        jsonData: {
          candidates: [
            {
              content: {
                parts: [
                  { text: "ok" },
                  { inlineData: { data: "b64", mimeType: "image/webp" } },
                ],
              },
            },
          ],
        },
      });
    });

    const out = await GeminiImageAdapter(
      { prompt: "a cat", aspectRatio: "16:9", imageSize: "2K", model: "gemini-model-x" },
      "k_gemini",
      { baseUrl: "https://example.com///" }
    );

    expect(out).toMatchObject({
      provider: "gemini-image",
      model: "gemini-model-x",
      mimeType: "image/webp",
      base64: "b64",
      url: null,
      width: 2560,
      height: 1440,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.com/v1beta/models/gemini-model-x:generateContent?key=k_gemini");
    const body = JSON.parse(calls[0].init.body);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: "16:9", imageSize: "2K" });
  });

  it("falls back for invalid enums and ignores non-number width/height", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({
        jsonData: {
          candidates: [{ content: { parts: [{ inlineData: { data: "b64" } }] } }],
        },
      });
    });

    const out = await GeminiImageAdapter(
      { prompt: "x", aspectRatio: "9:16", imageSize: {}, width: "100", height: "200" },
      "k"
    );

    expect(out.width).toBe(1024);
    expect(out.height).toBe(1024);

    const body = JSON.parse(calls[0].init.body);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: "1:1", imageSize: "1K" });
  });

  it("uses explicit numeric width/height and default mimeType when missing", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        jsonData: {
          candidates: [{ content: { parts: [{ inlineData: { data: "b64-no-mime" } }] } }],
        },
      })
    );

    const out = await GeminiImageAdapter({ prompt: "x", width: 123.9, height: 456.2 }, "k", { model: "gemini-any" });

    expect(out.mimeType).toBe("image/png");
    expect(out.width).toBe(123);
    expect(out.height).toBe(456);
  });

  it("ignores zero/negative width/height values", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        jsonData: {
          candidates: [{ content: { parts: [{ inlineData: { data: "b64" } }] } }],
        },
      })
    );

    const out = await GeminiImageAdapter({ prompt: "x", aspectRatio: "16:9", imageSize: "1K", width: 0, height: -1 }, "k");

    expect(out.width).toBe(1280);
    expect(out.height).toBe(720);
  });

  it("validates request, prompt, and apiKey", async () => {
    await expect(GeminiImageAdapter(null, "k")).rejects.toThrow(/request must be an object/i);
    await expect(GeminiImageAdapter([], "k")).rejects.toThrow(/request must be an object/i);
    await expect(GeminiImageAdapter({}, "k")).rejects.toThrow(/request\.prompt is required/i);
    await expect(GeminiImageAdapter({ prompt: "   " }, "k")).rejects.toThrow(/request\.prompt is required/i);
    await expect(GeminiImageAdapter({ prompt: "x" }, " ")).rejects.toThrow(/API key is required/i);
  });

  it("throws parsed HTTP errors", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        ok: false,
        status: 400,
        jsonData: { error: { message: "bad req" } },
      })
    );

    await expect(GeminiImageAdapter({ prompt: "x" }, "k")).rejects.toMatchObject({
      message: "bad req",
      status: 400,
    });
  });

  it("throws when image data is missing", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        jsonData: {
          candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "blocked" }] } }],
        },
      })
    );

    await expect(GeminiImageAdapter({ prompt: "x" }, "k")).rejects.toMatchObject({
      message: expect.stringMatching(/Gemini returned no image/i),
      data: expect.any(Object),
    });
  });

  it("wraps AbortError into TimeoutError", async () => {
    vi.useFakeTimers();

    globalThis.fetch = vi.fn((url, init) => {
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        };
        init?.signal?.addEventListener?.("abort", onAbort, { once: true });
      });
    });

    const pending = GeminiImageAdapter({ prompt: "x" }, "k", { timeoutMs: 5 });
    const assertion = expect(pending).rejects.toMatchObject({ name: "TimeoutError", code: "ETIMEDOUT", timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
  });

  it("supports concurrent calls with long prompts", async () => {
    const longPrompt = "a".repeat(10000);
    const prompts = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const payload = JSON.parse(init.body);
      const promptText = payload.contents[0].parts[0].text;
      prompts.push(promptText);
      const base64 = promptText.length > 1000 ? "LONG" : "SHORT";
      return makeResponse({
        jsonData: {
          candidates: [{ content: { parts: [{ inlineData: { data: base64 } }] } }],
        },
      });
    });

    const [longOut, shortOut] = await Promise.all([
      GeminiImageAdapter({ prompt: longPrompt }, "k"),
      GeminiImageAdapter({ prompt: "short" }, "k"),
    ]);

    expect(longOut.base64).toBe("LONG");
    expect(shortOut.base64).toBe("SHORT");
    expect(prompts).toContain(longPrompt);
    expect(prompts).toContain("short");
  });

  it("ignores untrusted baseUrl host and uses default endpoint", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        jsonData: {
          candidates: [{ content: { parts: [{ inlineData: { data: "b64" } }] } }],
        },
      })
    );

    await GeminiImageAdapter({ prompt: "x" }, "k", { baseUrl: "https://evil.example.com", baseUrlTrusted: false });

    const calledUrl = String(globalThis.fetch.mock.calls[0][0]);
    expect(calledUrl).toContain("https://generativelanguage.googleapis.com/v1beta/models");
  });
});

describe("OpenAIImageAdapter", () => {
  it("supports b64_json and url response formats", async () => {
    const calls = [];
    globalThis.fetch = vi
      .fn()
      .mockImplementationOnce(async (url, init) => {
        calls.push({ url: String(url), init });
        return makeResponse({ jsonData: { data: [{ b64_json: "b64" }] } });
      })
      .mockImplementationOnce(async (url, init) => {
        calls.push({ url: String(url), init });
        return makeResponse({ jsonData: { data: [{ url: "https://img.example/x.png" }] } });
      });

    const out1 = await OpenAIImageAdapter(
      { prompt: "x", size: "1024x1024", quality: "hd", responseFormat: "b64_json", width: 1200, height: 1000 },
      "k_openai",
      { baseUrl: "https://openai.example.com///" }
    );
    expect(out1).toMatchObject({ provider: "openai-image", base64: "b64", url: null, width: 1200, height: 1000 });

    const out2 = await OpenAIImageAdapter({ prompt: "x", responseFormat: "url" }, "k_openai");
    expect(out2).toMatchObject({ provider: "openai-image", url: "https://img.example/x.png" });

    const payload1 = JSON.parse(calls[0].init.body);
    expect(payload1.response_format).toBe("b64_json");
    expect(calls[0].url).toBe("https://openai.example.com/v1/images/generations");
  });

  it("defaults enum values when inputs are empty or null", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({ jsonData: { data: [{ b64_json: "b64" }] } });
    });

    const out = await OpenAIImageAdapter({ prompt: "x", size: "", quality: "   ", responseFormat: null }, "k");
    const payload = JSON.parse(calls[0].init.body);

    expect(payload.size).toBe("1024x1024");
    expect(payload.quality).toBe("standard");
    expect(payload.response_format).toBe("b64_json");
    expect(out.width).toBe(1024);
    expect(out.height).toBe(1024);
  });

  it("validates request, prompt, and apiKey", async () => {
    await expect(OpenAIImageAdapter(null, "k")).rejects.toThrow(/request must be an object/i);
    await expect(OpenAIImageAdapter([], "k")).rejects.toThrow(/request must be an object/i);
    await expect(OpenAIImageAdapter({ prompt: "" }, "k")).rejects.toThrow(/request\.prompt is required/i);
    await expect(OpenAIImageAdapter({ prompt: "x" }, " ")).rejects.toThrow(/API key is required/i);
  });

  it("rejects invalid enums and missing image data", async () => {
    globalThis.fetch = vi.fn(async () => makeResponse({ jsonData: { data: [{}] } }));

    await expect(OpenAIImageAdapter({ prompt: "x", size: "999x999" }, "k")).rejects.toThrow(/size must be one of/i);
    await expect(OpenAIImageAdapter({ prompt: "x" }, "k")).rejects.toThrow(/OpenAI returned no image data/i);
  });

  it("handles text HTTP errors", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        ok: false,
        status: 429,
        headers: makeHeaders({ "content-type": "text/plain" }),
        textData: "rate limited",
      })
    );

    await expect(OpenAIImageAdapter({ prompt: "x" }, "k")).rejects.toMatchObject({
      message: "rate limited",
      status: 429,
    });
  });

  it("ignores invalid width/height and accepts MAX_SAFE_INTEGER", async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementationOnce(async () => makeResponse({ jsonData: { data: [{ b64_json: "b64" }] } }))
      .mockImplementationOnce(async () => makeResponse({ jsonData: { data: [{ b64_json: "b64b" }] } }));

    const out1 = await OpenAIImageAdapter({ prompt: "x", size: "1792x1024", width: 0, height: -1 }, "k");
    expect(out1.width).toBe(1792);
    expect(out1.height).toBe(1024);

    const out2 = await OpenAIImageAdapter(
      { prompt: "x", width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
      "k"
    );
    expect(out2.width).toBe(Number.MAX_SAFE_INTEGER);
    expect(out2.height).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects untrusted baseUrl host and enforces https", async () => {
    globalThis.fetch = vi.fn(async () => makeResponse({ jsonData: { data: [{ b64_json: "b64" }] } }));

    await OpenAIImageAdapter({ prompt: "x" }, "k", { baseUrl: "https://evil.example.com/v1", baseUrlTrusted: false });

    const calledUrl = String(globalThis.fetch.mock.calls[0][0]);
    expect(calledUrl).toBe("https://api.openai.com/v1/images/generations");
  });

  it("returns large base64 payloads intact", async () => {
    const big = "A".repeat(200000);
    globalThis.fetch = vi.fn(async () => makeResponse({ jsonData: { data: [{ b64_json: big }] } }));

    const out = await OpenAIImageAdapter({ prompt: "x" }, "k");
    expect(out.base64).toBe(big);
  });
});

describe("ImageProvider", () => {
  it("validates request, apiKey, and provider", async () => {
    const provider = new ImageProvider({ provider: "gemini-image", apiKey: "k" });
    await expect(provider.generate("nope")).rejects.toThrow(/request must be an object/i);
    await expect(new ImageProvider({ provider: "gemini-image", apiKey: "" }).generate({ prompt: "x" })).rejects.toThrow(/API key is required/i);
    await expect(new ImageProvider({ provider: "unknown", apiKey: "k" }).generate({ prompt: "x" })).rejects.toThrow(/Unknown image provider/i);
  });

  it("merges provider config with per-call opts", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({
        jsonData: {
          candidates: [{ content: { parts: [{ inlineData: { data: "b64" } }] } }],
        },
      });
    });

    const provider = new ImageProvider({
      provider: "gemini-image",
      apiKey: "k",
      model: "model-a",
      baseUrl: "https://base.example.com///",
    });

    const out = await provider.generate({ prompt: "x" }, { model: "model-b", baseUrl: "https://override.example.com///" });

    expect(out.model).toBe("model-b");
    expect(calls[0].url).toBe("https://override.example.com/v1beta/models/model-b:generateContent?key=k");
  });

  it("routes call() to generate and validates type", async () => {
    globalThis.fetch = vi.fn(async () => makeResponse({ jsonData: { data: [{ b64_json: "O" }] } }));

    const provider = new ImageProvider({ provider: "openai-image", apiKey: "k" });

    const out1 = await provider.call({ type: "generate", request: { prompt: "x" } });
    expect(out1.provider).toBe("openai-image");

    const out2 = await provider.call({ capability: "image", request: { prompt: "y" } });
    expect(out2.provider).toBe("openai-image");

    const out3 = await provider.call({ prompt: "z" });
    expect(out3.provider).toBe("openai-image");

    await expect(provider.call({ type: "nope" })).rejects.toThrow(/unsupported type/i);
  });

  it("checks availability for provider-specific endpoints and handles errors", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const urlStr = String(url);
      calls.push({ url: urlStr, init });
      if (urlStr.includes("/v1beta/models?key=")) return makeResponse({ ok: true, status: 200, jsonData: {} });
      if (urlStr.includes("/v1/models")) return makeResponse({ ok: false, status: 401, jsonData: { error: { message: "bad" } } });
      throw new Error("unexpected url");
    });

    const gem = new ImageProvider({ provider: "gemini-image", apiKey: "G", baseUrl: "https://g.example.com///" });
    expect(await gem.isAvailable()).toBe(true);

    const openai = new ImageProvider({ provider: "openai-image", apiKey: "O", baseUrl: "https://o.example.com///" });
    expect(await openai.isAvailable()).toBe(false);

    expect(calls[0].url).toContain("https://g.example.com/v1beta/models?key=G");
    expect(calls[1].url).toBe("https://o.example.com/v1/models");
    expect(calls[1].init.headers.Authorization).toContain("Bearer");
  });

  it("returns false without apiKey and true for unknown providers", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("should not be called");
    });

    const noKey = new ImageProvider({ provider: "gemini-image", apiKey: "" });
    expect(await noKey.isAvailable()).toBe(false);

    const custom = new ImageProvider({ provider: "custom", apiKey: "k" });
    expect(await custom.isAvailable()).toBe(true);
  });

  it("handles rapid consecutive generate calls", async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      const payload = JSON.parse(init.body);
      const base64 = payload.prompt === "p1" ? "A" : "B";
      return makeResponse({ jsonData: { data: [{ b64_json: base64 }] } });
    });

    const provider = new ImageProvider({ provider: "openai-image", apiKey: "k" });
    const first = await provider.generate({ prompt: "p1" });
    const second = await provider.generate({ prompt: "p2" });

    expect(first.base64).toBe("A");
    expect(second.base64).toBe("B");
  });
});

describe("createImageProvider", () => {
  it("creates an ImageProvider instance with defaults", () => {
    const provider = createImageProvider();
    expect(provider).toBeInstanceOf(ImageProvider);
    expect(provider.provider).toBe("gemini-image");
  });

  it("throws on null config", () => {
    expect(() => createImageProvider(null)).toThrow();
  });
});

describe("createImageProviderFromConfig", () => {
  it("uses localStorage with IMAGE_PROVIDER_STORAGE_KEY when storage is omitted", () => {
    const store = makeLocalStorage({
      [IMAGE_PROVIDER_STORAGE_KEY]: JSON.stringify({ provider: "openai-image", apiKey: "KEY_LOCAL" }),
    });
    globalThis.localStorage = store;

    const provider = createImageProviderFromConfig();
    expect(provider.provider).toBe("openai-image");
    expect(provider.apiKey).toBe("KEY_LOCAL");
  });

  it("defaults provider when storage is empty and loads key via keyLoader", () => {
    const storage = { getItem: vi.fn(() => null) };
    const keyLoader = vi.fn((provider) => (provider === "gemini" ? [{ status: "ok", value: "KEY_FROM_LOADER" }] : []));

    const provider = createImageProviderFromConfig({ storage, keyLoader });
    expect(provider.provider).toBe("gemini-image");
    expect(provider.apiKey).toBe("KEY_FROM_LOADER");
    expect(keyLoader).toHaveBeenCalledWith("gemini");
  });

  it("reads stored config and marks baseUrl as untrusted", () => {
    const deep = { provider: "openai-image", model: "gpt-image-1", baseUrl: "https://custom.example.com/api", nested: { a: { b: { c: { d: "x" } } } } };
    const storage = { getItem: vi.fn(() => JSON.stringify(deep)) };

    const provider = createImageProviderFromConfig({ storage, keyLoader: () => [] });
    expect(provider.provider).toBe("openai-image");
    expect(provider.model).toBe("gpt-image-1");
    expect(provider.baseUrl).toBe("https://custom.example.com/api");
    expect(provider.baseUrlTrusted).toBe(false);
  });

  it("uses global loadModelKeys when keyLoader is missing", () => {
    globalThis.loadModelKeys = vi.fn(() => [{ status: "ok", value: "GLOBAL_KEY" }]);
    const storage = { getItem: vi.fn(() => JSON.stringify({ provider: "gemini-image" })) };

    const provider = createImageProviderFromConfig({ storage });
    expect(provider.apiKey).toBe("GLOBAL_KEY");
    expect(globalThis.loadModelKeys).toHaveBeenCalled();
  });

  it("respects explicit apiKey and skips keyLoader", () => {
    const storage = { getItem: vi.fn(() => JSON.stringify({ provider: "openai-image", apiKey: "EXPLICIT" })) };
    const keyLoader = vi.fn(() => [{ status: "ok", value: "IGNORED" }]);

    const provider = createImageProviderFromConfig({ storage, keyLoader });
    expect(provider.apiKey).toBe("EXPLICIT");
    expect(keyLoader).not.toHaveBeenCalled();
  });

  it("defaults when stored config is invalid or not an object", () => {
    const big = `{"provider":"openai-image","pad":"${"x".repeat(200001)}"}`;
    const cases = ["", "{not-json", "[]", "{}", big];

    for (const raw of cases) {
      const storage = { getItem: vi.fn(() => raw) };
      const provider = createImageProviderFromConfig({ storage, keyLoader: () => [] });
      expect(provider.provider).toBe("gemini-image");
    }
  });

  it("handles safeJsonParse throwing", () => {
    const storage = { getItem: vi.fn(() => "{\"provider\":\"openai-image\"}") };
    vi.mocked(shared.safeJsonParse).mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const provider = createImageProviderFromConfig({ storage, keyLoader: () => [] });
    expect(provider.provider).toBe("gemini-image");
  });

  it("uses keyLoader mapping and handles empty results", () => {
    const storage = { getItem: vi.fn(() => JSON.stringify({ provider: "openai-image" })) };
    const keyLoader = vi.fn(() => [{ status: "invalid", value: "bad" }, { status: "ok", value: "good" }]);

    const provider = createImageProviderFromConfig({ storage, keyLoader });
    expect(provider.apiKey).toBe("good");
    expect(keyLoader).toHaveBeenCalledWith("openai");

    const storage2 = { getItem: vi.fn(() => JSON.stringify({ provider: "gemini-image" })) };
    const keyLoader2 = vi.fn(() => []);
    const provider2 = createImageProviderFromConfig({ storage: storage2, keyLoader: keyLoader2 });
    expect(provider2.apiKey).toBe("");
  });

  it("throws when keyLoader returns a non-array object", () => {
    const storage = { getItem: vi.fn(() => JSON.stringify({ provider: "gemini-image" })) };
    const keyLoader = vi.fn(() => ({ value: "bad" }));

    expect(() => createImageProviderFromConfig({ storage, keyLoader })).toThrow();
  });
});