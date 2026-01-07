/**
 * Behavior Fingerprint Plugin
 *
 * 包装现有的 BehaviorFingerprint，检测循环行为
 */

import { createPlugin } from '../../core/plugin.js';

/** @typedef {import('../../core/plugin.js').PluginContext} PluginContext */

/**
 * @typedef {{ action: string, fingerprint: string, timestamp: number }} FingerprintHistoryEntry
 *
 * @typedef {{
 *   fingerprint: string,
 *   similarity: number,
 *   isLoop: boolean,
 *   loopLength: number,
 *   loopInfo: any,
 *   analysis: any,
 *   suggestion: any,
 *   stats: any,
 *   timestamp: number,
 * }} FingerprintAnalysisResult
 */

export default createPlugin({
  name: 'analysis/fingerprint',
  version: '1.0.0',
  description: '行为指纹分析 - 检测重复/循环行为',

  defaultConfig: {
    windowSize: 5,
    similarityThreshold: 0.85,
    maxHistory: 50,
  },

  /**
   * @param {PluginContext} ctx
   * @returns {Promise<void>}
   */
  async install(ctx) {
    const toPlainObject = (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      return value;
    };

    const computeFingerprint = (action) => {
      const obj = toPlainObject(action) || {};
      const type = String(obj.type || (obj.name ? 'tool_call' : '') || 'unknown');
      const name = typeof obj.name === 'string' && obj.name ? obj.name : null;

      const args = toPlainObject(obj.params) || toPlainObject(obj.args) || {};
      const keys = Object.keys(args).sort().join(',');

      return name ? `${type}:${name}:${keys}` : `${type}:${keys}`;
    };

    // 懒加载
    let fingerprinter = null;

    const getFingerprinter = async () => {
      if (!fingerprinter) {
        const { BehaviorFingerprint } = await import('../../runtime/analysis/behavior-fingerprint.js');
        fingerprinter = new BehaviorFingerprint({
          historySize: ctx.config.maxHistory,
          maxPatternLength: ctx.config.windowSize,
        });
      }
      return fingerprinter;
    };

    const history = [];

    // 注册服务
    ctx.registerService('fingerprint', {
      /**
       * @param {any} action
       * @returns {Promise<FingerprintAnalysisResult>}
       */
      async analyze(action) {
        const fp = await getFingerprinter();
        const fingerprint = computeFingerprint(action);
        const recent = history.slice(-Math.max(1, ctx.config.windowSize));
        const similarity = recent.length
          ? recent.filter((h) => h.fingerprint === fingerprint).length / recent.length
          : 0;

        const behavior = fp.recordAction ? fp.recordAction(action || {}) : { loopDetected: false, loopInfo: null };
        const loopLength = behavior?.loopInfo?.pattern?.length || 0;

        const result = {
          fingerprint,
          similarity,
          isLoop: !!behavior?.loopDetected,
          loopLength,
          loopInfo: behavior?.loopInfo || null,
          analysis: fp.getAnalysis?.() || null,
          suggestion: fp.getSuggestion?.() || null,
          stats: fp.stats || null,
          timestamp: Date.now(),
        };

        history.push({
          action: action?.type || action?.name || 'unknown',
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

      /**
       * @returns {FingerprintHistoryEntry[]}
       */
      getHistory: () => [...history],

      /**
       * @returns {void}
       */
      reset() {
        history.length = 0;
        fingerprinter?.reset?.();
        fingerprinter = null;
      },
    });

    // 监听工具调用事件
    ctx.on('tool.call.*', async (evt) => {
      const data = toPlainObject(evt?.payload) || {};
      await ctx.services.call('fingerprint', 'analyze', [{
        type: 'tool_call',
        name: data.name,
        args: data.args,
      }]);
    });

    ctx.log.info('Fingerprint analysis plugin installed');
  },
});
