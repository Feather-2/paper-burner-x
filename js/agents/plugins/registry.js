/**
 * Plugin Registry - 插件映射表
 *
 * 集中管理所有内置插件的路径映射，支持自动发现和扩展
 */

/**
 * 默认插件注册表
 * @type {Record<string, () => Promise<any>>}
 */
export const defaultPluginRegistry = {
  // Compression
  'compression/cicada': () => import('./compression/cicada.js'),
  'compression/watchdog': () => import('./compression/watchdog.js'),

  // Analysis
  'analysis/fingerprint': () => import('./analysis/fingerprint.js'),
  'analysis/convergence': () => import('./analysis/convergence-detector.js'),
  'analysis/behavior': () => import('./analysis/behavior-fingerprint.js'),

  // Telemetry
  'telemetry/token-tracker': () => import('./telemetry/token-tracker.js'),
  'telemetry/trace': () => import('./telemetry/trace-context.js'),
  'telemetry/replay': () => import('./telemetry/replay-controller.js'),

  // Memory
  'memory/store': () => import('./memory/memory-store.impl.core.js'),
  'memory/state-engine': () => import('./memory/state-engine.js'),
  'memory/retrieval': () => import('./memory/retrieval-engine.js'),

  // Coordination
  'coordination/tab': () => import('./coordination/tab-coordinator.js'),
  'coordination/process': () => import('./coordination/process-coordinator.js'),

  // Checkpoints
  'checkpoints/store': () => import('./checkpoints/agent-checkpoint-store.js'),

  // Deps (Python)
  'deps/python': () => import('./deps/index.js'),

  // Plan
  'plan/store': () => import('./plan/plan-store.js'),
  'plan/structured': () => import('./plan/structured-plan.js'),

  // Policy
  'policy/engine': () => import('./policy/engine.js'),
  'policy/manager': () => import('./policy/manager.js'),

  // Routing
  'routing/performance': () => import('../llm/performance-router.js'),

  // Transports
  'transports/process': () => import('./transports/index.js'),

  // Side Effects
  'side-effects/journal': () => import('./side-effects/side-effect-journal.js'),

  // Resilience
  'resilience/retry': () => import('./resilience/retry.js'),
  'resilience/level': () => import('./resilience/degradation-matrix.js'),

  // Stages
  'stage/deepsearch': () => import('./stages/deepsearch.js'),

  // Services
  'service/llm': () => import('./services/llm.js'),
  'service/mcp': () => import('./services/mcp.js'),
  'service/scheduler': () => import('./services/scheduler.js'),
  'service/vfs': () => import('./services/vfs.js'),

  // Sandbox
  'sandbox': () => import('../core/sandbox/plugin.js'),

  // Debug
  'debug/logger': () => import('./debug/logger.js'),
  'debug/inspector': () => import('./debug/inspector.js'),
};
