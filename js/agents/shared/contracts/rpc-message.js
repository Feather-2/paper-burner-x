/**
 * RPC Message Contracts - 跨 Agent 消息契约
 */

/**
 * @typedef {Object} RpcRequest
 * @property {string} type
 * @property {unknown} payload
 * @property {string} [requestId]
 */

/**
 * @typedef {Object} RpcResponse
 * @property {boolean} ok
 * @property {unknown} [data]
 * @property {string} [error]
 * @property {string} [requestId]
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
 * 验证 RPC 请求
 * @param {unknown} msg
 * @returns {ValidationResult<RpcRequest>}
 */
export function validateRpcRequest(msg) {
  if (!msg || typeof msg !== "object") {
    return { ok: false, error: "RpcRequest: expected object" };
  }

  const obj = /** @type {Record<string, unknown>} */ (msg);
  const type = obj.type;
  const payload = obj.payload;

  if (typeof type !== "string" || !type.trim()) {
    return { ok: false, error: "RpcRequest.type: required non-empty string" };
  }

  return {
    ok: true,
    value: {
      type: type.trim(),
      payload,
      requestId: typeof obj.requestId === "string" ? obj.requestId : undefined,
    },
  };
}

/**
 * 验证 RPC 响应
 * @param {unknown} msg
 * @returns {ValidationResult<RpcResponse>}
 */
export function validateRpcResponse(msg) {
  if (!msg || typeof msg !== "object") {
    return { ok: false, error: "RpcResponse: expected object" };
  }

  const obj = /** @type {Record<string, unknown>} */ (msg);

  // ok 字段可选，默认 true（兼容旧格式）
  const ok = obj.ok !== false;

  return {
    ok: true,
    value: {
      ok,
      data: obj.data,
      error: typeof obj.error === "string" ? obj.error : undefined,
      requestId: typeof obj.requestId === "string" ? obj.requestId : undefined,
    },
  };
}
