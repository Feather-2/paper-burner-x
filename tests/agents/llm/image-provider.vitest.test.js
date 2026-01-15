import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GeminiImageAdapter,
  ImageProvider,
  OpenAIImageAdapter,
  createImageProvider,
  createImageProviderFromConfig,
} from "../../../js/agents/llm/image-provider.js";

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

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  // For tests that set timers (timeouts / delayMs).
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Cleanup any global helper that createImageProviderFromConfig might read.
  try {
    delete globalThis.loadModelKeys;
  } catch {
    // ignore
  }
});

describe("agents/llm/image-provider", () => {
  it("GeminiImageAdapter: success returns normalized result and sends aspectRatio/imageSize", async () => {
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
    expect(calls[0].url).toContain("https://example.com/v1beta/models/gemini-model-x:generateContent");
    const body = JSON.parse(calls[0].init.body);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: "16:9", imageSize: "2K" });
  });

  it("GeminiImageAdapter: explicit width/height override derived dimensions and default mimeType", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        jsonData: {
          candidates: [{ content: { parts: [{ inlineData: { data: "b64-no-mime" } }] } }],
        },
      })
    );

    const out = await GeminiImageAdapter(
      { prompt: "x", aspectRatio: "1:1", imageSize: "1K", width: 123, height: 456 },
      "k",
      { model: "gemini-any" }
    );

    expect(out.mimeType).toBe("image/png");
    expect(out.width).toBe(123);
    expect(out.height).toBe(456);
  });

  it("GeminiImageAdapter: derives dimensions for 1:1 and 4:3", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        jsonData: {
          candidates: [{ content: { parts: [{ inlineData: { data: "b64" } }] } }],
        },
      })
    );

    const out11 = await GeminiImageAdapter({ prompt: "x", aspectRatio: "1:1", imageSize: "1K" }, "k");
    expect(out11.width).toBe(1024);
    expect(out11.height).toBe(1024);

    const out43 = await GeminiImageAdapter({ prompt: "x", aspectRatio: "4:3", imageSize: "1K" }, "k");
    expect(out43.width).toBe(1024);
    expect(out43.height).toBe(768);
  });

  it("GeminiImageAdapter: tolerates invalid aspectRatio/imageSize by falling back and still returns sensible dims (covers default branch)", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({
        jsonData: {
          candidates: [{ content: { parts: [{ inlineData: { data: "b64" } }] } }],
        },
      });
    });

    const out = await GeminiImageAdapter({ prompt: "x", aspectRatio: "9:16", imageSize: "4K" }, "k");
    expect(out.width).toBe(1024);
    expect(out.height).toBe(1024);

    const body = JSON.parse(calls[0].init.body);
    // Unknown values are normalized for the API request.
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: "1:1", imageSize: "1K" });
  });

  it("GeminiImageAdapter: non-ok response throws parsed JSON http error", async () => {
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

  it("GeminiImageAdapter: missing image data throws a helpful error with response attached", async () => {
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

  it("GeminiImageAdapter: timeout wraps AbortError into TimeoutError", async () => {
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

    const p = GeminiImageAdapter({ prompt: "x" }, "k", { timeoutMs: 5 });
    // Attach the rejection handler before advancing timers to avoid transient unhandled rejections.
    const assertion = expect(p).rejects.toMatchObject({ name: "TimeoutError", code: "ETIMEDOUT", timeoutMs: 5 });
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
  });

  it("GeminiImageAdapter: respects parent abort signal already aborted (covers abortFromParent immediate branch)", async () => {
    const parent = new AbortController();
    parent.abort();

    globalThis.fetch = vi.fn(async (url, init) => {
      if (init?.signal?.aborted) {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      return makeResponse({
        jsonData: {
          candidates: [{ content: { parts: [{ inlineData: { data: "b64" } }] } }],
        },
      });
    });

    await expect(GeminiImageAdapter({ prompt: "x" }, "k", { signal: parent.signal, timeoutMs: 123 })).rejects.toMatchObject({
      name: "TimeoutError",
      code: "ETIMEDOUT",
      timeoutMs: 123,
    });
  });

  it("GeminiImageAdapter: aborts in-flight request when parent signal fires (covers abort listener branch)", async () => {
    const parent = new AbortController();

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

    const p = GeminiImageAdapter({ prompt: "x" }, "k", { signal: parent.signal, timeoutMs: 321 });
    // Attach the rejection handler before aborting to avoid transient unhandled rejections.
    const assertion = expect(p).rejects.toMatchObject({ name: "TimeoutError", code: "ETIMEDOUT", timeoutMs: 321 });
    parent.abort();
    await assertion;
  });

  it("fetchWithTimeout(): rethrows non-abort errors (via Gemini adapter)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(GeminiImageAdapter({ prompt: "x" }, "k", { timeoutMs: 5 })).rejects.toThrow(/network down/i);
  });

  it("OpenAIImageAdapter: supports b64_json and url response formats", async () => {
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

    expect(calls[0].url).toBe("https://openai.example.com/v1/images/generations");
    expect(calls[0].init.headers.Authorization).toContain("Bearer");
  });

  it("OpenAIImageAdapter: rejects invalid enums and missing image data", async () => {
    globalThis.fetch = vi.fn(async () => makeResponse({ jsonData: { data: [{}] } }));

    await expect(OpenAIImageAdapter({ prompt: "x", size: "999x999" }, "k")).rejects.toThrow(/size must be one of/i);
    await expect(OpenAIImageAdapter({ prompt: "x" }, "k")).rejects.toThrow(/OpenAI returned no image data/i);
  });

  it("buildHttpError(): uses text fallback when content-type isn't JSON (via OpenAI adapter)", async () => {
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

  it("buildHttpError(): handles broken JSON body parsing (via OpenAI adapter)", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      headers: makeHeaders({ "content-type": "application/json" }),
      json: async () => {
        throw new Error("bad json");
      },
      text: async () => "ignored",
    }));

    await expect(OpenAIImageAdapter({ prompt: "x" }, "k")).rejects.toMatchObject({
      message: "OpenAI image generation failed (400)",
      status: 400,
    });
  });

  it("ImageProvider.generate()/call(): validates apiKey/provider/type and forwards to adapter", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        jsonData: {
          candidates: [{ content: { parts: [{ inlineData: { data: "b64" } }] } }],
        },
      })
    );

    const p = new ImageProvider({ provider: "gemini-image", apiKey: "k" });
    await expect(p.generate("nope")).rejects.toThrow(/request must be an object/i);
    await expect(new ImageProvider({ provider: "gemini-image", apiKey: "" }).generate({ prompt: "x" })).rejects.toThrow(/API key is required/i);
    await expect(new ImageProvider({ provider: "unknown", apiKey: "k" }).generate({ prompt: "x" })).rejects.toThrow(/Unknown image provider/i);

    const out1 = await p.call({ type: "generate", request: { prompt: "x" } });
    expect(out1.provider).toBe("gemini-image");

    const out2 = await p.call({ prompt: "x" });
    expect(out2.provider).toBe("gemini-image");

    await expect(p.call({ type: "nope" })).rejects.toThrow(/unsupported type/i);
  });

  it("ImageProvider.isAvailable(): checks credentials via provider-specific endpoints", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({ ok: true, status: 200, jsonData: {} });
    });

    const gem = new ImageProvider({ provider: "gemini-image", apiKey: "k", baseUrl: "https://g.example.com///" });
    expect(await gem.isAvailable()).toBe(true);
    expect(calls[0].url).toContain("https://g.example.com/v1beta/models?key=");

    const oai = new ImageProvider({ provider: "openai-image", apiKey: "k2", baseUrl: "https://o.example.com///" });
    expect(await oai.isAvailable()).toBe(true);
    expect(calls[1].url).toBe("https://o.example.com/v1/models");
    expect(calls[1].init.headers.Authorization).toContain("Bearer");

    // Network errors are treated as unavailable.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    expect(await gem.isAvailable()).toBe(false);
  });

  it("ImageProvider.isAvailable(): returns true for unknown providers (best-effort)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("should not be called");
    });

    const p = new ImageProvider({ provider: "custom", apiKey: "k" });
    expect(await p.isAvailable()).toBe(true);
  });

  it("createImageProvider(): returns an ImageProvider instance", () => {
    const p = createImageProvider({ provider: "gemini-image", apiKey: "k" });
    expect(p).toBeInstanceOf(ImageProvider);
  });

  it("createImageProviderFromConfig(): loads config from storage and falls back to keyLoader", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ provider: "openai-image" })),
    };
    const keyLoader = vi.fn((provider) => {
      if (provider === "openai") return [{ status: "invalid", value: "bad" }, { status: "ok", value: "k_openai" }];
      return [];
    });

    const p = createImageProviderFromConfig({ storage, keyLoader, storageKey: "k" });
    expect(p.provider).toBe("openai-image");
    expect(p.apiKey).toBe("k_openai");
    expect(keyLoader).toHaveBeenCalledWith("openai");
  });

  it("createImageProviderFromConfig(): defaults config when JSON is bad and respects explicit apiKey", () => {
    const storage = { getItem: vi.fn(() => "{not-json") };
    const keyLoader = vi.fn(() => [{ status: "ok", value: "k_g" }]);

    const p = createImageProviderFromConfig({ storage, keyLoader });
    expect(p.provider).toBe("gemini-image");
    expect(p.apiKey).toBe("k_g");

    const storage2 = { getItem: vi.fn(() => JSON.stringify({ provider: "", apiKey: "explicit" })) };
    const p2 = createImageProviderFromConfig({ storage: storage2, keyLoader: () => [{ status: "ok", value: "ignored" }] });
    expect(p2.provider).toBe("gemini-image");
    expect(p2.apiKey).toBe("explicit");
  });

  it("createImageProviderFromConfig(): can use global loadModelKeys when keyLoader is not provided", () => {
    globalThis.loadModelKeys = vi.fn(() => [{ status: "ok", value: "k_global" }]);
    const storage = { getItem: vi.fn(() => JSON.stringify({ provider: "gemini-image" })) };

    const p = createImageProviderFromConfig({ storage });
    expect(p.apiKey).toBe("k_global");
    expect(globalThis.loadModelKeys).toHaveBeenCalled();
  });

  it("createImageProviderFromConfig(): skips key loading when no keyLoader/global loader is available (covers null-loader branch)", () => {
    const storage = { getItem: vi.fn(() => JSON.stringify({ provider: "gemini-image" })) };

    const p = createImageProviderFromConfig({ storage });
    expect(p.provider).toBe("gemini-image");
    expect(p.apiKey).toBe("");
  });

  it("createImageProviderFromConfig(): uses provider as modelKey fallback and handles empty key lists (covers mapping/empty branches)", () => {
    const storage = { getItem: vi.fn(() => JSON.stringify({ provider: "custom" })) };
    const keyLoader = vi.fn(() => null);

    const p = createImageProviderFromConfig({ storage, keyLoader });
    expect(keyLoader).toHaveBeenCalledWith("custom");
    expect(p.provider).toBe("custom");
    expect(p.apiKey).toBe("");
  });
});
