/**
 * DeepSearch model-caller adapter.
 *
 * Provides a single "call(messages, opts)" function backed by either `stageApi.modelRouter.call`
 * (preferred) or the legacy `stageApi.aiApiService.chat`.
 */
export function buildBaseCaller(stageApi, { usage = "worker" } = {}) {
  const routerCall = stageApi?.modelRouter?.call;
  if (typeof routerCall === "function") {
    const legacySignature = routerCall.length >= 2;
    return legacySignature
      ? (messages, opts = {}) => stageApi.modelRouter.call(messages, { usage, ...opts })
      : (messages, opts = {}) => stageApi.modelRouter.call({ usage, messages, ...opts });
  }

  const chat = stageApi?.aiApiService?.chat;
  if (typeof chat === "function") return (messages, opts = {}) => stageApi.aiApiService.chat({ messages, usage, ...opts });

  return null;
}
