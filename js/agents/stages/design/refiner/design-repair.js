/**
 * DesignRepair - 自动修复闭环 (ReAct 模式)
 *
 * 当 QA 验证失败时，封装 DSL、截图和问题列表为任务，
 * 调用 react-refiner 进行自动修复。
 */

import { toNonEmptyString } from "../../../shared/utils/value-utils.js";

/**
 * 修复配置
 */
const REPAIR_CONFIG = {
  maxRetries: 3,
  maxStepsPerRetry: 5,
  qualityThreshold: 6,
};

/**
 * 构建修复任务
 */
function buildRepairTask(slideHtml, qaResult, slideIntent, context = {}) {
  const issues = qaResult?.issues || [];
  const issueDescriptions = issues.map((issue) => {
    if (typeof issue === "string") return issue;
    return issue?.message || issue?.description || JSON.stringify(issue);
  });

  return {
    slideHtml,
    slideIntentId: slideIntent?.slideIntentId,
    slideIndex: context.slideIndex,
    pageType: slideIntent?.pageType,
    title: slideIntent?.title,
    issues: issueDescriptions,
    qaScore: qaResult?.score,
    qaPass: qaResult?.pass,
  };
}

/**
 * 运行自动修复
 */
export async function runAutomatedRepair(repairTask, options = {}) {
  const {
    toolExecutor,
    aiApiService,
    modelRouter,
    emit,
    signal,
    maxRetries = REPAIR_CONFIG.maxRetries,
    maxStepsPerRetry = REPAIR_CONFIG.maxStepsPerRetry,
  } = options;

  if (!repairTask?.slideHtml) {
    return { success: false, error: "No slideHtml provided", slideHtml: null };
  }

  let currentHtml = repairTask.slideHtml;
  let lastError = null;

  for (let retry = 0; retry < maxRetries; retry++) {
    if (signal?.aborted) {
      return { success: false, error: "Cancelled", slideHtml: currentHtml };
    }

    try {
      // 动态导入 react-refiner
      const { runReactRefiner } = await import("./react-refiner.js");
      const { createToolExecutor } = await import("./react-refiner-tools.js");

      const deckPackage = {
        deckHtmlDsl: currentHtml,
        slidesMeta: [{ slideNo: 1, slideIntentId: repairTask.slideIntentId }],
      };

      const toolContext = {
        deckPackage,
        contentPackage: { slideIntents: [{ slideIntentId: repairTask.slideIntentId }] },
        stageApi: { signal, emit },
      };

      const executor = toolExecutor || createToolExecutor(toolContext);

      const refineResult = await runReactRefiner(
        deckPackage,
        { stageApi: { signal, emit, aiApiService, modelRouter } },
        {
          recommendedSteps: maxStepsPerRetry,
          hardLimit: maxStepsPerRetry * 2,
          toolExecutor: executor,
          mode: "generation",
          initialIssues: repairTask.issues,
        }
      );

      if (refineResult?.qualityScore >= REPAIR_CONFIG.qualityThreshold) {
        const repairedHtml = refineResult.finalDeck?.deckHtmlDsl || currentHtml;
        return {
          success: true,
          slideHtml: repairedHtml,
          qualityScore: refineResult.qualityScore,
          stepsUsed: refineResult.steps?.length || 0,
          retries: retry + 1,
        };
      }

      // 更新当前 HTML 用于下一轮
      currentHtml = refineResult.finalDeck?.deckHtmlDsl || currentHtml;
      lastError = `Quality score ${refineResult.qualityScore} below threshold ${REPAIR_CONFIG.qualityThreshold}`;
    } catch (err) {
      lastError = err?.message || String(err);
      emit?.("design.repair.error", {
        actor: "design",
        status: "error",
        payload: { retry, error: lastError },
      });
    }
  }

  return {
    success: false,
    error: lastError || "Max retries exceeded",
    slideHtml: currentHtml,
    retries: maxRetries,
  };
}

/**
 * 批量修复多个幻灯片
 */
export async function repairSlides(failedSlides, options = {}) {
  const results = [];

  for (const slide of failedSlides) {
    if (options.signal?.aborted) break;

    const repairTask = buildRepairTask(
      slide.slideHtml,
      slide.qaResult,
      slide.slideIntent,
      { slideIndex: slide.slideIndex }
    );

    const result = await runAutomatedRepair(repairTask, options);
    results.push({
      slideIndex: slide.slideIndex,
      slideIntentId: slide.slideIntent?.slideIntentId,
      ...result,
    });

    // 发出进度事件
    options.emit?.("design.repair.progress", {
      actor: "design",
      status: "progress",
      payload: {
        completed: results.length,
        total: failedSlides.length,
        success: result.success,
      },
    });
  }

  const successCount = results.filter((r) => r.success).length;
  return {
    results,
    summary: {
      total: failedSlides.length,
      success: successCount,
      failed: failedSlides.length - successCount,
    },
  };
}

/**
 * 集成到生成阶段的修复入口
 */
export async function integrateRepairIntoGeneration(
  slideHtmls,
  slidesMeta,
  slideIntents,
  options = {}
) {
  const { validateSlide } = await import("./qa-validator.js");

  // 找出需要修复的幻灯片
  const failedSlides = [];
  for (let i = 0; i < slideHtmls.length; i++) {
    const qa = validateSlide(slideHtmls[i]);
    if (!qa.pass) {
      failedSlides.push({
        slideIndex: i,
        slideHtml: slideHtmls[i],
        qaResult: qa,
        slideIntent: slideIntents[i],
      });
    }
  }

  if (failedSlides.length === 0) {
    return { slideHtmls, slidesMeta, repaired: 0 };
  }

  // 运行修复
  const repairResults = await repairSlides(failedSlides, options);

  // 应用修复结果
  const repairedHtmls = [...slideHtmls];
  const repairedMeta = [...slidesMeta];
  let repairedCount = 0;

  for (const result of repairResults.results) {
    if (result.success && result.slideHtml) {
      repairedHtmls[result.slideIndex] = result.slideHtml;
      if (repairedMeta[result.slideIndex]) {
        repairedMeta[result.slideIndex].repaired = true;
        repairedMeta[result.slideIndex].source = "repair";
      }
      repairedCount++;
    }
  }

  return {
    slideHtmls: repairedHtmls,
    slidesMeta: repairedMeta,
    repaired: repairedCount,
    repairSummary: repairResults.summary,
  };
}

export { buildRepairTask, REPAIR_CONFIG };
