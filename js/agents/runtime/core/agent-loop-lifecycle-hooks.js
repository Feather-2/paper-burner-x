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

  const preAgentHook = createPreAgentHook();
  const preResult = await preAgentHook({
    sessionId,
    runId,
    input,
    context: { eventBus: loop?.eventBus ?? null, stageApi, signal: context?.signal },
  });

  if (preResult?.skip) {
    const emit = loop?.emit || loop?.eventBus?.emit;
    if (typeof emit === "function") {
      emit(`${loop.stageName}.agent.skipped`, {
        actor: loop.actor,
        status: "skipped",
        payload: { runId, reason: preResult.reason, duration: Date.now() - startedAt },
      });
    }
    return preResult.value ?? { ok: false, error: preResult.reason };
  }

  try {
    const result = await loop.run(input, context);
    const postAgentHook = createPostAgentHook();
    await postAgentHook({
      sessionId,
      runId,
      input,
      result,
      error: null,
      duration: Date.now() - startedAt,
      context: { eventBus: loop?.eventBus ?? null, stageApi },
    });
    return result;
  } catch (err) {
    const postAgentHook = createPostAgentHook();
    await postAgentHook({
      sessionId,
      runId,
      input,
      result: null,
      error: err,
      duration: Date.now() - startedAt,
      context: { eventBus: loop?.eventBus ?? null, stageApi },
    });
    throw err;
  }
}
