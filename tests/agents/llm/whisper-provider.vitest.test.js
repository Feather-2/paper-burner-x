import { afterEach, describe, expect, it, vi } from "vitest";

import {
  WhisperProvider,
  createWhisperProvider,
  createWhisperProviderFromConfig,
  segmentsToLrc,
  segmentsToSrt,
} from "../../../js/agents/llm/whisper-provider.js";

function makeResponse({ ok = true, status = 200, jsonData, textData } = {}) {
  return {
    ok,
    status,
    json: async () => jsonData,
    text: async () => (textData !== undefined ? String(textData) : jsonData !== undefined ? JSON.stringify(jsonData) : ""),
  };
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
    globalThis.fetch = vi.fn(async () =>
      makeResponse({
        jsonData: { text: "", words: [] },
      })
    );

    const p = new WhisperProvider({ provider: "elevenlabs", apiKey: "k" });
    const blob = new Blob(["audio"], { type: "audio/wav" });
    const out = await p.transcribe(blob, { timestamps: false });
    expect(out.provider).toBe("elevenlabs");
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
