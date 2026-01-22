/**
 * Event-driven plugin integration tests
 *
 * Focus:
 * - install lifecycle
 * - service registration
 * - event reaction (EventBus handlers receive evt; data in evt.payload)
 * - scoped state writes (plugins.<pluginName>.*)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Kernel } from '../../../../js/agents/core/index.js';

import cicadaPlugin from '../../../../js/agents/plugins/compression/cicada.js';
import watchdogPlugin from '../../../../js/agents/plugins/compression/watchdog.js';
import fingerprintPlugin from '../../../../js/agents/plugins/analysis/fingerprint.js';
import loggerPlugin from '../../../../js/agents/plugins/debug/logger.js';

vi.mock('../../../../js/agents/runtime/compression/cicada-compressor.js', () => {
  return {
    CicadaCompressor: class CicadaCompressor {
      constructor(config) {
        this._config = config;
      }

      async compress(messages) {
        const list = Array.isArray(messages) ? messages : [];
        const kept = list.slice(0, Math.min(1, list.length));
        return {
          messages: kept,
          ratio: list.length ? kept.length / list.length : 1,
        };
      }
    },
  };
});

async function createKernel() {
  return new Kernel({
    enableRetry: false,
    enableTimeout: false,
  });
}

describe('Event-driven plugins', () => {
  let kernel = null;

  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    if (kernel) {
      await kernel.stop().catch(() => {});
      kernel = null;
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('compression/cicada: install + service + evt.payload handling + scoped state', async () => {
    kernel = await createKernel();
    await kernel.use(cicadaPlugin, { maxContextTokens: 100 });
    await kernel.start();

    expect(kernel.services.has('compression')).toBe(true);

    // Event reaction: token threshold warning should read evt.payload.total
    const warningHandler = vi.fn();
    kernel.events.on('compression.warning', warningHandler);

    kernel.events.emitSync('runtime.tokens.updated', { total: 50 });
    expect(warningHandler).toHaveBeenCalledTimes(0);

    kernel.events.emitSync('runtime.tokens.updated', { total: 95 });
    expect(warningHandler).toHaveBeenCalledTimes(1);
    expect(warningHandler.mock.calls[0][0].payload).toEqual({ current: 95, threshold: 100 });

    // Service: compress() should write scoped state and emit compression.done
    const doneHandler = vi.fn();
    kernel.events.on('compression.done', doneHandler);

    const messages = [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ];

    const result = await kernel.services.call('compression', 'compress', [messages]);
    expect(result.messages).toHaveLength(1);

    expect(kernel.state.get('plugins.compression/cicada.lastCompression.before')).toBe(3);
    expect(kernel.state.get('plugins.compression/cicada.lastCompression.after')).toBe(1);

    expect(doneHandler).toHaveBeenCalledTimes(1);
    expect(doneHandler.mock.calls[0][0].payload).toEqual(expect.objectContaining({
      originalCount: 3,
      compressedCount: 1,
    }));

    // Service: shouldCompress() threshold behavior
    await expect(kernel.services.call('compression', 'shouldCompress', [messages, 79])).resolves.toBe(false);
    await expect(kernel.services.call('compression', 'shouldCompress', [messages, 81])).resolves.toBe(true);

    // Service: getStats() should expose scoped state snapshot
    const stats = await kernel.services.call('compression', 'getStats', []);
    expect(stats.lastCompression).toEqual(expect.objectContaining({ before: 3, after: 1 }));
  });

  it('compression/watchdog: install + service + runtime.tokens.* reaction + scoped state', async () => {
    kernel = await createKernel();
    await kernel.use(cicadaPlugin, { maxContextTokens: 100 });
    await kernel.use(watchdogPlugin, {
      maxContextTokens: 100,
      threshold: 0.5,
      checkInterval: 0,
      autoCompress: true,
    });
    await kernel.start();

    expect(kernel.services.has('watchdog')).toBe(true);

    kernel.state.set('runtime.tokens', { input: 60, output: 0 });
    kernel.state.set('runtime.messages', [{ role: 'user', content: 'hello' }]);

    const exceededPromise = kernel.events.waitFor('watchdog:threshold.exceeded', 500);
    const compressionDonePromise = kernel.events.waitFor('compression.done', 500);

    // Event reaction: watchdog listens to runtime.tokens.* and reads global state
    kernel.events.emitSync('runtime.tokens.updated', { total: 60 });

    const exceeded = await exceededPromise;
    expect(exceeded.event).toBe('watchdog:threshold.exceeded');
    expect(exceeded.data.usage).toBeCloseTo(0.6);

    const done = await compressionDonePromise;
    expect(done.event).toBe('compression.done');

    expect(kernel.state.get('plugins.compression/watchdog.health.status')).toBe('warning');

    const health = await kernel.services.call('watchdog', 'getHealth', []);
    expect(health.status).toBe('warning');
    expect(health.usage).toBeCloseTo(0.6);

    const compressionService = await kernel.services.get('compression');
    const compressSpy = vi.spyOn(compressionService, 'compress');

    // No messages => should not call compression service (but still updates health)
    kernel.state.set('runtime.messages', []);
    await kernel.services.call('watchdog', 'check', []);
    expect(compressSpy).toHaveBeenCalledTimes(0);

    // Compression failure should be caught and logged (no throw)
    compressSpy.mockRejectedValueOnce(new Error('boom'));
    console.error.mockClear();
    kernel.state.set('runtime.messages', [{ role: 'user', content: 'x' }]);
    await expect(kernel.services.call('watchdog', 'check', [])).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it('analysis/fingerprint: install + service + tool.call.* reaction + scoped state', async () => {
    kernel = await createKernel();
    await kernel.use(fingerprintPlugin, {
      windowSize: 3,
      similarityThreshold: 0.5,
      maxHistory: 2,
    });
    await kernel.start();

    expect(kernel.services.has('fingerprint')).toBe(true);

    // Seed one history entry via service call (deterministic ordering)
    await kernel.services.call('fingerprint', 'analyze', [{
      type: 'tool_call',
      name: 'search',
      args: { q: 'x' },
    }]);

    const loopPromise = kernel.events.waitFor('fingerprint.loop.detected', 500);

    // Event reaction: tool.call.* handler should read evt.payload.{name,args}
    kernel.events.emitSync('tool.call.search', { name: 'search', args: { q: 'y' } });

    const loopEvt = await loopPromise;
    expect(loopEvt.event).toBe('fingerprint.loop.detected');
    expect(loopEvt.data.similarity).toBeCloseTo(1);

    expect(kernel.state.get('plugins.analysis/fingerprint.lastAnalysis.fingerprint')).toBe('tool_call:search:q');

    const history = await kernel.services.call('fingerprint', 'getHistory', []);
    expect(history).toHaveLength(2);

    // maxHistory trimming (2)
    await kernel.services.call('fingerprint', 'analyze', [{ type: 'tool_call', name: 't1', args: { a: 1 } }]);
    const trimmed = await kernel.services.call('fingerprint', 'getHistory', []);
    expect(trimmed).toHaveLength(2);

    await kernel.services.call('fingerprint', 'reset', []);
    const resetHistory = await kernel.services.call('fingerprint', 'getHistory', []);
    expect(resetHistory).toHaveLength(0);
  });

  it('debug/logger: install + service + event classification + scoped state', async () => {
    kernel = await createKernel();
    await kernel.use(loggerPlugin, {
      includeTimestamp: false,
      pretty: false,
      level: 'debug',
      maxDataLength: 20,
      maxBuffer: 50,
    });
    await kernel.start();

    expect(kernel.services.has('logger')).toBe(true);
    expect(typeof kernel.state.get('plugins.debug/logger.installedAt')).toBe('number');

    const loggerService = await kernel.services.get('logger');
    loggerService.clearBuffer();
    console.error.mockClear();
    console.warn.mockClear();
    console.info.mockClear();
    console.debug.mockClear();

    kernel.events.emitSync('custom.error', { boom: true });
    kernel.events.emitSync('custom.warning', { warn: true });
    kernel.events.emitSync('kernel.started', { id: 'x' });
    kernel.events.emitSync('random.event', { ok: true });

    expect(console.error).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    expect(console.info).toHaveBeenCalled();
    expect(console.debug).toHaveBeenCalled();

    const buf = loggerService.getBuffer();
    expect(buf.some((e) => e.event === 'custom.error' && e.level === 'error')).toBe(true);
    expect(buf.some((e) => e.event === 'custom.warning' && e.level === 'warn')).toBe(true);
    expect(buf.some((e) => e.event === 'kernel.started' && e.level === 'info')).toBe(true);
    expect(buf.some((e) => e.event === 'random.event' && e.level === 'debug')).toBe(true);

    // State subscription should log state changes too
    kernel.state.set('runtime.test', 1);
    expect(loggerService.getBuffer().some((e) => e.event === 'state.change:runtime.test')).toBe(true);
  });

  it('compression/watchdog: periodic timer setup is cleaned on uninstall', async () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    kernel = await createKernel();
    await kernel.use(cicadaPlugin, { maxContextTokens: 100 });
    await kernel.use(watchdogPlugin, {
      maxContextTokens: 100,
      threshold: 0.5,
      checkInterval: 50,
      autoCompress: false,
    });
    await kernel.start();

    await vi.advanceTimersByTimeAsync(60);
    await Promise.resolve();

    expect(kernel.state.get('plugins.compression/watchdog.health.status')).toBe('healthy');

    await kernel.stop();
    kernel = null;

    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
