import { describe, it, expect } from 'vitest';
import perfHooks, {
  performance,
  PerformanceObserver,
  Histogram,
  createHistogram,
  monitorEventLoopDelay,
} from '../../../../../../js/agents/core/node-compat/shims/perf_hooks.js';

describe('perf_hooks shim', () => {
  it('exports a performance object with timing methods', () => {
    expect(typeof performance.now).toBe('function');
    expect(typeof performance.timeOrigin).toBe('number');
    expect(typeof performance.mark).toBe('function');
    expect(typeof performance.measure).toBe('function');
    expect(Array.isArray(performance.getEntries())).toBe(true);
    expect(Array.isArray(performance.getEntriesByName('x'))).toBe(true);
    expect(Array.isArray(performance.getEntriesByType('mark'))).toBe(true);
  });

  it('PerformanceObserver stores requested entry types', () => {
    const observer = new PerformanceObserver(() => {});
    expect(observer.entryTypes).toEqual([]);

    observer.observe({ entryTypes: ['mark', 'measure'] });
    expect(observer.entryTypes).toEqual(['mark', 'measure']);

    observer.observe({ type: 'resource' });
    expect(observer.entryTypes).toEqual(['resource']);

    expect(observer.takeRecords()).toEqual([]);
    observer.disconnect();
    expect(observer.entryTypes).toEqual([]);
    expect(PerformanceObserver.supportedEntryTypes).toContain('mark');
  });

  it('Histogram exposes reset and percentile helpers', () => {
    const histogram = new Histogram();
    expect(histogram.min).toBe(0);
    expect(histogram.max).toBe(0);
    expect(histogram.mean).toBe(0);
    expect(histogram.stddev).toBe(0);
    expect(histogram.exceeds).toBe(0);
    expect(histogram.percentile(99)).toBe(0);

    histogram.percentiles.set(95, 12.5);
    expect(histogram.percentile(95)).toBe(12.5);

    histogram.reset();
    expect(histogram.percentiles.size).toBe(0);
    expect(histogram.percentile(95)).toBe(0);
    expect(histogram.exceeds).toBe(0);
  });

  it('createHistogram and monitorEventLoopDelay return Histogram', () => {
    expect(createHistogram()).toBeInstanceOf(Histogram);
    expect(monitorEventLoopDelay({ resolution: 10 })).toBeInstanceOf(Histogram);
  });

  it('default export mirrors named exports', () => {
    expect(perfHooks.performance).toBe(performance);
    expect(perfHooks.PerformanceObserver).toBe(PerformanceObserver);
    expect(perfHooks.createHistogram).toBe(createHistogram);
    expect(perfHooks.monitorEventLoopDelay).toBe(monitorEventLoopDelay);
  });
});
