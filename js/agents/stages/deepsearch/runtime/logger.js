/**
 * DeepSearch Logger - 向后兼容层
 *
 * 已迁移到 shared/utils/logger.js
 * 此文件仅作为向后兼容的重新导出
 */

import { createLogger as baseCreateLogger } from "../../../shared/utils/logger.js";
export { createLogger, trackToolCall, logEvent } from "../../../shared/utils/logger.js";

// 为了完全向后兼容，提供预配置的 DeepSearch logger 工厂
export function createDeepSearchLogger(options = {}) {
  return baseCreateLogger({ actor: "deepsearch", ...options });
}
