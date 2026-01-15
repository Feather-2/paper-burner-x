import { describe, it, expect, vi } from 'vitest';

import HookRegistryDefault, {
  HookRegistry,
  HookType,
  HookEvent,
} from '../../../../js/agents/runtime/hooks/hook-registry.js';

describe('HookRegistry - exports', () => {
  it('default export matches the named HookRegistry export', () => {
    expect(HookRegistryDefault).toBe(HookRegistry);
  });
});

describe('HookRegistry - register() validation + normalization', () => {
  it('throws on empty eventName', () => {
    const registry = new HookRegistry();
    expect(() => registry.register('', { type: HookType.COMMAND })).toThrow(/eventName must be a non-empty string/i);
    expect(() => registry.register('   ', { type: HookType.COMMAND })).toThrow(/eventName must be a non-empty string/i);
    expect(() => registry.register(null, { type: HookType.COMMAND })).toThrow(/eventName must be a non-empty string/i);
    expect(() => registry.register(undefined, { type: HookType.COMMAND })).toThrow(/eventName must be a non-empty string/i);
  });

  it('throws when HookDefinition is not a plain object', () => {
    const registry = new HookRegistry();
    expect(() => registry.register(HookEvent.PRE_TOOL_USE, null)).toThrow(/HookDefinition must be an object/i);
    expect(() => registry.register(HookEvent.PRE_TOOL_USE, 'nope')).toThrow(/HookDefinition must be an object/i);
    expect(() => registry.register(HookEvent.PRE_TOOL_USE, [])).toThrow(/HookDefinition must be an object/i);
  });

  it('throws on missing/invalid HookDefinition.type', () => {
    const registry = new HookRegistry();
    expect(() => registry.register(HookEvent.PRE_TOOL_USE, {})).toThrow(/HookDefinition\.type/i);
    expect(() => registry.register(HookEvent.PRE_TOOL_USE, { type: 'not-a-real-type' })).toThrow(/HookDefinition\.type/i);
  });

  it('normalizes type (case-insensitive), blocking default, and tool patterns', () => {
    const registry = new HookRegistry();
    const handler = vi.fn();
    const def = {
      type: 'COMMAND',
      // `blocking` omitted => default true
      tools: [' bash ', 'bash', '', null, undefined, 'exec*', 'exec*'],
      handler,
      extra: 123,
    };

    const normalized = registry.register(` ${HookEvent.PRE_TOOL_USE} `, def);

    expect(normalized.type).toBe('command');
    expect(normalized.blocking).toBe(true);
    expect(normalized.tools).toEqual(['bash', 'exec*']);
    expect(normalized.handler).toBe(handler);
    expect(normalized.extra).toBe(123);

    // Original input is not mutated.
    expect(def.type).toBe('COMMAND');
    expect(def.tools[0]).toBe(' bash ');
  });

  it('treats empty tools list as "match all tools"', () => {
    const registry = new HookRegistry();
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, tools: [] });

    expect(registry.match(HookEvent.PRE_TOOL_USE, 'bash')).toHaveLength(1);
    expect(registry.match(HookEvent.PRE_TOOL_USE, 'curl')).toHaveLength(1);
  });

  it('enforces required fields for prompt hooks', () => {
    const registry = new HookRegistry();

    expect(() => registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.PROMPT })).toThrow(/prompt is required/i);

    const normalized = registry.register(HookEvent.PRE_TOOL_USE, {
      type: 'prompt',
      prompt: 'Allow {{tool}}?',
      model: 'fast',
    });
    expect(normalized.type).toBe('prompt');
    expect(normalized.prompt).toBe('Allow {{tool}}?');
    // `model` maps to `usage` during normalization.
    expect(normalized.usage).toBe('fast');
  });

  it('enforces required fields for agent hooks and normalizes agent fields', () => {
    const registry = new HookRegistry();

    expect(() => registry.register(HookEvent.PRE_AGENT, { type: HookType.AGENT })).toThrow(/agentType is required/i);

    const normalized = registry.register(HookEvent.PRE_AGENT, {
      type: 'agent',
      subagent_type: 'securityGate',
      model_tier: 'advanced',
      // prompt is optional for agent hooks
    });

    expect(normalized.type).toBe('agent');
    expect(normalized.agentType).toBe('securityGate');
    expect(normalized.modelTier).toBe('advanced');
    expect(normalized.prompt).toBeUndefined();
  });
});

describe('HookRegistry - list() / clear()', () => {
  it('list() returns a copy (mutating the returned array does not affect the registry)', () => {
    const registry = new HookRegistry();
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND });
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND });

    const list1 = registry.list(HookEvent.PRE_TOOL_USE);
    expect(list1).toHaveLength(2);

    list1.push({ type: HookType.COMMAND });
    expect(list1).toHaveLength(3);

    const list2 = registry.list(HookEvent.PRE_TOOL_USE);
    expect(list2).toHaveLength(2);
  });

  it('clear(event) removes only that event', () => {
    const registry = new HookRegistry();
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND });
    registry.register(HookEvent.PRE_AGENT, { type: HookType.COMMAND });

    registry.clear(HookEvent.PRE_TOOL_USE);

    expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
    expect(registry.list(HookEvent.PRE_AGENT)).toHaveLength(1);
  });

  it('clear() with no event clears all events', () => {
    const registry = new HookRegistry();
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND });
    registry.register(HookEvent.PRE_AGENT, { type: HookType.COMMAND });

    registry.clear();

    expect(registry.list(HookEvent.PRE_TOOL_USE)).toEqual([]);
    expect(registry.list(HookEvent.PRE_AGENT)).toEqual([]);
  });
});

describe('HookRegistry - match() wildcard tool selection + simulated execution', () => {
  /**
   * Minimal hook execution helper (the runtime has its own hook runners; this is
   * just to prove registry selection + "event triggering" behavior).
   */
  async function trigger(registry, eventName, toolName, ctx) {
    const hooks = registry.match(eventName, toolName);
    for (const h of hooks) {
      if (typeof h.handler === 'function') await h.handler(ctx);
    }
    return hooks;
  }

  it('matches exact and wildcard patterns and preserves registration order', async () => {
    const registry = new HookRegistry();

    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    const d = vi.fn();

    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, tools: ['bash'], handler: a });
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, toolPattern: 'exec*', handler: b });
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, tool: '*', handler: c });
    registry.register(HookEvent.PRE_TOOL_USE, { type: HookType.COMMAND, handler: d }); // no tools => match all

    const ctx = { x: 1 };

    const bashHooks = await trigger(registry, HookEvent.PRE_TOOL_USE, 'bash', ctx);
    expect(bashHooks.map((h) => h.handler)).toEqual([a, c, d]);
    expect(a).toHaveBeenCalledWith(ctx);
    expect(b).not.toHaveBeenCalled();
    expect(c).toHaveBeenCalledWith(ctx);
    expect(d).toHaveBeenCalledWith(ctx);

    vi.clearAllMocks();

    const execHooks = await trigger(registry, HookEvent.PRE_TOOL_USE, 'execFile', ctx);
    expect(execHooks.map((h) => h.handler)).toEqual([b, c, d]);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(ctx);
    expect(c).toHaveBeenCalledWith(ctx);
    expect(d).toHaveBeenCalledWith(ctx);
  });

  it('handles multi-star matching and mismatch-before-star cases', () => {
    const registry = new HookRegistry();

    // Backtracking case: `*` needs to expand until the remaining suffix matches.
    registry.register('E', { type: HookType.COMMAND, tools: ['a*b*c'], id: 'multi' });
    // Mismatch happens before the first `*` is encountered => should not match.
    registry.register('E', { type: HookType.COMMAND, tools: ['ab*cd'], id: 'nope' });

    const matched1 = registry.match('E', 'axxxbzzc').map((h) => h.id);
    expect(matched1).toContain('multi');
    expect(matched1).not.toContain('nope');

    const matched2 = registry.match('E', 'acdef').map((h) => h.id);
    expect(matched2).not.toContain('nope');
  });
});

