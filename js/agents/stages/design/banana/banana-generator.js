/**
 * Banana Generator - Banana Pro 模式
 *
 * Mode B: 一次性生成全部画面图片
 * - 批量生成所有幻灯片图片
 * - 支持重新生成（非 inpainting）
 * - 框选区域仅作为参考，实际是整体重新生成
 */

/**
 * 生成配置
 */
export const BANANA_CONFIG = {
  defaultModel: "banana-pro",
  defaultWidth: 1920,
  defaultHeight: 1080,
  maxConcurrency: 4,
  retryCount: 2,
};

/**
 * 构建图片生成 prompt
 */
export function buildImagePrompt(slideIntent, designSystem, options = {}) {
  const parts = [];

  // 基础描述
  if (slideIntent.title) {
    parts.push(`Slide title: "${slideIntent.title}"`);
  }

  if (slideIntent.pageType) {
    parts.push(`Page type: ${slideIntent.pageType}`);
  }

  // 视觉焦点
  if (slideIntent.visualFocus) {
    parts.push(`Visual focus: ${slideIntent.visualFocus}`);
  }

  // 关键信息
  if (slideIntent.keyMessage) {
    parts.push(`Key message: ${slideIntent.keyMessage}`);
  }

  // 布局提示
  if (slideIntent.layoutHint) {
    parts.push(`Layout: ${slideIntent.layoutHint}`);
  }

  // 内容要点
  if (Array.isArray(slideIntent.bullets) && slideIntent.bullets.length > 0) {
    parts.push(`Content points: ${slideIntent.bullets.slice(0, 5).join(", ")}`);
  }

  // 设计系统
  if (designSystem) {
    const styleHints = [];
    if (designSystem.theme) styleHints.push(`theme: ${designSystem.theme}`);
    if (designSystem.colorScheme) styleHints.push(`colors: ${designSystem.colorScheme}`);
    if (designSystem.fontFamily) styleHints.push(`font: ${designSystem.fontFamily}`);
    if (styleHints.length > 0) {
      parts.push(`Style: ${styleHints.join(", ")}`);
    }
  }

  // 额外指令
  if (options.additionalPrompt) {
    parts.push(options.additionalPrompt);
  }

  return parts.join("\n");
}

/**
 * 运行 Banana 批量生成
 */
export async function runBananaGenerate(slideIntents, designSystem, options = {}) {
  const {
    imageGenerator,
    signal,
    emit,
    concurrency = BANANA_CONFIG.maxConcurrency,
    width = BANANA_CONFIG.defaultWidth,
    height = BANANA_CONFIG.defaultHeight,
  } = options;

  if (!imageGenerator) {
    return { success: false, error: "imageGenerator is required" };
  }

  const results = [];
  const prompts = [];

  // 构建所有 prompts
  for (let i = 0; i < slideIntents.length; i++) {
    const intent = slideIntents[i];
    const prompt = buildImagePrompt(intent, designSystem, options);
    prompts.push({
      slideIndex: i,
      slideIntentId: intent.slideIntentId,
      prompt,
      intent,
    });
  }

  // 批量生成（简化实现：顺序执行）
  for (const item of prompts) {
    if (signal?.aborted) {
      results.push({
        slideIndex: item.slideIndex,
        success: false,
        error: "Cancelled",
      });
      continue;
    }

    emit?.("banana.generating", {
      actor: "banana",
      status: "progress",
      payload: {
        slideIndex: item.slideIndex,
        total: prompts.length,
      },
    });

    try {
      const image = await imageGenerator.generate({
        prompt: item.prompt,
        width,
        height,
        model: options.model || BANANA_CONFIG.defaultModel,
      });

      results.push({
        slideIndex: item.slideIndex,
        slideIntentId: item.slideIntentId,
        success: true,
        image: image?.url || image?.base64,
        prompt: item.prompt,
      });
    } catch (err) {
      results.push({
        slideIndex: item.slideIndex,
        slideIntentId: item.slideIntentId,
        success: false,
        error: err.message,
        prompt: item.prompt,
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;

  emit?.("banana.completed", {
    actor: "banana",
    status: "ended",
    payload: {
      total: prompts.length,
      success: successCount,
      failed: prompts.length - successCount,
    },
  });

  return {
    success: successCount > 0,
    results,
    summary: {
      total: prompts.length,
      success: successCount,
      failed: prompts.length - successCount,
    },
  };
}

/**
 * 重新生成单张图片
 *
 * 注意：这是整体重新生成，不是 inpainting
 * bbox 仅用于帮助用户描述问题位置，不影响生成逻辑
 */
export async function regenerate(request, options = {}) {
  const {
    slideIndex,
    bbox,
    command,
    originalPrompt,
    slideIntent,
    designSystem,
  } = request;

  const { imageGenerator, width, height, emit, signal } = options;

  if (!imageGenerator) {
    return { success: false, error: "imageGenerator is required" };
  }

  // 构建新 prompt
  let newPrompt = originalPrompt || "";

  // 如果有 slideIntent，重新构建基础 prompt
  if (slideIntent) {
    newPrompt = buildImagePrompt(slideIntent, designSystem);
  }

  // 添加修改要求
  if (command) {
    newPrompt = `${newPrompt}\n\nModification request: ${command}`;
  }

  // 如果有 bbox，添加位置参考（仅供参考）
  if (bbox) {
    newPrompt = `${newPrompt}\n\n(Reference area: x=${bbox.x}, y=${bbox.y}, w=${bbox.w}, h=${bbox.h})`;
  }

  emit?.("banana.regenerating", {
    actor: "banana",
    status: "progress",
    payload: { slideIndex },
  });

  try {
    const image = await imageGenerator.generate({
      prompt: newPrompt,
      width: width || BANANA_CONFIG.defaultWidth,
      height: height || BANANA_CONFIG.defaultHeight,
      model: options.model || BANANA_CONFIG.defaultModel,
    });

    return {
      success: true,
      slideIndex,
      image: image?.url || image?.base64,
      prompt: newPrompt,
    };
  } catch (err) {
    return {
      success: false,
      slideIndex,
      error: err.message,
      prompt: newPrompt,
    };
  }
}

/**
 * BananaGenerator 类
 */
export class BananaGenerator {
  constructor(options = {}) {
    this._imageGenerator = options.imageGenerator;
    this._config = { ...BANANA_CONFIG, ...options.config };
  }

  /**
   * 批量生成
   */
  async generate(slideIntents, designSystem, options = {}) {
    return runBananaGenerate(slideIntents, designSystem, {
      ...options,
      imageGenerator: this._imageGenerator,
      ...this._config,
    });
  }

  /**
   * 重新生成
   */
  async regenerate(request, options = {}) {
    return regenerate(request, {
      ...options,
      imageGenerator: this._imageGenerator,
      ...this._config,
    });
  }

  /**
   * 设置图片生成器
   */
  setImageGenerator(imageGenerator) {
    this._imageGenerator = imageGenerator;
  }

  /**
   * 获取配置
   */
  getConfig() {
    return { ...this._config };
  }
}

export function createBananaGenerator(options = {}) {
  return new BananaGenerator(options);
}
