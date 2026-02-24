import { describe, it, expect } from 'vitest';
import { enhanceEventBusWithHooks, getHookRegistry } from '../event-bus-hooks.js';
import { HookRegistry } from '../hook-registry.js';

describe('enhanceEventBusWithHooks', () => {
  it('returns null for null input', () => {
    expect(enhanceEventBusWithHooks(null)).toBeNull();
  });

  it('returns undefined for undefined input', () => {
    expect(enhanceEventBusWithHooks(undefined)).toBeUndefined();
  });

  it('returns non-object input as-is', () => {
    expect(enhanceEventBusWithHooks(42)).toBe(42);
    expect(enhanceEventBusWithHooks('hello')).toBe('hello');
  });

  it('adds registerHook/getHooks/clearHooks to plain object', () => {
    const bus = {};
    const result = enhanceEventBusWithHooks(bus);
    expect(result).toBe(bus);
    expect(typeof bus.registerHook).toBe('function');
    expect(typeof bus.getHooks).toBe('function');
    expect(typeof bus.clearHooks).toBe('function');
  });

  it('is idempotent — calling twice does not create a second registry', () => {
    const bus = {};
    enhanceEventBusWithHooks(bus);
    const reg1 = getHookRegistry(bus);
    enhanceEventBusWithHooks(bus);
    const reg2 = getHookRegistry(bus);
    expect(reg1).toBe(reg2);
  });

  it('does not overwrite existing registerHook method', () => {
    const original = () => 'original';
    const bus = { registerHook: original };
    enhanceEventBusWithHooks(bus);
    expect(bus.registerHook).toBe(original);
  });

  it('does not overwrite existing getHooks method', () => {
    const original = () => 'original';
    const bus = { getHooks: original };
    enhanceEventBusWithHooks(bus);
    expect(bus.getHooks).toBe(original);
  });

  it('does not overwrite existing clearHooks method', () => {
    const original = () => 'original';
    const bus = { clearHooks: original };
    enhanceEventBusWithHooks(bus);
    expect(bus.clearHooks).toBe(original);
  });
});

describe('getHookRegistry', () => {
  it('returns null for null input', () => {
    expect(getHookRegistry(null)).toBeNull();
  });

  it('returns null for non-enhanced object', () => {
    expect(getHookRegistry({})).toBeNull();
    expect(getHookRegistry({ registerHook() {} })).toBeNull();
  });

  it('returns HookRegistry instance for enhanced object', () => {
    const bus = {};
    enhanceEventBusWithHooks(bus);
    const reg = getHookRegistry(bus);
    expect(reg).toBeInstanceOf(HookRegistry);
  });

  it('returned registry is functional — can register and list hooks', () => {
    const bus = {};
    enhanceEventBusWithHooks(bus);
    const reg = getHookRegistry(bus);

    reg.register('PreToolUse', { type: 'command', handler: () => null });
    const hooks = reg.list('PreToolUse');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].type).toBe('command');
  });
});

describe('integration', () => {
  it('enhance → registerHook → getHooks roundtrip works', () => {
    const bus = {};
    enhanceEventBusWithHooks(bus);

    const handler = () => ({ skip: false });
    bus.registerHook('PreToolUse', { type: 'command', handler });

    const hooks = bus.getHooks('PreToolUse');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].type).toBe('command');
    expect(hooks[0].handler).toBe(handler);

    bus.clearHooks('PreToolUse');
    expect(bus.getHooks('PreToolUse')).toHaveLength(0);
  });

  it('enhance → getHookRegistry → register → list roundtrip works', () => {
    const bus = {};
    enhanceEventBusWithHooks(bus);
    const reg = getHookRegistry(bus);

    const handler = () => null;
    reg.register('PostAgent', { type: 'command', handler });

    const hooks = reg.list('PostAgent');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].handler).toBe(handler);

    // injected methods and direct registry access see the same data
    expect(bus.getHooks('PostAgent')).toHaveLength(1);
  });
});
