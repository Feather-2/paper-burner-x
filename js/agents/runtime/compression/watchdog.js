/**
 * Watchdog - 健康监控器
 *
 * 职责：
 * 1. 监控 Agent 运行健康状态
 * 2. 检测异常（超时、死循环、资源耗尽）
 * 3. 触发干预
 *
 * 注意：子代理启动和交接文档已移至 TaskTool 和 CicadaCompressor
 */

import { WatchdogEvents } from "../events/events.js";
import { toNonEmptyString } from "../../shared/utils/value-utils.js";

export class Watchdog {
  constructor({ eventBus } = {}) {
    this.eventBus = eventBus || null;
    this._observers = new Map();
    this._startTime = Date.now();
    this._iterationCount = 0;
    this._lastProgressTime = Date.now();
  }

  _emit(name, payload) {
    if (this.eventBus && typeof this.eventBus.emit === "function") {
      this.eventBus.emit(name, { actor: "watchdog", status: "info", payload });
    }
    const handlers = this._observers.get(name);
    if (handlers) {
      for (const handler of handlers) {
        handler(payload);
      }
    }
  }

  observe(eventName, handler) {
    if (typeof handler !== "function") {
      throw new TypeError("Watchdog.observe: handler must be a function");
    }
    const name = toNonEmptyString(eventName);
    if (!name) {
      throw new Error("Watchdog.observe: eventName must be a non-empty string");
    }

    let set = this._observers.get(name);
    if (!set) {
      set = new Set();
      this._observers.set(name, set);
    }
    set.add(handler);

    return () => {
      set.delete(handler);
      if (set.size === 0 && this._observers.get(name) === set) {
        this._observers.delete(name);
      }
    };
  }

  /**
   * 记录迭代进度
   */
  tick() {
    this._iterationCount++;
    this._lastProgressTime = Date.now();
  }

  /**
   * 检查健康状态
   * @param {Object} options - { maxIterations, maxTimeMs, stuckThresholdMs }
   * @returns {Object} { healthy, issues }
   */
  checkHealth(options = {}) {
    const {
      maxIterations = 50,
      maxTimeMs = 600000, // 10 分钟
      stuckThresholdMs = 60000, // 1 分钟无进展
    } = options;

    const issues = [];
    const elapsed = Date.now() - this._startTime;
    const timeSinceProgress = Date.now() - this._lastProgressTime;

    if (this._iterationCount >= maxIterations) {
      issues.push({ type: "max_iterations", value: this._iterationCount, threshold: maxIterations });
    }

    if (elapsed >= maxTimeMs) {
      issues.push({ type: "timeout", value: elapsed, threshold: maxTimeMs });
    }

    if (timeSinceProgress >= stuckThresholdMs) {
      issues.push({ type: "stuck", value: timeSinceProgress, threshold: stuckThresholdMs });
    }

    const healthy = issues.length === 0;

    if (!healthy) {
      this._emit(WatchdogEvents.WATCHDOG_INTERVENTION || "watchdog.intervention", { issues });
    }

    return { healthy, issues, stats: { elapsed, iterationCount: this._iterationCount, timeSinceProgress } };
  }

  /**
   * 触发干预
   */
  intervene(reason, options = {}) {
    const payload = { reason, options, timestamp: new Date().toISOString() };
    this._emit(WatchdogEvents.WATCHDOG_INTERVENTION || "watchdog.intervention", payload);
    return payload;
  }

  /**
   * 重置计时器
   */
  reset() {
    this._startTime = Date.now();
    this._iterationCount = 0;
    this._lastProgressTime = Date.now();
  }
}

export default Watchdog;
