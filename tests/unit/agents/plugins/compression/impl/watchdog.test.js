import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerWarnMock = vi.hoisted(() => vi.fn());
const createLoggerMock = vi.hoisted(() => vi.fn(() => ({ warn: loggerWarnMock })));
const toNonEmptyStringMock = vi.hoisted(() =>
  vi.fn((value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return trimmed ? trimmed : '';
  })
);
const behaviorFingerprintCtor = vi.hoisted(() => vi.fn());
const watchdogEventsMock = vi.hoisted(() => ({ WATCHDOG_INTERVENTION: 'watchdog:intervention' }));

vi.mock('../../../../../../js/agents/runtime/events/events.js', () => ({
  WatchdogEvents: watchdogEventsMock,
}));

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  toNonEmptyString: toNonEmptyStringMock,
  createLogger: createLoggerMock,
}));

vi.mock('../../../../../../js/agents/plugins/analysis/behavior-fingerprint.js', () => ({
  BehaviorFingerprint: behaviorFingerprintCtor,
}));

import Watchdog, { Watchdog as NamedWatchdog } from '../../../../../../js/agents/plugins/compression/impl/watchdog.js';
import { WatchdogEvents } from '../../../../../../js/agents/runtime/events/events.js';

describe('Watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
      this.recordAction = vi.fn(() => ({ loopDetected: false, loopInfo: null }));
      this.getSuggestion = vi.fn(() => null);
      this.reset = vi.fn();
    });
  });

  it('constructs with defaults and allows behaviorFingerprint disabled', () => {
    const watchdog = new Watchdog({ behaviorFingerprint: false });

    expect(behaviorFingerprintCtor).not.toHaveBeenCalled();
    expect(watchdog.eventBus).toBe(null);
    expect(watchdog._maxRecentOutputs).toBe(5);
    expect(watchdog._oscillationThreshold).toBe(0.85);
  });

  it('initializes BehaviorFingerprint with sanitized config', () => {
    const cfg = { sample: true };
    const watchdog = new Watchdog({ behaviorFingerprint: cfg });

    expect(behaviorFingerprintCtor).toHaveBeenCalledWith(cfg);
    expect(watchdog._behaviorFingerprint).toBeTruthy();

    const watchdogWithArray = new Watchdog({ behaviorFingerprint: [] });
    expect(behaviorFingerprintCtor).toHaveBeenCalledWith({});
    expect(watchdogWithArray._behaviorFingerprint).toBeTruthy();
  });

  it('emits warning when BehaviorFingerprint init fails', () => {
    const eventBus = { emit: vi.fn() };
    behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
      throw new Error('init failed');
    });

    new Watchdog({ eventBus });

    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('failed to init BehaviorFingerprint')
    );
    expect(eventBus.emit).toHaveBeenCalledWith(
      WatchdogEvents.WATCHDOG_INTERVENTION,
      expect.objectContaining({
        actor: 'watchdog',
        status: 'info',
        payload: {
          issues: [
            {
              type: 'behavior_fingerprint_init_failed',
              severity: 'warning',
              reason: 'init failed',
            },
          ],
        },
      })
    );
  });

  describe('configure', () => {
    it('clamps values and trims recent outputs', () => {
      const watchdog = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: 4 });

      watchdog.recordOutput('one');
      watchdog.recordOutput('two');
      watchdog.recordOutput('three');
      watchdog.recordOutput('four');

      const result = watchdog.configure({ maxRecentOutputs: 2, oscillationThreshold: 0.2 });

      expect(result).toEqual({ maxRecentOutputs: 2, oscillationThreshold: 0.2 });
      expect(watchdog._recentOutputs.length).toBe(2);
    });

    it('handles boundary values and ignores non-finite inputs', () => {
      const watchdog = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: 4, oscillationThreshold: 0.75 });

      const zeroResult = watchdog.configure({ maxRecentOutputs: 0, oscillationThreshold: 0 });
      expect(zeroResult.maxRecentOutputs).toBe(5);
      expect(zeroResult.oscillationThreshold).toBe(0.85);

      const negativeResult = watchdog.configure({ maxRecentOutputs: -1, oscillationThreshold: -1 });
      expect(negativeResult.maxRecentOutputs).toBe(2);
      expect(negativeResult.oscillationThreshold).toBe(0);

      const maxResult = watchdog.configure({
        maxRecentOutputs: Number.MAX_SAFE_INTEGER,
        oscillationThreshold: Number.MAX_SAFE_INTEGER,
      });
      expect(maxResult.maxRecentOutputs).toBe(Number.MAX_SAFE_INTEGER);
      expect(maxResult.oscillationThreshold).toBe(1);

      const ignored = watchdog.configure({ maxRecentOutputs: '10', oscillationThreshold: '0.1' });
      expect(ignored.maxRecentOutputs).toBe(Number.MAX_SAFE_INTEGER);
      expect(ignored.oscillationThreshold).toBe(1);
    });
  });

  describe('observe', () => {
    it('registers observers and supports unsubscribe', () => {
      const eventBus = { emit: vi.fn() };
      const watchdog = new Watchdog({ eventBus, behaviorFingerprint: false });
      const handler = vi.fn();

      const stop = watchdog.observe(' health ', handler);
      watchdog._emit('health', { ok: true });

      expect(handler).toHaveBeenCalledWith({ ok: true });
      expect(eventBus.emit).toHaveBeenCalledWith(
        'health',
        expect.objectContaining({
          actor: 'watchdog',
          status: 'info',
          payload: { ok: true },
        })
      );

      stop();
      watchdog._emit('health', { ok: false });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('throws for invalid handler or event name', () => {
      const watchdog = new Watchdog({ behaviorFingerprint: false });

      expect(() => watchdog.observe('event', null)).toThrow(TypeError);
      for (const badName of [null, undefined, '', '   ', [], {}]) {
        expect(() => watchdog.observe(badName, () => {})).toThrow();
      }
    });
  });

  describe('recordAction', () => {
    it('returns no loop when behaviorFingerprint is disabled', () => {
      const watchdog = new Watchdog({ behaviorFingerprint: false });

      const result = watchdog.recordAction({ type: 'noop' });
      expect(result).toEqual({ loopDetected: false, loopInfo: null, suggestion: null });
    });

    it('emits intervention on new loop detection and handles rapid calls', async () => {
      const eventBus = { emit: vi.fn() };
      const recordActionMock = vi.fn(() => ({
        loopDetected: true,
        loopInfo: { totalLoopsDetected: 1 },
      }));
      const suggestion = {
        action: 'break_loop',
        severity: 'high',
        reason: 'looping',
        suggestion: 'stop',
      };
      const getSuggestionMock = vi.fn(() => suggestion);

      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.recordAction = recordActionMock;
        this.getSuggestion = getSuggestionMock;
        this.reset = vi.fn();
      });

      const watchdog = new Watchdog({ eventBus, behaviorFingerprint: {} });
      const action = {
        type: 'tool',
        name: 'run',
        args: { nested: { depth: [{ value: 'x' }] } },
      };

      const result = watchdog.recordAction(action);
      expect(recordActionMock).toHaveBeenCalledWith(action);
      expect(result.loopDetected).toBe(true);
      expect(result.suggestion).toEqual(suggestion);
      expect(eventBus.emit).toHaveBeenCalledTimes(1);

      await Promise.all([action, action, action].map((item) => Promise.resolve().then(() => watchdog.recordAction(item))));
      expect(eventBus.emit).toHaveBeenCalledTimes(1);
    });

    it('passes empty object when action is null and supports missing recordAction', () => {
      const recordActionMock = vi.fn(() => ({ loopDetected: false, loopInfo: null }));
      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.recordAction = recordActionMock;
        this.getSuggestion = vi.fn(() => null);
      });

      const watchdog = new Watchdog({ behaviorFingerprint: {} });
      watchdog.recordAction(null);
      expect(recordActionMock).toHaveBeenCalledWith({});

      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.getSuggestion = vi.fn(() => null);
      });
      const watchdogWithoutRecord = new Watchdog({ behaviorFingerprint: {} });
      expect(watchdogWithoutRecord.recordAction({})).toEqual({
        loopDetected: false,
        loopInfo: null,
        suggestion: null,
      });
    });
  });

  describe('recordOutput', () => {
    it('detects similarity and trims recent outputs', () => {
      const watchdog = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: 3, oscillationThreshold: 0.8 });

      const first = watchdog.recordOutput('Hello world');
      expect(first).toEqual({ similar: false, similarity: 0 });

      const second = watchdog.recordOutput('Hello world');
      expect(second.similar).toBe(true);
      expect(second.similarity).toBe(1);
      expect(watchdog._consecutiveSimilarCount).toBe(1);

      const third = watchdog.recordOutput('Completely different');
      expect(third.similar).toBe(false);
      expect(watchdog._consecutiveSimilarCount).toBe(0);

      for (const value of ['one', 'two', 'three', 'four']) {
        watchdog.recordOutput(value);
      }
      expect(watchdog._recentOutputs.length).toBeLessThanOrEqual(3);
    });

    it('handles empty and whitespace-like outputs', () => {
      const watchdog = new Watchdog({ behaviorFingerprint: false });

      const first = watchdog.recordOutput(null);
      const second = watchdog.recordOutput(undefined);
      expect(first.similar).toBe(false);
      expect(second.similar).toBe(true);

      const third = watchdog.recordOutput('');
      expect(third.similar).toBe(true);

      const fourth = watchdog.recordOutput('   ');
      expect(fourth.similar).toBe(true);

      const arrayWatchdog = new Watchdog({ behaviorFingerprint: false });
      const fifth = arrayWatchdog.recordOutput([]);
      const sixth = arrayWatchdog.recordOutput([]);
      expect(fifth.similar).toBe(false);
      expect(sixth.similar).toBe(true);

      const objectWatchdog = new Watchdog({ behaviorFingerprint: false });
      const seventh = objectWatchdog.recordOutput({});
      const eighth = objectWatchdog.recordOutput({});
      expect(seventh.similar).toBe(false);
      expect(eighth.similar).toBe(true);
    });

    it('handles large output payloads', () => {
      const watchdog = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: 2 });
      const large = 'a'.repeat(20000) + 'b'.repeat(20000);

      const first = watchdog.recordOutput(large);
      const second = watchdog.recordOutput(large);

      expect(first.similar).toBe(false);
      expect(second.similar).toBe(true);
      expect(watchdog._recentOutputs.length).toBeLessThanOrEqual(2);
    });
  });

  describe('checkHealth', () => {
    it('returns healthy status with no issues', () => {
      const eventBus = { emit: vi.fn() };
      const watchdog = new Watchdog({ eventBus, behaviorFingerprint: false });
      const now = 100000;
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

      watchdog._startTime = now - 1000;
      watchdog._lastProgressTime = now - 10;
      watchdog._iterationCount = 1;
      watchdog._consecutiveSimilarCount = 0;

      const result = watchdog.checkHealth({
        maxIterations: 10,
        maxTimeMs: 2000,
        stuckThresholdMs: 1000,
        oscillationConsecutiveThreshold: 3,
      });

      expect(result.healthy).toBe(true);
      expect(result.issues).toEqual([]);
      expect(eventBus.emit).not.toHaveBeenCalled();

      nowSpy.mockRestore();
    });

    it('reports issues for exceeded thresholds and tool loop suggestion', () => {
      const eventBus = { emit: vi.fn() };
      const now = 10000;
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

      const getSuggestionMock = vi.fn(() => ({
        action: 'break_loop',
        severity: 'high',
        reason: 'loop',
        suggestion: 'stop',
      }));
      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.recordAction = vi.fn();
        this.getSuggestion = getSuggestionMock;
        this.reset = vi.fn();
      });

      const watchdog = new Watchdog({ eventBus, behaviorFingerprint: {} });
      watchdog._startTime = now - 1000;
      watchdog._lastProgressTime = now - 1000;
      watchdog._iterationCount = 5;
      watchdog._consecutiveSimilarCount = 3;

      const result = watchdog.checkHealth({
        maxIterations: 3,
        maxTimeMs: 500,
        stuckThresholdMs: 100,
        oscillationConsecutiveThreshold: 2,
      });

      const issueTypes = result.issues.map((issue) => issue.type);
      expect(issueTypes).toEqual(
        expect.arrayContaining(['max_iterations', 'timeout', 'stuck', 'oscillation', 'tool_loop'])
      );
      expect(result.healthy).toBe(false);
      expect(eventBus.emit).toHaveBeenCalledWith(
        WatchdogEvents.WATCHDOG_INTERVENTION,
        expect.objectContaining({
          actor: 'watchdog',
          status: 'info',
          payload: { issues: expect.any(Array) },
        })
      );

      nowSpy.mockRestore();
    });

    it('handles suggestion analysis errors and boundary thresholds', () => {
      const eventBus = { emit: vi.fn() };
      const now = 5000;
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.recordAction = vi.fn();
        this.getSuggestion = vi.fn(() => {
          throw new Error('analysis failed');
        });
        this.reset = vi.fn();
      });

      const watchdog = new Watchdog({ eventBus, behaviorFingerprint: {} });
      watchdog._startTime = now;
      watchdog._lastProgressTime = now;
      watchdog._iterationCount = 0;
      watchdog._consecutiveSimilarCount = 0;

      const boundaryResult = watchdog.checkHealth({
        maxIterations: '0',
        maxTimeMs: -1,
        stuckThresholdMs: 0,
        oscillationConsecutiveThreshold: 0,
      });
      const issueTypes = boundaryResult.issues.map((issue) => issue.type);
      expect(issueTypes).toEqual(
        expect.arrayContaining(['max_iterations', 'timeout', 'stuck', 'oscillation'])
      );

      const healthyResult = watchdog.checkHealth({
        maxIterations: Number.MAX_SAFE_INTEGER,
        maxTimeMs: Number.MAX_SAFE_INTEGER,
        stuckThresholdMs: Number.MAX_SAFE_INTEGER,
        oscillationConsecutiveThreshold: Number.MAX_SAFE_INTEGER,
      });
      expect(healthyResult.healthy).toBe(true);
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.stringContaining('BehaviorFingerprint analysis failed')
      );

      nowSpy.mockRestore();
    });
  });

  describe('intervene', () => {
    it('emits intervention payload and returns it', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const eventBus = { emit: vi.fn() };
      const watchdog = new Watchdog({ eventBus, behaviorFingerprint: false });
      const payload = watchdog.intervene(null, {});

      expect(payload).toEqual({
        reason: null,
        options: {},
        timestamp: '2024-01-01T00:00:00.000Z',
      });
      expect(eventBus.emit).toHaveBeenCalledWith(
        WatchdogEvents.WATCHDOG_INTERVENTION,
        expect.objectContaining({
          actor: 'watchdog',
          status: 'info',
          payload,
        })
      );

      vi.useRealTimers();
    });
  });

  describe('reset', () => {
    it('clears internal counters and resets BehaviorFingerprint', () => {
      const resetMock = vi.fn();
      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.recordAction = vi.fn();
        this.getSuggestion = vi.fn(() => null);
        this.reset = resetMock;
      });

      const watchdog = new Watchdog({ behaviorFingerprint: {} });
      watchdog._iterationCount = 5;
      watchdog._recentOutputs = [
        { fingerprint: 'x', tokens: new Set(['x']), timestamp: 1 },
      ];
      watchdog._consecutiveSimilarCount = 2;
      watchdog._behaviorLastNotifiedLoopCount = 3;

      watchdog.reset();

      expect(resetMock).toHaveBeenCalled();
      expect(watchdog._iterationCount).toBe(0);
      expect(watchdog._recentOutputs).toEqual([]);
      expect(watchdog._consecutiveSimilarCount).toBe(0);
      expect(watchdog._behaviorLastNotifiedLoopCount).toBe(0);
    });

    it('ignores reset errors from BehaviorFingerprint', () => {
      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.reset = vi.fn(() => {
          throw new Error('reset failed');
        });
      });

      const watchdog = new Watchdog({ behaviorFingerprint: {} });
      expect(() => watchdog.reset()).not.toThrow();
    });
  });

  describe('resetOscillation', () => {
    it('clears oscillation window without resetting counters', () => {
      const watchdog = new Watchdog({ behaviorFingerprint: false });
      watchdog._iterationCount = 4;
      watchdog._recentOutputs = [
        { fingerprint: 'x', tokens: new Set(['x']), timestamp: 1 },
      ];
      watchdog._consecutiveSimilarCount = 2;

      watchdog.resetOscillation();

      expect(watchdog._recentOutputs).toEqual([]);
      expect(watchdog._consecutiveSimilarCount).toBe(0);
      expect(watchdog._iterationCount).toBe(4);
    });
  });

  describe('resetToolLoop', () => {
    it('resets loop counters and calls BehaviorFingerprint.reset', () => {
      const resetMock = vi.fn();
      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.reset = resetMock;
      });

      const watchdog = new Watchdog({ behaviorFingerprint: {} });
      watchdog._behaviorLastNotifiedLoopCount = 2;

      watchdog.resetToolLoop();

      expect(resetMock).toHaveBeenCalled();
      expect(watchdog._behaviorLastNotifiedLoopCount).toBe(0);
    });
  });
});

describe('default export', () => {
  it('matches the named Watchdog export', () => {
    expect(Watchdog).toBe(NamedWatchdog);
  });
});
