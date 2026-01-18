/**
 * Batch Repair Agent - 批量修复编排代理
 *
 * 扮演“研发工程师 + 视觉总监”的双重角色。
 * 核心逻辑：基于统一的 ReAct Refiner 框架，注入批量感知的 Prompt。
 */

import { runReactRefiner } from "./react-refiner.js";
import { createToolExecutor } from "./react-refiner-tools.js";
import { createLogger } from "../../../shared/utils/logger.js";

const logger = createLogger("stages/design/refiner/batch-repair-agent");

/**
 * 运行批量编排修复
 *
 * @param {object} params - { deckPackage, qaIssues, styleIssues, designSystem }
 * @param {object} context - { runContext, stageApi, aiApiService, modelRouter }
 * @returns {Promise<{ finalDeck: object, steps: object[], qualityScore: number, toolCalls: object[], terminationReason: string }>}
 */
export async function runBatchRepair(params, context) {
    const { deckPackage, qaIssues = [], styleIssues = [], designSystem } = params;
    const { stageApi, runContext, aiApiService, modelRouter } = context;

    // 1. 构建工具执行器 (复用 ReactRefiner 的工具集：editElement, editSlide, screenshotAll 等)
    const toolContext = {
        deckPackage,
        contentPackage: runContext?.contentPackage || {},
        stageApi,
    };
    const toolExecutor = createToolExecutor(toolContext);

    // 2. 注入针对“批量编排”和“风格对齐”的特殊指令
    const batchRepairSystemPrompt = `你现在是"高级设计编排专家 (Design Orchestrator)"。
你的目标不仅仅是修复报错，还要确保整个 PPT Deck 的"视觉一致性"。

你面前有一份详尽的健康报告，包含：
- QA 问题：例如文字溢出、字太小、对比度不足（来自 qa-validator）
- 风格一致性问题：例如颜色偏离设计系统、字体乱用、布局散乱（来自 auto-reviewer）

你的修复流程：
1. **全局视图**：首先调用 screenshotAll 获取所有幻灯片概览。
2. **制定计划**：在 thought 中明确指出你打算分几个轮次修复。例如：
   - 第一轮：统一所有页面的主色调和背景。
   - 第二轮：解决 1, 3, 5 页的文本溢出。
   - 第三轮：重绘第 4 页那个风格不兼容的 SVG。
3. **精准操作**：使用 editElement 修改具体元素，或 editSlide 修改整页。
4. **闭环验证**：每一轮修改后，你可以再次查看 screenshot 确认效果。

记住：严谨性（通过 Analyzer 审计）与灵活性（你的 Agent 决策）并重。只有当 Deck 既没有报错又呈现出高度的一致美感时，才调用 finish。`;

    // 3. 运行 ReAct 循环
    // 我们直接调用 runReactRefiner，但传入我们自定义的 System Prompt 逻辑
    // 提示：目前的 runReactRefiner 内部硬编码了 System Prompt，我们需要在 react-refiner.js 中支持注入
    /** @type {{ mode: "generation" | "edit", recommendedSteps: number, hardLimit: number, toolExecutor: Function, systemPromptOverride: string, onStep: Function }} */
    const options = {
        mode: "edit", // 使用 Level 2 工具集
        recommendedSteps: 8,
        hardLimit: 20,
        toolExecutor,
        systemPromptOverride: batchRepairSystemPrompt, // 我们需要在 react-refiner.js 中支持这个参数
        onStep: (step) => {
            stageApi?.emit?.("design:batchRepair.step", {
                actor: "design",
                status: "progress",
                payload: step
            });
        }
    };

    // 在调用前，我们将合并后的 issues 信息放入 deckPackage 或 context 传给 Refiner
    const enrichedContext = {
        ...context,
        initialIssues: { qaIssues, styleIssues }
    };

    return runReactRefiner(deckPackage, enrichedContext, options);
}

/**
 * 单页修复 - 轻量级适配器
 * 
 * @param {object} params - { slideIndex, currentHtml, issues, designSystem }
 * @param {object} context - { aiApiService, modelRouter, signal }
 * @returns {Promise<string>} 修复后的 HTML
 */
export async function runSingleSlideRepair(params, context) {
    const { slideIndex, currentHtml, issues, designSystem } = params;
    const { aiApiService, modelRouter, signal } = context;

    if (!aiApiService || !issues?.length) return currentHtml;

    const systemPrompt = `You are a Slide Fixer. Fix the specific issues in the HTML DSL.
Rules:
1. Fix overflow by adjusting data-x/y/w/h within 0-100 range
2. Fix small fonts by increasing to at least 12px
3. Maintain all data-el attributes
4. Return ONLY the <section>...</section> block, no markdown fences`;

    const userPrompt = `Current HTML:\n${currentHtml}\n\nIssues to fix:\n${JSON.stringify(issues, null, 2)}\n\nDesign System:\n${JSON.stringify(designSystem)}`;

    try {
        const response = await aiApiService.chat({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            model: typeof modelRouter === "function" ? modelRouter("fixer") : undefined,
            signal,
        });

        const rawText = response.content || response.text || "";
        let fixed = rawText.replace(/```html/g, "").replace(/```/g, "").trim();
        if (!fixed.includes("<section")) return currentHtml;
        // Sanitize LLM output to prevent XSS (strip script/on* handlers)
        fixed = fixed
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "")
            .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, "");
        return fixed;
    } catch (err) {
        logger.error("[SingleSlideRepair] Failed:", { error: err?.message });
        return currentHtml;
    }
}
