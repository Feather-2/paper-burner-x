import { loadPrompt } from "../prompts/prompt-loader.js";
import { protoSafeReviver } from "../shared/utils/safe-json.js";

/**
 * @typedef {object} IngestAsset
 * @property {string} data
 * @property {string} type
 * @property {string=} name
 * @property {string=} filename
 * @property {string=} mimeType
 * @property {number=} size
 */

/**
 * @typedef {object} VisionApi
 * @property {(image: string | string[], prompt: string) => Promise<{content?: string} | string>} describe
 */

/**
 * @typedef {object} ModelRouter
 * @property {(prompt: string, options: {usage?: string, images?: string[]}) => Promise<{content?: string} | string>} call
 */

/**
 * @typedef {object} AssetUnderstandingResult
 * @property {string=} description
 * @property {string=} category
 * @property {string[]=} topics
 * @property {string[]=} suggestedUse
 * @property {string=} visualStyle
 * @property {string[]=} dominantColors
 * @property {boolean=} hasText
 * @property {string=} textContent
 * @property {string=} error
 */

/**
 * @typedef {object} AssetUnderstandingProgress
 * @property {number} processed
 * @property {number} total
 */

const BATCH_SIZE = 5;
const MAX_IMAGE_SIZE = 500 * 1024; // 500KB
const MAX_JSON_RESPONSE_CHARS = 20000;
const MAX_JSON_ITEMS = 25;
const MAX_JSON_KEYS = 32;

// 缓存的提示词
let _batchAnalysisPrompt = null;

function sanitizeErrorMessage(err, { maxChars = 200 } = {}) {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const normalized = raw.replace(/\s+/g, " ").trim();
  if (!normalized) return "Unknown error";
  const limit = Number.isFinite(Number(maxChars)) ? Math.max(20, Math.floor(Number(maxChars))) : 200;
  if (normalized.length <= limit) return normalized;
  return normalized.slice(0, Math.max(0, limit - 3)) + "...";
}

/**
 * 异步获取 batch analysis prompt
 * @returns {Promise<string>}
 */
export async function getBatchAnalysisPrompt() {
  if (_batchAnalysisPrompt) return _batchAnalysisPrompt;
  try {
    _batchAnalysisPrompt = await loadPrompt("ingest/asset-batch-analysis");
    return _batchAnalysisPrompt;
  } catch (e) {
    return BATCH_ANALYSIS_PROMPT;
  }
}

const BATCH_ANALYSIS_PROMPT = `Analyze these images for reuse in presentation slides. Return JSON array with one entry per image, in the same order as provided:
[
  {
    "index": 0,
    "description": "1-2 sentence description",
    "category": "photo|chart|diagram|icon|illustration|table|screenshot|logo|other",
    "topics": ["topic1", "topic2"],
    "suggestedUse": ["cover", "content", "comparison", "process", "summary"],
    "visualStyle": "realistic|flat|3d|sketch|minimalist|detailed",
    "dominantColors": ["#hex1", "#hex2"],
    "hasText": true/false,
    "textContent": "extracted text if any"
  }
]
Return ONLY the JSON array, no explanation.`;

function isPlainRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeParseJson(payload) {
  if (typeof payload !== "string") return null;
  if (payload.length > MAX_JSON_RESPONSE_CHARS) return null;
  try {
    return JSON.parse(payload, protoSafeReviver);
  } catch {
    return null;
  }
}

function parseJsonResponse(text) {
  const s = String(text || "").trim();
  if (!s) return null;
  if (s.length > MAX_JSON_RESPONSE_CHARS * 2) return null;
  // Try array first
  const arrMatch = s.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    const parsed = safeParseJson(arrMatch[0]);
    if (Array.isArray(parsed) && parsed.length <= MAX_JSON_ITEMS && parsed.every(isPlainRecord)) {
      return parsed;
    }
  }
  // Try object
  const objMatch = s.match(/\{[\s\S]*\}/);
  if (objMatch) {
    const parsed = safeParseJson(objMatch[0]);
    if (isPlainRecord(parsed) && Object.keys(parsed).length <= MAX_JSON_KEYS) {
      return parsed;
    }
  }
  return null;
}

/**
 * 压缩图片数据到指定大小
 */
function compressImageData(dataUrl, maxSize = MAX_IMAGE_SIZE) {
  if (!dataUrl || typeof dataUrl !== 'string') return dataUrl;

  // 估算当前大小 (base64 约为原始的 4/3)
  const currentSize = dataUrl.length * 0.75;
  if (currentSize <= maxSize) return dataUrl;

  // 对于超大图片，返回原数据让调用方处理
  // 实际压缩需要 canvas，这里简单返回原数据
  return dataUrl;
}

/**
 * 批量分析多张图片（最多 5 张一批）
 */
async function analyzeBatch(assets, callVision) {
  if (!assets.length) return [];

  const images = assets.map(a => compressImageData(a.data, MAX_IMAGE_SIZE));

  try {
    const result = await callVision(BATCH_ANALYSIS_PROMPT, images);
    const text = result?.content || result;
    const parsed = parseJsonResponse(text);

    if (Array.isArray(parsed)) {
      return parsed.map((item, idx) => ({
        description: item?.description || "",
        category: item?.category || "other",
        topics: Array.isArray(item?.topics) ? item.topics : [],
        suggestedUse: Array.isArray(item?.suggestedUse) ? item.suggestedUse : [],
        visualStyle: item?.visualStyle || "",
        dominantColors: Array.isArray(item?.dominantColors) ? item.dominantColors : [],
        hasText: !!item?.hasText,
        textContent: item?.textContent || "",
      }));
    }

    // 如果返回单个对象，包装为数组
    if (parsed && typeof parsed === 'object') {
      return [parsed];
    }

    return assets.map(() => ({ description: text || "" }));
  } catch (e) {
    const msg = sanitizeErrorMessage(e);
    return assets.map(() => ({ error: msg }));
  }
}

/**
 * Analyze a single asset using a vision-capable model.
 *
 * @param {IngestAsset} asset
 * @param {{ visionApi?: VisionApi, modelRouter?: ModelRouter }} [options]
 * @returns {Promise<AssetUnderstandingResult | null>}
 */
export async function understandAsset(asset, { visionApi, modelRouter } = {}) {
  if (!asset?.data || !asset?.type) return null;

  const callVision = modelRouter?.call
    ? (prompt, images) => modelRouter.call(prompt, { usage: "vision", images })
    : visionApi?.describe
      ? (prompt, images) => visionApi.describe(images[0], prompt)
      : null;

  if (!callVision) return null;

  // 单张图片分析
  const results = await analyzeBatch([asset], callVision);
  return results[0] || null;
}

/**
 * Analyze multiple assets in batches.
 *
 * @param {IngestAsset[]} assets
 * @param {{ visionApi?: VisionApi, modelRouter?: ModelRouter, onProgress?: (progress: AssetUnderstandingProgress) => void }} [options]
 * @returns {Promise<Array<AssetUnderstandingResult | null>>}
 */
export async function understandAssets(assets, options = {}) {
  const { visionApi, modelRouter, onProgress } = options;
  const list = Array.isArray(assets) ? assets.filter(a => a?.data && a?.type) : [];

  if (!list.length) return [];

  const callVision = modelRouter?.call
    ? (prompt, images) => modelRouter.call(prompt, { usage: "vision", images })
    : visionApi?.describe
      ? (prompt, images) => visionApi.describe(images, prompt)
      : null;

  if (!callVision) return list.map(() => null);

  const results = new Array(list.length);

  // 分批处理，每批最多 5 张
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batchAssets = list.slice(i, Math.min(i + BATCH_SIZE, list.length));
    const batchResults = await analyzeBatch(batchAssets, callVision);

    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }

    onProgress?.({ processed: Math.min(i + BATCH_SIZE, list.length), total: list.length });
  }

  return results;
}
