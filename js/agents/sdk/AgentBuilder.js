/**
 * AgentBuilder - Fluent API facade for building Agent instances.
 *
 * Responsibilities are delegated to:
 * - AgentConfig: config validation + defaults
 * - AgentFactory: wiring + instance construction
 */

import { AgentConfig } from "./agent-config.js";
import { AgentFactory, AgentInstance } from "./agent-factory.js";

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

export class AgentBuilder {
  constructor(options = {}) {
    this._config = new AgentConfig(options);
    this._factory = new AgentFactory();
  }

  useCapability(name, config) {
    this._config.useCapability(name, config);
    return this;
  }

  useCapabilities(capabilitiesMap) {
    this._config.useCapabilities(capabilitiesMap);
    return this;
  }

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

  useHook(phase, fn) {
    this._config.useHook(phase, fn);
    return this;
  }

  useMcp(config) {
    this._config.useMcp(config);
    return this;
  }

  useCicada(config) {
    this._config.useCicada(config);
    return this;
  }

  useBacktrack(config = {}) {
    this._config.useBacktrack(config);
    return this;
  }

  useWatchdog(config = {}) {
    this._config.useWatchdog(config);
    return this;
  }

  useDiscovery(config = {}) {
    this._config.useDiscovery(config);
    return this;
  }

  useAlertMonitor(config = {}) {
    this._config.useAlertMonitor(config);
    return this;
  }

  onEvent(pattern, handler) {
    this._config.onEvent(pattern, handler);
    return this;
  }

  actor(name) {
    this._config.setActor(name);
    return this;
  }

  useSubagent(type, factory, description = "") {
    this._config.useSubagent(type, factory, description);
    return this;
  }

  build() {
    return this._factory.create(this._config);
  }
}

export { AgentInstance };

export function createAgent(options = {}) {
  return new AgentBuilder(options);
}

export default { createAgent, AgentBuilder, AgentInstance };
