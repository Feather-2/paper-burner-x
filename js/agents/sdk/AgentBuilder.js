/**
 * AgentBuilder - 流式构建 Agent 实例
 *
 * 提供链式 API 配置 Agent，支持：
 * - Skill 注册（默认懒加载）
 * - Hook 机制（before/after）
 * - MCP 集成
 * - 事件订阅
 *
 * @example
 * ```javascript
 * import { createAgent } from '@paper-burner/agents';
 *
 * const agent = createAgent()
 *   .useSkill('search-docs', searchDocsHandler)
 *   .useHook('before', auditLogger)
 *   .onEvent('deepsearch.*', progressHandler)
 *   .build();
 *
 * await agent.run({ query: '分析文档...' });
 * ```
 */

import { EventBus } from "../runtime/events/event-bus.js";
import { BaseAgentLoop } from "../runtime/core/agent-loop.js";
import { createLogger } from "../shared/utils/logger.js";
import { SubagentRegistry } from "./SubagentRegistry.js";
import { createTaskTool, TASK_TOOL_DEFINITION } from "../runtime/tools/TaskTool.js";
import { createRecallTool, RECALL_TOOL_DEFINITION } from "../runtime/tools/RecallTool.js";
import { createBacktrackTool, BACKTRACK_TOOL_DEFINITION } from "../runtime/tools/BacktrackTool.js";
import { CicadaCompressor } from "../runtime/compression/cicada-compressor.js";
import { BacktrackManager } from "./BacktrackManager.js";
import { DiscoveryManager } from "./DiscoveryManager.js";
import { ShadowSystem } from "./ShadowSystem.js";

/**
 * @typedef {Object} SkillDefinition
 * @property {string} name - Skill 名称
 * @property {string} description - Skill 描述
 * @property {Object} [activation] - 激活配置
 * @property {string[]} [activation.keywords] - 触发关键词
 * @property {number} [activation.priority] - 优先级
 * @property {Object} [parameters] - 参数 schema
 * @property {boolean} [lazy=true] - 是否懒加载
 */

/**
 * @typedef {Object} SkillContext
 * @property {Object} state - Agent 状态
 * @property {Function} emit - 事件发射函数
 * @property {AbortSignal} signal - 取消信号
 * @property {Object} logger - Logger 实例
 */

/**
 * @typedef {(args: Object, context: SkillContext) => Promise<Object>} SkillHandler
 */

/**
 * @typedef {Object} Skill
 * @property {SkillDefinition} definition
 * @property {SkillHandler} [handler] - 如果懒加载，初始为 null
 * @property {string} [_module] - 懒加载时的模块路径
 */

/**
 * @typedef {Object} HookContext
 * @property {string} tool - 工具名称
 * @property {Object} params - 调用参数
 * @property {Object} context - 执行上下文
 * @property {Object} [result] - 执行结果（仅 after hook）
 */

/**
 * @typedef {(ctx: HookContext) => Promise<{skip?: boolean, value?: any, params?: Object} | void>} BeforeHook
 */

/**
 * @typedef {(ctx: HookContext) => Promise<any>} AfterHook
 */

export class AgentBuilder {
    constructor(options = {}) {
        /** @type {Map<string, Skill>} */
        this._skills = new Map();

        /** @type {{before: BeforeHook[], after: AfterHook[]}} */
        this._hooks = { before: [], after: [] };

        /** @type {Object|null} */
        this._mcpConfig = null;

        /** @type {Array<{pattern: string, handler: Function}>} */
        this._eventHandlers = [];

        /** @type {Object} */
        this._options = options;

        /** @type {string} */
        this._actor = options.actor || "agent";

        /** @type {SubagentRegistry} */
        this._subagentRegistry = new SubagentRegistry();
    }

    /**
     * 注册 Skill
     * @param {string} name - Skill 名称
     * @param {Skill|SkillHandler|{definition: SkillDefinition, handler?: SkillHandler, module?: string}} config
     * @returns {AgentBuilder}
     */
    useSkill(name, config) {
        if (typeof config === "function") {
            // 简写：直接传入 handler
            this._skills.set(name, {
                definition: { name, description: `Skill: ${name}`, lazy: false },
                handler: config,
            });
        } else if (config.definition) {
            // 完整配置
            const skill = {
                definition: { ...config.definition, lazy: config.definition.lazy !== false },
                handler: config.handler || null,
                _module: config.module || null,
            };
            this._skills.set(name, skill);
        } else {
            throw new Error(`Invalid skill config for "${name}"`);
        }
        return this;
    }

    /**
     * 批量注册 Skills
     * @param {Object<string, Skill>} skillsMap
     * @returns {AgentBuilder}
     */
    useSkills(skillsMap) {
        for (const [name, config] of Object.entries(skillsMap)) {
            this.useSkill(name, config);
        }
        return this;
    }

    /**
     * 注册 Hook
     * @param {"before"|"after"} phase - Hook 阶段
     * @param {BeforeHook|AfterHook} fn - Hook 函数
     * @returns {AgentBuilder}
     */
    useHook(phase, fn) {
        if (phase !== "before" && phase !== "after") {
            throw new Error(`Invalid hook phase: ${phase}`);
        }
        if (typeof fn !== "function") {
            throw new Error("Hook must be a function");
        }
        this._hooks[phase].push(fn);
        return this;
    }

    /**
     * 配置 MCP
     * @param {Object} config - MCP 配置
     * @param {string} [config.endpoint] - MCP Nexus 端点
     * @param {boolean} [config.useLocal=true] - 是否使用本地 MCP
     * @returns {AgentBuilder}
     */
    useMcp(config) {
        this._mcpConfig = config;
        return this;
    }

    /**
     * 配置 Cicada 上下文压缩
     * @param {Object} config - Cicada 配置
     * @param {number} [config.maxTokens] - 最大 token 数
     * @param {string[]} [config.layers] - 压缩层级
     * @returns {AgentBuilder}
     */
    useCicada(config) {
        this._cicadaConfig = config;
        return this;
    }

    /**
     * 配置回溯功能 (春秋蝉)
     * @param {Object} config - { maxBacktracks: number }
     * @returns {AgentBuilder}
     */
    useBacktrack(config = {}) {
        this._backtrackConfig = config;
        return this;
    }

    /**
     * 配置 Watchdog 监控
     * @param {Object} config - Watchdog 配置
     * @returns {AgentBuilder}
     */
    useWatchdog(config) {
        this._watchdogConfig = config;
        return this;
    }

    /**
     * 配置 Discovery (共享黑板)
     * @param {Object} config - Discovery 配置
     * @returns {AgentBuilder}
     */
    useDiscovery(config = {}) {
        this._discoveryConfig = config;
        return this;
    }

    /**
     * 配置影子系统 (意识/潜意识)
     * @param {Object} config - 影子系统配置
     * @returns {AgentBuilder}
     */
    useShadow(config = {}) {
        this._shadowConfig = config;
        return this;
    }

    /**
     * 订阅事件
     * @param {string} pattern - 事件模式（支持 * 通配符）
     * @param {Function} handler - 事件处理函数
     * @returns {AgentBuilder}
     */
    onEvent(pattern, handler) {
        this._eventHandlers.push({ pattern, handler });
        return this;
    }

    /**
     * 设置 Actor 名称
     * @param {string} name
     * @returns {AgentBuilder}
     */
    actor(name) {
        this._actor = name;
        return this;
    }

    /**
     * 注册子代理类型
     * @param {string} type - 子代理类型 (如 Explore)
     * @param {Function} factory - 创建子代理实例的工厂函数
     * @param {string} [description] - 子代理描述
     * @returns {AgentBuilder}
     */
    useSubagent(type, factory, description = "") {
        this._subagentRegistry.register(type, factory, description);
        return this;
    }

    /**
     * 构建 Agent 实例
     * @returns {AgentInstance}
     */
    build() {
        const eventBus = new EventBus();
        const logger = createLogger({ actor: this._actor });

        // 注册事件处理器
        for (const { pattern, handler } of this._eventHandlers) {
            eventBus.subscribe(pattern, handler);
        }

        const skills = this._skills;
        const hooks = this._hooks;
        const subagentRegistry = this._subagentRegistry;

        // 初始化 Cicada (如果配置了)
        let compressor = null;
        if (this._cicadaConfig) {
            compressor = new CicadaCompressor({
                eventBus,
                ...this._cicadaConfig,
            });

            // 自动添加 Recall 工具
            this.useSkill("Recall", {
                definition: RECALL_TOOL_DEFINITION,
                handler: createRecallTool({ compressor }),
            });
        }

        // 初始化 BacktrackManager (如果启用了记忆或显式配置)
        let backtrackManager = null;
        if (this._backtrackConfig || this._cicadaConfig) {
            backtrackManager = new BacktrackManager({
                compressor,
                logger,
                ...(this._backtrackConfig || {}),
            });

            // 自动添加 Backtrack 工具 (春秋蝉)
            this.useSkill("Backtrack", {
                definition: BACKTRACK_TOOL_DEFINITION,
                handler: createBacktrackTool({ backtrackManager }),
            });
        }

        // 初始化 DiscoveryManager (共享黑板)
        let discoveryManager = null;
        if (this._discoveryConfig || this._cicadaConfig) {
            discoveryManager = new DiscoveryManager({
                sharedContext: compressor?.sharedContext || null,
                logger,
                emit: (e, p) => eventBus.emit(e, p),
                ...(this._discoveryConfig || {}),
            });
        }

        // 如果注册了子代理，自动添加 Task 工具
        if (subagentRegistry.getAvailableTypes().length > 0) {
            this.useSkill("Task", {
                definition: TASK_TOOL_DEFINITION,
                handler: createTaskTool({ registry: subagentRegistry }),
            });
        }

        const agent = new AgentInstance({
            eventBus,
            logger,
            skills,
            toolExecutor: null, // 将在下方定义
            mcpConfig: this._mcpConfig,
            subagentRegistry,
            compressor,
            backtrackManager,
            discoveryManager,
            actor: this._actor,
            options: this._options,
        });

        // 初始化影子系统 (意识/潜意识)
        if (this._shadowConfig) {
            agent.shadow = new ShadowSystem({
                agent,
                logger,
                ...this._shadowConfig,
            });
        }

        const toolExecutor = async (name, params, context) => {
            // Before hooks
            let finalParams = params;
            for (const hook of hooks.before) {
                const result = await hook({ tool: name, params: finalParams, context });
                if (result?.skip) {
                    return result.value;
                }
                if (result?.params) {
                    finalParams = result.params;
                }
            }

            // 执行 skill
            const skill = skills.get(name);
            if (!skill) {
                throw new Error(`Unknown skill: ${name}`);
            }

            // 懒加载 handler
            let handler = skill.handler;
            if (!handler && skill._module) {
                const mod = await import(skill._module);
                handler = mod.default?.handler || mod.handler;
                skill.handler = handler;
            }

            if (!handler) {
                throw new Error(`Skill "${name}" has no handler`);
            }

            const skillContext = {
                state: context.state,
                emit: (event, payload) => eventBus.emit(event, payload),
                signal: context.signal,
                logger,
                discoveryManager,
            };

            let result = await handler(finalParams, skillContext);

            // After hooks
            for (const hook of hooks.after) {
                result = await hook({ tool: name, params: finalParams, result, context }) ?? result;
            }

            return result;
        };

        agent.toolExecutor = toolExecutor;
        return agent;
    }
}

/**
 * Agent 实例 - 由 AgentBuilder.build() 创建
 */
export class AgentInstance {
    constructor({ eventBus, logger, skills, toolExecutor, mcpConfig, subagentRegistry, compressor, backtrackManager, discoveryManager, actor, options }) {
        this.eventBus = eventBus;
        this.logger = logger;
        this.skills = skills;
        this.toolExecutor = toolExecutor;
        this.mcpConfig = mcpConfig;
        this.subagentRegistry = subagentRegistry;
        this.memory = compressor; // CicadaCompressor 实例
        this.backtrack = backtrackManager; // BacktrackManager 实例
        this.discovery = discoveryManager; // DiscoveryManager 实例
        this.shadow = null; // 影子系统实例 (意识/潜意识)
        this.actor = actor;
        this.options = options;
        this._loop = null;
    }

    /**
     * 获取所有 skill 定义
     * @returns {SkillDefinition[]}
     */
    getSkillDefinitions() {
        return Array.from(this.skills.values()).map(s => s.definition);
    }

    /**
     * 获取 skill catalog prompt
     * @returns {string}
     */
    getSkillCatalogPrompt() {
        const lines = ["## 可用技能\n"];

        for (const [name, skill] of this.skills) {
            lines.push(`### ${name}`);
            lines.push(skill.definition.description);
            if (skill.definition.activation?.keywords?.length) {
                lines.push(`触发词: ${skill.definition.activation.keywords.join(", ")}`);
            }
            lines.push("");
        }

        if (this.subagentRegistry) {
            const subPrompt = this.subagentRegistry.getSubagentCatalogPrompt();
            if (subPrompt) {
                lines.push("\n---");
                lines.push(subPrompt);
            }
        }

        return lines.join("\n");
    }

    /**
     * 执行 Agent
     * @param {Object} input - 输入参数
     * @param {Object} [context={}] - 执行上下文
     * @returns {Promise<Object>}
     */
    async run(input, context = {}) {
        const actorPrefix = this.actor.toLowerCase();
        this.eventBus.emit(`${actorPrefix}.agent.started`, { runId: context.runId || Date.now().toString() });

        try {
            // 这里可以接入具体的 AgentLoop 实现
            // 默认提供一个简单的单步执行
            if (this._loop) {
                return await this._loop.run(input, context);
            }

            // 简单模式：直接返回 skill 列表
            return {
                success: true,
                skills: this.getSkillDefinitions(),
                message: "Agent ready. Set a loop implementation for full execution.",
            };
        } catch (error) {
            this.eventBus.emit(`${this.actor}.agent.failed`, { error: error.message });
            throw error;
        }
    }

    /**
     * 设置底层 AgentLoop 实现
     * @param {BaseAgentLoop} loop
     * @returns {AgentInstance}
     */
    setLoop(loop) {
        this._loop = loop;
        return this;
    }

    /**
     * 订阅事件
     * @param {string} pattern
     * @param {Function} handler
     * @returns {Function} 取消订阅函数
     */
    on(pattern, handler) {
        return this.eventBus.subscribe(pattern, handler);
    }

    /**
     * 取消所有订阅
     */
    dispose() {
        this.eventBus.clear?.();
    }
}

/**
 * 创建 AgentBuilder 实例
 * @param {Object} [options]
 * @returns {AgentBuilder}
 */
export function createAgent(options = {}) {
    return new AgentBuilder(options);
}

export default { createAgent, AgentBuilder, AgentInstance };
