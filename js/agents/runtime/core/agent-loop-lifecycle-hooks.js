// NOTE: Direct hook invocation is preserved for backward compatibility.
// Preferred approach: use createHookMiddleware(hookRegistry) from hook-registry.js
// to integrate hooks into the MiddlewareChain pipeline instead.
import { createPreAgentHook, createPostAgentHook } from "../hooks/hook-runner.js";

/**
 * @typedef {Record<string, any>} AnyRecord
 * @typedef {{ signal?: AbortSignal, eventBus?: any, emit?: any, checkCancelled?: (() => void) | null }} StageApiLike
 */

/**
 * @typedef {object} RunWithAgentHooksOptions
 * @property {any} loop
 * @property {string} runId
 * @property {string | null} sessionId
 * @property {any} input
 * @property {AnyRecord} context
 * @property {StageApiLike} stageApi
 * @property {number} [startTime]
 */

/**
 * @param {RunWithAgentHooksOptions} options
 * @returns {Promise<any>}
 */
export async function runWithAgentLifecycleHooks({ loop, runId, sessionId, input, context, stageApi, startTime }) {
  const startedAt = typeof startTime === "number" ? startTime : Date.now();
  const strictHookErrors = loop?.strictHookErrors === true || loop?.hookFailureMode === "throw";
  const emit = loop?.emit || loop?.eventBus?.emit;
  const reportHookError = (phase, error) => {
    if (typeof emit !== "function") return;
    const message = error instanceof Error ? error.message : String(error);
    emit(`${loop.stageName}.hook.error`, {
      actor: loop.actor,
      status: "warning",
      payload: { runId, phase, error: message, timestamp: Date.now() },
    });
  };

  const preAgentHook = createPreAgentHook();
  let preResult = null;
  try {
    preResult = await preAgentHook({
      sessionId,
      runId,
      input,
      context: { eventBus: loop?.eventBus ?? null, stageApi, signal: context?.signal },
    });
  } catch (hookErr) {
    reportHookError("pre", hookErr);
    if (strictHookErrors) throw hookErr;
  }

  if (preResult?.skip) {
    if (typeof emit === "function") {
      emit(`${loop.stageName}.agent.skipped`, {
        actor: loop.actor,
        status: "skipped",
        payload: { runId, reason: preResult.reason, duration: Date.now() - startedAt },
      });
    }
    return preResult.value ?? { ok: false, error: preResult.reason };
  }

  let result = null;
  let runError = null;
  try {
    result = await loop.run(input, context);
  } catch (err) {
    runError = err;
  }

  const postAgentHook = createPostAgentHook();
  try {
    await postAgentHook({
      sessionId,
      runId,
      input,
      result: runError ? null : result,
      error: runError,
      duration: Date.now() - startedAt,
      context: { eventBus: loop?.eventBus ?? null, stageApi },
    });
  } catch (hookErr) {
    reportHookError("post", hookErr);
    if (strictHookErrors && !runError) throw hookErr;
  }

  if (runError) throw runError;
  return result;
}
