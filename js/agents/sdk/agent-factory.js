import { EventBus } from "../runtime/events/event-bus.js";
import { BaseAgentLoop } from "../runtime/core/agent-loop.js";
import { useLogger } from "../shared/utils/logger.js";
import { createTaskTool, TASK_TOOL_DEFINITION } from "../runtime/tools/TaskTool.js";
import { createRecallTool, RECALL_TOOL_DEFINITION } from "../runtime/tools/RecallTool.js";
import { createBacktrackTool, BACKTRACK_TOOL_DEFINITION } from "../runtime/tools/BacktrackTool.js";
import { CicadaCompressor } from "../runtime/compression/cicada-compressor.js";
import { BacktrackManager } from "./BacktrackManager.js";
import { DiscoveryManager } from "./DiscoveryManager.js";
import { AlertMonitor } from "./AlertMonitor.js";
import { ToolExecutor } from "../runtime/tools/tool-executor.js";
import { DefaultAgentLoop } from "./DefaultAgentLoop.js";

/**
 * Agent 实例 - 由 AgentFactory 创建
 */
export class AgentInstance {
  constructor({
    eventBus,
    logger,
    capabilities,
    toolExecutor,
    mcpConfig,
    subagentRegistry,
    compressor,
    backtrackManager,
    discoveryManager,
    actor,
    options,
  }) {
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
   * @returns {any[]}
   */
  getCapabilityDefinitions() {
    return Array.from(this.capabilities.values()).map((s) => s.definition);
  }

  /** @deprecated Use getCapabilityDefinitions instead */
  getSkillDefinitions() {
    return this.getCapabilityDefinitions();
  }

  /**
   * 获取 capability catalog prompt (按优先级排序)
   * @returns {string}
   */
  getCapabilityCatalogPrompt() {
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

    const lines = ["## 可用能力\n"];

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
   * @param {Object} input
   * @param {Object} [context={}]
   * @returns {Promise<Object>}
   */
  async run(input, context = {}) {
    const actorPrefix = this.actor.toLowerCase();
    this.eventBus.emit(`${actorPrefix}.agent.started`, { runId: context.runId || Date.now().toString() });

    try {
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
   * @returns {Function}
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

export class AgentFactory {
  /**
   * Create an AgentInstance from a validated AgentConfig.
   * @param {import("./agent-config.js").AgentConfig} config
   * @returns {AgentInstance}
   */
  create(config) {
    const eventBus = new EventBus();
    const logger = useLogger({ actor: config.actor });

    // Default backpressure + coalescing for progress events (browser + node).
    if (typeof eventBus.enableBackpressure === "function") {
      const cfg = config.options?.eventBusBackpressure ?? config.options?.backpressure;
      if (cfg !== false) {
        const opts = cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : {};
        try {
          eventBus.enableBackpressure({ deferNonCoalesced: opts.deferNonCoalesced ?? false, ...opts });
        } catch {
          // ignore
        }
      }
    }

    for (const { pattern, handler } of config.eventHandlers) {
      eventBus.subscribe(pattern, /** @type {any} */ (handler));
    }

    const capabilities = config.capabilities;
    const hooks = config.hooks;
    const subagentRegistry = config.subagentRegistry;

    let compressor = null;
    if (config.cicadaConfig) {
      compressor = /** @type {any} */ (new CicadaCompressor({
        eventBus,
        ...config.cicadaConfig,
      }));

      config.useCapability("Recall", {
        definition: RECALL_TOOL_DEFINITION,
        handler: createRecallTool({ compressor }),
      });
    }

    let backtrackManager = null;
    if (config.backtrackConfig || config.cicadaConfig) {
      backtrackManager = /** @type {any} */ (new BacktrackManager({
        compressor,
        logger,
        ...(config.backtrackConfig || {}),
      }));

      config.useCapability("Backtrack", {
        definition: BACKTRACK_TOOL_DEFINITION,
        handler: createBacktrackTool({ backtrackManager }),
      });
    }

    let discoveryManager = null;
    if (config.discoveryConfig || config.cicadaConfig) {
      discoveryManager = new DiscoveryManager({
        sharedContext: /** @type {any} */ (compressor)?.sharedContext || null,
        logger,
        emit: (e, p) => eventBus.emit(e, p),
        ...(config.discoveryConfig || {}),
      });
    }

    if (subagentRegistry.getAvailableTypes().length > 0) {
      config.useCapability("Task", {
        definition: TASK_TOOL_DEFINITION,
        handler: createTaskTool({ registry: subagentRegistry }),
      });
    }

    const agent = new AgentInstance({
      eventBus,
      logger,
      capabilities,
      toolExecutor: null,
      mcpConfig: config.mcpConfig,
      subagentRegistry,
      compressor,
      backtrackManager,
      discoveryManager,
      actor: config.actor,
      options: config.options,
    });

    if (config.alertMonitorConfig) {
      agent.alertMonitor = new AlertMonitor({
        agent,
        logger,
        ...config.alertMonitorConfig,
      });
    }

    const executor = new ToolExecutor({
      tools: Object.fromEntries(capabilities),
      hooks,
      logger,
      emit: (e, p) => eventBus.emit(e, p),
    });

    const toolExecutor = async (name, params, context) => {
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

export default { AgentFactory, AgentInstance };
