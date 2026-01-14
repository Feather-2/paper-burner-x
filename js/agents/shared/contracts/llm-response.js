/**
 * LLM Response Contracts - LLM 响应契约
 */

/**
 * @typedef {Object} ToolCall
 * @property {string} name
 * @property {Record<string, unknown>} [args]
 * @property {string} [id]
 */

/**
 * @typedef {Object} LlmResponse
 * @property {string} [content]
 * @property {ToolCall[]} [toolCalls]
 * @property {string} [stopReason]
 */

/**
 * @typedef {{ ok: true, value: T }} ValidResult
 * @template T
 */

/**
 * @typedef {{ ok: false, error: string }} InvalidResult
 */

/**
 * @typedef {ValidResult<T> | InvalidResult} ValidationResult
 * @template T
 */

/**
 * 验证单个 Tool Call
 * @param {unknown} call
 * @param {number} [index]
 * @returns {ValidationResult<ToolCall>}
 */
export function validateToolCall(call, index) {
  const prefix = typeof index === "number" ? `toolCalls[${index}]` : "toolCall";

  if (!call || typeof call !== "object") {
    return { ok: false, error: `${prefix}: expected object` };
  }

  const obj = /** @type {Record<string, unknown>} */ (call);
  const name = obj.name;

  if (typeof name !== "string" || !name.trim()) {
    return { ok: false, error: `${prefix}.name: required non-empty string` };
  }

  // args 容错：接受 object 或 undefined
  let args;
  if (obj.args !== undefined && obj.args !== null) {
    if (typeof obj.args !== "object" || Array.isArray(obj.args)) {
      return { ok: false, error: `${prefix}.args: expected object` };
    }
    args = /** @type {Record<string, unknown>} */ (obj.args);
  }

  return {
    ok: true,
    value: {
      name: name.trim(),
      args,
      id: typeof obj.id === "string" ? obj.id : undefined,
    },
  };
}

/**
 * 验证 LLM 响应结构
 * @param {unknown} response
 * @returns {ValidationResult<LlmResponse>}
 */
export function validateLlmResponse(response) {
  if (!response || typeof response !== "object") {
    return { ok: false, error: "LlmResponse: expected object" };
  }

  const obj = /** @type {Record<string, unknown>} */ (response);

  // content: string | undefined
  const content = typeof obj.content === "string" ? obj.content : undefined;

  // stopReason: string | undefined
  const stopReason = typeof obj.stopReason === "string" ? obj.stopReason : undefined;

  // toolCalls: ToolCall[] | undefined
  let toolCalls;
  if (obj.toolCalls !== undefined) {
    if (!Array.isArray(obj.toolCalls)) {
      return { ok: false, error: "LlmResponse.toolCalls: expected array" };
    }

    toolCalls = [];
    for (let i = 0; i < obj.toolCalls.length; i++) {
      const result = validateToolCall(obj.toolCalls[i], i);
      if (!result.ok) {
        return result;
      }
      toolCalls.push(result.value);
    }
  }

  // 至少有 content 或 toolCalls
  if (!content && (!toolCalls || toolCalls.length === 0)) {
    // 宽容模式：不报错，返回空响应
  }

  return {
    ok: true,
    value: { content, toolCalls, stopReason },
  };
}
