import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WhisperProvider,
  createWhisperProvider,
  createWhisperProviderFromConfig,
  segmentsToLrc,
  segmentsToSrt,
} from "../../../js/agents/llm/whisper-provider.js";

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

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  try {
    delete globalThis.loadModelKeys;
  } catch {
    // ignore
  }
});

describe("agents/llm/whisper-provider", () => {
  it("createWhisperProvider(): returns a WhisperProvider instance", () => {
    const p = createWhisperProvider({ provider: "elevenlabs", apiKey: "k" });
    expect(p).toBeInstanceOf(WhisperProvider);
    expect(p.provider).toBe("elevenlabs");
  });

  it("WhisperProvider: constructor defaults and trims config values", () => {
    const p0 = new WhisperProvider();
    expect(p0.provider).toBe("elevenlabs");
    expect(p0.apiKey).toBe("");
    expect(p0.model).toBeUndefined();
    expect(p0.baseUrl).toBeUndefined();
    expect(p0.id).toBe("whisper_elevenlabs");
    expect(p0.name).toBe("Whisper (elevenlabs)");

    const p1 = new WhisperProvider({
      provider: "  groq  ",
      apiKey: "  KEY  ",
      model: "  whisper-large-v3  ",
      baseUrl: "  https://example.com/  ",
      name: "Custom",
    });
    expect(p1.provider).toBe("groq");
    expect(p1.apiKey).toBe("KEY");
    expect(p1.model).toBe("whisper-large-v3");
    expect(p1.baseUrl).toBe("https://example.com/");
    expect(p1.id).toBe("whisper_groq");
    expect(p1.name).toBe("Custom");

    const p2 = new WhisperProvider({ provider: "", apiKey: undefined, model: "   ", baseUrl: null });
    expect(p2.provider).toBe("elevenlabs");
    expect(p2.apiKey).toBe("");
    expect(p2.model).toBeUndefined();
    expect(p2.baseUrl).toBeUndefined();
  });

  it("WhisperProvider.transcribe(): supports elevenlabs adapter and normalizes segments/confidence", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({
        jsonData: {
          text: "hello world",
          language_code: "en",
          language_probability: 0.9,
          words: [
            { text: "hello", start: 0.0, end: 0.5, logprob: -0.1, type: "word" },
            { text: "world", start: 0.5, end: 1.0, logprob: -0.2, type: "word" },
          ],
          transcription_id: "t1",
        },
      });
    });

    const p = new WhisperProvider({ provider: "elevenlabs", apiKey: "k" });
    const blob = new Blob(["audio"], { type: "audio/wav" });
    const out = await p.transcribe(blob, { language: "en", diarize: true });

    expect(out).toMatchObject({
      provider: "elevenlabs",
      model: "scribe_v1",
      text: "hello world",
      language: "en",
      languageConfidence: 0.9,
      durationSec: 1.0,
      transcriptionId: "t1",
    });
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toMatchObject({ index: 0, text: "hello", startSec: 0.0, endSec: 0.5, type: "word" });
    // logprob is converted via exp(); allow approximate match.
    expect(out.segments[0].confidence).toBeGreaterThan(0);

    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["xi-api-key"]).toBe("k");
  });

  it("WhisperProvider.transcribe(): supports elevenlabs timestamps=false option (covers branch)", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({
        jsonData: { text: "", words: [] },
      });
    });

    const p = new WhisperProvider({ provider: "elevenlabs", apiKey: "k" });
    const blob = new Blob(["audio"], { type: "audio/wav" });
    const out = await p.transcribe(blob, { timestamps: false });
    expect(out.provider).toBe("elevenlabs");
    const body = formDataToObject(calls[0].init.body);
    expect(body).not.toHaveProperty("timestamps_granularity");
  });

  it("WhisperProvider.transcribe(): supports groq adapter and handles non-ok errors", async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementationOnce(async () =>
        makeResponse({
          ok: false,
          status: 401,
          textData: "nope",
        })
      )
      .mockImplementationOnce(async () =>
        makeResponse({
          jsonData: {
            text: "ok",
            language: "en",
            duration: 2.5,
            segments: [{ text: "a", start: 0.0, end: 1.0, avg_logprob: -0.1 }],
          },
        })
      );

    const blob = new Blob(["audio"], { type: "audio/wav" });
    const p = new WhisperProvider({ provider: "groq", apiKey: "k" });
    await expect(p.transcribe(blob)).rejects.toMatchObject({ message: expect.stringMatching(/Groq Whisper failed/i), status: 401 });

    // Include optional fields to cover adapter branches.
    const out = await p.transcribe(blob, { language: "en", prompt: "hello" });
    expect(out).toMatchObject({ provider: "groq", model: "whisper-large-v3", text: "ok", durationSec: 2.5 });
    expect(out.segments[0]).toMatchObject({ index: 0, text: "a" });
  });

  it("WhisperProvider.transcribe(): supports openai-compatible baseUrl and call() entrypoint", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({
        jsonData: {
          text: "ok",
          duration: 1,
          language: "en",
          segments: [{ text: "x", start: 0, end: 1, avg_logprob: -1 }],
        },
      });
    });

    const blob = new Blob(["audio"], { type: "audio/wav" });
    const p = new WhisperProvider({ provider: "openai-compatible", apiKey: "k", baseUrl: "https://compat.example.com///" });

    const out = await p.call({ type: "audio", file: blob });
    expect(out.provider).toBe("openai");
    expect(calls[0].url).toBe("https://compat.example.com/v1/audio/transcriptions");
    expect(calls[0].init.headers.Authorization).toContain("Bearer");
  });

  it("WhisperProvider.transcribe(): openai provider surfaces non-ok errors with status", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        ok: false,
        status: 400,
        textData: "bad",
      })
    );

    const blob = new Blob(["audio"], { type: "audio/wav" });
    const p = new WhisperProvider({ provider: "openai", apiKey: "k" });
    await expect(p.transcribe(blob)).rejects.toMatchObject({ message: expect.stringMatching(/OpenAI Whisper failed/i), status: 400 });
  });

  it("call(file) form forwards non-plain-object inputs to transcribe()", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        jsonData: { text: "ok", segments: [], duration: 0 },
      })
    );

    const blob = new Blob(["audio"], { type: "audio/wav" });
    const p = new WhisperProvider({ provider: "openai", apiKey: "k" });
    const out = await p.call(blob, { language: "en", prompt: "hi" });
    expect(out.provider).toBe("openai");
  });

  it("transcribe()/call() validate inputs and unsupported types", async () => {
    const p = new WhisperProvider({ provider: "elevenlabs", apiKey: "k" });
    await expect(p.transcribe(null)).rejects.toThrow(/file is required/i);
    await expect(new WhisperProvider({ provider: "elevenlabs", apiKey: "" }).transcribe(new Blob(["x"]))).rejects.toThrow(/API key is required/i);
    await expect(new WhisperProvider({ provider: "nope", apiKey: "k" }).transcribe(new Blob(["x"]))).rejects.toThrow(/Unknown whisper provider/i);
    await expect(p.call({ type: "nope" })).rejects.toThrow(/unsupported type/i);
  });

  it("isAvailable(): checks elevenlabs/groq endpoints and treats errors as unavailable", async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementationOnce(async () => makeResponse({ ok: true }))
      .mockImplementationOnce(async () => makeResponse({ ok: false }))
      .mockImplementationOnce(async () => {
        throw new Error("offline");
      });

    expect(await new WhisperProvider({ provider: "elevenlabs", apiKey: "" }).isAvailable()).toBe(false);

    expect(await new WhisperProvider({ provider: "elevenlabs", apiKey: "k" }).isAvailable()).toBe(true);
    expect(await new WhisperProvider({ provider: "groq", apiKey: "k" }).isAvailable()).toBe(false);
    expect(await new WhisperProvider({ provider: "elevenlabs", apiKey: "k" }).isAvailable()).toBe(false);

    // OpenAI providers don't do network checks.
    globalThis.fetch = vi.fn(async () => {
      throw new Error("should not be called");
    });
    expect(await new WhisperProvider({ provider: "openai", apiKey: "k" }).isAvailable()).toBe(true);
  });

  it("createWhisperProviderFromConfig(): loads config from storage and falls back to keyLoader", () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({ provider: "groq" })),
    };
    const keyLoader = vi.fn((provider) => {
      if (provider === "groq") return [{ status: "invalid", value: "bad" }, { status: "ok", value: "k_groq" }];
      return [];
    });

    const p = createWhisperProviderFromConfig({ storage, keyLoader, storageKey: "whisperProviderConfig" });
    expect(p.provider).toBe("groq");
    expect(p.apiKey).toBe("k_groq");
  });

  it("createWhisperProviderFromConfig(): can use global loadModelKeys when keyLoader is not provided", () => {
    globalThis.loadModelKeys = vi.fn(() => [{ status: "ok", value: "k_global" }]);
    const storage = { getItem: vi.fn(() => JSON.stringify({ provider: "openai" })) };

    const p = createWhisperProviderFromConfig({ storage });
    expect(p.provider).toBe("openai");
    expect(p.apiKey).toBe("k_global");
    expect(globalThis.loadModelKeys).toHaveBeenCalled();
  });

  it("createWhisperProviderFromConfig(): defaults to elevenlabs and ignores bad JSON", () => {
    const storage = { getItem: vi.fn(() => "{not-json") };
    const keyLoader = vi.fn(() => [{ status: "ok", value: "k_el" }]);

    const p = createWhisperProviderFromConfig({ storage, keyLoader });
    expect(p.provider).toBe("elevenlabs");
    expect(p.apiKey).toBe("k_el");
  });

  it("ElevenLabs adapter: sends FormData + xi-api-key and normalizes segments/duration/language", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
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
    });

    const file = new Blob(["audio"], { type: "audio/wav" });
    const p = new WhisperProvider({ provider: "elevenlabs", apiKey: "EL_KEY", model: "scribe_v2" });
    const out = await p.transcribe(file, {
      model: "scribe_v3",
      language: "zh",
      diarize: true,
      timestampGranularity: "segment",
    });

    expect(out.provider).toBe("elevenlabs");
    expect(out.model).toBe("scribe_v3");
    expect(out.text).toBe("hello world");
    expect(out.language).toBe("en");
    expect(out.languageConfidence).toBe(0.91);
    expect(out.durationSec).toBe(1.2);
    expect(out.transcriptionId).toBe("t_123");
    expect(out.segments).toHaveLength(2);
    expect(
      out.segments.map((s) => ({ index: s.index, text: s.text, startSec: s.startSec, endSec: s.endSec, type: s.type }))
    ).toEqual([
      { index: 0, text: "hello", startSec: 0.1, endSec: 0.5, type: "word" },
      { index: 1, text: "world", startSec: 0.6, endSec: 1.2, type: "word" },
    ]);
    expect(out.segments[0].confidence).toBeGreaterThan(0.8);
    expect(out.segments[0].confidence).toBeLessThan(1);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers["xi-api-key"]).toBe("EL_KEY");
    expect(calls[0].init.body).toBeInstanceOf(FormData);

    const body = formDataToObject(calls[0].init.body);
    expect(body.file).toBeTruthy();
    expect(body.model_id).toBe("scribe_v3");
    expect(body.language_code).toBe("zh");
    expect(body.diarize).toBe("true");
    expect(body.timestamps_granularity).toBe("segment");
  });

  it("ElevenLabs adapter: HTTP errors include status (401/429/500)", async () => {
    const file = new Blob(["x"]);

    for (const status of [401, 429, 500]) {
      globalThis.fetch = vi.fn(async () =>
        makeResponse({
          ok: false,
          status,
          textData: `err_${status}`,
          headers: makeHeaders({}),
        })
      );

      await expect(new WhisperProvider({ provider: "elevenlabs", apiKey: "K" }).transcribe(file)).rejects.toMatchObject({
        status,
        message: expect.stringMatching(new RegExp(String(status))),
      });
    }
  });

  it("Groq adapter: sends Authorization header, requests verbose_json, and normalizes segments", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
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
    });

    const p = new WhisperProvider({ provider: "groq", apiKey: "GROQ_KEY" });
    const out = await p.transcribe(new Blob(["x"]), { model: "whisper-large-v3-turbo", prompt: "x", language: "de" });

    expect(out.provider).toBe("groq");
    expect(out.model).toBe("whisper-large-v3-turbo");
    expect(out.text).toBe("hi");
    expect(out.language).toBe("en");
    expect(out.durationSec).toBe(12.34);
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toMatchObject({ index: 0, text: "a", startSec: 0, endSec: 1 });
    expect(out.segments[0].confidence).toBeGreaterThan(0.9);
    expect(out.segments[0].confidence).toBeLessThanOrEqual(1);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("Bearer GROQ_KEY");
    expect(calls[0].init.body).toBeInstanceOf(FormData);

    const body = formDataToObject(calls[0].init.body);
    expect(body.file).toBeTruthy();
    expect(body.model).toBe("whisper-large-v3-turbo");
    expect(body.response_format).toBe("verbose_json");
    expect(body.language).toBe("de");
    expect(body.prompt).toBe("x");
  });

  it("OpenAI adapter: baseUrl is honored and segments are normalized (openai-compatible)", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({
        jsonData: {
          text: "t",
          language: "fr",
          duration: 3,
          segments: [{ text: "x", start: 0.5, end: 1.5, avg_logprob: -0.5 }],
        },
      });
    });

    const p = new WhisperProvider({
      provider: "openai-compatible",
      apiKey: "OA_KEY",
      baseUrl: "https://proxy.example.com/openai/",
    });
    const out = await p.transcribe(new Blob(["x"]), { model: "whisper-1", language: "es", prompt: "p" });

    expect(out.provider).toBe("openai");
    expect(out.model).toBe("whisper-1");
    expect(out.language).toBe("fr");
    expect(out.durationSec).toBe(3);
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]).toEqual({
      index: 0,
      text: "x",
      startSec: 0.5,
      endSec: 1.5,
      confidence: Math.exp(-0.5),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://proxy.example.com/openai/v1/audio/transcriptions");
    expect(calls[0].init.headers.Authorization).toBe("Bearer OA_KEY");

    const body = formDataToObject(calls[0].init.body);
    expect(body.response_format).toBe("verbose_json");
    expect(body.model).toBe("whisper-1");
    expect(body.language).toBe("es");
    expect(body.prompt).toBe("p");
  });

  it("WhisperProvider.isAvailable(): ElevenLabs and Groq hit expected endpoints with auth headers", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/v1/user")) return makeResponse({ ok: true, status: 200, jsonData: { id: "u" } });
      if (String(url).endsWith("/openai/v1/models")) {
        return makeResponse({ ok: false, status: 401, jsonData: { error: "bad" } });
      }
      return makeResponse({ ok: false, status: 500, textData: "unexpected" });
    });

    expect(await new WhisperProvider({ provider: "elevenlabs", apiKey: "EL" }).isAvailable()).toBe(true);
    expect(await new WhisperProvider({ provider: "groq", apiKey: "G" }).isAvailable()).toBe(false);

    expect(calls.some((c) => c.url === "https://api.elevenlabs.io/v1/user" && c.init.headers["xi-api-key"] === "EL")).toBe(true);
    expect(calls.some((c) => c.url === "https://api.groq.com/openai/v1/models" && c.init.headers.Authorization === "Bearer G")).toBe(
      true
    );
  });

  it("createWhisperProviderFromConfig(): reads localStorage and can load apiKey from model manager", () => {
    const prevLocalStorage = globalThis.localStorage;
    const prevLoadModelKeys = globalThis.loadModelKeys;

    try {
      globalThis.localStorage = makeLocalStorage({});
      globalThis.loadModelKeys = () => [{ id: "k1", value: "KEY_FROM_STORE", status: "ok" }];

      const p0 = createWhisperProviderFromConfig();
      expect(p0.provider).toBe("elevenlabs");
      expect(p0.apiKey).toBe("KEY_FROM_STORE");

      globalThis.localStorage.setItem(
        "whisperProviderConfig",
        JSON.stringify({ provider: "groq", apiKey: "", model: "whisper-large-v3", baseUrl: " https://x " })
      );
      globalThis.loadModelKeys = () => [
        { id: "bad", value: "BAD", status: "invalid" },
        { id: "good", value: "GROQ_OK", status: "ok" },
      ];
      const p1 = createWhisperProviderFromConfig();
      expect(p1.provider).toBe("groq");
      expect(p1.apiKey).toBe("GROQ_OK");
      expect(p1.model).toBe("whisper-large-v3");
      expect(p1.baseUrl).toBe("https://x");

      globalThis.localStorage.setItem("whisperProviderConfig", JSON.stringify({ provider: "openai", apiKey: "HASKEY" }));
      globalThis.loadModelKeys = () => {
        throw new Error("should not be called");
      };
      const p2 = createWhisperProviderFromConfig();
      expect(p2.provider).toBe("openai");
      expect(p2.apiKey).toBe("HASKEY");

      globalThis.localStorage.setItem("whisperProviderConfig", JSON.stringify({ provider: "openai", apiKey: "" }));
      globalThis.loadModelKeys = undefined;
      const p3 = createWhisperProviderFromConfig();
      expect(p3.provider).toBe("openai");
      expect(p3.apiKey).toBe("");
    } finally {
      globalThis.localStorage = prevLocalStorage;
      globalThis.loadModelKeys = prevLoadModelKeys;
    }
  });

  it("Adapters: missing optional fields default to safe normalized values", async () => {
    globalThis.fetch = vi.fn(async (url) => {
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
    });

    const el = await new WhisperProvider({ provider: "elevenlabs", apiKey: "K" }).transcribe(new Blob(["x"]));
    expect(el.model).toBe("scribe_v1");
    expect(el.text).toBe("");
    expect(el.language).toBeNull();
    expect(el.languageConfidence).toBeNull();
    expect(el.transcriptionId).toBeNull();
    expect(el.durationSec).toBe(0);
    expect(el.segments).toHaveLength(2);
    expect(el.segments[0].text).toBe("");
    expect(el.segments[0].startSec).toBe(0);
    expect(el.segments[0].endSec).toBe(0);
    expect(el.segments[0].type).toBe("word");
    expect(el.segments[0].confidence).toBeUndefined();

    const g = await new WhisperProvider({ provider: "groq", apiKey: "K" }).transcribe(new Blob(["x"]));
    expect(g.model).toBe("whisper-large-v3");
    expect(g.text).toBe("");
    expect(g.language).toBeNull();
    expect(g.durationSec).toBe(0);
    expect(g.segments).toEqual([]);

    const oa = await new WhisperProvider({ provider: "openai", apiKey: "K" }).transcribe(new Blob(["x"]));
    expect(oa.model).toBe("whisper-1");
    expect(oa.language).toBeNull();
    expect(oa.durationSec).toBe(0);
    expect(oa.segments).toHaveLength(2);
    expect(oa.segments[0].text).toBe("");
    expect(oa.segments[0].confidence).toBeUndefined();
  });

  it("Adapters: error paths tolerate response.text() failures via catch fallback", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => {
        throw new Error("text failed");
      },
      json: async () => ({}),
      headers: makeHeaders({}),
    }));

    for (const provider of ["elevenlabs", "groq", "openai"]) {
      await expect(new WhisperProvider({ provider, apiKey: "K" }).transcribe(new Blob(["x"]))).rejects.toMatchObject({
        status: 500,
        message: expect.stringMatching(/500/i),
      });
    }
  });

  it("segmentsToLrc()/segmentsToSrt(): formatting is correct", () => {
    const segments = [
      { startSec: 1, endSec: 2, text: " Hello " },
      { startSec: 62.5, endSec: 63.25, text: "World" },
      { startSec: 70, endSec: 70.5, text: "   " },
    ];

    expect(segmentsToLrc(segments)).toBe("[00:01.00]Hello\n[01:02.50]World");

    const srt = segmentsToSrt(segments.slice(0, 2));
    expect(srt).toBe("1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:01:02,500 --> 00:01:03,250\nWorld\n");
  });

  it("segmentsToLrc()/segmentsToSrt() format expected subtitle outputs", () => {
    const segments = [
      { startSec: 0, endSec: 1.5, text: " hello " },
      { startSec: 61.2, endSec: 62.0, text: "" }, // filtered in LRC
    ];

    const lrc = segmentsToLrc(segments);
    expect(lrc).toContain("[00:00.00]hello");
    expect(lrc).not.toContain("[01:01.20]"); // empty text line is filtered out

    const srt = segmentsToSrt([{ startSec: 0, endSec: 1.5, text: "hi" }]);
    expect(srt).toContain("1");
    expect(srt).toContain("00:00:00,000 --> 00:00:01,500");
    expect(srt).toContain("hi");
  });
});
