import { describe, it, expect, vi, beforeEach } from 'vitest';

const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerDebugMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());
const createLoggerMock = vi.hoisted(() =>
  vi.fn(() => ({
    info: loggerInfoMock,
    warn: loggerWarnMock,
    debug: loggerDebugMock,
    error: loggerErrorMock,
  }))
);

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  createLogger: createLoggerMock,
}));

import {
  ConvergenceDetector,
  BehaviorFingerprint,
  ContextDistiller,
  fingerprintPlugin,
} from '../../../../../js/agents/plugins/analysis/index.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ConvergenceDetector', () => {
  it('clamps window size and accepts numeric strings', () => {
    const detector = new ConvergenceDetector({ windowSize: '3' });
    expect(detector._windowSize).toBe(3);

    const zeroDetector = new ConvergenceDetector({ windowSize: 0 });
    expect(zeroDetector._windowSize).toBe(2);

    const negativeDetector = new ConvergenceDetector({ windowSize: -1 });
    expect(negativeDetector._windowSize).toBe(2);

    const maxDetector = new ConvergenceDetector({ windowSize: Number.MAX_SAFE_INTEGER });
    expect(maxDetector._windowSize).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('handles empty and non-string inputs without throwing', () => {
    const detector = new ConvergenceDetector();
    const inputs = [null, undefined, '', '   ', [], {}, 0];

    inputs.forEach((input, index) => {
      const result = detector.addSample(input);
      expect(result.metrics.sampleCount).toBe(index + 1);
    });

    const final = detector.addSample('normal text');
    expect(final.metrics.sampleCount).toBe(inputs.length + 1);
  });

  it('detects convergence and triggers callback', () => {
    const onConvergence = vi.fn();
    const detector = new ConvergenceDetector({
      windowSize: 4,
      entropyThreshold: 1,
      similarityThreshold: 0.5,
      onConvergence,
    });

    detector.addSample('repeat repeat');
    detector.addSample('repeat repeat');
    detector.addSample('repeat repeat');
    const result = detector.addSample('repeat repeat');

    expect(result.converged).toBe(true);
    expect(detector.isConverged()).toBe(true);
    expect(onConvergence).toHaveBeenCalledTimes(1);
  });

  it('returns diversify suggestion when similarity is high but not converged', () => {
    const detector = new ConvergenceDetector({
      windowSize: 4,
      entropyThreshold: 0,
      similarityThreshold: 0.99,
    });

    detector.addSample('repeat repeat');
    detector.addSample('repeat repeat');
    detector.addSample('repeat repeat');
    detector.addSample('repeat repeat');

    const suggestion = detector.getSuggestion();
    expect(suggestion.action).toBe('diversify');
  });

  it('returns focus suggestion for high entropy', () => {
    const detector = new ConvergenceDetector();
    const unique = Array.from({ length: 40 }, (_, i) => `token${i}`).join(' ');

    detector.addSample(unique);
    const suggestion = detector.getSuggestion();

    expect(suggestion.action).toBe('focus');
  });

  it('handles rapid consecutive calls and caps history', async () => {
    const detector = new ConvergenceDetector({ windowSize: 3 });
    const samples = Array.from({ length: 10 }, (_, i) => `sample ${i}`);

    await Promise.all(
      samples.map((text) => Promise.resolve().then(() => detector.addSample(text)))
    );

    expect(detector._history.length).toBeLessThanOrEqual(6);
    expect(detector.getMetrics().sampleCount).toBe(detector._history.length);
  });

  it('handles very large input strings', () => {
    const detector = new ConvergenceDetector();
    const largeText = 'word '.repeat(20000);

    const result = detector.addSample(largeText);

    expect(result.metrics.sampleCount).toBe(1);
  });
});

describe('BehaviorFingerprint', () => {
  it('accepts numeric string options and clamps boundaries', () => {
    const fingerprint = new BehaviorFingerprint({
      historySize: '20',
      minPatternLength: '2',
      maxPatternLength: '4',
      loopThreshold: '2',
    });

    expect(fingerprint._historySize).toBe(20);
    expect(fingerprint._minPatternLength).toBe(2);
    expect(fingerprint._maxPatternLength).toBe(4);
    expect(fingerprint._loopThreshold).toBe(2);

    const clamped = new BehaviorFingerprint({ historySize: 0, loopThreshold: -1 });
    expect(clamped._historySize).toBe(10);
    expect(clamped._loopThreshold).toBe(2);
  });

  it('handles empty or invalid actions without throwing', () => {
    const fingerprint = new BehaviorFingerprint();
    const inputs = [null, undefined, '', [], {}];

    inputs.forEach((input) => {
      const result = fingerprint.recordAction(input);
      expect(result.loopDetected).toBe(false);
    });

    const analysis = fingerprint.getAnalysis();
    expect(analysis.totalActions).toBe(inputs.length);
  });

  it('detects consecutive loops and invokes onLoopDetected', () => {
    const onLoopDetected = vi.fn();
    const fingerprint = new BehaviorFingerprint({
      minPatternLength: 2,
      maxPatternLength: 2,
      loopThreshold: 2,
      onLoopDetected,
    });

    fingerprint.recordAction({ type: 'a' });
    fingerprint.recordAction({ type: 'b' });
    fingerprint.recordAction({ type: 'a' });
    const result = fingerprint.recordAction({ type: 'b' });

    expect(result.loopDetected).toBe(true);
    expect(result.loopInfo.pattern).toHaveLength(2);
    expect(result.loopInfo.startPosition).toBe(0);
    expect(onLoopDetected).toHaveBeenCalledTimes(1);
    expect(fingerprint.isInLoop()).toBe(true);
    expect(loggerWarnMock).toHaveBeenCalled();
  });

  it('returns diversify suggestion for low diversity with high loop threshold', () => {
    const fingerprint = new BehaviorFingerprint({
      loopThreshold: Number.MAX_SAFE_INTEGER,
    });

    for (let i = 0; i < 11; i++) {
      fingerprint.recordAction({ type: 'repeat' });
    }

    const suggestion = fingerprint.getSuggestion();
    expect(suggestion.action).toBe('diversify');
    expect(suggestion.severity).toBe('medium');
  });

  it('handles empty history and string counts for recent actions', () => {
    const fingerprint = new BehaviorFingerprint();

    const emptyAnalysis = fingerprint.getAnalysis();
    expect(emptyAnalysis.totalActions).toBe(0);
    expect(emptyAnalysis.diversityScore).toBe(1);

    fingerprint.recordAction({ type: 'first' });
    fingerprint.recordAction({ type: 'second' });

    const recent = fingerprint.getRecentActions('1');
    expect(recent).toHaveLength(1);
    expect(recent[0].signature).toBe('second:');
  });

  it('reset clears history and loop counters', () => {
    const fingerprint = new BehaviorFingerprint();

    fingerprint.recordAction({ type: 'alpha' });
    fingerprint.recordAction({ type: 'beta' });
    fingerprint.reset();

    const stats = fingerprint.stats;
    expect(stats.historySize).toBe(0);
    expect(stats.loopCount).toBe(0);
    expect(stats.hasActiveLoop).toBe(false);
  });
});

describe('ContextDistiller', () => {
  it('returns empty object when inputs are missing', () => {
    const distiller = new ContextDistiller();

    expect(distiller.distill(null, 'task')).toEqual({});
    expect(distiller.distill({}, '')).toEqual({});
    expect(distiller.distill(undefined, undefined)).toEqual({});
  });

  it('extracts relevant context and summarizes tools', () => {
    const distiller = new ContextDistiller({ relevanceThreshold: 0.2 });
    const parentContext = {
      taskGoal: `Fix login issue ${'x'.repeat(220)}`,
      discoveries: ['login endpoint fails', 'unrelated note'],
      constraints: ['limit memory', 'use cache', 'no network', 'extra'],
      toolHistory: [{ name: 'search' }, { tool: 'fetch' }, { name: 'search' }],
      decisions: ['use login api', 'unrelated decision'],
    };

    const result = distiller.distill(parentContext, 'login fix');

    expect(result.parentGoal.length).toBeLessThanOrEqual(200);
    expect(result.parentGoal.endsWith('...')).toBe(true);
    expect(result.relevantDiscoveries).toEqual(['login endpoint fails']);
    expect(result.constraints).toEqual(['limit memory', 'use cache', 'no network']);
    expect(result.toolSummary).toEqual({ search: 2, fetch: 1 });
    expect(result.keyDecisions).toEqual(['use login api']);
    expect(result.childTask).toBe('login fix');
    expect(typeof result.distilledAt).toBe('number');
  });

  it('enforces token limit, handles deep context, and ignores non-array discoveries', () => {
    const distiller = new ContextDistiller({ maxTokens: 20, relevanceThreshold: 0 });
    const deepDecision = { level: { one: { two: { three: { four: 'value' } } } } };
    const parentContext = {
      taskGoal: 'A'.repeat(5000),
      discoveries: { not: 'array' },
      constraints: ['one', 'two', 'three', 'four', 'five'],
      toolHistory: [{ name: 'alpha' }, { name: 'beta' }, { name: 'beta' }],
      decisions: [deepDecision, 'another decision'],
    };

    const result = distiller.distill(parentContext, 'alpha beta');

    expect(result.relevantDiscoveries).toBeUndefined();
    expect(result.constraints.length).toBeLessThan(parentContext.constraints.length);
    expect(result.keyDecisions.length).toBeLessThan(parentContext.decisions.length);
    expect(result.parentGoal.endsWith('...')).toBe(true);
    expect(result.keyDecisions[0]).toEqual(deepDecision);
  });
});

describe('fingerprintPlugin', () => {
  const buildContext = (overrides = {}) => {
    const registered = new Map();
    const ctx = {
      config: {
        windowSize: 2,
        similarityThreshold: 0.5,
        maxHistory: 3,
        ...overrides,
      },
      registerService: vi.fn((name, service) => {
        registered.set(name, service);
      }),
      services: {
        call: vi.fn(),
      },
      events: {
        emit: vi.fn(),
      },
      state: {
        set: vi.fn(),
      },
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      on: vi.fn((event, handler) => {
        ctx._handlers = ctx._handlers || [];
        ctx._handlers.push({ event, handler });
        return vi.fn();
      }),
    };

    return { ctx, registered };
  };

  it('exposes plugin metadata and defaults', () => {
    expect(fingerprintPlugin.name).toBe('analysis/fingerprint');
    expect(fingerprintPlugin.version).toBe('1.0.0');
    expect(fingerprintPlugin.defaultConfig).toEqual({
      windowSize: 5,
      similarityThreshold: 0.85,
      maxHistory: 50,
    });
  });

  it('registers fingerprint service and tracks history', async () => {
    const { ctx, registered } = buildContext();

    await fingerprintPlugin.install(ctx);

    expect(ctx.registerService).toHaveBeenCalledWith('fingerprint', expect.any(Object));

    const service = registered.get('fingerprint');
    const result = await service.analyze({
      type: 'tool_call',
      name: 'search',
      args: { q: 'query' },
    });

    expect(result.fingerprint).toBe('tool_call:search:q');
    expect(result.similarity).toBe(0);
    expect(ctx.state.set).toHaveBeenCalledWith('lastAnalysis', result);
    expect(service.getHistory()).toHaveLength(1);

    service.reset();
    expect(service.getHistory()).toHaveLength(0);
  });

  it('emits events on similarity threshold and handles null actions', async () => {
    const { ctx, registered } = buildContext({ similarityThreshold: 0.1 });

    await fingerprintPlugin.install(ctx);
    const service = registered.get('fingerprint');

    const emptyResult = await service.analyze();
    expect(emptyResult.fingerprint).toBe('unknown:');

    const action = { type: 'tool_call', name: 'search', args: { q: 'x' } };
    await service.analyze(action);
    await service.analyze(action);

    expect(ctx.events.emit).toHaveBeenCalledWith(
      'fingerprint:loopDetected',
      expect.objectContaining({
        action,
        similarity: expect.any(Number),
        loopLength: expect.any(Number),
      })
    );
  });

  it('wires tool call events to fingerprint analyze', async () => {
    const { ctx } = buildContext();

    await fingerprintPlugin.install(ctx);

    const handlerEntry = ctx._handlers.find((entry) => entry.event === 'tool:call:*');
    expect(handlerEntry).toBeTruthy();

    await handlerEntry.handler({ payload: { name: 'fetch', args: { url: 'http://x' } } });

    expect(ctx.services.call).toHaveBeenCalledWith('fingerprint', 'analyze', [
      { type: 'tool_call', name: 'fetch', args: { url: 'http://x' } },
    ]);
  });
});
