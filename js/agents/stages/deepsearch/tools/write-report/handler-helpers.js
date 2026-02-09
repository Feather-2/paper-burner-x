// 分析门槛配置（写报告前必须满足）- 从 config 读取或使用默认值
export const DEFAULT_ANALYSIS_GATES = {
  quick: { minIterations: 3, minDocsRead: 1, minGaps: 0 },
  wider: { minIterations: 8, minDocsRead: 3, minGaps: 2 },
  deeper: { minIterations: 15, minDocsRead: 5, minGaps: 3 },
};

/**
 * 获取分析门槛配置
 */
export function getAnalysisGates(state, mode) {
  const globalConfig = state?.globalConfig?.analysisGates?.[mode];
  const defaults = DEFAULT_ANALYSIS_GATES[mode] || DEFAULT_ANALYSIS_GATES.wider;
  return { ...defaults, ...globalConfig };
}

/**
 * 检查分析门槛是否满足
 */
export function checkAnalysisGates(state, mode) {
  const gates = getAnalysisGates(state, mode);
  const issues = [];

  // 检查迭代次数
  const iteration = state?.iteration || 0;
  if (iteration < gates.minIterations) {
    issues.push(`迭代不足：当前 ${iteration} 轮，${mode} 模式要求至少 ${gates.minIterations} 轮`);
  }

  // 检查已读文档数
  const readDocs = state?.L1?.readDocIds?.length || state?.L2?.retrievedChunkIds?.length || 0;
  if (readDocs < gates.minDocsRead) {
    issues.push(`文档覆盖不足：当前读取 ${readDocs} 个文档，${mode} 模式要求至少 ${gates.minDocsRead} 个`);
  }

  // 检查信息缺口识别
  const gaps = state?.L1?.gaps?.length || 0;
  if (gaps < gates.minGaps) {
    issues.push(`信息缺口识别不足：当前 ${gaps} 个，${mode} 模式要求至少 ${gates.minGaps} 个`);
  }

  return {
    passed: issues.length === 0,
    issues,
    current: { iteration, readDocs, gaps },
    required: gates,
  };
}

/**
 * 确保 report 结构存在
 */
export function ensureReport(state) {
  if (!state.L1) state.L1 = {};
  if (!state.L1.report) {
    state.L1.report = {
      markdown: "",
      draftMarkdown: "",
      sections: [],
      citations: [],
      history: [], // 记录编辑历史
      version: 0,
    };
  }
  return state.L1.report;
}

/**
 * 记录报告变更历史
 */
export function recordHistory(report, action, delta) {
  if (!Array.isArray(report.history)) report.history = [];
  report.history.push({
    action,
    delta: typeof delta === "string" ? delta.slice(0, 200) : JSON.stringify(delta).slice(0, 200),
    ts: Date.now(),
  });
  // 只保留最近 20 条历史
  if (report.history.length > 20) {
    report.history = report.history.slice(-20);
  }
  report.version = (report.version || 0) + 1;
}
