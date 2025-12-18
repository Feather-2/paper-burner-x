/**
 * DeepSearch model-caller adapter.
 *
 * Provides a single "call(messages, opts)" function backed by either `stageApi.modelRouter.call`
 * (preferred) or the legacy `stageApi.aiApiService.chat`.
 */
import { extractServices } from "../stage-api.js";

export function buildBaseCaller(stageApi, { usage = "worker" } = {}) {
  const { signal: defaultSignal, modelRouter, aiApiService } = extractServices(stageApi);
  const routerCall = modelRouter?.call;
  if (typeof routerCall === "function") {
    const legacySignature = routerCall.length >= 2;
    return (messages, opts = {}) => {
      const forwardOpts = opts && typeof opts === "object" ? opts : {};
      const { signal: providedSignal, ...rest } = forwardOpts;
      const signal = providedSignal ?? defaultSignal;
      return legacySignature
        ? modelRouter.call(messages, { usage, signal, ...rest })
        : modelRouter.call({ usage, messages, signal, ...rest });
    };
  }

  const chat = aiApiService?.chat;
  if (typeof chat === "function") {
    return (messages, opts = {}) => {
      const forwardOpts = opts && typeof opts === "object" ? opts : {};
      const { signal: providedSignal, ...rest } = forwardOpts;
      const signal = providedSignal ?? defaultSignal;
      return aiApiService.chat({ messages, usage, signal, ...rest });
    };
  }

  return null;
}
