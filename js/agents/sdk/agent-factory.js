import { EventBus } from "../core/event-bus.js";
import { BaseAgentLoop } from "../runtime/core/agent-loop.js";
import { DisposableBase } from "../shared/index.js";
import { useLogger } from "../shared/index.js";
import { createTaskTool, TASK_TOOL_DEFINITION } from "../runtime/tools/TaskTool.js";
import { createRecallTool, RECALL_TOOL_DEFINITION } from "../runtime/tools/RecallTool.js";
import { createBacktrackTool, BACKTRACK_TOOL_DEFINITION } from "../runtime/tools/BacktrackTool.js";
import { CicadaCompressor } from "../plugins/compression/index.js";
import { BacktrackManager } from "./BacktrackManager.js";
import { DiscoveryManager } from "./DiscoveryManager.js";
import { AlertMonitor } from "./AlertMonitor.js";
import { ToolExecutor } from "../runtime/tools/tool-executor.js";
import { DefaultAgentLoop } from "./DefaultAgentLoop.js";
import { isPlainObject, toNonEmptyString } from "../shared/index.js";

/**
 * @typedef {object} AgentInstanceCore
 * @property {EventBus} eventBus
 * @property {any} logger
 * @property {string} actor
 *
 * @typedef {object} AgentInstanceCapabilities
 * @property {Map<string, any>} capabilities
 * @property {((name: string, params: any, context: any) => Promise<any>) | null} toolExecutor
 * @property {any} mcpConfig
 * @property {any} subagentRegistry
 *
 * @typedef {object} AgentInstanceManagers
 * @property {any} compressor
 * @property {any} backtrackManager
 * @property {any} discoveryManager
 *
 * @typedef {object} AgentInstanceConfig
 * @property {AgentInstanceCore} core
 * @property {AgentInstanceCapabilities} capabilities
 * @property {AgentInstanceManagers} managers
 * @property {any} options
 */

/**
 * @param {any} input
 * @returns {AgentInstanceConfig}
 */
function normalizeAgentInstanceConfig(input) {
  const raw = isPlainObject(input) ? input : {};
  const hasGroups = isPlainObject(raw.core) || isPlainObject(raw.capabilities) || isPlainObject(raw.managers) || isPlainObject(raw.options);

  if (hasGroups) {
    return {
      core: isPlainObject(raw.core) ? raw.core : {},
      capabilities: isPlainObject(raw.capabilities) ? raw.capabilities : {},
      managers: isPlainObject(raw.managers) ? raw.managers : {},
      options: raw.options,
    };
  }

  return {
    core: {
      eventBus: raw.eventBus,
      logger: raw.logger,
      actor: raw.actor,
    },
    capabilities: {
      capabilities: raw.capabilities,
      toolExecutor: raw.toolExecutor,
      mcpConfig: raw.mcpConfig,
      subagentRegistry: raw.subagentRegistry,
    },
    managers: {
      compressor: raw.compressor,
      backtrackManager: raw.backtrackManager,
      discoveryManager: raw.discoveryManager,
    },
    options: raw.options,
  };
}

/**
 * Agent 实例 - 由 AgentFactory 创建
 */
export class AgentInstance extends DisposableBase {
  /**
   * @param {AgentInstanceConfig | any} input
   */
  constructor(input) {
    super();

    const { core, capabilities, managers, options } = normalizeAgentInstanceConfig(input);
    const eventBus = core.eventBus;
    const logger = core.logger;
    const actor = core.actor;
    const capabilityMap = capabilities.capabilities;
    const toolExecutor = capabilities.toolExecutor;
    const mcpConfig = capabilities.mcpConfig;
    const subagentRegistry = capabilities.subagentRegistry;
    const compressor = managers.compressor;
    const backtrackManager = managers.backtrackManager;
    const discoveryManager = managers.discoveryManager;

    this.eventBus = eventBus;
    this.logger = logger;
    this.capabilities = capabilityMap;
    this.mcpConfig = mcpConfig;
    this.subagentRegistry = subagentRegistry;
    this.memory = compressor; // CicadaCompressor 实例
    this.backtrack = backtrackManager; // BacktrackManager 实例
    this.discovery = discoveryManager; // DiscoveryManager 实例
    this.alertMonitor = null; // AlertMonitor 实例
    this.actor = actor;
    this.options = options;

    /** @type {((name: string, params: any, context: any) => Promise<any>) | null} */
    this._toolExecutor = null;
    this.toolExecutor = toolExecutor;

    this._loop = null;

    // Ensure internal resources are released on dispose.
    this._registerDisposable(() => {
      this._toolExecutor = null;
    });

    this._registerDisposable(async () => {
      const compressorRef = this.memory;
      if (compressorRef && typeof compressorRef.dispose === "function") {
        await compressorRef.dispose();
      }
    });

    this._registerDisposable(async () => {
      const loop = this._loop;
      this._loop = null;
      if (!loop) return;

      try {
        loop._executeAbortController?.abort?.("disposed");
      } catch {
        // ignore
      }

      try {
        loop._detachEventBusListeners?.();
      } catch {
        // ignore
      }

      if (typeof loop.dispose === "function") {
        await loop.dispose();
      }
    });
  }

  get toolExecutor() {
    return this._toolExecutor;
  }

  set toolExecutor(fn) {
    if (typeof fn !== "function") {
      this._toolExecutor = null;
      return;
    }

    const wrapped = async (name, params, context) => {
      this._ensureNotDisposed();
      return await fn(name, params, context);
    };
    this._toolExecutor = wrapped;
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
    this.eventBus.emit(`${actorPrefix}:agentStarted`, { runId: context.runId || Date.now().toString() });

    try {
      if (!this._loop) {
        const opts = this.options && typeof this.options === "object" ? this.options : {};
        const defaultLoopOptions =
          opts.defaultLoop && typeof opts.defaultLoop === "object" && !Array.isArray(opts.defaultLoop) ? opts.defaultLoop : {};
        const permissionLevel =
          toNonEmptyString(defaultLoopOptions.permissionLevel) || toNonEmptyString(opts.permissionLevel) || null;
        const toolRestrictions = defaultLoopOptions.toolRestrictions ?? opts.toolRestrictions ?? null;

        this._loop = new DefaultAgentLoop({
          actor: this.actor,
          stageName: this.actor,
          eventBus: this.eventBus,
          logger: this.logger,
          toolExecutor: this.toolExecutor,
          capabilities: this.capabilities,
          getCatalogPrompt: () => this.getCapabilityCatalogPrompt(),
          ...defaultLoopOptions,
          ...(permissionLevel ? { permissionLevel } : {}),
          ...(toolRestrictions ? { toolRestrictions } : {}),
        });
      }

      return await this._loop.run(input, context);
    } catch (error) {
      this.eventBus.emit(`${this.actor}:agentFailed`, { error: error.message });
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
    const unsubscribe = this.eventBus.subscribe(pattern, handler);

    if (typeof unsubscribe !== "function") {
      // Defensive: EventBus.subscribe is expected to return an unsubscribe fn.
      return unsubscribe;
    }

    let done = false;
    const safeUnsubscribe = () => {
      if (done) return;
      done = true;
      unsubscribe();
    };

    this._registerDisposable(safeUnsubscribe);
    return safeUnsubscribe;
  }
}

// Enforce that the instance cannot be used after being disposed.
// This wraps all prototype methods and accessors to call `_ensureNotDisposed()`.
function guardDisposablePrototype(prototype) {
  const excluded = new Set([
    "constructor",
    "dispose",
    "_onDispose",
    "_ensureNotDisposed",
    "_registerDisposable",
    "_registerSubscription",
    "_registerTimer",
  ]);

  for (const key of Object.getOwnPropertyNames(prototype)) {
    if (excluded.has(key)) continue;
    const desc = Object.getOwnPropertyDescriptor(prototype, key);
    if (!desc) continue;

    if (typeof desc.value === "function") {
      const original = desc.value;
      Object.defineProperty(prototype, key, {
        ...desc,
        value: function guarded(...args) {
          this._ensureNotDisposed();
          return original.apply(this, args);
        },
      });
      continue;
    }

    const needsGetWrap = typeof desc.get === "function";
    const needsSetWrap = typeof desc.set === "function";
    if (!needsGetWrap && !needsSetWrap) continue;

    const next = { ...desc };
    if (needsGetWrap) {
      const originalGet = desc.get;
      next.get = function guardedGet() {
        this._ensureNotDisposed();
        return originalGet.call(this);
      };
    }
    if (needsSetWrap) {
      const originalSet = desc.set;
      next.set = function guardedSet(value) {
        this._ensureNotDisposed();
        return originalSet.call(this, value);
      };
    }
    Object.defineProperty(prototype, key, next);
  }
}

guardDisposablePrototype(AgentInstance.prototype);

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

    const agent = new AgentInstance({
      core: {
        eventBus,
        logger,
        actor: config.actor,
      },
      capabilities: {
        capabilities,
        toolExecutor,
        mcpConfig: config.mcpConfig,
        subagentRegistry,
      },
      managers: {
        compressor,
        backtrackManager,
        discoveryManager,
      },
      options: config.options,
    });

    for (const { pattern, handler } of config.eventHandlers) {
      agent.on(pattern, /** @type {any} */ (handler));
    }

    if (config.alertMonitorConfig) {
      agent.alertMonitor = new AlertMonitor({
        agent,
        logger,
        ...config.alertMonitorConfig,
      });
    }

    return agent;
  }
}

export default { AgentFactory, AgentInstance };
