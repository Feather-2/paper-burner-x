/**
 * AgentBuilder - Fluent API facade for building Agent instances.
 *
 * Responsibilities are delegated to:
 * - AgentConfig: config validation + defaults
 * - AgentFactory: wiring + instance construction
 */

import { AgentConfig } from "./agent-config.js";
import { AgentFactory, AgentInstance } from "./agent-factory.js";
import { createLogger } from "../shared/index.js";

const logger = createLogger("sdk/AgentBuilder");

/**
 * @typedef {import("./agent-config.js").AgentConfigOptions} AgentBuilderOptions
 */
/**
 * @typedef {import("./CapabilityInterface").CapabilityDefinition} CapabilityDefinition
 * @typedef {import("./CapabilityInterface").CapabilityHandler} CapabilityHandler
 * @typedef {CapabilityHandler | { definition: CapabilityDefinition, handler?: CapabilityHandler, module?: string, _module?: string }} CapabilityConfig
 */

/**
 * Fluent builder for creating {@link AgentInstance}.
 * @param {AgentBuilderOptions} [options]
 * @returns {AgentBuilder}
 */
export class AgentBuilder {
  /**
   * @param {AgentBuilderOptions} [options]
   */
  constructor(options = {}) {
    this._config = new AgentConfig(options);
    this._factory = new AgentFactory();
  }

  /**
   * Register a capability (tool).
   * @param {string} name - Capability name.
   * @param {CapabilityConfig} config - Capability handler or config object.
   * @returns {AgentBuilder}
   */
  useCapability(name, config) {
    this._config.useCapability(name, config);
    return this;
  }

  /**
   * @param {Object<string, CapabilityConfig>} capabilitiesMap
   * @returns {AgentBuilder}
   */
  useCapabilities(capabilitiesMap) {
    this._config.useCapabilities(capabilitiesMap);
    return this;
  }

  /**
   * @param {"before"|"after"} phase
   * @param {Function} fn
   * @returns {AgentBuilder}
   */
  useHook(phase, fn) {
    this._config.useHook(phase, fn);
    return this;
  }

  /**
   * @param {Object|null} config
   * @returns {AgentBuilder}
   */
  useMcp(config) {
    this._config.useMcp(config);
    return this;
  }

  /**
   * @param {Object|null} config
   * @returns {AgentBuilder}
   */
  useCicada(config) {
    this._config.useCicada(config);
    return this;
  }

  /**
   * @param {Object} [config]
   * @returns {AgentBuilder}
   */
  useBacktrack(config = {}) {
    this._config.useBacktrack(config);
    return this;
  }

  /**
   * @param {Object} [config]
   * @returns {AgentBuilder}
   */
  useWatchdog(config = {}) {
    this._config.useWatchdog(config);
    return this;
  }

  /**
   * @param {Object} [config]
   * @returns {AgentBuilder}
   */
  useDiscovery(config = {}) {
    this._config.useDiscovery(config);
    return this;
  }

  /**
   * @param {Object} [config]
   * @returns {AgentBuilder}
   */
  useAlertMonitor(config = {}) {
    this._config.useAlertMonitor(config);
    return this;
  }

  /**
   * Subscribe to an event pattern.
   * @param {string} pattern
   * @param {Function} handler
   * @returns {AgentBuilder}
   */
  useEvent(pattern, handler) {
    this._config.onEvent(pattern, handler);
    return this;
  }

  /**
   * @deprecated Use {@link useEvent} instead.
   * @param {string} pattern
   * @param {Function} handler
   * @returns {AgentBuilder}
   */
  onEvent(pattern, handler) {
    return this.useEvent(pattern, handler);
  }

  /**
   * Set the actor (identity) name for this agent.
   * @param {string} name
   * @returns {AgentBuilder}
   */
  useActor(name) {
    this._config.setActor(name);
    return this;
  }

  /**
   * @deprecated Use {@link useActor} instead.
   * @param {string} name
   * @returns {AgentBuilder}
   */
  actor(name) {
    return this.useActor(name);
  }

  /**
   * @param {string} type
   * @param {Function} factory
   * @param {string} [description]
   * @returns {AgentBuilder}
   */
  useSubagent(type, factory, description = "") {
    this._config.useSubagent(type, factory, description);
    return this;
  }

  /**
   * @returns {AgentInstance}
   */
  build() {
    return this._factory.create(this._config);
  }
}

export { AgentInstance };

/**
 * Convenience factory for {@link AgentBuilder}.
 * @param {AgentBuilderOptions} [options]
 * @returns {AgentBuilder}
 */
export function createAgent(options = {}) {
  return new AgentBuilder(options);
}

export default { createAgent, AgentBuilder, AgentInstance };
