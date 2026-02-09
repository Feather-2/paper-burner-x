/**
 * write-report skill handler
 *
 * 支持阶段性落盘和增量编辑：
 * - append: 追加内容到报告末尾
 * - update: 更新特定章节
 * - patch: 增量更新（diff 式编辑）
 * - section: 添加单个章节
 * - sections: 批量添加章节
 * - direct: 直接设置报告内容
 * - full: 基于 claims 生成完整报告
 * - fill-section: 填充指定章节（交互式框架模式）
 * - get-outline: 获取当前报告大纲
 * - review: 审查报告，检测并修复重复内容
 *
 * 报告质量要求：
 * - 必须包含核心章节：摘要、发现、信息缺口、结论
 * - 字数要求：从 config.json 读取，默认 quick 2000+, wider 3500+, deeper 6000+
 * - 必须有证据引用和置信度标注
 */

import { generateReport } from "../../report/report-generator.js";
import { toNonEmptyString } from "../../../../shared/index.js";
import { createLogger } from "../../../../shared/index.js";
import { getReportProgress, prepareReportForSubmit, reviewReportMarkdown } from "../../report/report-postprocess.js";
import { handleGetSource, syncReportCitations } from "./report-citations.js";
import { buildReportOutline, countContentChars, renderSectionsMarkdown } from "./report-formatting.js";
import { renderReportTemplate } from "./report-template.js";
import { checkAnalysisGates, ensureReport, recordHistory } from "./handler-helpers.js";

const logger = createLogger("stages/deepsearch/tools/write-report/handler");

export const definition = {
  name: "write-report",
  description: `生成研究报告。支持渐进式写入和最终提交两阶段：
- 写入阶段：create/append/section 等，每次返回进度提醒但不阻止写入
- 提交阶段：submit action，严格验证字数和结构，不达标则拒绝
字数要求：quick≥2000字, wider≥3500字, deeper≥6000字。`,
  layer: 0,
  priority: "important",
  activation: {
    keywords: ["报告", "总结", "report", "summary", "写作"],
    phases: ["writing", "completing"],
  },
  parameters: {
    action: "操作类型：create|append|section|update|patch|submit | get-content|get-findings|get-source|get-outline|review",
    content: "报告内容",
    sourceId: "源文档 ID（get-source 用）",
    title: "章节标题",
    sectionId: "要更新的章节 ID",
    mode: "分析模式：quick|wider|deeper（影响字数和结构要求）",
  },
  // 报告结构模板
  reportTemplate: renderReportTemplate(),
};

// ============================================================
// Action Handlers - 拆分为独立函数，保持单一职责
// ============================================================

/**
 * get-content: 获取当前报告完整内容
 */
function handleGetContent(report, mode, state) {
  const progress = getReportProgress(report, mode, state);
  return {
    success: true,
    action: "get-content",
    markdown: report.markdown || "",
    wordCount: progress.wordCount,
    progress,
    version: report.version,
    hint: progress.hint,
  };
}

/**
 * get-findings: 从 SharedContext 检索发现
 */
function handleGetFindings(args, context) {
  const sharedContext = context?.sharedContext;
  if (!sharedContext) {
    return { success: false, error: "SharedContext not available" };
  }

  const filterType = args.type;
  const keyword = args.keyword;
  const minConfidence = args.minConfidence;
  const limit = args.limit || 50;

  const types = filterType ? [filterType] : ["claim", "gap", "conflict"];
  const findings = { claims: [], gaps: [], conflicts: [] };

  for (const t of types) {
    const ids = keyword
      ? sharedContext.searchAll([`finding_${t}`, keyword])
      : sharedContext.search(`finding_${t}`);

    for (const id of ids.slice(0, limit)) {
      const detail = sharedContext.getDetail(id);
      if (!detail) continue;
      if (minConfidence && t === "claim" && (detail.confidence || 0) < minConfidence) continue;

      const entry = {
        id: detail.id,
        content: detail.content,
        source: detail.source,
        ...(t === "claim" && { confidence: detail.confidence }),
        ...(t === "gap" && { priority: detail.priority }),
        ...(t === "conflict" && { sources: detail.sources }),
      };

      if (t === "claim") findings.claims.push(entry);
      else if (t === "gap") findings.gaps.push(entry);
      else findings.conflicts.push(entry);
    }
  }

  const blackboardPrompt = sharedContext.buildBlackboardPrompt?.({ maxSignals: 5, maxDecisions: 3 }) || "";

  return {
    success: true,
    action: "get-findings",
    findings,
    stats: {
      claimCount: findings.claims.length,
      gapCount: findings.gaps.length,
      conflictCount: findings.conflicts.length,
      total: findings.claims.length + findings.gaps.length + findings.conflicts.length,
    },
    blackboard: blackboardPrompt,
    hint: findings.claims.length === 0
      ? "尚未记录任何发现，请先使用 record-finding 记录"
      : `已收集 ${findings.claims.length} 条论点、${findings.gaps.length} 个缺口、${findings.conflicts.length} 个矛盾`,
  };
}

/**
 * submit: 最终提交
 */
function handleSubmit(report, mode, state, emit) {
  const markdown = report.markdown || "";
  if (!markdown) {
    return { success: false, error: "报告为空，无法提交" };
  }

  const processed = prepareReportForSubmit(markdown, mode, state);
  if (processed.markdown !== markdown) {
    report.markdown = processed.markdown;
    report.draftMarkdown = processed.markdown;
    recordHistory(report, "submit.postprocess", {
      originalLength: markdown.length,
      fixedLength: processed.markdown.length,
    });
  }

  const validation = processed.validation;
  if (!validation.valid) {
    const progress = getReportProgress(report, mode, state);
    return {
      success: false,
      error: "报告质量不达标，无法提交",
      validation,
      review: processed.review,
      progress,
      hint: `请修改后重新提交。问题：${validation.issues.join("; ")}`,
    };
  }

  report.submitted = true;
  report.submittedAt = Date.now();
  report.validation = validation;

  emit?.("deepsearch.report.submitted", {
    runId: state.runId,
    wordCount: validation.wordCount,
    version: report.version,
  });

  return {
    success: true,
    action: "submit",
    message: "报告提交成功",
    validation,
    review: processed.review,
    version: report.version,
  };
}

/**
 * get-outline: 获取报告大纲
 */
function handleGetOutline(report, state) {
  const { outline, totalSections, filledSections, emptySections } = buildReportOutline(report.sections, state);

  return {
    success: true,
    action: "get-outline",
    outline,
    totalSections,
    filledSections,
    emptySections,
  };
}

/**
 * review: 审查报告
 */
function handleReview(report) {
  const markdown = report.markdown || "";
  if (!markdown) {
    return { success: false, error: "报告为空，无需审查" };
  }

  const reviewed = reviewReportMarkdown(markdown);
  if (reviewed.fixed) {
    report.markdown = reviewed.markdown;
    report.draftMarkdown = reviewed.markdown;
    recordHistory(report, "review", { issues: reviewed.issues, fixedLength: reviewed.fixedLength });
  }

  return {
    success: true,
    action: "review",
    issues: reviewed.issues,
    fixed: reviewed.fixed,
    originalLength: reviewed.originalLength,
    fixedLength: reviewed.fixedLength,
    version: report.version,
  };
}

/**
 * fill-section: 填充指定章节
 */
function handleFillSection(args, report, state, emit) {
  const sectionId = toNonEmptyString(args.sectionId);
  const title = toNonEmptyString(args.title);
  const content = toNonEmptyString(args.content) || "";
  const rawMinWords = Number(args.minWords);
  const minWords = Number.isFinite(rawMinWords) && rawMinWords > 0
    ? Math.min(Math.floor(rawMinWords), 10000)
    : (state?.reportConfig?.sectionWordLimits?.[title] || 100);

  if (!sectionId && !title) {
    return { success: false, error: "fill-section requires sectionId or title" };
  }

  const sectionIndex = report.sections.findIndex(s =>
    s.sectionId === sectionId || s.title === title
  );

  if (sectionIndex < 0) {
    return {
      success: false,
      error: `Section not found: ${sectionId || title}`,
      hint: "请先使用 sections action 创建报告框架",
      availableSections: report.sections.map(s => s.title),
    };
  }

  const wordCount = countContentChars(content);
  if (wordCount < minWords) {
    return {
      success: false,
      error: `章节字数不足：当前 ${wordCount} 字，要求至少 ${minWords} 字`,
      sectionTitle: report.sections[sectionIndex].title,
      hint: "请补充更多内容后重新提交",
    };
  }

  report.sections[sectionIndex].content = content;
  report.sections[sectionIndex].updatedAt = Date.now();
  report.sections[sectionIndex].wordCount = wordCount;

  report.markdown = renderSectionsMarkdown(report.sections, { emptyPlaceholder: "[待填充]" });
  report.draftMarkdown = report.markdown;
  recordHistory(report, "fill-section", title);

  const filledCount = report.sections.filter(s => s.content).length;
  const progress = Math.round((filledCount / report.sections.length) * 100);

  emit?.("deepsearch.section.filled", {
    sectionId: report.sections[sectionIndex].sectionId,
    title: report.sections[sectionIndex].title,
    wordCount,
    progress,
    version: report.version,
  });

  return {
    success: true,
    action: "fill-section",
    sectionTitle: report.sections[sectionIndex].title,
    wordCount,
    progress: `${filledCount}/${report.sections.length} (${progress}%)`,
    nextEmpty: report.sections.find(s => !s.content)?.title || null,
    version: report.version,
  };
}

/**
 * append: 追加内容
 */
function handleAppend(args, report, mode, state, emit) {
  const content = toNonEmptyString(args.content) || "";
  if (!content) {
    return { success: false, error: "append action requires content" };
  }

  if (report.markdown && report.markdown.includes(content.trim())) {
    const progress = getReportProgress(report, mode, state);
    return {
      success: false,
      error: "内容已存在，跳过重复追加",
      progress,
      hint: "如需更新内容，请使用 update 或 patch action",
    };
  }

  const separator = report.markdown ? "\n\n" : "";
  report.markdown += separator + content;
  report.draftMarkdown = report.markdown;
  recordHistory(report, "append", content);

  const progress = getReportProgress(report, mode, state);

  emit?.("deepsearch.draft.updated", {
    wordCount: progress.wordCount,
    version: report.version,
  });

  return {
    success: true,
    action: "append",
    added: content.length,
    wordCount: progress.wordCount,
    progress,
    version: report.version,
    hint: progress.hint,
    nextStep: progress.isReady ? "可以调用 submit 提交报告" : "继续完善报告内容",
  };
}

/**
 * update: 更新章节
 */
function handleUpdate(args, report, emit) {
  const sectionId = toNonEmptyString(args.sectionId);
  const title = toNonEmptyString(args.title);
  const content = toNonEmptyString(args.content) || "";

  if (!sectionId && !title) {
    return { success: false, error: "update action requires sectionId or title" };
  }

  const sectionIndex = report.sections.findIndex(s =>
    s.sectionId === sectionId || s.title === title
  );

  if (sectionIndex >= 0) {
    const oldContent = toNonEmptyString(report.sections[sectionIndex].content) || "";
    report.sections[sectionIndex].content = content;
    report.sections[sectionIndex].updatedAt = Date.now();
    recordHistory(report, "update", { sectionId, old: oldContent.slice(0, 50), new: content.slice(0, 50) });
  } else {
    const section = {
      sectionId: sectionId || `sec_${Date.now()}`,
      title: title || "未命名章节",
      content,
      createdAt: Date.now(),
    };
    report.sections.push(section);
    recordHistory(report, "add_section", section.title);
  }

  report.markdown = renderSectionsMarkdown(report.sections);
  report.draftMarkdown = report.markdown;

  emit?.("deepsearch.section.updated", { sectionId, title, version: report.version });
  return { success: true, action: "update", sectionCount: report.sections.length, version: report.version };
}

/**
 * patch: 差异更新
 */
function handlePatch(args, report, emit) {
  const search = toNonEmptyString(args.search) || toNonEmptyString(args.oldText);
  const replace = toNonEmptyString(args.replace) || toNonEmptyString(args.newText) || "";

  if (!search) {
    return { success: false, error: "patch action requires search/oldText" };
  }

  if (!report.markdown.includes(search)) {
    return { success: false, error: "search text not found in report" };
  }

  report.markdown = report.markdown.replace(search, replace);
  report.draftMarkdown = report.markdown;
  recordHistory(report, "patch", { search: search.slice(0, 30), replace: replace.slice(0, 30) });

  emit?.("deepsearch.draft.patched", { version: report.version });
  return { success: true, action: "patch", version: report.version };
}

/**
 * direct/create: 直接设置报告
 */
function handleDirect(args, action, report, mode, state, emit) {
  const reportContent = toNonEmptyString(args.content) || toNonEmptyString(args.report) || "";
  if (!reportContent) {
    return { success: false, error: "direct/create action requires content or report" };
  }

  report.markdown = reportContent;
  report.draftMarkdown = reportContent;
  report.sections = [];
  recordHistory(report, action, reportContent);

  const progress = getReportProgress(report, mode, state);

  emit?.("deepsearch.report.written", {
    runId: state.runId,
    wordCount: progress.wordCount,
    version: report.version,
  });

  return {
    success: true,
    action,
    wordCount: progress.wordCount,
    progress,
    version: report.version,
    hint: progress.hint,
    nextStep: progress.isReady ? "可以调用 submit 提交报告" : "继续完善报告内容",
  };
}

/**
 * sections: 批量添加章节
 */
function handleSections(args, report, state, emit) {
  const sections = Array.isArray(args.sections) ? args.sections : [];

  for (const sec of sections) {
    const title = toNonEmptyString(sec.title) || "";
    const content = toNonEmptyString(sec.content) || "";

    const existingIndex = report.sections.findIndex(s => s.title === title);
    if (existingIndex >= 0) {
      report.sections[existingIndex].content = content;
      report.sections[existingIndex].updatedAt = Date.now();
    } else {
      report.sections.push({
        sectionId: `sec_${Date.now()}_${report.sections.length}`,
        title: title || `Section ${report.sections.length + 1}`,
        content,
        createdAt: Date.now(),
      });
    }
  }

  report.markdown = renderSectionsMarkdown(report.sections);
  report.draftMarkdown = report.markdown;
  recordHistory(report, "sections", `${sections.length} sections`);

  emit?.("deepsearch.report.generated", { runId: state.runId, hasReport: true, sectionCount: report.sections.length });
  return { success: true, action: "sections", report };
}

/**
 * section: 添加单个章节
 */
function handleSection(args, report, emit) {
  const title = toNonEmptyString(args.title) || "章节";
  const content = toNonEmptyString(args.content) || "";

  const section = {
    sectionId: `sec_${Date.now()}`,
    title,
    content,
    createdAt: Date.now(),
  };

  report.sections.push(section);
  report.markdown = renderSectionsMarkdown(report.sections);
  report.draftMarkdown = report.markdown;
  recordHistory(report, "section", title);

  emit?.("deepsearch.section.written", { sectionId: section.sectionId, title, version: report.version });
  return { success: true, action: "section", section, version: report.version };
}

/**
 * full: 基于 claims 生成完整报告
 */
function handleFull(report, mode, state, emit) {
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
  const todos = Array.isArray(state?.todos) ? state.todos : [];
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const taskGoal = toNonEmptyString(state?.taskGoal) || "";

  try {
    const generated = generateReport(claims, evidenceLedger, todos, sources, taskGoal);

    const processed = prepareReportForSubmit(generated?.markdown || "", mode, state);
    report.markdown = processed.markdown;
    report.sections = generated?.sections || [];
    syncReportCitations(report, generated?.citations);
    report.draftMarkdown = report.markdown;
    recordHistory(report, "full", `${claims.length} claims`);

    const validation = processed.validation;
    report.validation = validation;

    emit?.("deepsearch.report.generated", {
      runId: state.runId,
      hasReport: true,
      claimCount: claims.length,
      version: report.version,
      validation,
    });

    return {
      success: true,
      action: "full",
      report,
      validation,
      hint: validation.valid
        ? "报告质量验证通过"
        : `报告质量不达标，请修改后重新提交。问题：${validation.issues.join("; ")}`,
    };
  } catch (err) {
    logger.error("[write-report] generateReport failed:", { error: err.message, stack: err.stack });
    return { success: false, error: err.message, errorCode: "REPORT_GENERATION_FAILED" };
  }
}

/**
 * @typedef {object} ReportSection
 * @property {string} title - 章节标题
 * @property {string} [content] - 章节内容
 * @property {string} [sectionId] - 章节 ID
 */

/**
 * @typedef {object} WriteReportResult
 * @property {boolean} success - 操作是否成功
 * @property {string} [action] - 执行的操作类型
 * @property {string} [error] - 错误信息
 * @property {string} [errorCode] - 错误码
 * @property {number} [wordCount] - 当前字数
 * @property {number} [version] - 报告版本号
 * @property {string} [hint] - 提示信息
 * @property {ReturnType<typeof checkAnalysisGates>} [gateCheck] - 分析门槛检查结果（submit 时强制）
 * @property {string[]} [warnings] - 前置条件警告列表（非 submit 仅警告不阻止）
 * @property {{ total: number, done: number, rate: string }} [todoStats] - 待办完成统计（submit 时强制）
 * @property {{ count: number, required: number }} [findingStats] - 发现记录统计（submit 时强制）
 */

/**
 * write-report 工具处理器
 * @param {object} args - 工具参数
 * @param {string} [args.action] - 操作类型：append|update|patch|section|sections|direct|full|fill-section|get-outline|get-content|get-findings|get-source|review|submit
 * @param {string} [args.content] - 内容
 * @param {string} [args.title] - 章节标题
 * @param {string} [args.sectionId] - 要更新的章节 ID
 * @param {string} [args.report] - 直接传入的报告内容
 * @param {Array<ReportSection>} [args.sections] - 批量章节
 * @param {number} [args.minWords] - 章节最少字数（fill-section 用）
 * @param {string} [args.instructions] - 填充指令（fill-section 用）
 * @param {string} [args.mode] - 分析模式：quick|wider|deeper
 * @param {string} [args.type] - get-findings 过滤：claim|gap|conflict
 * @param {string} [args.keyword] - get-findings 关键词过滤
 * @param {number} [args.minConfidence] - get-findings 置信度过滤（claim）
 * @param {number} [args.limit] - get-findings 返回条数限制
 * @param {string} [args.sourceId] - get-source 用：源文档 ID
 * @param {number} [args.maxLength] - get-source 用：最大返回长度（chars, 上限 10000）
 * @param {number} [args.start] - get-source 用：起始偏移（chars, 非负）
 * @param {string} [args.search] - patch 用：搜索文本
 * @param {string} [args.oldText] - patch 用：旧文本（兼容字段）
 * @param {string} [args.replace] - patch 用：替换文本
 * @param {string} [args.newText] - patch 用：新文本（兼容字段）
 * @param {object} context - 执行上下文
 * @param {object} context.state - DeepSearch 状态
 * @param {Function} [context.emit] - 事件发射器
 * @param {object} [context.stageApi] - 阶段 API
 * @param {object} [context.sharedContext] - 共享黑板
 * @param {object} [context.sourceManager] - 源文档管理器
 * @returns {Promise<WriteReportResult>} 操作结果
 */
export async function handler(args, context) {
  const { state, emit, stageApi } = context;
  const action = args.action || (args.report ? "direct" : args.sections ? "sections" : args.content ? "append" : "full");
  const mode = args.mode || state?.userConfig?.mode || "wider";

  // ===== 分析门槛检查（仅 submit 时强制，其他写入操作仅警告）=====
  const writeActions = ["full", "direct", "create", "append", "section", "sections", "update", "patch", "fill-section", "submit"];
  if (writeActions.includes(action)) {
    const gateCheck = checkAnalysisGates(state, mode);
    if (!gateCheck.passed) {
      // submit 时强制检查
      if (action === "submit") {
        return {
          success: false,
          error: "分析门槛未满足，无法提交",
          gateCheck,
          hint: `${mode} 模式要求：至少 ${gateCheck.required.minIterations} 轮迭代、读取 ${gateCheck.required.minDocsRead} 个文档、识别 ${gateCheck.required.minGaps} 个信息缺口。`,
        };
      }
      // 其他写入操作仅警告，不阻止
      logger.warn(`[write-report] 分析门槛未满足（警告）:`, { issues: gateCheck.issues });
    }

    // ===== 待办完成率检查 =====
    const todos = state?.todos || [];
    const totalTodos = todos.length;
    const doneTodos = todos.filter(t => t.status === "done" || t.status === "completed").length;
    const todoCompletionRate = totalTodos > 0 ? doneTodos / totalTodos : 1;

    // ===== 发现记录数量检查 =====
    const sharedContext = context?.sharedContext;
    let findingCount = 0;
    if (sharedContext) {
      const claims = sharedContext.search?.("finding_claim") || [];
      const gaps = sharedContext.search?.("finding_gap") || [];
      const conflicts = sharedContext.search?.("finding_conflict") || [];
      findingCount = claims.length + gaps.length + conflicts.length;
    }
    const minFindings = { quick: 3, wider: 5, deeper: 10 }[mode] || 5;

    // 写入操作时返回警告信息
    const warnings = [];
    if (todoCompletionRate < 0.8 && totalTodos > 0) {
      warnings.push(`待办完成率不足：${doneTodos}/${totalTodos} (${Math.round(todoCompletionRate * 100)}%)，建议先完成待办`);
    }
    if (findingCount < minFindings) {
      warnings.push(`发现记录不足：当前 ${findingCount} 条，${mode} 模式建议至少 ${minFindings} 条`);
    }

    // submit 时强制检查待办和发现
    if (action === "submit" && warnings.length > 0) {
      return {
        success: false,
        error: "前置条件未满足，无法提交",
        warnings,
        todoStats: { total: totalTodos, done: doneTodos, rate: `${Math.round(todoCompletionRate * 100)}%` },
        findingStats: { count: findingCount, required: minFindings },
        hint: "请先完成待办任务并记录足够的发现，然后再提交报告。",
      };
    }

    // 其他写入操作时在返回值中包含警告
    if (warnings.length > 0) {
      logger.warn(`[write-report] 前置条件警告:`, { warnings });
    }
  }

  const report = ensureReport(state);

  if (action === "get-content" || action === "read") {
    return handleGetContent(report, mode, state);
  }

  if (action === "get-findings" || action === "get-context") {
    return handleGetFindings(args, context);
  }

  if (action === "get-source") {
    return handleGetSource(args, context, state);
  }

  if (action === "submit" || action === "finalize") {
    return handleSubmit(report, mode, state, emit);
  }

  if (action === "get-outline") {
    return handleGetOutline(report, state);
  }

  if (action === "review") {
    return handleReview(report);
  }

  if (action === "fill-section") {
    return handleFillSection(args, report, state, emit);
  }

  if (action === "append") {
    return handleAppend(args, report, mode, state, emit);
  }

  if (action === "update") {
    return handleUpdate(args, report, emit);
  }

  if (action === "patch") {
    return handlePatch(args, report, emit);
  }

  if (action === "direct" || action === "create" || args.report) {
    return handleDirect(args, action, report, mode, state, emit);
  }

  if (action === "sections" || Array.isArray(args.sections)) {
    return handleSections(args, report, state, emit);
  }

  if (action === "section") {
    return handleSection(args, report, emit);
  }

  if (action === "full") {
    return handleFull(report, mode, state, emit);
  }

  return { success: false, error: `Unknown action: ${action || "unknown"}` };

}

export default { definition, handler };
