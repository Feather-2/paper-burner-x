const test = require("node:test");
const assert = require("node:assert/strict");

test("AudioAdapter: transcribes via whisperApi and outputs LRC + chunkable markdown", async () => {
  const { AudioAdapter } = await import("../../../js/agents/ingest/adapters/audio.js");

  const whisperApi = {
    async transcribe(file, opts) {
      assert.ok(file && typeof file.arrayBuffer === "function");
      assert.equal(opts.kind, "audio");
      return {
        language: "en",
        durationSec: 7.2,
        segments: [
          { text: "Welcome to the presentation.", start: 0, end: 3.5 },
          { text: "Today we will discuss Alpha and Beta.", start_ms: 3500, end_ms: 7200 },
        ],
      };
    },
  };

  const adapter = new AudioAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: false } });
  const parsed = await adapter.parse(
    {
      name: "clip.mp3",
      type: "audio/mpeg",
      size: 3,
      async arrayBuffer() {
        return new Uint8Array([1, 2, 3]).buffer;
      },
    },
    { whisperApi }
  );

  assert.equal(parsed.sourceType, "audio");
  assert.ok(parsed.markdown.includes("# clip.mp3"));
  assert.ok(parsed.markdown.includes("Welcome to the presentation."));
  assert.ok(parsed.markdown.includes("Today we will discuss Alpha and Beta."));
  assert.equal(
    parsed.lrc,
    ["[00:00.00]Welcome to the presentation.", "[00:03.50]Today we will discuss Alpha and Beta."].join("\n")
  );
  assert.ok(parsed.textNormalized.includes("Welcome"));
  assert.ok(String(parsed.textHash || "").startsWith("sha256:"));
  assert.ok(Array.isArray(parsed.chunks) && parsed.chunks.length >= 1);
});

test("AudioAdapter: throws if whisperApi is missing", async () => {
  const { AudioAdapter } = await import("../../../js/agents/ingest/adapters/audio.js");
  const adapter = new AudioAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: false } });
  await assert.rejects(
    () =>
      adapter.parse({
        name: "clip.mp3",
        type: "audio/mpeg",
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      }),
    /whisperApi is required/
  );
});

test("VideoAdapter: transcribes and attaches extracted keyframes as assets", async () => {
  const { VideoAdapter } = await import("../../../js/agents/ingest/adapters/video.js");

  const whisperApi = {
    async transcribe(_file, opts) {
      assert.equal(opts.kind, "video");
      return {
        durationSec: 3,
        segments: [
          { text: "A", start: 0, end: 1 },
          { text: "B", start: 1, end: 2 },
        ],
      };
    },
  };

  const calls = [];
  const frameExtractor = async (file, startSec, endSec, count, opts) => {
    calls.push({ file, startSec, endSec, count, opts });
    return ["AAAA", "BBBB", "CCCC"];
  };

  const adapter = new VideoAdapter({
    defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: false },
    extractFrames: true,
    frameCount: 3,
    frameExtractor,
  });

  const parsed = await adapter.parse(
    {
      name: "video.mp4",
      type: "video/mp4",
      size: 1,
      async arrayBuffer() {
        return new ArrayBuffer(1);
      },
    },
    { whisperApi }
  );

  assert.equal(parsed.sourceType, "video");
  assert.equal(parsed.lrc, ["[00:00.00]A", "[00:01.00]B"].join("\n"));
  assert.ok(Array.isArray(parsed.assets) && parsed.assets.length === 3);
  assert.equal(parsed.assets[0].mimeType, "image/jpeg");
  assert.equal(parsed.assets[0].data, "AAAA");
  assert.equal(parsed.assets[0].docId, parsed.docId);
  assert.equal(parsed.metadata.frameCount, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].startSec, 0);
  assert.equal(calls[0].endSec, 3);
  assert.equal(calls[0].count, 3);
});

test("VideoAdapter: throws if whisperApi is missing", async () => {
  const { VideoAdapter } = await import("../../../js/agents/ingest/adapters/video.js");
  const adapter = new VideoAdapter({ defaultChunkOptions: { chunkSize: 50, overlap: 0, includeLineNumbers: false } });
  await assert.rejects(
    () =>
      adapter.parse({
        name: "video.mp4",
        type: "video/mp4",
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      }),
    /whisperApi is required/
  );
});

test("getVideoFrames: uses mediabunny if provided and samples evenly by time", async () => {
  const { getVideoFrames } = await import("../../../js/agents/ingest/tools/video-frames.js");

  let openCount = 0;
  let closeCount = 0;
  const seenUs = [];

  class BlobSource {
    constructor(blob) {
      this.blob = blob;
    }
  }

  class Input {
    constructor(source) {
      this.source = source;
      this.tracks = [
        {
          type: "video",
          async getFrameAt(timeUs) {
            return {
              timeUs,
              close() {
                closeCount += 1;
              },
            };
          },
        },
      ];
    }
    async open() {
      openCount += 1;
    }
    async close() {
      openCount -= 1;
    }
  }

  const frames = await getVideoFrames(new Blob(["x"], { type: "video/mp4" }), 1, 3, 3, {
    mediabunny: { Input, BlobSource },
    frameToBase64: async (frame) => {
      seenUs.push(frame.timeUs);
      return `frame_${frame.timeUs}`;
    },
  });

  assert.deepEqual(frames, ["frame_1000000", "frame_2000000", "frame_3000000"]);
  assert.deepEqual(seenUs, [1000000, 2000000, 3000000]);
  assert.equal(openCount, 0);
  assert.equal(closeCount, 3);
});

test("getVideoFrames: returns [] when disabled or unavailable", async () => {
  const { getVideoFrames } = await import("../../../js/agents/ingest/tools/video-frames.js");
  assert.deepEqual(await getVideoFrames(new Blob(["x"]), 0, 1, 0), []);
  assert.deepEqual(await getVideoFrames(new Blob(["x"]), 0, 1, 2, { mediabunny: null }), []);
});

