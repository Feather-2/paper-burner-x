import { describe, it, expect, vi } from 'vitest';

import { createTaskTool } from '../../../js/agents/runtime/tools/TaskTool.js';
import { createAgentContainer, createTestContainer, ServiceId } from '../../../js/agents/runtime/di/index.js';
import { SubagentRegistry, globalSubagentRegistry } from '../../../js/agents/sdk/SubagentRegistry.js';

describe('TaskTool DI', () => {
  it('registers SubagentRegistry in default DI container', async () => {
    const container = createAgentContainer();
    const registry = await container.get(ServiceId.SUBAGENT_REGISTRY);
    expect(registry).toBe(globalSubagentRegistry);
  });

  it('resolves registry from provided DI container when not explicitly injected', async () => {
    const registry = new SubagentRegistry();
    registry.register('test', async () => ({ run: async () => ({ ok: true, summary: 'done' }) }));

    const container = createTestContainer({ [ServiceId.SUBAGENT_REGISTRY]: registry });
    const handler = createTaskTool({ container });

    const result = await handler(
      { subagent_type: 'test', prompt: 'do something' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: null },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toBe('done');
  });

  it('resolves registry from context.container when available', async () => {
    const registry = new SubagentRegistry();
    registry.register('test', async () => ({ run: async () => ({ ok: true, summary: 'ok' }) }));

    const container = createTestContainer({ [ServiceId.SUBAGENT_REGISTRY]: registry });
    const handler = createTaskTool();

    const result = await handler(
      { subagent_type: 'test', prompt: 'do something' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: null },
        container,
      }
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toBe('ok');
  });

  it('throws a clear error when registry cannot be resolved', async () => {
    const handler = createTaskTool();
    await expect(
      handler(
        { subagent_type: 'missing', prompt: 'do something' },
        {
          emit: () => {},
          logger: { info: () => {}, error: () => {} },
          signal: null,
          state: { sharedContext: null },
        }
      )
    ).rejects.toThrow(/missing SubagentRegistry/i);
  });
});

describe('TaskTool behavior', () => {
  it('isolated mode passes sharedContext (no messages/handoff)', async () => {
    const registry = new SubagentRegistry();
    let receivedContext = null;

    registry.register('test', async (config) => {
      receivedContext = config.inheritedContext;
      return { run: async () => ({ ok: true, summary: 'ok' }) };
    });

    const handler = createTaskTool({ registry });
    await handler(
      { subagent_type: 'test', prompt: 'do something', context_mode: 'isolated' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: { test: 1 } },
      }
    );

    expect(receivedContext).toBeTruthy();
    expect(receivedContext.sharedContext).toEqual({ test: 1 });
    expect(receivedContext.messages).toBeUndefined();
    expect(receivedContext.handoff).toBeUndefined();
  });

  it('shared mode uses parentAgent sharedContext (no messages)', async () => {
    const registry = new SubagentRegistry();
    let receivedContext = null;

    registry.register('test', async (config) => {
      receivedContext = config.inheritedContext;
      return { run: async () => ({ ok: true, summary: 'ok' }) };
    });

    const parentAgent = {
      _loop: { messages: [{ role: 'user', content: 'hello' }] },
      memory: { sharedContext: { shared: true } },
    };

    const handler = createTaskTool({ registry, parentAgent });
    await handler(
      { subagent_type: 'test', prompt: 'do something', context_mode: 'shared' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: {},
      }
    );

    expect(receivedContext).toBeTruthy();
    expect(receivedContext.messages).toBeUndefined();
    expect(receivedContext.sharedContext).toEqual({ shared: true });
  });

  it('handoff mode uses buildHandoff when provided', async () => {
    const registry = new SubagentRegistry();
    let receivedContext = null;

    registry.register('test', async (config) => {
      receivedContext = config.inheritedContext;
      return { run: async () => ({ ok: true, summary: 'ok' }) };
    });

    const buildHandoff = vi.fn(async () => ({ from: 'buildHandoff' }));
    const handler = createTaskTool({ registry, buildHandoff });

    await handler(
      { subagent_type: 'test', prompt: 'do something', context_mode: 'handoff' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: { sc: 1 } },
      }
    );

    expect(buildHandoff).toHaveBeenCalledOnce();
    expect(receivedContext).toBeTruthy();
    expect(receivedContext.handoff).toEqual({ from: 'buildHandoff' });
    expect(receivedContext.sharedContext).toEqual({ sc: 1 });
  });

  it('handoff mode falls back to a simple handoff document when buildHandoff is missing', async () => {
    const registry = new SubagentRegistry();
    let receivedContext = null;

    registry.register('test', async (config) => {
      receivedContext = config.inheritedContext;
      return { run: async () => ({ ok: true, summary: 'ok' }) };
    });

    const handler = createTaskTool({ registry });

    await handler(
      { subagent_type: 'test', prompt: 'do something', context_mode: 'handoff' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: {
          taskGoal: 'goal',
          iteration: 2,
          todos: [{ status: 'pending', text: 'todo1' }],
          L1: { condensedMemory: { summary: 'summary' } },
          sharedContext: { sc: 1 },
        },
      }
    );

    expect(receivedContext?.handoff?.taskGoal).toBe('goal');
    expect(receivedContext?.handoff?.iteration).toBe(2);
    expect(receivedContext?.handoff?.summary).toBe('summary');
  });

  it('commits results to sharedContext when commit() is available', async () => {
    const registry = new SubagentRegistry();
    registry.register('test', async () => ({ run: async () => ({ ok: true, tags: ['a'], summary: 'done' }) }));

    const commit = vi.fn();
    const signal = vi.fn();
    const sharedContext = { commit, signal };

    const handler = createTaskTool({ registry });
    const result = await handler(
      { subagent_type: 'test', prompt: 'do something' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.resultId).toMatch(/^task_test_/);
    expect(result.hint).toContain('sharedContext.getDetail');
    expect(commit).toHaveBeenCalledOnce();
    expect(signal).toHaveBeenCalledOnce();
  });

  it('returns a hint when sharedContext exists even without commit()', async () => {
    const registry = new SubagentRegistry();
    registry.register('test', async () => ({ run: async () => ({ ok: true, summary: 'done' }) }));

    const handler = createTaskTool({ registry });
    const result = await handler(
      { subagent_type: 'test', prompt: 'do something' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: { getDetail: () => null } },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.hint).toContain('sharedContext.getDetail');
  });

  it('returns a helpful error for unknown subagent types', async () => {
    const registry = new SubagentRegistry();
    registry.register('known', async () => ({ run: async () => ({ ok: true }) }));

    const handler = createTaskTool({ registry });
    const result = await handler(
      { subagent_type: 'unknown', prompt: 'do something' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: null },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown subagent type/i);
    expect(result.error).toMatch(/known/i);
  });

  it('handles factories that do not return a valid agent instance', async () => {
    const registry = new SubagentRegistry();
    registry.register('bad', async () => ({ notRun: true }));

    const handler = createTaskTool({ registry });
    const result = await handler(
      { subagent_type: 'bad', prompt: 'do something' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: null },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/did not return a valid AgentInstance/i);
  });

  it('propagates subagent run errors as tool errors', async () => {
    const registry = new SubagentRegistry();
    registry.register('boom', async () => ({ run: async () => { throw new Error('explode'); } }));

    const emit = vi.fn();
    const logger = { info: vi.fn(), error: vi.fn() };

    const handler = createTaskTool({ registry });
    const result = await handler(
      { subagent_type: 'boom', prompt: 'do something' },
      {
        emit,
        logger,
        signal: null,
        state: { sharedContext: null },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('explode');
    expect(emit).toHaveBeenCalledWith('subagent.failed', expect.any(Object));
    expect(logger.error).toHaveBeenCalled();
  });

  it('includes a failure summary when subagent returns ok=false with an error', async () => {
    const registry = new SubagentRegistry();
    registry.register('fail', async () => ({ run: async () => ({ ok: false, error: 'bad' }) }));

    const handler = createTaskTool({ registry });
    const result = await handler(
      { subagent_type: 'fail', prompt: 'do something' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: null },
      }
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/failed: bad/);
  });

  it('falls back to JSON summary and key-based keywords when summary/message are missing', async () => {
    const registry = new SubagentRegistry();
    registry.register('fallback', async () => ({ run: async () => ({ ok: true, foo: 1, bar: 2 }) }));

    const commit = vi.fn();
    const handler = createTaskTool({ registry });
    const result = await handler(
      { subagent_type: 'fallback', prompt: 'do something' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: { commit, signal: () => {} } },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('"foo":1');
    expect(commit).toHaveBeenCalledWith(
      expect.stringMatching(/^task_fallback_/),
      expect.objectContaining({
        keywords: expect.arrayContaining(['foo', 'bar']),
      })
    );
  });

  it('uses result.message as a summary when present', async () => {
    const registry = new SubagentRegistry();
    registry.register('msg', async () => ({ run: async () => ({ ok: true, message: 'hello' }) }));

    const handler = createTaskTool({ registry });
    const result = await handler(
      { subagent_type: 'msg', prompt: 'do something' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: null },
      }
    );

    expect(result.summary).toBe('hello');
  });

  it('handles null subagent results', async () => {
    const registry = new SubagentRegistry();
    registry.setQuarantineEnabled(false);
    registry.register('null', async () => ({ run: async () => null }));

    const handler = createTaskTool({ registry });
    const result = await handler(
      { subagent_type: 'null', prompt: 'do something' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: null },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.summary).toBe('null: no result');
  });

  it('uses result.keywords as extracted keywords when present', async () => {
    const registry = new SubagentRegistry();
    registry.register('kw', async () => ({ run: async () => ({ ok: true, summary: 'ok', keywords: ['k1', 'k2'] }) }));

    const commit = vi.fn();
    const handler = createTaskTool({ registry });
    await handler(
      { subagent_type: 'kw', prompt: 'do something' },
      {
        emit: () => {},
        logger: { info: () => {}, error: () => {} },
        signal: null,
        state: { sharedContext: { commit, signal: () => {} } },
      }
    );

    expect(commit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        keywords: ['k1', 'k2'],
      })
    );
  });
});
