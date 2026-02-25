/**
 * HookRegistry 单元测试
 *
 * 覆盖: HookType / HookEvent 枚举, HookRegistry CRUD + match,
 *       createHookMiddleware 中间件生成
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  HookType,
  HookEvent,
  HookRegistry,
  createHookMiddleware,
  HookBuilder,
  hook,
} from '../hook-registry.js';

// ── HookType / HookEvent enums ─────────────────────────────────

describe('HookType / HookEvent enums', () => {
  it('HookType has COMMAND, PROMPT, AGENT values', () => {
    expect(HookType.COMMAND).toBe('command');
    expect(HookType.PROMPT).toBe('prompt');
    expect(HookType.AGENT).toBe('agent');
  });

  it('HookEvent has all 6 lifecycle values', () => {
    expect(HookEvent.PRE_AGENT).toBe('PreAgent');
    expect(HookEvent.POST_AGENT).toBe('PostAgent');
    expect(HookEvent.PRE_LLM_CALL).toBe('PreLLMCall');
    expect(HookEvent.POST_LLM_CALL).toBe('PostLLMCall');
    expect(HookEvent.PRE_TOOL_USE).toBe('PreToolUse');
    expect(HookEvent.POST_TOOL_USE).toBe('PostToolUse');
  });

  it('HookType is frozen', () => {
    expect(Object.isFrozen(HookType)).toBe(true);
  });

  it('HookEvent is frozen', () => {
    expect(Object.isFrozen(HookEvent)).toBe(true);
  });
});

// ── HookRegistry ────────────────────────────────────────────────

describe('HookRegistry', () => {
  /** @type {HookRegistry} */
  let reg;

  const cmdHook = () => ({ type: 'command', handler: vi.fn() });
  const promptHook = () => ({ type: 'prompt', prompt: 'Summarize {{input}}' });
  const agentHook = () => ({ type: 'agent', agentType: 'reviewer' });

  beforeEach(() => {
    reg = new HookRegistry();
  });

  // ── register ────────────────────────────────────────────────

  describe('register', () => {
    it('valid command hook succeeds', () => {
      const def = reg.register('PreToolUse', cmdHook());
      expect(def.type).toBe('command');
      expect(typeof def.handler).toBe('function');
    });

    it('valid prompt hook (with prompt field) succeeds', () => {
      const def = reg.register('PreLLMCall', promptHook());
      expect(def.type).toBe('prompt');
      expect(def.prompt).toBe('Summarize {{input}}');
    });

    it('valid agent hook (with agentType field) succeeds', () => {
      const def = reg.register('PreAgent', agentHook());
      expect(def.type).toBe('agent');
      expect(def.agentType).toBe('reviewer');
    });

    it('throws on empty eventName', () => {
      expect(() => reg.register('', cmdHook())).toThrow(/non-empty string/);
    });

    it('throws on non-object def', () => {
      expect(() => reg.register('PreToolUse', 'bad')).toThrow(/must be an object/);
    });

    it('throws on invalid type', () => {
      expect(() => reg.register('PreToolUse', { type: 'unknown' })).toThrow(/type must be one of/);
    });

    it('throws on prompt type without prompt field', () => {
      expect(() => reg.register('PreLLMCall', { type: 'prompt' })).toThrow(/prompt is required/);
    });

    it('throws on agent type without agentType', () => {
      expect(() => reg.register('PreAgent', { type: 'agent' })).toThrow(/agentType is required/);
    });

    it('normalizes type to lowercase', () => {
      const def = reg.register('PreToolUse', { type: 'COMMAND', handler: vi.fn() });
      expect(def.type).toBe('command');
    });

    it('blocking defaults to true', () => {
      const def = reg.register('PreToolUse', cmdHook());
      expect(def.blocking).toBe(true);
    });

    it('blocking=false preserved', () => {
      const def = reg.register('PreToolUse', { ...cmdHook(), blocking: false });
      expect(def.blocking).toBe(false);
    });

    // --- Three-dimension fields ---

    it('lifecycle fields normalized', () => {
      const def = reg.register('PreToolUse', {
        ...cmdHook(),
        lifecycle: { maxExecutions: 3, scope: 'session', cooldown: 5000 },
      });
      expect(def.lifecycle.maxExecutions).toBe(3);
      expect(def.lifecycle.scope).toBe('session');
      expect(def.lifecycle.cooldown).toBe(5000);
      expect(def._execCount).toBe(0);
      expect(def._lastExecTime).toBe(0);
    });

    it('throws on invalid lifecycle.maxExecutions', () => {
      expect(() => reg.register('PreToolUse', {
        ...cmdHook(), lifecycle: { maxExecutions: -1 },
      })).toThrow(/positive integer/);
    });

    it('throws on invalid lifecycle.scope', () => {
      expect(() => reg.register('PreToolUse', {
        ...cmdHook(), lifecycle: { scope: 'invalid' },
      })).toThrow(/scope must be one of/);
    });

    it('when field preserved as-is', () => {
      const when = { 'tokens.used': { $gt: 4000 } };
      const def = reg.register('PreToolUse', { ...cmdHook(), when });
      expect(def.when).toEqual(when);
    });

    it('throws on non-object when', () => {
      expect(() => reg.register('PreToolUse', {
        ...cmdHook(), when: 'bad',
      })).toThrow(/when must be a plain object/);
    });

    it('gate field normalized', () => {
      const def = reg.register('PreToolUse', {
        ...cmdHook(), gate: { type: 'llm', prompt: 'safe?', fallback: 'allow' },
      });
      expect(def.gate.type).toBe('llm');
      expect(def.gate.prompt).toBe('safe?');
      expect(def.gate.fallback).toBe('allow');
    });

    it('throws on invalid gate.type', () => {
      expect(() => reg.register('PreToolUse', {
        ...cmdHook(), gate: { type: 'invalid' },
      })).toThrow(/gate.type must be one of/);
    });

    it('protected defaults to false, authority defaults to agent', () => {
      const def = reg.register('PreToolUse', cmdHook());
      expect(def.protected).toBe(false);
      expect(def.authority).toBe('agent');
    });

    it('protected=true preserved', () => {
      const def = reg.register('PreToolUse', { ...cmdHook(), protected: true, authority: 'system' });
      expect(def.protected).toBe(true);
      expect(def.authority).toBe('system');
    });

    it('throws on invalid authority', () => {
      expect(() => reg.register('PreToolUse', {
        ...cmdHook(), authority: 'root',
      })).toThrow(/authority must be one of/);
    });
  });

  // ── list ─────────────────────────────────────────────────────

  describe('list', () => {
    it('returns empty array for unknown event', () => {
      expect(reg.list('NoSuchEvent')).toEqual([]);
    });

    it('returns registered hooks', () => {
      reg.register('PreToolUse', cmdHook());
      reg.register('PreToolUse', cmdHook());
      expect(reg.list('PreToolUse')).toHaveLength(2);
    });

    it('returns copy (not reference)', () => {
      reg.register('PreToolUse', cmdHook());
      const a = reg.list('PreToolUse');
      const b = reg.list('PreToolUse');
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });

  // ── clear ────────────────────────────────────────────────────

  describe('clear', () => {
    it('clears specific event', () => {
      reg.register('PreToolUse', cmdHook());
      reg.register('PreAgent', cmdHook());
      reg.clear('PreToolUse');
      expect(reg.list('PreToolUse')).toHaveLength(0);
      expect(reg.list('PreAgent')).toHaveLength(1);
    });

    it('clears all when no arg', () => {
      reg.register('PreToolUse', cmdHook());
      reg.register('PreAgent', cmdHook());
      reg.clear();
      expect(reg.list('PreToolUse')).toHaveLength(0);
      expect(reg.list('PreAgent')).toHaveLength(0);
    });
  });

  // ── disable / enable ───────────────────────────────────────────

  describe('disable / enable', () => {
    it('disabled hook excluded from match()', () => {
      const def = reg.register('PreToolUse', cmdHook());
      expect(reg.match('PreToolUse', 'any')).toHaveLength(1);
      reg.disable(def);
      expect(reg.match('PreToolUse', 'any')).toHaveLength(0);
    });

    it('enable restores disabled hook', () => {
      const def = reg.register('PreToolUse', cmdHook());
      reg.disable(def);
      reg.enable(def);
      expect(reg.match('PreToolUse', 'any')).toHaveLength(1);
    });

    it('protected hook cannot be disabled', () => {
      const def = reg.register('PreToolUse', { ...cmdHook(), protected: true, authority: 'system' });
      const result = reg.disable(def);
      expect(result).toBe(false);
      expect(reg.match('PreToolUse', 'any')).toHaveLength(1);
    });
  });

  // ── resetLifecycle ────────────────────────────────────────────

  describe('resetLifecycle', () => {
    it('resets run-scoped hooks', () => {
      const def = reg.register('PreToolUse', {
        ...cmdHook(), lifecycle: { maxExecutions: 2, scope: 'run' },
      });
      def._execCount = 2;
      reg.resetLifecycle('run');
      expect(def._execCount).toBe(0);
    });

    it('does not reset session-scoped hooks on run reset', () => {
      const def = reg.register('PreToolUse', {
        ...cmdHook(), lifecycle: { maxExecutions: 5, scope: 'session' },
      });
      def._execCount = 3;
      reg.resetLifecycle('run');
      expect(def._execCount).toBe(3);
    });

    it('session reset also resets run-scoped hooks', () => {
      const def = reg.register('PreToolUse', {
        ...cmdHook(), lifecycle: { maxExecutions: 5, scope: 'run' },
      });
      def._execCount = 4;
      reg.resetLifecycle('session');
      expect(def._execCount).toBe(0);
    });
  });

  // ── match ────────────────────────────────────────────────────

  describe('match', () => {
    it('returns all hooks when no tool patterns', () => {
      reg.register('PreToolUse', cmdHook());
      reg.register('PreToolUse', cmdHook());
      expect(reg.match('PreToolUse', 'AnyTool')).toHaveLength(2);
    });

    it('filters by exact tool name', () => {
      reg.register('PreToolUse', { ...cmdHook(), tools: ['WriteFile'] });
      reg.register('PreToolUse', { ...cmdHook(), tools: ['ReadFile'] });
      const matched = reg.match('PreToolUse', 'WriteFile');
      expect(matched).toHaveLength(1);
    });

    it('filters by wildcard pattern (Write* matches WriteFile)', () => {
      reg.register('PreToolUse', { ...cmdHook(), tools: ['Write*'] });
      expect(reg.match('PreToolUse', 'WriteFile')).toHaveLength(1);
      expect(reg.match('PreToolUse', 'ReadFile')).toHaveLength(0);
    });

    it('wildcard "*" matches everything', () => {
      reg.register('PreToolUse', { ...cmdHook(), tools: ['*'] });
      expect(reg.match('PreToolUse', 'Anything')).toHaveLength(1);
    });

    it('"bash*" matches "bash" and "bash_exec"', () => {
      reg.register('PreToolUse', { ...cmdHook(), tools: ['bash*'] });
      expect(reg.match('PreToolUse', 'bash')).toHaveLength(1);
      expect(reg.match('PreToolUse', 'bash_exec')).toHaveLength(1);
      expect(reg.match('PreToolUse', 'nobash')).toHaveLength(0);
    });

    it('"*.js" matches "test.js"', () => {
      reg.register('PreToolUse', { ...cmdHook(), tools: ['*.js'] });
      expect(reg.match('PreToolUse', 'test.js')).toHaveLength(1);
      expect(reg.match('PreToolUse', 'test.ts')).toHaveLength(0);
    });
  });
});

describe('createHookMiddleware', () => {
  /** @returns {{ phase: string, toolName: string, eventBus: { emit: ReturnType<typeof vi.fn> } }} */
  function mockCtx(phase, toolName = '') {
    return {
      phase,
      toolName,
      eventBus: { emit: vi.fn() },
    };
  }

  it('throws on non-HookRegistry argument', () => {
    expect(() => createHookMiddleware({})).toThrow(/must be a HookRegistry/);
    expect(() => createHookMiddleware(null)).toThrow(/must be a HookRegistry/);
  });

  it('passes through when no matching hooks', async () => {
    const reg = new HookRegistry();
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('ok');

    const result = await mw(mockCtx('beforeTool', 'WriteFile'), next);
    expect(next).toHaveBeenCalledOnce();
    expect(result).toBe('ok');
  });

  it('before stage: calls handler, proceeds on null result', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(null);
    reg.register('PreToolUse', { type: 'command', handler, tools: ['Write*'] });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('done');

    const result = await mw(mockCtx('beforeTool', 'WriteFile'), next);
    expect(handler).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect(result).toBe('done');
  });

  it('before stage: blocks on { skip: true } from blocking handler', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue({ skip: true, reason: 'denied by policy' });
    reg.register('PreToolUse', { type: 'command', handler, blocking: true });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('should not reach');
    const ctx = mockCtx('beforeTool', 'WriteFile');

    const result = await mw(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'denied by policy' });
  });

  it('after stage: runs next() first, then handlers', async () => {
    const reg = new HookRegistry();
    const order = [];
    const handler = vi.fn().mockImplementation(async () => { order.push('handler'); });
    reg.register('PostToolUse', { type: 'command', handler });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockImplementation(async () => { order.push('next'); return 'next-result'; });
    const ctx = mockCtx('afterTool', 'WriteFile');

    const result = await mw(ctx, next);
    expect(order).toEqual(['next', 'handler']);
    expect(result).toBe('next-result');
  });

  it('emits hook:denied on skip', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue({ skip: true, reason: 'blocked' });
    reg.register('PreToolUse', { type: 'command', handler });
    const mw = createHookMiddleware(reg);
    const next = vi.fn();
    const ctx = mockCtx('beforeTool', 'WriteFile');

    await mw(ctx, next);
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      'hook:denied',
      expect.objectContaining({ reason: 'blocked', toolName: 'WriteFile' }),
    );
  });

  it('emits hook:error on handler throw', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    reg.register('PreToolUse', { type: 'command', handler, blocking: true });
    const mw = createHookMiddleware(reg);
    const next = vi.fn();
    const ctx = mockCtx('beforeTool', 'WriteFile');

    await expect(mw(ctx, next)).rejects.toThrow('boom');
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      'hook:error',
      expect.objectContaining({ error: 'boom', toolName: 'WriteFile' }),
    );
  });

  // --- Three-dimension evaluation in middleware ---

  it('skips hook when state predicate fails', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(null);
    reg.register('PreToolUse', {
      type: 'command', handler,
      when: { 'tokens.used': { $gt: 4000 } },
    });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('ok');
    const ctx = {
      ...mockCtx('beforeTool', 'WriteFile'),
      state: { get: (k) => k === 'tokens.used' ? 2000 : undefined },
    };
    await mw(ctx, next);
    expect(handler).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('runs hook when state predicate passes', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(null);
    reg.register('PreToolUse', {
      type: 'command', handler,
      when: { 'tokens.used': { $gt: 4000 } },
    });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('ok');
    const ctx = {
      ...mockCtx('beforeTool', 'WriteFile'),
      state: { get: (k) => k === 'tokens.used' ? 5000 : undefined },
    };
    await mw(ctx, next);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('lifecycle maxExecutions stops after N runs', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(null);
    reg.register('PreToolUse', {
      type: 'command', handler,
      lifecycle: { maxExecutions: 2 },
    });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('ok');
    const ctx = mockCtx('beforeTool', 'WriteFile');

    await mw(ctx, next); // exec 1
    await mw(ctx, next); // exec 2
    await mw(ctx, next); // exec 3 — should skip
    expect(handler).toHaveBeenCalledTimes(2);
  });

  // --- Gate (Dim 2: How) evaluation in middleware ---

  it('gate: skips hook when confirm returns false', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(null);
    reg.register('PreToolUse', {
      type: 'command', handler,
      gate: { type: 'llm', prompt: 'Is this safe?', fallback: 'deny' },
    });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('ok');
    const ctx = {
      ...mockCtx('beforeTool', 'WriteFile'),
      confirm: vi.fn().mockResolvedValue(false),
    };
    await mw(ctx, next);
    expect(handler).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('gate: runs hook when confirm returns true', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(null);
    reg.register('PreToolUse', {
      type: 'command', handler,
      gate: { type: 'user', prompt: 'Allow?', fallback: 'deny' },
    });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('ok');
    const ctx = {
      ...mockCtx('beforeTool', 'WriteFile'),
      confirm: vi.fn().mockResolvedValue(true),
    };
    await mw(ctx, next);
    expect(handler).toHaveBeenCalledOnce();
    expect(ctx.confirm).toHaveBeenCalledWith('Allow?', 'user');
  });

  it('gate: fallback=deny when no confirm provider', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(null);
    reg.register('PreToolUse', {
      type: 'command', handler,
      gate: { type: 'llm', prompt: 'check', fallback: 'deny' },
    });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('ok');
    const ctx = mockCtx('beforeTool', 'WriteFile'); // no confirm
    await mw(ctx, next);
    expect(handler).not.toHaveBeenCalled();
  });

  it('gate: fallback=allow when no confirm provider', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(null);
    reg.register('PreToolUse', {
      type: 'command', handler,
      gate: { type: 'agent', fallback: 'allow' },
    });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('ok');
    const ctx = mockCtx('beforeTool', 'WriteFile'); // no confirm
    await mw(ctx, next);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('gate: fallback=allow on confirm error', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(null);
    reg.register('PreToolUse', {
      type: 'command', handler,
      gate: { type: 'llm', prompt: 'check', fallback: 'allow' },
    });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('ok');
    const ctx = {
      ...mockCtx('beforeTool', 'WriteFile'),
      confirm: vi.fn().mockRejectedValue(new Error('timeout')),
    };
    await mw(ctx, next);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('gate: fallback=deny on confirm error', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(null);
    reg.register('PreToolUse', {
      type: 'command', handler,
      gate: { type: 'llm', prompt: 'check', fallback: 'deny' },
    });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('ok');
    const ctx = {
      ...mockCtx('beforeTool', 'WriteFile'),
      confirm: vi.fn().mockRejectedValue(new Error('timeout')),
    };
    await mw(ctx, next);
    expect(handler).not.toHaveBeenCalled();
  });

  it('gate: emits hook:gate_denied event', async () => {
    const reg = new HookRegistry();
    const handler = vi.fn().mockResolvedValue(null);
    reg.register('PreToolUse', {
      type: 'command', handler,
      gate: { type: 'llm', prompt: 'safe?', fallback: 'deny' },
    });
    const mw = createHookMiddleware(reg);
    const next = vi.fn().mockResolvedValue('ok');
    const ctx = {
      ...mockCtx('beforeTool', 'WriteFile'),
      confirm: vi.fn().mockResolvedValue(false),
    };
    await mw(ctx, next);
    expect(ctx.eventBus.emit).toHaveBeenCalledWith(
      'hook:gate_denied',
      expect.objectContaining({ gate: 'llm', toolName: 'WriteFile' }),
    );
  });
});

// ── HookBuilder + hook() factory ──────────────────────────────

describe('hook() factory', () => {
  let reg;
  beforeEach(() => { reg = new HookRegistry(); });

  it('Level 0: hook(reg, event, fn) registers directly', () => {
    const fn = vi.fn();
    const def = hook(reg, 'PreToolUse', fn);
    expect(def.type).toBe('command');
    expect(def.handler).toBe(fn);
    expect(reg.list('PreToolUse')).toHaveLength(1);
  });

  it('Level 1: hook(reg, event, opts, fn) with match', () => {
    const fn = vi.fn();
    const def = hook(reg, 'PreToolUse', { match: 'bash_*' }, fn);
    expect(def.tools).toEqual(['bash_*']);
    expect(def.handler).toBe(fn);
  });

  it('Level 1: opts.times sets lifecycle', () => {
    const fn = vi.fn();
    const def = hook(reg, 'PreToolUse', { times: 3 }, fn);
    expect(def.lifecycle.maxExecutions).toBe(3);
  });

  it('Level 1: opts.protected sets authority', () => {
    const fn = vi.fn();
    const def = hook(reg, 'PreToolUse', { protected: true }, fn);
    expect(def.protected).toBe(true);
    expect(def.authority).toBe('system');
  });

  it('throws on non-HookRegistry first arg', () => {
    expect(() => hook({}, 'PreToolUse', vi.fn())).toThrow(/HookRegistry/);
  });
});

describe('HookBuilder (Level 2 chain)', () => {
  let reg;
  beforeEach(() => { reg = new HookRegistry(); });

  it('returns HookBuilder when no handler arg', () => {
    const builder = hook(reg, 'PreToolUse');
    expect(builder).toBeInstanceOf(HookBuilder);
  });

  it('.match().do() registers with tool pattern', () => {
    const fn = vi.fn();
    const def = hook(reg, 'PreToolUse').match('bash_*').do(fn);
    expect(def.tools).toEqual(['bash_*']);
    expect(reg.list('PreToolUse')).toHaveLength(1);
  });

  it('.when().do() registers with state predicate', () => {
    const fn = vi.fn();
    const def = hook(reg, 'PreToolUse')
      .when({ 'tokens.used': { $gt: 4000 } })
      .do(fn);
    expect(def.when).toEqual({ 'tokens.used': { $gt: 4000 } });
  });

  it('.times().cooldown().scope() sets lifecycle', () => {
    const fn = vi.fn();
    const def = hook(reg, 'PreToolUse')
      .times(3)
      .cooldown(5000)
      .scope('session')
      .do(fn);
    expect(def.lifecycle.maxExecutions).toBe(3);
    expect(def.lifecycle.cooldown).toBe(5000);
    expect(def.lifecycle.scope).toBe('session');
  });

  it('.protect() sets protected + system authority', () => {
    const fn = vi.fn();
    const def = hook(reg, 'PreToolUse').protect().do(fn);
    expect(def.protected).toBe(true);
    expect(def.authority).toBe('system');
  });

  it('.gate() sets soft constraint', () => {
    const fn = vi.fn();
    const def = hook(reg, 'PreToolUse')
      .gate('llm', 'Is this safe?')
      .do(fn);
    expect(def.gate.type).toBe('llm');
    expect(def.gate.prompt).toBe('Is this safe?');
  });

  it('full chain works end-to-end', () => {
    const fn = vi.fn();
    const def = hook(reg, 'PreToolUse')
      .match('bash_*')
      .when({ 'agent.phase': 'execution' })
      .times(1)
      .protect()
      .do(fn);
    expect(def.tools).toEqual(['bash_*']);
    expect(def.when).toEqual({ 'agent.phase': 'execution' });
    expect(def.lifecycle.maxExecutions).toBe(1);
    expect(def.protected).toBe(true);
    expect(def.handler).toBe(fn);
  });
});