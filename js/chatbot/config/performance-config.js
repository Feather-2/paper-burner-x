/**
 * Paper Burner - 性能优化配置
 * Phase 3.5: 统一管理所有性能相关的配置常量
 * Phase 4.4: 设备自适应配置 + 基础 A/B 测试框架
 *
 * 兼容性：
 * - 提供显式 ESM 导出
 * - 保留 window.* facade（PerformanceExperiment / PerformanceConfig / PerfLogger / ChatbotRenderState）
 */

/**
 * 设备性能检测
 * - 基于 navigator.deviceMemory 与 navigator.hardwareConcurrency
 * - 返回 'high' | 'medium' | 'low'
 */
export function detectDevicePerformance() {
  try {
    const nav = (typeof navigator !== 'undefined' ? navigator : {}) || {};
    const memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 4; // 默认按中等设备处理
    const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 4;

    if (memory >= 8 && cores >= 8) return 'high';
    if (memory >= 4 && cores >= 4) return 'medium';
    return 'low';
  } catch (e) {
    return 'medium';
  }
}

/**
 * Phase 4.4 - 性能实验配置
 * - 使用 localStorage('perf_variant') 控制实验分组
 * - 默认分组为 'control'，保持与当前行为尽量接近
 * - 实验分组可通过控制台手动切换：PerformanceExperiment.setVariant('variant_a')
 */
export const PerformanceExperiment = (function() {
  const STORAGE_KEY = 'perf_variant';
  let variant = 'control';

  try {
    const saved = (typeof localStorage !== 'undefined' && localStorage)
      ? localStorage.getItem(STORAGE_KEY)
      : null;

    if (saved === 'control' || saved === 'variant_a' || saved === 'variant_b') {
      variant = saved;
    }
  } catch (e) {
    // 本地存储不可用时，保持默认值 'control'
  }

  const deviceTier = detectDevicePerformance();

  return {
    storageKey: STORAGE_KEY,
    variant,
    deviceTier,

    setVariant(nextVariant) {
      if (nextVariant !== 'control' && nextVariant !== 'variant_a' && nextVariant !== 'variant_b') return;
      this.variant = nextVariant;
      try {
        if (typeof localStorage !== 'undefined' && localStorage) {
          localStorage.setItem(STORAGE_KEY, nextVariant);
        }
      } catch (e) {
        // 忽略本地存储错误
      }
    },

    /**
     * 获取当前分组下的配置覆盖项
     * key 示例：'UPDATE_INTERVALS'
     */
    getConfig(key) {
      const variants = {
        control: {
          UPDATE_INTERVALS: { FOREGROUND: 400, DEBOUNCE: 100 }
        },
        // 更激进：更快的前台更新 + 更短防抖
        variant_a: {
          UPDATE_INTERVALS: { FOREGROUND: 300, DEBOUNCE: 80 }
        },
        // 更保守：更慢的前台更新 + 更长防抖
        variant_b: {
          UPDATE_INTERVALS: { FOREGROUND: 500, DEBOUNCE: 120 }
        }
      };
      const group = variants[this.variant] || variants.control;
      return group[key];
    }
  };
})();

// 设备自适应基线配置（在实验覆盖前计算）
const __pbDeviceTier = PerformanceExperiment && PerformanceExperiment.deviceTier
  ? PerformanceExperiment.deviceTier
  : detectDevicePerformance();

// 基线更新间隔（未应用 A/B 实验前）
let __pbBaseForegroundInterval = __pbDeviceTier === 'high' ? 300 : 400;
let __pbBaseDebounce = 100;

// 应用 A/B 实验覆盖（仅限 UPDATE_INTERVALS）
const __pbExperimentIntervals = PerformanceExperiment && typeof PerformanceExperiment.getConfig === 'function'
  ? PerformanceExperiment.getConfig('UPDATE_INTERVALS')
  : null;

if (__pbExperimentIntervals) {
  if (typeof __pbExperimentIntervals.FOREGROUND === 'number') {
    __pbBaseForegroundInterval = __pbExperimentIntervals.FOREGROUND;
  }
  if (typeof __pbExperimentIntervals.DEBOUNCE === 'number') {
    __pbBaseDebounce = __pbExperimentIntervals.DEBOUNCE;
  }
}

export const PerformanceConfig = {
  // 流式更新间隔配置（设备自适应 + A/B 覆盖）
  UPDATE_INTERVALS: {
    FOREGROUND: __pbBaseForegroundInterval, // 前台标签页更新间隔 (ms)
    BACKGROUND: 1500,                       // 后台标签页更新间隔 (ms)
    DEBOUNCE: __pbBaseDebounce              // 防抖延迟 (ms)
  },

  // 智能跳帧配置（根据设备性能调整阈值与最大倍数）
  ADAPTIVE_RENDER: {
    HEAVY_THRESHOLD: (function() {
      // 高核机器允许更高的“重渲染”阈值
      try {
        const cores = (typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number')
          ? navigator.hardwareConcurrency
          : 4;
        return cores > 4 ? 300 : 200;
      } catch (e) {
        return 200;
      }
    })(),
    MIN_MULTIPLIER: 1,
    MAX_MULTIPLIER: __pbDeviceTier === 'low' ? 8 : 4,
    DECAY_THRESHOLD: 100,   // 衰减阈值 (ms) - 低于此值时逐步恢复
    WARN_THRESHOLD: 400     // 日志警告阈值 (ms，用于性能日志)
  },

  // PNG 导出配置
  EXPORT: {
    MAX_WIDTH: 1200,          // 导出容器最大宽度 (px)
    ABSOLUTE_MAX_WIDTH: 2000, // 绝对最大宽度 (px)
    LAYOUT_DELAY: 50,         // DOM 重排延迟 (ms)
    SCALE: 2                  // html2canvas 缩放倍数
  },

  // 日志配置
  LOGGING: {
    ENABLED: true,               // 是否启用日志
    LEVEL: 'warn',               // 日志级别: 'debug' | 'info' | 'warn' | 'error'
    PERFORMANCE_LOGS: true,      // 是否启用性能日志
    PERF_MIN_INTERVAL_MS: 2000   // 性能日志最小间隔，避免控制台被刷屏
  },

  // 滚动配置
  SCROLL: {
    BOTTOM_THRESHOLD: 50      // 判定用户在底部的容差 (px)
  }
};

/**
 * 日志工具 - 根据配置级别输出日志
 */
export const PerfLogger = {
  _shouldLog(level) {
    if (!PerformanceConfig.LOGGING.ENABLED) return false;

    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const configLevel = levels[PerformanceConfig.LOGGING.LEVEL] || 1;
    const currentLevel = levels[level] || 0;

    return currentLevel >= configLevel;
  },

  debug(...args) {
    if (this._shouldLog('debug')) console.log('[Phase 3.5 Debug]', ...args);
  },

  info(...args) {
    if (this._shouldLog('info')) console.log('[Phase 3.5 Info]', ...args);
  },

  warn(...args) {
    if (this._shouldLog('warn')) console.warn('[Phase 3.5 Warn]', ...args);
  },

  error(...args) {
    if (this._shouldLog('error')) console.error('[Phase 3.5 Error]', ...args);
  },

  perf(message, duration) {
    if (!PerformanceConfig.LOGGING.PERFORMANCE_LOGS) return;
    if (duration <= PerformanceConfig.ADAPTIVE_RENDER.WARN_THRESHOLD) return;

    // 限制性能日志频率，避免在流式场景中产生成千上万条 warning
    const minInterval = PerformanceConfig.LOGGING.PERF_MIN_INTERVAL_MS || 2000;
    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
      ? performance.now()
      : Date.now();

    if (this._perfLastLogTime && (now - this._perfLastLogTime) < minInterval) {
      return;
    }

    this._perfLastLogTime = now;
    this.warn(`性能: ${message} - ${duration.toFixed(0)}ms`);
  }
};

/**
 * 渲染状态管理 - 避免全局变量污染
 */
export const ChatbotRenderState = {
  lastRenderedMessageCount: 0,
  isExporting: false,
  adaptiveMultiplier: 1,
  lastRenderDuration: 0,

  reset() {
    this.lastRenderedMessageCount = 0;
    this.isExporting = false;
    this.adaptiveMultiplier = 1;
    this.lastRenderDuration = 0;
  }
};

// 向后兼容：暴露到 window
if (typeof window !== 'undefined') {
  window.PerformanceExperiment = PerformanceExperiment;
  window.PerformanceConfig = PerformanceConfig;
  window.PerfLogger = PerfLogger;
  window.ChatbotRenderState = ChatbotRenderState;
}

