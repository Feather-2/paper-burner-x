/**
 * write-report skill handler
 */

import { generateReport } from "../../report-generator.js";
import { isPlainObject, toNonEmptyString } from "../../../../shared/value-utils.js";

export const definition = {
  name: "write-report",
  description: "生成研究报告或章节。基于收集的信息撰写结构化内容。",
  layer: 0,
  activation: {
    keywords: ["报告", "总结", "report", "summary", "写作"],
    phases: ["writing", "completing"],
  },
};

/**
 * @param {Object} args
 * @param {string} [args.action] - full | section
 * @param {string} [args.title] - 章节标题
 * @param {string} [args.content] - 章节内容
 * @param {Object} context - { state, emit, stageApi }
 */
export async function handler(args, context) {
  const { state, emit, stageApi } = context;
  const action = args.action || "full";

  if (action === "section") {
    // 写单个章节
    const title = toNonEmptyString(args.title) || "章节";
    const content = toNonEmptyString(args.content) || "";

    if (!state.L1) state.L1 = {};
    if (!Array.isArray(state.L1.sections)) state.L1.sections = [];

    const section = {
      sectionId: `sec_${Date.now()}`,
      title,
      content,
      createdAt: Date.now(),
    };

    state.L1.sections.push(section);
    emit?.("deepsearch.section.written", { sectionId: section.sectionId, title });

    return { success: true, section };
  }

  // 生成完整报告
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
  const todos = Array.isArray(state?.todos) ? state.todos : [];
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const taskGoal = toNonEmptyString(state?.taskGoal) || "";

  try {
    const report = generateReport(claims, evidenceLedger, todos, sources, taskGoal);

    if (!state.L1) state.L1 = {};
    state.L1.report = report;

    emit?.("deepsearch.report.generated", {
      runId: state.runId,
      hasReport: true,
      claimCount: claims.length,
    });

    return { success: true, report };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export default { definition, handler };
