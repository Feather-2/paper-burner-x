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
import { isPlainObject, toNonEmptyString } from "../../../../shared/utils/value-utils.js";
import { createLogger } from "../../../../shared/utils/logger.js";
import { getReportProgress, prepareReportForSubmit, reviewReportMarkdown } from "../../report/report-postprocess.js";
import SourceManager from "../../source-manager.js";

const logger = createLogger("stages/deepsearch/tools/write-report/handler");

// 分析门槛配置（写报告前必须满足）- 从 config 读取或使用默认值
const DEFAULT_ANALYSIS_GATES = {
  quick: { minIterations: 3, minDocsRead: 1, minGaps: 0 },
  wider: { minIterations: 8, minDocsRead: 3, minGaps: 2 },
  deeper: { minIterations: 15, minDocsRead: 5, minGaps: 3 },
};

/**
 * 获取分析门槛配置
 */
function getAnalysisGates(state, mode) {
  const globalConfig = state?.globalConfig?.analysisGates?.[mode];
  const defaults = DEFAULT_ANALYSIS_GATES[mode] || DEFAULT_ANALYSIS_GATES.wider;
  return { ...defaults, ...globalConfig };
}

/**
 * 检查分析门槛是否满足
 */
function checkAnalysisGates(state, mode) {
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
  reportTemplate: `
## 报告结构要求

### 必需章节
1. **摘要** (100-200字)
   - 研究目标
   - 核心发现（1-3句）
   - 主要结论

2. **核心发现** (按重要性排序)
   - 每个发现必须有证据引用 [来源:页码]
   - 标注置信度：高(多源印证)/中(单源)/低(推测)
   - 区分事实和观点

3. **共识与分歧** (wider/deeper 必需)
   - 不同来源的一致观点
   - 存在分歧的观点及原因分析
   - 矛盾点的处理说明

4. **信息缺口** (必需)
   - 文档未覆盖的关键问题
   - 需要进一步调查的领域
   - 数据不足的地方

5. **结论与建议**
   - 基于发现的结论
   - 可操作的下一步建议
   - 研究局限性说明

### 学术规范
- 每个结论必须有证据支撑
- 推测性内容必须标注
- 使用 [来源:页码] 格式引用
- 置信度标注：🟢高 🟡中 🔴低
`,
};


/**
 * 确保 report 结构存在
 */
function ensureReport(state) {
  if (!state.L1) state.L1 = {};
  if (!state.L1.report) {
    state.L1.report = {
      markdown: "",
      draftMarkdown: "",
      sections: [],
      citations: [],
      history: [],  // 记录编辑历史
      version: 0,
    };
  }
  return state.L1.report;
}

/**
 * 记录报告变更历史
 */
function recordHistory(report, action, delta) {
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

/**
 * @param {object} args
 * @param {string} [args.action] - append | update | patch | section | sections | direct | full | fill-section | get-outline
 * @param {string} [args.content] - 内容
 * @param {string} [args.title] - 章节标题
 * @param {string} [args.sectionId] - 要更新的章节 ID
 * @param {string} [args.report] - 直接传入的报告内容
 * @param {Array} [args.sections] - 批量章节
 * @param {number} [args.minWords] - 章节最少字数（fill-section 用）
 * @param {string} [args.instructions] - 填充指令（fill-section 用）
 * @param {string} [args.mode] - 分析模式：quick|wider|deeper
 * @param {string} [args.type] - get-findings 过滤：claim|gap|conflict
 * @param {string} [args.keyword] - get-findings 关键词过滤
 * @param {number} [args.minConfidence] - get-findings 置信度过滤（claim）
 * @param {number} [args.limit] - get-findings 返回条数限制
 * @param {string} [args.sourceId] - get-source 用：源文档 ID
 * @param {number} [args.maxLength] - get-source 用：最大返回长度（chars）
 * @param {number} [args.start] - get-source 用：起始偏移（chars）
 * @param {string} [args.search] - patch 用：搜索文本
 * @param {string} [args.oldText] - patch 用：旧文本（兼容字段）
 * @param {string} [args.replace] - patch 用：替换文本
 * @param {string} [args.newText] - patch 用：新文本（兼容字段）
 * @param {object} context - { state, emit, stageApi }
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

  // ===== get-content: 获取当前报告完整内容（用于回顾）=====
  if (action === "get-content" || action === "read") {
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

  // ===== get-findings: 从 SharedContext 检索发现 =====
  if (action === "get-findings" || action === "get-context") {
    const sharedContext = context?.sharedContext;
    if (!sharedContext) {
      return { success: false, error: "SharedContext not available" };
    }

    // 支持过滤参数
    const filterType = args.type;  // claim | gap | conflict
    const keyword = args.keyword;
    const minConfidence = args.minConfidence;
    const limit = args.limit || 50;

    // 从黑板检索
    const types = filterType ? [filterType] : ["claim", "gap", "conflict"];
    const findings = { claims: [], gaps: [], conflicts: [] };

    for (const t of types) {
      const ids = keyword
        ? sharedContext.searchAll([`finding_${t}`, keyword])
        : sharedContext.search(`finding_${t}`);

      for (const id of ids.slice(0, limit)) {
        const detail = sharedContext.getDetail(id);
        if (!detail) continue;

        // 置信度过滤
        if (minConfidence && t === "claim" && (detail.confidence || 0) < minConfidence) {
          continue;
        }

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

    // 黑板摘要（L1 层）
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

  // ===== get-source: 获取原文内容（用于引用验证）=====
  if (action === "get-source") {
    const manager = context?.sourceManager instanceof SourceManager ? context.sourceManager : new SourceManager(state?.L0?.sources || []);
    manager.syncSources(state?.L0?.sources);

    const sourceId = toNonEmptyString(args.sourceId);
    if (!sourceId) {
      // 返回所有可用源文档列表
      const sources = manager.listSources();
      return {
        success: true,
        action: "get-source",
        available: sources.map((s) => ({ sourceId: s.sourceId, name: s.name, length: s.size })),
        hint: "请指定 sourceId 查看原文",
      };
    }

    const info = manager.getSourceInfo(sourceId);
    if (!info) {
      return { success: false, error: `Source not found: ${sourceId}` };
    }

    // 返回原文（可选截取）
    const maxLength = args.maxLength || 5000;
    const start = args.start || 0;
    const text = info.text.slice(start, start + maxLength);

    return {
      success: true,
      action: "get-source",
      sourceId: info.sourceId,
      name: info.name,
      content: text,
      totalLength: info.text.length,
      truncated: info.text.length > start + maxLength,
    };
  }

  // ===== submit: 最终提交，严格验证 =====
  if (action === "submit" || action === "finalize") {
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

    // 严格验证
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

    // 标记为已提交
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

  // ===== get-outline: 获取当前报告大纲 =====
  if (action === "get-outline") {
    const outline = report.sections.map((s, i) => ({
      index: i,
      sectionId: s.sectionId,
      title: s.title,
      wordCount: (s.content || "").replace(/\s+/g, "").length,
      status: s.content ? "filled" : "empty",
      minWords: state?.reportConfig?.sectionWordLimits?.[s.title] || null,
    }));

    return {
      success: true,
      action: "get-outline",
      outline,
      totalSections: outline.length,
      filledSections: outline.filter(s => s.status === "filled").length,
      emptySections: outline.filter(s => s.status === "empty").length,
    };
  }

  // ===== review: 审查报告，检测并修复重复内容 =====
  if (action === "review") {
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

  // ===== fill-section: 填充指定章节（交互式框架模式）=====
  if (action === "fill-section") {
    const sectionId = toNonEmptyString(args.sectionId);
    const title = toNonEmptyString(args.title);
    const content = toNonEmptyString(args.content) || "";
    const minWords = args.minWords || state?.reportConfig?.sectionWordLimits?.[title] || 100;

    if (!sectionId && !title) {
      return { success: false, error: "fill-section requires sectionId or title" };
    }

    // 查找章节
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

    // 验证章节字数
    const wordCount = content.replace(/\s+/g, "").length;
    if (wordCount < minWords) {
      return {
        success: false,
        error: `章节字数不足：当前 ${wordCount} 字，要求至少 ${minWords} 字`,
        sectionTitle: report.sections[sectionIndex].title,
        hint: "请补充更多内容后重新提交",
      };
    }

    // 更新章节
    report.sections[sectionIndex].content = content;
    report.sections[sectionIndex].updatedAt = Date.now();
    report.sections[sectionIndex].wordCount = wordCount;

    // 重新生成 markdown
    report.markdown = report.sections.map(s => `## ${s.title}\n\n${s.content || "[待填充]"}`).join("\n\n");
    report.draftMarkdown = report.markdown;
    recordHistory(report, "fill-section", title);

    // 计算进度
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

  // ===== append: 追加内容到报告末尾 =====
  if (action === "append") {
    const content = toNonEmptyString(args.content) || "";
    if (!content) {
      return { success: false, error: "append action requires content" };
    }

    // 防止重复追加：检查内容是否已存在
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

    // 计算进度
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

  // ===== update: 更新特定章节 =====
  if (action === "update") {
    const sectionId = toNonEmptyString(args.sectionId);
    const title = toNonEmptyString(args.title);
    const content = toNonEmptyString(args.content) || "";

    if (!sectionId && !title) {
      return { success: false, error: "update action requires sectionId or title" };
    }

    // 查找章节
    const sectionIndex = report.sections.findIndex(s =>
      s.sectionId === sectionId || s.title === title
    );

    if (sectionIndex >= 0) {
      // 更新已有章节
      const oldContent = report.sections[sectionIndex].content;
      report.sections[sectionIndex].content = content;
      report.sections[sectionIndex].updatedAt = Date.now();
      recordHistory(report, "update", { sectionId, old: oldContent.slice(0, 50), new: content.slice(0, 50) });
    } else {
      // 创建新章节
      const section = {
        sectionId: sectionId || `sec_${Date.now()}`,
        title: title || "未命名章节",
        content,
        createdAt: Date.now(),
      };
      report.sections.push(section);
      recordHistory(report, "add_section", section.title);
    }

    // 重新生成 markdown
    report.markdown = report.sections.map(s => `## ${s.title}\n\n${s.content}`).join("\n\n");
    report.draftMarkdown = report.markdown;

    emit?.("deepsearch.section.updated", { sectionId, title, version: report.version });
    return { success: true, action: "update", sectionCount: report.sections.length, version: report.version };
  }

  // ===== patch: 差异更新（替换指定内容） =====
  if (action === "patch") {
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

  // ===== direct/create: 直接设置报告内容 =====
  if (action === "direct" || action === "create" || args.report) {
    const reportContent = toNonEmptyString(args.content) || toNonEmptyString(args.report) || "";
    if (!reportContent) {
      return { success: false, error: "direct/create action requires content or report" };
    }

    report.markdown = reportContent;
    report.draftMarkdown = reportContent;
    report.sections = [];
    recordHistory(report, action, reportContent);

    // 计算进度（不阻止写入，只提供反馈）
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

  // ===== sections: 批量添加章节 =====
  if (action === "sections" || Array.isArray(args.sections)) {
    const sections = Array.isArray(args.sections) ? args.sections : [];

    for (const sec of sections) {
      const title = toNonEmptyString(sec.title) || "";
      const content = toNonEmptyString(sec.content) || "";

      // 查找是否已存在同名章节
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

    // 重新生成 markdown
    report.markdown = report.sections.map(s => `## ${s.title}\n\n${s.content}`).join("\n\n");
    report.draftMarkdown = report.markdown;
    recordHistory(report, "sections", `${sections.length} sections`);

    emit?.("deepsearch.report.generated", { runId: state.runId, hasReport: true, sectionCount: report.sections.length });
    return { success: true, action: "sections", report };
  }

  // ===== section: 添加单个章节 =====
  if (action === "section") {
    const title = toNonEmptyString(args.title) || "章节";
    const content = toNonEmptyString(args.content) || "";

    const section = {
      sectionId: `sec_${Date.now()}`,
      title,
      content,
      createdAt: Date.now(),
    };

    report.sections.push(section);
    report.markdown = report.sections.map(s => `## ${s.title}\n\n${s.content}`).join("\n\n");
    report.draftMarkdown = report.markdown;
    recordHistory(report, "section", title);

    emit?.("deepsearch.section.written", { sectionId: section.sectionId, title, version: report.version });
    return { success: true, action: "section", section, version: report.version };
  }

  // ===== full: 基于 claims 生成完整报告 =====
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
  const todos = Array.isArray(state?.todos) ? state.todos : [];
  const sources = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];
  const taskGoal = toNonEmptyString(state?.taskGoal) || "";
  // mode 已在函数开头定义

  try {
    const generated = generateReport(claims, evidenceLedger, todos, sources, taskGoal);

    // full action 应该替换整个报告，而不是追加
    // 如果需要保留历史，使用 append action
    const processed = prepareReportForSubmit(generated?.markdown || "", mode, state);
    report.markdown = processed.markdown;
    report.sections = generated?.sections || [];
    report.citations = generated?.citations || [];
    report.draftMarkdown = report.markdown;
    recordHistory(report, "full", `${claims.length} claims`);

    // 验证报告质量（传入 state 以支持用户自定义配置）
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
    return { success: false, error: err.message };
  }
}

export default { definition, handler };
