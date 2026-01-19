/**
 * HttpMcpTransport - HTTP 传输层实现
 *
 * 使用 fetch API 通过 HTTP POST 发送 JSON-RPC 消息。
 * 支持 Browser 和 Node.js（需要全局 fetch 或显式传入 fetchImpl）。
 *
 * @module mcp/http-mcp-transport
 */

import { McpTransport } from "./mcp-transport.js";
import { isPlainObject, toNonEmptyString } from "../shared/index.js";

function attachAbortSignal(parentSignal, controller) {
  if (!parentSignal || typeof parentSignal !== "object" || typeof parentSignal.aborted !== "boolean") return () => {};
  if (!controller || typeof controller.abort !== "function") return () => {};

  const abortWithReason = () => {
    try {
      controller.abort(parentSignal.reason);
    } catch {
      controller.abort();
    }
  };

  if (parentSignal.aborted) {
    abortWithReason();
    return () => {};
  }

  if (typeof parentSignal.addEventListener !== "function") return () => {};
  parentSignal.addEventListener("abort", abortWithReason, { once: true });
  if (typeof parentSignal.removeEventListener !== "function") return () => {};
  return () => parentSignal.removeEventListener("abort", abortWithReason);
}

function parseJsonBestEffort(text) {
  const raw = typeof text === "string" ? text : String(text ?? "");
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @typedef {import('./mcp-transport.js').McpMessage} McpMessage
 */

/**
 * @typedef {object} HttpMcpTransportOptions
 * @property {string} url - MCP HTTP endpoint URL
 * @property {Record<string, string>=} headers - Optional HTTP headers
 * @property {(input: RequestInfo, init?: RequestInit) => Promise<Response>=} fetchImpl - Optional fetch implementation
 * @property {AbortSignal=} signal - Optional parent abort signal
 * @property {number=} timeout - Request timeout (ms)
 */

/**
 * MCP HTTP Transport
 *
 * One request corresponds to one HTTP POST. For JSON-RPC requests, the HTTP response
 * is expected to contain a JSON-RPC response. Notifications are sent best-effort.
 *
 * @extends {McpTransport}
 */
export class HttpMcpTransport extends McpTransport {
  /**
   * @param {HttpMcpTransportOptions} options
   */
  constructor(options = {}) {
    super({
      timeout: options.timeout ?? 30000,
    });

    const url = toNonEmptyString(options.url);
    if (!url) throw new Error("HttpMcpTransport requires url");

    this.url = url;
    this.headers = isPlainObject(options.headers) ? { ...options.headers } : {};

    this._fetch = typeof options.fetchImpl === "function" ? options.fetchImpl : globalThis.fetch;
    if (typeof this._fetch !== "function") throw new Error("HttpMcpTransport requires global fetch or fetchImpl");

    this.signal = options.signal || null;

    /** @type {Set<AbortController>} */
    this._inflight = new Set();
  }

  /**
   * 建立连接（HTTP 无状态，标记为 connected）
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._connected) return;
    this._connected = true;
    this.emit("connect");
  }

  /**
   * 断开连接
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this._connected) return;

    this._connected = false;
    this._rejectAllPending(new Error("Transport disconnected"));

    for (const controller of Array.from(this._inflight)) {
      try {
        controller.abort("disconnect");
      } catch {
        // ignore
      }
    }
    this._inflight.clear();

    this.emit("disconnect");
  }

  /**
   * 发送消息 (fire-and-forget)
   * @param {McpMessage} message
   * @returns {Promise<void>}
   */
  async send(message) {
    if (!this._connected) {
      throw new Error("Transport not connected");
    }

    const controller = new AbortController();
    const detach = attachAbortSignal(this.signal, controller);
    this._inflight.add(controller);

    let timeoutId = null;
    if (Number.isFinite(this.timeout) && this.timeout > 0) {
      timeoutId = setTimeout(() => {
        try {
          controller.abort("timeout");
        } catch {
          // ignore
        }
      }, this.timeout);
    }

    try {
      const res = await this._fetch(this.url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...this.headers,
        },
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      const text = await res.text();

      if (!res.ok) {
        const parsed = parseJsonBestEffort(text);
        const msg = parsed?.error?.message || parsed?.error || text || `HTTP ${res.status}`;
        throw new Error(`HTTP MCP error: ${msg}`);
      }

      // Notification: no response expected (some servers may still return a payload).
      if (!text || !text.trim()) return;

      const parsed = parseJsonBestEffort(text);
      if (parsed === null) {
        throw new Error("HTTP MCP error: invalid JSON response");
      }

      // Batch responses support (best-effort).
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object") this._handleMessage(/** @type {McpMessage} */ (item));
        }
        return;
      }

      if (parsed && typeof parsed === "object" && parsed.jsonrpc === "2.0") {
        this._handleMessage(/** @type {McpMessage} */ (parsed));
        return;
      }

      // Best-effort fallback: wrap non-JSONRPC payload as a result for request flows.
      if (message && typeof message === "object" && message.id !== undefined) {
        this._handleMessage({ jsonrpc: "2.0", id: message.id, result: parsed });
      } else {
        this.emit("message", parsed);
      }
    } catch (err) {
      this.emit("error", err);
      throw err;
    } finally {
      this._inflight.delete(controller);
      detach();
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * 等待收到下一条 message 事件
   * @returns {Promise<any>}
   */
  async receive() {
    if (!this._connected) {
      throw new Error("Transport not connected");
    }

    return new Promise((resolve, reject) => {
      const onMessage = (msg) => {
        cleanup();
        resolve(msg);
      };
      const onError = (err) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err?.message || err)));
      };
      const onDisconnect = () => {
        cleanup();
        reject(new Error("Transport disconnected"));
      };
      const cleanup = () => {
        this.off("message", onMessage);
        this.off("error", onError);
        this.off("disconnect", onDisconnect);
      };

      this.on("message", onMessage);
      this.on("error", onError);
      this.on("disconnect", onDisconnect);
    });
  }

  /**
   * 兼容别名：close() -> disconnect()
   * @returns {Promise<void>}
   */
  async close() {
    return this.disconnect();
  }
}

export default HttpMcpTransport;
