import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMediabunny = {};
vi.mock("mediabunny", () => mockMediabunny);

import { getVideoFrames } from "../../../../../js/agents/ingest/tools/video-frames.js";

const originalGlobals = {
  createImageBitmap: globalThis.createImageBitmap,
  OffscreenCanvas: globalThis.OffscreenCanvas,
};

const restoreGlobal = (key, value) => {
  if (typeof value === "undefined") {
    delete globalThis[key];
  } else {
    globalThis[key] = value;
  }
};

const resetMockMediabunny = () => {
  for (const key of Object.keys(mockMediabunny)) {
    delete mockMediabunny[key];
  }
};

const makeMediabunny = ({ tracks, tracksFactory, onBlobSource } = {}) => {
  const instances = [];

  class BlobSource {
    constructor(blob) {
      this.blob = blob;
      if (onBlobSource) onBlobSource(blob);
    }
  }

  class Input {
    constructor(source) {
      this.source = source;
      this.tracks = typeof tracksFactory === "function" ? tracksFactory() : tracks;
      this.open = vi.fn(async () => {});
      this.close = vi.fn(async () => {});
      instances.push(this);
    }
  }

  return { Input, BlobSource, instances };
};

beforeEach(() => {
  resetMockMediabunny();
  vi.clearAllMocks();
  restoreGlobal("createImageBitmap", originalGlobals.createImageBitmap);
  restoreGlobal("OffscreenCanvas", originalGlobals.OffscreenCanvas);
});

describe("getVideoFrames", () => {
  it("returns empty arrays for empty/invalid counts", async () => {
    const cases = [null, undefined, "", " ", [], {}, 0, -1];
    const results = await Promise.all(
      cases.map((count) => getVideoFrames(null, 0, 1, count))
    );

    results.forEach((result) => expect(result).toEqual([]));
  });

  it("returns empty when mediabunny is unavailable even with huge count", async () => {
    const result = await getVideoFrames({}, 0, 1, Number.MAX_SAFE_INTEGER, { mediabunny: {} });

    expect(result).toEqual([]);
  });

  it("extracts frames with provided mediabunny and coerces numeric strings", async () => {
    const frame1 = { id: "a", close: vi.fn() };
    const frame2 = { id: "b", close: vi.fn() };
    const frame3 = { id: "c", close: vi.fn() };
    const frames = [frame1, frame2, frame3];

    const track = {
      type: "video",
      getFrameAt: vi.fn(async () => frames.shift()),
    };

    const { Input, BlobSource, instances } = makeMediabunny({ tracks: [track] });
    const frameToBase64 = vi.fn(async (frame) => frame.id);
    const videoBlob = { tag: "blob" };

    const result = await getVideoFrames(videoBlob, "1", "3", "3", {
      mediabunny: { Input, BlobSource },
      frameToBase64,
    });

    expect(result).toEqual(["a", "b", "c"]);
    expect(track.getFrameAt).toHaveBeenCalledTimes(3);
    expect(track.getFrameAt.mock.calls.map(([time]) => time)).toEqual([1e6, 2e6, 3e6]);
    expect(frameToBase64).toHaveBeenCalledTimes(3);
    expect(frameToBase64).toHaveBeenCalledWith(frame1);
    expect(frameToBase64).toHaveBeenCalledWith(frame2);
    expect(frameToBase64).toHaveBeenCalledWith(frame3);
    expect(frame1.close).toHaveBeenCalledTimes(1);
    expect(frame2.close).toHaveBeenCalledTimes(1);
    expect(frame3.close).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
    expect(instances[0].open).toHaveBeenCalledTimes(1);
    expect(instances[0].close).toHaveBeenCalledTimes(1);
  });

  it("returns empty when tracks are missing or no video track exists", async () => {
    const cases = [
      { tracks: {} },
      { tracks: [] },
      { tracks: [{ type: "audio", getFrameAt: vi.fn() }] },
    ];

    for (const { tracks } of cases) {
      const { Input, BlobSource, instances } = makeMediabunny({ tracks });
      const result = await getVideoFrames({}, 0, 1, 1, {
        mediabunny: { Input, BlobSource },
        frameToBase64: vi.fn(async () => "ignored"),
      });

      expect(result).toEqual([]);
      expect(instances).toHaveLength(1);
      expect(instances[0].open).toHaveBeenCalledTimes(1);
      expect(instances[0].close).toHaveBeenCalledTimes(1);
    }
  });

  it("uses default frameToBase64 for frames that implement arrayBuffer", async () => {
    const bytes = Uint8Array.from([1, 2, 3, 4]);
    const expected = Buffer.from(bytes).toString("base64");
    const frame = {
      arrayBuffer: vi.fn(async () => bytes.buffer),
      close: vi.fn(),
    };

    const track = {
      type: "video",
      getFrameAt: vi.fn(async () => frame),
    };

    const { Input, BlobSource, instances } = makeMediabunny({ tracks: [track] });
    Object.assign(mockMediabunny, { Input, BlobSource });

    const result = await getVideoFrames({ type: "video/mp4" }, 0, 0, 1);

    expect(result).toEqual([expected]);
    expect(frame.arrayBuffer).toHaveBeenCalledTimes(1);
    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(instances).toHaveLength(1);
    expect(instances[0].close).toHaveBeenCalledTimes(1);
  });

  it("throws when default frameToBase64 cannot convert a frame", async () => {
    const frame = { close: vi.fn() };
    const track = {
      type: "video",
      getFrameAt: vi.fn(async () => frame),
    };
    const { Input, BlobSource, instances } = makeMediabunny({ tracks: [track] });

    await expect(
      getVideoFrames({}, 0, 0, 1, { mediabunny: { Input, BlobSource } })
    ).rejects.toThrow("frameToBase64 required");

    expect(instances).toHaveLength(1);
    expect(instances[0].open).toHaveBeenCalledTimes(1);
    expect(instances[0].close).toHaveBeenCalledTimes(1);
    expect(frame.close).toHaveBeenCalledTimes(1);
  });

  it("closes resources when custom frameToBase64 throws", async () => {
    const frame = { close: vi.fn() };
    const track = {
      type: "video",
      getFrameAt: vi.fn(async () => frame),
    };
    const { Input, BlobSource, instances } = makeMediabunny({ tracks: [track] });
    const frameToBase64 = vi.fn(async () => {
      throw new Error("boom");
    });

    await expect(
      getVideoFrames({}, 0, 0, 1, { mediabunny: { Input, BlobSource }, frameToBase64 })
    ).rejects.toThrow("boom");

    expect(instances).toHaveLength(1);
    expect(instances[0].close).toHaveBeenCalledTimes(1);
    expect(frame.close).toHaveBeenCalledTimes(1);
  });

  it("supports concurrent calls without shared state", async () => {
    let counter = 0;
    const tracksByCall = [];

    const { Input, BlobSource, instances } = makeMediabunny({
      tracksFactory: () => {
        const index = counter++;
        const frame = { id: `frame-${index}`, close: vi.fn() };
        const track = {
          type: "video",
          getFrameAt: vi.fn(async () => frame),
        };
        tracksByCall.push({ frame, track });
        return [track];
      },
    });

    const frameToBase64 = vi.fn(async (frame) => frame.id);

    const [first, second] = await Promise.all([
      getVideoFrames({}, 0, 0, 1, { mediabunny: { Input, BlobSource }, frameToBase64 }),
      getVideoFrames({}, 0, 0, 1, { mediabunny: { Input, BlobSource }, frameToBase64 }),
    ]);

    expect(first).toEqual(["frame-0"]);
    expect(second).toEqual(["frame-1"]);
    expect(instances).toHaveLength(2);
    expect(frameToBase64).toHaveBeenCalledTimes(2);
    instances.forEach((instance) => {
      expect(instance.open).toHaveBeenCalledTimes(1);
      expect(instance.close).toHaveBeenCalledTimes(1);
    });
    tracksByCall.forEach(({ frame, track }) => {
      expect(track.getFrameAt).toHaveBeenCalledTimes(1);
      expect(frame.close).toHaveBeenCalledTimes(1);
    });
  });

  it("handles rapid sequential calls and large inputs", async () => {
    let capturedBlob;
    const deepVideoBlob = {
      size: Number.MAX_SAFE_INTEGER,
      meta: { level1: { level2: { level3: "x" } } },
    };
    const longNumber = "9".repeat(10000);

    const { Input, BlobSource, instances } = makeMediabunny({
      tracksFactory: () => {
        const frame = { close: vi.fn() };
        const track = {
          type: "video",
          getFrameAt: vi.fn(async () => frame),
        };
        return [track];
      },
      onBlobSource: (blob) => {
        capturedBlob = blob;
      },
    });

    const frameToBase64 = vi.fn(async () => "ok");

    const first = await getVideoFrames(deepVideoBlob, longNumber, "   ", 1, {
      mediabunny: { Input, BlobSource },
      frameToBase64,
    });
    const second = await getVideoFrames(deepVideoBlob, longNumber, "   ", 1, {
      mediabunny: { Input, BlobSource },
      frameToBase64,
    });

    expect(first).toEqual(["ok"]);
    expect(second).toEqual(["ok"]);
    expect(capturedBlob).toBe(deepVideoBlob);
    expect(instances).toHaveLength(2);
    instances.forEach((instance) => {
      expect(instance.open).toHaveBeenCalledTimes(1);
      expect(instance.close).toHaveBeenCalledTimes(1);
      const track = instance.tracks?.[0];
      expect(track.getFrameAt).toHaveBeenCalledWith(0);
    });
  });
});
