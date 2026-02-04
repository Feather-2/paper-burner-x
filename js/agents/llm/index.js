/**
 * LLM 模块入口
 *
 * @module llm
 */

// Provider 工具
export {
  MODEL_TAGS,
  normalizeModelTags,
  assertModelEntry,
  assertUsageConfig,
  assertChatMessages,
  assertChatResponse,
  assertProvider,
} from "./provider.js";

// 常量
export { ModelUsage, RouterStrategy, isValidModelUsage, normalizeRouterStrategy } from "./constants.js";

// 核心路由
export { ModelRouter } from "./model-router.js";

// 速率限制
export { TokenBucketRateLimiter } from "./rate-limit.js";

// 溢出恢复
export {
  parseContextOverflowError,
  computeOverflowRetryMaxTokens,
  executeWithOverflowRecovery,
} from "./overflow-recovery.js";

// 事件
export { ModelEventEmitter } from "./model-events.js";

// 特殊 Provider
export { createImageProvider } from "./image-provider.js";
export { createWhisperProvider } from "./whisper-provider.js";
export { MockProvider } from "./mock-provider.js";

// PPT 桥接
export {
  getPptModelConfig,
  getPptModelTags,
  getPptRolePriority,
  getPptAudioConfig,
  buildPptUsageConfigForModelRouter,
  createPptConfiguredChat,
  createPptAwareAiApiService,
  getPptConfigSummary,
} from "./ppt-model-bridge.js";

/**
 * 创建 LLM Provider (简化工厂)
 *
 * @param {object} config
 * @param {string} [config.provider] - Provider 类型
 * @param {string} [config.model] - 模型 ID
 * @param {string} [config.apiKey] - API Key
 * @param {any[]} [config.models] - Model entries
 * @param {object} [config.providers] - Provider configs
 * @returns {Promise<{ chat: Function }>}
 */
export async function createProvider(config = {}) {
  const { ModelRouter } = await import("./model-router.js");

  const router = new ModelRouter({
    models: config.models || [],
    providers: config.providers,
  });

  return {
    async chat(messages, options = {}) {
      return router.call({ messages, ...options });
    },
  };
}
