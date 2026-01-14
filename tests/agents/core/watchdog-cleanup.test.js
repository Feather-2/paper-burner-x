import { describe, it, expect, vi, afterEach } from 'vitest';
import { Kernel, PluginContext } from '../../../js/agents/core/index.js';
import watchdogPlugin from '../../../js/agents/plugins/compression/watchdog.js';

describe('compression/watchdog cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should clear interval and unsubscribe during uninstall (no ctx.cleanup)', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const kernel = new Kernel({ enableRetry: false, enableTimeout: false });
    const ctx = new PluginContext(kernel, watchdogPlugin, {
      maxContextTokens: 100,
      threshold: 0.5,
      checkInterval: 50,
      autoCompress: false,
    });

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const offSpy = vi.spyOn(kernel.events, 'off');

    await watchdogPlugin.install(ctx);

    expect(ctx._watchdogInterval).toBeTruthy();
    expect(typeof ctx._watchdogCleanup).toBe('function');

    await watchdogPlugin.uninstall(ctx);

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(offSpy.mock.calls.some(([name]) => name === 'runtime.tokens.*')).toBe(true);
    expect(ctx._watchdogInterval).toBeNull();
    expect(ctx._watchdogCleanup).toBeNull();

    // Keep tests isolated (service registry / subscriptions)
    ctx.cleanup();
  });
});

