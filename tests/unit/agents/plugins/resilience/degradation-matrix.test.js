import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
}));
const mockedCreateLogger = vi.hoisted(() => vi.fn(() => mockedLogger));

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  createLogger: mockedCreateLogger,
}));

import {
  OperationLevel,
  DegradationTrigger,
  DegradationPolicy,
  DegradationMatrix,
} from '../../../../../js/agents/plugins/resilience/degradation-matrix.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OperationLevel', () => {
  it('exposes expected levels and is frozen', () => {
    expect(OperationLevel).toEqual({
      NORMAL: 'normal',
      DEGRADED: 'degraded',
      CRITICAL: 'critical',
      OFFLINE: 'offline',
    });
    expect(Object.isFrozen(OperationLevel)).toBe(true);
  });

  it('rejects mutation attempts', () => {
    expect(() => {
      OperationLevel.NORMAL = 'changed';
    }).toThrow();
    expect(OperationLevel.NORMAL).toBe('normal');
  });
});

describe('DegradationTrigger', () => {
  it('exposes expected triggers and is frozen', () => {
    expect(DegradationTrigger).toEqual({
      ERROR_RATE: 'error_rate',
      LATENCY: 'latency',
      MEMORY: 'memory',
      QUOTA: 'quota',
      TIMEOUT: 'timeout',
      MANUAL: 'manual',
    });
    expect(Object.isFrozen(DegradationTrigger)).toBe(true);
  });
});

describe('DegradationPolicy', () => {
  it('merges thresholds and supports boundary values', () => {
    const policy = new DegradationPolicy({
      thresholds: {
        errorRateDegraded: 0,
        errorRateCritical: -1,
        latencyCriticalMs: Number.MAX_SAFE_INTEGER,
      },
    });

    expect(policy.thresholds).toMatchObject({
      errorRateDegraded: 0,
      errorRateCritical: -1,
      latencyCriticalMs: Number.MAX_SAFE_INTEGER,
      latencyDegradedMs: 2000,
      memoryDegradedRatio: 0.7,
      memoryCriticalRatio: 0.9,
    });
  });

  it('supports long feature names and nested values', () => {
    const longFeature = 'x'.repeat(10000);
    let deepFeature = { enabled: true };
    for (let i = 0; i < 8; i += 1) {
      deepFeature = { nested: deepFeature };
    }

    const policy = new DegradationPolicy({
      features: {
        [OperationLevel.NORMAL]: {
          [longFeature]: true,
          deepFeature,
        },
      },
    });

    const enabled = policy.getEnabledFeatures(OperationLevel.NORMAL);

    expect(enabled).toHaveLength(2);
    expect(enabled).toEqual(expect.arrayContaining([longFeature, 'deepFeature']));
    expect(policy.isFeatureEnabled(OperationLevel.NORMAL, longFeature)).toBe(true);
    expect(policy.isFeatureEnabled(OperationLevel.NORMAL, 'parallelRequests')).toBe(false);
  });

  it('returns false or empty arrays for nullish and unknown inputs', () => {
    const policy = new DegradationPolicy({ thresholds: {}, features: {} });

    expect(policy.isFeatureEnabled(null, 'caching')).toBe(false);
    expect(policy.isFeatureEnabled(undefined, '')).toBe(false);
    expect(policy.isFeatureEnabled(OperationLevel.NORMAL, ' ')).toBe(false);

    expect(policy.getEnabledFeatures(undefined)).toEqual([]);
    expect(policy.getEnabledFeatures('')).toEqual([]);
    expect(policy.getEnabledFeatures([])).toEqual([]);
    expect(policy.getEnabledFeatures({})).toEqual([]);
  });
});

describe('DegradationMatrix', () => {
  it('starts in normal mode with default status', () => {
    const matrix = new DegradationMatrix();

    expect(matrix.currentLevel).toBe(OperationLevel.NORMAL);

    const status = matrix.getStatus();

    expect(status.level).toBe(OperationLevel.NORMAL);
    expect(status.triggers).toEqual([]);
    expect(status.metrics).toEqual({
      errorRate: 0,
      avgLatency: 0,
      p99Latency: 0,
      requestCount: 0,
    });
    expect(status.manualOverride).toBeNull();
    expect(status.recentChanges).toEqual([]);
    expect(status.enabledFeatures).toEqual(
      expect.arrayContaining([
        'parallelRequests',
        'caching',
        'retries',
        'fullSearch',
        'externalApis',
        'backgroundTasks',
      ]),
    );
    expect(matrix.isFeatureEnabled('parallelRequests')).toBe(true);
  });

  it('records requests with sanitized inputs and tracks metrics', () => {
    const matrix = new DegradationMatrix();

    matrix.recordRequest();
    matrix.recordRequest([]);
    matrix.recordRequest({ latencyMs: '120', isError: 'true' });
    matrix.recordRequest({ latencyMs: -1, isError: true });
    matrix.recordRequest({ latencyMs: 0, isError: false });

    const metrics = matrix.getStatus().metrics;

    expect(metrics.requestCount).toBe(5);
    expect(metrics.errorRate).toBeCloseTo(0.2);
    expect(metrics.avgLatency).toBe(0);
    expect(metrics.p99Latency).toBe(0);
  });

  it('accepts very large latency values', () => {
    const matrix = new DegradationMatrix();

    matrix.recordRequest({ latencyMs: Number.MAX_SAFE_INTEGER });

    const metrics = matrix.getStatus().metrics;

    expect(metrics.avgLatency).toBe(Number.MAX_SAFE_INTEGER);
    expect(metrics.p99Latency).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('evaluates error rate, latency, and memory triggers with recommendations', () => {
    const matrix = new DegradationMatrix({
      getMemoryUsage: () => 0.95,
    });

    for (let i = 0; i < 10; i += 1) {
      matrix.recordRequest({ latencyMs: 6000, isError: i < 3 });
    }

    matrix.forceEvaluate();

    const status = matrix.getStatus();

    expect(status.level).toBe(OperationLevel.CRITICAL);
    expect(status.triggers).toEqual(
      expect.arrayContaining([
        DegradationTrigger.ERROR_RATE,
        DegradationTrigger.LATENCY,
        DegradationTrigger.MEMORY,
      ]),
    );
    expect(status.metrics.errorRate).toBeCloseTo(0.3);

    const recommendations = matrix.getRecommendations();
    const types = recommendations.map((rec) => rec.type).sort();

    expect(types).toEqual(['error_rate', 'latency', 'memory'].sort());
    recommendations.forEach((rec) => {
      expect(rec.severity).toBe(OperationLevel.CRITICAL);
    });

    const errorRec = recommendations.find((rec) => rec.type === 'error_rate');
    const latencyRec = recommendations.find((rec) => rec.type === 'latency');
    const memoryRec = recommendations.find((rec) => rec.type === 'memory');

    expect(errorRec).toEqual(
      expect.objectContaining({ message: expect.stringContaining('Error rate (') }),
    );
    expect(latencyRec).toEqual(
      expect.objectContaining({ message: expect.stringContaining('Average latency (') }),
    );
    expect(memoryRec).toEqual(
      expect.objectContaining({ message: expect.stringContaining('Memory usage exceeds threshold') }),
    );
  });

  it('applies manual override and clears back to evaluated level', () => {
    const matrix = new DegradationMatrix();

    matrix.setManualOverride(OperationLevel.DEGRADED);

    expect(matrix.currentLevel).toBe(OperationLevel.DEGRADED);
    expect(matrix.getStatus().manualOverride).toBe(OperationLevel.DEGRADED);
    expect(matrix.isFeatureEnabled('parallelRequests')).toBe(false);

    matrix.clearManualOverride();
    matrix.forceEvaluate();

    expect(matrix.getStatus().manualOverride).toBeNull();
    expect(matrix.currentLevel).toBe(OperationLevel.NORMAL);
  });

  it('ignores invalid manual override values', () => {
    const matrix = new DegradationMatrix();
    const invalidValues = [null, undefined, '', ' ', {}, []];

    invalidValues.forEach((value) => {
      matrix.setManualOverride(value);
    });

    expect(matrix.currentLevel).toBe(OperationLevel.NORMAL);
    expect(matrix.getStatus().manualOverride).toBeNull();
  });

  it('captures onLevelChange errors without throwing', () => {
    const onLevelChange = vi.fn(() => {
      throw new Error('boom');
    });

    const matrix = new DegradationMatrix({ onLevelChange });

    expect(() => matrix.setManualOverride(OperationLevel.CRITICAL)).not.toThrow();
    expect(onLevelChange).toHaveBeenCalledTimes(1);
    expect(mockedLogger.warn).toHaveBeenCalled();
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'onLevelChange callback threw',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('handles rapid and concurrent request bursts', async () => {
    const matrix = new DegradationMatrix();
    const largeCount = 1000;

    for (let i = 0; i < largeCount; i += 1) {
      matrix.recordRequest({ latencyMs: i % 10 });
    }

    await Promise.all(
      Array.from({ length: 20 }, (_, idx) => Promise.resolve().then(() => {
        matrix.recordRequest({ latencyMs: idx });
      })),
    );

    const metrics = matrix.getStatus().metrics;

    expect(metrics.requestCount).toBe(largeCount + 20);
  });

  it('caps level history to 100 entries', () => {
    const matrix = new DegradationMatrix();
    const levels = [OperationLevel.DEGRADED, OperationLevel.CRITICAL];

    for (let i = 0; i < 150; i += 1) {
      matrix.setManualOverride(levels[i % 2]);
      matrix.forceEvaluate();
    }

    expect(matrix._levelHistory.length).toBe(100);
    expect(matrix.getStatus().recentChanges).toHaveLength(5);
  });
});
