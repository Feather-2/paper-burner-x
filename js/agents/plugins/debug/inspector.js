/**
 * Debug Inspector Plugin
 *
 * 运行时检查器，暴露调试 API
 */

import { createPlugin } from '../../core/plugin.js';
import { createLogger } from "../../shared/utils/logger.js";
const logger = createLogger("agents");

/** @type {typeof globalThis.process} */
const process = globalThis.process;

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */

/**
 * @typedef {Object} KernelStatus
 * @property {string} id - 内核 ID
 * @property {string} phase - 当前阶段
 * @property {number} uptime - 运行时间 (ms)
 */

/**
 * @typedef {Object} KernelSnapshot
 * @property {string} id - 快照 ID
 * @property {number} timestamp - 时间戳
 * @property {Object} state - 状态数据
 */

/**
 * @typedef {Object} HealthCheckResult
 * @property {boolean} healthy - 是否健康
 * @property {string[]} issues - 问题列表
 */

/**
 * @typedef {Object} EventRecord
 * @property {string} name - 事件名
 * @property {unknown} payload - 事件载荷
 * @property {number} timestamp - 时间戳
 */

/**
 * @typedef {Object} WaitForResult
 * @property {string} event - 事件名
 * @property {unknown} data - 事件数据
 */

/**
 * @typedef {Object} StateChangeEntry
 * @property {string} path - 状态路径
 * @property {unknown} oldValue - 旧值
 * @property {unknown} newValue - 新值
 * @property {number} timestamp - 时间戳
 */

/**
 * @typedef {Object} ServiceInfo
 * @property {string} name - 服务名
 * @property {string[]} methods - 方法列表
 */

/**
 * @typedef {Object} ServiceStats
 * @property {number} calls - 调用次数
 * @property {number} errors - 错误次数
 * @property {number} avgTime - 平均耗时 (ms)
 */

/**
 * @typedef {Object} PluginInfo
 * @property {string} name - 插件名
 * @property {string} version - 版本号
 */

/**
 * @typedef {Object} InspectorKernel
 * @property {string} id - 内核 ID
 * @property {() => KernelStatus} status - 获取状态
 * @property {() => KernelSnapshot} snapshot - 导出快照
 * @property {() => Promise<HealthCheckResult>} healthCheck - 健康检查
 */

/**
 * @typedef {Object} InspectorEvents
 * @property {(pattern?: string) => EventRecord[]} history - 事件历史
 * @property {(event: string, data?: unknown) => void} emit - 发射事件
 * @property {(pattern: string, timeout?: number) => Promise<WaitForResult>} waitFor - 等待事件
 */

/**
 * @typedef {Object} InspectorState
 * @property {(path: string) => unknown} get - 获取状态
 * @property {(path: string, value: unknown) => void} set - 设置状态
 * @property {(id?: string | null) => string} snapshot - 创建快照
 * @property {(id: string) => boolean} rollback - 回滚快照
 * @property {(limit?: number) => StateChangeEntry[]} changeLog - 变更日志
 */

/**
 * @typedef {Object} InspectorServices
 * @property {() => ServiceInfo[]} list - 服务列表
 * @property {(name: string, method: string, args?: unknown[]) => Promise<unknown>} call - 调用服务
 * @property {(name?: string) => ServiceStats} stats - 服务统计
 */

/**
 * @typedef {Object} InspectorPlugins
 * @property {() => PluginInfo[]} list - 插件列表
 */

/**
 * @typedef {Object} Inspector
 * @property {InspectorKernel} kernel - 内核检查
 * @property {InspectorEvents} events - 事件检查
 * @property {InspectorState} state - 状态检查
 * @property {InspectorServices} services - 服务检查
 * @property {InspectorPlugins} plugins - 插件检查
 * @property {() => void} help - 输出帮助信息
 */

/**
 * 检查当前是否为开发环境
 * @returns {boolean}
 */
function isDevelopmentEnv() {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV !== 'production';
  }
  if (typeof globalThis !== 'undefined' && globalThis.__DEV__ !== undefined) {
    return !!globalThis.__DEV__;
  }
  return true; // 默认允许（调试插件本就用于开发）
}

/**
 * 构建 inspector 对象
 * @param {PluginContext} ctx
 * @returns {Inspector}
 */
function buildInspector(ctx) {
  return {
    kernel: {
      id: ctx._kernel.id,
      status: () => ctx._kernel.status,
      snapshot: () => ctx._kernel.snapshot(),
      healthCheck: () => ctx._kernel.healthCheck(),
    },

    events: {
      history: (pattern) => ctx.events.getHistory(pattern),
      emit: (event, data) => ctx.events.emit(event, data),
      waitFor: (pattern, timeout) => ctx.events.waitFor(pattern, timeout),
    },

    state: {
      get: (path) => ctx.state.getGlobal(path),
      set: (path, value) => ctx.state.set(path, value),
      snapshot: (id) => ctx._kernel.state.snapshot(id),
      rollback: (id) => ctx._kernel.state.rollback(id),
      changeLog: (limit) => ctx._kernel.state.getChangeLog(limit),
    },

    services: {
      list: () => ctx.services.list(),
      call: (name, method, args) => ctx.services.call(name, method, args),
      stats: (name) => ctx.services.getStats(name),
    },

    plugins: {
      list: () => ctx._kernel.getPlugins(),
    },

    help: () => {
      logger.debug(`
Inspector API:

  inspector.kernel.status()       - 获取内核状态
  inspector.kernel.snapshot()     - 导出完整快照
  inspector.kernel.healthCheck()  - 健康检查

  inspector.events.history()      - 事件历史
  inspector.events.emit(e, d)     - 发射事件

  inspector.state.get(path)       - 获取状态
  inspector.state.changeLog()     - 变更日志
  inspector.state.snapshot(id)    - 创建快照
  inspector.state.rollback(id)    - 回滚快照

  inspector.services.list()       - 服务列表
  inspector.services.call(...)    - 调用服务
  inspector.services.stats()      - 调用统计

  inspector.plugins.list()        - 插件列表
      `);
    },
  };
}

/**
 * 尝试暴露到全局（仅开发环境）
 * @param {PluginContext} ctx
 * @param {Inspector} inspector
 */
function tryExposeGlobal(ctx, inspector) {
  if (!ctx.config.exposeGlobal) return;
  if (typeof globalThis === 'undefined') return;

  if (!isDevelopmentEnv()) {
    ctx.log.warn('exposeGlobal disabled: non-development environment');
    return;
  }

  globalThis.__kernelInspector = inspector;
  ctx.log.info('Inspector exposed as globalThis.__kernelInspector');
}

export default createPlugin({
  name: 'debug/inspector',
  version: '1.0.0',
  description: '运行时检查器 - 调试 API',

  defaultConfig: {
    enabled: true,
    exposeGlobal: false,
  },

  /**
   * @param {PluginContext} ctx
   * @returns {void}
   */
  install(ctx) {
    if (!ctx.config.enabled) return;

    const inspector = buildInspector(ctx);
    ctx.registerService('inspector', inspector);
    tryExposeGlobal(ctx, inspector);
    ctx.log.info('Debug inspector plugin installed');
  },

  /**
   * @param {PluginContext} ctx
   * @returns {void}
   */
  uninstall(ctx) {
    if (typeof globalThis !== 'undefined' && globalThis.__kernelInspector) {
      delete globalThis.__kernelInspector;
    }
  },
});
