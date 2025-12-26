/**
 * watchdog skill handler
 *
 * AI 在不确定或卡住时主动调用
 * 两种模式：
 * - think: 深度思考，压缩后继续
 * - handoff: 生成交接文档，换脑子重来
 */

import { Watchdog, DelegationMode, DelegationReason } from "../../../../runtime/watchdog.js";

export const definition = {
  name: "watchdog",
  description: "当你不确定、怀疑自己错了、或陷入死胡同时调用。可选择深度思考(think)或换脑子重来(handoff)。",
  layer: 0,
  activation: {
    keywords: ["不确定", "怀疑", "卡住", "重新考虑", "换个思路", "uncertain", "stuck", "rethink"],
    phases: ["researching", "analyzing", "writing"],
  },
};

/**
 * @param {Object} args
 * @param {string} args.mode - "think" | "handoff"
 * @param {string} [args.reason] - 为什么需要 watchdog
 * @param {string} [args.question] - 需要深度思考的问题（think 模式）
 * @param {Object} context - { state, emit, sharedContext, stageApi }
 */
export async function handler(args, context) {
  const { state, emit, sharedContext, stageApi } = context;
  const { mode = "think", reason, question } = args;

  const watchdog = new Watchdog({
    eventBus: stageApi?.eventBus,
    archive: stageApi?.archive,
  });

  emit?.("watchdog.invoked", { mode, reason });

  if (mode === "handoff") {
    // Handoff 模式：生成交接文档，准备换脑子
    const result = await watchdog.handoff(state, sharedContext, {
      reason: reason || DelegationReason.STUCK_OR_WRONG,
    });

    return {
      success: true,
      mode: DelegationMode.HANDOFF,
      handoff: result.handoff,
      archiveId: result.archiveId,
      message: "已生成交接文档，可以清空上下文重新开始",
    };
  }

  // Think 模式：深度思考
  // 记录决策点
  sharedContext?.recordDecision?.({
    action: "watchdog_think",
    reason,
    question,
    iteration: state?.iteration,
  });

  // 构建思考提示
  const thinkPrompt = buildThinkPrompt(state, sharedContext, { reason, question });

  return {
    success: true,
    mode: DelegationMode.WATCHDOG,
    thinkPrompt,
    message: "请基于以下提示进行深度思考",
  };
}

function buildThinkPrompt(state, sharedContext, { reason, question }) {
  const lines = ["## 深度思考"];

  if (reason) {
    lines.push(`\n触发原因: ${reason}`);
  }

  if (question) {
    lines.push(`\n核心问题: ${question}`);
  }

  // 添加上下文摘要
  const summaryText = sharedContext?.buildSummaryText?.();
  if (summaryText) {
    lines.push(`\n### 已知信息\n${summaryText}`);
  }

  // 添加最近决策
  const decisions = sharedContext?.getDecisions?.()?.slice(-3) || [];
  if (decisions.length) {
    lines.push("\n### 最近决策");
    for (const d of decisions) {
      lines.push(`- ${d.action}: ${d.reason || ""}`);
    }
  }

  // 添加待办
  const todos = state?.todos?.filter(t => t.status !== "done") || [];
  if (todos.length) {
    lines.push("\n### 待完成");
    for (const t of todos.slice(0, 5)) {
      lines.push(`- ${t.content || t.title}`);
    }
  }

  lines.push("\n### 请思考");
  lines.push("1. 当前方向是否正确？");
  lines.push("2. 是否遗漏了重要信息？");
  lines.push("3. 下一步最佳行动是什么？");

  return lines.join("\n");
}

export default { definition, handler };
