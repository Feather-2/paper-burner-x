/**
 * stageApi 接口定义与工厂
 *
 * stageApi 是 DeepSearch 各阶段的服务注入点，提供：
 * - 模型调用
 * - 事件发射
 * - 取消信号
 * - 外部服务
 */

export {
  StageApiSpec,
  validateStageApi,
  createStageApi,
  extractServices,
  mergeStageApis,
  createChildApi,
} from "../../shared/stage-api.js";
