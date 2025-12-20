/**
 * Runtime Layer - Agent Loop Infrastructure
 *
 * Core components for the Agent Loop + Pipeline hybrid architecture.
 */

// Core infrastructure
export { EventBus } from "./event-bus.js";
export { createStateMachine } from "./state-machine.js";
export { Orchestrator } from "./orchestrator.js";
export { RunContext, createRunContext } from "./run-context.js";
export { BaseAgentLoop } from "./agent-loop.js";
export { RequirementAnalyzer, ComplexityLevel } from "./requirement-analyzer.js";
export { CapabilityLoader } from "./capability-loader.js";

// Agent Loop infrastructure (Phase 0)
export { BlockRegistry } from "./block-registry.js";
export { createBlockExecutor } from "./block-executor.js";
export { BlockDAGExecutor } from "./block-dag-executor.js";
export { RouterAgent, ComplexityTier, ModelTier } from "./router-agent.js";
export { stateMachineRegistry } from "./state-machine-registry.js";
export { Watchdog, DelegationMode } from "./watchdog.js";
export { CicadaCompressor, CompressionLayer } from "./cicada-compressor.js";

// Skills system (Phase 1)
export { SkillRegistry, SkillStatus, getSkillRegistry } from "./skill-registry.js";
export { SkillLoader } from "./skill-loader.js";
export { loadFromFS, loadSupportFiles, parseFrontMatter } from "./skill-fs-loader.js";
export {
  keywordMatcher,
  tagMatcher,
  traitMatcher,
  phaseMatcher,
  budgetMatcher,
  combinedMatcher,
  matchSkills,
} from "./skill-matchers.js";

// MCP-Nexus integration
export { NexusSkillProvider } from "../mcp/nexus-skill-provider.js";

// Events
export {
  RuntimeEvents,
  PhaseEvents,
  RouterEvents,
  WatchdogEvents,
  CicadaEvents,
} from "./events.js";

// Constants
export { RuntimeConstants } from "./constants.js";
