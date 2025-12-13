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

function formDataToObject(fd) {
  const out = {};
  for (const [k, v] of fd.entries()) out[k] = v;
  return out;
}

test("WhisperProvider: constructor defaults and trims config values", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const p0 = new WhisperProvider();
  assert.equal(p0.provider, "elevenlabs");
  assert.equal(p0.apiKey, "");
  assert.equal(p0.model, undefined);
  assert.equal(p0.baseUrl, undefined);
  assert.equal(p0.id, "whisper_elevenlabs");
  assert.equal(p0.name, "Whisper (elevenlabs)");

  const p1 = new WhisperProvider({
    provider: "  groq  ",
    apiKey: "  KEY  ",
    model: "  whisper-large-v3  ",
    baseUrl: "  https://example.com/  ",
    name: "Custom",
  });
  assert.equal(p1.provider, "groq");
  assert.equal(p1.apiKey, "KEY");
  assert.equal(p1.model, "whisper-large-v3");
  assert.equal(p1.baseUrl, "https://example.com/");
  assert.equal(p1.id, "whisper_groq");
  assert.equal(p1.name, "Custom");

  const p2 = new WhisperProvider({ provider: "", apiKey: undefined, model: "   ", baseUrl: null });
  assert.equal(p2.provider, "elevenlabs");
  assert.equal(p2.apiKey, "");
  assert.equal(p2.model, undefined);
  assert.equal(p2.baseUrl, undefined);
});

test("WhisperProvider.transcribe(): validates file, apiKey, and provider selection", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  await assert.rejects(() => new WhisperProvider({ apiKey: "K" }).transcribe(null), /file is required/i);
  await assert.rejects(() => new WhisperProvider({ provider: "groq", apiKey: "" }).transcribe(new Blob(["x"])), /API key is required/i);

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => makeResponse({ ok: true, jsonData: { text: "ok", segments: [], duration: 0, language: "en" } });
  try {
    await assert.rejects(
      () => new WhisperProvider({ provider: "unknown", apiKey: "K" }).transcribe(new Blob(["x"])),
      /Unknown whisper provider/i
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("ElevenLabs adapter: sends FormData + xi-api-key and normalizes segments/duration/language", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const calls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return makeResponse({
      jsonData: {
        text: "hello world",
        words: [
          { text: "hello", start: 0.1, end: 0.5, type: "word", logprob: -0.1 },
          { text: "world", start: 0.6, end: 1.2, type: "word", logprob: -0.2 },
        ],
        language_code: "en",
        language_probability: 0.91,
        transcription_id: "t_123",
      },
    });
  };

  try {
    const file = new Blob(["audio"], { type: "audio/wav" });
    const p = new WhisperProvider({ provider: "elevenlabs", apiKey: "EL_KEY", model: "scribe_v2" });
    const out = await p.transcribe(file, {
      model: "scribe_v3",
      language: "zh",
      diarize: true,
      timestampGranularity: "segment",
    });

    assert.equal(out.provider, "elevenlabs");
    assert.equal(out.model, "scribe_v3");
    assert.equal(out.text, "hello world");
    assert.equal(out.language, "en");
    assert.equal(out.languageConfidence, 0.91);
    assert.equal(out.durationSec, 1.2);
    assert.equal(out.transcriptionId, "t_123");
    assert.equal(out.segments.length, 2);
    assert.deepEqual(
      out.segments.map((s) => ({ index: s.index, text: s.text, startSec: s.startSec, endSec: s.endSec, type: s.type })),
      [
        { index: 0, text: "hello", startSec: 0.1, endSec: 0.5, type: "word" },
        { index: 1, text: "world", startSec: 0.6, endSec: 1.2, type: "word" },
      ]
    );
    assert.ok(out.segments[0].confidence > 0.8 && out.segments[0].confidence < 1);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.elevenlabs.io/v1/speech-to-text");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["xi-api-key"], "EL_KEY");
    assert.ok(calls[0].init.body instanceof FormData);

    const body = formDataToObject(calls[0].init.body);
    assert.ok(body.file);
    assert.equal(body.model_id, "scribe_v3");
    assert.equal(body.language_code, "zh");
    assert.equal(body.diarize, "true");
    assert.equal(body.timestamps_granularity, "segment");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("ElevenLabs adapter: timestamps=false omits timestamps_granularity", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const calls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return makeResponse({ jsonData: { text: "", words: [], language_code: "en" } });
  };

  try {
    const p = new WhisperProvider({ provider: "elevenlabs", apiKey: "K" });
    await p.transcribe(new Blob(["x"]), { timestamps: false });

    const body = formDataToObject(calls[0].init.body);
    assert.ok(!("timestamps_granularity" in body));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("ElevenLabs adapter: HTTP errors include status (401/429/500)", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const file = new Blob(["x"]);
  for (const status of [401, 429, 500]) {
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async () => makeResponse({ ok: false, status, textData: `err_${status}`, headers: makeHeaders({}) });
    try {
      await assert.rejects(
        () => new WhisperProvider({ provider: "elevenlabs", apiKey: "K" }).transcribe(file),
        (err) => {
          assert.equal(err.status, status);
          assert.match(err.message, new RegExp(String(status)));
          return true;
        }
      );
    } finally {
      globalThis.fetch = prevFetch;
    }
  }
});

test("Groq adapter: sends Authorization header, requests verbose_json, and normalizes segments", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const calls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return makeResponse({
      jsonData: {
        text: "hi",
        language: "en",
        duration: 12.34,
        segments: [
          { text: "a", start: 0, end: 1, avg_logprob: -0.01 },
          { text: "b", start: 1, end: 2, avg_logprob: -1 },
        ],
      },
    });
  };

  try {
    const p = new WhisperProvider({ provider: "groq", apiKey: "GROQ_KEY" });
    const out = await p.transcribe(new Blob(["x"]), { model: "whisper-large-v3-turbo", prompt: "x", language: "de" });

    assert.equal(out.provider, "groq");
    assert.equal(out.model, "whisper-large-v3-turbo");
    assert.equal(out.text, "hi");
    assert.equal(out.language, "en");
    assert.equal(out.durationSec, 12.34);
    assert.equal(out.segments.length, 2);
    assert.equal(out.segments[0].index, 0);
    assert.equal(out.segments[0].text, "a");
    assert.equal(out.segments[0].startSec, 0);
    assert.equal(out.segments[0].endSec, 1);
    assert.ok(out.segments[0].confidence > 0.9 && out.segments[0].confidence <= 1);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.Authorization, "Bearer GROQ_KEY");
    assert.ok(calls[0].init.body instanceof FormData);

    const body = formDataToObject(calls[0].init.body);
    assert.ok(body.file);
    assert.equal(body.model, "whisper-large-v3-turbo");
    assert.equal(body.response_format, "verbose_json");
    assert.equal(body.language, "de");
    assert.equal(body.prompt, "x");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("Groq adapter: HTTP errors include status", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => makeResponse({ ok: false, status: 401, textData: "bad key", headers: makeHeaders({}) });
  try {
    await assert.rejects(
      () => new WhisperProvider({ provider: "groq", apiKey: "BAD" }).transcribe(new Blob(["x"])),
      (err) => {
        assert.equal(err.status, 401);
        assert.match(err.message, /401|bad key/i);
        return true;
      }
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("OpenAI adapter: baseUrl is honored and segments are normalized (openai-compatible)", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const calls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return makeResponse({
      jsonData: {
        text: "t",
        language: "fr",
        duration: 3,
        segments: [{ text: "x", start: 0.5, end: 1.5, avg_logprob: -0.5 }],
      },
    });
  };

  try {
    const p = new WhisperProvider({
      provider: "openai-compatible",
      apiKey: "OA_KEY",
      baseUrl: "https://proxy.example.com/openai/",
    });
    const out = await p.transcribe(new Blob(["x"]), { model: "whisper-1", language: "es", prompt: "p" });

    assert.equal(out.provider, "openai");
    assert.equal(out.model, "whisper-1");
    assert.equal(out.language, "fr");
    assert.equal(out.durationSec, 3);
    assert.equal(out.segments.length, 1);
    assert.deepEqual(out.segments[0], {
      index: 0,
      text: "x",
      startSec: 0.5,
      endSec: 1.5,
      confidence: Math.exp(-0.5),
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://proxy.example.com/openai/v1/audio/transcriptions");
    assert.equal(calls[0].init.headers.Authorization, "Bearer OA_KEY");
    const body = formDataToObject(calls[0].init.body);
    assert.equal(body.response_format, "verbose_json");
    assert.equal(body.model, "whisper-1");
    assert.equal(body.language, "es");
    assert.equal(body.prompt, "p");
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("OpenAI adapter: HTTP errors include status", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => makeResponse({ ok: false, status: 429, textData: "rate", headers: makeHeaders({}) });
  try {
    await assert.rejects(
      () => new WhisperProvider({ provider: "openai", apiKey: "K" }).transcribe(new Blob(["x"])),
      (err) => {
        assert.equal(err.status, 429);
        assert.match(err.message, /429|rate/i);
        return true;
      }
    );
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("WhisperProvider.isAvailable(): no key => false; openai => true; fetch throws => false", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  assert.equal(await new WhisperProvider({ provider: "elevenlabs", apiKey: "" }).isAvailable(), false);
  assert.equal(await new WhisperProvider({ provider: "openai", apiKey: "K" }).isAvailable(), true);

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    assert.equal(await new WhisperProvider({ provider: "groq", apiKey: "K" }).isAvailable(), false);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("WhisperProvider.isAvailable(): ElevenLabs and Groq hit expected endpoints with auth headers", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const calls = [];
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/v1/user")) return makeResponse({ ok: true, status: 200, jsonData: { id: "u" } });
    if (String(url).endsWith("/openai/v1/models")) return makeResponse({ ok: false, status: 401, jsonData: { error: "bad" } });
    return makeResponse({ ok: false, status: 500, textData: "unexpected" });
  };

  try {
    assert.equal(await new WhisperProvider({ provider: "elevenlabs", apiKey: "EL" }).isAvailable(), true);
    assert.equal(await new WhisperProvider({ provider: "groq", apiKey: "G" }).isAvailable(), false);

    assert.ok(calls.some((c) => c.url === "https://api.elevenlabs.io/v1/user" && c.init.headers["xi-api-key"] === "EL"));
    assert.ok(calls.some((c) => c.url === "https://api.groq.com/openai/v1/models" && c.init.headers.Authorization === "Bearer G"));
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("createWhisperProvider(): returns WhisperProvider instance", async () => {
  const { createWhisperProvider, WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const p = createWhisperProvider({ provider: "groq", apiKey: "K" });
  assert.ok(p instanceof WhisperProvider);
  assert.equal(p.provider, "groq");
  assert.equal(p.apiKey, "K");
});

test("createWhisperProviderFromConfig(): reads localStorage and can load apiKey from model manager", async () => {
  const { createWhisperProviderFromConfig } = await import("../../../js/agents/llm/whisper-provider.js");

  const prevLocalStorage = globalThis.localStorage;
  const prevLoadModelKeys = globalThis.loadModelKeys;
  try {
    globalThis.localStorage = makeLocalStorage({});
    globalThis.loadModelKeys = () => [{ id: "k1", value: "KEY_FROM_STORE", status: "ok" }];

    const p0 = createWhisperProviderFromConfig();
    assert.equal(p0.provider, "elevenlabs");
    assert.equal(p0.apiKey, "KEY_FROM_STORE");

    globalThis.localStorage.setItem(
      "whisperProviderConfig",
      JSON.stringify({ provider: "groq", apiKey: "", model: "whisper-large-v3", baseUrl: " https://x " })
    );
    globalThis.loadModelKeys = () => [
      { id: "bad", value: "BAD", status: "invalid" },
      { id: "good", value: "GROQ_OK", status: "ok" },
    ];
    const p1 = createWhisperProviderFromConfig();
    assert.equal(p1.provider, "groq");
    assert.equal(p1.apiKey, "GROQ_OK");
    assert.equal(p1.model, "whisper-large-v3");
    assert.equal(p1.baseUrl, "https://x");

    globalThis.localStorage.setItem("whisperProviderConfig", JSON.stringify({ provider: "openai", apiKey: "HASKEY" }));
    globalThis.loadModelKeys = () => {
      throw new Error("should not be called");
    };
    const p2 = createWhisperProviderFromConfig();
    assert.equal(p2.provider, "openai");
    assert.equal(p2.apiKey, "HASKEY");

    globalThis.localStorage.setItem("whisperProviderConfig", JSON.stringify({ provider: "openai", apiKey: "" }));
    globalThis.loadModelKeys = undefined;
    const p3 = createWhisperProviderFromConfig();
    assert.equal(p3.provider, "openai");
    assert.equal(p3.apiKey, "");
  } finally {
    globalThis.localStorage = prevLocalStorage;
    globalThis.loadModelKeys = prevLoadModelKeys;
  }
});

test("Adapters: missing optional fields default to safe normalized values", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.elevenlabs.io/v1/speech-to-text")) {
      return makeResponse({ jsonData: { words: [{}, { text: null, start: 0, end: 0 }], text: null } });
    }
    if (u.includes("api.groq.com/openai/v1/audio/transcriptions")) {
      return makeResponse({ jsonData: { text: null, language: "", duration: undefined, segments: undefined } });
    }
    if (u.includes("/v1/audio/transcriptions")) {
      return makeResponse({ jsonData: { text: "", language: undefined, duration: 0, segments: [{}, { text: "", start: 0, end: 0 }] } });
    }
    throw new Error(`unexpected url: ${u}`);
  };

  try {
    const el = await new WhisperProvider({ provider: "elevenlabs", apiKey: "K" }).transcribe(new Blob(["x"]));
    assert.equal(el.model, "scribe_v1");
    assert.equal(el.text, "");
    assert.equal(el.language, null);
    assert.equal(el.languageConfidence, null);
    assert.equal(el.transcriptionId, null);
    assert.equal(el.durationSec, 0);
    assert.equal(el.segments.length, 2);
    assert.equal(el.segments[0].text, "");
    assert.equal(el.segments[0].startSec, 0);
    assert.equal(el.segments[0].endSec, 0);
    assert.equal(el.segments[0].type, "word");
    assert.equal(el.segments[0].confidence, undefined);

    const g = await new WhisperProvider({ provider: "groq", apiKey: "K" }).transcribe(new Blob(["x"]));
    assert.equal(g.model, "whisper-large-v3");
    assert.equal(g.text, "");
    assert.equal(g.language, null);
    assert.equal(g.durationSec, 0);
    assert.deepEqual(g.segments, []);

    const oa = await new WhisperProvider({ provider: "openai", apiKey: "K" }).transcribe(new Blob(["x"]));
    assert.equal(oa.model, "whisper-1");
    assert.equal(oa.language, null);
    assert.equal(oa.durationSec, 0);
    assert.equal(oa.segments.length, 2);
    assert.equal(oa.segments[0].text, "");
    assert.equal(oa.segments[0].confidence, undefined);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("Adapters: error paths tolerate response.text() failures via catch fallback", async () => {
  const { WhisperProvider } = await import("../../../js/agents/llm/whisper-provider.js");

  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => {
      throw new Error("text failed");
    },
    json: async () => ({}),
    headers: makeHeaders({}),
  });

  try {
    for (const provider of ["elevenlabs", "groq", "openai"]) {
      await assert.rejects(
        () => new WhisperProvider({ provider, apiKey: "K" }).transcribe(new Blob(["x"])),
        (err) => {
          assert.equal(err.status, 500);
          assert.match(err.message, /500/i);
          return true;
        }
      );
    }
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test("createWhisperProviderFromConfig(): invalid JSON falls back to elevenlabs default", async () => {
  const { createWhisperProviderFromConfig } = await import("../../../js/agents/llm/whisper-provider.js");

  const prevLocalStorage = globalThis.localStorage;
  globalThis.localStorage = makeLocalStorage({ whisperProviderConfig: "{bad json" });
  try {
    const p = createWhisperProviderFromConfig();
    assert.equal(p.provider, "elevenlabs");
  } finally {
    globalThis.localStorage = prevLocalStorage;
  }
});

test("segmentsToLrc()/segmentsToSrt(): formatting is correct", async () => {
  const { segmentsToLrc, segmentsToSrt } = await import("../../../js/agents/llm/whisper-provider.js");

  const segments = [
    { startSec: 1, endSec: 2, text: " Hello " },
    { startSec: 62.5, endSec: 63.25, text: "World" },
    { startSec: 70, endSec: 70.5, text: "   " },
  ];

  assert.equal(segmentsToLrc(segments), "[00:01.00]Hello\n[01:02.50]World");

  const srt = segmentsToSrt(segments.slice(0, 2));
  assert.equal(
    srt,
    "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:01:02,500 --> 00:01:03,250\nWorld\n"
  );
});
