/**
 * Task 工具 - 模型主动启动子代理的工具实现
 *
 * 支持三种上下文模式：
 * - isolated: 纯净启动，只传 sharedContext 引用
 * - shared: 共享 sharedContext（不再传 messages）
 * - handoff: 传入压缩后的交接文档
 *
 * 结果回传：通过 SharedContext.commit() 分层存储，只返回轻量引用
 */

import { ServiceId } from "../di/index.js";

/**
 * @typedef {import("../../sdk/SubagentRegistry.js").SubagentRegistry} SubagentRegistry
 * @typedef {import("../../sdk/agent-factory.js").AgentInstance} AgentInstance
 */

export const ContextMode = Object.freeze({
    ISOLATED: "isolated",
    SHARED: "shared",
    HANDOFF: "handoff",
});

/**
 * 从结果中提取摘要（~100 tokens）
 */
function extractSummary(result, type) {
    if (!result) return `${type}: no result`;
    if (typeof result.summary === "string") return result.summary;
    if (typeof result.message === "string") return result.message;
    if (result.ok === false && result.error) return `${type} failed: ${result.error}`;
    // 截断 JSON 作为兜底
    const json = JSON.stringify(result);
    return json.length > 200 ? json.slice(0, 197) + "..." : json;
}

/**
 * 从结果中提取关键词（用于语义索引）
 */
function extractKeywords(result) {
    if (!result) return [];
    if (Array.isArray(result.keywords)) return result.keywords.slice(0, 10);
    if (Array.isArray(result.tags)) return result.tags.slice(0, 10);
    // 从 keys 中提取
    const keys = Object.keys(result).filter(k => !["ok", "error", "summary"].includes(k));
    return keys.slice(0, 5);
}

/**
 * @param {any} container
 * @returns {container is { get: (id: string) => any, tryGet?: (id: string) => any }}
 */
function isContainerLike(container) {
    return !!container && typeof container === "object" && typeof container.get === "function";
}

/**
 * Resolve SubagentRegistry from explicit options or a DI container.
 *
 * @param {SubagentRegistry | null | undefined} registry
 * @param {any} container
 * @param {any} context
 * @returns {Promise<SubagentRegistry>}
 */
async function resolveRegistry(registry, container, context) {
    if (registry) return registry;

    /** @type {any[]} */
    const candidates = [
        container,
        context?.container,
        context?.services?.container,
    ].filter(isContainerLike);

    for (const c of candidates) {
        try {
            const value = typeof c.tryGet === "function" ? c.tryGet(ServiceId.SUBAGENT_REGISTRY) : c.get(ServiceId.SUBAGENT_REGISTRY);
            const resolved = await value;
            if (resolved) return resolved;
        } catch {
            // try next candidate
        }
    }

    throw new Error(
        `TaskTool: missing SubagentRegistry. Pass { registry } to createTaskTool(...) or provide a DI container with ServiceId.SUBAGENT_REGISTRY.`
    );
}

/**
 * 创建 Task 工具 Handler
 * @param {Object} options
 * @param {SubagentRegistry} [options.registry] - 注册表（优先使用显式注入）
 * @param {any} [options.container] - DI 容器（registry 未传时用来解析 ServiceId.SUBAGENT_REGISTRY）
 * @param {AgentInstance} [options.parentAgent] - 父代理实例
 * @param {Function} [options.buildHandoff] - 构建交接文档的函数
 * @returns {Function}
 */
export function createTaskTool({ registry, container, parentAgent, buildHandoff } = {}) {
    /**
     * Task 工具实现
     * @param {Object} args
     * @param {string} args.subagent_type - 子代理类型
     * @param {string} args.prompt - 任务描述
     * @param {string} [args.context_mode="isolated"] - 上下文模式
     * @param {string} [args.model_tier="fast"] - 模型等级
     */
    return async function taskHandler(args, context) {
        const { subagent_type, prompt, context_mode = ContextMode.ISOLATED, model_tier = "fast" } = args;
        const { emit, logger, signal, state } = context;

        logger.info(`Launching subagent: ${subagent_type}`, { prompt, model_tier, context_mode });

        const resolvedRegistry = await resolveRegistry(registry, container, context);

        const factory = resolvedRegistry.getFactory(subagent_type);
        if (!factory) {
            return {
                ok: false,
                error: `Unknown subagent type: ${subagent_type}. Available: ${resolvedRegistry.getAvailableTypes().map(t => t.type).join(", ")}`,
            };
        }

        try {
            // 根据 context_mode 准备上下文
            let inheritedContext = null;

            // 获取 sharedContext 引用
            const sharedContext = parentAgent?.memory?.sharedContext || state?.sharedContext;

            if (context_mode === ContextMode.SHARED) {
                // 共享 sharedContext（不传 messages，避免上下文膨胀）
                inheritedContext = { sharedContext };
            } else if (context_mode === ContextMode.HANDOFF) {
                // 构建交接文档
                if (typeof buildHandoff === "function") {
                    inheritedContext = {
                        handoff: await buildHandoff(state, sharedContext),
                        sharedContext,
                    };
                } else {
                    // 简单的交接文档
                    inheritedContext = {
                        handoff: {
                            taskGoal: state?.taskGoal,
                            iteration: state?.iteration,
                            pendingTodos: state?.todos?.filter(t => t.status !== "completed") || [],
                            summary: state?.L1?.condensedMemory?.summary || "",
                        },
                        sharedContext,
                    };
                }
            } else {
                // isolated: 只传 sharedContext 引用
                inheritedContext = { sharedContext };
            }

            // 创建子代理实例
            const subagent = await factory({
                prompt,
                modelTier: model_tier, // fast/normal/advanced
                usage: `subagent_${model_tier}`, // 用于 modelRouter 路由
                parent: parentAgent,
                inheritedContext,
            });

            if (!subagent || typeof subagent.run !== "function") {
                throw new Error(`Factory for "${subagent_type}" did not return a valid AgentInstance`);
            }

            emit("subagent:started", { type: subagent_type, prompt, context_mode });

            const result = await subagent.run({ task: prompt }, { signal });

            // 通过 SharedContext 分层存储结果
            const resultId = `task_${subagent_type}_${Date.now()}`;
            if (sharedContext && typeof sharedContext.commit === "function") {
                sharedContext.commit(resultId, {
                    full: result,
                    summary: extractSummary(result, subagent_type),
                    keywords: extractKeywords(result),
                });
                sharedContext.signal("subagent.completed", {
                    type: subagent_type,
                    resultId,
                    ok: result?.ok !== false,
                });
            }

            emit("subagent:completed", { type: subagent_type, resultId });

            // 只返回轻量引用，父 agent 按需通过 sharedContext 获取详情
            return {
                ok: result?.ok !== false,
                resultId,
                summary: extractSummary(result, subagent_type),
                // 提示父 agent 如何获取详情
                hint: sharedContext ? `Use sharedContext.getDetail("${resultId}") for full result` : null,
            };
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            logger.error(`Subagent "${subagent_type}" failed: ${error}`);
            emit("subagent:failed", { type: subagent_type, error });
            return { ok: false, error };
        }
    };
}

/**
 * Task 工具定义 (JSON Schema)
 */
export const TASK_TOOL_DEFINITION = {
    name: "Task",
    description: "Launch a specialized agent to handle a complex task. Supports different context modes and model tiers.",
    parameters: {
        type: "object",
        properties: {
            subagent_type: {
                type: "string",
                description: "The type of specialized agent (e.g. Explore, Coder, Writer)",
            },
            prompt: {
                type: "string",
                description: "Detailed description of what the subagent should do.",
            },
            context_mode: {
                type: "string",
                enum: ["isolated", "shared", "handoff"],
                description: "Context mode: 'isolated' (clean start), 'shared' (inherit messages), 'handoff' (compressed summary). Default: isolated.",
            },
            model_tier: {
                type: "string",
                enum: ["fast", "normal", "advanced"],
                description: "Model tier: 'fast' for simple tasks, 'normal' for regular tasks, 'advanced' for complex reasoning. Default: fast.",
            },
        },
        required: ["subagent_type", "prompt"],
    },
};
