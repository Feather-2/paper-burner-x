import { describe, it, expect, vi } from 'vitest';

import {
  ToolRegistry,
  normalizeToolResult,
  resolveToolExecutor,
} from '../../../js/agents/runtime/core/tool-registry.js';
import StatusController from '../../../js/agents/runtime/core/status-controller.js';
import { AgentStatus } from '../../../js/agents/runtime/core/agent-status.js';
import { StagePausedError } from '../../../js/agents/runtime/core/stage-errors.js';
import { setRuntimeState, LoopRuntimeStatuses } from '../../../js/agents/runtime/telemetry/loop-runtime-state.js';
import { BaseAgentLoop, BaseStage } from '../../../js/agents/runtime/core/agent-loop.js';

function createTestEventBus() {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();

  const emitImpl = (eventName, evt) => {
    const handlers = listeners.get(eventName);
    if (!handlers) return;
    for (const handler of [...handlers]) handler(evt);
  };

  const bus = {
    emit: vi.fn(emitImpl),
    subscribe: vi.fn((eventName, handler, _options) => {
      const bucket = listeners.get(eventName) ?? new Set();
      bucket.add(handler);
      listeners.set(eventName, bucket);
      const unsub = vi.fn(() => bucket.delete(handler));
      return unsub;
    }),
  };

  return bus;
}

describe('runtime/core ToolRegistry', () => {
  it('normalizes tool results and resolves executors', () => {
    const withOk = { ok: false, error: 'bad' };
    expect(normalizeToolResult(withOk)).toBe(withOk);

    expect(normalizeToolResult({ error: 'bad', data: 3 })).toEqual({ ok: false, data: 3, error: 'bad' });
    expect(normalizeToolResult({ data: 3 })).toEqual({ ok: true, data: 3, error: undefined });
    expect(normalizeToolResult('value')).toEqual({ ok: true, data: 'value' });

    const fn = () => 'x';
    expect(resolveToolExecutor({ toolExecutor: fn })).toBe(fn);

    const container = { execute: vi.fn(() => 'ok') };
    const executor = resolveToolExecutor({ tools: container });
    expect(typeof executor).toBe('function');
    expect(executor('ping', { n: 1 })).toBe('ok');
    expect(container.execute).toHaveBeenCalledWith('ping', { n: 1 }, undefined);

    expect(resolveToolExecutor({ toolExecutor: {} })).toBe(null);
    expect(resolveToolExecutor({ tools: {} })).toBe(null);
  });

  it('registers tools from object/array/map and validates inputs', () => {
    const registry = new ToolRegistry();

    registry.registerTools({ a: () => 1 });
    registry.registerTools([
      ['b', () => 2],
      ['c', () => 3],
    ]);
    registry.registerTools(new Map([['d', () => 4]]));

    expect(registry.hasTool('a')).toBe(true);
    expect(registry.hasTool('d')).toBe(true);
    expect(registry.getToolNames().sort()).toEqual(['a', 'b', 'c', 'd']);

    expect(() => registry.registerTools('nope')).toThrow(/tools must be an object, array, or map/i);
    expect(() => registry.registerTool('', () => {})).toThrow(/name must be a non-empty string/i);
    expect(() => registry.registerTool('x', null)).toThrow(/fn must be a function/i);
  });

  it('runs before/after hooks (skip, param transform, result override)', async () => {
    const logger = { warn: vi.fn() };
    const toolFn = vi.fn(async ({ value }) => value * 2);
    const registry = new ToolRegistry({
      tools: { double: toolFn },
      logger,
    });

    registry.useHook('before', async ({ params }) => ({ params: { value: params.value + 1 } }));
    registry.useHook('before', async () => {
      throw new Error('boom');
    });
    registry.useHook('after', async ({ result }) => ({ ok: true, data: result.data + 1 }));
    registry.useHook('after', async () => {
      throw new Error('after-boom');
    });

    const context = { hello: 'world' };
    const result = await registry.callTool('double', { value: 2 }, context);

    expect(toolFn).toHaveBeenCalledWith({ value: 3 }, context);
    expect(result).toEqual({ ok: true, data: 7 });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[tool-registry] BeforeHook failed for double: boom'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[tool-registry] AfterHook failed for double: after-boom'));

    const skipTool = vi.fn(async () => 'should-not-run');
    const registry2 = new ToolRegistry({ tools: { cached: skipTool } });
    registry2.useHook('before', async () => ({ skip: true, value: 'from-cache' }));

    const skipped = await registry2.callTool('cached', { value: 1 }, {});
    expect(skipped).toEqual({ ok: true, data: 'from-cache' });
    expect(skipTool).not.toHaveBeenCalled();
  });

  it('warns on quota exceeded but still executes tool', async () => {
    const emit = vi.fn();
    const toolFn = vi.fn(async () => 'pong');
    const registry = new ToolRegistry({ tools: { ping: toolFn } });

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: 'too_many_calls' })),
      getToolStats: vi.fn(() => ({ limit: 1, used: 99 })),
      recordCall: vi.fn(),
    };

    const result = await registry.callTool(
      'ping',
      {},
      {
        eventBus: { emit },
        toolQuotaManager: quotaManager,
      }
    );

    expect(result).toMatchObject({ ok: true, data: 'pong', quota: { allowed: false, reason: 'too_many_calls' } });
    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(quotaManager.recordCall).toHaveBeenCalledWith('ping');

    expect(emit).toHaveBeenCalledWith('tool.quota.exceeded', {
      actor: 'system',
      status: 'exceeded',
      payload: { tool: 'ping', reason: 'too_many_calls', stats: { limit: 1, used: 99 } },
    });
  });

  it('blocks on quota exceeded when configured and still runs after-hooks', async () => {
    const emit = vi.fn();
    const toolFn = vi.fn(async () => 'pong');
    const afterHook = vi.fn(async () => undefined);

    const registry = new ToolRegistry({ tools: { ping: toolFn } });
    registry.useHook('after', afterHook);

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: 'hard_limit' })),
      getToolStats: vi.fn(() => ({ limit: 1, used: 1 })),
      recordCall: vi.fn(),
    };

    const result = await registry.callTool(
      'ping',
      { x: 1 },
      {
        eventBus: { emit },
        toolQuotaConfig: { mode: 'block' },
        toolQuotaManager: quotaManager,
      }
    );

    expect(toolFn).not.toHaveBeenCalled();
    expect(afterHook).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, error: 'hard_limit', quota: { limit: 1, used: 1 } });
    expect(quotaManager.recordCall).not.toHaveBeenCalled();
  });

  it('wraps calls in traceContext.withSpan and annotates failures', async () => {
    const registry = new ToolRegistry();

    /** @type {any} */
    let capturedSpan = null;
    let capturedOptions = null;
    const traceContext = {
      startSpan: vi.fn(),
      endSpan: vi.fn(),
      withSpan: vi.fn(async (name, fn, options) => {
        const span = { setAttribute: vi.fn(), setStatus: vi.fn() };
        capturedSpan = span;
        capturedOptions = { name, options };
        return await fn(span);
      }),
    };

    const result = await registry.callTool('missing', {}, { traceContext });
    expect(result.ok).toBe(false);

    expect(traceContext.withSpan).toHaveBeenCalledTimes(1);
    expect(capturedOptions).toEqual({ name: 'tool.missing', options: { attributes: { tool: 'missing' } } });
    expect(capturedSpan.setAttribute).toHaveBeenCalledWith('tool.name', 'missing');
    expect(capturedSpan.setStatus).toHaveBeenCalledWith('error', expect.stringContaining('Unknown tool'));
  });

  it('integrates PolicyManager (deny and fail-open)', async () => {
    const toolFn = vi.fn(async () => 'ok');
    const logger = { warn: vi.fn() };
    const registry = new ToolRegistry({ tools: { fetch: toolFn }, logger });

    const policyManager = {
      check: vi.fn(async () => ({ effect: 'deny', reason: 'blocked', ruleId: 'r1' })),
    };

    registry.usePolicyManager(policyManager);

    const denied = await registry.callTool('fetch', { url: 'https://example.com' }, {});
    expect(denied).toEqual({
      ok: false,
      error: 'blocked',
      policy: { effect: 'deny', ruleId: 'r1' },
    });
    expect(toolFn).not.toHaveBeenCalled();

    const registry2 = new ToolRegistry({ tools: { fetch: toolFn }, logger });
    registry2.usePolicyManager({
      check: vi.fn(async () => {
        throw new Error('policy-down');
      }),
    });

    const ok = await registry2.callTool('fetch', { url: 'https://example.com' }, {});
    expect(ok).toEqual({ ok: true, data: 'ok' });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[tool-registry] PolicyManager.check failed: policy-down'));
  });
});

describe('runtime/core StatusController', () => {
  it('tracks status transitions and emits change events', () => {
    const emit = vi.fn();
    const controller = new StatusController({
      eventName: 'loop.status',
      emit,
      stageName: 'demo',
      actor: 'bob',
      strict: true,
    });

    expect(controller.status).toBe(AgentStatus.IDLE);
    expect(controller.statusHistory).toEqual([]);

    const entry = controller.transition(AgentStatus.RUNNING);
    expect(entry).toMatchObject({ from: AgentStatus.IDLE, to: AgentStatus.RUNNING });
    expect(controller.status).toBe(AgentStatus.RUNNING);
    expect(controller.statusHistory).toHaveLength(1);

    expect(emit).toHaveBeenCalledWith('loop.status', {
      actor: 'bob',
      status: 'info',
      payload: expect.objectContaining({ from: AgentStatus.IDLE, to: AgentStatus.RUNNING }),
    });
  });

  it('rejects invalid transitions in strict mode', () => {
    const controller = new StatusController({ strict: true, stageName: 'demo' });
    expect(() => controller.transition(AgentStatus.PAUSED)).toThrow(/loopStatus transition rejected/i);
    expect(controller.status).toBe(AgentStatus.IDLE);
    expect(controller.statusHistory).toEqual([]);
  });

  it('records invalid transitions when strict is disabled', () => {
    const logger = { warn: vi.fn() };
    const controller = new StatusController({ strict: false, stageName: 'demo', logger });

    const entry = controller.transition(AgentStatus.PAUSED);
    expect(entry).toMatchObject({ from: AgentStatus.IDLE, to: AgentStatus.PAUSED, invalid: true });
    expect(controller.status).toBe(AgentStatus.PAUSED);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('loopStatus transition rejected'));
  });

  it('uses a machine when provided and tolerates machine errors (non-strict)', () => {
    const logger = { warn: vi.fn() };
    const machine = vi.fn(() => {
      throw new Error('machine-broke');
    });
    const controller = new StatusController({ strict: false, machine, stageName: 'demo', logger });

    const entry = controller.transition(AgentStatus.RUNNING);
    expect(entry).toMatchObject({ from: AgentStatus.IDLE, to: AgentStatus.RUNNING, invalid: true });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('loopStatus machine threw: machine-broke'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('loopStatus transition rejected'));
  });

  it('creates pause errors and detects pause-related aborts', () => {
    const controller = new StatusController({ strict: true });
    const ac = new AbortController();

    setRuntimeState(ac.signal, {
      status: LoopRuntimeStatuses.PAUSED,
      pausedReason: 'user',
      lastCheckpointId: 'ckpt_1',
    });

    expect(() => controller.checkPaused(ac.signal)).toThrow(StagePausedError);

    controller.pause('manual');
    const err = controller.createPauseError({ signal: ac.signal, runId: 'run_1' });
    expect(err).toBeInstanceOf(StagePausedError);
    expect(err.reason).toBe('user');
    expect(err.checkpointId).toBe('ckpt_1');
    expect(err.runId).toBe('run_1');

    const abortErr = { name: 'AbortError' };
    expect(controller.shouldPauseFromError(abortErr, ac.signal)).toBe(true);
    controller.resume();
    expect(controller.shouldPauseFromError(abortErr, null)).toBe(false);

    expect(controller._isAbortError(new Error('Cancelled by user'), null)).toBe(true);
    expect(controller._isAbortError(new Error('random'), null)).toBe(false);
  });
});

describe('runtime/core agent-loop', () => {
  it('BaseStage emits started/completed/failed around run()', async () => {
    const bus = { emit: vi.fn() };

    class DemoStage extends BaseStage {
      async run(input) {
        if (input?.fail) throw new Error('boom');
        return { ok: true };
      }
    }

    const stage = new DemoStage({ name: 'demo', eventBus: bus });
    const signal = new AbortController().signal;

    const ok = await stage.execute({ runId: 'r1' }, { fail: false }, { signal, eventBus: bus });
    expect(ok).toEqual({ ok: true });

    expect(bus.emit).toHaveBeenCalledWith('demo.started', { actor: 'demo', status: 'started', payload: {} });
    expect(bus.emit).toHaveBeenCalledWith('demo.completed', {
      actor: 'demo',
      status: 'completed',
      payload: { result: { ok: true } },
    });

    await expect(stage.execute({ runId: 'r1' }, { fail: true }, { signal, eventBus: bus })).rejects.toThrow('boom');
    expect(bus.emit).toHaveBeenCalledWith('demo.failed', {
      actor: 'demo',
      status: 'failed',
      payload: { error: 'boom' },
    });
  });

  it('BaseAgentLoop manages user inputs, steps, and action waiting', async () => {
    const emit = vi.fn();

    class DemoLoop extends BaseAgentLoop {
      async run() {
        return 'ok';
      }
    }

    const loop = new DemoLoop({ stageName: 'demo', actor: 'bob', emit });

    loop.recordUserInput('  hello  ');
    loop.recordUserInput({ text: ' world ' });
    loop.recordUserInput({ message: '!' });

    expect(loop.hasPendingUserInputs()).toBe(true);
    const drained = loop.drainUserInputsAsText();
    expect(drained.text).toBe('hello\nworld\n!');
    expect(loop.hasPendingUserInputs()).toBe(false);

    loop.recordUserInput('note');
    const merged = loop.applyUserInputsToConfig({ userNotes: 'first' });
    expect(merged.userNotes).toEqual(['first', 'note']);
    expect(merged._lastUserNote).toBe('note');
    expect(Array.isArray(merged._rawUserInputs)).toBe(true);

    const parent = new AbortController();
    const started = loop._beginStep({ name: 'work' }, { signal: parent.signal });
    expect(started.step.stepId.startsWith('demo_')).toBe(true);
    expect(loop.isPaused).toBe(false);

    loop.pause('user_requested');
    expect(loop.isPaused).toBe(true);
    expect(started.context.signal.aborted).toBe(true);

    loop._endStep({ step: started.step }, { status: 'failed', error: 'oops' });
    expect(emit).toHaveBeenCalledWith('demo.step.started', {
      actor: 'bob',
      status: 'started',
      payload: expect.objectContaining({ stepId: started.step.stepId }),
    });
    expect(emit).toHaveBeenCalledWith('demo.step.failed', {
      actor: 'bob',
      status: 'failed',
      payload: expect.objectContaining({ stepId: started.step.stepId, error: 'oops' }),
    });

    const bus = createTestEventBus();
    const waitPromise = loop.waitForUserAction('confirm', { eventBus: bus, timeout: 1000 });
    bus.emit('user.action.confirm', { payload: { ok: true } });
    await expect(waitPromise).resolves.toEqual({ ok: true });

    vi.useFakeTimers();
    try {
      const timeoutPromise = loop.waitForUserAction('slow', { eventBus: bus, timeout: 10 });
      vi.advanceTimersByTime(10);
      await expect(timeoutPromise).rejects.toThrow(/Timeout waiting/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('execute() attaches and detaches eventBus listeners', async () => {
    class DemoLoop extends BaseAgentLoop {
      async run(_input, context) {
        context.eventBus.emit('user.input', { payload: 'hi' });
        context.eventBus.emit('user.action.pause', { payload: { reason: 'break' } });
        return 'done';
      }
    }

    const bus = createTestEventBus();
    const loop = new DemoLoop({ stageName: 'demo', actor: 'bob' });

    const result = await loop.execute({}, {}, { eventBus: bus, signal: new AbortController().signal });
    expect(result).toBe('done');

    expect(bus.subscribe).toHaveBeenCalledWith('user.input', expect.any(Function), expect.any(Object));
    expect(bus.subscribe).toHaveBeenCalledWith('user.action.pause', expect.any(Function), expect.any(Object));

    // Both listeners should be detached after execute() finishes.
    const unsubs = bus.subscribe.mock.results.map((r) => r.value);
    expect(unsubs).toHaveLength(2);
    expect(unsubs[0]).toHaveBeenCalledTimes(1);
    expect(unsubs[1]).toHaveBeenCalledTimes(1);

    const inputs = loop.consumeUserInputs();
    expect(inputs.map((i) => i.payload)).toEqual(['hi']);
    expect(loop.isPaused).toBe(true);
    expect(loop._pauseReason).toBe('break');
  });
});
