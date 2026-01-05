/**
 * DeepSearch Execution Phase
 *
 * Responsibilities:
 * - Execute tool calls (single or batch)
 * - Persist tool outputs (best-effort)
 * - Save checkpoints / handle backtrack handoff
 */

import { executeTool } from "../tools/index.js";
import { maybePersistToolOutput } from "../../../runtime/persisted-output.js";

function buildLoopGuardNote(guard) {
  if (!guard || typeof guard !== "object") return "";

  if (guard.behavior?.loopDetected) {
    const loopInfo = guard.behavior.loopInfo || null;
    const suggestion = guard.behavior.suggestion || null;
    const pattern = Array.isArray(loopInfo?.pattern) ? loopInfo.pattern.slice(0, 6).join(" -> ") : "";
    const action = typeof suggestion?.action === "string" ? suggestion.action : "break_loop";
    const hint = typeof suggestion?.suggestion === "string" ? suggestion.suggestion : null;
    const reason = typeof suggestion?.reason === "string" ? suggestion.reason : null;

    const details = [
      pattern ? `pattern: ${pattern}` : null,
      hint ? `hint: ${hint}` : null,
      reason ? `reason: ${reason}` : null,
    ]
      .filter(Boolean)
      .join(" | ");

    return `\n\n[LoopGuard] 检测到重复工具调用模式，建议 ${action}${details ? `（${details}）` : ""}。请改变策略/参数，或使用 ask-user 澄清，避免卡死。`;
  }

  if (guard.shouldWarn) {
    return `\n\n[LoopGuard] 你似乎在重复调用同一个工具（${guard.tool}）多次（连续 ${guard.consecutive} 次）。请改变策略/参数，或使用 ask-user 澄清，避免卡死。`;
  }

  return "";
}

function getSideEffectsCursor(stageApi) {
  if (!stageApi?.sideEffects || typeof stageApi.sideEffects.getCursor !== "function") return null;
  try {
    return stageApi.sideEffects.getCursor();
  } catch {
    return null;
  }
}

async function maybeSaveCheckpoint({ agent, stageApi, plannedIteration }) {
  if (!agent.checkpoint) return;
  try {
    const cursor = getSideEffectsCursor(stageApi);
    await agent.checkpoint.save?.(agent.state, {
      iteration: plannedIteration,
      metadata: cursor ? { sideEffectsCursor: cursor } : {},
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    agent._logger?.warn?.(`Checkpoint save failed (ignored): ${errorMessage}`);
  }
}

export async function executeDeepSearchDecision({
  agent,
  stageApi,
  decision,
  plannedIteration,
}) {
  if (!decision) return { toolCalls: 0 };

  const runStore = stageApi?.runStore || null;

  // Batch tools (parallel)
  if (Array.isArray(decision.actions) && decision.actions.length > 0) {
    agent._logger?.info?.(`Executing ${decision.actions.length} tools in parallel`);
    let loopGuardWarn = null;

    const results = await Promise.all(
      decision.actions.map(async (item) => {
        const toolName = item.action;
        const toolArgs = item.args || {};
        const guard = agent._recordToolCall?.(toolName, toolArgs);
        if (guard?.shouldWarn) loopGuardWarn = guard;
        try {
          agent.sourceManager?.syncSources?.(agent.state?.L0?.sources);
          const result = await executeTool(toolName, toolArgs, {
            state: agent.state,
            emit: (n, p) => agent._emit?.(n, p),
            stageApi,
            sharedContext: agent.sharedContext,
            discoveryManager: agent.discoveryManager,
            memory: agent.memory,
            sourceManager: agent.sourceManager,
          });
          const toolSuccess = typeof result?.success === "boolean" ? result.success : true;
          if (toolSuccess) return { tool: toolName, args: toolArgs, success: true, result };

          const errorMessage =
            typeof result?.error === "string" && result.error ? result.error : "Tool returned success:false";
          return { tool: toolName, args: toolArgs, success: false, error: errorMessage, result };
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          return { tool: toolName, args: toolArgs, success: false, error: errorMessage };
        }
      })
    );

    agent._logger?.debug?.(`Batch results: ${results.length} tools completed`);

    await maybeSaveCheckpoint({ agent, stageApi, plannedIteration });

    const formatted = [];
    for (const r of results) {
      if (r?.success) {
        try {
          const stored = await maybePersistToolOutput({
            runStore,
            runId: agent.state?.runId,
            toolName: r.tool,
            args: r.args,
            iteration: plannedIteration,
            result: r.result,
          });
          formatted.push({ ...r, inline: stored.inline, persisted: stored.persisted, ref: stored.ref || null });
        } catch {
          formatted.push({ ...r, inline: r.result, persisted: false, ref: null });
        }
        continue;
      }
      formatted.push({ ...r, inline: r.result ?? { success: false, error: r.error }, persisted: false, ref: null });
    }

    const loopGuardNote = buildLoopGuardNote(loopGuardWarn);

    agent.addMessage({
      role: "user",
      content: `批量执行结果:\n${formatted
        .map((r, i) => `${i + 1}. ${r.tool}: ${JSON.stringify(r.inline)}`)
        .join("\n")}\n\n如需读取完整 persisted output，请用 get-artifact { artifactId }。${loopGuardNote}\n\n请继续。`,
    });

    return { toolCalls: results.length };
  }

  // Single tool
  agent._logger?.info?.(`Executing tool: ${decision.action}`);

  agent.sourceManager?.syncSources?.(agent.state?.L0?.sources);
  const toolResult = await executeTool(decision.action, decision.args || {}, {
    state: agent.state,
    emit: (n, p) => agent._emit?.(n, p),
    stageApi,
    sharedContext: agent.sharedContext,
    discoveryManager: agent.discoveryManager,
    memory: agent.memory,
    sourceManager: agent.sourceManager,
  });

  agent._logger?.debug?.(`Tool result: ${JSON.stringify(toolResult).slice(0, 200)}`);
  const loopGuard = agent._recordToolCall?.(decision.action, decision.args || {});

  // watchdog handoff 触发回溯
  if (toolResult?.mode === "handoff" && agent.backtrackManager?.canBacktrack?.()) {
    try {
      const backtrackResult = await agent.backtrackManager.backtrack(agent.state, null, {
        failReason: toolResult.handoff?.reason || "watchdog_handoff",
        correctionHint: toolResult.handoff?.hint,
        sharedContext: agent.sharedContext,
      });
      if (backtrackResult.success && backtrackResult.state) {
        agent.state = backtrackResult.state;
        agent.addMessage({
          role: "user",
          content: `已回溯到之前的状态。原因: ${toolResult.handoff?.reason || "重新开始"}\n\n请基于新状态继续。`,
        });
        return { toolCalls: 1, backtracked: true };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      agent._logger?.warn?.(`Backtrack failed (ignored): ${errorMessage}`);
    }
  }

  await maybeSaveCheckpoint({ agent, stageApi, plannedIteration });

  let toolPayloadForPrompt = toolResult;
  try {
    const stored = await maybePersistToolOutput({
      runStore,
      runId: agent.state?.runId,
      toolName: decision.action,
      args: decision.args || {},
      iteration: plannedIteration,
      result: toolResult,
    });
    toolPayloadForPrompt = stored.inline;
  } catch {
    // ignore persistence failures (fallback to inline toolResult)
  }

  agent.addMessage({
    role: "user",
    content: `结果: ${JSON.stringify(toolPayloadForPrompt, null, 2)}\n\n如需读取完整 persisted output，请用 get-artifact { artifactId }。${buildLoopGuardNote(loopGuard)}\n\n请继续。`,
  });

  return { toolCalls: 1 };
}
