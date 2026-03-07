import { describe, it, expect, vi } from 'vitest';

import { HookEvent, HookRegistry, HookType } from '../../../../../js/agents/runtime/hooks/index.js';

describe('HookEvent', () => {
  it('exposes the expected event names', () => {
    expect(HookEvent).toEqual({
      PRE_AGENT: 'PreAgent',
      POST_AGENT: 'PostAgent',
      PRE_COMPRESSION: 'PreCompression',
      POST_COMPRESSION: 'PostCompression',
      PRE_LLM_CALL: 'PreLLMCall',
      POST_LLM_CALL: 'PostLLMCall',
      PRE_TOOL_USE: 'PreToolUse',
      POST_TOOL_USE: 'PostToolUse',
    });
  });

  it('is frozen/immutable', () => {
    expect(Object.isFrozen(HookEvent)).toBe(true);

    // ESM modules run in strict mode; writing to a frozen object should throw.
    expect(() => {
      HookEvent.PRE_AGENT = 'Mutated';
    }).toThrow();

    expect(() => {
      // @ts-expect-error - testing runtime immutability
      HookEvent.NEW_EVENT = 'NewEvent';
    }).toThrow();
  });

  it('has unique, non-empty string values', () => {
    const values = Object.values(HookEvent);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => typeof v === 'string' && v.trim().length > 0)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });

  it('can be used to trigger registered hooks by event name', async () => {
    const registry = new HookRegistry();

    const pre = vi.fn();
    const post = vi.fn();

    registry.register(HookEvent.PRE_AGENT, { type: HookType.COMMAND, handler: pre });
    registry.register(HookEvent.POST_AGENT, { type: HookType.COMMAND, handler: post });

    // "Trigger" hooks by looking them up and calling handlers.
    for (const h of registry.list(HookEvent.PRE_AGENT)) await h.handler?.({ phase: 'pre' });
    for (const h of registry.list(HookEvent.POST_AGENT)) await h.handler?.({ phase: 'post' });

    expect(pre).toHaveBeenCalledWith({ phase: 'pre' });
    expect(post).toHaveBeenCalledWith({ phase: 'post' });
  });
});
