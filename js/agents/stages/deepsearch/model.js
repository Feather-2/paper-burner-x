// Shared helper to resolve modelRouter vs aiApiService
export function getModelCaller(stageApi, { usage = 'worker' } = {}) {
  if (stageApi?.modelRouter?.call) {
    return (messages, opts = {}) => stageApi.modelRouter.call(messages, { usage, ...opts });
  }
  if (stageApi?.aiApiService?.chat) {
    return (messages) => stageApi.aiApiService.chat({ messages });
  }
  return null;
}
