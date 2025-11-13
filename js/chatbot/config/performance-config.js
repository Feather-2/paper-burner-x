/**
 * Paper Burner - 性能优化配置
 * Phase 3.5: 统一管理所有性能相关的配置常量
 */

window.PerformanceConfig = {
  // 流式更新间隔配置
  UPDATE_INTERVALS: {
    FOREGROUND: 800,        // 前台标签页更新间隔 (ms)
    BACKGROUND: 3000,       // 后台标签页更新间隔 (ms)
    DEBOUNCE: 150          // 防抖延迟 (ms)
  },

  // 智能跳帧配置
  ADAPTIVE_RENDER: {
    HEAVY_THRESHOLD: 200,   // 重负载阈值 (ms)
    MIN_MULTIPLIER: 1,      // 最小倍数
    MAX_MULTIPLIER: 4,      // 最大倍数
    DECAY_THRESHOLD: 100,   // 衰减阈值 (ms) - 低于此值时逐步恢复
    WARN_THRESHOLD: 100     // 日志警告阈值 (ms)
  },

  // PNG导出配置
  EXPORT: {
    MAX_WIDTH: 1200,        // 导出容器最大宽度 (px)
    ABSOLUTE_MAX_WIDTH: 2000, // 绝对最大宽度 (px)
    LAYOUT_DELAY: 50,       // DOM重排延迟 (ms)
    SCALE: 2                // html2canvas缩放倍数
  },

  // 日志配置
  LOGGING: {
    ENABLED: true,          // 是否启用日志
    LEVEL: 'warn',          // 日志级别: 'debug' | 'info' | 'warn' | 'error'
    PERFORMANCE_LOGS: true  // 是否启用性能日志
  },

  // 滚动配置
  SCROLL: {
    BOTTOM_THRESHOLD: 50    // 判定用户在底部的容差 (px)
  }
};

/**
 * 日志工具 - 根据配置级别输出日志
 */
window.PerfLogger = {
  _shouldLog(level) {
    if (!window.PerformanceConfig.LOGGING.ENABLED) return false;

    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const configLevel = levels[window.PerformanceConfig.LOGGING.LEVEL] || 1;
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
    if (window.PerformanceConfig.LOGGING.PERFORMANCE_LOGS && duration > window.PerformanceConfig.ADAPTIVE_RENDER.WARN_THRESHOLD) {
      this.warn(`性能: ${message} - ${duration.toFixed(0)}ms`);
    }
  }
};

/**
 * 渲染状态管理 - 避免全局变量污染
 */
window.ChatbotRenderState = {
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
