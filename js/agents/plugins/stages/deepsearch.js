/**
 * DeepSearch Stage Plugin
 *
 * 将 DeepSearch Stage 包装为插件，接入微内核
 */

import { createPlugin } from '../../core/plugin.js';

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */

export default createPlugin({
  name: 'stage/deepsearch',
  version: '1.0.0',
  description: 'DeepSearch 研究阶段',

  defaultConfig: {
    maxIterations: 50,
    mode: 'auto',
  },

  /**
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  async install(ctx) {
    // 懒加载 DeepSearchAgentLoop
    let AgentLoop = null;
    /** @type {Promise<any>|null} */
    let AgentLoopPromise = null;

    const getAgentLoop = async () => {
      if (!AgentLoop) {
        if (!AgentLoopPromise) {
          AgentLoopPromise = (async () => {
            const mod = await import('../../stages/deepsearch/deepsearch-agent-loop.js');
            AgentLoop = mod.default;
            return AgentLoop;
          })();
          AgentLoopPromise.catch(() => {
            // Allow retries on transient import failures.
            AgentLoopPromise = null;
          });
        }
        return AgentLoopPromise;
      }
      return AgentLoop;
    };

    ctx.registerService('deepsearchStage', {
      /**
       * 运行 DeepSearch
       * @param {any} input
       * @param {Record<string, any>} [options]
       * @returns {Promise<any>}
       */
      async run(input, options = {}) {
        const Loop = await getAgentLoop();

        // 创建 Agent 实例，复用 Kernel 的 EventBus
        const agent = new Loop({
          eventBus: ctx.events,
          mode: options.mode || ctx.config.mode,
          maxIterations: options.maxIterations || ctx.config.maxIterations,
        });

        // 更新状态
        ctx.state.set('status', 'running');
        ctx.state.set('startedAt', Date.now());

        ctx.events.emit('deepsearch:start', { input });

        try {
          // 构建运行上下文
          const runContext = {
            runId: ctx.state.getGlobal('meta.runId'),
            kernel: ctx._kernel,
            ...options.runContext,
          };

          const stageApi = {
            eventBus: ctx.events,
            ...options.stageApi,
          };

          const result = await agent.run(input, { stageApi, runContext });

          ctx.state.set('status', 'completed');
          ctx.state.set('completedAt', Date.now());
          ctx.state.set('result', {
            success: true,
            outputCount: result?.output?.length || 0,
          });

          ctx.events.emit('deepsearch:complete', { result });

          return result;
        } catch (error) {
          ctx.state.set('status', 'failed');
          ctx.state.set('error', error.message);

          ctx.events.emit('deepsearch:error', { error });

          throw error;
        }
      },

      /**
       * 获取状态
       * @returns {Record<string, any>}
       */
      getStatus() {
        return ctx.state.get('') || { status: 'idle' };
      },
    });

    ctx.log.info('DeepSearch stage plugin installed');
  },
});
