import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/ingest/adapters/node-io.js", () => ({
  basenameOfPath: vi.fn(),
  fileLikeFromPath: vi.fn(),
}));

vi.mock("../../../../../js/agents/ingest/tools/video-frames.js", () => ({
  getVideoFrames: vi.fn(),
}));

import { VideoAdapter } from "../../../../../js/agents/ingest/adapters/video.js";
import { SourceKind } from "../../../../../js/agents/ingest/constants.js";
import * as nodeIo from "../../../../../js/agents/ingest/adapters/node-io.js";
import * as videoFrames from "../../../../../js/agents/ingest/tools/video-frames.js";

function makeFileLike(overrides = {}) {
  return {
    name: "video.mp4",
    type: "video/mp4",
    size: 123,
    arrayBuffer: vi.fn(async () => new ArrayBuffer(8)),
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  nodeIo.basenameOfPath.mockResolvedValue("video.mp4");
  nodeIo.fileLikeFromPath.mockImplementation(async (path, { mimeType } = {}) =>
    makeFileLike({ name: "from-path", type: mimeType || "application/octet-stream", size: 123 })
  );
  videoFrames.getVideoFrames.mockResolvedValue([]);
});

describe("VideoAdapter", () => {
  it("parses path input, normalizes segments, and builds LRC", async () => {
    nodeIo.basenameOfPath.mockResolvedValue("Clip.MP4");
    const file = makeFileLike({ name: "orig", type: "video/mp4", size: 123 });
    nodeIo.fileLikeFromPath.mockResolvedValue(file);

    const transcriptMetadata = { fps: "30", resolution: " 1920x1080 " };
    const transcribe = vi.fn(async () => ({
      text: "   ",
      durationSec: "12",
      segments: [
        { text: "world", start_ms: "1000", end_ms: "2000" },
        { snippet: { text: "hello" }, start_us: 0, duration: 1000000 },
        { transcript: "third", start: 7000, end: 8000 },
      ],
      metadata: transcriptMetadata,
    }));

    const adapter = new VideoAdapter();
    const out = await adapter.parse("/tmp/Clip.MP4", { whisperApi: { transcribe } });

    expect(nodeIo.basenameOfPath).toHaveBeenCalledWith("/tmp/Clip.MP4");
    expect(nodeIo.fileLikeFromPath).toHaveBeenCalledWith("/tmp/Clip.MP4", { mimeType: "video/mp4" });
    expect(transcribe).toHaveBeenCalledTimes(1);

    const [fileArg, opts] = transcribe.mock.calls[0];
    expect(fileArg).toBe(file);
    expect(fileArg.name).toBe("Clip.MP4");
    expect(opts).toEqual({ kind: "video", filename: "Clip.MP4", mimeType: "video/mp4" });

    expect(out.sourceType).toBe(SourceKind.VIDEO);
    expect(out.origin).toMatchObject({ filename: "Clip.MP4", mimeType: "video/mp4", size: 123 });
    expect(out.metadata).toMatchObject({ duration: 12, fps: 30, resolution: "1920x1080", frameCount: 0 });
    expect(out.parseInfo.transcriptMetadata).toBe(transcriptMetadata);
    expect(out.assets).toEqual([]);
    expect(out.lrc).toBe("[00:00.00]hello\n[00:01.00]world\n[00:07.00]third");
    expect(out.markdown).toBe("# Clip.MP4\n\nhello\nworld\nthird");
    expect(videoFrames.getVideoFrames).not.toHaveBeenCalled();
  });

  it("uses services.whisperApi.transcribeVideo and extractAudioTrack for file-like inputs", async () => {
    const input = makeFileLike({ name: "  clip.webm  ", type: "   ", size: -1 });
    const audioFile = makeFileLike({ name: "audio.wav", type: "audio/wav", size: 0 });
    const extractAudioTrack = vi.fn(async () => audioFile);

    const whisperApi = {
      transcribeVideo: vi.fn(async () => ({
        text: "from transcript",
        duration: 0,
        segments: [{ text: "neg", start: -1, end: 1 }],
        metadata: { fps: 0, resolution: "" },
      })),
    };

    const adapter = new VideoAdapter();
    const out = await adapter.parse(input, { services: { whisperApi }, extractAudioTrack });

    expect(extractAudioTrack).toHaveBeenCalledWith(input, { filename: "clip.webm", mimeType: "video/webm" });
    expect(whisperApi.transcribeVideo).toHaveBeenCalledTimes(1);
    expect(whisperApi.transcribeVideo.mock.calls[0][0]).toBe(audioFile);
    expect(whisperApi.transcribeVideo.mock.contexts[0]).toBe(whisperApi);

    expect(out.origin).toMatchObject({ filename: "clip.webm", mimeType: "video/webm", size: -1 });
    expect(out.metadata).toMatchObject({ duration: 0, fps: 0, frameCount: 0 });
    expect(out.metadata).not.toHaveProperty("resolution");
    expect(out.lrc).toBe("[00:00.00]neg");
    expect(out.markdown).toBe("# clip.webm\n\nfrom transcript");
  });

  it("treats non-array segments as empty and trims whitespace fields", async () => {
    const input = {
      name: "   ",
      filename: "   ",
      type: "   ",
      size: 0,
      arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
    };
    const transcribe = vi.fn(async () => ({
      text: "  hello  ",
      segments: { a: 1 },
      metadata: {},
    }));

    const adapter = new VideoAdapter();
    const out = await adapter.parse(input, { whisperApi: { transcribe } });

    expect(out.origin).toMatchObject({ filename: "video", mimeType: "application/octet-stream", size: 0 });
    expect(out.lrc).toBe("");
    expect(out.markdown).toBe("# video\n\nhello");
  });

  it("handles empty string paths and empty segments/text", async () => {
    nodeIo.basenameOfPath.mockResolvedValue("");
    const file = makeFileLike({ name: "untitled", type: "application/octet-stream", size: 1 });
    nodeIo.fileLikeFromPath.mockResolvedValue(file);

    const transcribe = vi.fn(async () => ({ text: "", segments: [] }));
    const adapter = new VideoAdapter();
    const out = await adapter.parse("", { whisperApi: { transcribe } });

    expect(out.origin).toMatchObject({ filename: "", mimeType: "application/octet-stream", size: 1 });
    expect(out.lrc).toBe("");
    expect(out.markdown).toBe("# \n\n");
  });

  it("collects warnings from extractAudioTrack and frame extraction failures", async () => {
    const input = makeFileLike({ name: "clip.mp4", size: 5 });
    const extractAudioTrack = vi.fn(async () => {
      throw new Error("audio boom");
    });
    videoFrames.getVideoFrames.mockRejectedValue(new Error("frame boom"));

    const transcribe = vi.fn(async () => ({ text: "x", durationSec: 5, segments: [] }));
    const adapter = new VideoAdapter({ extractFrames: true, frameCount: 2 });

    const out = await adapter.parse(input, { whisperApi: { transcribe }, extractAudioTrack });

    expect(videoFrames.getVideoFrames).toHaveBeenCalledWith(input, 0, 5, 2, { mediabunny: undefined, frameToBase64: undefined });
    expect(out.assets).toEqual([]);
    expect(out.parseInfo.warnings).toEqual(["audio boom", "frame boom"]);
  });

  it("builds frame assets when extraction is enabled", async () => {
    videoFrames.getVideoFrames.mockResolvedValue(["a", "b", "c"]);
    const transcribe = vi.fn(async () => ({ text: "ok", durationSec: 4, segments: [] }));

    const adapter = new VideoAdapter({ extractFrames: true, frameCount: 3 });
    const input = makeFileLike({ name: "clip.mp4" });
    const stageApi = { whisperApi: { transcribe }, mediabunny: { ok: true }, frameToBase64: vi.fn() };

    const out = await adapter.parse(input, stageApi);

    expect(videoFrames.getVideoFrames).toHaveBeenCalledWith(input, 0, 4, 3, {
      mediabunny: stageApi.mediabunny,
      frameToBase64: stageApi.frameToBase64,
    });
    expect(out.assets).toHaveLength(3);
    expect(out.assets[0]).toMatchObject({
      assetId: "asset_video_frame_001",
      type: "image",
      mimeType: "image/jpeg",
      data: "a",
      source: "extracted",
      reusable: true,
      suggestedUse: "keyframe",
    });
    expect(out.assets[0].locator.timeSec).toBe(0);
    expect(out.assets[1].locator.timeSec).toBe(2);
    expect(out.assets[2].locator.timeSec).toBe(4);
    expect(out.assets[0].docId).toBe(out.docId);
    expect(out.metadata.frameCount).toBe(3);
  });

  it("handles large sizes, long text, and deep metadata", async () => {
    const bigSize = Number.MAX_SAFE_INTEGER;
    const longText = "x".repeat(12000);
    const deepMetadata = { level1: { level2: { level3: { value: "x" } } }, fps: "60" };
    const transcribe = vi.fn(async () => ({
      text: longText,
      duration: bigSize,
      segments: null,
      metadata: deepMetadata,
    }));

    const adapter = new VideoAdapter({ whisperApi: { transcribe } });
    const input = makeFileLike({ name: "big.mov", type: "", size: bigSize });
    const out = await adapter.parse(input);

    expect(out.origin.size).toBe(bigSize);
    expect(out.metadata.duration).toBe(bigSize);
    expect(out.metadata.fps).toBe(60);
    expect(out.markdown.endsWith(longText)).toBe(true);
    expect(out.parseInfo.transcriptMetadata).toBe(deepMetadata);
  });

  it("requires a usable whisperApi", async () => {
    const input = makeFileLike();

    const adapter = new VideoAdapter();
    await expect(adapter.parse(input)).rejects.toThrow(/whisperApi is required/i);
    await expect(adapter.parse(input, { whisperApi: {} })).rejects.toThrow(/whisperApi is required/i);
  });

  it("rejects invalid inputs and missing arrayBuffer", async () => {
    const adapter = new VideoAdapter({ whisperApi: { transcribe: vi.fn() } });

    const invalidInputs = [null, undefined, 123, true];
    for (const bad of invalidInputs) {
      await expect(adapter.parse(bad)).rejects.toThrow(/input must be a path string/i);
    }

    const missingArrayBuffer = [{}, [], { name: "x", arrayBuffer: null }];
    for (const bad of missingArrayBuffer) {
      await expect(adapter.parse(bad)).rejects.toThrow(/missing arrayBuffer/);
    }
  });

  it("handles concurrent parse calls without cross-talk", async () => {
    const d1 = deferred();
    const d2 = deferred();
    const transcribe = vi.fn()
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);

    const adapter = new VideoAdapter();
    const input1 = makeFileLike({ name: "a.mp4", size: 1 });
    const input2 = makeFileLike({ name: "b.mp4", size: 2 });

    const p1 = adapter.parse(input1, { whisperApi: { transcribe } });
    const p2 = adapter.parse(input2, { whisperApi: { transcribe } });

    d2.resolve({ text: "second", segments: [] });
    d1.resolve({ text: "first", segments: [] });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(r1.origin.filename).toBe("a.mp4");
    expect(r2.origin.filename).toBe("b.mp4");
    expect(r1.markdown).toContain("first");
    expect(r2.markdown).toContain("second");
  });
});
