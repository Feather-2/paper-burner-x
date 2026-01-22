import { describe, it, expect, vi, beforeEach } from 'vitest';

const deepSearchEventsMock = vi.hoisted(() => ({
  DeepSearchEvents: { AGENT_ERROR: 'deepsearch:agent:error' },
}));
const classifyDeepSearchErrorMock = vi.hoisted(() => vi.fn());
const maybePersistToolOutputMock = vi.hoisted(() => vi.fn());
const loadPromptMock = vi.hoisted(() => vi.fn());
const renderPromptTemplateMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../../../js/agents/runtime/events/events.js', () => deepSearchEventsMock);
vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  classifyDeepSearchError: classifyDeepSearchErrorMock,
}));
vi.mock('../../../../../../js/agents/runtime/core/tool-output-persistence.js', () => ({
  maybePersistToolOutput: maybePersistToolOutputMock,
}));
vi.mock('../../../../../../js/agents/prompts/prompt-loader.js', () => ({
  loadPrompt: loadPromptMock,
  renderPromptTemplate: renderPromptTemplateMock,
}));

describe('WritingPhaseHandler', () => {
  let WritingPhaseHandler;
  let createHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    classifyDeepSearchErrorMock.mockReturnValue({
      recoverable: true,
      category: 'unknown',
      statusCode: null,
      code: null,
      message: 'default error',
    });
    maybePersistToolOutputMock.mockResolvedValue({ inline: { persisted: true } });
    loadPromptMock.mockResolvedValue('');
    renderPromptTemplateMock.mockImplementation((template, options) => {
      if (options?.onUnresolved) {
        options.onUnresolved();
      }
      return `rendered:${template}`;
    });

    ({ WritingPhaseHandler } = await import(
      '../../../../../../js/agents/stages/deepsearch/internal/writing-phase-handler.js'
    ));

    createHandler = (overrides = {}) => {
      return new WritingPhaseHandler({
        logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
        emit: vi.fn(),
        parseDecision: (content) => {
          try {
            return JSON.parse(content);
          } catch {
            return null;
          }
        },
        executeTool: vi.fn(async () => ({ success: true })),
        maxIterations: 2,
        maxParseFailures: 2,
        ...overrides,
      });
    };
  });

  describe('shouldEnter', () => {
    it('returns true when below minimum and iteration limit reached', () => {
      const handler = createHandler();
      const result = handler.shouldEnter({
        state: { L1: { report: { markdown: '   \n\t' } } },
        mode: 'quick',
        globalConfig: {},
        iteration: 3,
        maxIterations: 3,
        toolCallCount: 0,
        maxToolCalls: 10,
      });

      expect(result).toBe(true);
    });

    it('returns false when below minimum but limits not reached', () => {
      const handler = createHandler();
      const result = handler.shouldEnter({
        state: { L1: { report: { markdown: '' } } },
        mode: 'quick',
        globalConfig: { report: { quick: { minWords: 1 } } },
        iteration: 0,
        maxIterations: 1,
        toolCallCount: 0,
        maxToolCalls: 1,
      });

      expect(result).toBe(false);
    });

    it('returns false when word count meets minimum', () => {
      const handler = createHandler();
      const longReport = 'a'.repeat(4000);
      const result = handler.shouldEnter({
        state: { L1: { report: { markdown: longReport } } },
        mode: 'quick',
        globalConfig: { report: { quick: { minWords: 4000 } } },
        iteration: 10,
        maxIterations: 10,
        toolCallCount: 0,
        maxToolCalls: 5,
      });

      expect(result).toBe(false);
    });

    it('handles unknown mode and falls back to default minWords', () => {
      const handler = createHandler();
      const result = handler.shouldEnter({
        state: { L1: { report: { markdown: '' } } },
        mode: 'unknown-mode',
        globalConfig: {},
        iteration: 1,
        maxIterations: 1,
        toolCallCount: 0,
        maxToolCalls: 10,
      });

      expect(result).toBe(true);
    });

    it('returns false when minWords is 0 (edge) and reachedLimit is true', () => {
      const handler = createHandler();
      const result = handler.shouldEnter({
        state: { L1: { report: { markdown: '' } } },
        mode: 'quick',
        globalConfig: { report: { quick: { minWords: 0 } } },
        iteration: 0,
        maxIterations: 0,
        toolCallCount: 0,
        maxToolCalls: 0,
      });

      expect(result).toBe(false);
    });

    it('handles empty state object and boundary limits', () => {
      const handler = createHandler();
      const result = handler.shouldEnter({
        state: {},
        mode: 'quick',
        globalConfig: { report: { quick: { minWords: 1 } } },
        iteration: 0,
        maxIterations: 0,
        toolCallCount: 0,
        maxToolCalls: -1,
      });

      expect(result).toBe(true);
    });

    it('coerces string limits and supports MAX_SAFE_INTEGER', () => {
      const handler = createHandler();
      const result = handler.shouldEnter({
        state: { L1: { report: { markdown: '' } } },
        mode: 'quick',
        globalConfig: { report: { quick: { minWords: Number.MAX_SAFE_INTEGER } } },
        iteration: Number.MAX_SAFE_INTEGER,
        maxIterations: Number.MAX_SAFE_INTEGER,
        toolCallCount: '0',
        maxToolCalls: 0,
      });

      expect(result).toBe(true);
    });

    it('throws on null or undefined state', () => {
      const handler = createHandler();
      const base = {
        mode: 'quick',
        globalConfig: {},
        iteration: 0,
        maxIterations: 0,
        toolCallCount: 0,
        maxToolCalls: 0,
      };

      expect(() => handler.shouldEnter({ ...base, state: null })).toThrow();
      expect(() => handler.shouldEnter({ ...base, state: undefined })).toThrow();
    });
  });

  describe('getStats', () => {
    it('calculates word count, minWords, and todo stats', () => {
      const handler = createHandler();
      const stats = handler.getStats({
        state: {
          L1: { report: { markdown: 'a b c' } },
          todos: [{ status: 'done' }, { status: 'completed' }, { status: 'pending' }],
        },
        mode: 'wider',
        globalConfig: { report: { wider: { minWords: 123 } } },
      });

      expect(stats).toEqual({ wordCount: 3, minWords: 123, doneTodos: 2, totalTodos: 3 });
    });

    it('uses per-mode default minWords when config missing', () => {
      const handler = createHandler();
      const stats = handler.getStats({
        state: { L1: { report: { markdown: '' } }, todos: [] },
        mode: 'deeper',
        globalConfig: {},
      });

      expect(stats.minWords).toBe(10000);
    });

    it('falls back to 4000 when mode is unknown', () => {
      const handler = createHandler();
      const stats = handler.getStats({
        state: { L1: { report: { markdown: '' } } },
        mode: 'unknown-mode',
        globalConfig: {},
      });

      expect(stats.minWords).toBe(4000);
      expect(stats.totalTodos).toBe(0);
    });

    it('throws when state is null', () => {
      const handler = createHandler();
      expect(() =>
        handler.getStats({
          state: null,
          mode: undefined,
          globalConfig: {},
        })
      ).toThrow();
    });

    it('handles undefined mode and empty todos array', () => {
      const handler = createHandler();
      const stats = handler.getStats({
        state: { L1: { report: { markdown: '' } }, todos: [] },
        mode: undefined,
        globalConfig: {},
      });

      expect(stats.wordCount).toBe(0);
      expect(stats.minWords).toBe(4000);
      expect(stats.doneTodos).toBe(0);
      expect(stats.totalTodos).toBe(0);
    });

    it('throws when todos is not an array', () => {
      const handler = createHandler();
      expect(() =>
        handler.getStats({
          state: { L1: { report: { markdown: '' } }, todos: {} },
          mode: 'quick',
          globalConfig: {},
        })
      ).toThrow(TypeError);
    });

    it('handles a very large report string', () => {
      const handler = createHandler();
      const hugeReport = 'a '.repeat(100000);
      const stats = handler.getStats({
        state: { L1: { report: { markdown: hugeReport } }, todos: [] },
        mode: 'quick',
        globalConfig: {},
      });

      expect(stats.wordCount).toBe(100000);
      expect(stats.totalTodos).toBe(0);
    });
  });

  describe('run', () => {
    it('runs write-report submit and injects rendered prompt', async () => {
      loadPromptMock.mockResolvedValue('template');
      renderPromptTemplateMock.mockReturnValue('rendered prompt');
      const executeTool = vi.fn(async () => ({ success: true, detail: 'ok' }));
      const handler = createHandler({ executeTool, maxIterations: 1 });
      const messages = [];
      const flushMessages = vi.fn();
      const callModel = vi.fn(async () => ({
        content: JSON.stringify({ action: 'write-report', args: { action: 'submit', content: 'x' } }),
      }));

      const result = await handler.run({
        state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [], runId: 'run-1' },
        stageApi: { runStore: { id: 'store' } },
        sharedContext: { depth: { items: [{ value: 1 }] } },
        callModel,
        addMessage: (msg) => messages.push(msg),
        messages: () => messages,
        signal: null,
        flushMessages,
      });

      expect(result).toEqual({ iterations: 1 });
      expect(flushMessages).toHaveBeenCalledTimes(1);
      expect(callModel).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenCalledWith(
        'write-report',
        { action: 'submit', content: 'x' },
        expect.objectContaining({ state: expect.anything(), stageApi: expect.anything() })
      );
      expect(maybePersistToolOutputMock).toHaveBeenCalledWith(
        expect.objectContaining({ runId: 'run-1', toolName: 'write-report', iteration: 1 })
      );
      expect(renderPromptTemplateMock).toHaveBeenCalledWith(
        'template',
        expect.objectContaining({
          vars: expect.objectContaining({
            'minWords.quick': 4000,
            'minWords.wider': 6000,
            'minWords.deeper': 10000,
          }),
        })
      );
      expect(messages.some((m) => m.content === 'rendered prompt')).toBe(true);
      expect(messages.some((m) => typeof m.content === 'string' && m.content.includes('get-artifact'))).toBe(true);
    });

    it('stops after max parse failures on empty responses', async () => {
      const handler = createHandler({ maxIterations: 3, maxParseFailures: 2 });
      const messages = [];
      const callModel = vi.fn(async () => ({ content: '   ' }));

      const result = await handler.run({
        state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel,
        addMessage: (msg) => messages.push(msg),
        messages: () => messages,
        signal: null,
      });

      expect(result.iterations).toBe(0);
      expect(callModel).toHaveBeenCalledTimes(2);
      expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(0);
    });

    it('retries on parse failure and adds a JSON warning once', async () => {
      const parseDecision = vi.fn(() => null);
      const handler = createHandler({ parseDecision, maxParseFailures: 2 });
      const messages = [];
      const callModel = vi.fn(async () => ({ content: 'not-json' }));

      const result = await handler.run({
        state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel,
        addMessage: (msg) => messages.push(msg),
        messages: () => messages,
        signal: null,
      });

      expect(result.iterations).toBe(0);
      expect(callModel).toHaveBeenCalledTimes(2);
      expect(parseDecision).toHaveBeenCalledTimes(2);
      expect(
        messages.filter((m) => typeof m.content === 'string' && m.content.includes('args": {...}'))
      ).toHaveLength(1);
    });

    it('handles recoverable errors with system retry limit', async () => {
      const emit = vi.fn();
      const handler = createHandler({ maxParseFailures: 2, emit });
      const error = new Error('transient');
      const callModel = vi.fn(async () => {
        throw error;
      });

      classifyDeepSearchErrorMock.mockReturnValue({
        recoverable: true,
        category: 'network',
        statusCode: 500,
        code: 'EUP',
        message: 'temporary',
      });

      const result = await handler.run({
        state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel,
        addMessage: () => {},
        messages: () => [],
        signal: null,
      });

      expect(result.iterations).toBe(0);
      expect(callModel).toHaveBeenCalledTimes(2);
      expect(emit).not.toHaveBeenCalled();
    });

    it('emits AGENT_ERROR and rethrows on non-recoverable errors', async () => {
      const emit = vi.fn();
      const handler = createHandler({ emit });
      const error = new Error('fatal');
      const callModel = vi.fn(async () => {
        throw error;
      });

      classifyDeepSearchErrorMock.mockReturnValue({
        recoverable: false,
        category: 'auth',
        statusCode: 401,
        code: 'EAUTH',
        message: 'no auth',
      });

      await expect(
        handler.run({
          state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
          stageApi: {},
          sharedContext: null,
          callModel,
          addMessage: () => {},
          messages: () => [],
          signal: null,
        })
      ).rejects.toThrow('fatal');

      expect(emit).toHaveBeenCalledWith(
        deepSearchEventsMock.DeepSearchEvents.AGENT_ERROR,
        expect.objectContaining({ recoverable: false, category: 'auth' })
      );
    });

    it('exits early when the signal is aborted', async () => {
      const handler = createHandler();
      const messages = [];
      const abortController = new AbortController();
      abortController.abort();
      const callModel = vi.fn(async () => ({ content: '{"action":"complete"}' }));

      const result = await handler.run({
        state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel,
        addMessage: (msg) => messages.push(msg),
        messages: () => messages,
        signal: abortController.signal,
      });

      expect(result.iterations).toBe(0);
      expect(callModel).not.toHaveBeenCalled();
    });

    it('handles deep nested args and circular results when persistence fails', async () => {
      loadPromptMock.mockResolvedValue('');
      maybePersistToolOutputMock.mockRejectedValue(new Error('persist failed'));
      const deepArgs = {
        action: 'append',
        meta: { level1: { level2: { level3: [{ value: 'x' }] } } },
      };
      const circular = { ok: true };
      circular.self = circular;
      circular.toString = () => 'circular-result';

      const executeTool = vi.fn(async () => circular);
      const handler = createHandler({ executeTool, maxIterations: 1 });
      const messages = [];
      const callModel = vi.fn(async () => ({
        content: JSON.stringify({ action: 'write-report', args: deepArgs }),
      }));

      const result = await handler.run({
        state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel,
        addMessage: (msg) => messages.push(msg),
        messages: () => messages,
        signal: null,
      });

      expect(result.iterations).toBe(1);
      expect(executeTool).toHaveBeenCalledWith('write-report', deepArgs, expect.any(Object));
      expect(
        messages.some((m) => typeof m.content === 'string' && m.content.includes('circular-result'))
      ).toBe(true);
    });

    it('executes multiple write-report actions in one iteration and exits on submit success', async () => {
      loadPromptMock.mockResolvedValue('');
      const executeTool = vi.fn(async (toolName, args) => ({
        success: args?.action === 'submit',
        receivedArgs: args,
      }));
      const handler = createHandler({ executeTool, maxIterations: 3 });
      const msgs = [];
      const callModel = vi.fn(async () => ({
        content: JSON.stringify({
          actions: [
            { action: 'write-report', args: { action: 'append', content: 'part1' } },
            { action: 'write-report', args: { action: 'submit', content: 'final' } },
          ],
        }),
      }));

      const result = await handler.run({
        state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel,
        addMessage: (m) => msgs.push(m),
        messages: () => msgs,
      });

      expect(result).toEqual({ iterations: 1 });
      expect(callModel).toHaveBeenCalledTimes(1);
      expect(executeTool).toHaveBeenCalledTimes(2);
      expect(maybePersistToolOutputMock).toHaveBeenCalledTimes(2);
    });

    it('ignores unsupported actions but still counts the iteration', async () => {
      loadPromptMock.mockResolvedValue('');
      const executeTool = vi.fn(async () => ({ success: true }));
      const handler = createHandler({ executeTool, maxIterations: 1 });
      const msgs = [];
      const callModel = vi.fn(async () => ({
        content: JSON.stringify({ action: 'not-allowed', args: { any: 'thing' } }),
      }));

      const result = await handler.run({
        state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel,
        addMessage: (m) => msgs.push(m),
        messages: () => msgs,
      });

      expect(result).toEqual({ iterations: 1 });
      expect(callModel).toHaveBeenCalledTimes(1);
      expect(executeTool).not.toHaveBeenCalled();
    });

    it('calls write-report with empty args when decision.args is missing', async () => {
      loadPromptMock.mockResolvedValue('');
      const executeTool = vi.fn(async () => ({ success: false }));
      const handler = createHandler({ executeTool, maxIterations: 1 });
      const msgs = [];
      const callModel = vi.fn(async () => ({ content: '{"action":"write-report"}' }));

      const result = await handler.run({
        state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel,
        addMessage: (m) => msgs.push(m),
        messages: () => msgs,
      });

      expect(result).toEqual({ iterations: 1 });
      expect(executeTool).toHaveBeenCalledWith('write-report', {}, expect.any(Object));
    });

    it('skips prompt injection when loadPrompt throws', async () => {
      loadPromptMock.mockRejectedValueOnce(new Error('no prompt'));
      const handler = createHandler({ maxIterations: 1 });
      const msgs = [];

      const result = await handler.run({
        state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel: async () => ({ content: '{"action":"complete"}' }),
        addMessage: (m) => msgs.push(m),
        messages: () => msgs,
      });

      expect(result).toEqual({ iterations: 1 });
      expect(loadPromptMock).toHaveBeenCalledTimes(1);
      expect(renderPromptTemplateMock).not.toHaveBeenCalled();
    });

    it('continues when renderPromptTemplate throws', async () => {
      loadPromptMock.mockResolvedValue('template');
      renderPromptTemplateMock.mockImplementation(() => {
        throw new Error('render failed');
      });
      const handler = createHandler({ maxIterations: 1 });
      const msgs = [];

      const result = await handler.run({
        state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
        stageApi: {},
        sharedContext: null,
        callModel: async () => ({ content: '{"action":"complete"}' }),
        addMessage: (m) => msgs.push(m),
        messages: () => msgs,
      });

      expect(result).toEqual({ iterations: 1 });
      expect(renderPromptTemplateMock).toHaveBeenCalledTimes(1);
    });

    it('supports concurrent runs with isolated message buffers', async () => {
      loadPromptMock.mockResolvedValue('');
      const handlerA = createHandler({ maxIterations: 1 });
      const handlerB = createHandler({ maxIterations: 1 });
      const messagesA = [];
      const messagesB = [];
      const callModelA = vi.fn(async () => ({ content: '{"action":"complete"}' }));
      const callModelB = vi.fn(async () => ({ content: '{"action":"complete"}' }));

      const [resultA, resultB] = await Promise.all([
        handlerA.run({
          state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
          stageApi: {},
          sharedContext: null,
          callModel: callModelA,
          addMessage: (msg) => messagesA.push(msg),
          messages: () => messagesA,
        }),
        handlerB.run({
          state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
          stageApi: {},
          sharedContext: null,
          callModel: callModelB,
          addMessage: (msg) => messagesB.push(msg),
          messages: () => messagesB,
        }),
      ]);

      expect(resultA.iterations).toBe(1);
      expect(resultB.iterations).toBe(1);
      expect(callModelA).toHaveBeenCalledTimes(1);
      expect(callModelB).toHaveBeenCalledTimes(1);
      expect(messagesA).not.toBe(messagesB);
    });

    it('caches prompt template across rapid successive runs', async () => {
      loadPromptMock.mockResolvedValue('template');
      renderPromptTemplateMock.mockImplementation((template, options) => {
        if (options?.onUnresolved) {
          options.onUnresolved();
        }
        return `rendered:${template}`;
      });

      const handler = createHandler({ maxIterations: 1 });

      const runOnce = async () => {
        const messages = [];
        await handler.run({
          state: { userConfig: { mode: 'quick' }, globalConfig: {}, todos: [] },
          stageApi: {},
          sharedContext: null,
          callModel: async () => ({ content: '{"action":"complete"}' }),
          addMessage: (msg) => messages.push(msg),
          messages: () => messages,
        });
      };

      await runOnce();
      await runOnce();

      expect(loadPromptMock).toHaveBeenCalledTimes(1);
      expect(renderPromptTemplateMock).toHaveBeenCalledTimes(2);
      const firstOptions = renderPromptTemplateMock.mock.calls[0][1];
      const secondOptions = renderPromptTemplateMock.mock.calls[1][1];
      expect(firstOptions.warnOnUnresolved).toBe(true);
      expect(secondOptions.warnOnUnresolved).toBeUndefined();
    });

    it('renders prompt with failOnUnresolved when configured', async () => {
      loadPromptMock.mockResolvedValue('template');
      const handler = createHandler({ maxIterations: 1 });

      await handler.run({
        state: {
          userConfig: { mode: 'quick' },
          globalConfig: { prompts: { failOnUnresolved: true } },
          todos: [],
        },
        stageApi: {},
        sharedContext: null,
        callModel: async () => ({ content: '{"action":"complete"}' }),
        addMessage: () => {},
        messages: () => [],
      });

      expect(renderPromptTemplateMock).toHaveBeenCalledWith(
        'template',
        expect.objectContaining({ failOnUnresolved: true })
      );
    });
  });
});

describe('default export', () => {
  it('exports WritingPhaseHandler as default', async () => {
    vi.resetModules();
    const mod = await import('../../../../../../js/agents/stages/deepsearch/internal/writing-phase-handler.js');
    expect(mod.default).toBe(mod.WritingPhaseHandler);
  });
});
