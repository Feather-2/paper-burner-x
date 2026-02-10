/**
 * Core Module - 微内核导出
 *
 * 提供"丰俭由人"的 API 层次：
 * - Level 0: 快捷函数（一行调用）
 * - Level 1: 配置式创建
 * - Level 2: Kernel 完整控制
 * - Level 3: 底层组件访问
 */

// === Level 2 & 3: 完整控制 ===
export { Kernel, KernelStatus } from './kernel.js';
export { KernelCompat } from './kernel-compat.js';
export {
  EventBus,
  RunStoreAdapter,
  createEventRecord,
  isValidEventName,
  matchPattern,
  LamportClock,
} from './event-bus.js';
export { StateBus } from './state-bus.js';
export {
  ServiceBus,
  createRetryProxy,
  createTimeoutProxy,
  createCacheProxy,
} from './service-bus.js';
export { MessageBus } from './message-bus.js';
export {
  createPlugin,
  PluginContext,
  PluginManager,
  PluginStatus,
} from './plugin.js';
export { SecurePluginLoader } from './secure-plugin-loader.js';
export {
  presets,
  resolvePreset,
  mergePresetConfig,
  listPresets,
} from './presets.js';

// === 兼容层 ===
export {
  isServiceProvider,
  adaptProvider,
  adaptProviders,
} from './compat.js';

// === 沙箱 ===
export {
  WasmSandbox,
  createSandbox,
  SandboxPool,
  createSandboxPlugin,
  SkillExecutor,
  createSkillExecutor,
  SandboxCapability,
  SandboxPreset,
  ResourceLimits,
} from './sandbox/index.js';

// === CRDT 共识层 ===
export {
  LWWRegister,
  GCounter,
  PNCounter,
  LWWMap,
  ORSet,
  CRDTDocument,
  CRDTSyncManager,
  createMemoryTransport,
  OpType,
  createOp,
} from './crdt/index.js';

// === Archive (检查点) ===
export { Archive, MapAdapter, FallbackAdapter } from './archive/archive.js';
export { CheckpointType, createCheckpoint, migrateCheckpoint } from './archive/checkpoint-schema.js';

// === Contracts (运行时契约) ===
export {
  validateRpcRequest,
  validateRpcResponse,
  validateLlmResponse,
  validateToolCall,
  validateToolResult,
  normalizeToolResult,
  AgentMessageKind,
  TaskStatus,
  AgentRunStatus,
  validateTaskRequest,
  validateTaskResult,
  validateStatusUpdate,
  validateKnowledgeShare,
  validateAgentMessage,
  createTaskRequest,
  createTaskResult,
  createStatusUpdate,
  createKnowledgeShare,
} from './contracts/index.js';

// === Dependency Injection ===
export {
  Container,
  SINGLETON,
  TRANSIENT,
  createContainer,
  ServiceId,
  createAgentContainer,
  createTestContainer,
} from './di/index.js';

// === Level 0: 快捷函数 ===

import { Kernel } from './kernel.js';

/**
 * 快速创建标准内核
 * @example
 * const kernel = await quickKernel();
 */
export async function quickKernel(preset = 'standard', config = {}) {
  return Kernel.create(preset, config);
}

/**
 * 快速创建最小内核
 * @example
 * const kernel = await minimalKernel();
 */
export async function minimalKernel(config = {}) {
  return Kernel.create('minimal', config);
}

/**
 * 快速创建 DeepSearch 内核
 * @example
 * const kernel = await deepsearchKernel();
 */
export async function deepsearchKernel(config = {}) {
  return Kernel.create('deepsearch', config);
}

/**
 * 快速创建生产内核
 * @example
 * const kernel = await productionKernel();
 */
export async function productionKernel(config = {}) {
  return Kernel.create('production', config);
}

// === Level 1: 配置式 Builder ===

/**
 * Kernel Builder - 链式配置
 * @example
 * const kernel = await KernelBuilder.create()
 *   .withPreset('standard')
 *   .withPlugin('my-plugin', { option: 1 })
 *   .withService('myService', myServiceInstance)
 *   .build();
 */
export class KernelBuilder {
  constructor() {
    this._preset = 'minimal';
    this._plugins = [];
    this._services = [];
    this._factories = [];
    this._config = {};
  }

  static create() {
    return new KernelBuilder();
  }

  /**
   * 使用预设
   */
  withPreset(preset) {
    this._preset = preset;
    return this;
  }

  /**
   * 添加插件
   */
  withPlugin(plugin, config = {}) {
    this._plugins.push({ plugin, config });
    return this;
  }

  /**
   * 批量添加插件
   */
  withPlugins(plugins) {
    for (const p of plugins) {
      if (typeof p === 'string') {
        this._plugins.push({ plugin: p, config: {} });
      } else {
        this._plugins.push(p);
      }
    }
    return this;
  }

  /**
   * 添加服务
   */
  withService(name, service, options = {}) {
    this._services.push({ name, service, options });
    return this;
  }

  /**
   * 添加服务工厂
   */
  withServiceFactory(name, factory, options = {}) {
    this._factories.push({ name, factory, options });
    return this;
  }

  /**
   * 设置配置
   */
  withConfig(config) {
    this._config = { ...this._config, ...config };
    return this;
  }

  /**
   * 构建内核
   */
  async build() {
    const kernel = new Kernel(this._config);

    // 加载预设
    await kernel.usePreset(this._preset, {
      plugins: this._plugins.map(p => typeof p.plugin === 'string' ? p.plugin : p.plugin.name),
      config: Object.fromEntries(
        this._plugins
          .filter(p => Object.keys(p.config).length > 0)
          .map(p => [typeof p.plugin === 'string' ? p.plugin : p.plugin.name, p.config])
      ),
    });

    // 添加自定义插件
    for (const { plugin, config } of this._plugins) {
      if (typeof plugin !== 'string') {
        await kernel.use(plugin, config);
      }
    }

    // 注册服务
    for (const { name, service, options } of this._services) {
      kernel.registerService(name, service, options);
    }

    // 注册服务工厂
    for (const { name, factory, options } of this._factories) {
      kernel.registerServiceFactory(name, factory, options);
    }

    // 启动
    await kernel.start();

    return kernel;
  }
}

// 默认导出 Kernel
export default Kernel;
