/**
 * stageApi 接口定义与工厂
 *
 * stageApi 是 DeepSearch 各阶段的服务注入点，提供：
 * - 模型调用
 * - 事件发射
 * - 取消信号
 * - 外部服务
 */

import {
  StageApiSpec,
  validateStageApi as _validateStageApi,
  createStageApi as _createStageApi,
  extractServices as _extractServices,
  mergeStageApis as _mergeStageApis,
  createChildApi as _createChildApi,
} from "../../../shared/utils/stage-api.js";

export { StageApiSpec };

/**
 * @typedef {object} StageApi
 * @property {AbortSignal} signal
 * @property {(eventName:string, payload:any)=>void} emit
 * @property {{emit:(eventName:string, payload:any)=>void}|null=} eventBus
 * @property {{call:(opts:any)=>Promise<any>}|null=} modelRouter
 * @property {{chat:(opts:any)=>Promise<any>}|null=} aiApiService
 * @property {any=} localRetriever
 * @property {any=} externalSearchProvider
 * @property {any=} logger
 * @property {(() => void)} checkCancelled
 * @property {((toolName:string, args:any)=>Promise<any>)|null=} runTool
 */

/**
 * 验证 stageApi 是否符合规范
 * @param {any} api
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
export function validateStageApi(api) {
  return _validateStageApi(api);
}

/**
 * 创建带默认值的 stageApi
 * @param {Partial<StageApi> & Record<string, any>} [partial]
 * @param {{strict?: boolean}=} [options]
 * @returns {StageApi}
 */
export function createStageApi(partial = {}, options = {}) {
  return _createStageApi(partial, options);
}

/**
 * 从 stageApi 提取常用服务（提供安全的默认值）
 * @param {any} stageApi
 * @returns {{
 *   signal: AbortSignal|null,
 *   emit: (eventName:string, payload:any)=>void,
 *   eventBus: any,
 *   modelRouter: any,
 *   aiApiService: any,
 *   localRetriever: any,
 *   externalSearchProvider: any,
 *   logger: any,
 *   runTool: ((toolName:string, args:any)=>Promise<any>)|null,
 *   checkCancelled: () => void
 * }}
 */
export function extractServices(stageApi) {
  return _extractServices(stageApi);
}

/**
 * 合并多个 stageApi 配置
 * @param {...(Partial<StageApi>|null|undefined)} apis
 * @returns {StageApi}
 */
export function mergeStageApis(...apis) {
  return _mergeStageApis(...apis);
}

/**
 * 创建子阶段的 stageApi（继承父级，可覆盖部分）
 * @param {StageApi} parentApi
 * @param {Partial<StageApi> & Record<string, any>} [overrides]
 * @returns {StageApi}
 */
export function createChildApi(parentApi, overrides = {}) {
  return _createChildApi(parentApi, overrides);
}
