/**
 * DeepSearch Writing Phase
 *
 * Responsibilities:
 * - Ensure report exists on "complete"
 * - Run the dedicated writing phase when research budget is exhausted
 */

import { executeTool } from "../tools/index.js";
import { WritingPhaseHandler } from "../runtime/writing-phase-handler.js";

export async function ensureReportOnComplete({ agent, stageApi }) {
  if (agent.state?.L1?.report) return;
  await executeTool("write-report", { action: "full" }, {
    state: agent.state,
    emit: (n, p) => agent._emit?.(n, p),
    stageApi,
  });
}

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

