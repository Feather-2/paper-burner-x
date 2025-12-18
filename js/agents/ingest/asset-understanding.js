import { loadPrompt } from "../prompts/prompt-loader.js";

const BATCH_SIZE = 5;
const MAX_IMAGE_SIZE = 500 * 1024; // 500KB

// 缓存的提示词
let _batchAnalysisPrompt = null;

/**
 * 异步获取 batch analysis prompt
 */
export async function getBatchAnalysisPrompt() {
  if (_batchAnalysisPrompt) return _batchAnalysisPrompt;
  try {
    _batchAnalysisPrompt = await loadPrompt("ingest/asset-batch-analysis");
    return _batchAnalysisPrompt;
  } catch (e) {
    console.warn("[asset-understanding] Failed to load asset-batch-analysis.md:", e.message);
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

function parseJsonResponse(text) {
  const s = String(text || "").trim();
  // Try array first
  const arrMatch = s.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]);
    } catch {
      // fall through
    }
  }
  // Try object
  const objMatch = s.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {
      return null;
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
    return assets.map(() => ({ error: e instanceof Error ? e.message : String(e) }));
  }
}

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
