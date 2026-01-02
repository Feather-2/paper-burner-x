/**
 * AgentBuilder - 流式构建 Agent 实例
 *
 * 提供链式 API 配置 Agent，支持：
 * - Capability 注册（默认懒加载）
 * - Hook 机制（before/after）
 * - MCP 集成
 * - 事件订阅
 *
 * @example
 * ```javascript
 * import { createAgent } from '@paper-burner/agents';
 *
 * const agent = createAgent()
 *   .useCapability('search-docs', searchDocsHandler)
 *   .useHook('before', auditLogger)
 *   .onEvent('deepsearch.*', progressHandler)
 *   .build();
 *
 * await agent.run({ query: '分析文档...' });
 * ```
 */

import { EventBus } from "../runtime/events/event-bus.js";
import { BaseAgentLoop } from "../runtime/core/agent-loop.js";
import { useLogger } from "../shared/utils/logger.js";
import { SubagentRegistry } from "./SubagentRegistry.js";
import { createTaskTool, TASK_TOOL_DEFINITION } from "../runtime/tools/TaskTool.js";
import { createRecallTool, RECALL_TOOL_DEFINITION } from "../runtime/tools/RecallTool.js";
import { createBacktrackTool, BACKTRACK_TOOL_DEFINITION } from "../runtime/tools/BacktrackTool.js";
import { CicadaCompressor } from "../runtime/compression/cicada-compressor.js";
import { BacktrackManager } from "./BacktrackManager.js";
import { DiscoveryManager } from "./DiscoveryManager.js";
import { AlertMonitor } from "./AlertMonitor.js";
import { ToolExecutor } from "../runtime/tools/tool-executor.js";
import { DefaultAgentLoop } from "./DefaultAgentLoop.js";

let didWarnUseSkillDeprecated = false;

function warnUseSkillDeprecatedOnce() {
    if (didWarnUseSkillDeprecated) return;
    didWarnUseSkillDeprecated = true;

    if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn(
            "useSkill/useSkills are deprecated since 1.0.0 and will be removed in 2.0.0; use useCapability/useCapabilities instead (see docs/DEPRECATIONS.md)."
        );
    }
}

/**
 * @typedef {Object} CapabilityDefinition
 * @property {string} name - Capability 名称
 * @property {string} description - Capability 描述
 * @property {Object} [activation] - 激活配置
 * @property {string[]} [activation.keywords] - 触发关键词
 * @property {number} [activation.priority] - 优先级
 * @property {Object} [parameters] - 参数 schema
 * @property {boolean} [lazy=true] - 是否懒加载
 */

/**
 * @typedef {Object} CapabilityContext
 * @property {Object} state - Agent 状态
 * @property {Function} emit - 事件发射函数
 * @property {AbortSignal} signal - 取消信号
 * @property {Object} logger - Logger 实例
 */

/**
 * @typedef {(args: Object, context: CapabilityContext) => Promise<Object>} CapabilityHandler
 */

/**
 * @typedef {Object} Capability
 * @property {CapabilityDefinition} definition
 * @property {CapabilityHandler} [handler] - 如果懒加载，初始为 null
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
        /** @type {Map<string, Capability>} */
        this._capabilities = new Map();

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
     * 注册 Capability (能力)
     * @param {string} name - Capability 名称
     * @param {Capability|CapabilityHandler|{definition: CapabilityDefinition, handler?: CapabilityHandler, module?: string}} config
     * @returns {AgentBuilder}
     */
    useCapability(name, config) {
        const exists = this._capabilities.has(name);
        if (exists && typeof console !== "undefined" && typeof console.warn === "function") {
            console.warn(`[AgentBuilder] Capability "${name}" is being overwritten.`);
        }
        if (typeof config === "function") {
            // 简写：直接传入 handler
            this._capabilities.set(name, {
                definition: { name, description: `Capability: ${name}`, lazy: false },
                handler: config,
            });
        } else if (config.definition) {
            // 完整配置
            const capability = {
                definition: { ...config.definition, lazy: config.definition.lazy !== false },
                handler: config.handler || null,
                _module: config.module || null,
            };
            this._capabilities.set(name, capability);
        } else {
            throw new Error(`Invalid capability config for "${name}"`);
        }
        return this;
    }

    /**
     * 批量注册 Capabilities
     * @param {Object<string, Capability>} capabilitiesMap
     * @returns {AgentBuilder}
     */
    useCapabilities(capabilitiesMap) {
        for (const [name, config] of Object.entries(capabilitiesMap)) {
            this.useCapability(name, config);
        }
        return this;
    }

    // === 向后兼容别名 ===
    /** @deprecated Use useCapability instead */
    useSkill(name, config) {
        warnUseSkillDeprecatedOnce();
        return this.useCapability(name, config);
    }
    /** @deprecated Use useCapabilities instead */
    useSkills(skillsMap) {
        warnUseSkillDeprecatedOnce();
        return this.useCapabilities(skillsMap);
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
     * 配置 Watchdog 健康监控
     * @param {Object} config - { maxIterations, maxTimeMs, stuckThresholdMs }
     * @returns {AgentBuilder}
     */
    useWatchdog(config = {}) {
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
     * 配置告警监控器
     * @param {Object} config - AlertMonitor 配置
     * @returns {AgentBuilder}
     */
    useAlertMonitor(config = {}) {
        this._alertMonitorConfig = config;
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
        const logger = useLogger({ actor: this._actor });

        // P2.1: 默认启用背压（浏览器和 Node.js 均生效），coalesce *.progress 事件
        if (typeof eventBus.enableBackpressure === "function") {
            const cfg = this._options?.eventBusBackpressure ?? this._options?.backpressure;
            if (cfg !== false) {
                const opts = cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {};
                try {
                    eventBus.enableBackpressure({ deferNonCoalesced: opts.deferNonCoalesced ?? false, ...opts });
                } catch {
                    // ignore
                }
            }
        }

        // 注册事件处理器
        for (const { pattern, handler } of this._eventHandlers) {
            eventBus.subscribe(pattern, handler);
        }

        const capabilities = this._capabilities;
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
            this.useCapability("Recall", {
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
            this.useCapability("Backtrack", {
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
            this.useCapability("Task", {
                definition: TASK_TOOL_DEFINITION,
                handler: createTaskTool({ registry: subagentRegistry }),
            });
        }

        const agent = new AgentInstance({
            eventBus,
            logger,
            capabilities,
            toolExecutor: null, // 将在下方定义
            mcpConfig: this._mcpConfig,
            subagentRegistry,
            compressor,
            backtrackManager,
            discoveryManager,
            actor: this._actor,
            options: this._options,
        });

        // 初始化 AlertMonitor
        if (this._alertMonitorConfig) {
            agent.alertMonitor = new AlertMonitor({
                agent,
                logger,
                ...this._alertMonitorConfig,
            });
        }

        const executor = new ToolExecutor({
            tools: Object.fromEntries(capabilities),
            hooks,
            logger,
            emit: (e, p) => eventBus.emit(e, p),
        });

        const toolExecutor = async (name, params, context) => {
            // 劫持执行逻辑以处理 AgentBuilder 特有的懒加载和上下文注入
            const capability = capabilities.get(name);
            if (capability?._module && !capability.handler) {
                const mod = await import(capability._module);
                capability.handler = mod.default?.handler || mod.handler;
                executor.register(name, capability);
            }

            const capabilityContext = {
                state: context.state,
                emit: (event, payload) => eventBus.emit(event, payload),
                signal: context.signal,
                logger,
                discoveryManager,
            };

            return executor.execute(name, params, capabilityContext);
        };

        agent.toolExecutor = toolExecutor;
        return agent;
    }
}

/**
 * Agent 实例 - 由 AgentBuilder.build() 创建
 */
export class AgentInstance {
    constructor({ eventBus, logger, capabilities, toolExecutor, mcpConfig, subagentRegistry, compressor, backtrackManager, discoveryManager, actor, options }) {
        this.eventBus = eventBus;
        this.logger = logger;
        this.capabilities = capabilities;
        this.toolExecutor = toolExecutor;
        this.mcpConfig = mcpConfig;
        this.subagentRegistry = subagentRegistry;
        this.memory = compressor; // CicadaCompressor 实例
        this.backtrack = backtrackManager; // BacktrackManager 实例
        this.discovery = discoveryManager; // DiscoveryManager 实例
        this.alertMonitor = null; // AlertMonitor 实例
        this.actor = actor;
        this.options = options;
        this._loop = null;
    }

    /** @deprecated Use capabilities instead */
    get skills() {
        return this.capabilities;
    }

    /**
     * 获取所有 capability 定义
     * @returns {CapabilityDefinition[]}
     */
    getCapabilityDefinitions() {
        return Array.from(this.capabilities.values()).map(s => s.definition);
    }

    /** @deprecated Use getCapabilityDefinitions instead */
    getSkillDefinitions() {
        return this.getCapabilityDefinitions();
    }

    /**
     * 获取 capability catalog prompt (按优先级排序)
     * 
     * 三层优先级机制:
     * - critical: 核心能力，始终在最前面
     * - important: 重要能力，紧随其后
     * - optional: 可选能力，放在最后
     * 
     * @returns {string}
     */
    getCapabilityCatalogPrompt() {
        // 按优先级分组
        const critical = [];
        const important = [];
        const optional = [];

        for (const [name, capability] of this.capabilities) {
            const priority = capability.definition.priority || capability.definition.activation?.priority || "important";
            const entry = { name, capability, priority };

            if (priority === "critical" || priority === 0) {
                critical.push(entry);
            } else if (priority === "optional" || priority === 2) {
                optional.push(entry);
            } else {
                important.push(entry);
            }
        }

        // 构建 prompt，按优先级顺序
        const lines = ["## 可用能力\n"];

        // Critical 能力
        if (critical.length > 0) {
            lines.push("### 🔴 核心能力\n");
            for (const { name, capability } of critical) {
                lines.push(`**${name}**: ${capability.definition.description}`);
                if (capability.definition.activation?.keywords?.length) {
                    lines.push(`  触发词: ${capability.definition.activation.keywords.join(", ")}`);
                }
                lines.push("");
            }
        }

        // Important 能力
        if (important.length > 0) {
            lines.push("### 🟡 重要能力\n");
            for (const { name, capability } of important) {
                lines.push(`**${name}**: ${capability.definition.description}`);
                if (capability.definition.activation?.keywords?.length) {
                    lines.push(`  触发词: ${capability.definition.activation.keywords.join(", ")}`);
                }
                lines.push("");
            }
        }

        // Optional 能力
        if (optional.length > 0) {
            lines.push("### ⚪ 辅助能力\n");
            for (const { name, capability } of optional) {
                lines.push(`**${name}**: ${capability.definition.description}`);
                if (capability.definition.activation?.keywords?.length) {
                    lines.push(`  触发词: ${capability.definition.activation.keywords.join(", ")}`);
                }
                lines.push("");
            }
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

    /** @deprecated Use getCapabilityCatalogPrompt instead */
    getSkillCatalogPrompt() {
        return this.getCapabilityCatalogPrompt();
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
            // Provide a sensible default loop (LLM-driven when a modelRouter/aiApiService is provided in context).
            if (!this._loop) {
                const opts = this.options && typeof this.options === "object" ? this.options : {};
                const defaultLoopOptions =
                    opts.defaultLoop && typeof opts.defaultLoop === "object" && !Array.isArray(opts.defaultLoop) ? opts.defaultLoop : {};

                this._loop = new DefaultAgentLoop({
                    actor: this.actor,
                    stageName: this.actor,
                    eventBus: this.eventBus,
                    logger: this.logger,
                    toolExecutor: this.toolExecutor,
                    capabilities: this.capabilities,
                    getCatalogPrompt: () => this.getCapabilityCatalogPrompt(),
                    ...defaultLoopOptions,
                });
            }

            return await this._loop.run(input, context);
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
