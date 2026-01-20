import { describe, it, expect, vi, beforeEach } from 'vitest';

const phaseMocks = vi.hoisted(() => ({
  runPlanningPhase: vi.fn(),
  buildSystemPrompt: vi.fn(),
  formatOpenTodos: vi.fn(),
  isTodoOpen: vi.fn(),
  runExecutionStep: vi.fn(),
  runSummarizingPhase: vi.fn(),
  buildTodoCompletionStats: vi.fn(),
}));

vi.mock('../../../../../../js/agents/stages/codesearch/phases/planning-phase.js', () => ({
  runPlanningPhase: phaseMocks.runPlanningPhase,
  buildSystemPrompt: phaseMocks.buildSystemPrompt,
  formatOpenTodos: phaseMocks.formatOpenTodos,
  isTodoOpen: phaseMocks.isTodoOpen,
}));

vi.mock('../../../../../../js/agents/stages/codesearch/phases/execution-phase.js', () => ({
  runExecutionStep: phaseMocks.runExecutionStep,
}));

vi.mock('../../../../../../js/agents/stages/codesearch/phases/summarizing-phase.js', () => ({
  runSummarizingPhase: phaseMocks.runSummarizingPhase,
  buildTodoCompletionStats: phaseMocks.buildTodoCompletionStats,
}));

import {
  runPlanningPhase,
  buildSystemPrompt,
  formatOpenTodos,
  isTodoOpen,
  runExecutionStep,
  runSummarizingPhase,
  buildTodoCompletionStats,
} from '../../../../../../js/agents/stages/codesearch/phases/index.js';

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let current = root;

  for (let i = 1; i <= depth; i += 1) {
    current.child = { level: i };
    current = current.child;
  }

  return root;
};

const longString = 'x'.repeat(100000);
const largeArray = Array.from({ length: 20000 }, (_, index) => index);
const deepNestedObject = buildDeepObject(64);
const largeFileLike = {
  name: 'big.txt',
  size: longString.length,
  content: longString,
  chunks: largeArray,
  meta: { nested: deepNestedObject },
};

const edgeCases = [
  { label: 'null', value: null },
  { label: 'undefined', value: undefined },
  { label: 'empty string', value: '' },
  { label: 'whitespace string', value: '   ' },
  { label: 'empty array', value: [] },
  { label: 'empty object', value: {} },
  { label: 'zero', value: 0 },
  { label: 'negative one', value: -1 },
  { label: 'max safe integer', value: Number.MAX_SAFE_INTEGER },
  { label: 'numeric string', value: '42' },
  { label: 'array-like object', value: { 0: 'a', length: 1 } },
];

const resourceCases = [
  { label: 'long string', value: longString },
  { label: 'large array payload', value: largeArray },
  { label: 'deep nested object', value: deepNestedObject },
  { label: 'large file-like object', value: largeFileLike },
];

beforeEach(() => {
  Object.values(phaseMocks).forEach((mockFn) => {
    mockFn.mockReset();
  });
});

function defineExportTests(name, exportedFn, mockFn, normalArgs = [{ ok: true }]) {
  describe(name, () => {
    it('re-exports the underlying function', () => {
      expect(exportedFn).toBe(mockFn);
    });

    it('returns the underlying result on the normal path', () => {
      const output = { result: 'ok' };
      mockFn.mockReturnValue(output);

      const result = exportedFn(...normalArgs);

      expect(result).toBe(output);
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith(...normalArgs);
    });

    it.each(edgeCases)('forwards boundary input: $label', ({ value }) => {
      mockFn.mockImplementation((arg) => ({ arg }));

      const result = exportedFn(value);

      expect(result).toEqual({ arg: value });
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith(value);
    });

    it.each(resourceCases)('forwards resource boundary input: $label', ({ value }) => {
      mockFn.mockImplementation((arg) => ({ arg }));

      const result = exportedFn(value);

      expect(result).toEqual({ arg: value });
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith(value);
    });

    it('propagates errors from the underlying function', () => {
      const error = new Error('boom');
      mockFn.mockImplementation((arg) => {
        if (arg === 'throw') {
          throw error;
        }
        return 'ok';
      });

      expect(() => exportedFn('throw')).toThrow(error);
      expect(mockFn).toHaveBeenCalledWith('throw');
    });

    it('supports concurrent calls', async () => {
      mockFn.mockImplementation((value) => Promise.resolve(`ok:${value}`));

      const results = await Promise.all([
        exportedFn('a'),
        exportedFn('b'),
        exportedFn('c'),
      ]);

      expect(results).toEqual(['ok:a', 'ok:b', 'ok:c']);
      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(mockFn).toHaveBeenNthCalledWith(1, 'a');
      expect(mockFn).toHaveBeenNthCalledWith(2, 'b');
      expect(mockFn).toHaveBeenNthCalledWith(3, 'c');
    });

    it('supports rapid consecutive calls', () => {
      mockFn.mockImplementation((value) => `ok:${value}`);

      for (let i = 0; i < 25; i += 1) {
        exportedFn(i);
      }

      expect(mockFn).toHaveBeenCalledTimes(25);
      expect(mockFn).toHaveBeenLastCalledWith(24);
    });
  });
}

defineExportTests('runPlanningPhase', runPlanningPhase, phaseMocks.runPlanningPhase, [{ query: 'q' }]);
defineExportTests('buildSystemPrompt', buildSystemPrompt, phaseMocks.buildSystemPrompt, []);
defineExportTests('formatOpenTodos', formatOpenTodos, phaseMocks.formatOpenTodos, [[{ text: 'todo' }]]);
defineExportTests('isTodoOpen', isTodoOpen, phaseMocks.isTodoOpen, [{ status: 'open' }]);
defineExportTests('runExecutionStep', runExecutionStep, phaseMocks.runExecutionStep, [{ step: 1 }]);
defineExportTests('runSummarizingPhase', runSummarizingPhase, phaseMocks.runSummarizingPhase, [{ summary: true }]);
defineExportTests('buildTodoCompletionStats', buildTodoCompletionStats, phaseMocks.buildTodoCompletionStats, [[{ status: 'open' }]]);
