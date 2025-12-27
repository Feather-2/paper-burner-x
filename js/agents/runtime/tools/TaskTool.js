/**
 * Task 工具 - 模型主动启动子代理的工具实现
 *
 * 参考 cc.md:
 * Launch a new agent to handle complex, multi-step tasks autonomously...
 */

import { globalSubagentRegistry } from "../../sdk/SubagentRegistry.js";
import { normalizeToolResult } from "../core/agent-loop.js";

/**
 * 创建 Task 工具 Handler
 * @param {Object} options
 * @param {SubagentRegistry} [options.registry] - 注册表，默认使用全局
 * @param {AgentInstance} [options.parentAgent] - 父代理实例，用于共享配置或信号
 * @returns {Function}
 */
export function createTaskTool({ registry = globalSubagentRegistry, parentAgent } = {}) {
    /**
     * Task 工具实现
     * @param {Object} args
     * @param {string} args.subagent_type - 子代理类型 (如 Explore, Coder)
     * @param {string} args.prompt - 任务描述
     * @param {string} [args.model] - 指定模型 (sonnet, haiku 等)
     * @param {Object} context - Skill 上下文
     */
    return async function taskHandler(args, context) {
        const { subagent_type, prompt, model } = args;
        const { emit, logger, signal } = context;

        logger.info(`Launching subagent: ${subagent_type}`, { prompt, model });

        const factory = registry.getFactory(subagent_type);
        if (!factory) {
            return {
                ok: false,
                error: `Unknown subagent type: ${subagent_type}. Available types: ${registry.getAvailableTypes().map(t => t.type).join(", ")}`,
            };
        }

        try {
            // 1. 创建子代理实例
            // 工厂函数应接受配置并返回一个 AgentInstance 或类似对象
            const subagent = await factory({
                prompt,
                model: model || parentAgent?.options?.model || "haiku",
                parent: parentAgent,
            });

            if (!subagent || typeof subagent.run !== "function") {
                throw new Error(`Factory for "${subagent_type}" did not return a valid AgentInstance`);
            }

            // 2. 继承事件订阅（可选，或者由工厂决定）
            // subagent.on('*', (evt) => emit(`subagent.${subagent_type}.${evt.name}`, evt.payload));

            // 3. 执行任务 (隔离上下文)
            emit("subagent.started", { type: subagent_type, prompt });

            const result = await subagent.run({ task: prompt }, { signal });

            emit("subagent.completed", { type: subagent_type, result });

            return normalizeToolResult(result);
        } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            logger.error(`Subagent "${subagent_type}" failed: ${error}`);
            emit("subagent.failed", { type: subagent_type, error });
            return { ok: false, error };
        }
    };
}

/**
 * Task 工具定义 (JSON Schema)
 */
export const TASK_TOOL_DEFINITION = {
    name: "Task",
    description: "Launch a new specialized agent to handle a complex task autonomously. Use this when the current context is too full or the task is highly specialized (e.g. searching a codebase).",
    parameters: {
        type: "object",
        properties: {
            subagent_type: {
                type: "string",
                description: "The type of specialized agent to use (e.g. Explore, Coder, Writer)",
            },
            prompt: {
                type: "string",
                description: "Detailed description of what the subagent should do.",
            },
            model: {
                type: "string",
                enum: ["sonnet", "haiku", "opus"],
                description: "Optional model to use. Use haiku for simple/searching tasks to save context/cost.",
            },
        },
        required: ["subagent_type", "prompt"],
    },
};
