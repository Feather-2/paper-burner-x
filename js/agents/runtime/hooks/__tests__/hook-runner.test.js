/**
 * hook-runner.js unit tests
 *
 * Covers: registerTokenPatterns, clearTokenPatterns,
 *         createPreToolUseHook, createPreAgentHook, createPostAgentHook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { enhanceEventBusWithHooks } from '../event-bus-hooks.js';

// Safety / shared deps may have deep transitive imports.
// Mock them to isolate hook-runner logic.
vi.mock('../../../shared/index.js', async (importOriginal) => {
  const orig = await importOriginal().catch(() => ({}));
  return {
    ...orig,
    isPlainObject: orig.isPlainObject ?? ((v) => v !== null && typeof v === 'object' && !Array.isArray(v)),
    toNonEmptyString: orig.toNonEmptyString ?? ((v) => (typeof v === 'string' && v.trim() ? v.trim() : null)),
    robustParseJson: orig.robustParseJson ?? ((s, fb) => { try { return JSON.parse(s); } catch { return fb; } }),
  };
});

vi.mock('../../safety/tool-restrictions.js', async (importOriginal) => {
  const orig = await importOriginal().catch(() => ({}));
  return {
    evaluateToolRestrictions: orig.evaluateToolRestrictions ?? (() => null),
    normalizeToolRestrictions: orig.normalizeToolRestrictions ?? ((v) => v),
  };
});

vi.mock('../../safety/command-classifier.js', async (importOriginal) => {
  const orig = await importOriginal().catch(() => ({}));
  return {
    classifyCommand: orig.classifyCommand ?? ((cmd) => ({
      level: 'unknown',
      requiresApproval: false,
      baseCommand: String(cmd ?? '').split(/\s/)[0],
      reasons: [],
    })),
    parseCompoundCommand: orig.parseCompoundCommand ?? ((cmd) => [cmd]),
  };
});

// Import module under test (after mocks).
const {
  createPreToolUseHook,
  createPreAgentHook,
  createPostAgentHook,
  registerTokenPatterns,
  clearTokenPatterns,
} = await import('../hook-runner.js');

// Import classifyCommand reference is not needed; the mock handles it inside hook-runner.

// ── Helpers ─────────────────────────────────────────────────────

function createMockEventBus() {
  const bus = { _events: [] };
  bus.emit = (name, data) => bus._events.push({ name, data });
  return bus;
}

function makeBus() {
  const bus = createMockEventBus();
  enhanceEventBusWithHooks(bus);
  return bus;
}

function callCtx(bus) {
  return { sessionId: 's1', runId: 'r1', input: 'hello', context: { eventBus: bus } };
}

function toolCtx(bus, tool, params) {
  return { tool, params, context: { eventBus: bus } };
}

// ── registerTokenPatterns / clearTokenPatterns ──────────────────

describe('registerTokenPatterns / clearTokenPatterns', () => {
  beforeEach(() => clearTokenPatterns());

  it('accepts valid patterns without throwing', () => {
    expect(() =>
      registerTokenPatterns([
        { pattern: /secret_\w+/g, replacement: '[CUSTOM_REDACTED]' },
      ]),
    ).not.toThrow();
  });

  it('non-array input is a no-op', () => {
    expect(() => registerTokenPatterns('not-an-array')).not.toThrow();
    expect(() => registerTokenPatterns(null)).not.toThrow();
    expect(() => registerTokenPatterns(42)).not.toThrow();
  });

  it('clearTokenPatterns resets custom patterns', () => {
    registerTokenPatterns([{ pattern: /my_token/g, replacement: '[GONE]' }]);
    expect(() => clearTokenPatterns()).not.toThrow();
    registerTokenPatterns([{ pattern: /another/g, replacement: '[X]' }]);
    clearTokenPatterns();
  });
});

// ── createPreToolUseHook ────────────────────────────────────────

describe('createPreToolUseHook', () => {
  it('returns a function', () => {
    const hook = createPreToolUseHook();
    expect(typeof hook).toBe('function');
  });

  it('returns null when no registry on eventBus', async () => {
    const plainBus = createMockEventBus();
    const hook = createPreToolUseHook();
    const result = await hook(toolCtx(plainBus, 'read', { path: '/tmp/x' }));
    expect(result).toBeNull();
  });

  it('returns null when no hooks registered', async () => {
    const bus = makeBus();
    const hook = createPreToolUseHook();
    const result = await hook(toolCtx(bus, 'read', { path: '/tmp/x' }));
    expect(result).toBeNull();
  });

  it('command hook: allows safe command through', async () => {
    const bus = makeBus();
    bus.registerHook('PreToolUse', { type: 'command', blocking: true });
    const hook = createPreToolUseHook();
    const result = await hook(toolCtx(bus, 'bash', { command: 'ls -la' }));
    // classifyCommand for 'ls' returns requiresApproval=false => pass-through
    expect(result).toBeNull();
  });
});

// ── createPreAgentHook ──────────────────────────────────────────

describe('createPreAgentHook', () => {
  it('returns a function', () => {
    const hook = createPreAgentHook();
    expect(typeof hook).toBe('function');
  });

  it('returns null when no registry on eventBus', async () => {
    const plainBus = createMockEventBus();
    const hook = createPreAgentHook();
    const result = await hook(callCtx(plainBus));
    expect(result).toBeNull();
  });

  it('returns null when no hooks registered', async () => {
    const bus = makeBus();
    const hook = createPreAgentHook();
    const result = await hook(callCtx(bus));
    expect(result).toBeNull();
  });

  it('handler hook: calls handler with context', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => null);
    bus.registerHook('PreAgent', { type: 'command', handler });
    const hook = createPreAgentHook();
    await hook(callCtx(bus));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      sessionId: 's1',
      runId: 'r1',
      input: 'hello',
    });
  });

  it('handler hook: blocks when handler returns { skip: true }', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => ({ skip: true, reason: 'rate limited' }));
    bus.registerHook('PreAgent', { type: 'command', handler, blocking: true });
    const hook = createPreAgentHook();
    const result = await hook(callCtx(bus));
    expect(result).not.toBeNull();
    expect(result.skip).toBe(true);
    expect(result.reason).toContain('rate limited');
  });

  it('handler hook: non-blocking handler error does not throw', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => { throw new Error('boom'); });
    bus.registerHook('PreAgent', { type: 'command', handler, blocking: true });
    const hook = createPreAgentHook();
    // Should not throw; error is caught and emitted
    const result = await hook(callCtx(bus));
    expect(result).toBeNull();
  });

  it('emits agent:denied on block', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => ({ skip: true, reason: 'denied-test' }));
    bus.registerHook('PreAgent', { type: 'command', handler, blocking: true });
    const hook = createPreAgentHook();
    await hook(callCtx(bus));
    const denied = bus._events.find((e) => e.name === 'agent:denied');
    expect(denied).toBeTruthy();
    expect(denied.data.reason).toContain('denied');
  });

  it('emits agent:hook:error when handler throws', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => { throw new Error('oops'); });
    bus.registerHook('PreAgent', { type: 'command', handler, blocking: true });
    const hook = createPreAgentHook();
    await hook(callCtx(bus));
    const errEvt = bus._events.find((e) => e.name === 'agent:hook:error');
    expect(errEvt).toBeTruthy();
    expect(errEvt.data.error).toContain('oops');
  });
});

// ── createPostAgentHook ─────────────────────────────────────────

describe('createPostAgentHook', () => {
  it('returns a function', () => {
    const hook = createPostAgentHook();
    expect(typeof hook).toBe('function');
  });

  it('returns undefined when no registry on eventBus', async () => {
    const plainBus = createMockEventBus();
    const hook = createPostAgentHook();
    const result = await hook({
      sessionId: 's1', runId: 'r1', result: { ok: true },
      context: { eventBus: plainBus },
    });
    expect(result).toBeUndefined();
  });

  it('returns undefined when no hooks registered', async () => {
    const bus = makeBus();
    const hook = createPostAgentHook();
    const result = await hook({
      sessionId: 's1', runId: 'r1', result: { ok: true },
      context: { eventBus: bus },
    });
    expect(result).toBeUndefined();
  });

  it('handler hook: calls handler with result context', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => {});
    bus.registerHook('PostAgent', { type: 'command', handler });
    const hook = createPostAgentHook();
    await hook({
      sessionId: 's2', runId: 'r2', result: { ok: true },
      duration: 123, context: { eventBus: bus },
    });
    expect(handler).toHaveBeenCalledTimes(1);
    const arg = handler.mock.calls[0][0];
    expect(arg.sessionId).toBe('s2');
    expect(arg.runId).toBe('r2');
    expect(arg.duration).toBe(123);
  });

  it('handler hook: error in handler does not throw', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => { throw new Error('post-boom'); });
    bus.registerHook('PostAgent', { type: 'command', handler });
    const hook = createPostAgentHook();
    // Post hooks are non-blocking; errors are swallowed
    await expect(hook({
      sessionId: 's3', runId: 'r3', result: { ok: true },
      context: { eventBus: bus },
    })).resolves.toBeUndefined();
  });

  it('emits agent:hook:error on handler error', async () => {
    const bus = makeBus();
    const handler = vi.fn(async () => { throw new Error('post-oops'); });
    bus.registerHook('PostAgent', { type: 'command', handler });
    const hook = createPostAgentHook();
    await hook({
      sessionId: 's4', runId: 'r4', result: { ok: false },
      context: { eventBus: bus },
    });
    const errEvt = bus._events.find((e) => e.name === 'agent:hook:error');
    expect(errEvt).toBeTruthy();
    expect(errEvt.data.error).toContain('post-oops');
  });
});