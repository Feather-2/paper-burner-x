/**
 * Paper Burner - 本地性能监控工具
 * Phase 4.4.3: 性能数据收集（仅本地，不上报）
 *
 * 使用方法：
 * - 启动监控：PerfMonitor.start()
 * - 停止监控：PerfMonitor.stop()
 * - 查看实时数据：PerfMonitor.getStats()
 * - 导出数据：PerfMonitor.export()
 * - 清空数据：PerfMonitor.clear()
 */

window.PerfMonitor = (function() {
  // 性能数据存储（仅内存，不持久化）
  var metrics = {
    renderTime: [],      // 渲染耗时记录
    fps: [],             // FPS 记录
    longTasks: [],       // 长任务记录
    memoryUsage: [],     // 内存使用记录
    scrollEvents: [],    // 滚动事件密度
    domNodes: []         // DOM 节点数量
  };

  // 监控状态
  var state = {
    isRunning: false,
    startTime: null,
    fpsAnimationId: null,
    memoryIntervalId: null,
    longTaskObserver: null
  };

  // 配置
  var config = {
    maxSamples: 1000,           // 每个指标最多保留样本数
    memoryCheckInterval: 5000,  // 内存检测间隔 (ms)
    fpsCheckInterval: 1000,     // FPS 统计间隔 (ms)
    longTaskThreshold: 50       // 长任务阈值 (ms)
  };

  /**
   * FPS 监控
   */
  function measureFPS() {
    var lastTime = performance.now();
    var frames = 0;
    var lastRecordTime = lastTime;

    function loop() {
      if (!state.isRunning) return;

      frames++;
      var now = performance.now();

      // 每秒统计一次 FPS
      if (now >= lastRecordTime + config.fpsCheckInterval) {
        var fps = Math.round((frames * 1000) / (now - lastRecordTime));

        metrics.fps.push({
          fps: fps,
          timestamp: Date.now()
        });

        // 限制样本数量
        if (metrics.fps.length > config.maxSamples) {
          metrics.fps.shift();
        }

        frames = 0;
        lastRecordTime = now;
      }

      state.fpsAnimationId = requestAnimationFrame(loop);
    }

    state.fpsAnimationId = requestAnimationFrame(loop);
  }

  /**
   * 内存监控（仅 Chrome 支持）
   */
  function measureMemory() {
    if (!performance.memory) return;

    try {
      metrics.memoryUsage.push({
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit,
        timestamp: Date.now()
      });

      // 限制样本数量
      if (metrics.memoryUsage.length > config.maxSamples) {
        metrics.memoryUsage.shift();
      }
    } catch (e) {
      console.warn('[PerfMonitor] Memory API error:', e);
    }
  }

  /**
   * 长任务监控（需要 PerformanceObserver 支持）
   */
  function observeLongTasks() {
    if (!window.PerformanceObserver) return;

    try {
      state.longTaskObserver = new PerformanceObserver(function(list) {
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (entry.duration >= config.longTaskThreshold) {
            metrics.longTasks.push({
              duration: entry.duration,
              startTime: entry.startTime,
              timestamp: Date.now()
            });

            // 限制样本数量
            if (metrics.longTasks.length > config.maxSamples) {
              metrics.longTasks.shift();
            }
          }
        }
      });

      // 监控 longtask（需要浏览器支持）
      state.longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      // longtask 类型可能不支持，降级为 measure
      try {
        state.longTaskObserver.observe({ entryTypes: ['measure'] });
      } catch (e2) {
        console.warn('[PerfMonitor] PerformanceObserver not supported');
      }
    }
  }

  /**
   * 记录渲染耗时
   */
  function recordRenderTime(duration, context) {
    if (!state.isRunning) return;

    metrics.renderTime.push({
      duration: duration,
      context: context || 'unknown',
      timestamp: Date.now()
    });

    // 限制样本数量
    if (metrics.renderTime.length > config.maxSamples) {
      metrics.renderTime.shift();
    }
  }

  /**
   * 记录 DOM 节点数量
   */
  function recordDOMNodes() {
    if (!state.isRunning) return;

    var chatBody = document.querySelector('.chat-body');
    if (!chatBody) return;

    metrics.domNodes.push({
      total: document.querySelectorAll('*').length,
      chatMessages: chatBody.querySelectorAll('.message').length,
      timestamp: Date.now()
    });

    // 限制样本数量
    if (metrics.domNodes.length > config.maxSamples) {
      metrics.domNodes.shift();
    }
  }

  /**
   * 计算统计数据
   */
  function calculateStats(arr, key) {
    if (!arr || arr.length === 0) {
      return { count: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
    }

    var values = key
      ? arr.map(function(item) { return item[key]; })
      : arr;

    var sorted = values.slice().sort(function(a, b) { return a - b; });
    var sum = sorted.reduce(function(acc, val) { return acc + val; }, 0);

    return {
      count: sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)]
    };
  }

  /**
   * 获取性能统计数据
   */
  function getStats() {
    var now = Date.now();
    var duration = state.startTime ? (now - state.startTime) / 1000 : 0;

    return {
      session: {
        isRunning: state.isRunning,
        duration: duration.toFixed(1) + 's',
        startTime: state.startTime ? new Date(state.startTime).toISOString() : null
      },
      device: {
        tier: window.PerformanceExperiment?.deviceTier || 'unknown',
        cores: navigator.hardwareConcurrency || 'unknown',
        memory: navigator.deviceMemory ? navigator.deviceMemory + 'GB' : 'unknown',
        userAgent: navigator.userAgent
      },
      rendering: {
        samples: metrics.renderTime.length,
        stats: calculateStats(metrics.renderTime, 'duration')
      },
      fps: {
        samples: metrics.fps.length,
        stats: calculateStats(metrics.fps, 'fps'),
        current: metrics.fps.length > 0 ? metrics.fps[metrics.fps.length - 1].fps : null
      },
      memory: performance.memory ? {
        samples: metrics.memoryUsage.length,
        current: metrics.memoryUsage.length > 0 ? {
          used: (metrics.memoryUsage[metrics.memoryUsage.length - 1].used / 1024 / 1024).toFixed(1) + 'MB',
          total: (metrics.memoryUsage[metrics.memoryUsage.length - 1].total / 1024 / 1024).toFixed(1) + 'MB'
        } : null,
        peak: metrics.memoryUsage.length > 0 ? {
          used: (Math.max.apply(null, metrics.memoryUsage.map(function(m) { return m.used; })) / 1024 / 1024).toFixed(1) + 'MB'
        } : null
      } : { available: false },
      longTasks: {
        samples: metrics.longTasks.length,
        stats: calculateStats(metrics.longTasks, 'duration'),
        recent: metrics.longTasks.slice(-5)
      },
      dom: {
        samples: metrics.domNodes.length,
        current: metrics.domNodes.length > 0 ? metrics.domNodes[metrics.domNodes.length - 1] : null
      }
    };
  }

  /**
   * 导出原始数据（JSON 格式）
   */
  function exportData() {
    var data = {
      exportTime: new Date().toISOString(),
      session: getStats().session,
      device: getStats().device,
      metrics: {
        renderTime: metrics.renderTime,
        fps: metrics.fps,
        longTasks: metrics.longTasks,
        memoryUsage: metrics.memoryUsage,
        domNodes: metrics.domNodes
      }
    };

    // 输出到控制台
    console.log('[PerfMonitor] 导出数据：');
    console.log(JSON.stringify(data, null, 2));

    // 返回数据，方便复制
    return data;
  }

  /**
   * 启动监控
   */
  function start() {
    if (state.isRunning) {
      console.warn('[PerfMonitor] 监控已在运行中');
      return;
    }

    console.log('[PerfMonitor] 启动性能监控...');
    state.isRunning = true;
    state.startTime = Date.now();

    // 启动各项监控
    measureFPS();
    observeLongTasks();

    // 定期采集内存和 DOM 信息
    state.memoryIntervalId = setInterval(function() {
      measureMemory();
      recordDOMNodes();
    }, config.memoryCheckInterval);

    console.log('[PerfMonitor] 监控已启动。使用 PerfMonitor.getStats() 查看实时数据');
  }

  /**
   * 停止监控
   */
  function stop() {
    if (!state.isRunning) {
      console.warn('[PerfMonitor] 监控未在运行');
      return;
    }

    console.log('[PerfMonitor] 停止性能监控...');
    state.isRunning = false;

    // 停止各项监控
    if (state.fpsAnimationId) {
      cancelAnimationFrame(state.fpsAnimationId);
      state.fpsAnimationId = null;
    }

    if (state.memoryIntervalId) {
      clearInterval(state.memoryIntervalId);
      state.memoryIntervalId = null;
    }

    if (state.longTaskObserver) {
      state.longTaskObserver.disconnect();
      state.longTaskObserver = null;
    }

    // 显示统计摘要
    var stats = getStats();
    console.log('[PerfMonitor] 监控已停止。统计摘要：');
    console.table({
      '监控时长': stats.session.duration,
      '平均渲染耗时': stats.rendering.stats.avg.toFixed(1) + 'ms',
      'P95渲染耗时': stats.rendering.stats.p95.toFixed(1) + 'ms',
      '平均FPS': stats.fps.stats.avg.toFixed(0),
      '最低FPS': stats.fps.stats.min,
      '长任务数量': stats.longTasks.samples
    });
  }

  /**
   * 清空数据
   */
  function clear() {
    metrics.renderTime = [];
    metrics.fps = [];
    metrics.longTasks = [];
    metrics.memoryUsage = [];
    metrics.scrollEvents = [];
    metrics.domNodes = [];
    console.log('[PerfMonitor] 数据已清空');
  }

  // 公开 API
  return {
    start: start,
    stop: stop,
    clear: clear,
    getStats: getStats,
    export: exportData,
    recordRender: recordRenderTime,

    // 用于调试
    _metrics: metrics,
    _state: state,
    _config: config
  };
})();

// 自动集成到现有的渲染流程
(function() {
  // 拦截 ChatbotRenderState，自动记录渲染耗时
  if (window.ChatbotRenderState) {
    var originalRenderState = window.ChatbotRenderState;

    // 包装 lastRenderDuration 的更新
    Object.defineProperty(window.ChatbotRenderState, 'lastRenderDuration', {
      get: function() {
        return this._lastRenderDuration || 0;
      },
      set: function(value) {
        this._lastRenderDuration = value;
        // 自动记录到性能监控
        window.PerfMonitor.recordRender(value, 'chatbot_render');
      },
      configurable: true
    });
  }
})();

console.log('[PerfMonitor] 性能监控工具已加载。使用方法：');
console.log('  PerfMonitor.start()    - 启动监控');
console.log('  PerfMonitor.stop()     - 停止监控');
console.log('  PerfMonitor.getStats() - 查看统计');
console.log('  PerfMonitor.export()   - 导出数据');
console.log('  PerfMonitor.clear()    - 清空数据');
