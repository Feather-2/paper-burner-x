import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODULE_PATH =
  '../../../../../../js/agents/stages/design/internal/screenshot-stitcher.js';
const VALID_DATA_URL = 'data:image/png;base64,AAAA';
const INVALID_BASE64_URL = 'data:image/png;base64,@@@';

let createCanvasImpl;
let loadImageImpl;

const createCanvasMock = vi.fn((...args) =>
  typeof createCanvasImpl === "function" ? createCanvasImpl(...args) : undefined
);
const loadImageMock = vi.fn((...args) =>
  typeof loadImageImpl === "function" ? loadImageImpl(...args) : undefined
);

vi.mock('canvas', () => ({
  createCanvas: (...args) => createCanvasMock(...args),
  loadImage: (...args) => loadImageMock(...args),
}));

function createMockContext() {
  return {
    fillStyle: "",
    font: "",
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillText: vi.fn(),
  };
}

function setupCanvasMocks(options = {}) {
  const {
    toDataURL = "data:image/png;base64,output",
    toBuffer,
    includeToDataURL = true,
    loadImageImpl: loadImpl,
    createCanvasImpl: canvasImpl,
  } = options;
  const ctx = createMockContext();
  const canvas = {
    getContext: vi.fn(() => ctx),
  };

  if (includeToDataURL) {
    canvas.toDataURL = vi.fn(() => toDataURL);
  }
  if (Object.prototype.hasOwnProperty.call(options, "toBuffer")) {
    canvas.toBuffer = vi.fn(() => toBuffer);
  }

  createCanvasImpl = canvasImpl || (() => canvas);
  loadImageImpl = loadImpl || (async () => ({ width: 1, height: 1 }));

  return { ctx, canvas };
}

async function importModule() {
  return await import(MODULE_PATH);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  createCanvasImpl = null;
  loadImageImpl = null;
});

describe("STITCHER_CONFIG", () => {
  it("exposes expected defaults", async () => {
    const { STITCHER_CONFIG } = await importModule();
    expect(STITCHER_CONFIG).toMatchObject({
      cols: 2,
      rows: 2,
      padding: 10,
      slideWidth: 480,
      slideHeight: 270,
      backgroundColor: "#f0f0f0",
      labelBackground: "rgba(0, 0, 0, 0.6)",
      labelColor: "#ffffff",
      labelFont: "12px sans-serif",
      placeholderColor: "#cccccc",
      placeholderTextColor: "#666666",
      placeholderFont: "14px sans-serif",
    });
  });
});

describe("stitchScreenshots", () => {
  it("returns null when no valid screenshots are provided", async () => {
    const { stitchScreenshots } = await importModule();
    expect(await stitchScreenshots([])).toBeNull();
    expect(await stitchScreenshots([null, undefined, "", 0, {}])).toBeNull();
  });

  it("rejects non-array inputs (null/undefined/object)", async () => {
    const { stitchScreenshots } = await importModule();
    await expect(stitchScreenshots()).rejects.toThrow(TypeError);
    await expect(stitchScreenshots(null)).rejects.toThrow(TypeError);
    await expect(stitchScreenshots({})).rejects.toThrow(TypeError);
    await expect(stitchScreenshots("not-an-array")).rejects.toThrow(TypeError);
  });

  it("treats null options as empty options (empty value boundary)", async () => {
    setupCanvasMocks();
    const { stitchScreenshots } = await importModule();
    await expect(stitchScreenshots([VALID_DATA_URL], null)).resolves.toBe(
      "data:image/png;base64,output"
    );
  });

  it("stitches valid screenshots into a grid and draws at expected positions", async () => {
    const trimmedUrl = VALID_DATA_URL;
    const spacedUrl = `  ${trimmedUrl}  `;
    const { ctx } = setupCanvasMocks();
    const { stitchScreenshots, STITCHER_CONFIG } = await importModule();

    const res = await stitchScreenshots([spacedUrl, trimmedUrl]);
    expect(res).toBe("data:image/png;base64,output");

    const width = STITCHER_CONFIG.cols * STITCHER_CONFIG.slideWidth + (STITCHER_CONFIG.cols + 1) * STITCHER_CONFIG.padding;
    const height = STITCHER_CONFIG.rows * STITCHER_CONFIG.slideHeight + (STITCHER_CONFIG.rows + 1) * STITCHER_CONFIG.padding;

    expect(createCanvasMock).toHaveBeenCalledWith(width, height);
    expect(loadImageMock.mock.calls.map((call) => call[0])).toEqual([trimmedUrl, trimmedUrl]);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);

    const firstX = STITCHER_CONFIG.padding;
    const firstY = STITCHER_CONFIG.padding;
    const secondX = STITCHER_CONFIG.padding + STITCHER_CONFIG.slideWidth + STITCHER_CONFIG.padding;
    expect(ctx.drawImage.mock.calls).toEqual(
      expect.arrayContaining([
        [expect.anything(), firstX, firstY, STITCHER_CONFIG.slideWidth, STITCHER_CONFIG.slideHeight],
        [expect.anything(), secondX, firstY, STITCHER_CONFIG.slideWidth, STITCHER_CONFIG.slideHeight],
      ])
    );
  });

  it("draws at most cols*rows slides (truncates extras)", async () => {
    setupCanvasMocks();
    const { stitchScreenshots, STITCHER_CONFIG } = await importModule();

    const screenshots = [
      "data:image/png;base64,AAA1",
      "data:image/png;base64,AAA2",
      "data:image/png;base64,AAA3",
      "data:image/png;base64,AAA4",
      "data:image/png;base64,AAA5",
      "data:image/png;base64,AAA6",
    ];

    await stitchScreenshots(screenshots);

    const maxSlides = STITCHER_CONFIG.cols * STITCHER_CONFIG.rows;
    expect(loadImageMock).toHaveBeenCalledTimes(maxSlides);
    expect(loadImageMock.mock.calls.map((c) => c[0])).toEqual(
      screenshots.slice(0, maxSlides)
    );
  });

  it("uses toBuffer when toDataURL is missing", async () => {
    const buffer = Buffer.from("buffer");
    setupCanvasMocks({ includeToDataURL: false, toBuffer: buffer });
    const { stitchScreenshots } = await importModule();

    const res = await stitchScreenshots([VALID_DATA_URL]);
    expect(res).toBe(`data:image/png;base64,${buffer.toString("base64")}`);
  });

  it("returns null when canvas has no export methods", async () => {
    setupCanvasMocks({ includeToDataURL: false });
    const { stitchScreenshots } = await importModule();

    const res = await stitchScreenshots([VALID_DATA_URL]);
    expect(res).toBeNull();
  });

  it("returns placeholder when no canvas implementation is available", async () => {
    setupCanvasMocks({ createCanvasImpl: () => null });
    const { stitchScreenshots } = await importModule();

    const res = await stitchScreenshots([VALID_DATA_URL, null]);
    expect(createCanvasMock).toHaveBeenCalled();
    expect(res).toEqual({
      type: "placeholder",
      message: "Screenshot stitching requires browser or canvas package",
      screenshots: [VALID_DATA_URL],
      grid: { cols: 2, rows: 2 },
    });
  });

  it("uses browser Canvas/Image APIs when window+document are present", async () => {
    const { STITCHER_CONFIG } = await importModule();
    const ctx = createMockContext();

    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toDataURL: vi.fn(() => "data:image/png;base64,browser"),
    };
    const createElement = vi.fn(() => canvas);
    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("window", { document: { createElement } });

    let assignedSrc = null;
    class FakeImage {
      constructor() {
        /** @type {any} */
        this.onload = null;
        /** @type {any} */
        this.onerror = null;
      }
      set src(value) {
        assignedSrc = value;
        Promise.resolve().then(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", FakeImage);

    const { stitchScreenshots } = await importModule();
    const res = await stitchScreenshots([`  ${VALID_DATA_URL}  `]);

    const width =
      STITCHER_CONFIG.cols * STITCHER_CONFIG.slideWidth +
      (STITCHER_CONFIG.cols + 1) * STITCHER_CONFIG.padding;
    const height =
      STITCHER_CONFIG.rows * STITCHER_CONFIG.slideHeight +
      (STITCHER_CONFIG.rows + 1) * STITCHER_CONFIG.padding;

    expect(res).toBe("data:image/png;base64,browser");
    expect(createElement).toHaveBeenCalledWith("canvas");
    expect(canvas.width).toBe(width);
    expect(canvas.height).toBe(height);
    expect(assignedSrc).toBe(VALID_DATA_URL);
    expect(createCanvasMock).not.toHaveBeenCalled();
    expect(loadImageMock).not.toHaveBeenCalled();
  });

  it("draws placeholder when browser image loading fails", async () => {
    const ctx = createMockContext();

    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      toDataURL: vi.fn(() => "data:image/png;base64,browser"),
    };
    const createElement = vi.fn(() => canvas);
    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("window", { document: { createElement } });

    class FakeImage {
      constructor() {
        /** @type {any} */
        this.onload = null;
        /** @type {any} */
        this.onerror = null;
      }
      set src(_value) {
        Promise.resolve().then(() => this.onerror?.("boom"));
      }
    }
    vi.stubGlobal("Image", FakeImage);

    const { stitchScreenshots } = await importModule();
    const res = await stitchScreenshots([VALID_DATA_URL]);

    expect(res).toBe("data:image/png;base64,browser");
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.fillText.mock.calls.map((call) => call[0])).toContain(
      "Slide 1 (failed)"
    );
  });

  it.each([
    { label: "whitespace", value: () => "   " },
    { label: "invalid base64", value: () => INVALID_BASE64_URL },
    {
      label: "oversized",
      value: () => `data:image/png;base64,${"A".repeat(10 * 1024 * 1024 + 1)}`,
    },
  ])("draws placeholder for invalid data URL: $label", async ({ value }) => {
    const { ctx } = setupCanvasMocks();
    const { stitchScreenshots } = await importModule();

    const res = await stitchScreenshots([value()]);
    expect(res).toBe("data:image/png;base64,output");
    expect(loadImageMock).not.toHaveBeenCalled();
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.fillText.mock.calls.map((call) => call[0])).toContain("Slide 1 (failed)");
  });

  it("draws placeholder when loadImage throws", async () => {
    const { ctx } = setupCanvasMocks({
      loadImageImpl: async () => {
        throw new Error("boom");
      },
    });
    const { stitchScreenshots } = await importModule();

    const res = await stitchScreenshots([VALID_DATA_URL]);
    expect(res).toBe("data:image/png;base64,output");
    expect(loadImageMock).toHaveBeenCalledTimes(1);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.fillText.mock.calls.map((call) => call[0])).toContain("Slide 1 (failed)");
  });

  it("handles concurrent calls without shared-state issues", async () => {
    let counter = 0;
    createCanvasImpl = () => {
      const ctx = createMockContext();
      return {
        getContext: vi.fn(() => ctx),
        toDataURL: vi.fn(() => `data:image/png;base64,${++counter}`),
      };
    };
    loadImageImpl = async () => ({ width: 1, height: 1 });

    const { stitchScreenshots } = await importModule();
    const [first, second] = await Promise.all([stitchScreenshots([VALID_DATA_URL]), stitchScreenshots([VALID_DATA_URL])]);
    expect(new Set([first, second]).size).toBe(2);
  });

  it("supports rapid consecutive calls", async () => {
    setupCanvasMocks();
    const { stitchScreenshots } = await importModule();

    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await stitchScreenshots([VALID_DATA_URL]));
    }

    expect(results).toHaveLength(3);
    results.forEach((res) => expect(res).toBe("data:image/png;base64,output"));
    expect(createCanvasMock).toHaveBeenCalledTimes(3);
  });
});

describe("createDeckOverview", () => {
  it("returns empty array when no valid screenshots exist", async () => {
    const { createDeckOverview } = await importModule();
    expect(await createDeckOverview([])).toEqual([]);

    const deepNested = { a: { b: { c: { d: { e: "x" } } } } };
    expect(await createDeckOverview([null, undefined, deepNested])).toEqual([]);
  });

  it("rejects non-array inputs (null/object)", async () => {
    const { createDeckOverview } = await importModule();
    await expect(createDeckOverview(null)).rejects.toThrow(TypeError);
    await expect(createDeckOverview({})).rejects.toThrow(TypeError);
    await expect(createDeckOverview("not-an-array")).rejects.toThrow(TypeError);
  });

  it("treats null options as empty options (empty value boundary)", async () => {
    const { createDeckOverview } = await importModule();
    await expect(createDeckOverview([VALID_DATA_URL], null)).resolves.toHaveLength(
      1
    );
  });

  it("batches screenshots into grids with metadata", async () => {
    let counter = 0;
    createCanvasImpl = () => {
      const ctx = createMockContext();
      return {
        getContext: vi.fn(() => ctx),
        toDataURL: vi.fn(() => `data:image/png;base64,grid${++counter}`),
      };
    };
    loadImageImpl = async () => ({ width: 1, height: 1 });

    const { createDeckOverview } = await importModule();
    const screenshots = Array.from({ length: 5 }, () => VALID_DATA_URL);
    const grids = await createDeckOverview(screenshots);

    expect(grids).toHaveLength(2);
    expect(grids[0]).toMatchObject({ gridIndex: 0, startSlide: 0, endSlide: 3 });
    expect(grids[1]).toMatchObject({ gridIndex: 1, startSlide: 4, endSlide: 4 });
    expect(grids[0].image).toBe("data:image/png;base64,grid1");
    expect(grids[1].image).toBe("data:image/png;base64,grid2");
  });

  it("honors custom grid dimensions via options", async () => {
    setupCanvasMocks();
    const { createDeckOverview } = await importModule();

    const options = {
      cols: 3,
      rows: 1,
      padding: 1,
      slideWidth: 10,
      slideHeight: 5,
    };
    const screenshots = Array.from({ length: 4 }, () => VALID_DATA_URL);
    const grids = await createDeckOverview(screenshots, options);

    expect(grids).toHaveLength(2);
    expect(grids[0]).toMatchObject({ gridIndex: 0, startSlide: 0, endSlide: 2 });
    expect(grids[1]).toMatchObject({ gridIndex: 1, startSlide: 3, endSlide: 3 });

    expect(createCanvasMock).toHaveBeenCalledTimes(2);
    expect(createCanvasMock).toHaveBeenCalledWith(34, 7);
  });

  it("skips grids when stitching returns null", async () => {
    setupCanvasMocks({ includeToDataURL: false });
    const { createDeckOverview } = await importModule();

    const grids = await createDeckOverview([VALID_DATA_URL]);
    expect(grids).toEqual([]);
  });

  it("handles large inputs (resource boundary: large array)", async () => {
    setupCanvasMocks();
    const { createDeckOverview, STITCHER_CONFIG } = await importModule();

    const count = 100;
    const screenshots = Array.from({ length: count }, () => VALID_DATA_URL);
    const grids = await createDeckOverview(screenshots);

    const perGrid = STITCHER_CONFIG.cols * STITCHER_CONFIG.rows;
    expect(grids).toHaveLength(Math.ceil(count / perGrid));
    expect(loadImageMock).toHaveBeenCalledTimes(count);
  });

  it("handles rapid consecutive calls", async () => {
    setupCanvasMocks();
    const { createDeckOverview } = await importModule();

    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await createDeckOverview([VALID_DATA_URL]));
    }

    results.forEach((res) => {
      expect(res).toHaveLength(1);
      expect(res[0].gridIndex).toBe(0);
    });
  });
});

describe("ScreenshotStitcher", () => {
  it("accepts null options in constructor (empty value boundary)", async () => {
    const { ScreenshotStitcher } = await importModule();
    expect(() => new ScreenshotStitcher(null)).not.toThrow();
  });

  it("getConfig returns a merged copy", async () => {
    const { ScreenshotStitcher, STITCHER_CONFIG } = await importModule();
    const stitcher = new ScreenshotStitcher({ cols: 1 });

    const cfg = stitcher.getConfig();
    expect(cfg).toMatchObject({ ...STITCHER_CONFIG, cols: 1 });
    cfg.cols = 9;
    expect(stitcher.getConfig().cols).toBe(1);
  });

  it("estimateGridCount handles boundary values and string input", async () => {
    const { ScreenshotStitcher, STITCHER_CONFIG } = await importModule();
    const stitcher = new ScreenshotStitcher();
    const perGrid = STITCHER_CONFIG.cols * STITCHER_CONFIG.rows;

    expect(stitcher.estimateGridCount(0)).toBe(0);
    const negative = stitcher.estimateGridCount(-1);
    expect(Object.is(negative, -0)).toBe(true);
    expect(stitcher.estimateGridCount(Number.MAX_SAFE_INTEGER)).toBe(Math.ceil(Number.MAX_SAFE_INTEGER / perGrid));
    expect(stitcher.estimateGridCount("4")).toBe(1);
  });

  it("stitch merges instance defaults with per-call overrides", async () => {
    const { ScreenshotStitcher } = await importModule();
    setupCanvasMocks();

    const stitcher = new ScreenshotStitcher({ cols: 1, rows: 1, padding: 5, slideWidth: 100, slideHeight: 50 });
    await stitcher.stitch([VALID_DATA_URL], { cols: 2, padding: 0 });

    expect(createCanvasMock).toHaveBeenCalledWith(200, 50);
  });

  it("createDeckOverview uses instance defaults", async () => {
    const { ScreenshotStitcher } = await importModule();
    setupCanvasMocks();

    const stitcher = new ScreenshotStitcher({ cols: 1, rows: 1 });
    const grids = await stitcher.createDeckOverview([VALID_DATA_URL, VALID_DATA_URL, VALID_DATA_URL]);
    expect(grids).toHaveLength(3);
    expect(grids.map((grid) => grid.gridIndex)).toEqual([0, 1, 2]);
  });
});

describe("createScreenshotStitcher", () => {
  it("accepts null options (empty value boundary)", async () => {
    const { createScreenshotStitcher } = await importModule();
    expect(() => createScreenshotStitcher(null)).not.toThrow();
  });

  it("returns a ScreenshotStitcher instance with merged options", async () => {
    const { createScreenshotStitcher, ScreenshotStitcher } = await importModule();
    const stitcher = createScreenshotStitcher({ rows: 1 });

    expect(stitcher).toBeInstanceOf(ScreenshotStitcher);
    expect(stitcher.getConfig().rows).toBe(1);
  });
});
