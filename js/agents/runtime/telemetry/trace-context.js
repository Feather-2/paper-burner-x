/**
 * Trace Context - 全链路追踪
 *
 * 特性：
 * - 分布式追踪上下文
 * - Span 创建和管理
 * - W3C Trace Context 兼容
 */

import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("runtime/telemetry/trace-context");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TRACE_VERSION = "00"; // W3C Trace Context version

// ─────────────────────────────────────────────────────────────────────────────
// ID Generators
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 生成随机 hex 字符串
 * @param {number} bytes
 * @returns {string}
 */
function randomHex(bytes) {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback
  let hex = "";
  for (let i = 0; i < bytes; i++) {
    hex += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * 生成 Trace ID (128-bit)
 * @returns {string}
 */
function generateTraceId() {
  return randomHex(16); // 32 hex chars
}

/**
 * 生成 Span ID (64-bit)
 * @returns {string}
 */
function generateSpanId() {
  return randomHex(8); // 16 hex chars
}

// ─────────────────────────────────────────────────────────────────────────────
// Span
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Span 状态
 */
export const SpanStatus = Object.freeze({
  OK: "ok",
  ERROR: "error",
  UNSET: "unset",
});

/**
 * Span 类型
 */
export const SpanKind = Object.freeze({
  INTERNAL: "internal",
  CLIENT: "client",
  SERVER: "server",
  PRODUCER: "producer",
  CONSUMER: "consumer",
});

/**
 * Span
 */
export class Span {
  /**
   * @param {object} options
   * @param {string} options.name
   * @param {string} options.traceId
   * @param {string} [options.parentSpanId]
   * @param {string} [options.kind='internal']
   * @param {object} [options.attributes]
   */
  constructor({ name, traceId, parentSpanId, kind = SpanKind.INTERNAL, attributes = {} }) {
    this.spanId = generateSpanId();
    this.traceId = traceId;
    this.parentSpanId = parentSpanId || null;
    this.name = name;
    this.kind = kind;
    this.startTime = Date.now();
    this.endTime = null;
    this.status = SpanStatus.UNSET;
    this.statusMessage = null;
    this.attributes = { ...attributes };
    this.events = [];
    this._ended = false;
  }

  /**
   * 设置属性
   * @param {string} key
   * @param {any} value
   */
  setAttribute(key, value) {
    if (!this._ended) {
      this.attributes[key] = value;
    }
    return this;
  }

  /**
   * 设置多个属性
   * @param {object} attrs
   */
  setAttributes(attrs) {
    if (!this._ended && attrs) {
      Object.assign(this.attributes, attrs);
    }
    return this;
  }

  /**
   * 添加事件
   * @param {string} name
   * @param {object} [attributes]
   */
  addEvent(name, attributes = {}) {
    if (!this._ended) {
      this.events.push({
        name,
        ts: Date.now(),
        attributes,
      });
    }
    return this;
  }

  /**
   * 设置状态
   * @param {string} status
   * @param {string} [message]
   */
  setStatus(status, message) {
    if (!this._ended) {
      this.status = status;
      this.statusMessage = message || null;
    }
    return this;
  }

  /**
   * 记录异常
   * @param {Error} error
   */
  recordException(error) {
    this.addEvent("exception", {
      "exception.type": error?.name || "Error",
      "exception.message": error?.message || String(error),
      "exception.stacktrace": error?.stack,
    });
    this.setStatus(SpanStatus.ERROR, error?.message);
    return this;
  }

  /**
   * 结束 Span
   */
  end() {
    if (!this._ended) {
      this.endTime = Date.now();
      this._ended = true;

      if (this.status === SpanStatus.UNSET) {
        this.status = SpanStatus.OK;
      }
    }
    return this;
  }

  /**
   * 获取持续时间 (ms)
   */
  get duration() {
    const end = this.endTime || Date.now();
    return end - this.startTime;
  }

  /**
   * 是否已结束
   */
  get isEnded() {
    return this._ended;
  }

  /**
   * 获取 W3C traceparent 格式
   */
  get traceparent() {
    const flags = "01"; // sampled
    return `${TRACE_VERSION}-${this.traceId}-${this.spanId}-${flags}`;
  }

  /**
   * 转换为 JSON
   */
  toJSON() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.duration,
      status: this.status,
      statusMessage: this.statusMessage,
      attributes: this.attributes,
      events: this.events,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trace Context
// ─────────────────────────────────────────────────────────────────────────────

export class TraceContext {
  /**
   * @param {object} options
   * @param {string} [options.traceId] - 继承的 Trace ID
   * @param {string} [options.parentSpanId] - 父 Span ID
   * @param {function} [options.onSpanEnd] - Span 结束回调
   * @param {number} [options.maxSpans=1000] - 最大 Span 数量
   */
  constructor({ traceId, parentSpanId, onSpanEnd, maxSpans = 1000 } = {}) {
    this.traceId = traceId || generateTraceId();
    this._rootSpanId = parentSpanId || null;
    this._onSpanEnd = typeof onSpanEnd === "function" ? onSpanEnd : null;
    this._maxSpans = maxSpans;

    /** @type {Map<string, Span>} */
    this._spans = new Map();

    /** @type {Span[]} */
    this._spanStack = [];
  }

  /**
   * 开始新 Span
   * @param {string} name
   * @param {object} [options]
   * @returns {Span}
   */
  startSpan(name, { kind, attributes, parentSpan } = {}) {
    // 确定父 Span
    let parentSpanId = null;
    if (parentSpan) {
      parentSpanId = parentSpan.spanId;
    } else if (this._spanStack.length > 0) {
      parentSpanId = this._spanStack[this._spanStack.length - 1].spanId;
    } else {
      parentSpanId = this._rootSpanId;
    }

    const span = new Span({
      name,
      traceId: this.traceId,
      parentSpanId,
      kind,
      attributes,
    });

    this._spans.set(span.spanId, span);
    this._spanStack.push(span);

    // 限制 Span 数量
    if (this._spans.size > this._maxSpans) {
      this._trimOldSpans();
    }

    logger.info("Span started", { name, spanId: span.spanId, traceId: this.traceId });

    return span;
  }

  /**
   * 结束当前 Span
   * @param {Span} [span] - 指定 Span，默认为栈顶
   */
  endSpan(span) {
    const targetSpan = span || this._spanStack.pop();
    if (!targetSpan) return;

    targetSpan.end();

    // 从栈中移除
    if (!span && this._spanStack.length > 0) {
      const idx = this._spanStack.indexOf(targetSpan);
      if (idx >= 0) this._spanStack.splice(idx, 1);
    }

    if (this._onSpanEnd) {
      this._onSpanEnd(targetSpan);
    }

    logger.info("Span ended", {
      name: targetSpan.name,
      spanId: targetSpan.spanId,
      duration: targetSpan.duration,
      status: targetSpan.status,
    });
  }

  /**
   * 获取当前活跃 Span
   */
  get currentSpan() {
    return this._spanStack.length > 0 ? this._spanStack[this._spanStack.length - 1] : null;
  }

  /**
   * 在 Span 中执行函数
   * @param {string} name
   * @param {function} fn
   * @param {object} [options]
   * @returns {Promise<any>}
   */
  async withSpan(name, fn, options = {}) {
    const span = this.startSpan(name, options);

    try {
      const result = await fn(span);
      span.setStatus(SpanStatus.OK);
      return result;
    } catch (error) {
      span.recordException(error);
      throw error;
    } finally {
      this.endSpan(span);
    }
  }

  /**
   * 获取所有 Span
   */
  getSpans() {
    return [...this._spans.values()].map((s) => s.toJSON());
  }

  /**
   * 获取 Span 树
   */
  getSpanTree() {
    const spans = [...this._spans.values()];
    const tree = [];
    const lookup = new Map();

    // 首先创建所有节点
    for (const span of spans) {
      lookup.set(span.spanId, { ...span.toJSON(), children: [] });
    }

    // 构建树
    for (const span of spans) {
      const node = lookup.get(span.spanId);
      if (span.parentSpanId && lookup.has(span.parentSpanId)) {
        lookup.get(span.parentSpanId).children.push(node);
      } else {
        tree.push(node);
      }
    }

    return tree;
  }

  /**
   * 获取 traceparent 头
   */
  getTraceparent() {
    const span = this.currentSpan;
    if (span) {
      return span.traceparent;
    }
    return `${TRACE_VERSION}-${this.traceId}-${generateSpanId()}-01`;
  }

  /**
   * 从 traceparent 解析
   * @param {string} traceparent
   * @returns {object|null}
   */
  static parseTraceparent(traceparent) {
    if (!traceparent || typeof traceparent !== "string") return null;

    const parts = traceparent.split("-");
    if (parts.length < 4) return null;

    const [version, traceId, spanId, flags] = parts;

    if (version !== TRACE_VERSION) return null;
    if (traceId.length !== 32) return null;
    if (spanId.length !== 16) return null;

    return {
      version,
      traceId,
      spanId,
      sampled: (parseInt(flags, 16) & 1) === 1,
    };
  }

  /**
   * 获取统计信息
   */
  get stats() {
    const spans = [...this._spans.values()];
    return {
      traceId: this.traceId,
      totalSpans: spans.length,
      activeSpans: spans.filter((s) => !s.isEnded).length,
      completedSpans: spans.filter((s) => s.isEnded).length,
      errorSpans: spans.filter((s) => s.status === SpanStatus.ERROR).length,
      avgDuration: spans.length > 0
        ? spans.reduce((sum, s) => sum + s.duration, 0) / spans.length
        : 0,
    };
  }

  /**
   * 清理旧 Span
   * @private
   */
  _trimOldSpans() {
    const spans = [...this._spans.entries()]
      .filter(([, span]) => span.isEnded)
      .sort((a, b) => a[1].endTime - b[1].endTime);

    const toRemove = spans.slice(0, Math.floor(this._maxSpans * 0.2));
    for (const [id] of toRemove) {
      this._spans.delete(id);
    }
  }

  /**
   * 重置
   */
  reset() {
    this._spans.clear();
    this._spanStack = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { generateTraceId, generateSpanId };

export default TraceContext;
