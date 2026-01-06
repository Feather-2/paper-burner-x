/**
 * Sandbox Plugin - 将沙箱集成到 Kernel
 *
 * 提供 sandbox 服务，供 Skills 系统使用。
 */

import { createPlugin } from '../plugin.js';
import { SandboxPool } from './pool.js';
import { SandboxPreset, ResourceLimits, SandboxCapability } from './index.js';

/**
 * 创建沙箱插件
 */
export function createSandboxPlugin(options = {}) {
  return createPlugin({
    name: 'sandbox',
    version: '1.0.0',
    description: 'WASM sandbox for secure code execution',

    async install(ctx) {
      const pool = new SandboxPool({
        maxSize: options.poolSize || 4,
        idleTimeoutMs: options.idleTimeoutMs || 60000,
        defaultCapabilities: options.defaultCapabilities || SandboxPreset.SKILL,
        defaultLimits: options.defaultLimits || ResourceLimits.STANDARD,
      });

      // 注册服务
      ctx.services.register('sandbox', {
        /**
         * 执行代码
         * @param {string} code
         * @param {Object} options
         */
        async execute(code, options = {}) {
          return pool.withSandbox(
            {
              capabilities: options.capabilities,
              limits: options.limits,
              state: options.state,
              onLog: (level, args) => {
                ctx.events.emit('sandbox:log', { level, args });
              },
              onEmit: (name, payload) => {
                ctx.events.emit(`sandbox:emit:${name}`, payload);
              },
            },
            async sandbox => {
              return options.async
                ? sandbox.executeAsync(code, options.context)
                : sandbox.execute(code, options.context);
            }
          );
        },

        /**
         * 执行 Skill
         */
        async executeSkill(skillBody, context = {}) {
          const capabilities = context.trusted
            ? SandboxPreset.TRUSTED
            : SandboxPreset.SKILL;

          const limits = context.heavy
            ? ResourceLimits.HEAVY
            : ResourceLimits.STANDARD;

          return this.execute(skillBody, {
            capabilities,
            limits,
            state: context.state,
            context: context.args,
            async: true,
          });
        },

        /**
         * 获取池状态
         */
        getStats() {
          return pool.getStats();
        },

        /**
         * 清空池
         */
        clear() {
          pool.clear();
        },
      });

      // 保存池引用，用于清理
      ctx.set('sandbox:pool', pool);
    },

    async onStop(ctx) {
      const pool = ctx.get('sandbox:pool');
      if (pool) {
        pool.dispose();
      }
    },

    // 导出常量供外部使用
    exports: {
      SandboxCapability,
      SandboxPreset,
      ResourceLimits,
    },
  });
}

export default createSandboxPlugin;
