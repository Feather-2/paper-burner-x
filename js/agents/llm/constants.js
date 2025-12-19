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
