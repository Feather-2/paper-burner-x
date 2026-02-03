/**
 * DeepSearch Execution Phase
 *
 * Responsibilities:
 * - Execute tool calls (single or batch)
 * - Persist tool outputs (best-effort)
 * - Save checkpoints / handle backtrack handoff
 */

import { executeTool } from "../tools/index.js";
import { maybePersistToolOutput } from "../../../runtime/index.js";

/** 工具调用默认超时 (ms) */
const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

/**
 * 带超时的 Promise 包装
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} toolName - 用于错误消息
 * @returns {Promise<T>}
 */
function withTimeout(promise, timeoutMs, toolName) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (result) => { clearTimeout(timer); resolve(result); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

function safeStringify(value, { space = 0 } = {}) {
  const seen = new WeakSet();
  try {
    const json = JSON.stringify(
      value,
      (key, val) => {
        if (typeof val === "bigint") return val.toString();
        if (typeof val === "object" && val !== null) {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      },
      space
    );
    if (typeof json === "string") return json;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify(`[Unserializable: ${msg}]`);
  }

  if (value === undefined) return "undefined";
  if (typeof value === "function") return "[Function]";
  return JSON.stringify(String(value));
}

/**
 * @typedef {object} DeepSearchToolAction
 * @property {string} action
 * @property {Record<string, unknown>=} args
 *
 * @typedef {object} DeepSearchDecision
 * @property {string=} thought
 * @property {string=} action
 * @property {Record<string, unknown>=} args
 * @property {DeepSearchToolAction[]=} actions
 *
 * @typedef {object} DeepSearchStageApi
 * @property {unknown=} runStore
 * @property {number=} toolTimeoutMs
 * @property {{ getCursor?: () => unknown }=} sideEffects
 *
 * @typedef {object} ExecuteDeepSearchDecisionParams
 * @property {any} agent
 * @property {DeepSearchStageApi} stageApi
 * @property {DeepSearchDecision | null | undefined} decision
 * @property {number} plannedIteration
 *
 * @typedef {object} ExecuteDeepSearchDecisionResult
 * @property {number} toolCalls
 * @property {boolean=} backtracked
 */

/**
 * 校验工具调用项的 action/args 结构合法性
 * @param {{ action?: unknown, args?: unknown }} item
 * @param {object=} logger
 * @returns {{ valid: boolean, toolName: string, toolArgs: Record<string, unknown> }}
 */
function validateToolAction(item, logger) {
  const action = item?.action;
  const args = item?.args;
  if (typeof action !== "string" || !action) {
    logger?.warn?.(`Invalid tool action (not a string): ${JSON.stringify(action)}`);
    return { valid: false, toolName: "ask-user", toolArgs: { reason: "invalid_tool_action" } };
  }
  if (args !== undefined && args !== null && (typeof args !== "object" || Array.isArray(args))) {
    logger?.warn?.(`Invalid tool args (not a plain object): ${JSON.stringify(args)?.slice(0, 100)}`);
    return { valid: false, toolName: "ask-user", toolArgs: { reason: "invalid_tool_args" } };
  }
  return { valid: true, toolName: action, toolArgs: /** @type {Record<string, unknown>} */ (args || {}) };
}

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

function getSideEffectsCursor(stageApi, logger) {
  if (!stageApi?.sideEffects || typeof stageApi.sideEffects.getCursor !== "function") return null;
  try {
    return stageApi.sideEffects.getCursor();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger?.warn?.(`getSideEffectsCursor failed (ignored): ${msg}`);
    return null;
  }
}

async function maybeSaveCheckpoint({ agent, stageApi, plannedIteration }) {
  if (!agent.checkpoint) return;
  try {
    const cursor = getSideEffectsCursor(stageApi, agent._logger);
    await agent.checkpoint.save?.(agent.state, {
      iteration: plannedIteration,
      metadata: cursor ? { sideEffectsCursor: cursor } : {},
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    agent._logger?.warn?.(`Checkpoint save failed (ignored): ${errorMessage}`);
  }
}

/**
 * 执行本轮 DeepSearch 的工具调用（支持单个/批量），并将结果回填到对话消息中。
 * @param {ExecuteDeepSearchDecisionParams} params
 * @returns {Promise<ExecuteDeepSearchDecisionResult>}
 */
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
        const validated = validateToolAction(item, agent._logger);
        const toolName = validated.toolName;
        const toolArgs = validated.toolArgs;
        const guard = agent._recordToolCall?.(toolName, toolArgs);
        if (guard?.shouldWarn) loopGuardWarn = guard;
        try {
          agent.sourceManager?.syncSources?.(agent.state?.L0?.sources);
          const timeoutMs = stageApi?.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
          const result = await withTimeout(
            executeTool(toolName, toolArgs, {
              state: agent.state,
              emit: (n, p) => agent._emit?.(n, p),
              stageApi,
              sharedContext: agent.sharedContext,
              discoveryManager: agent.discoveryManager,
              memory: agent.memory,
              sourceManager: agent.sourceManager,
            }),
            timeoutMs,
            toolName
          );
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
          const stored = await maybePersistToolOutput(/** @type {any} */ ({
            runStore,
            runId: agent.state?.runId,
            toolName: r.tool,
            args: r.args,
            iteration: plannedIteration,
            result: r.result,
          }));
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
        .map((r, i) => `${i + 1}. ${r.tool}: ${safeStringify(r.inline)}`)
        .join("\n")}\n\n如需读取完整 persisted output，请用 get-artifact { artifactId }。${loopGuardNote}\n\n请继续。`,
    });

    return { toolCalls: results.length };
  }

  // Single tool
  const singleValidated = validateToolAction(decision, agent._logger);
  const singleToolName = singleValidated.toolName;
  const singleToolArgs = singleValidated.toolArgs;
  agent._logger?.info?.(`Executing tool: ${singleToolName}`);

  agent.sourceManager?.syncSources?.(agent.state?.L0?.sources);
  const singleTimeoutMs = stageApi?.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const toolResult = await withTimeout(
    executeTool(singleToolName, singleToolArgs, {
      state: agent.state,
      emit: (n, p) => agent._emit?.(n, p),
      stageApi,
      sharedContext: agent.sharedContext,
      discoveryManager: agent.discoveryManager,
      memory: agent.memory,
      sourceManager: agent.sourceManager,
    }),
    singleTimeoutMs,
    singleToolName
  );

  // 仅记录元数据，避免敏感字段泄露到日志
  const resultMeta = {
    success: typeof toolResult?.success === "boolean" ? toolResult.success : true,
    hasMode: !!toolResult?.mode,
    byteSize: safeStringify(toolResult).length,
  };
  agent._logger?.debug?.(`Tool result meta: ${JSON.stringify(resultMeta)}`);
  const loopGuard = agent._recordToolCall?.(singleToolName, singleToolArgs);

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
    const stored = await maybePersistToolOutput(/** @type {any} */ ({
      runStore,
      runId: agent.state?.runId,
      toolName: singleToolName,
      args: singleToolArgs,
      iteration: plannedIteration,
      result: toolResult,
    }));
    toolPayloadForPrompt = stored.inline;
  } catch {
    // ignore persistence failures (fallback to inline toolResult)
  }

  agent.addMessage({
    role: "user",
    content: `结果: ${safeStringify(toolPayloadForPrompt, { space: 2 })}\n\n如需读取完整 persisted output，请用 get-artifact { artifactId }。${buildLoopGuardNote(loopGuard)}\n\n请继续。`,
  });

  return { toolCalls: 1 };
}
