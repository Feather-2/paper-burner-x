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
 * @param {unknown} value - 待验证的值
 * @returns {boolean} 是否为有效的 ModelUsage
 */
export function isValidModelUsage(value) {
  return Object.values(ModelUsage).includes(value);
}

/**
 * 验证 MessageRole 值
 * @param {unknown} value - 待验证的值
 * @returns {boolean} 是否为有效的 MessageRole
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

/** @type {Set<string>} */
const VALID_ROUTER_STRATEGIES = Object.freeze(new Set(Object.values(RouterStrategy).map((v) => String(v))));

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
 * @param {unknown} value - 待验证的值
 * @returns {boolean} 是否为有效的 ModelHealth
 */
export function isValidModelHealth(value) {
  return Object.values(ModelHealth).includes(value);
}

/**
 * 验证 RouterStrategy 值
 * @param {unknown} value - 待验证的值
 * @returns {boolean} 是否为有效的 RouterStrategy
 */
export function isValidRouterStrategy(value) {
  return VALID_ROUTER_STRATEGIES.has(value);
}

/**
 * 规范化 RouterStrategy
 */
/**
 * @param {unknown} value
 * @param {string} [fallback=RouterStrategy.ROUND_ROBIN]
 * @returns {string}
 */
export function normalizeRouterStrategy(value, fallback = RouterStrategy.ROUND_ROBIN) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return VALID_ROUTER_STRATEGIES.has(v) ? v : fallback;
}
