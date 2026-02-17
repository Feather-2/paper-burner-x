/**
 * AgentConfig - validated configuration for AgentBuilder.
 *
 * Responsibilities:
 * - Hold builder state
 * - Validate inputs
 * - Apply defaults
 */

import { SubagentRegistry } from "./SubagentRegistry.js";
import { createLogger } from "../shared/index.js";

const logger = createLogger("sdk/agent-config");

/**
 * @typedef {object} AgentConfigOptions
 * @property {string} [actor]
 * @property {string} [permissionLevel]
 * @property {any} [toolRestrictions]
 */

export class AgentConfig {
  /**
   * @param {AgentConfigOptions} [options]
   */
  constructor(options = {}) {
    /** @type {AgentConfigOptions} */
    const opts = options && typeof options === "object" ? options : {};

    /** @type {Map<string, any>} */
    this.capabilities = new Map();

    /** @type {{before: Function[], after: Function[]}} */
    this.hooks = { before: [], after: [] };

    /** @type {Object|null} */
    this.mcpConfig = null;

    /** @type {Array<{pattern: string, handler: Function}>} */
    this.eventHandlers = [];

    /** @type {Object} */
    this.options = opts;

    /** @type {string} */
    this.actor = opts.actor || "agent";

    /** @type {SubagentRegistry} */
    this.subagentRegistry = new SubagentRegistry();

    /** @type {Object|null} */
    this.cicadaConfig = null;

    /** @type {Object|null} */
    this.backtrackConfig = null;

    /** @type {Object|null} */
    this.watchdogConfig = null;

    /** @type {Object|null} */
    this.discoveryConfig = null;

    /** @type {Object|null} */
    this.alertMonitorConfig = null;
  }

  /**
   * Register a capability (tool).
   * @param {string} name
   * @param {any} config
   * @returns {AgentConfig}
   */
  useCapability(name, config) {
    const exists = this.capabilities.has(name);
    if (exists) {
      logger.warn(`[AgentBuilder] Capability "${name}" is being overwritten.`);
    }

    if (typeof config === "function") {
      this.capabilities.set(name, {
        definition: { name, description: `Capability: ${name}`, lazy: false },
        handler: config,
      });
      return this;
    }

    if (config && typeof config === "object" && config.definition) {
      const capability = {
        definition: { ...config.definition, lazy: config.definition.lazy !== false },
        handler: config.handler || null,
        _module: config.module || config._module || null,
      };
      this.capabilities.set(name, capability);
      return this;
    }

    throw new Error(`Invalid capability config for "${name}"`);
  }

  /**
   * Batch register capabilities.
   * @param {Object<string, any>} capabilitiesMap
   * @returns {AgentConfig}
   */
  useCapabilities(capabilitiesMap) {
    for (const [name, config] of Object.entries(capabilitiesMap || {})) {
      this.useCapability(name, config);
    }
    return this;
  }

  /**
   * Register a hook.
   * @param {"before"|"after"} phase
   * @param {Function} fn
   * @returns {AgentConfig}
   */
  useHook(phase, fn) {
    if (phase !== "before" && phase !== "after") {
      throw new Error(`Invalid hook phase: ${phase}`);
    }
    if (typeof fn !== "function") {
      throw new Error("Hook must be a function");
    }
    this.hooks[phase].push(fn);
    return this;
  }

  /**
   * @param {string} field - config field name (e.g. 'mcpConfig')
   * @param {string} label - human-readable label for error messages
   * @param {Object|null} [config]
   * @returns {AgentConfig}
   */
  _useConfig(field, label, config) {
    if (config === null || config === undefined) {
      this[field] = null;
      return this;
    }
    if (typeof config !== "object") {
      throw new Error(`${label} config must be an object`);
    }
    this[field] = config;
    return this;
  }

  /** @param {Object|null} config  @returns {AgentConfig} */
  useMcp(config) { return this._useConfig("mcpConfig", "MCP", config); }
  /** @param {Object|null} config  @returns {AgentConfig} */
  useCicada(config) { return this._useConfig("cicadaConfig", "Cicada", config); }
  /** @param {Object} [config]  @returns {AgentConfig} */
  useBacktrack(config = {}) { return this._useConfig("backtrackConfig", "Backtrack", config); }
  /** @param {Object} [config]  @returns {AgentConfig} */
  useWatchdog(config = {}) { return this._useConfig("watchdogConfig", "Watchdog", config); }
  /** @param {Object} [config]  @returns {AgentConfig} */
  useDiscovery(config = {}) { return this._useConfig("discoveryConfig", "Discovery", config); }
  /** @param {Object} [config]  @returns {AgentConfig} */
  useAlertMonitor(config = {}) { return this._useConfig("alertMonitorConfig", "AlertMonitor", config); }

  /**
   * Subscribe event handler (pattern supported).
   * @param {string} pattern
   * @param {Function} handler
   * @returns {AgentConfig}
   */
  onEvent(pattern, handler) {
    this.eventHandlers.push({ pattern, handler });
    return this;
  }

  /**
   * Set actor name.
   * @param {string} name
   * @returns {AgentConfig}
   */
  setActor(name) {
    this.actor = name;
    return this;
  }

  /**
   * Register a subagent type.
   * @param {string} type
   * @param {Function} factory
   * @param {string} [description]
   * @returns {AgentConfig}
   */
  useSubagent(type, factory, description = "") {
    this.subagentRegistry.register(type, factory, description);
    return this;
  }
}

export default AgentConfig;
