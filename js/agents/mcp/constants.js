// MCP 相关枚举与工具函数

/**
 * MCP 传输协议类型枚举
 * @readonly
 * @enum {string}
 */
export const TransportKind = Object.freeze({
  JSONRPC: "jsonrpc",
  TOOLAPI: "toolapi",
  REST: "rest",
});

export function isValidTransportKind(value) {
  return Object.values(TransportKind).includes(value);
}

export function normalizeTransportKind(value) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return isValidTransportKind(v) ? v : undefined;
}
