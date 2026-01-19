/**
 * DeepSearch Writing Phase
 *
 * Responsibilities:
 * - Ensure report exists on "complete"
 * - Run the dedicated writing phase when research budget is exhausted
 */

import { executeTool } from "../tools/index.js";
import { WritingPhaseHandler } from "../internal/writing-phase-handler.js";

/**
 * @typedef {"system"|"user"|"assistant"} DeepSearchChatRole
 *
 * @typedef {object} DeepSearchChatMessage
 * @property {DeepSearchChatRole | string} role
 * @property {any} content
 *
 * @typedef {object} DeepSearchModelCallOptions
 * @property {number=} temperature
 * @property {number=} maxTokens
 * @property {AbortSignal=} signal
 *
 * @typedef {object} DeepSearchModelResponse
 * @property {string=} content
 * @property {any=} usage
 *
 * @typedef {(messages: DeepSearchChatMessage[], options: DeepSearchModelCallOptions) => Promise<DeepSearchModelResponse>} DeepSearchCallModel
 *
 * @typedef {object} EnsureReportOnCompleteParams
 * @property {any} agent
 * @property {any} stageApi
 *
 * @typedef {object} RunWritingPhaseIfNeededParams
 * @property {any} agent
 * @property {any} stageApi
 * @property {DeepSearchCallModel} callModel
 * @property {number} iteration
 * @property {number} toolCallCount
 * @property {AbortSignal=} signal
 */

/**
 * 如果在 complete 时报告缺失，补写一份完整报告。
 * @param {EnsureReportOnCompleteParams} params
 * @returns {Promise<void>}
 */
export async function ensureReportOnComplete({ agent, stageApi }) {
  if (agent.state?.L1?.report) return;
  await executeTool("write-report", { action: "full" }, {
    state: agent.state,
    emit: (n, p) => agent._emit?.(n, p),
    stageApi,
  });
}

/**
 * 当研究预算耗尽且报告未达标时，进入写作阶段循环（最多若干轮）。
 * @param {RunWritingPhaseIfNeededParams} params
 * @returns {Promise<void>}
 */
export async function runWritingPhaseIfNeeded({
  agent,
  stageApi,
  callModel,
  iteration,
  toolCallCount,
  signal,
}) {
  const executeToolWithSources = (name, args, ctx) => {
    agent.sourceManager?.syncSources?.(agent.state?.L0?.sources);
    return executeTool(name, args, { ...ctx, sourceManager: agent.sourceManager });
  };

  const writingHandler = new WritingPhaseHandler({
    logger: agent._logger,
    emit: (n, p) => agent._emit?.(n, p),
    parseDecision: (content) => agent._parseDecision(content),
    executeTool: executeToolWithSources,
    maxIterations: agent.writeIterations || 5,
    maxParseFailures: 3,
  });

  const shouldEnterWritingPhase = writingHandler.shouldEnter({
    state: agent.state,
    mode: agent.mode,
    globalConfig: agent.globalConfig,
    iteration,
    maxIterations: agent.maxIterations,
    toolCallCount,
    maxToolCalls: agent.maxToolCalls,
  });

  if (!shouldEnterWritingPhase) return;

  await writingHandler.run({
    state: agent.state,
    stageApi,
    sharedContext: agent.sharedContext,
    callModel,
    addMessage: (msg) => agent.addMessage(msg),
    messages: () => agent.messages,
    signal,
    flushMessages: () => agent.flushCompression?.(),
  });
}
