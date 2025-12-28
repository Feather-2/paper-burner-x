/**
 * ask-user skill handler - 向用户提问并等待回复
 */

export const definition = {
  name: "ask-user",
  description: "向用户提问以获取澄清、确认或额外信息。当你不确定或需要用户决策时使用。",
  layer: 0,
  activation: {
    keywords: ["询问", "确认", "ask", "clarify", "confirm"],
    phases: ["researching", "analyzing", "planning"],
  },
};

/**
 * @param {Object} args
 * @param {string} args.question - 要问用户的问题
 * @param {string[]} [args.options] - 可选的选项列表
 * @param {string} [args.context] - 问题的背景说明
 * @param {Object} context - { state, emit, stageApi }
 */
export async function handler(args, context) {
  const { emit, stageApi } = context;
  const { question, options, context: questionContext } = args;

  if (!question || typeof question !== "string") {
    return { success: false, error: "question is required" };
  }

  // 检查是否有用户输入能力
  if (typeof stageApi?.waitForUserInput !== "function") {
    // 无交互能力时，返回提示
    emit?.("deepsearch.user.input.skipped", { question, reason: "no interactive mode" });
    return {
      success: false,
      error: "Interactive mode not available. Running in batch mode.",
      question,
    };
  }

  // 发送事件通知需要用户输入
  emit?.("deepsearch.user.input.required", {
    question,
    options: options || null,
    context: questionContext || null,
  });

  try {
    // 等待用户响应
    const answer = await stageApi.waitForUserInput({ question, options });

    emit?.("deepsearch.user.input.received", { question, answer });

    return {
      success: true,
      question,
      answer,
      hasOptions: !!options?.length,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    emit?.("deepsearch.user.input.failed", { question, error });
    return { success: false, error, question };
  }
}

export default { definition, handler };
