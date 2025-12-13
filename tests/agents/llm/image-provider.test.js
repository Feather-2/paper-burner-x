const test = require("node:test");
const assert = require("node:assert/strict");

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
    _dump: () => Object.fromEntries(store.entries()),
  };
}

test("GeminiImageAdapter: success returns normalized result and sends aspectRatio/imageSize", async () => {
  const { GeminiImageAdapter } = await import("../../../js/agents/llm/image-provider.js");

  const calls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return makeResponse({
      jsonData: {
        candidates: [
          {
            content: {
              parts: [{ inline_data: { mime_type: "image/png", data: "BASE64_GEMINI" } }],
            },
          },
        ],
      },
    });
  };

  try {
    const out = await GeminiImageAdapter(
      { prompt: "a cat", aspectRatio: "16:9", imageSize: "1K" },
      "GEMINI_KEY",
      { model: "gemini-2.5-flash-image", baseUrl: "https://generativelanguage.googleapis.com", timeoutMs: 1234 }
    );

    assert.equal(out.provider, "gemini-image");
    assert.equal(out.model, "gemini-2.5-flash-image");
    assert.equal(out.mimeType, "image/png");
    assert.equal(out.base64, "BASE64_GEMINI");
    assert.equal(out.url, null);
    assert.equal(out.width, 1280);
    assert.equal(out.height, 720);

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1beta\/models\/gemini-2\.5-flash-image:generateContent\?key=GEMINI_KEY$/);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.generationConfig.imageConfig.aspectRatio, "16:9");
    assert.equal(body.generationConfig.imageConfig.imageSize, "1K");
    assert.equal(body.contents[0].parts[0].text, "a cat");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("GeminiImageAdapter: HTTP 429 includes status for rate limit handling", async () => {
  const { GeminiImageAdapter } = await import("../../../js/agents/llm/image-provider.js");

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => makeResponse({ ok: false, status: 429, textData: "rate limited", headers: makeHeaders({}) });

  try {
    await assert.rejects(
      () => GeminiImageAdapter({ prompt: "x" }, "KEY"),
      (err) => {
        assert.equal(err.status, 429);
        assert.match(err.message, /rate limited|429/i);
        return true;
      }
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("GeminiImageAdapter: missing image data fails with a clear error", async () => {
  const { GeminiImageAdapter } = await import("../../../js/agents/llm/image-provider.js");

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    makeResponse({
      jsonData: { candidates: [{ content: { parts: [{ text: "no image" }] }, finishReason: "STOP" }] },
    });

  try {
    await assert.rejects(() => GeminiImageAdapter({ prompt: "x" }, "KEY"), /returned no image/i);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("OpenAIImageAdapter: success (b64_json) returns normalized result and honors size/quality", async () => {
  const { OpenAIImageAdapter } = await import("../../../js/agents/llm/image-provider.js");

  const calls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return makeResponse({ jsonData: { data: [{ b64_json: "BASE64_OPENAI" }] } });
  };

  try {
    const out = await OpenAIImageAdapter({ prompt: "x", size: "1792x1024", quality: "hd" }, "OPENAI_KEY", { timeoutMs: 999 });
    assert.equal(out.provider, "openai-image");
    assert.equal(out.model, "gpt-image-1");
    assert.equal(out.base64, "BASE64_OPENAI");
    assert.equal(out.url, null);
    assert.equal(out.width, 1792);
    assert.equal(out.height, 1024);

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/images\/generations$/);
    const payload = JSON.parse(calls[0].init.body);
    assert.equal(payload.size, "1792x1024");
    assert.equal(payload.quality, "hd");
    assert.equal(payload.response_format, "b64_json");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("OpenAIImageAdapter: success (url) returns normalized result", async () => {
  const { OpenAIImageAdapter } = await import("../../../js/agents/llm/image-provider.js");

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => makeResponse({ jsonData: { data: [{ url: "https://example.com/i.png" }] } });

  try {
    const out = await OpenAIImageAdapter({ prompt: "x", responseFormat: "url" }, "OPENAI_KEY");
    assert.equal(out.base64, null);
    assert.equal(out.url, "https://example.com/i.png");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("OpenAIImageAdapter: HTTP 401/403 surfaces invalid key errors with status", async () => {
  const { OpenAIImageAdapter } = await import("../../../js/agents/llm/image-provider.js");

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    makeResponse({
      ok: false,
      status: 403,
      jsonData: { error: { message: "invalid_api_key" } },
      headers: makeHeaders({ "content-type": "application/json" }),
    });

  try {
    await assert.rejects(
      () => OpenAIImageAdapter({ prompt: "x" }, "BAD"),
      (err) => {
        assert.equal(err.status, 403);
        assert.match(err.message, /invalid_api_key/i);
        return true;
      }
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("ImageProvider: provider switching routes to correct adapter", async () => {
  const { ImageProvider } = await import("../../../js/agents/llm/image-provider.js");

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      return makeResponse({ jsonData: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "G" } }] } }] } });
    }
    if (String(url).includes("/v1/images/generations")) {
      return makeResponse({ jsonData: { data: [{ b64_json: "O" }] } });
    }
    throw new Error(`unexpected url: ${url}`);
  };

  try {
    const gem = new ImageProvider({ provider: "gemini-image", apiKey: "K1" });
    const out1 = await gem.generate({ prompt: "p1" });
    assert.equal(out1.base64, "G");

    const oa = new ImageProvider({ provider: "openai-image", apiKey: "K2" });
    const out2 = await oa.generate({ prompt: "p2" });
    assert.equal(out2.base64, "O");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("ImageProvider: timeout converts AbortError into TimeoutError with ETIMEDOUT", async () => {
  const { ImageProvider } = await import("../../../js/agents/llm/image-provider.js");

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        },
        { once: true }
      );
    });

  try {
    const p = new ImageProvider({ provider: "openai-image", apiKey: "K" });
    await assert.rejects(
      () => p.generate({ prompt: "x" }, { timeoutMs: 10 }),
      (err) => {
        assert.equal(err.name, "TimeoutError");
        assert.equal(err.code, "ETIMEDOUT");
        assert.match(err.message, /Timed out/i);
        return true;
      }
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("createImageProviderFromConfig: default provider is gemini-image; can load apiKey from model manager", async () => {
  const { createImageProviderFromConfig, IMAGE_PROVIDER_STORAGE_KEY } = await import("../../../js/agents/llm/image-provider.js");

  const prevLocalStorage = globalThis.localStorage;
  const prevLoadModelKeys = globalThis.loadModelKeys;

  globalThis.localStorage = makeLocalStorage({});
  globalThis.loadModelKeys = () => [{ id: "k1", value: "KEY_FROM_STORE", status: "ok" }];

  try {
    const p1 = createImageProviderFromConfig();
    assert.equal(p1.provider, "gemini-image");
    assert.equal(p1.apiKey, "KEY_FROM_STORE");

    globalThis.localStorage.setItem(
      IMAGE_PROVIDER_STORAGE_KEY,
      JSON.stringify({ provider: "openai-image", model: "gpt-image-1", apiKey: "" })
    );
    const p2 = createImageProviderFromConfig();
    assert.equal(p2.provider, "openai-image");
    assert.equal(p2.apiKey, "KEY_FROM_STORE");
    assert.equal(p2.model, "gpt-image-1");
  } finally {
    globalThis.localStorage = prevLocalStorage;
    globalThis.loadModelKeys = prevLoadModelKeys;
  }
});

test("createImageProviderFromConfig: invalid JSON falls back to gemini-image", async () => {
  const { createImageProviderFromConfig, IMAGE_PROVIDER_STORAGE_KEY } = await import("../../../js/agents/llm/image-provider.js");

  const prevLocalStorage = globalThis.localStorage;
  globalThis.localStorage = makeLocalStorage({ [IMAGE_PROVIDER_STORAGE_KEY]: "{bad json" });
  try {
    const p = createImageProviderFromConfig();
    assert.equal(p.provider, "gemini-image");
  } finally {
    globalThis.localStorage = prevLocalStorage;
  }
});

test("ImageProvider: unknown provider errors; isAvailable covers key presence and status", async () => {
  const { ImageProvider } = await import("../../../js/agents/llm/image-provider.js");

  await assert.rejects(() => new ImageProvider({ provider: "unknown", apiKey: "k" }).generate({ prompt: "x" }), /Unknown image provider/i);

  const p0 = new ImageProvider({ provider: "gemini-image", apiKey: "" });
  assert.equal(await p0.isAvailable(), false);

  const calls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/v1beta/models?key=")) return makeResponse({ ok: true, status: 200, jsonData: { models: [] } });
    if (String(url).includes("/v1/models")) return makeResponse({ ok: false, status: 401, jsonData: { error: { message: "bad" } } });
    return makeResponse({ ok: false, status: 500, textData: "oops" });
  };

  try {
    const pg = new ImageProvider({ provider: "gemini-image", apiKey: "G" });
    assert.equal(await pg.isAvailable(), true);

    const po = new ImageProvider({ provider: "openai-image", apiKey: "O" });
    assert.equal(await po.isAvailable(), false);

    assert.ok(calls.some((u) => u.includes("/v1beta/models?key=G")));
    assert.ok(calls.some((u) => u.includes("/v1/models")));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

