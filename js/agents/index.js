/**
 * js/agents - 统一入口
 *
 * 提供三层 API：
 * 1. 新架构 (推荐): Kernel + Plugins
 * 2. 兼容层: 旧 MicroKernel API (逐步废弃)
 * 3. 业务层: Stages, Skills, SDK
 */

// ============================================================
// 新架构 - 微内核 (推荐)
// ============================================================

export {
  // Kernel
  Kernel,
  KernelStatus,
  KernelBuilder,

  // 四大总线
  EventBus,
  StateBus,
  ServiceBus,
  MessageBus,

  // 插件系统
  createPlugin,
  PluginContext,
  PluginManager,
  PluginStatus,

  // 预设
  presets,
  resolvePreset,
  mergePresetConfig,
  listPresets,

  // 代理
  createRetryProxy,
  createTimeoutProxy,
  createCacheProxy,

  // 快捷函数
  quickKernel,
  minimalKernel,
  deepsearchKernel,
  productionKernel,

  // 兼容
  isServiceProvider,
  adaptProvider,
  adaptProviders,
} from './core/index.js';

// ============================================================
// 兼容层 - 旧 MicroKernel (逐步废弃)
// ============================================================

// 重新导出旧 API，但标记为 deprecated
// MicroKernel/ServiceProvider 已移除 (2.0.0)
// 请使用 core 模块: import { Kernel, createPlugin } from 'js/agents/core';

// ============================================================
// Runtime - 核心运行时组件
// ============================================================

export {
  // Agent Loop
  BaseAgentLoop,
  AgentStatus,
  StepStatus,

  // Orchestrator
  AgentOrchestrator,
  SchedulingMode,
  TaskGraph,

  // Events
  EventBus as RuntimeEventBus,
  RuntimeEvents,
  WatchdogEvents,
  CicadaEvents,

  // Tools
  ToolRegistry,
  ToolExecutor,
  createToolExecutor,

  // DI (兼容)
  Container,
  createContainer,
  ServiceId,

  // Hooks / Safety
  HookRegistry,
  HookType,
  enhanceEventBusWithHooks,
  createPreToolUseHook,
  classifyCommand,
  parseCompoundCommand,
} from './runtime/index.js';

// ============================================================
// Compression - 压缩组件
// ============================================================

export {
  Watchdog,
  CicadaCompressor,
  CompressionCoordinator,
  ProactiveCompressor,
  CompressionQualityMonitor,
} from './plugins/compression/index.js';

// ============================================================
// Telemetry - 遥测组件
// ============================================================

export {
  TokenTracker,
  TraceContext,
  SpanKind,
  SpanStatus,
} from './plugins/telemetry/index.js';

// ============================================================
// Stages - 业务阶段
// ============================================================

export {
  DeepSearchAgentLoop,
  DeepSearchState,
  runDeepSearchAgent,
  runDeepSearchStage,
} from './stages/deepsearch/index.js';

// ============================================================
// SDK - 高层 API
// ============================================================

export { AgentBuilder, createAgent, createAgentBuilder } from './sdk/AgentBuilder.js';

// ============================================================
// Shared - 工具库
// ============================================================

export {
  Archive,
  createBudgetManager,
  robustParseJson,
  createLogger,
  safeExec,
  CircuitBreaker,
  getCircuitBreaker,
} from './shared/index.js';

// ============================================================
// VFS - 虚拟文件系统
// ============================================================

export {
  createVfs,
  MemoryVfs,
  OpfsVfs,
  StorageVfs,
} from './vfs/index.js';

// ============================================================
// Skills - 技能系统
// ============================================================

export {
  SkillsManager,
  loadSkills,
  loadAllSkills,
  renderSkillsSection,
} from './skills/index.js';

// ============================================================
// 默认导出 - 新 Kernel
// ============================================================

export { default } from './core/index.js';
