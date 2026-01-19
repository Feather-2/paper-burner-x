import { describe, it, expect, vi } from 'vitest';

import {
  ToolRegistry,
  normalizeToolResult,
  resolveToolExecutor,
} from '../../../js/agents/runtime/core/tool-registry.js';
import StatusController from '../../../js/agents/runtime/core/status-controller.js';
import {
  AgentStatus,
  StepStatus,
  isAgentActive,
  isAgentTerminal,
  isValidAgentStatus,
  isValidStepStatus,
} from '../../../js/agents/runtime/core/agent-status.js';
import {
  StageCancelledError,
  StagePausedError,
  StageTimeoutError,
  abortReasonToMessage,
  cancelledErrorFromSignal,
  fromErrorPayload,
  toErrorPayload,
} from '../../../js/agents/runtime/core/stage-errors.js';
import {
  ERROR_BOUNDARY_UNHANDLED,
  ErrorBoundary,
  ErrorCategory,
  categorizeError,
  createErrorInfo,
  getErrorBoundary,
  withErrorBoundary,
} from '../../../js/agents/runtime/core/error-boundary.js';
import MessageManager from '../../../js/agents/runtime/core/message-manager.js';
import { DEFAULT_CONTEXT_CONFIG, mergeContextConfig } from '../../../js/agents/runtime/core/context-config.js';
import WorkerRpcClient, { createRpcHandler } from '../../../js/agents/runtime/core/worker-rpc.js';
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
    expect(normalizeToolResult(withOk)).toEqual({ ok: false, success: false, data: undefined, error: 'bad', meta: undefined });

    // 带 ok 字段的失败结果
    expect(normalizeToolResult({ ok: false, error: 'bad', data: 3 })).toEqual({ ok: false, success: false, data: 3, error: 'bad', meta: undefined });
    // 带 ok 字段的成功结果
    expect(normalizeToolResult({ ok: true, data: 3 })).toEqual({ ok: true, success: true, data: 3, error: undefined, meta: undefined });
    // 不带 ok/success 的值会被包装为 data
    expect(normalizeToolResult('value')).toEqual({ ok: true, success: true, data: 'value' });

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
    expect(result).toMatchObject({ ok: true, data: 7 });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[tool-registry] BeforeHook failed for double: boom'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[tool-registry] AfterHook failed for double: after-boom'));

    const skipTool = vi.fn(async () => 'should-not-run');
    const registry2 = new ToolRegistry({ tools: { cached: skipTool } });
    registry2.useHook('before', async () => ({ skip: true, value: 'from-cache' }));

    const skipped = await registry2.callTool('cached', { value: 1 }, {});
    expect(skipped).toMatchObject({ ok: true, data: 'from-cache' });
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
    expect(denied).toMatchObject({
      ok: false,
      error: 'blocked',
    });
    expect(toolFn).not.toHaveBeenCalled();

    const registry2 = new ToolRegistry({ tools: { fetch: toolFn }, logger });
    registry2.usePolicyManager({
      check: vi.fn(async () => {
        throw new Error('policy-down');
      }),
    });

    const ok = await registry2.callTool('fetch', { url: 'https://example.com' }, {});
    expect(ok).toMatchObject({ ok: true, data: 'ok' });
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

describe('runtime/core agent-status', () => {
  it('validates status enums and helper predicates', () => {
    expect(isValidAgentStatus(AgentStatus.IDLE)).toBe(true);
    expect(isValidAgentStatus('nope')).toBe(false);

    expect(isValidStepStatus(StepStatus.PENDING)).toBe(true);
    expect(isValidStepStatus('nope')).toBe(false);

    expect(isAgentActive(AgentStatus.RUNNING)).toBe(true);
    expect(isAgentActive(AgentStatus.PAUSED)).toBe(true);
    expect(isAgentActive(AgentStatus.IDLE)).toBe(false);

    expect(isAgentTerminal(AgentStatus.COMPLETED)).toBe(true);
    expect(isAgentTerminal(AgentStatus.FAILED)).toBe(true);
    expect(isAgentTerminal(AgentStatus.RUNNING)).toBe(false);
  });
});

describe('runtime/core stage-errors', () => {
  it('serializes and restores StagePausedError', () => {
    const ts = 1_700_000_000_000;
    const err = new StagePausedError('Paused', {
      checkpointId: '  ckpt_1  ',
      reason: ' user ',
      timestamp: ts,
      runId: 'run_1',
    });

    expect(err.name).toBe('StagePausedError');
    expect(err.message).toBe('Paused');
    expect(err.checkpointId).toBe('ckpt_1');
    expect(err.reason).toBe('user');
    expect(err.timestamp).toBe(new Date(ts).toISOString());
    expect(err.runId).toBe('run_1');

    const json = err.toJSON();
    const roundTrip = StagePausedError.fromJSON(json);
    expect(roundTrip).toBeInstanceOf(StagePausedError);
    expect(roundTrip.toJSON()).toEqual(json);

    const defaultErr = StagePausedError.fromJSON(null);
    expect(defaultErr.message).toBe('Run paused');
    expect(defaultErr.checkpointId).toBe(null);
    expect(defaultErr.reason).toBe(null);
    expect(typeof defaultErr.timestamp).toBe('string');
    expect(defaultErr.runId).toBe(null);
  });

  it('converts abort reasons and signals into cancellation errors', () => {
    expect(abortReasonToMessage(' because ')).toBe(' because ');
    expect(abortReasonToMessage(new Error('boom'))).toBe('boom');
    expect(abortReasonToMessage(null, 'fallback')).toBe('fallback');

    const ac = new AbortController();
    ac.abort('user_cancelled');
    const cancelled = cancelledErrorFromSignal(ac.signal, 'demo');
    expect(cancelled).toBeInstanceOf(StageCancelledError);
    expect(cancelled.stageName).toBe('demo');
    expect(cancelled.message).toBe('user_cancelled');
  });

  it('round-trips rich errors through payloads (stack, cause, stage fields)', () => {
    const timeout = new StageTimeoutError('timed out', { stageName: 's1', timeoutMs: 123 });
    timeout.cause = new Error('root cause');

    const payload = toErrorPayload(timeout, { includeStack: true });
    expect(payload).toMatchObject({
      name: 'StageTimeoutError',
      message: 'timed out',
      stageName: 's1',
      timeoutMs: 123,
      cause: { name: 'Error', message: 'root cause' },
    });
    expect(typeof payload.stack).toBe('string');

    const payloadNoStack = toErrorPayload(timeout, { includeStack: false });
    expect(payloadNoStack.stack).toBeUndefined();

    const restored = fromErrorPayload(payload);
    expect(restored).toBeInstanceOf(StageTimeoutError);
    expect(restored.name).toBe('StageTimeoutError');
    expect(restored.message).toBe('timed out');
    expect(restored.stageName).toBe('s1');
    expect(restored.timeoutMs).toBe(123);
    expect(restored.cause).toBeInstanceOf(Error);
    expect(restored.cause?.message).toBe('root cause');

    const paused = new StagePausedError('Hold', { checkpointId: 'c1', reason: 'r1', runId: 'run' });
    const pausedPayload = toErrorPayload(paused, { includeStack: false });
    const pausedRestored = fromErrorPayload(pausedPayload);
    expect(pausedRestored).toBeInstanceOf(StagePausedError);
    expect(pausedRestored.message).toBe('Hold');
    expect(pausedRestored.checkpointId).toBe('c1');
    expect(pausedRestored.reason).toBe('r1');
    expect(pausedRestored.runId).toBe('run');

    expect(toErrorPayload('boom')).toEqual({ name: 'Error', message: 'boom' });
    expect(fromErrorPayload(null).message).toBe('Unknown error');
  });
});

describe('runtime/core error-boundary', () => {
  it('categorizes common error types', () => {
    expect(categorizeError(null)).toBe(ErrorCategory.UNKNOWN);

    const net = new Error('fetch failed');
    // @ts-expect-error: meta
    net.code = 'ECONNRESET';
    expect(categorizeError(net)).toBe(ErrorCategory.NETWORK);

    const timeout = new Error('Request timeout');
    timeout.name = 'TimeoutError';
    expect(categorizeError(timeout)).toBe(ErrorCategory.TIMEOUT);

    expect(categorizeError(new TypeError('Invalid input'))).toBe(ErrorCategory.VALIDATION);
    expect(categorizeError(new Error('Quota exceeded'))).toBe(ErrorCategory.QUOTA);
    expect(categorizeError(new Error('Permission denied'))).toBe(ErrorCategory.PERMISSION);

    const api = new Error('server');
    // @ts-expect-error: meta
    api.status = 500;
    expect(categorizeError(api)).toBe(ErrorCategory.EXTERNAL);
  });

  it('records errors, applies fallbacks, and supports rethrow/trim/recovery', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const onError = vi.fn();
      const onRecovery = vi.fn(() => {
        throw new Error('ignore-me');
      });

      const boundary = new ErrorBoundary({
        onError,
        onRecovery,
        maxErrors: 1,
        fallbacks: {
          [ErrorCategory.NETWORK]: () => 'network-ok',
          [ErrorCategory.TIMEOUT]: () => ERROR_BOUNDARY_UNHANDLED,
          [ErrorCategory.QUOTA]: () => {
            throw new Error('fallback-broke');
          },
        },
      });

      const netErr = Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' });
      await expect(boundary.wrap(async () => { throw netErr; })).resolves.toBe('network-ok');
      expect(boundary.stats.recovered).toBe(1);
      expect(onError).toHaveBeenCalledTimes(1);

      const timeoutErr = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      await expect(boundary.wrap(async () => { throw timeoutErr; }, { fallbackValue: 'local' })).resolves.toBe('local');

      const quotaErr = new Error('quota');
      await expect(boundary.wrap(async () => { throw quotaErr; }, { fallbackValue: 'after-fallback-fail' }))
        .resolves.toBe('after-fallback-fail');

      await expect(boundary.wrap(async () => { throw new Error('boom'); }, { rethrow: true })).rejects.toThrow('boom');

      // maxErrors=1 keeps only the latest entry
      expect(boundary.errors).toHaveLength(1);

      const info = createErrorInfo(new Error('x'), { any: 1 });
      boundary.report(new Error('y'), { ctx: true });
      boundary.markRecovered(boundary.errors[0].id);
      expect(boundary.stats.recovered).toBeGreaterThanOrEqual(0);
      expect(info).toMatchObject({ category: ErrorCategory.UNKNOWN, recovered: false });
      expect(typeof info.id).toBe('string');
      expect(typeof info.ts).toBe('number');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('supports the global degraded fallback behavior', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const boundary = getErrorBoundary();
      boundary.clear();

      const local = await withErrorBoundary(
        async () => { throw new Error('fetch failed'); },
        { context: { degrade: false }, fallbackValue: 'local' }
      );
      expect(local).toBe('local');
      expect(boundary.errors.at(-1)?.recovered).toBe(false);

      const onDegrade = vi.fn();
      const degraded = await withErrorBoundary(
        async () => { throw new Error('fetch failed'); },
        {
          context: { degrade: true, fallbackValue: 'degraded', onDegrade, stage: 'demo', runId: 'r1' },
          fallbackValue: 'local2',
        }
      );
      expect(degraded).toBe('degraded');
      expect(onDegrade).toHaveBeenCalledTimes(1);
      expect(boundary.errors.at(-1)?.recovered).toBe(true);

      const emit = vi.fn();
      const viaEmit = await withErrorBoundary(
        async () => { throw new Error('fetch failed'); },
        {
          context: { degrade: true, fallbackValue: 'emit-ok', emit, stage: 'agent' },
          fallbackValue: 'local3',
        }
      );
      expect(viaEmit).toBe('emit-ok');
      expect(emit).toHaveBeenCalledWith('agent.error.degraded', {
        actor: 'agent',
        status: 'degraded',
        payload: expect.objectContaining({ category: ErrorCategory.NETWORK, message: 'fetch failed' }),
      });

      const fallbackFactory = vi.fn(() => 'factory-ok');
      const factory = await withErrorBoundary(
        async () => { throw new Error('fetch failed'); },
        { context: { degrade: true, fallbackFactory }, fallbackValue: 'local4' }
      );
      expect(factory).toBe('factory-ok');

      const fallbackFactoryThrows = vi.fn(() => {
        throw new Error('nope');
      });
      const unhandled = await withErrorBoundary(
        async () => { throw new Error('fetch failed'); },
        { context: { degrade: true, fallbackFactory: fallbackFactoryThrows }, fallbackValue: 'local5' }
      );
      expect(unhandled).toBe('local5');
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('runtime/core message-manager', () => {
  it('tracks messages and token usage, including non-string payloads', () => {
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      tokenCounter,
      contextConfig: { contextWindow: 100, compressThreshold: 0.8 },
    });

    manager.addMessage({ role: 'user', content: 'hello' });
    expect(manager.messages).toHaveLength(1);
    expect(manager.tokenUsage).toEqual({ input: 5, output: 0, total: 5 });

    manager.addMessages([{ role: 'user', content: { a: 1 } }, { role: 'user', content: 'x' }]);
    // '{"a":1}' length 7 + 'x' length 1
    expect(manager.tokenUsage.total).toBe(5 + 7 + 1);

    const circular = {};
    // @ts-expect-error: intentional circular ref
    circular.self = circular;
    manager.addMessage({ role: 'user', content: circular });
    expect(manager.tokenUsage.total).toBe(5 + 7 + 1 + '[object Object]'.length);

    manager.setContextConfig({ tokenCounter: { count: () => 10 } });
    manager.addMessage({ role: 'user', content: 'unique' });
    expect(manager.tokenUsage.total).toBe(5 + 7 + 1 + '[object Object]'.length + 10);
  });

  it('schedules compression, records history, and supports reset semantics', async () => {
    const emit = vi.fn();
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      emit,
      stageName: 'demo',
      actor: 'bob',
      tokenCounter,
      contextConfig: { contextWindow: 10, compressThreshold: 0.5, compressCooldownMs: 0 },
    });

    // Make compression deterministic.
    manager._compressionCoordinator.shouldCompress = vi.fn(() => manager._tokenUsage.total > 5);
    manager._compressionCoordinator.maybeCompress = vi.fn(async (messages) => ({ messages: messages.slice(0, 1) }));

    manager.addMessages([
      { role: 'user', content: '12345' }, // 5 tokens
      { role: 'assistant', content: '67890' }, // +5 => 10 tokens, triggers compression
    ]);

    await manager.flushCompression({ maxRounds: 1 });
    expect(manager._compressionCoordinator.maybeCompress).toHaveBeenCalledTimes(1);
    expect(manager.messages).toHaveLength(1);
    expect(manager.getStatus().compressionCount).toBe(1);

    expect(emit).toHaveBeenCalledWith('demo.context.compressed', {
      actor: 'bob',
      status: 'info',
      payload: expect.objectContaining({ beforeCount: 2, afterCount: 1 }),
    });

    await manager.reset({ clearCompressionHistory: false });
    expect(manager.messages).toHaveLength(0);
    expect(manager.tokenUsage).toEqual({ input: 0, output: 0, total: 0 });
    expect(manager.getStatus().compressionCount).toBe(1);
  });

  it('respects compressCooldownMs before forcing the next compression round', async () => {
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      tokenCounter,
      contextConfig: { contextWindow: 100, compressThreshold: 0.8, compressCooldownMs: 50 },
    });
    const compressSpy = vi.spyOn(manager, '_compress').mockImplementation(async () => {});
    manager._compressionCoordinator.shouldCompress = vi.fn(() => true);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000));
      manager._lastCompressionAtMs = Date.now();
      manager._scheduleCompression();
      expect(manager._compressionPending).toBe(false);
      expect(manager._compressionCooldownTimer).not.toBe(null);

      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve(); // flush microtasks scheduled by queueMicrotask

      expect(compressSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      compressSpy.mockRestore();
    }
  });

  it('dispose() clears cooldown timers and cancels in-flight compression', async () => {
    const logger = { warn: vi.fn() };
    const tokenCounter = { count: (text) => text.length };
    const manager = new MessageManager({
      logger,
      tokenCounter,
      contextConfig: { contextWindow: 100, compressThreshold: 0.8, compressCooldownMs: 50 },
    });

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000));
      manager._lastCompressionAtMs = Date.now();
      manager._compressionCoordinator.shouldCompress = vi.fn(() => true);

      manager._scheduleCompression();
      expect(manager._compressionCooldownTimer).not.toBe(null);

      manager.dispose();
      expect(manager._disposed).toBe(true);
      expect(manager._compressionCooldownTimer).toBe(null);

      await vi.advanceTimersByTimeAsync(50);
      await Promise.resolve();
      expect(manager._compressionPending).toBe(false);
    } finally {
      vi.useRealTimers();
    }

    const manager2 = new MessageManager({
      logger,
      tokenCounter,
      contextConfig: { contextWindow: 10, compressThreshold: 0.1, compressCooldownMs: 0 },
    });
    manager2._compressionCoordinator.shouldCompress = vi.fn(() => true);
    manager2._compressionCoordinator.maybeCompress = vi.fn((_messages, runtime) => {
      const signal = runtime?.signal;
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
          return;
        }
        signal?.addEventListener(
          "abort",
          () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          },
          { once: true }
        );
      });
    });

    manager2._scheduleCompression({ force: true });
    await Promise.resolve(); // flush microtasks so _compress starts

    const pending = manager2._compressionPromise;
    expect(pending).not.toBe(null);

    manager2.dispose();
    await expect(pending).resolves.toBeUndefined();
    expect(manager2._compressionAbortController).toBe(null);
  });
});

describe('runtime/core context-config', () => {
  it('merges user config with defaults and freezes the result', () => {
    const merged = mergeContextConfig({ contextWindow: 42, useCompressionWorker: false });
    expect(merged.contextWindow).toBe(42);
    expect(merged.useCompressionWorker).toBe(false);
    expect(merged.compressThreshold).toBe(DEFAULT_CONTEXT_CONFIG.compressThreshold);
    expect(Object.isFrozen(merged)).toBe(true);

    // Non-object returns the shared default.
    expect(mergeContextConfig(null)).toBe(DEFAULT_CONTEXT_CONFIG);
    expect(mergeContextConfig(undefined)).toBe(DEFAULT_CONTEXT_CONFIG);
    expect(mergeContextConfig('nope')).toBe(DEFAULT_CONTEXT_CONFIG);
  });
});

describe('runtime/core worker-rpc', () => {
  it('performs request/response RPC calls and normalizes remote errors', async () => {
    const worker = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
      terminate: vi.fn(),
    };

    const client = new WorkerRpcClient({ worker, timeoutMs: 100 });
    expect(worker.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(worker.addEventListener).toHaveBeenCalledWith('error', expect.any(Function));

    const okPromise = client.call('ping', { n: 1 }, { transferables: [new ArrayBuffer(0)] });
    const request = worker.postMessage.mock.calls[0][0];
    expect(request).toMatchObject({ type: 'rpc:request', method: 'ping', params: { n: 1 } });

    client._onMessage({ data: { type: 'rpc:response', id: request.id, ok: true, result: 'pong' } });
    await expect(okPromise).resolves.toBe('pong');

    const errPromise = client.call('fail', {});
    const errExpectation = expect(errPromise).rejects.toMatchObject({ name: 'RemoteError', message: 'bad', code: 'E_BAD', stack: 'stack' });
    const request2 = worker.postMessage.mock.calls.find((c) => c[0]?.method === 'fail')?.[0];
    expect(request2).toMatchObject({ type: 'rpc:request', method: 'fail', params: {} });
    expect(request2.id).toEqual(expect.any(String));

    client._onMessage({
      data: {
        type: 'rpc:response',
        id: request2.id,
        ok: false,
        error: { message: 'bad', name: 'RemoteError', code: 'E_BAD', stack: 'stack' },
      },
    });
    await errExpectation;
  });

  it('handles validation, abort, timeout, and terminate paths', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const worker = {
      postMessage: vi.fn(),
      terminate: vi.fn(),
      onmessage: null,
      onerror: null,
    };

    try {
      const client = new WorkerRpcClient({ worker, timeoutMs: 10 });
      expect(typeof worker.onmessage).toBe('function');
      expect(typeof worker.onerror).toBe('function');

      await expect(client.call('', {})).rejects.toThrow(/method is required/i);

      const aborted = new AbortController();
      aborted.abort('stop');
      await expect(client.call('ping', {}, { signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError', message: 'stop' });

      vi.useFakeTimers();
      try {
        const timeoutPromise = client.call('slow', {});
        const timeoutExpectation = expect(timeoutPromise).rejects.toMatchObject({ name: 'TimeoutError' });
        const request = worker.postMessage.mock.calls.find((c) => c[0]?.method === 'slow')?.[0];
        expect(request).toMatchObject({ type: 'rpc:request', method: 'slow', params: {} });
        expect(request.id).toEqual(expect.any(String));

        await vi.advanceTimersByTimeAsync(10);
        await timeoutExpectation;

        // Timeout triggers a cancel message back to the worker.
        expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'rpc:cancel', id: request.id, reason: 'timeout' }));
      } finally {
        vi.useRealTimers();
      }

      // terminate() rejects pending calls.
      const pendingPromise = client.call('hang', {});
      const pendingExpectation = expect(pendingPromise).rejects.toThrow('bye');
      client.terminate('bye');
      await pendingExpectation;
      expect(worker.terminate).toHaveBeenCalledTimes(1);

      // _onError() rejects pending calls and clears the worker reference.
      const client2 = new WorkerRpcClient({ worker: { ...worker, terminate: vi.fn(), postMessage: vi.fn() } });
      const inFlight = client2.call('hang', {});
      const inFlightExpectation = expect(inFlight).rejects.toThrow('worker broke');
      client2._onError({ message: 'worker broke' });
      await inFlightExpectation;
      expect(client2.worker).toBe(null);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('creates worker-side handlers for success and failure responses', async () => {
    const originalSelf = globalThis.self;
    const postMessage = vi.fn();
    // @ts-expect-error: test shim
    globalThis.self = { postMessage };

    try {
      const handler = createRpcHandler({
        ok: async ({ value }) => value + 1,
        boom: async () => {
          throw new Error('nope');
        },
      });

      await handler({ data: { type: 'rpc:request', id: '1', method: 'ok', params: { value: 1 } } });
      expect(postMessage).toHaveBeenCalledWith({ type: 'rpc:response', id: '1', ok: true, result: 2 });

      await handler({ data: { type: 'rpc:request', id: '2', method: 'missing', params: {} } });
      expect(postMessage).toHaveBeenCalledWith({ type: 'rpc:response', id: '2', ok: false, error: 'Unknown method: missing' });

      await handler({ data: { type: 'rpc:request', id: '3', method: 'boom', params: {} } });
      expect(postMessage).toHaveBeenCalledWith({ type: 'rpc:response', id: '3', ok: false, error: 'nope' });

      // Non-rpc messages are ignored.
      await handler({ data: { type: 'other', id: '4' } });
    } finally {
      globalThis.self = originalSelf;
    }
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
