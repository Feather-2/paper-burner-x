/**
 * Behavior Fingerprint Plugin
 *
 * 包装现有的 BehaviorFingerprint，检测循环行为
 */

import { createPlugin } from '../../core/plugin.js';

export default createPlugin({
  name: 'analysis/fingerprint',
  version: '1.0.0',
  description: '行为指纹分析 - 检测重复/循环行为',

  defaultConfig: {
    windowSize: 5,
    similarityThreshold: 0.85,
    maxHistory: 50,
  },

  async install(ctx) {
    // 懒加载
    let fingerprinter = null;

    const getFingerprinter = async () => {
      if (!fingerprinter) {
        const { BehaviorFingerprint } = await import('../../runtime/analysis/behavior-fingerprint.js');
        fingerprinter = new BehaviorFingerprint(ctx.config);
      }
      return fingerprinter;
    };

    const history = [];

    // 注册服务
    ctx.registerService('fingerprint', {
      async analyze(action) {
        const fp = await getFingerprinter();
        const result = fp.analyze(action);

        history.push({
          action: action.type || action.name,
          fingerprint: result.fingerprint,
          timestamp: Date.now(),
        });

        if (history.length > ctx.config.maxHistory) {
          history.shift();
        }

        ctx.state.set('lastAnalysis', result);

        if (result.isLoop || result.similarity > ctx.config.similarityThreshold) {
          ctx.events.emit('fingerprint.loop.detected', {
            action,
            similarity: result.similarity,
            loopLength: result.loopLength,
          });
        }

        return result;
      },

      getHistory: () => [...history],

      reset() {
        history.length = 0;
        fingerprinter = null;
      },
    });

    // 监听工具调用事件
    ctx.on('tool.call.*', async (data) => {
      await ctx.services.call('fingerprint', 'analyze', [{
        type: 'tool_call',
        name: data.name,
        args: data.args,
      }]);
    });

    ctx.log.info('Fingerprint analysis plugin installed');
  },
});
