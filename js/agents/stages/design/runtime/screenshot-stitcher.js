/**
 * Screenshot Stitcher - 多页截图拼接
 *
 * 将多张幻灯片截图拼接成网格图，节省 token 并提供全局视觉上下文。
 * 默认 2x2 网格（4页一组）。
 */

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
 * 检测运行环境
 */
function isBrowserEnv() {
  return typeof window !== "undefined" && !!window?.document?.createElement;
}

/**
 * 从 base64 data URL 创建 Image 对象
 */
async function loadImage(base64DataUrl) {
  if (!isBrowserEnv()) {
    throw new Error("loadImage requires browser environment");
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error(`Failed to load image: ${e}`));
    img.src = base64DataUrl;
  });
}

/**
 * 拼接截图为网格
 *
 * @param {string[]} screenshots - base64 data URL 数组
 * @param {object} options - 配置选项
 * @returns {Promise<string>} - 拼接后的 base64 data URL
 */
export async function stitchScreenshots(screenshots, options = {}) {
  const config = { ...STITCHER_CONFIG, ...options };
  const { cols, rows, padding, slideWidth, slideHeight, backgroundColor } = config;

  const validScreenshots = screenshots.filter((s) => s && typeof s === "string");
  if (validScreenshots.length === 0) {
    return null;
  }

  // Node.js 环境：返回占位符或原始数组
  if (!isBrowserEnv()) {
    return {
      type: "placeholder",
      message: "Screenshot stitching requires browser environment",
      screenshots: validScreenshots,
      grid: { cols, rows },
    };
  }

  const canvasWidth = cols * slideWidth + (cols + 1) * padding;
  const canvasHeight = rows * slideHeight + (rows + 1) * padding;

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
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
      const img = await loadImage(slidesToDraw[i]);
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

  return canvas.toDataURL("image/png");
}

/**
 * 创建 deck 概览（多组拼接图）
 *
 * @param {string[]} screenshots - 所有幻灯片的 base64 截图
 * @param {object} options - 配置选项
 * @returns {Promise<string[]>} - 拼接后的图片数组
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
