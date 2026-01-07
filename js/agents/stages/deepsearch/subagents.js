/**
 * DeepSearch 子代理注册
 *
 * 注册可被 Task skill 调用的子代理类型
 */

import { globalSubagentRegistry } from "../../sdk/SubagentRegistry.js";
import { EventBus } from "../../runtime/events/event-bus.js";

/** @type {any} */
let _DeepSearchAgentLoop = null;

/**
 * @returns {Promise<any>}
 */
async function getDeepSearchAgentLoop() {
  if (_DeepSearchAgentLoop) return _DeepSearchAgentLoop;
  const mod = await import("./deepsearch-agent-loop.js");
  _DeepSearchAgentLoop = mod.DeepSearchAgentLoop || mod.default;
  return _DeepSearchAgentLoop;
}

/**
 * @param {any} value
 * @returns {string|null}
 */
function toTaskId(value) {
  const v = typeof value === "string" ? value.trim() : String(value || "").trim();
  return v ? v : null;
}

/**
 * @param {any} sharedContext
 * @param {string|null} taskId
 * @returns {any}
 */
function createTaskScopedSharedContext(sharedContext, taskId) {
  const scopedTaskId = toTaskId(taskId);
  if (!sharedContext || !scopedTaskId) return sharedContext;

  return new Proxy(sharedContext, {
    get(target, prop) {
      if (prop === "buildBlackboardPrompt") {
        return (options = {}) => target.buildBlackboardPrompt?.({ ...options, targetTaskId: scopedTaskId });
      }
      if (prop === "getSignals") {
        return (filter) => {
          if (filter && typeof filter === "object" && !Array.isArray(filter)) {
            return target.getSignals?.({ ...filter, targetTaskId: scopedTaskId }) || [];
          }
          if (typeof filter === "string") {
            return target.getSignals?.((s) => (
              (s?.type === filter || s?.stage === filter) &&
              (!s?.payload?.targetTaskId || String(s.payload.targetTaskId) === scopedTaskId)
            )) || [];
          }
          if (typeof filter === "function") {
            return target.getSignals?.((s) => (
              (!s?.payload?.targetTaskId || String(s.payload.targetTaskId) === scopedTaskId) &&
              filter(s)
            )) || [];
          }
          return target.getSignals?.({ targetTaskId: scopedTaskId }) || [];
        };
      }

      const value = target[prop];
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  });
}

function stripTraceContext(stageApi) {
  const api = stageApi && typeof stageApi === "object" ? stageApi : null;
  if (!api) return {};
  const { traceContext, ...rest } = api;
  return rest;
}

function resolveTraceparent(stageApi) {
  const api = stageApi && typeof stageApi === "object" ? stageApi : null;
  if (!api) return null;
  if (api.traceContext && typeof api.traceContext.getTraceparent === "function") {
    try {
      return api.traceContext.getTraceparent();
    } catch {
      return null;
    }
  }
  if (typeof api.traceparent === "string" && api.traceparent.trim()) return api.traceparent.trim();
  return null;
}

/**
 * 创建轻量级研究子代理
 */
function createResearcherFactory() {
  return async ({ prompt, taskId, inheritedContext, modelTier = "fast", parentStageApi }) => {
    const eventBus = new EventBus();
    // P2.1: 默认启用背压
    if (typeof eventBus.enableBackpressure === "function") {
      try { eventBus.enableBackpressure({ deferNonCoalesced: false }); } catch { /* ignore */ }
    }
    const DeepSearchAgentLoop = await getDeepSearchAgentLoop();
    const agent = new DeepSearchAgentLoop({
      maxIterations: 10,
      eventBus,
      sharedContext: createTaskScopedSharedContext(inheritedContext?.sharedContext, taskId || inheritedContext?.taskId),
    });

    return {
      run: async (input, ctx) => {
        const traceparent = resolveTraceparent(parentStageApi);
        // 合并父级 stageApi（继承 modelRouter）
        const mergedStageApi = {
          ...stripTraceContext(parentStageApi),
          ...stripTraceContext(ctx?.stageApi),
          eventBus,
          modelTier,
          signal: ctx?.signal || parentStageApi?.signal,
          ...(traceparent ? { traceparent } : {}),
        };

        const result = await agent.run(
          {
            taskGoal: prompt,
            L0: inheritedContext?.L0 || input.L0,
            userConfig: { maxIterations: 10 },
          },
          { stageApi: mergedStageApi }
        );
        return {
          ok: true,
          summary: result.report?.slice(0, 500) || "Research completed",
          report: result.report,
          findings: result.findings,
        };
      },
    };
  };
}

/**
 * 创建分析子代理（更深入，迭代更多）
 */
function createAnalyzerFactory() {
  return async ({ prompt, taskId, inheritedContext, modelTier = "normal", parentStageApi }) => {
    const eventBus = new EventBus();
    // P2.1: 默认启用背压
    if (typeof eventBus.enableBackpressure === "function") {
      try { eventBus.enableBackpressure({ deferNonCoalesced: false }); } catch { /* ignore */ }
    }
    const DeepSearchAgentLoop = await getDeepSearchAgentLoop();
    const agent = new DeepSearchAgentLoop({
      maxIterations: 15,
      eventBus,
      sharedContext: createTaskScopedSharedContext(inheritedContext?.sharedContext, taskId || inheritedContext?.taskId),
    });

    return {
      run: async (input, ctx) => {
        const traceparent = resolveTraceparent(parentStageApi);
        // 合并父级 stageApi（继承 modelRouter）
        const mergedStageApi = {
          ...stripTraceContext(parentStageApi),
          ...stripTraceContext(ctx?.stageApi),
          eventBus,
          modelTier,
          signal: ctx?.signal || parentStageApi?.signal,
          ...(traceparent ? { traceparent } : {}),
        };

        const result = await agent.run(
          {
            taskGoal: prompt,
            L0: inheritedContext?.L0 || input.L0,
            userConfig: { maxIterations: 15 },
          },
          { stageApi: mergedStageApi }
        );
        return {
          ok: true,
          summary: result.report?.slice(0, 500) || "Analysis completed",
          report: result.report,
          analysis: result.analysis,
        };
      },
    };
  };
}

/**
 * 注册所有 DeepSearch 子代理
 */
export function registerDeepSearchSubagents(registry = globalSubagentRegistry) {
  registry.register(
    "researcher",
    createResearcherFactory(),
    "专项文档研究，快速提取关键信息（10轮迭代）"
  );

  registry.register(
    "analyzer",
    createAnalyzerFactory(),
    "深度分析，适合复杂问题（15轮迭代）"
  );
}

// 自动注册
registerDeepSearchSubagents();

export { globalSubagentRegistry };
