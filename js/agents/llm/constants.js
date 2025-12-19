// js/agents/llm/constants.js
// LLM/Model 层常量枚举

/**
 * 模型用途类型
 */
export const ModelUsage = Object.freeze({
  ANALYST: "analyst",
  PLANNER: "planner",
  WRITER: "writer",
  REVIEWER: "reviewer",
  RERANKER: "reranker",
  SHADOW: "shadow",
  CODESEARCH: "codesearch",
  DESIGNER: "designer",
  VISION: "vision",
  WORKER: "worker",
});

/**
 * 消息角色
 */
export const MessageRole = Object.freeze({
  SYSTEM: "system",
  USER: "user",
  ASSISTANT: "assistant",
});

/**
 * 验证 ModelUsage 值
 */
export function isValidModelUsage(value) {
  return Object.values(ModelUsage).includes(value);
}

/**
 * 验证 MessageRole 值
 */
export function isValidMessageRole(value) {
  return Object.values(MessageRole).includes(value);
}

/**
 * 模型健康状态
 * @readonly
 * @enum {string}
 */
export const ModelHealth = Object.freeze({
  HEALTHY: "healthy",
  DEGRADED: "degraded",
  UNAVAILABLE: "unavailable",
});

/**
 * 路由策略
 * @readonly
 * @enum {string}
 */
export const RouterStrategy = Object.freeze({
  ROUND_ROBIN: "round_robin",
  PRIORITY: "priority",
  COST_OPTIMIZED: "cost_optimized",
  LATENCY_OPTIMIZED: "latency_optimized",
});

/**
 * 传输类型
 * @readonly
 * @enum {string}
 */
export const TransportKind = Object.freeze({
  HTTP: "http",
  WEBSOCKET: "websocket",
  STREAMING: "streaming",
});

/**
 * 验证 ModelHealth 值
 */
export function isValidModelHealth(value) {
  return Object.values(ModelHealth).includes(value);
}
