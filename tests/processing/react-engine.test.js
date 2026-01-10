/**
 * @file tests/processing/react-engine.test.js
 * @description js/processing/react_engine.js unit tests (ReActEngine)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINALS = {
  window: globalThis.window,
  ReActEngine: globalThis.ReActEngine,
};

async function loadReActEngine() {
  const mod = await import('../../js/processing/react_engine.esm.js');
  return mod.default ?? globalThis.ReActEngine;
}

describe('processing/react_engine (ReActEngine)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    globalThis.window = {};
    delete globalThis.ReActEngine;
    delete globalThis.window.ReActEngine;
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (ORIGINALS.window === undefined) delete globalThis.window;
    else globalThis.window = ORIGINALS.window;

    if (ORIGINALS.ReActEngine === undefined) delete globalThis.ReActEngine;
    else globalThis.ReActEngine = ORIGINALS.ReActEngine;
  });

  it('exports the engine and mirrors it onto globalThis/window', async () => {
    const Engine = await loadReActEngine();

    expect(Engine).toBeTypeOf('function');
    expect(globalThis.ReActEngine).toBe(Engine);
    expect(globalThis.window.ReActEngine).toBe(Engine);
  });

  it('parseResponse extracts final answers, actions, and plain thoughts', async () => {
    const Engine = await loadReActEngine();
    const engine = new Engine({ llmCaller: vi.fn() });

    expect(engine.parseResponse('Thought: hi\nFinal Answer: ok')).toEqual({ finalAnswer: 'ok' });

    expect(
      engine.parseResponse(['Thought: plan', 'Action: Search', 'Action Input: query'].join('\n')),
    ).toEqual({
      thought: 'plan',
      action: { tool: 'Search', args: 'query' },
    });

    expect(engine.parseResponse('Just thinking...')).toEqual({ thought: 'Just thinking...' });
  });

  it('run executes tools, appends history, and returns a final answer', async () => {
    const Engine = await loadReActEngine();

    const responses = [
      ['Thought: need info', 'Action: Search', 'Action Input: foo'].join('\n'),
      ['Thought: done', 'Final Answer: answer'].join('\n'),
    ];

    const llmCaller = vi.fn(async (prompt) => {
      expect(prompt).toContain('Question: Goal');
      return responses.shift();
    });

    const engine = new Engine({ maxSteps: 5, llmCaller });
    engine.registerTool('Search', 'search tool', async (args) => {
      expect(args).toBe('foo');
      return 'found foo';
    });

    const events = [];
    engine.on('action_start', (e) => events.push(['action_start', e]));
    engine.on('action_end', (e) => events.push(['action_end', e]));
    engine.on('success', (e) => events.push(['success', e]));

    const result = await engine.run('Goal');
    expect(result).toBe('answer');

    expect(events[0][0]).toBe('action_start');
    expect(events[0][1]).toEqual(expect.objectContaining({ tool: 'Search', args: 'foo' }));
    expect(events[1][0]).toBe('action_end');
    expect(events[1][1]).toEqual(expect.objectContaining({ tool: 'Search', output: 'found foo' }));
    expect(events.at(-1)[0]).toBe('success');

    // Second prompt should include previous observation.
    expect(llmCaller.mock.calls[1][0]).toContain('Observation: found foo');
  });

  it('handles missing tools, tool errors, and truncates long observations', async () => {
    const Engine = await loadReActEngine();

    const responses = [
      ['Thought: try missing', 'Action: MissingTool', 'Action Input: x'].join('\n'),
      ['Thought: try failing tool', 'Action: Boom', 'Action Input: y'].join('\n'),
      ['Thought: try long tool', 'Action: Long', 'Action Input: z'].join('\n'),
      ['Final Answer: ok'].join('\n'),
    ];

    const llmCaller = vi.fn(async () => responses.shift());
    const engine = new Engine({ maxSteps: 10, llmCaller });

    engine.registerTool('Boom', 'fails', async () => {
      throw new Error('boom');
    });
    engine.registerTool('Long', 'long output', async () => 'x'.repeat(2100));

    const actionEnds = [];
    engine.on('action_end', (e) => actionEnds.push(e));

    const result = await engine.run('Goal');
    expect(result).toBe('ok');

    expect(actionEnds[0].output).toContain("Error: Tool 'MissingTool' not found.");
    expect(actionEnds[1].output).toBe("Error executing tool 'Boom': boom");
    expect(actionEnds[2].output.endsWith('... (truncated)')).toBe(true);
    expect(actionEnds[2].output.length).toBe(2000 + '... (truncated)'.length);
  });

  it('emits timeout and throws when maxSteps is reached without a final answer', async () => {
    const Engine = await loadReActEngine();

    const llmCaller = vi.fn(async () => 'Thought: still thinking');
    const engine = new Engine({ maxSteps: 2, llmCaller });

    const timeout = vi.fn();
    engine.on('timeout', timeout);

    await expect(engine.run('Goal')).rejects.toThrow('Max steps reached without final answer');
    expect(timeout).toHaveBeenCalledWith(expect.objectContaining({ maxSteps: 2 }));
  });

  it('supports abort() and resolves without throwing on user abort', async () => {
    const Engine = await loadReActEngine();

    const llmCaller = vi.fn(async () => 'Thought: will abort');
    const engine = new Engine({ maxSteps: 10, llmCaller });

    const abortSpy = vi.fn();
    engine.on('abort', abortSpy);
    engine.on('thought', ({ step }) => {
      if (step === 1) engine.abort();
    });

    const result = await engine.run('Goal');
    expect(result).toBeUndefined();
    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(llmCaller).toHaveBeenCalledTimes(1);
  });
});
