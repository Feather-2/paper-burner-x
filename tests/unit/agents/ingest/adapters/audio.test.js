import { describe, it, expect, vi, beforeEach } from "vitest";

const mockNodeIo = vi.hoisted(() => ({
  basenameOfPath: vi.fn(),
  fileLikeFromPath: vi.fn(),
}));

const mockBase = vi.hoisted(() => {
  const buildParsedDocument = vi.fn((payload) => ({ ...payload, built: true }));

  class BaseAdapter {
    constructor(opts = {}) {
      this.adapterName = opts.adapterName || "base";
      this.defaultChunkOptions = opts.defaultChunkOptions;
      this._lastBuild = null;
    }

    buildParsedDocument(payload) {
      this._lastBuild = payload;
      return buildParsedDocument(payload);
    }
  }

  return { BaseAdapter, buildParsedDocument };
});

vi.mock("../../../../../js/agents/ingest/adapters/node-io.js", () => ({
  basenameOfPath: mockNodeIo.basenameOfPath,
  fileLikeFromPath: mockNodeIo.fileLikeFromPath,
}));

vi.mock("../../../../../js/agents/ingest/adapters/base.js", () => ({
  BaseAdapter: mockBase.BaseAdapter,
}));

vi.mock("../../../../../js/agents/ingest/constants.js", () => ({
  SourceKind: { AUDIO: "audio" },
}));

import { AudioAdapter } from "../../../../../js/agents/ingest/adapters/audio.js";
import { SourceKind } from "../../../../../js/agents/ingest/constants.js";

const DEFAULT_MAX_FILE_SIZE = 50 * 1024 * 1024;

const createFileLike = (overrides = {}) => ({
  name: "clip.mp3",
  type: "audio/mpeg",
  size: 12,
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  ...overrides,
});

describe("AudioAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNodeIo.basenameOfPath.mockResolvedValue("track.mp3");
    mockNodeIo.fileLikeFromPath.mockImplementation(async (path, opts = {}) => ({
      name: "fromPath",
      type: opts.mimeType || "",
      size: 10,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    }));
  });

  describe("constructor", () => {
    it("normalizes maxFileSize values", () => {
      const fallback = new AudioAdapter({ maxFileSize: 0 });
      const negative = new AudioAdapter({ maxFileSize: -1 });
      const numericString = new AudioAdapter({ maxFileSize: "2048.9" });
      const infinite = new AudioAdapter({ maxFileSize: Infinity });

      expect(fallback.maxFileSize).toBe(DEFAULT_MAX_FILE_SIZE);
      expect(negative.maxFileSize).toBe(DEFAULT_MAX_FILE_SIZE);
      expect(numericString.maxFileSize).toBe(2048);
      expect(infinite.maxFileSize).toBe(Infinity);
    });
  });

  describe("parse", () => {
    it("rejects non-string non-object inputs", async () => {
      const adapter = new AudioAdapter({ whisperApi: { transcribe: vi.fn() } });
      const invalidInputs = [null, undefined, 123, true];

      for (const input of invalidInputs) {
        await expect(adapter.parse(input)).rejects.toThrow(/input must be a path string or a file-like object/i);
      }
    });

    it("rejects file-like inputs missing arrayBuffer", async () => {
      const adapter = new AudioAdapter({ whisperApi: { transcribe: vi.fn() } });
      const invalidInputs = [{}, [], { name: "file.mp3" }];

      for (const input of invalidInputs) {
        await expect(adapter.parse(input)).rejects.toThrow(/missing arrayBuffer/i);
      }
    });

    it("throws when file is too large (string maxFileSize)", async () => {
      const whisperApi = { transcribe: vi.fn() };
      const adapter = new AudioAdapter({ whisperApi, maxFileSize: "10" });
      const input = createFileLike({ size: 11 });

      await expect(adapter.parse(input)).rejects.toThrow(/file too large/i);
      expect(whisperApi.transcribe).not.toHaveBeenCalled();
    });

    it("parses path input, guesses mime type, and builds markdown/lrc", async () => {
      const whisperApi = {
        transcribe: vi.fn().mockResolvedValue({
          segments: [
            { text: "Hello", start_ms: 1000, end_ms: 3000 },
            { text: "World", start_ms: 4000, end_ms: 5000 },
          ],
          text: "  ",
          durationSec: "5",
          language: "en",
          metadata: { provider: "mock" },
        }),
      };
      const adapter = new AudioAdapter({ whisperApi });
      const fileFromPath = {
        name: "orig",
        type: "audio/mpeg",
        size: 500,
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
      };

      mockNodeIo.basenameOfPath.mockResolvedValue("song.MP3");
      mockNodeIo.fileLikeFromPath.mockResolvedValue(fileFromPath);

      const result = await adapter.parse("path/to/song.MP3");

      expect(mockNodeIo.basenameOfPath).toHaveBeenCalledWith("path/to/song.MP3");
      expect(mockNodeIo.fileLikeFromPath).toHaveBeenCalledWith("path/to/song.MP3", {
        maxBytes: adapter.maxFileSize,
        mimeType: "audio/mpeg",
      });
      expect(whisperApi.transcribe).toHaveBeenCalledTimes(1);

      const [fileArg, optionsArg] = whisperApi.transcribe.mock.calls[0];
      expect(fileArg).toBe(fileFromPath);
      expect(fileArg.name).toBe("song.MP3");
      expect(optionsArg).toEqual({ kind: "audio", filename: "song.MP3", mimeType: "audio/mpeg" });

      expect(result.sourceType).toBe(SourceKind.AUDIO);
      expect(result.origin).toEqual({ filename: "song.MP3", mimeType: "audio/mpeg", size: 500 });
      expect(result.metadata).toEqual({ duration: 5, language: "en", format: "audio/mpeg" });
      expect(result.parseInfo.adapter).toBe("audio");
      expect(result.parseInfo.transcriptMetadata).toEqual({ provider: "mock" });
      expect(Number.isFinite(result.parseInfo.durationMs)).toBe(true);

      expect(result.markdown).toBe("# song.MP3\n\nHello\nWorld");
      expect(result.lrc).toBe("[00:01.00]Hello\n[00:04.00]World");
    });

    it("handles empty path string", async () => {
      const whisperApi = {
        transcribe: vi.fn().mockResolvedValue({ text: "ok", segments: [] }),
      };
      const adapter = new AudioAdapter({ whisperApi });

      mockNodeIo.basenameOfPath.mockResolvedValue("");
      mockNodeIo.fileLikeFromPath.mockResolvedValue(createFileLike({ name: "", type: "" }));

      const result = await adapter.parse("");

      const [, optionsArg] = whisperApi.transcribe.mock.calls[0];
      expect(optionsArg.filename).toBe("");
      expect(optionsArg.mimeType).toBe("application/octet-stream");
      expect(result.markdown.startsWith("# ")).toBe(true);
      expect(result.lrc).toBe("");
    });

    it("parses file-like input with whitespace name and zero size", async () => {
      const whisperApi = {
        transcribe: vi.fn().mockResolvedValue({ text: "Direct text", segments: [] }),
      };
      const adapter = new AudioAdapter({ whisperApi });
      const input = createFileLike({ name: "   ", type: undefined, mimeType: undefined, size: 0 });

      const result = await adapter.parse(input);

      expect(mockNodeIo.basenameOfPath).not.toHaveBeenCalled();
      expect(mockNodeIo.fileLikeFromPath).not.toHaveBeenCalled();

      const [, optionsArg] = whisperApi.transcribe.mock.calls[0];
      expect(optionsArg.filename).toBe("audio");
      expect(optionsArg.mimeType).toBe("application/octet-stream");

      expect(result.origin).toEqual({ filename: "audio", mimeType: "application/octet-stream", size: 0 });
      expect(result.markdown).toBe("# audio\n\nDirect text");
    });

    it("accepts negative and MAX_SAFE_INTEGER sizes with Infinity maxFileSize and long text", async () => {
      const longText = "a".repeat(10000);
      const whisperApi = {
        transcribe: vi.fn().mockResolvedValue({ text: longText, segments: {} }),
      };
      const adapter = new AudioAdapter({ whisperApi, maxFileSize: Infinity });

      const negResult = await adapter.parse(createFileLike({ name: "neg.mp3", size: -1 }));
      const hugeResult = await adapter.parse(createFileLike({ name: "huge.mp3", size: Number.MAX_SAFE_INTEGER }));

      expect(whisperApi.transcribe).toHaveBeenCalledTimes(2);
      expect(negResult.origin.size).toBe(-1);
      expect(negResult.markdown.endsWith(longText)).toBe(true);
      expect(negResult.lrc).toBe("");
      expect(hugeResult.origin.size).toBe(Number.MAX_SAFE_INTEGER);
      expect(hugeResult.markdown.endsWith(longText)).toBe(true);
    });

    it("uses transcribeAudio from stageApi.services and includes deep metadata", async () => {
      const transcribeAudio = vi.fn().mockResolvedValue({
        text: "ok",
        duration: "12.5",
        metadata: { deep: { nest: { value: 1 } }, language: "fr" },
      });
      const stageApi = { services: { whisperApi: { transcribeAudio } } };
      const adapter = new AudioAdapter();

      const result = await adapter.parse(createFileLike({ name: "service.wav", type: "audio/wav" }), stageApi);

      expect(transcribeAudio).toHaveBeenCalledTimes(1);
      expect(result.metadata).toEqual({ duration: 12.5, language: "fr", format: "audio/wav" });
      expect(result.parseInfo.transcriptMetadata).toEqual({ deep: { nest: { value: 1 } }, language: "fr" });
    });

    it("normalizes segment time formats and sorts segments", async () => {
      const whisperApi = {
        transcribe: vi.fn().mockResolvedValue({
          text: "",
          segments: [
            { transcript: "Third", start: 7000, end: 8000 },
            { snippet: { text: "First" }, start_ms: -500, end_ms: 500 },
            { content: "Second", start_us: 2_000_000, duration: 1.5 },
          ],
        }),
      };
      const adapter = new AudioAdapter({ whisperApi });

      const result = await adapter.parse(createFileLike({ name: "mix.ogg", type: "audio/ogg" }));

      expect(result.markdown).toBe("# mix.ogg\n\nFirst\nSecond\nThird");
      expect(result.lrc).toBe("[00:00.00]First\n[00:02.00]Second\n[00:07.00]Third");
    });

    it("rejects when whisperApi is missing", async () => {
      const adapter = new AudioAdapter();
      const input = createFileLike({ name: "noapi.mp3" });

      await expect(adapter.parse(input)).rejects.toThrow(/whisperApi is required/i);
    });

    it("supports concurrent parse calls", async () => {
      const whisperApi = {
        transcribe: vi.fn(async (file, opts) => ({ text: `text:${opts.filename}`, segments: [] })),
      };
      const adapter = new AudioAdapter({ whisperApi });

      const fileA = createFileLike({ name: "a.mp3", type: undefined, mimeType: undefined });
      const fileB = createFileLike({ name: "b.wav", type: undefined, mimeType: undefined });

      const [resultA, resultB] = await Promise.all([
        adapter.parse(fileA),
        adapter.parse(fileB),
      ]);

      expect(whisperApi.transcribe).toHaveBeenCalledTimes(2);
      expect(resultA.origin.filename).toBe("a.mp3");
      expect(resultA.markdown).toBe("# a.mp3\n\ntext:a.mp3");
      expect(resultB.origin.filename).toBe("b.wav");
      expect(resultB.markdown).toBe("# b.wav\n\ntext:b.wav");
    });

    it("supports rapid sequential parse calls", async () => {
      const whisperApi = {
        transcribe: vi.fn()
          .mockResolvedValueOnce({ text: "first", segments: [] })
          .mockResolvedValueOnce({ text: "second", segments: [] }),
      };
      const adapter = new AudioAdapter({ whisperApi });

      const first = await adapter.parse(createFileLike({ name: "one.mp3" }));
      const second = await adapter.parse(createFileLike({ name: "two.mp3" }));

      expect(whisperApi.transcribe).toHaveBeenCalledTimes(2);
      expect(first.markdown).toBe("# one.mp3\n\nfirst");
      expect(second.markdown).toBe("# two.mp3\n\nsecond");
    });
  });
});
