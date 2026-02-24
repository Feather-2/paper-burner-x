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

// ── createHookMiddleware ────────────────────────────────────────

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
});