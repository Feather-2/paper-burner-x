/**
 * DeepSearch Capabilities Loader (dynamic DI)
 *
 * This module centralizes optional/dynamic imports so the agent loop can receive
 * preloaded capabilities via constructor injection.
 */

import { createLogger } from "../../shared/index.js";

const logger = createLogger("stages/deepsearch/capabilities-loader");

/** @type {DeepSearchCapabilities|null} */
let _cached = null;
/** @type {Promise<DeepSearchCapabilities>|null} */
let _loading = null;

/**
 * @typedef {object} DeepSearchCapabilities
 * @property {any} [SkillsManager]
 * @property {any} [BudgetManager]
 * @property {any} [CheckpointManager]
 * @property {any} [SharedContext]
 * @property {any} [BacktrackManager]
 * @property {any} [DiscoveryManager]
 * @property {any} [MemoryStore]
 * @property {any} [UnifiedAgentContext]
 */

/**
 * @param {string} name
 * @param {Error|any} err
 */
function warn(name, err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.warn(`[deepsearch] Failed to load ${name}: ${msg}`);
}

/**
 * Load DeepSearch capabilities asynchronously
 * @returns {Promise<DeepSearchCapabilities>}
 */
export async function loadDeepSearchCapabilities(options = {}) {
  if (options?.forceReload === true) {
    resetDeepSearchCapabilitiesCache();
  }

  if (_cached) return _cached;
  if (_loading) return _loading;

  _loading = (async () => {
    const capabilities = {
      SkillsManager: null,
      BudgetManager: null,
      CheckpointManager: null,
      SharedContext: null,
      BacktrackManager: null,
      DiscoveryManager: null,
      MemoryStore: null,
      UnifiedAgentContext: null,
    };

    try {
      const skills = await import("../../skills/index.js");
      capabilities.SkillsManager = skills.SkillsManager || skills.default;
    } catch (err) {
      warn("skills system", err);
    }

    try {
      const budget = /** @type {(typeof import("../../shared/utils/budget.js")) & { default?: unknown }} */ (await import("../../shared/utils/budget.js"));
      capabilities.BudgetManager = budget.BudgetManager || budget.default;
    } catch (err) {
      warn("BudgetManager", err);
    }

    try {
      const checkpoint = await import("./internal/checkpoint.js");
      capabilities.CheckpointManager = checkpoint.CheckpointManager || checkpoint.default;
    } catch (err) {
      warn("CheckpointManager", err);
    }

    try {
      const shared = await import("./internal/shared-context.js");
      capabilities.SharedContext = shared.SharedContext || shared.default;
    } catch (err) {
      warn("SharedContext", err);
    }

    try {
      const backtrack = /** @type {(typeof import("./internal/backtrack-manager.js")) & { default?: unknown }} */ (await import("./internal/backtrack-manager.js"));
      capabilities.BacktrackManager = backtrack.BacktrackManager || backtrack.default;
    } catch (err) {
      warn("BacktrackManager", err);
    }

    try {
      const discovery = await import("../../sdk/DiscoveryManager.js");
      capabilities.DiscoveryManager = discovery.DiscoveryManager || discovery.default;
    } catch (err) {
      warn("DiscoveryManager", err);
    }

    try {
      const memory = await import("../../plugins/memory/memory-store.impl.core.js");
      capabilities.MemoryStore = memory.MemoryStore || memory.default;
    } catch (err) {
      warn("MemoryStore", err);
    }

    try {
      const unified = await import("../../runtime/core/context/unified-agent-context.js");
      capabilities.UnifiedAgentContext = unified.UnifiedAgentContext || unified.default;
    } catch (err) {
      warn("UnifiedAgentContext", err);
    }

    return capabilities;
  })();

  try {
    _cached = await _loading;
    return _cached;
  } finally {
    _loading = null;
  }
}

/**
 * Reset cached DeepSearch capabilities.
 * Useful for tests, HMR and capability hot-reload scenarios.
 * @returns {void}
 */
export function resetDeepSearchCapabilitiesCache() {
  _cached = null;
  _loading = null;
}
