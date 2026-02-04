/**
 * Screenshot Stitcher - 多页截图拼接
 *
 * 将多张幻灯片截图拼接成网格图，节省 token 并提供全局视觉上下文。
 * 默认 2x2 网格（4页一组）。
 *
 * Environment compatibility:
 * - Browser: Uses native Canvas API (no dependencies)
 * - Node.js: Optionally uses 'canvas' package if available
 * - Bundler note: Configure 'canvas' as external to avoid bundling Node-only code
 */

/**
 * 检测运行环境
 * @returns {boolean}
 */
function isBrowserEnv() {
  return typeof window !== "undefined" && !!window?.document?.createElement;
}

/**
 * 检测是否为 Node.js 环境
 * @returns {boolean}
 */
function isNodeEnv() {
  if (typeof globalThis === "undefined") return false;
  const proc = /** @type {{ versions?: { node?: string } } | undefined} */ (
    /** @type {Record<string, unknown>} */ (globalThis).process
  );
  return typeof proc !== "undefined" && !!proc?.versions?.node;
}

const MAX_DATA_URL_LENGTH = 10 * 1024 * 1024;
const IMAGE_DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

function assertSafeImageDataUrl(value) {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) throw new Error("Screenshot data URL is empty");
  if (input.length > MAX_DATA_URL_LENGTH) {
    throw new Error("Screenshot data URL exceeds max length");
  }
  if (!IMAGE_DATA_URL_RE.test(input)) {
    throw new Error("Screenshot data URL must be base64-encoded data:image/*");
  }
  const base64 = input.slice(input.indexOf(",") + 1);
  if (!base64 || /[^A-Za-z0-9+/=]/.test(base64)) {
    throw new Error("Screenshot data URL contains invalid base64");
  }
  return input;
}

/**
 * Node.js canvas 适配器
 * 尝试动态加载 canvas 包，失败则返回 null。
 * 仅在 Node.js 环境下尝试加载，浏览器环境直接跳过。
 */
let nodeCanvas = null;
let nodeCanvasAvailable = null; // null = 未检测, true/false = 检测结果

async function getNodeCanvas() {
  // 浏览器环境：直接返回 null，不尝试加载 Node 包
  if (isBrowserEnv()) {
    nodeCanvasAvailable = false;
    return null;
  }
  if (nodeCanvasAvailable === false) return null;
  if (nodeCanvas) return nodeCanvas;

  // 仅在 Node.js 环境下尝试加载
  if (!isNodeEnv()) {
    nodeCanvasAvailable = false;
    return null;
  }

  try {
    // 动态导入，避免在浏览器环境报错
    // Bundler hints: webpack/vite/esbuild should mark 'canvas' as external
    // @ts-ignore - 打包工具应配置 canvas 为 external
    const mod = await import(/* webpackIgnore: true */ /* @vite-ignore */ "canvas");
    nodeCanvas = mod;
    nodeCanvasAvailable = true;
    return nodeCanvas;
  } catch {
    nodeCanvasAvailable = false;
    return null;
  }
}

/**
 * 创建 Canvas（跨环境）
 */
async function createCanvas(width, height) {
  if (isBrowserEnv()) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  const nc = await getNodeCanvas();
  if (nc?.createCanvas) {
    return nc.createCanvas(width, height);
  }
  return null;
}

/**
 * 加载图片（跨环境）
 */
async function loadImageCrossEnv(base64DataUrl) {
  const safeDataUrl = assertSafeImageDataUrl(base64DataUrl);
  if (isBrowserEnv()) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Failed to load image: ${e}`));
      img.src = safeDataUrl;
    });
  }

  const nc = await getNodeCanvas();
  if (nc?.loadImage) {
    // canvas 包的 loadImage 支持 data URL
    return nc.loadImage(safeDataUrl);
  }
  throw new Error("No image loader available in Node.js environment");
}

/**
 * 拼接配置
 */
export const STITCHER_CONFIG = {
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
};

/**
 * 拼接截图为网格
 *
 * @param {string[]} screenshots - base64 data URL 数组
 * @param {object} options - 配置选项
 * @returns {Promise<string | null | { type: "placeholder", message: string, screenshots: string[], grid: { cols: number, rows: number } }>} - 拼接后的 base64 data URL（或占位信息）
 */
export async function stitchScreenshots(screenshots, options = {}) {
  const config = { ...STITCHER_CONFIG, ...options };
  const { cols, rows, padding, slideWidth, slideHeight, backgroundColor } = config;

  const validScreenshots = screenshots.filter((s) => s && typeof s === "string");
  if (validScreenshots.length === 0) {
    return null;
  }

  const canvasWidth = cols * slideWidth + (cols + 1) * padding;
  const canvasHeight = rows * slideHeight + (rows + 1) * padding;

  // 尝试创建 canvas（浏览器或 Node.js）
  const canvas = await createCanvas(canvasWidth, canvasHeight);
  if (!canvas) {
    // 无可用 canvas 实现，返回占位符
    return {
      type: "placeholder",
      message: "Screenshot stitching requires browser or canvas package",
      screenshots: validScreenshots,
      grid: { cols, rows },
    };
  }

  const ctx = canvas.getContext("2d");

  // 填充背景
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // 绘制每张截图
  const maxSlides = cols * rows;
  const slidesToDraw = validScreenshots.slice(0, maxSlides);

  for (let i = 0; i < slidesToDraw.length; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const x = padding + col * (slideWidth + padding);
    const y = padding + row * (slideHeight + padding);

    try {
      const img = await loadImageCrossEnv(slidesToDraw[i]);
      ctx.drawImage(img, x, y, slideWidth, slideHeight);

      // 添加页码标签
      ctx.fillStyle = config.labelBackground;
      ctx.fillRect(x, y, 30, 20);
      ctx.fillStyle = config.labelColor;
      ctx.font = config.labelFont;
      ctx.fillText(`${i + 1}`, x + 8, y + 14);
    } catch {
      // 绘制占位符
      ctx.fillStyle = config.placeholderColor;
      ctx.fillRect(x, y, slideWidth, slideHeight);
      ctx.fillStyle = config.placeholderTextColor;
      ctx.font = config.placeholderFont;
      ctx.fillText(`Slide ${i + 1} (failed)`, x + slideWidth / 2 - 40, y + slideHeight / 2);
    }
  }

  // 导出为 data URL
  if (typeof canvas.toDataURL === "function") {
    return canvas.toDataURL("image/png");
  }
  // Node.js canvas 使用 toBuffer
  if (typeof canvas.toBuffer === "function") {
    const buffer = canvas.toBuffer("image/png");
    return `data:image/png;base64,${buffer.toString("base64")}`;
  }
  return null;
}

/**
 * 创建 deck 概览（多组拼接图）
 *
 * @param {string[]} screenshots - 所有幻灯片的 base64 截图
 * @param {object} options - 配置选项
 * @returns {Promise<Array<{ gridIndex: number, startSlide: number, endSlide: number, image: any }>>} - 拼接后的图片数组（带元信息）
 */
export async function createDeckOverview(screenshots, options = {}) {
  const config = { ...STITCHER_CONFIG, ...options };
  const { cols, rows } = config;
  const perGrid = cols * rows;

  const validScreenshots = screenshots.filter((s) => s && typeof s === "string");
  if (validScreenshots.length === 0) {
    return [];
  }

  const grids = [];
  for (let i = 0; i < validScreenshots.length; i += perGrid) {
    const batch = validScreenshots.slice(i, i + perGrid);
    const stitched = await stitchScreenshots(batch, options);
    if (stitched) {
      grids.push({
        gridIndex: grids.length,
        startSlide: i,
        endSlide: Math.min(i + perGrid - 1, validScreenshots.length - 1),
        image: stitched,
      });
    }
  }

  return grids;
}

/**
 * ScreenshotStitcher 类
 */
export class ScreenshotStitcher {
  constructor(options = {}) {
    this._defaultOptions = { ...STITCHER_CONFIG, ...options };
  }

  /**
   * 拼接截图
   */
  async stitch(screenshots, options = {}) {
    return stitchScreenshots(screenshots, { ...this._defaultOptions, ...options });
  }

  /**
   * 创建 deck 概览
   */
  async createDeckOverview(screenshots, options = {}) {
    return createDeckOverview(screenshots, { ...this._defaultOptions, ...options });
  }

  /**
   * 估算拼接后的图片数量
   */
  estimateGridCount(slideCount) {
    const perGrid = this._defaultOptions.cols * this._defaultOptions.rows;
    return Math.ceil(slideCount / perGrid);
  }

  /**
   * 获取配置
   */
  getConfig() {
    return { ...this._defaultOptions };
  }
}

export function createScreenshotStitcher(options = {}) {
  return new ScreenshotStitcher(options);
}
