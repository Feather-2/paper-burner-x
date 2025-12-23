/**
 * DeepSearch model-caller adapter.
 *
 * Provides a single "call(messages, opts)" function backed by either `stageApi.modelRouter.call`
 * (preferred) or the legacy `stageApi.aiApiService.chat`.
 */
import { extractServices } from "../stage-api.js";
import { injectSystemHint } from "../../../shared/message-utils.js";

export function buildBaseCaller(stageApi, { usage = "worker" } = {}) {
  const { signal: defaultSignal, modelRouter, aiApiService } = extractServices(stageApi);
  const systemHint = stageApi?.runtimeHints?.system;
  const routerCall = modelRouter?.call;
  if (typeof routerCall === "function") {
    const legacySignature = routerCall.length >= 2;
    return (messages, opts = {}) => {
      const forwardOpts = opts && typeof opts === "object" ? opts : {};
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
      const forwardOpts = opts && typeof opts === "object" ? opts : {};
      const { signal: providedSignal, ...rest } = forwardOpts;
      const signal = providedSignal ?? defaultSignal;
      const hintedMessages = injectSystemHint(messages, systemHint);
      return aiApiService.chat({ messages: hintedMessages, usage, signal, ...rest });
    };
  }

  return null;
}
