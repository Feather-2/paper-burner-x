/**
 * Debug Inspector Plugin
 *
 * 运行时检查器，暴露调试 API
 */

import { createPlugin } from '../../core/plugin.js';

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */

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

    const inspector = {
      // 内核信息
      kernel: {
        id: ctx._kernel.id,

        /**
         * @returns {any}
         */
        status: () => ctx._kernel.status,

        /**
         * @returns {any}
         */
        snapshot: () => ctx._kernel.snapshot(),

        /**
         * @returns {Promise<any>}
         */
        healthCheck: () => ctx._kernel.healthCheck(),
      },

      // 事件
      events: {

        /**
         * @param {string} [pattern]
         * @returns {any[]}
         */
        history: (pattern) => ctx.events.getHistory(pattern),

        /**
         * @param {string} event
         * @param {any} [data]
         * @returns {any}
         */
        emit: (event, data) => ctx.events.emit(event, data),

        /**
         * @param {string} pattern
         * @param {number} [timeout]
         * @returns {Promise<{ event: string, data: any }>}
         */
        waitFor: (pattern, timeout) => ctx.events.waitFor(pattern, timeout),
      },

      // 状态
      state: {

        /**
         * @param {string} path
         * @returns {any}
         */
        get: (path) => ctx.state.getGlobal(path),

        /**
         * @param {string} path
         * @param {any} value
         * @returns {void}
         */
        set: (path, value) => ctx.state.set(path, value),

        /**
         * @param {string | null} [id]
         * @returns {string}
         */
        snapshot: (id) => ctx._kernel.state.snapshot(id),

        /**
         * @param {string} id
         * @returns {boolean}
         */
        rollback: (id) => ctx._kernel.state.rollback(id),

        /**
         * @param {number} [limit]
         * @returns {any[]}
         */
        changeLog: (limit) => ctx._kernel.state.getChangeLog(limit),
      },

      // 服务
      services: {

        /**
         * @returns {any[]}
         */
        list: () => ctx.services.list(),

        /**
         * @param {string} name
         * @param {string} method
         * @param {any[]} [args]
         * @returns {Promise<any>}
         */
        call: (name, method, args) => ctx.services.call(name, method, args),

        /**
         * @param {string} [name]
         * @returns {any}
         */
        stats: (name) => ctx.services.getStats(name),
      },

      // 插件
      plugins: {

        /**
         * @returns {any[]}
         */
        list: () => ctx._kernel.getPlugins(),
      },

      // 便捷方法

      /**
       * @returns {void}
       */
      help: () => {
        console.log(`
🔍 Inspector API:

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

    // 注册为服务
    ctx.registerService('inspector', inspector);

    // 可选：暴露到全局
    if (ctx.config.exposeGlobal && typeof globalThis !== 'undefined') {
      globalThis.__kernelInspector = inspector;
      ctx.log.info('Inspector exposed as globalThis.__kernelInspector');
    }

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
