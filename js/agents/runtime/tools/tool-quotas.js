/**
 * Tool Quotas - 工具级别配额管理
 *
 * 特性：
 * - 每工具调用配额
 * - 滑动窗口计数
 * - 配额预警和阻断
 */

import { createLogger } from "../../shared/utils/logger.js";
import { createSafeRegex } from "../../shared/utils/safe-regex.js";

const logger = createLogger("runtime/tools/tool-quotas");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 60 * 1000; // 1 分钟窗口
const DEFAULT_MAX_CALLS = 100; // 默认最大调用次数

// ─────────────────────────────────────────────────────────────────────────────
// Sliding Window Counter
// ─────────────────────────────────────────────────────────────────────────────

class SlidingWindowCounter {
  constructor(windowMs) {
    this._windowMs = windowMs;
    this._timestamps = [];
  }

  /**
   * 记录一次调用
   */
  record() {
    const now = Date.now();
    this._timestamps.push(now);
    this._cleanup(now);
  }

  /**
   * 获取窗口内调用次数
   */
  getCount() {
    this._cleanup(Date.now());
    return this._timestamps.length;
  }

  /**
   * 清理过期记录
   * @private
   */
  _cleanup(now) {
    const cutoff = now - this._windowMs;
    while (this._timestamps.length > 0 && this._timestamps[0] < cutoff) {
      this._timestamps.shift();
    }
  }

  /**
   * 重置
   */
  reset() {
    this._timestamps = [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Quota Entry
// ─────────────────────────────────────────────────────────────────────────────

class ToolQuotaEntry {
  constructor(toolName, { maxCalls = DEFAULT_MAX_CALLS, windowMs = DEFAULT_WINDOW_MS } = {}) {
    this.toolName = toolName;
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
    this.counter = new SlidingWindowCounter(windowMs);
    this.blockedCount = 0;
    this.totalCalls = 0;
    this.lastBlocked = null;
  }

  /**
   * 尝试调用
   * @returns {{ allowed: boolean, remaining: number, reason?: string }}
   */
  tryCall() {
    const current = this.counter.getCount();
    const remaining = Math.max(0, this.maxCalls - current);

    if (current >= this.maxCalls) {
      this.blockedCount++;
      this.lastBlocked = Date.now();
      return {
        allowed: false,
        remaining: 0,
        reason: `Quota exceeded for ${this.toolName}: ${current}/${this.maxCalls}`,
      };
    }

    this.counter.record();
    this.totalCalls++;

    return {
      allowed: true,
      remaining: remaining - 1,
    };
  }

  /**
   * 检查是否允许调用（不计数）
   */
  canCall() {
    return this.counter.getCount() < this.maxCalls;
  }

  /**
   * 获取使用率
   */
  getUsageRatio() {
    return this.counter.getCount() / this.maxCalls;
  }

  /**
   * 获取统计
   */
  getStats() {
    const current = this.counter.getCount();
    return {
      toolName: this.toolName,
      current,
      maxCalls: this.maxCalls,
      windowMs: this.windowMs,
      remaining: Math.max(0, this.maxCalls - current),
      usageRatio: this.getUsageRatio(),
      totalCalls: this.totalCalls,
      blockedCount: this.blockedCount,
      lastBlocked: this.lastBlocked,
    };
  }

  /**
   * 重置
   */
  reset() {
    this.counter.reset();
    this.blockedCount = 0;
    this.totalCalls = 0;
    this.lastBlocked = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool Quota Manager
// ─────────────────────────────────────────────────────────────────────────────

export class ToolQuotaManager {
  /**
   * @param {object} options
   * @param {number} [options.defaultMaxCalls=100] - 默认最大调用次数
   * @param {number} [options.defaultWindowMs=60000] - 默认窗口大小
   * @param {Object<string, { maxCalls?: number, windowMs?: number }>} [options.quotas] - 工具配额配置
   * @param {function} [options.onQuotaExceeded] - 配额超限回调
   * @param {function} [options.onQuotaWarning] - 配额预警回调 (80%)
   */
  constructor({
    defaultMaxCalls = DEFAULT_MAX_CALLS,
    defaultWindowMs = DEFAULT_WINDOW_MS,
    quotas = {},
    onQuotaExceeded,
    onQuotaWarning,
  } = {}) {
    this._defaultMaxCalls = defaultMaxCalls;
    this._defaultWindowMs = defaultWindowMs;
    this._onQuotaExceeded = typeof onQuotaExceeded === "function" ? onQuotaExceeded : null;
    this._onQuotaWarning = typeof onQuotaWarning === "function" ? onQuotaWarning : null;

    /** @type {Map<string, ToolQuotaEntry>} */
    this._tools = new Map();

    // 初始化预设配额
    for (const [toolName, config] of Object.entries(quotas)) {
      this.setQuota(toolName, config);
    }
  }

  /**
   * 设置工具配额
   * @param {string} toolName
   * @param {object} config
   */
  setQuota(toolName, { maxCalls, windowMs } = {}) {
    const entry = new ToolQuotaEntry(toolName, {
      maxCalls: maxCalls ?? this._defaultMaxCalls,
      windowMs: windowMs ?? this._defaultWindowMs,
    });
    this._tools.set(toolName, entry);
    return this;
  }

  /**
   * 尝试调用工具
   * @param {string} toolName
   * @returns {{ allowed: boolean, remaining: number, reason?: string }}
   */
  tryCall(toolName) {
    let entry = this._tools.get(toolName);

    // 如果没有预设配额，使用默认配额
    if (!entry) {
      entry = new ToolQuotaEntry(toolName, {
        maxCalls: this._defaultMaxCalls,
        windowMs: this._defaultWindowMs,
      });
      this._tools.set(toolName, entry);
    }

    const result = entry.tryCall();

    if (!result.allowed) {
      logger.warn("Tool quota exceeded", { toolName, ...entry.getStats() });

      if (this._onQuotaExceeded) {
        this._onQuotaExceeded({ toolName, stats: entry.getStats() });
      }
    } else {
      // 检查是否接近配额（80%）
      const usageRatio = entry.getUsageRatio();
      if (usageRatio >= 0.8 && this._onQuotaWarning) {
        this._onQuotaWarning({ toolName, usageRatio, stats: entry.getStats() });
      }
    }

    return result;
  }

  /**
   * 强制记录一次调用（不做阻断）
   * 用于 warn-only 模式下的超限统计
   * @param {string} toolName
   */
  recordCall(toolName) {
    let entry = this._tools.get(toolName);

    // 如果没有预设配额，使用默认配额
    if (!entry) {
      entry = new ToolQuotaEntry(toolName, {
        maxCalls: this._defaultMaxCalls,
        windowMs: this._defaultWindowMs,
      });
      this._tools.set(toolName, entry);
    }

    entry.counter.record();
    entry.totalCalls++;

    return entry.getStats();
  }

  /**
   * 检查是否允许调用（不计数）
   * @param {string} toolName
   */
  canCall(toolName) {
    const entry = this._tools.get(toolName);
    if (!entry) return true; // 没有配额限制
    return entry.canCall();
  }

  /**
   * 获取工具统计
   * @param {string} toolName
   */
  getToolStats(toolName) {
    const entry = this._tools.get(toolName);
    return entry ? entry.getStats() : null;
  }

  /**
   * 获取所有工具统计
   */
  getAllStats() {
    const result = {};
    for (const [name, entry] of this._tools) {
      result[name] = entry.getStats();
    }
    return result;
  }

  /**
   * 获取超限工具列表
   */
  getBlockedTools() {
    return [...this._tools.values()]
      .filter((e) => !e.canCall())
      .map((e) => e.getStats());
  }

  /**
   * 获取高使用率工具列表（>80%）
   */
  getHighUsageTools() {
    return [...this._tools.values()]
      .filter((e) => e.getUsageRatio() > 0.8)
      .map((e) => e.getStats());
  }

  /**
   * 重置指定工具配额
   * @param {string} toolName
   */
  resetTool(toolName) {
    const entry = this._tools.get(toolName);
    if (entry) entry.reset();
  }

  /**
   * 重置所有配额
   */
  resetAll() {
    for (const entry of this._tools.values()) {
      entry.reset();
    }
  }

  /**
   * 移除工具配额
   * @param {string} toolName
   */
  removeQuota(toolName) {
    this._tools.delete(toolName);
  }

  /**
   * 获取汇总统计
   */
  get summary() {
    const tools = [...this._tools.values()];
    return {
      totalTools: tools.length,
      blockedTools: tools.filter((e) => !e.canCall()).length,
      highUsageTools: tools.filter((e) => e.getUsageRatio() > 0.8).length,
      totalCalls: tools.reduce((sum, e) => sum + e.totalCalls, 0),
      totalBlocked: tools.reduce((sum, e) => sum + e.blockedCount, 0),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract Validator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 简单的 JSON Schema 验证器（用于工具输入/输出契约验证）
 */
export class ContractValidator {
  /**
   * @param {object} schema - JSON Schema 定义
   */
  constructor(schema) {
    this._schema = schema || {};
  }

  /**
   * 验证数据
   * @param {any} data
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(data) {
    const errors = [];
    this._validateValue(data, this._schema, "", errors);
    return { valid: errors.length === 0, errors };
  }

  /**
   * 递归验证
   * @private
   */
  _validateValue(value, schema, path, errors) {
    if (!schema) return;

    // 类型检查
    if (schema.type) {
      const actualType = this._getType(value);
      const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];

      if (!expectedTypes.includes(actualType) && value !== null && value !== undefined) {
        errors.push(`${path || "root"}: expected ${expectedTypes.join("|")}, got ${actualType}`);
        return;
      }
    }

    // 必需检查
    if (schema.required && (value === null || value === undefined)) {
      errors.push(`${path || "root"}: required but missing`);
      return;
    }

    // 对象属性检查
    if (schema.type === "object" && schema.properties && typeof value === "object" && value !== null) {
      // 必需属性
      if (schema.required && Array.isArray(schema.required)) {
        for (const prop of schema.required) {
          if (!(prop in value)) {
            errors.push(`${path}.${prop}: required property missing`);
          }
        }
      }

      // 递归检查属性
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (prop in value) {
          this._validateValue(value[prop], propSchema, `${path}.${prop}`, errors);
        }
      }
    }

    // 数组项检查
    if (schema.type === "array" && schema.items && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        this._validateValue(value[i], schema.items, `${path}[${i}]`, errors);
      }
    }

    // 枚举检查
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`${path || "root"}: must be one of ${schema.enum.join(", ")}`);
    }

    // 数字范围
    if (schema.type === "number" && typeof value === "number") {
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${path || "root"}: must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${path || "root"}: must be <= ${schema.maximum}`);
      }
    }

    // 字符串长度
    if (schema.type === "string" && typeof value === "string") {
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${path || "root"}: length must be >= ${schema.minLength}`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path || "root"}: length must be <= ${schema.maxLength}`);
      }
      if (schema.pattern) {
        try {
          const regex = createSafeRegex(schema.pattern, "u");
          if (!regex.test(value)) {
            errors.push(`${path || "root"}: must match pattern ${schema.pattern}`);
          }
        } catch (err) {
          errors.push(`${path || "root"}: invalid pattern ${schema.pattern} (${err?.message || String(err)})`);
        }
      }
    }
  }

  /**
   * 获取类型
   * @private
   */
  _getType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }
}

/**
 * 创建工具契约验证器
 * @param {object} inputSchema - 输入 schema
 * @param {object} outputSchema - 输出 schema
 */
export function createToolContract(inputSchema, outputSchema) {
  const inputValidator = new ContractValidator(inputSchema);
  const outputValidator = new ContractValidator(outputSchema);

  return {
    validateInput(data) {
      return inputValidator.validate(data);
    },
    validateOutput(data) {
      return outputValidator.validate(data);
    },
    validate(input, output) {
      const inputResult = inputValidator.validate(input);
      const outputResult = outputValidator.validate(output);
      return {
        valid: inputResult.valid && outputResult.valid,
        inputErrors: inputResult.errors,
        outputErrors: outputResult.errors,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default ToolQuotaManager;
