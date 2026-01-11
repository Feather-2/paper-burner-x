/**
 * Sandbox Plugin - 将沙箱集成到 Kernel
 *
 * 提供 sandbox 服务，供 Skills 系统使用。
 */

import { createPlugin } from '../plugin.js';
import { SandboxPool } from './pool.js';
import { SandboxPreset, ResourceLimits } from './constants.js';

const SANDBOX_POOL = Symbol('sandboxPool');

/**
 * 创建沙箱插件
 */
export function createSandboxPlugin(options = {}) {
  const defaultConfig = {
    poolSize: 4,
    idleTimeoutMs: 60000,
    defaultCapabilities: SandboxPreset.SKILL,
    defaultLimits: ResourceLimits.STANDARD,
    ...options,
  };

  return createPlugin({
    name: 'sandbox',
    version: '1.0.0',
    description: 'WASM sandbox for secure code execution',
    defaultConfig,

    async install(ctx) {
      const pool = new SandboxPool({
        maxSize: ctx.config.poolSize,
        idleTimeoutMs: ctx.config.idleTimeoutMs,
        defaultCapabilities: ctx.config.defaultCapabilities,
        defaultLimits: ctx.config.defaultLimits,
      });

      // 注册服务
      ctx.registerService('sandbox', {
        /**
         * 执行代码
         * @param {string} code
         * @param {Object} options
         */
        async execute(code, execOptions = {}) {
          return pool.withSandbox(
            {
              capabilities: execOptions.capabilities,
              limits: execOptions.limits,
              state: execOptions.state,
              onLog: (level, args) => {
                ctx.events.emit('sandbox:log', { level, args });
              },
              onEmit: (name, payload) => {
                ctx.events.emit(`sandbox:emit:${name}`, payload);
              },
            },
            async sandbox => {
              return execOptions.async
                ? sandbox.executeAsync(code, execOptions.context)
                : sandbox.execute(code, execOptions.context);
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

      ctx[SANDBOX_POOL] = pool;
    },

    async uninstall(ctx) {
      const pool = ctx[SANDBOX_POOL];
      if (pool) pool.dispose();
      ctx[SANDBOX_POOL] = null;
    },
  });
}

const defaultSandboxPlugin = createSandboxPlugin();

export default defaultSandboxPlugin;
