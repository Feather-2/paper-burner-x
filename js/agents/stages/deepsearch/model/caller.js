/**
 * DeepSearch model-caller adapter.
 *
 * Provides a single "call(messages, opts)" function backed by either `stageApi.modelRouter.call`
 * (preferred) or the legacy `stageApi.aiApiService.chat`.
 */
import { extractServices } from "../utils/stage-api.js";
import { injectSystemHint } from "../../../shared/index.js";

/**
 * @typedef {object} BuildBaseCallerOptions
 * @property {string} [usage]
 */

/**
 * @typedef {object} StageApiLike
 * @property {AbortSignal} [signal]
 * @property {{ call: Function }} [modelRouter]
 * @property {{ chat: Function }} [aiApiService]
 * @property {{ system?: string }} [runtimeHints]
 */

/**
 * @typedef {object} CallOptions
 * @property {AbortSignal} [signal] - Abort signal for cancellation
 * @property {string} [model] - Model identifier override
 * @property {number} [temperature] - Temperature for sampling
 * @property {number} [maxTokens] - Maximum tokens to generate
 * @property {Record<string, unknown>} [rest] - Additional options
 */

/**
 * Build a base model caller from stage API.
 * @param {StageApiLike} stageApi - Stage API container with model services
 * @param {BuildBaseCallerOptions} [options] - Optional caller configuration
 * @returns {Function|null} Model caller function or null if no backend is available
 */
export function buildBaseCaller(stageApi, { usage = "worker" } = {}) {
  const { signal: defaultSignal, modelRouter, aiApiService } = extractServices(stageApi);
  const systemHint = stageApi?.runtimeHints?.system;
  const routerCall = modelRouter?.call;
  if (typeof routerCall === "function") {
    const legacySignature = routerCall.length >= 2;
    return (messages, opts = {}) => {
      const forwardOpts = /** @type {CallOptions} */ (opts && typeof opts === "object" ? opts : {});
      const { signal: providedSignal, ...rest } = forwardOpts;
      const signal = providedSignal ?? defaultSignal;
      const hintedMessages = injectSystemHint(messages, systemHint);
      return legacySignature
        ? modelRouter.call(hintedMessages, { usage, signal, ...rest })
        : modelRouter.call({ usage, messages: hintedMessages, signal, ...rest });
    };
  }

  const chat = aiApiService?.chat;
  if (typeof chat === "function") {
    return (messages, opts = {}) => {
      const forwardOpts = /** @type {CallOptions} */ (opts && typeof opts === "object" ? opts : {});
      const { signal: providedSignal, ...rest } = forwardOpts;
      const signal = providedSignal ?? defaultSignal;
      const hintedMessages = injectSystemHint(messages, systemHint);
      return aiApiService.chat({ messages: hintedMessages, usage, signal, ...rest });
    };
  }

  return null;
}
