/**
 * AgentBuilder - Fluent API facade for building Agent instances.
 *
 * Responsibilities are delegated to:
 * - AgentConfig: config validation + defaults
 * - AgentFactory: wiring + instance construction
 */

import { AgentConfig } from "./agent-config.js";
import { AgentFactory, AgentInstance } from "./agent-factory.js";
import { createLogger } from "../shared/utils/logger.js";

const logger = createLogger("sdk/AgentBuilder");

/**
 * @typedef {import("./agent-config.js").AgentConfigOptions} AgentBuilderOptions
 */

let didWarnUseSkillDeprecated = false;

function warnUseSkillDeprecatedOnce() {
  if (didWarnUseSkillDeprecated) return;
  didWarnUseSkillDeprecated = true;

  logger.warn(
    "useSkill/useSkills are deprecated since 1.0.0 and will be removed in 2.0.0; use useCapability/useCapabilities instead (see docs/DEPRECATIONS.md)."
  );
}

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
   * @param {string} name
   * @param {any} config
   * @returns {AgentBuilder}
   */
  useCapability(name, config) {
    this._config.useCapability(name, config);
    return this;
  }

  /**
   * @param {Object<string, any>} capabilitiesMap
   * @returns {AgentBuilder}
   */
  useCapabilities(capabilitiesMap) {
    this._config.useCapabilities(capabilitiesMap);
    return this;
  }

  /**
   * @deprecated Use useCapability instead
   * @param {string} name
   * @param {any} config
   * @returns {AgentBuilder}
   */
  useSkill(name, config) {
    warnUseSkillDeprecatedOnce();
    return this.useCapability(name, config);
  }

  /**
   * @deprecated Use useCapabilities instead
   * @param {Object<string, any>} skillsMap
   * @returns {AgentBuilder}
   */
  useSkills(skillsMap) {
    warnUseSkillDeprecatedOnce();
    return this.useCapabilities(skillsMap);
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
   * @param {string} pattern
   * @param {Function} handler
   * @returns {AgentBuilder}
   */
  onEvent(pattern, handler) {
    this._config.onEvent(pattern, handler);
    return this;
  }

  /**
   * @param {string} name
   * @returns {AgentBuilder}
   */
  actor(name) {
    this._config.setActor(name);
    return this;
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
