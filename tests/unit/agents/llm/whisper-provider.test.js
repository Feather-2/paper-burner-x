import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/shared/index.js");
  return {
    ...actual,
    safeJsonParse: vi.fn(actual.safeJsonParse),
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

import {
  WhisperProvider,
  createWhisperProvider,
  createWhisperProviderFromConfig,
  segmentsToLrc,
  segmentsToSrt,
} from "../../../../js/agents/llm/whisper-provider.js";

import { safeJsonParse } from "../../../../js/agents/shared/index.js";

function makeResponse({ ok = true, status = 200, jsonData, textData } = {}) {
  return {
    ok,
    status,
    json: async () => jsonData,
    text: async () =>
      textData !== undefined ? String(textData) : jsonData !== undefined ? JSON.stringify(jsonData) : "",
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

function formDataToObject(fd) {
  const out = {};
  for (const [k, v] of fd.entries()) out[k] = v;
  return out;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
  try {
    delete globalThis.loadModelKeys;
  } catch {
    // ignore
  }
});

describe("WhisperProvider", () => {
  it("constructor applies defaults and trims values, including numeric boundaries", () => {
    const p0 = new WhisperProvider();
    expect(p0.provider).toBe("elevenlabs");
    expect(p0.apiKey).toBe("");
    expect(p0.model).toBeUndefined();
    expect(p0.baseUrl).toBeUndefined();
    expect(p0.baseUrlTrusted).toBe(true);
    expect(p0.id).toBe("whisper_elevenlabs");

    const p1 = new WhisperProvider({
      provider: "  groq  ",
      apiKey: Number.MAX_SAFE_INTEGER,
      model: -1,
      baseUrl: " https://example.com/ ",
    });
    expect(p1.provider).toBe("groq");
    expect(p1.apiKey).toBe(String(Number.MAX_SAFE_INTEGER));
    expect(p1.model).toBe("-1");
    expect(p1.baseUrl).toBe("https://example.com/");
    expect(p1.name).toBe("Whisper (groq)");

    const p2 = new WhisperProvider({
      provider: "   ",
      apiKey: "",
      model: "   ",
      baseUrl: null,
      baseUrlTrusted: false,
    });
    expect(p2.provider).toBe("elevenlabs");
    expect(p2.apiKey).toBe("");
    expect(p2.model).toBeUndefined();
    expect(p2.baseUrl).toBeUndefined();
    expect(p2.baseUrlTrusted).toBe(false);
  });

  it("transcribe validates file, apiKey, and provider", async () => {
    const blob = new Blob(["audio"], { type: "audio/wav" });

    const noFile = new WhisperProvider({ provider: "elevenlabs", apiKey: "k" });
    await expect(noFile.transcribe(null)).rejects.toThrow(TypeError);

    const noKey = new WhisperProvider({ provider: "elevenlabs", apiKey: "" });
    await expect(noKey.transcribe(blob)).rejects.toThrow(/API key is required/i);

    const badProvider = new WhisperProvider({ provider: "unknown", apiKey: "k" });
    await expect(badProvider.transcribe(blob)).rejects.toThrow(/Unknown whisper provider/i);
  });

  it("transcribe uses elevenlabs adapter and normalizes output", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({
        jsonData: {
          text: "hello world",
          language_code: "en",
          language_probability: 0.95,
          transcription_id: "t1",
          words: [
            { text: "hello", start: 0.0, end: 0.6, logprob: -0.1, type: "word" },
            { text: "", start: 0.6, end: 1.2, type: "word" },
          ],
        },
      });
    });

    const p = new WhisperProvider({ provider: "elevenlabs", apiKey: "k" });
    const blob = new Blob(["audio"], { type: "audio/wav" });
    const out = await p.transcribe(blob, {
      language: "en",
      diarize: true,
      timestampGranularity: "segment",
    });

    expect(out).toMatchObject({
      provider: "elevenlabs",
      model: "scribe_v1",
      text: "hello world",
      language: "en",
      languageConfidence: 0.95,
      durationSec: 1.2,
      transcriptionId: "t1",
    });
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0].confidence).toBeGreaterThan(0);
    expect(out.segments[1].confidence).toBeUndefined();

    const body = formDataToObject(calls[0].init.body);
    expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(calls[0].init.headers["xi-api-key"]).toBe("k");
    expect(body.model_id).toBe("scribe_v1");
    expect(body.language_code).toBe("en");
    expect(body.diarize).toBe("true");
    expect(body.timestamps_granularity).toBe("segment");
    expect(body.file).toBeInstanceOf(Blob);
  });

  it("transcribe omits timestamps when disabled and accepts large files", async () => {
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        jsonData: {
          text: "",
          words: [],
        },
      })
    );

    const bigBlob = new Blob([new Uint8Array(1024 * 1024)], { type: "audio/wav" });
    const p = new WhisperProvider({ provider: "elevenlabs", apiKey: "k" });
    const out = await p.transcribe(bigBlob, { timestamps: false });

    const body = formDataToObject(globalThis.fetch.mock.calls[0][1].body);
    expect(body.timestamps_granularity).toBeUndefined();
    expect(body.file).toBeInstanceOf(Blob);
    expect(body.file.size).toBeGreaterThan(0);
    expect(out.durationSec).toBe(0);
  });

  it("transcribe handles groq errors and normalizes segments", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        makeResponse({
          ok: false,
          status: 401,
          textData: "nope",
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          jsonData: {
            text: "ok",
            language: "en",
            duration: 2.5,
            segments: [{ text: "a", start: 0.0, end: 1.0, avg_logprob: -0.2 }],
          },
        })
      );

    const p = new WhisperProvider({ provider: "groq", apiKey: "k" });
    const blob = new Blob(["audio"], { type: "audio/wav" });
    await expect(p.transcribe(blob)).rejects.toMatchObject({ status: 401 });

    const out = await p.transcribe(blob, { language: "en", prompt: "hello" });
    expect(out).toMatchObject({ provider: "groq", model: "whisper-large-v3", text: "ok", durationSec: 2.5 });
    expect(out.segments[0].confidence).toBeGreaterThan(0);

    const body = formDataToObject(globalThis.fetch.mock.calls[1][1].body);
    expect(body.language).toBe("en");
    expect(body.prompt).toBe("hello");
    expect(body.response_format).toBe("verbose_json");
  });

  it("transcribe uses openai adapter and sanitizes baseUrl", async () => {
    const calls = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return makeResponse({
        jsonData: { text: "ok", duration: 1, segments: [] },
      });
    });

    const blob = new Blob(["audio"], { type: "audio/wav" });
    const p1 = new WhisperProvider({
      provider: "openai-compatible",
      apiKey: "k",
      baseUrl: "https://compat.example.com/api///",
    });
    await p1.transcribe(blob);
    expect(calls[0].url).toBe("https://compat.example.com/api/v1/audio/transcriptions");

    const p2 = new WhisperProvider({
      provider: "openai",
      apiKey: "k",
      baseUrl: "ftp://bad.example.com///",
    });
    await p2.transcribe(blob);
    expect(calls[1].url).toBe("https://api.openai.com/v1/audio/transcriptions");
  });

  it("call routes inputs and rejects unsupported types", async () => {
    const p = new WhisperProvider({ provider: "groq", apiKey: "k" });
    const blob = new Blob(["audio"], { type: "audio/wav" });
    const spy = vi.spyOn(p, "transcribe").mockResolvedValue({ ok: true });

    await p.call({ type: "transcribeAudio", file: blob, opts: { language: "en" } });
    expect(spy).toHaveBeenCalledWith(blob, { language: "en" });

    await p.call(blob, { prompt: "hi" });
    expect(spy).toHaveBeenCalledWith(blob, { prompt: "hi" });

    await expect(p.call({ type: "unknown" })).rejects.toThrow(/unsupported type/i);
  });

  it("isAvailable handles provider-specific checks and errors", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse({ ok: true }))
      .mockResolvedValueOnce(makeResponse({ ok: false }));

    const eleven = new WhisperProvider({ provider: "elevenlabs", apiKey: "k" });
    const groq = new WhisperProvider({ provider: "groq", apiKey: "k" });
    const openai = new WhisperProvider({ provider: "openai", apiKey: "k" });
    const emptyKey = new WhisperProvider({ provider: "elevenlabs", apiKey: "" });

    expect(await eleven.isAvailable()).toBe(true);
    expect(await groq.isAvailable()).toBe(false);
    expect(await openai.isAvailable()).toBe(true);
    expect(await emptyKey.isAvailable()).toBe(false);

    globalThis.fetch = vi.fn(async () => {
      throw new Error("boom");
    });
    const failing = new WhisperProvider({ provider: "groq", apiKey: "k" });
    expect(await failing.isAvailable()).toBe(false);
  });

  it("supports concurrent and rapid successive transcribe calls", async () => {
    const responses = [
      { text: "first", duration: 1, segments: [] },
      { text: "second", duration: 2, segments: [] },
      { text: "third", duration: 3, segments: [] },
    ];
    globalThis.fetch = vi.fn(async () => makeResponse({ jsonData: responses.shift() }));

    const p = new WhisperProvider({ provider: "groq", apiKey: "k" });
    const blob = new Blob(["audio"], { type: "audio/wav" });
    const [first, second] = await Promise.all([p.transcribe(blob), p.transcribe(blob)]);
    const third = await p.transcribe(blob);

    expect(first.text).toBe("first");
    expect(second.text).toBe("second");
    expect(third.text).toBe("third");
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});

describe("createWhisperProvider", () => {
  it("creates a WhisperProvider instance with provided config", () => {
    const provider = createWhisperProvider({ provider: "groq", apiKey: "k" });
    expect(provider).toBeInstanceOf(WhisperProvider);
    expect(provider.provider).toBe("groq");
    expect(provider.apiKey).toBe("k");
  });
});

describe("createWhisperProviderFromConfig", () => {
  it("uses stored config, marks baseUrl untrusted, and handles deep nesting", () => {
    const deepConfig = {
      provider: "openai-compatible",
      baseUrl: "https://compat.example.com",
      nested: { a: { b: { c: { d: "x" } } } },
    };
    const storage = makeLocalStorage({
      whisperProviderConfig: JSON.stringify(deepConfig),
    });

    const provider = createWhisperProviderFromConfig({ storage });
    expect(provider.provider).toBe("openai-compatible");
    expect(provider.baseUrl).toBe("https://compat.example.com");
    expect(provider.baseUrlTrusted).toBe(false);
    expect(safeJsonParse).toHaveBeenCalledWith(JSON.stringify(deepConfig), { maxChars: 200_000 });
  });

  it("uses keyLoader to populate apiKey and ignores invalid keys", () => {
    const storage = makeLocalStorage({
      whisperProviderConfig: JSON.stringify({ provider: "groq" }),
    });
    const keyLoader = vi.fn(() => [
      { value: "", status: "ok" },
      { value: "bad", status: "invalid" },
      { value: "good", status: "ok" },
    ]);

    const provider = createWhisperProviderFromConfig({ storage, keyLoader });
    expect(provider.provider).toBe("groq");
    expect(provider.apiKey).toBe("good");
    expect(keyLoader).toHaveBeenCalledWith("groq");
  });

  it("falls back to defaults on invalid config and uses global key loader", () => {
    const storage = makeLocalStorage({
      whisperProviderConfig: "not-json",
    });
    safeJsonParse.mockImplementationOnce(() => null);
    globalThis.loadModelKeys = vi.fn(() => [{ value: "global-key" }]);

    const provider = createWhisperProviderFromConfig({ storage });
    expect(provider.provider).toBe("elevenlabs");
    expect(provider.apiKey).toBe("global-key");
    expect(globalThis.loadModelKeys).toHaveBeenCalledWith("elevenlabs");
  });

  it("handles empty config objects without a key loader", () => {
    const storage = makeLocalStorage({
      whisperProviderConfig: "{}",
    });

    const provider = createWhisperProviderFromConfig({ storage });
    expect(provider.provider).toBe("elevenlabs");
    expect(provider.apiKey).toBe("");
  });
});

describe("segmentsToLrc", () => {
  it("formats timestamps, trims text, and skips empty lines", () => {
    const out = segmentsToLrc([
      { startSec: "1.5", text: " Hello " },
      { startSec: -1, text: "neg" },
      { startSec: 2, text: "   " },
    ]);

    expect(out).toContain("[00:01.50]Hello");
    expect(out).toContain("neg");
    expect(out).not.toContain("[00:02.00]");
  });

  it("returns empty string for empty segments and throws on non-array input", () => {
    expect(segmentsToLrc([])).toBe("");
    expect(() => segmentsToLrc({})).toThrow(TypeError);
  });
});

describe("segmentsToSrt", () => {
  it("formats SRT entries with string numeric inputs and long text", () => {
    const longText = "a".repeat(10000);
    const out = segmentsToSrt([
      { startSec: "1.5", endSec: 2, text: longText },
      { startSec: 0, endSec: 0, text: "zero" },
    ]);

    expect(out).toContain("00:00:01,500 --> 00:00:02,000");
    expect(out).toContain(longText.slice(0, 50));
    expect(out).toContain("zero");
  });

  it("handles extreme numeric values without throwing", () => {
    const out = segmentsToSrt([
      { startSec: -1, endSec: Number.MAX_SAFE_INTEGER, text: "edge" },
    ]);
    expect(out).toContain("edge");
    expect(out).toContain("-->");
  });
});
