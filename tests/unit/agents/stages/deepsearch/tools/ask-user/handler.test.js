import { describe, it, expect, vi, beforeEach } from 'vitest';

const modulePath = '../../../../../../../js/agents/stages/deepsearch/tools/ask-user/handler.js';

let definition;
let handler;
let defaultExport;
let randomUUID;

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'uuid-default'),
}));

const makeStageApi = (overrides = {}) => ({
  waitForUserInput: vi.fn().mockResolvedValue('ok'),
  ...overrides,
});

const makeDeferred = () => {
  let resolve;
  let reject;

  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const buildNestedContext = (depth) => {
  const root = {};
  let node = root;

  for (let i = 0; i < depth; i += 1) {
    node.next = {};
    node = node.next;
  }

  node.leaf = 'done';
  return root;
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  ({ randomUUID } = await import('node:crypto'));
  ({ definition, handler, default: defaultExport } = await import(modulePath));
});

describe('definition', () => {
  it('exposes expected metadata', () => {
    expect(definition).toEqual(
      expect.objectContaining({
        name: 'ask-user',
        layer: 0,
        description: expect.any(String),
        activation: {
          keywords: expect.arrayContaining(['ask', 'clarify', 'confirm']),
          phases: ['researching', 'analyzing', 'planning'],
        },
      })
    );
    expect(definition.description.length).toBeGreaterThan(0);
  });
});

describe('handler', () => {
  it('rejects when args/context are nullish', async () => {
    const stageApi = makeStageApi();
    const emit = vi.fn();

    await expect(handler(null, { emit, stageApi })).rejects.toThrow(TypeError);
    await expect(handler(undefined, { emit, stageApi })).rejects.toThrow(TypeError);
    await expect(handler({ question: 'ok' }, null)).rejects.toThrow(TypeError);
    await expect(handler({ question: 'ok' }, undefined)).rejects.toThrow(TypeError);
  });

  it('returns error when question is missing or invalid', async () => {
    const cases = [
      { args: {}, label: 'empty args object' },
      { args: { question: null }, label: 'null question' },
      { args: { question: undefined }, label: 'undefined question' },
      { args: { question: '' }, label: 'empty string question' },
      { args: { question: 0 }, label: 'zero question' },
      { args: { question: -1 }, label: 'negative question' },
      { args: { question: Number.MAX_SAFE_INTEGER }, label: 'max safe integer' },
      { args: { question: {} }, label: 'object question' },
      { args: { question: [] }, label: 'array question' },
      { args: { question: new String('abc') }, label: 'boxed string question' },
    ];

    for (const { args, label } of cases) {
      const emit = vi.fn();
      const stageApi = makeStageApi({ waitForUserInput: vi.fn() });
      const result = await handler(args, { emit, stageApi });

      expect(result, label).toEqual({ success: false, error: 'question is required' });
      expect(stageApi.waitForUserInput).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    }
  });

  it('treats numeric-looking strings as valid question', async () => {
    const emit = vi.fn();
    const result = await handler({ question: '0' }, { emit, stageApi: undefined });

    expect(result).toEqual({
      success: false,
      error: 'Interactive mode not available. Running in batch mode.',
      question: '0',
    });
    expect(emit).toHaveBeenCalledWith('deepsearch.user.input.skipped', {
      question: '0',
      reason: 'no interactive mode',
    });
  });

  it('handles empty context object (no emit/stageApi)', async () => {
    await expect(handler({ question: 'ready' }, {})).resolves.toEqual({
      success: false,
      error: 'Interactive mode not available. Running in batch mode.',
      question: 'ready',
    });
  });

  it('returns error when interactive mode is unavailable', async () => {
    const cases = [
      { stageApi: undefined, label: 'missing stageApi' },
      { stageApi: null, label: 'null stageApi' },
      { stageApi: {}, label: 'missing method' },
      { stageApi: { waitForUserInput: 'nope' }, label: 'non-function' },
    ];

    for (const { stageApi, label } of cases) {
      const emit = vi.fn();
      const result = await handler({ question: 'ready' }, { emit, stageApi });

      expect(result, label).toEqual({
        success: false,
        error: 'Interactive mode not available. Running in batch mode.',
        question: 'ready',
      });
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith('deepsearch.user.input.skipped', {
        question: 'ready',
        reason: 'no interactive mode',
      });
    }
  });

  it('emits required and received events on success', async () => {
    const question = '123';
    const options = ['yes', 'no'];
    const questionContext = 'context';
    const emit = vi.fn();
    const stageApi = makeStageApi({
      waitForUserInput: vi.fn().mockResolvedValue('yes'),
    });

    const result = await handler({ question, options, context: questionContext }, { emit, stageApi });

    expect(stageApi.waitForUserInput).toHaveBeenCalledTimes(1);
    expect(stageApi.waitForUserInput).toHaveBeenCalledWith({ question, options });
    expect(emit.mock.calls).toEqual([
      ['deepsearch.user.input.required', { question, options, context: questionContext }],
      ['deepsearch.user.input.received', { question, answer: 'yes' }],
    ]);
    expect(result).toEqual({
      success: true,
      question,
      answer: 'yes',
      hasOptions: true,
    });
  });

  it('normalizes missing options and empty context string for required event', async () => {
    const question = 'ready';
    const emit = vi.fn();
    const stageApi = makeStageApi({ waitForUserInput: vi.fn().mockResolvedValue('ok') });

    const result = await handler({ question, context: '' }, { emit, stageApi });

    expect(stageApi.waitForUserInput).toHaveBeenCalledWith({ question, options: undefined });
    expect(emit.mock.calls[0]).toEqual([
      'deepsearch.user.input.required',
      { question, options: null, context: null },
    ]);
    expect(result).toEqual({ success: true, question, answer: 'ok', hasOptions: false });
  });

  it('handles options:null and whitespace context', async () => {
    const question = 'ready';
    const emit = vi.fn();
    const stageApi = makeStageApi({ waitForUserInput: vi.fn().mockResolvedValue('ok') });

    const result = await handler({ question, options: null, context: '   ' }, { emit, stageApi });

    expect(stageApi.waitForUserInput).toHaveBeenCalledWith({ question, options: null });
    expect(emit.mock.calls[0]).toEqual([
      'deepsearch.user.input.required',
      { question, options: null, context: '   ' },
    ]);
    expect(result).toEqual({ success: true, question, answer: 'ok', hasOptions: false });
  });

  it('handles empty options array and empty context object', async () => {
    const emit = vi.fn();
    const stageApi = makeStageApi({ waitForUserInput: vi.fn().mockResolvedValue('ok') });
    const options = [];
    const questionContext = {};

    const result = await handler({ question: 'ready', options, context: questionContext }, { emit, stageApi });

    expect(result).toEqual({
      success: true,
      question: 'ready',
      answer: 'ok',
      hasOptions: false,
    });
    expect(emit.mock.calls).toEqual([
      ['deepsearch.user.input.required', { question: 'ready', options, context: questionContext }],
      ['deepsearch.user.input.received', { question: 'ready', answer: 'ok' }],
    ]);
  });

  it('accepts whitespace question and plain object options (type boundary)', async () => {
    const question = '   ';
    const options = {};
    const emit = vi.fn();
    const stageApi = makeStageApi({ waitForUserInput: vi.fn().mockResolvedValue('choice') });

    const result = await handler({ question, options }, { emit, stageApi });

    expect(stageApi.waitForUserInput).toHaveBeenCalledWith({ question, options });
    expect(emit.mock.calls[0]).toEqual([
      'deepsearch.user.input.required',
      { question, options, context: null },
    ]);
    expect(result).toEqual({
      success: true,
      question,
      answer: 'choice',
      hasOptions: false,
    });
  });

  it('treats string options as array-like (type boundary)', async () => {
    const question = 'pick';
    const options = '0';
    const emit = vi.fn();
    const stageApi = makeStageApi({ waitForUserInput: vi.fn().mockResolvedValue('0') });

    const result = await handler({ question, options }, { emit, stageApi });

    expect(stageApi.waitForUserInput).toHaveBeenCalledWith({ question, options });
    expect(emit.mock.calls[0]).toEqual([
      'deepsearch.user.input.required',
      { question, options, context: null },
    ]);
    expect(result).toEqual({ success: true, question, answer: '0', hasOptions: true });
  });

  it('does not require emit to succeed in interactive mode', async () => {
    const stageApi = makeStageApi({ waitForUserInput: vi.fn().mockResolvedValue('ok') });

    await expect(handler({ question: 'ready' }, { stageApi })).resolves.toEqual({
      success: true,
      question: 'ready',
      answer: 'ok',
      hasOptions: false,
    });
  });

  it('returns error when waitForUserInput rejects with Error', async () => {
    const emit = vi.fn();
    const stageApi = makeStageApi({
      waitForUserInput: vi.fn().mockRejectedValue(new Error('boom')),
    });

    const result = await handler({ question: 'fail' }, { emit, stageApi });

    expect(result).toEqual({ success: false, error: 'boom', question: 'fail' });
    expect(emit.mock.calls).toEqual([
      ['deepsearch.user.input.required', { question: 'fail', options: null, context: null }],
      ['deepsearch.user.input.failed', { question: 'fail', error: 'boom' }],
    ]);
  });

  it('returns error when waitForUserInput rejects with non-Error values', async () => {
    const cases = [
      { thrown: 'fail', expected: 'fail' },
      { thrown: 0, expected: '0' },
      { thrown: {}, expected: '[object Object]' },
    ];

    for (const { thrown, expected } of cases) {
      const emit = vi.fn();
      const stageApi = makeStageApi({ waitForUserInput: vi.fn().mockRejectedValue(thrown) });

      const result = await handler({ question: 'fail' }, { emit, stageApi });

      expect(result).toEqual({ success: false, error: expected, question: 'fail' });
      expect(emit.mock.calls[1]).toEqual([
        'deepsearch.user.input.failed',
        { question: 'fail', error: expected },
      ]);
    }
  });

  it('supports concurrent calls (simultaneous)', async () => {
    randomUUID.mockReturnValueOnce('uuid-a').mockReturnValueOnce('uuid-b');
    const questionA = randomUUID();
    const questionB = randomUUID();

    const deferredA = makeDeferred();
    const deferredB = makeDeferred();

    const stageApi = makeStageApi({
      waitForUserInput: vi.fn().mockImplementation(({ question }) => {
        if (question === questionA) return deferredA.promise;
        if (question === questionB) return deferredB.promise;
        return Promise.reject(new Error(`unexpected question: ${String(question)}`));
      }),
    });

    const emitA = vi.fn();
    const emitB = vi.fn();

    const promiseA = handler({ question: questionA }, { emit: emitA, stageApi });
    const promiseB = handler({ question: questionB }, { emit: emitB, stageApi });

    expect(emitA).toHaveBeenCalledWith('deepsearch.user.input.required', {
      question: questionA,
      options: null,
      context: null,
    });
    expect(emitB).toHaveBeenCalledWith('deepsearch.user.input.required', {
      question: questionB,
      options: null,
      context: null,
    });

    deferredA.resolve(`answer:${questionA}`);
    deferredB.resolve(`answer:${questionB}`);

    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

    expect(stageApi.waitForUserInput).toHaveBeenCalledTimes(2);
    expect(resultA).toEqual({
      success: true,
      question: questionA,
      answer: `answer:${questionA}`,
      hasOptions: false,
    });
    expect(resultB).toEqual({
      success: true,
      question: questionB,
      answer: `answer:${questionB}`,
      hasOptions: false,
    });
    expect(emitA).toHaveBeenCalledWith('deepsearch.user.input.received', {
      question: questionA,
      answer: `answer:${questionA}`,
    });
    expect(emitB).toHaveBeenCalledWith('deepsearch.user.input.received', {
      question: questionB,
      answer: `answer:${questionB}`,
    });
  });

  it('supports rapid consecutive calls', async () => {
    const emit = vi.fn();
    const stageApi = makeStageApi({
      waitForUserInput: vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second'),
    });

    const first = await handler({ question: 'q1' }, { emit, stageApi });
    const second = await handler({ question: 'q2' }, { emit, stageApi });

    expect(stageApi.waitForUserInput).toHaveBeenCalledTimes(2);
    expect(stageApi.waitForUserInput).toHaveBeenNthCalledWith(1, { question: 'q1', options: undefined });
    expect(stageApi.waitForUserInput).toHaveBeenNthCalledWith(2, { question: 'q2', options: undefined });
    expect(first.answer).toBe('first');
    expect(second.answer).toBe('second');
    expect(emit.mock.calls).toEqual([
      ['deepsearch.user.input.required', { question: 'q1', options: null, context: null }],
      ['deepsearch.user.input.received', { question: 'q1', answer: 'first' }],
      ['deepsearch.user.input.required', { question: 'q2', options: null, context: null }],
      ['deepsearch.user.input.received', { question: 'q2', answer: 'second' }],
    ]);
  });

  it('handles resource boundaries (large strings, deep nesting, huge options)', async () => {
    const longQuestion = 'q'.repeat(100_000);
    const largeFileContent = 'x'.repeat(1_000_000);
    const deepContext = buildNestedContext(80);
    const hugeOptions = Array.from({ length: 10_000 }, (_, i) => `opt-${i}`);
    const questionContext = { fileContent: largeFileContent, nested: deepContext };

    const emit = vi.fn();
    const stageApi = makeStageApi({ waitForUserInput: vi.fn().mockResolvedValue('ok') });

    const result = await handler(
      { question: longQuestion, options: hugeOptions, context: questionContext },
      { emit, stageApi }
    );

    expect(result).toEqual({
      success: true,
      question: longQuestion,
      answer: 'ok',
      hasOptions: true,
    });

    const requiredCall = emit.mock.calls.find(([event]) => event === 'deepsearch.user.input.required');
    expect(requiredCall).toBeTruthy();
    const payload = requiredCall[1];

    expect(payload.question.length).toBe(longQuestion.length);
    expect(payload.options.length).toBe(hugeOptions.length);
    expect(payload.context.fileContent.length).toBe(largeFileContent.length);

    let node = payload.context.nested;
    for (let i = 0; i < 80; i += 1) node = node.next;
    expect(node.leaf).toBe('done');
  });
});

describe('default', () => {
  it('exposes definition and handler', () => {
    expect(defaultExport.definition).toBe(definition);
    expect(defaultExport.handler).toBe(handler);
  });
});
