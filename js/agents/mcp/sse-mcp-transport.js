/**
 * SseMcpTransport - SSE 传输层实现
 *
 * 使用 SSE (text/event-stream) 接收消息，并通过 HTTP POST 发送 JSON-RPC 消息。
 * 支持 Browser 和 Node.js（需要全局 fetch 或显式传入 fetchImpl）。
 *
 * @module mcp/sse-mcp-transport
 */

import { McpTransport } from "./mcp-transport.js";
import { parseSseStream } from "./sse.js";
import { isPlainObject, toNonEmptyString, protoSafeReviver} from "../shared/index.js";

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
    return JSON.parse(raw, protoSafeReviver);
  } catch {
    return null;
  }
}

/**
 * @typedef {import('./mcp-transport.js').McpMessage} McpMessage
 */

/**
 * @typedef {object} SseMcpTransportOptions
 * @property {string} url - MCP endpoint (POST) and default SSE URL (GET)
 * @property {string=} sseUrl - Optional SSE URL override
 * @property {Record<string, string>=} headers - Optional HTTP headers
 * @property {(input: RequestInfo, init?: RequestInit) => Promise<Response>=} fetchImpl - Optional fetch implementation
 * @property {AbortSignal=} signal - Optional parent abort signal
 * @property {number=} timeout - Request timeout (ms)
 * @property {number=} connectTimeoutMs - SSE connect timeout (ms)
 * @property {number=} readTimeoutMs - SSE read timeout (ms)
 * @property {number=} maxLineBytes - SSE max line size
 * @property {number=} maxBufferBytes - SSE max buffer size
 * @property {number=} maxEventChars - SSE max event data chars
 */

/**
 * MCP SSE Transport
 *
 * Notes:
 * - Incoming messages are delivered via an SSE stream.
 * - Outgoing messages are sent via HTTP POST (best-effort).
 *
 * @extends {McpTransport}
 */
export class SseMcpTransport extends McpTransport {
  /**
   * @param {Partial<SseMcpTransportOptions>} [options]
   */
  constructor(options = {}) {
    super({
      timeout: options.timeout ?? 30000,
    });

    const url = toNonEmptyString(options.url);
    if (!url) throw new Error("SseMcpTransport requires url");

    this.url = url;
    this.sseUrl = toNonEmptyString(options.sseUrl) || url;
    this.headers = isPlainObject(options.headers) ? { ...options.headers } : {};

    this._fetch = typeof options.fetchImpl === "function" ? options.fetchImpl : globalThis.fetch;
    if (typeof this._fetch !== "function") throw new Error("SseMcpTransport requires global fetch or fetchImpl");

    this.signal = options.signal || null;
    this.connectTimeoutMs =
      typeof options.connectTimeoutMs === "number" && Number.isFinite(options.connectTimeoutMs)
        ? Math.max(200, Math.floor(options.connectTimeoutMs))
        : 10_000;
    this.readTimeoutMs =
      typeof options.readTimeoutMs === "number" && Number.isFinite(options.readTimeoutMs) ? Math.max(0, Math.floor(options.readTimeoutMs)) : 0;

    this.maxLineBytes = options.maxLineBytes;
    this.maxBufferBytes = options.maxBufferBytes;
    this.maxEventChars = options.maxEventChars;

    /** @type {AbortController|null} */
    this._sseController = null;
    /** @type {Promise<void>|null} */
    this._sseTask = null;
    /** @type {Set<AbortController>} */
    this._inflight = new Set();
  }

  /**
   * 建立 SSE 连接
   * @returns {Promise<void>}
   */
  async connect() {
    if (this._connected) return;
    if (this._sseController) return;

    const controller = new AbortController();
    const detach = attachAbortSignal(this.signal, controller);
    this._sseController = controller;

    let timeoutId = null;
    if (this.connectTimeoutMs > 0 && !controller.signal.aborted) {
      timeoutId = setTimeout(() => {
        try {
          controller.abort("connect_timeout");
        } catch {
          // ignore
        }
      }, this.connectTimeoutMs);
    }

    try {
      const res = await this._fetch(this.sseUrl, {
        method: "GET",
        headers: { Accept: "text/event-stream", ...this.headers },
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`SSE MCP error: HTTP ${res.status}`);
      const ctype = res.headers?.get?.("content-type") || "";
      if (ctype && !ctype.toLowerCase().includes("text/event-stream")) {
        throw new Error(`SSE MCP error: unexpected content-type: ${ctype}`);
      }

      this._connected = true;
      this.emit("connect");

      this._sseTask = this._consumeSse(res).catch((err) => {
        if (controller.signal.aborted) return;
        this.emit("error", err);
        this._connected = false;
        this._rejectAllPending(err instanceof Error ? err : new Error(String(err?.message || err)));
        this.emit("disconnect");
      });
    } catch (err) {
      this._sseController = null;
      detach();
      if (timeoutId) clearTimeout(timeoutId);
      throw err;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async _consumeSse(res) {
    const controller = this._sseController;
    if (!controller) return;

    try {
      for await (const evt of parseSseStream(res.body, {
        signal: controller.signal,
        readTimeoutMs: this.readTimeoutMs,
        maxLineBytes: this.maxLineBytes,
        maxBufferBytes: this.maxBufferBytes,
        maxEventChars: this.maxEventChars,
      })) {
        if (controller.signal.aborted) break;
        const data = toNonEmptyString(evt?.data);
        if (!data) continue;
        const parsed = parseJsonBestEffort(data);
        if (parsed && typeof parsed === "object") {
          this._handleMessage(/** @type {McpMessage} */ (parsed));
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        this._connected = false;
        this._rejectAllPending(new Error("Transport disconnected"));
        this.emit("disconnect");
      }
    }
  }

  /**
   * 断开连接
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this._sseController && !this._connected) return;

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

    if (this._sseController) {
      try {
        this._sseController.abort("disconnect");
      } catch {
        // ignore
      }
    }

    const task = this._sseTask;
    this._sseController = null;
    this._sseTask = null;

    if (task) {
      try {
        await task;
      } catch {
        // ignore
      }
    }

    this.emit("disconnect");
  }

  /**
   * 发送消息
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
        throw new Error(`SSE MCP error: ${msg}`);
      }

      // Some servers may reply with a JSON-RPC response in the POST body.
      const parsed = parseJsonBestEffort(text);
      if (!parsed) return;

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

export default SseMcpTransport;
