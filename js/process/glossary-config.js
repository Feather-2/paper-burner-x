// process/glossary-config.js
/**
 * 术语库性能配置与优化工具
 */

/**
 * 根据设备性能动态调整并发数
 */
function getOptimalConcurrency(userConcurrency) {
  // 检测设备内存
  const memory = navigator.deviceMemory || 4; // GB，默认 4GB

  // 检测术语库规模
  const termCount = (typeof loadGlossaryEntries === 'function')
    ? loadGlossaryEntries().filter(e => e.enabled).length
    : 0;

  // 根据术语数和内存计算推荐并发
  let recommended;
  if (termCount > 50000) {
    // 大型术语库：降低并发
    recommended = memory >= 4 ? 30 : memory >= 2 ? 15 : 8;
  } else if (termCount > 10000) {
    // 中型术语库
    recommended = memory >= 4 ? 50 : memory >= 2 ? 25 : 10;
  } else {
    // 小型术语库：不限制
    recommended = memory >= 4 ? 100 : memory >= 2 ? 50 : 20;
  }

  // 不超过用户设置
  return Math.min(userConcurrency, recommended);
}

/**
 * 获取术语库性能统计
 */
function getGlossaryStats() {
  if (typeof loadGlossaryEntries !== 'function') {
    return { enabled: 0, total: 0, memoryMB: 0 };
  }

  const all = loadGlossaryEntries();
  const enabled = all.filter(e => e && e.enabled && e.term && e.translation);

  // 估算内存占用
  const avgTermLength = enabled.reduce((sum, e) => sum + (e.term.length + e.translation.length), 0) / (enabled.length || 1);
  const estimatedMemoryMB = Math.ceil((
    enabled.length * avgTermLength * 2 + // 术语内容
    enabled.length * 125 // Trie 节点
  ) / 1024 / 1024);

  return {
    total: all.length,
    enabled: enabled.length,
    memoryMB: estimatedMemoryMB,
    avgTermLength: Math.round(avgTermLength)
  };
}

/**
 * 检查是否应启用术语库（性能预警）
 */
function shouldEnableGlossary() {
  const stats = getGlossaryStats();

  // 无术语时禁用
  if (stats.enabled === 0) return { enabled: false, reason: 'no_terms' };

  // 检查内存
  const memory = navigator.deviceMemory || 4;
  if (stats.memoryMB > memory * 100) {
    // 术语库占用超过设备内存的 10%
    return {
      enabled: false,
      reason: 'memory_limit',
      message: `术语库需要 ${stats.memoryMB}MB 内存，超出设备承受能力`
    };
  }

  return { enabled: true, stats };
}

/**
 * 显示性能建议
 */
function showPerformanceRecommendation(concurrency, blockCount) {
  const stats = getGlossaryStats();
  if (stats.enabled === 0) return;

  const optimal = getOptimalConcurrency(concurrency);

  if (optimal < concurrency && stats.enabled > 10000) {
    console.warn(
      `[术语库性能建议] 当前有 ${stats.enabled} 条术语，` +
      `建议将并发从 ${concurrency} 降至 ${optimal}，` +
      `以获得最佳性能和稳定性。`
    );
  }

  // 估算耗时
  const matchTimePerBlock = stats.enabled > 50000 ? 100 : stats.enabled > 10000 ? 77 : 50; // ms
  const totalMatchTime = Math.ceil(blockCount * matchTimePerBlock / Math.min(concurrency, optimal) / 1000);

  console.info(
    `[术语库性能预估] ${stats.enabled} 条术语 × ${blockCount} 个块，` +
    `预计术语匹配耗时: ${totalMatchTime} 秒 (并发 ${Math.min(concurrency, optimal)})`
  );
}

// 导出到全局
if (typeof window !== 'undefined') {
  window.glossaryConfig = {
    getOptimalConcurrency,
    getGlossaryStats,
    shouldEnableGlossary,
    showPerformanceRecommendation
  };
}
