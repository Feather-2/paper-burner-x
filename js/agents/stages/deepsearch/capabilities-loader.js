/**
 * DeepSearch Capabilities Loader (dynamic DI)
 *
 * This module centralizes optional/dynamic imports so the agent loop can receive
 * preloaded capabilities via constructor injection.
 */

import { createLogger } from "../../shared/utils/logger.js";

const logger = createLogger("stages/deepsearch/capabilities-loader");

let _cached = null;
let _loading = null;

function warn(name, err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.warn(`[deepsearch] Failed to load ${name}: ${msg}`);
}

export async function loadDeepSearchCapabilities() {
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
      const budget = await import("../../shared/utils/budget.js");
      capabilities.BudgetManager = budget.BudgetManager || budget.default;
    } catch (err) {
      warn("BudgetManager", err);
    }

    try {
      const checkpoint = await import("./runtime/checkpoint.js");
      capabilities.CheckpointManager = checkpoint.CheckpointManager || checkpoint.default;
    } catch (err) {
      warn("CheckpointManager", err);
    }

    try {
      const shared = await import("./runtime/shared-context.js");
      capabilities.SharedContext = shared.SharedContext || shared.default;
    } catch (err) {
      warn("SharedContext", err);
    }

    try {
      const backtrack = await import("./runtime/backtrack-manager.js");
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
      const memory = await import("../../runtime/memory/memory-store.js");
      capabilities.MemoryStore = memory.MemoryStore || memory.default;
    } catch (err) {
      warn("MemoryStore", err);
    }

    try {
      const unified = await import("../../runtime/context/unified-agent-context.js");
      capabilities.UnifiedAgentContext = unified.UnifiedAgentContext || unified.default;
    } catch (err) {
      warn("UnifiedAgentContext", err);
    }

    return capabilities;
  })();

  _cached = await _loading;
  _loading = null;
  return _cached;
}
