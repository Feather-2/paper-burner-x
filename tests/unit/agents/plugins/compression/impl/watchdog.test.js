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

import WatchdogDefault, { Watchdog } from '../../../../../../js/agents/plugins/compression/impl/watchdog.js';
import { WatchdogEvents } from '../../../../../../js/agents/runtime/events/events.js';

describe('Watchdog', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();

    behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
      this.recordAction = vi.fn(() => ({ loopDetected: false, loopInfo: null }));
      this.getSuggestion = vi.fn(() => null);
      this.reset = vi.fn();
    });
  });

  it('exports Watchdog as both named and default', () => {
    expect(WatchdogDefault).toBe(Watchdog);
  });

  describe('constructor', () => {
    it('constructs with defaults and rejects null options', () => {
      const wd = new Watchdog({ behaviorFingerprint: false });
      expect(wd.eventBus).toBe(null);
      expect(wd._maxRecentOutputs).toBe(5);
      expect(wd._oscillationThreshold).toBe(0.85);
      expect(wd._behaviorFingerprint).toBe(null);

      expect(() => new Watchdog(null)).toThrow(TypeError);
    });

    it('normalizes constructor options (including boundaries and type coercion)', () => {
      const a = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: 1.9, oscillationThreshold: 2 });
      expect(a._maxRecentOutputs).toBe(2);
      expect(a._oscillationThreshold).toBe(1);

      const b = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: -1, oscillationThreshold: -1 });
      expect(b._maxRecentOutputs).toBe(2);
      expect(b._oscillationThreshold).toBe(0);

      const c = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: 0, oscillationThreshold: 0 });
      expect(c._maxRecentOutputs).toBe(5);
      expect(c._oscillationThreshold).toBe(0.85);

      const d = new Watchdog({
        behaviorFingerprint: false,
        maxRecentOutputs: Number.MAX_SAFE_INTEGER,
        oscillationThreshold: Number.MAX_SAFE_INTEGER,
      });
      expect(d._maxRecentOutputs).toBe(Number.MAX_SAFE_INTEGER);
      expect(d._oscillationThreshold).toBe(1);

      const e = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: '3', oscillationThreshold: '0.5' });
      expect(e._maxRecentOutputs).toBe(3);
      expect(e._oscillationThreshold).toBe(0.5);
    });

    it('initializes BehaviorFingerprint unless explicitly disabled; sanitizes config', () => {
      new Watchdog(); // undefined options
      new Watchdog(undefined);
      new Watchdog({}); // empty object
      new Watchdog([]); // empty array options (type boundary)

      expect(behaviorFingerprintCtor).toHaveBeenCalledTimes(4);
      expect(behaviorFingerprintCtor).toHaveBeenCalledWith({});

      behaviorFingerprintCtor.mockClear();
      new Watchdog({ behaviorFingerprint: { sample: true } });
      new Watchdog({ behaviorFingerprint: [] });
      new Watchdog({ behaviorFingerprint: 'not-an-object' });
      new Watchdog({ behaviorFingerprint: null });
      expect(behaviorFingerprintCtor).toHaveBeenCalledTimes(4);
      expect(behaviorFingerprintCtor).toHaveBeenNthCalledWith(1, { sample: true });
      expect(behaviorFingerprintCtor).toHaveBeenNthCalledWith(2, {});
      expect(behaviorFingerprintCtor).toHaveBeenNthCalledWith(3, {});
      expect(behaviorFingerprintCtor).toHaveBeenNthCalledWith(4, {});
    });

    it('warns and emits intervention when BehaviorFingerprint init fails (with fallback event name)', () => {
      const eventBus = { emit: vi.fn() };
      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        throw new Error('init failed');
      });

      const prev = WatchdogEvents.WATCHDOG_INTERVENTION;
      WatchdogEvents.WATCHDOG_INTERVENTION = undefined;
      try {
        const wd = new Watchdog({ eventBus, behaviorFingerprint: {} });
        expect(wd._behaviorFingerprint).toBe(null);

        expect(loggerWarnMock).toHaveBeenCalledWith(
          expect.stringContaining('Watchdog: failed to init BehaviorFingerprint')
        );
        expect(eventBus.emit).toHaveBeenCalledWith(
          'watchdog:intervention',
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
      } finally {
        WatchdogEvents.WATCHDOG_INTERVENTION = prev;
      }
    });
  });

  describe('configure', () => {
    it('floors/clamps values and trims recent outputs', () => {
      const wd = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: 4 });
      wd.recordOutput('one');
      wd.recordOutput('two');
      wd.recordOutput('three');
      wd.recordOutput('four');

      const result = wd.configure({ maxRecentOutputs: 1.1, oscillationThreshold: 2 });
      expect(result).toEqual({ maxRecentOutputs: 2, oscillationThreshold: 1 });
      expect(wd._recentOutputs.length).toBe(2);
    });

    it('handles boundary values and ignores non-finite/type-invalid inputs', () => {
      const wd = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: 4, oscillationThreshold: 0.75 });

      expect(wd.configure({ maxRecentOutputs: 0, oscillationThreshold: 0 })).toEqual({
        maxRecentOutputs: 5,
        oscillationThreshold: 0.85,
      });
      expect(wd.configure({ maxRecentOutputs: -1, oscillationThreshold: -1 })).toEqual({
        maxRecentOutputs: 2,
        oscillationThreshold: 0,
      });
      expect(wd.configure({ maxRecentOutputs: Number.MAX_SAFE_INTEGER, oscillationThreshold: Number.MAX_SAFE_INTEGER })).toEqual({
        maxRecentOutputs: Number.MAX_SAFE_INTEGER,
        oscillationThreshold: 1,
      });

      // Non-finite or non-number types: ignored, keep previous values.
      expect(wd.configure({ maxRecentOutputs: '10', oscillationThreshold: '0.1' })).toEqual({
        maxRecentOutputs: Number.MAX_SAFE_INTEGER,
        oscillationThreshold: 1,
      });
      expect(wd.configure({ maxRecentOutputs: Infinity, oscillationThreshold: NaN })).toEqual({
        maxRecentOutputs: Number.MAX_SAFE_INTEGER,
        oscillationThreshold: 1,
      });
      expect(wd.configure({ maxRecentOutputs: {}, oscillationThreshold: [] })).toEqual({
        maxRecentOutputs: Number.MAX_SAFE_INTEGER,
        oscillationThreshold: 1,
      });
    });
  });

  describe('_emit', () => {
    it('emits to eventBus and local observers', () => {
      const eventBus = { emit: vi.fn() };
      const wd = new Watchdog({ eventBus, behaviorFingerprint: false });
      const handlerA = vi.fn();
      const handlerB = vi.fn();

      const stopA = wd.observe(' health ', handlerA);
      wd.observe('health', handlerB);

      wd._emit('health', { ok: true });
      expect(eventBus.emit).toHaveBeenCalledWith(
        'health',
        expect.objectContaining({
          actor: 'watchdog',
          status: 'info',
          payload: { ok: true },
        })
      );
      expect(handlerA).toHaveBeenCalledWith({ ok: true });
      expect(handlerB).toHaveBeenCalledWith({ ok: true });

      stopA();
      wd._emit('health', { ok: false });
      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledTimes(2);
    });

    it('does not require eventBus.emit to notify local observers', () => {
      const wd = new Watchdog({ eventBus: {}, behaviorFingerprint: false });
      const handler = vi.fn();
      wd.observe('evt', handler);

      expect(() => wd._emit('evt', { x: 1 })).not.toThrow();
      expect(handler).toHaveBeenCalledWith({ x: 1 });
    });
  });

  describe('observe', () => {
    it('unsubscribes cleanly and removes empty observer sets', () => {
      const wd = new Watchdog({ behaviorFingerprint: false });
      const h1 = vi.fn();
      const h2 = vi.fn();

      const stop1 = wd.observe(' event ', h1);
      const stop2 = wd.observe('event', h2);

      wd._emit('event', { a: 1 });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);

      stop1();
      wd._emit('event', { a: 2 });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(2);

      stop2();
      expect(wd._observers.has('event')).toBe(false);
    });

    it('throws for invalid handler or eventName (empty values and type boundaries)', () => {
      const wd = new Watchdog({ behaviorFingerprint: false });

      expect(() => wd.observe('event', null)).toThrow(TypeError);

      for (const badName of [null, undefined, '', '   ', [], {}]) {
        expect(() => wd.observe(badName, () => {})).toThrow();
      }
    });
  });

  describe('tick', () => {
    it('increments iterationCount and updates lastProgressTime (including rapid calls)', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const wd = new Watchdog({ behaviorFingerprint: false });
      expect(wd._iterationCount).toBe(0);

      wd.tick();
      expect(wd._iterationCount).toBe(1);
      expect(wd._lastProgressTime).toBe(Date.now());

      vi.setSystemTime(new Date('2024-01-01T00:00:01Z'));
      await Promise.all(
        Array.from({ length: 25 }, () => Promise.resolve().then(() => wd.tick()))
      );

      expect(wd._iterationCount).toBe(26);
      expect(wd._lastProgressTime).toBe(Date.now());
    });
  });

  describe('recordOutput', () => {
    it('detects similarity and trims recent outputs', () => {
      const wd = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: 3, oscillationThreshold: 0.8 });

      const first = wd.recordOutput('Hello world');
      expect(first).toEqual({ similar: false, similarity: 0 });

      const second = wd.recordOutput('Hello world');
      expect(second).toEqual({ similar: true, similarity: 1 });
      expect(wd._consecutiveSimilarCount).toBe(1);

      const third = wd.recordOutput('Completely different');
      expect(third.similar).toBe(false);
      expect(wd._consecutiveSimilarCount).toBe(0);

      for (const value of ['one', 'two', 'three', 'four']) {
        wd.recordOutput(value);
      }
      expect(wd._recentOutputs.length).toBeLessThanOrEqual(3);
    });

    it('handles empty values and non-string inputs', () => {
      const wd = new Watchdog({ behaviorFingerprint: false });
      expect(wd.recordOutput(null).similar).toBe(false);
      expect(wd.recordOutput(undefined).similar).toBe(true);
      expect(wd.recordOutput('').similar).toBe(true);
      expect(wd.recordOutput(' \n\t ').similar).toBe(true);

      const wdArray = new Watchdog({ behaviorFingerprint: false });
      expect(wdArray.recordOutput([])).toEqual({ similar: false, similarity: 0 });
      expect(wdArray.recordOutput([])).toEqual({ similar: true, similarity: 1 });

      const wdObj = new Watchdog({ behaviorFingerprint: false });
      expect(wdObj.recordOutput({})).toEqual({ similar: false, similarity: 0 });
      expect(wdObj.recordOutput({})).toEqual({ similar: true, similarity: 1 });

      const wdNum = new Watchdog({ behaviorFingerprint: false });
      expect(wdNum.recordOutput(123)).toEqual({ similar: false, similarity: 0 });
      expect(wdNum.recordOutput('123')).toEqual({ similar: true, similarity: 1 });
    });

    it('detects near-duplicate outputs via token Jaccard similarity', () => {
      const wd = new Watchdog({ behaviorFingerprint: false, oscillationThreshold: 0.85 });
      const base = 'abcdefghijklmnopqrstuvwxyz0123456789!@#$';
      const modified = base.replace('m', '%');

      expect(wd.recordOutput(base)).toEqual({ similar: false, similarity: 0 });
      const second = wd.recordOutput(modified);
      expect(second.similar).toBe(true);
      expect(second.similarity).toBeGreaterThanOrEqual(0.85);
      expect(second.similarity).toBeLessThan(1);
    });

    it('handles very large outputs and enforces window size under rapid calls', async () => {
      const wd = new Watchdog({ behaviorFingerprint: false, maxRecentOutputs: 2 });
      const huge = 'a'.repeat(120000); // resource boundary: long string

      expect(wd.recordOutput(huge).similar).toBe(false);
      expect(wd.recordOutput(huge)).toEqual({ similar: true, similarity: 1 });

      await Promise.all(
        Array.from({ length: 20 }, (_, i) => Promise.resolve().then(() => wd.recordOutput(`msg-${i}`)))
      );
      expect(wd._recentOutputs.length).toBeLessThanOrEqual(2);
    });
  });

  describe('recordAction', () => {
    it('returns no loop when BehaviorFingerprint is disabled or missing recordAction', () => {
      const wdDisabled = new Watchdog({ behaviorFingerprint: false });
      expect(wdDisabled.recordAction({ type: 'noop' })).toEqual({
        loopDetected: false,
        loopInfo: null,
        suggestion: null,
      });

      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.getSuggestion = vi.fn(() => null);
        // recordAction intentionally missing
      });

      const wdMissing = new Watchdog({ behaviorFingerprint: {} });
      expect(wdMissing.recordAction({})).toEqual({
        loopDetected: false,
        loopInfo: null,
        suggestion: null,
      });
    });

    it('emits intervention only when loop count increases (including rapid calls)', async () => {
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

      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.recordAction = recordActionMock;
        this.getSuggestion = vi.fn(() => suggestion);
        this.reset = vi.fn();
      });

      const wd = new Watchdog({ eventBus, behaviorFingerprint: {} });
      const action = {
        type: 'tool',
        name: 'run',
        args: { nested: { depth: [{ value: 'x' }] } }, // deep nesting boundary
      };

      const out1 = wd.recordAction(action);
      expect(recordActionMock).toHaveBeenCalledWith(action);
      expect(out1.loopDetected).toBe(true);
      expect(out1.suggestion).toEqual(suggestion);
      expect(eventBus.emit).toHaveBeenCalledTimes(1);

      // Rapid calls with same loop count should not spam notifications.
      await Promise.all(
        Array.from({ length: 10 }, () => Promise.resolve().then(() => wd.recordAction(action)))
      );
      expect(eventBus.emit).toHaveBeenCalledTimes(1);

      recordActionMock.mockImplementation(() => ({
        loopDetected: true,
        loopInfo: { totalLoopsDetected: 2 },
      }));
      wd.recordAction(action);
      expect(eventBus.emit).toHaveBeenCalledTimes(2);
      expect(wd._behaviorLastNotifiedLoopCount).toBe(2);
    });

    it('handles null action input, missing getSuggestion, invalid loop counts, and event-name fallback', () => {
      const eventBus = { emit: vi.fn() };
      const recordActionMock = vi.fn(() => ({
        loopDetected: true,
        loopInfo: { totalLoopsDetected: 1 },
      }));

      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.recordAction = recordActionMock;
        // getSuggestion intentionally missing
      });

      const prev = WatchdogEvents.WATCHDOG_INTERVENTION;
      WatchdogEvents.WATCHDOG_INTERVENTION = undefined;
      try {
        const wd = new Watchdog({ eventBus, behaviorFingerprint: {} });
        const out = wd.recordAction(null);
        expect(recordActionMock).toHaveBeenCalledWith({});
        expect(out.loopDetected).toBe(true);
        expect(out.suggestion).toBe(null);
        expect(eventBus.emit).toHaveBeenCalledWith(
          'watchdog:intervention',
          expect.objectContaining({
            actor: 'watchdog',
            status: 'info',
            payload: {
              issues: [
                expect.objectContaining({
                  type: 'tool_loop',
                }),
              ],
            },
          })
        );

        recordActionMock.mockImplementation(() => ({
          loopDetected: true,
          loopInfo: { totalLoopsDetected: '2' }, // type boundary: string instead of number
        }));
        wd.recordAction({});
        expect(eventBus.emit).toHaveBeenCalledTimes(1);
      } finally {
        WatchdogEvents.WATCHDOG_INTERVENTION = prev;
      }
    });
  });

  describe('checkHealth', () => {
    it('returns healthy when no thresholds are exceeded', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const eventBus = { emit: vi.fn() };
      const wd = new Watchdog({ eventBus, behaviorFingerprint: false });
      wd.tick();
      wd.recordOutput('hello');

      const result = wd.checkHealth({
        maxIterations: 10,
        maxTimeMs: 1000,
        stuckThresholdMs: 1000,
        oscillationConsecutiveThreshold: 3,
      });

      expect(result.healthy).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.stats.iterationCount).toBe(1);
      expect(result.stats.consecutiveSimilarOutputs).toBe(0);
      expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('reports issues for exceeded thresholds and emits intervention', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:10Z'));
      const now = Date.now();

      const eventBus = { emit: vi.fn() };
      const wd = new Watchdog({ eventBus, behaviorFingerprint: false });

      wd._startTime = now - 1000;
      wd._lastProgressTime = now - 1000;
      wd._iterationCount = 5;
      wd._consecutiveSimilarCount = 3;

      const result = wd.checkHealth({
        maxIterations: 3,
        maxTimeMs: 500,
        stuckThresholdMs: 100,
        oscillationConsecutiveThreshold: 2,
      });

      expect(result.healthy).toBe(false);
      expect(result.issues.map((issue) => issue.type)).toEqual([
        'max_iterations',
        'timeout',
        'stuck',
        'oscillation',
      ]);
      expect(eventBus.emit).toHaveBeenCalledWith(
        WatchdogEvents.WATCHDOG_INTERVENTION,
        expect.objectContaining({
          actor: 'watchdog',
          status: 'info',
          payload: { issues: expect.any(Array) },
        })
      );
    });

    it('flags tool-loop suggestions (break_loop/diversify) even when other thresholds are ok', () => {
      for (const action of ['break_loop', 'diversify']) {
        const eventBus = { emit: vi.fn() };

        behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
          this.recordAction = vi.fn();
          this.getSuggestion = vi.fn(() => ({
            action,
            severity: 'medium',
            reason: 'repetitive',
            suggestion: 'change approach',
          }));
          this.reset = vi.fn();
        });

        const wd = new Watchdog({ eventBus, behaviorFingerprint: {} });
        wd._startTime = Date.now();
        wd._lastProgressTime = Date.now();
        wd._iterationCount = 0;
        wd._consecutiveSimilarCount = 0;

        const result = wd.checkHealth({
          maxIterations: Number.MAX_SAFE_INTEGER,
          maxTimeMs: Number.MAX_SAFE_INTEGER,
          stuckThresholdMs: Number.MAX_SAFE_INTEGER,
          oscillationConsecutiveThreshold: Number.MAX_SAFE_INTEGER,
        });

        expect(result.healthy).toBe(false);
        expect(result.issues).toEqual([
          expect.objectContaining({
            type: 'tool_loop',
            action,
            severity: 'medium',
            reason: 'repetitive',
            suggestion: 'change approach',
          }),
        ]);
        expect(eventBus.emit).toHaveBeenCalled();
      }
    });

    it('logs warning and stays healthy when BehaviorFingerprint.getSuggestion throws and no other issues', () => {
      const eventBus = { emit: vi.fn() };
      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.recordAction = vi.fn();
        this.getSuggestion = vi.fn(() => {
          throw new Error('analysis failed');
        });
        this.reset = vi.fn();
      });

      const wd = new Watchdog({ eventBus, behaviorFingerprint: {} });
      wd._startTime = Date.now();
      wd._lastProgressTime = Date.now();
      wd._iterationCount = 0;
      wd._consecutiveSimilarCount = 0;

      const result = wd.checkHealth({
        maxIterations: Number.MAX_SAFE_INTEGER,
        maxTimeMs: Number.MAX_SAFE_INTEGER,
        stuckThresholdMs: Number.MAX_SAFE_INTEGER,
        oscillationConsecutiveThreshold: Number.MAX_SAFE_INTEGER,
      });

      expect(result.healthy).toBe(true);
      expect(result.issues).toEqual([]);
      expect(eventBus.emit).not.toHaveBeenCalled();
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.stringContaining('Watchdog: BehaviorFingerprint analysis failed')
      );
    });

    it('uses fallback intervention event name when WatchdogEvents.WATCHDOG_INTERVENTION is missing', () => {
      const eventBus = { emit: vi.fn() };
      const prev = WatchdogEvents.WATCHDOG_INTERVENTION;
      WatchdogEvents.WATCHDOG_INTERVENTION = undefined;
      try {
        const wd = new Watchdog({ eventBus, behaviorFingerprint: false });
        wd._iterationCount = 0;

        const result = wd.checkHealth({ maxIterations: 0 });
        expect(result.healthy).toBe(false);
        expect(eventBus.emit).toHaveBeenCalledWith(
          'watchdog.intervention',
          expect.objectContaining({
            actor: 'watchdog',
            status: 'info',
            payload: { issues: expect.any(Array) },
          })
        );
      } finally {
        WatchdogEvents.WATCHDOG_INTERVENTION = prev;
      }
    });
  });

  describe('intervene', () => {
    it('emits intervention payload and returns it (supports empty values)', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const eventBus = { emit: vi.fn() };
      const wd = new Watchdog({ eventBus, behaviorFingerprint: false });
      const payload = wd.intervene(null);

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
    });

    it('still notifies local observers when eventBus.emit is missing', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

      const wd = new Watchdog({ eventBus: {}, behaviorFingerprint: false });
      const handler = vi.fn();
      wd.observe(WatchdogEvents.WATCHDOG_INTERVENTION, handler);

      const payload = wd.intervene('reason', { extra: [] });
      expect(handler).toHaveBeenCalledWith(payload);
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

      const wd = new Watchdog({ behaviorFingerprint: {} });
      wd._iterationCount = 5;
      wd._recentOutputs = [{ fingerprint: 'x', tokens: new Set(['x']), timestamp: 1 }];
      wd._consecutiveSimilarCount = 2;
      wd._behaviorLastNotifiedLoopCount = 3;

      wd.reset();

      expect(resetMock).toHaveBeenCalled();
      expect(wd._iterationCount).toBe(0);
      expect(wd._recentOutputs).toEqual([]);
      expect(wd._consecutiveSimilarCount).toBe(0);
      expect(wd._behaviorLastNotifiedLoopCount).toBe(0);
    });

    it('ignores BehaviorFingerprint.reset errors', () => {
      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.reset = vi.fn(() => {
          throw new Error('reset failed');
        });
      });

      const wd = new Watchdog({ behaviorFingerprint: {} });
      expect(() => wd.reset()).not.toThrow();
    });
  });

  describe('resetOscillation', () => {
    it('clears oscillation window without resetting other counters', () => {
      const wd = new Watchdog({ behaviorFingerprint: false });
      wd._iterationCount = 4;
      wd._recentOutputs = [{ fingerprint: 'x', tokens: new Set(['x']), timestamp: 1 }];
      wd._consecutiveSimilarCount = 2;

      wd.resetOscillation();

      expect(wd._recentOutputs).toEqual([]);
      expect(wd._consecutiveSimilarCount).toBe(0);
      expect(wd._iterationCount).toBe(4);
    });
  });

  describe('resetToolLoop', () => {
    it('resets loop counters and calls BehaviorFingerprint.reset (ignores reset errors)', () => {
      const resetMock = vi.fn();
      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.reset = resetMock;
      });

      const wd = new Watchdog({ behaviorFingerprint: {} });
      wd._behaviorLastNotifiedLoopCount = 2;
      wd.resetToolLoop();
      expect(resetMock).toHaveBeenCalled();
      expect(wd._behaviorLastNotifiedLoopCount).toBe(0);

      behaviorFingerprintCtor.mockImplementation(function BehaviorFingerprintMock() {
        this.reset = vi.fn(() => {
          throw new Error('reset failed');
        });
      });
      const wdError = new Watchdog({ behaviorFingerprint: {} });
      wdError._behaviorLastNotifiedLoopCount = 2;
      expect(() => wdError.resetToolLoop()).not.toThrow();
      expect(wdError._behaviorLastNotifiedLoopCount).toBe(0);
    });
  });
});
