/**
 * perf_hooks shim - Performance measurement APIs
 * Wraps browser Performance API
 */

export const performance = globalThis.performance || {
  now: () => Date.now(),
  timeOrigin: Date.now(),
  mark: () => {},
  measure: () => {},
  getEntries: () => [],
  getEntriesByName: () => [],
  getEntriesByType: () => [],
  clearMarks: () => {},
  clearMeasures: () => {},
  clearResourceTimings: () => {},
};

export class PerformanceObserver {
  constructor(callback) {
    this.callback = callback;
    this.entryTypes = [];
  }

  observe(options) {
    this.entryTypes = options.entryTypes || (options.type ? [options.type] : []);
  }

  disconnect() {
    this.entryTypes = [];
  }

  takeRecords() {
    return [];
  }

  static supportedEntryTypes = ['mark', 'measure', 'resource', 'navigation'];
}

export class Histogram {
  constructor() {
    this.min = 0;
    this.max = 0;
    this.mean = 0;
    this.stddev = 0;
    this.percentiles = new Map();
    this.exceeds = 0;
  }

  reset() {
    this.min = 0;
    this.max = 0;
    this.mean = 0;
    this.stddev = 0;
    this.percentiles.clear();
    this.exceeds = 0;
  }

  percentile(percentile) {
    return this.percentiles.get(percentile) || 0;
  }
}

export function createHistogram() {
  return new Histogram();
}

export function monitorEventLoopDelay(options) {
  return new Histogram();
}

export default {
  performance,
  PerformanceObserver,
  createHistogram,
  monitorEventLoopDelay,
};
