import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PerformanceHelpers } from '../../js/utils/performance-helpers.js';

const ORIGINALS = {
  document: globalThis.document,
};

describe('js/utils/performance-helpers.js (extra cases)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    globalThis.document = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();

    if (ORIGINALS.document === undefined) delete globalThis.document;
    else globalThis.document = ORIGINALS.document;
  });

  it('createPoller respects pauseWhenHidden, pause/resume, and cleans up listeners', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const checkFn = vi.fn(() => {
      throw new Error('boom');
    });

    const poller = PerformanceHelpers.createPoller(checkFn, 100, { pauseWhenHidden: true });
    expect(document.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    poller.start();
    expect(checkFn).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('[Poller] Error in check function:', expect.any(Error));

    // start() is idempotent
    poller.start();
    expect(warnSpy).toHaveBeenCalledWith('[Poller] Already active');

    // Hidden page: skip execution, but keep polling.
    document.hidden = true;
    vi.advanceTimersByTime(100);
    expect(checkFn).toHaveBeenCalledTimes(1);

    // Visible again: resume execution.
    document.hidden = false;
    vi.advanceTimersByTime(100);
    expect(checkFn).toHaveBeenCalledTimes(2);

    // Explicit pause() skips checks even when visible.
    poller.pause();
    vi.advanceTimersByTime(500);
    expect(checkFn).toHaveBeenCalledTimes(2);

    poller.resume();
    vi.advanceTimersByTime(100);
    expect(checkFn).toHaveBeenCalledTimes(3);

    poller.destroy();
    expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    vi.advanceTimersByTime(1000);
    expect(checkFn).toHaveBeenCalledTimes(3);
  });

  it('measure.sync and measure.async wrap performance marks/measures and return the function result', async () => {
    const perf = globalThis.performance;
    const mark = vi.spyOn(perf, 'mark').mockImplementation(() => {});
    const measure = vi.spyOn(perf, 'measure').mockImplementation(() => {});
    const getEntriesByName = vi.spyOn(perf, 'getEntriesByName').mockReturnValue([{ duration: 12.345 }]);
    const clearMarks = vi.spyOn(perf, 'clearMarks').mockImplementation(() => {});
    const clearMeasures = vi.spyOn(perf, 'clearMeasures').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const out = PerformanceHelpers.measure.sync('render', () => 123);
    expect(out).toBe(123);
    expect(mark).toHaveBeenCalledWith('render-start');
    expect(mark).toHaveBeenCalledWith('render-end');
    expect(measure).toHaveBeenCalledWith('render', 'render-start', 'render-end');
    expect(getEntriesByName).toHaveBeenCalledWith('render');
    expect(logSpy).toHaveBeenCalledWith('[Measure] render: 12.35ms');
    expect(clearMarks).toHaveBeenCalledWith('render-start');
    expect(clearMarks).toHaveBeenCalledWith('render-end');
    expect(clearMeasures).toHaveBeenCalledWith('render');

    const outAsync = await PerformanceHelpers.measure.async('fetch', async () => 'ok');
    expect(outAsync).toBe('ok');
    expect(measure).toHaveBeenCalledWith('fetch', 'fetch-start', 'fetch-end');
  });
});

