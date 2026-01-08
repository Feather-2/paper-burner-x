import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Kernel } from '../../../js/agents/core/index.js';
import deepsearchStagePlugin from '../../../js/agents/plugins/stages/deepsearch.js';

let runImpl = null;
/** @type {any[]} */
const constructedOptions = [];
/** @type {any[]} */
const runCalls = [];

vi.mock('../../../js/agents/stages/deepsearch/deepsearch-agent-loop.js', () => {
  class MockDeepSearchAgentLoop {
    constructor(options = {}) {
      this._options = options;
      constructedOptions.push(options);
    }

    async run(input, options = {}) {
      runCalls.push({ input, options });
      if (typeof runImpl !== 'function') {
        throw new Error('runImpl not set');
      }
      return await runImpl(input, options);
    }
  }

  return { default: MockDeepSearchAgentLoop };
});

async function createKernel(options = {}) {
  return new Kernel({
    enableRetry: false,
    enableTimeout: false,
    keepHistory: true,
    keepLog: true,
    ...options,
  });
}

describe('stage/deepsearch plugin', () => {
  /** @type {Kernel | null} */
  let kernel = null;

  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    runImpl = null;
    constructedOptions.length = 0;
    runCalls.length = 0;
  });

  afterEach(async () => {
    if (kernel) {
      await kernel.stop().catch(() => {});
      kernel = null;
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('install registers stage:deepsearch service and getStatus returns idle before run', async () => {
    kernel = await createKernel();
    await kernel.use(deepsearchStagePlugin, { mode: 'cfg-mode', maxIterations: 9 });
    await kernel.start();

    expect(kernel.services.has('stage:deepsearch')).toBe(true);
    await expect(kernel.services.call('stage:deepsearch', 'getStatus', [])).resolves.toEqual({ status: 'idle' });

    // install() logs a message via ctx.log.info
    expect(console.info).toHaveBeenCalled();
  });

  it('run emits start/complete, passes config, updates scoped state, and caches AgentLoop', async () => {
    kernel = await createKernel();
    kernel.state.set('meta.runId', 'run_123');

    await kernel.use(deepsearchStagePlugin, { mode: 'cfg-mode', maxIterations: 9 });
    await kernel.start();

    runImpl = vi.fn(async (_input, { stageApi, runContext }) => {
      expect(stageApi).toEqual(expect.objectContaining({ eventBus: kernel.events, extra: true }));
      expect(runContext).toEqual(expect.objectContaining({ runId: 'run_123', kernel, extra: 1 }));
      return { output: ['a', 'b'] };
    });

    const startPromise = kernel.events.waitFor('stage.deepsearch.start', 500);
    const completePromise = kernel.events.waitFor('stage.deepsearch.complete', 500);

    const result1 = await kernel.services.call('stage:deepsearch', 'run', [
      { question: 'Q1' },
      { runContext: { extra: 1 }, stageApi: { extra: true } },
    ]);

    expect(result1).toEqual({ output: ['a', 'b'] });
    expect(runImpl).toHaveBeenCalledTimes(1);
    expect(constructedOptions).toHaveLength(1);
    expect(constructedOptions[0]).toEqual(expect.objectContaining({ mode: 'cfg-mode', maxIterations: 9 }));

    const started = await startPromise;
    const completed = await completePromise;
    expect(started.event).toBe('stage.deepsearch.start');
    expect(started.data).toEqual({ input: { question: 'Q1' } });
    expect(completed.event).toBe('stage.deepsearch.complete');
    expect(completed.data).toEqual({ result: { output: ['a', 'b'] } });

    expect(kernel.state.get('plugins.stage/deepsearch.status')).toBe('completed');
    expect(typeof kernel.state.get('plugins.stage/deepsearch.startedAt')).toBe('number');
    expect(typeof kernel.state.get('plugins.stage/deepsearch.completedAt')).toBe('number');
    expect(kernel.state.get('plugins.stage/deepsearch.result')).toEqual({ success: true, outputCount: 2 });

    // getStatus reads scoped state after run (no fallback)
    await expect(kernel.services.call('stage:deepsearch', 'getStatus', [])).resolves.toEqual(
      expect.objectContaining({ status: 'completed' })
    );

    // Second run should hit the AgentLoop cache branch and allow per-call overrides.
    runImpl = vi.fn(async () => ({ output: [] }));
    const result2 = await kernel.services.call('stage:deepsearch', 'run', [
      { question: 'Q2' },
      { mode: 'override-mode', maxIterations: 3 },
    ]);

    expect(result2).toEqual({ output: [] });
    expect(constructedOptions).toHaveLength(2);
    expect(constructedOptions[1]).toEqual(expect.objectContaining({ mode: 'override-mode', maxIterations: 3 }));
    expect(kernel.state.get('plugins.stage/deepsearch.result')).toEqual({ success: true, outputCount: 0 });
  });

  it('run emits error, updates state, and rethrows on agent failure', async () => {
    kernel = await createKernel();
    await kernel.use(deepsearchStagePlugin);
    await kernel.start();

    runImpl = vi.fn(async () => {
      throw new Error('boom');
    });

    const errorPromise = kernel.events.waitFor('stage.deepsearch.error', 500);

    await expect(kernel.services.call('stage:deepsearch', 'run', [{ question: 'fail' }])).rejects.toThrow(/boom/);

    const evt = await errorPromise;
    expect(evt.event).toBe('stage.deepsearch.error');
    expect(evt.data).toEqual(expect.objectContaining({ error: expect.any(Error) }));

    expect(kernel.state.get('plugins.stage/deepsearch.status')).toBe('failed');
    expect(kernel.state.get('plugins.stage/deepsearch.error')).toBe('boom');
  });

  it('uninstall removes stage:deepsearch service (via kernel.stop)', async () => {
    kernel = await createKernel();
    await kernel.use(deepsearchStagePlugin);
    await kernel.start();

    expect(kernel.services.has('stage:deepsearch')).toBe(true);

    await kernel.stop();

    expect(kernel.services.has('stage:deepsearch')).toBe(false);
    kernel = null;
  });
});

