/**
 * DeepSearch Logger - 向后兼容层
 *
 * 已迁移到 shared/utils/logger.js
 * 此文件仅作为向后兼容的重新导出
 */

import { createLogger as baseCreateLogger } from "../../../shared/utils/logger.js";
export { createLogger, trackToolCall, logEvent } from "../../../shared/utils/logger.js";

/**
 * @typedef {object} Logger
 * @property {(level: string, message: string, data?: any) => void} log
 * @property {(msg: string, data?: any) => void} debug
 * @property {(msg: string, data?: any) => void} info
 * @property {(msg: string, data?: any) => void} warn
 * @property {(msg: string, data?: any) => void} error
 *
 * @typedef {string | { emit?: Function, getContext?: Function, enabled?: boolean, actor?: string, stage?: string }} LoggerOptions
 */

// 为了完全向后兼容，提供预配置的 DeepSearch logger 工厂
/**
 * 创建一个预配置的 DeepSearch Logger（actor="deepsearch"）。
 * @param {LoggerOptions=} options
 * @returns {Logger}
 */
export function createDeepSearchLogger(options = {}) {
  return baseCreateLogger({ actor: "deepsearch", ...(/** @type {any} */ (options)) });
}
