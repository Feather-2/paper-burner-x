import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/runtime/tools/tool-executor-worker-shared.js', () => ({
  createToolExecutorHandler: vi.fn(),
}));

const SUBJECT_PATH = '../../../../../js/agents/runtime/tools/tool-executor-webworker.js';
const SHARED_PATH = '../../../../../js/agents/runtime/tools/tool-executor-worker-shared.js';

function buildDeepObject(depth) {
  let current = { leaf: true };
  for (let i = 0; i < depth; i += 1) {
    current = { level: i, child: current };
  }
  return current;
}

async function loadSubject({ withClose = true } = {}) {
  vi.resetModules();

  const selfMock = {
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    close: withClose ? vi.fn() : undefined,
  };

  vi.stubGlobal('self', selfMock);

  const shared = await import(SHARED_PATH);
  const createToolExecutorHandler = shared.createToolExecutorHandler;
  createToolExecutorHandler.mockClear();

  await import(SUBJECT_PATH);

  expect(createToolExecutorHandler).toHaveBeenCalledTimes(1);
  const handler = createToolExecutorHandler.mock.calls[0][0];

  return { handler, selfMock, createToolExecutorHandler };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('tool-executor-webworker.js (module side-effects)', () => {
  it('registers createToolExecutorHandler with worker adapters', async () => {
    const { handler, createToolExecutorHandler } = await loadSubject();

    expect(createToolExecutorHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        postMessage: expect.any(Function),
        onMessage: expect.any(Function),
        close: expect.any(Function),
      }),
    );

    expect(handler).toEqual(
      expect.objectContaining({
        postMessage: expect.any(Function),
        onMessage: expect.any(Function),
        close: expect.any(Function),
      }),
    );
  });

  it('postMessage forwards to self.postMessage (supports large payloads)', async () => {
    const { handler, selfMock } = await loadSubject();

    const msg = {
      type: 'any',
      payload: {
        url: 'file://' + 'a'.repeat(20000),
        text: 'x'.repeat(100000),
        nested: buildDeepObject(50),
      },
    };

    handler.postMessage(msg);

    expect(selfMock.postMessage).toHaveBeenCalledTimes(1);
    expect(selfMock.postMessage).toHaveBeenCalledWith(msg);
  });

  it('close calls self.close when available', async () => {
    const { handler, selfMock } = await loadSubject({ withClose: true });

    handler.close();

    expect(selfMock.close).toHaveBeenCalledTimes(1);
  });

  it('close is a no-op when self.close is missing', async () => {
    const { handler } = await loadSubject({ withClose: false });

    expect(() => handler.close()).not.toThrow();
  });

  it('onMessage passes through non-execute payloads (null/undefined/primitives/empty)', async () => {
    const { handler, selfMock } = await loadSubject();

    const cb = vi.fn();
    handler.onMessage(cb);

    expect(selfMock.addEventListener).toHaveBeenCalledTimes(1);
    expect(selfMock.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));

    const listener = selfMock.addEventListener.mock.calls[0][1];

    const emptyArray = [];
    const emptyObject = {};
    const nonExecuteObject = { type: 'noop', ok: true };

    const cases = [
      { label: 'event is undefined', call: () => listener(), expected: undefined },
      { label: 'event missing data', call: () => listener({}), expected: undefined },
      { label: 'data is undefined', call: () => listener({ data: undefined }), expected: undefined },
      { label: 'data is null', call: () => listener({ data: null }), expected: null },
      { label: 'empty string', call: () => listener({ data: '' }), expected: '' },
      { label: 'whitespace string', call: () => listener({ data: '   ' }), expected: '   ' },
      { label: 'zero', call: () => listener({ data: 0 }), expected: 0 },
      { label: 'negative', call: () => listener({ data: -1 }), expected: -1 },
      {
        label: 'MAX_SAFE_INTEGER',
        call: () => listener({ data: Number.MAX_SAFE_INTEGER }),
        expected: Number.MAX_SAFE_INTEGER,
      },
      { label: 'empty array', call: () => listener({ data: emptyArray }), expected: emptyArray },
      { label: 'empty object', call: () => listener({ data: emptyObject }), expected: emptyObject },
      {
        label: 'non-execute object',
        call: () => listener({ data: nonExecuteObject }),
        expected: nonExecuteObject,
      },
    ];

    for (const testCase of cases) {
      expect(() => testCase.call()).not.toThrow();
      expect(cb).toHaveBeenLastCalledWith(testCase.expected);
    }

    expect(cb).toHaveBeenCalledTimes(cases.length);
  });

  it('normalizes legacy execute messages (exportName/context shape)', async () => {
    const { handler, selfMock } = await loadSubject();

    const cb = vi.fn();
    handler.onMessage(cb);

    const listener = selfMock.addEventListener.mock.calls[0][1];

    const deepContext = buildDeepObject(120);
    const hugeArg = 'x'.repeat(100000);
    const longExportName = 'h'.repeat(10000);

    const legacyEmptyExport = {
      type: 'execute',
      id: 0,
      moduleUrl: 'mod://legacy',
      exportName: '',
      args: { a: 1 },
      context: { b: 2 },
    };

    listener({ data: legacyEmptyExport });
    const normalized1 = cb.mock.calls[cb.mock.calls.length - 1][0];

    expect(normalized1).toEqual({
      type: 'execute',
      id: 0,
      moduleUrl: 'mod://legacy',
      handlerName: 'handler',
      args: [{ a: 1 }, { b: 2 }],
    });
    expect(normalized1).not.toBe(legacyEmptyExport);

    const legacyWhitespaceExport = {
      type: 'execute',
      id: -1,
      moduleUrl: '',
      exportName: '   ',
      args: hugeArg,
      context: deepContext,
    };

    listener({ data: legacyWhitespaceExport });
    const normalized2 = cb.mock.calls[cb.mock.calls.length - 1][0];

    expect(normalized2).toEqual({
      type: 'execute',
      id: -1,
      moduleUrl: '',
      handlerName: '   ',
      args: [hugeArg, deepContext],
    });

    const legacyNonStringExport = {
      type: 'execute',
      id: Number.MAX_SAFE_INTEGER,
      moduleUrl: 'mod://legacy-nonstring',
      exportName: 123,
      args: null,
      context: undefined,
    };

    listener({ data: legacyNonStringExport });
    const normalized3 = cb.mock.calls[cb.mock.calls.length - 1][0];

    expect(normalized3).toEqual({
      type: 'execute',
      id: Number.MAX_SAFE_INTEGER,
      moduleUrl: 'mod://legacy-nonstring',
      handlerName: 'handler',
      args: [null, undefined],
    });

    const legacyContextOnly = {
      type: 'execute',
      id: '1',
      moduleUrl: 'mod://legacy-context-only',
      args: 'payload',
      context: undefined,
    };

    listener({ data: legacyContextOnly });
    const normalized4 = cb.mock.calls[cb.mock.calls.length - 1][0];

    expect(normalized4).toEqual({
      type: 'execute',
      id: '1',
      moduleUrl: 'mod://legacy-context-only',
      handlerName: 'handler',
      args: ['payload', undefined],
    });

    const legacyTakesPrecedenceOverModernFields = {
      type: 'execute',
      id: 2,
      moduleUrl: 'mod://mixed',
      handlerName: 'should-be-ignored',
      args: ['array-should-be-wrapped'],
      context: { c: true },
    };

    listener({ data: legacyTakesPrecedenceOverModernFields });
    const normalized5 = cb.mock.calls[cb.mock.calls.length - 1][0];

    expect(normalized5).toEqual({
      type: 'execute',
      id: 2,
      moduleUrl: 'mod://mixed',
      handlerName: 'handler',
      args: [['array-should-be-wrapped'], { c: true }],
    });

    const legacyLongExportName = {
      type: 'execute',
      id: 3,
      moduleUrl: 'mod://' + 'a'.repeat(20000),
      exportName: longExportName,
      args: [],
      context: {},
    };

    listener({ data: legacyLongExportName });
    const normalized6 = cb.mock.calls[cb.mock.calls.length - 1][0];

    expect(normalized6.handlerName).toBe(longExportName);
    expect(normalized6.args).toEqual([[], {}]);
  });

  it('normalizes modern execute messages (handlerName + args array), defaulting args to [] for non-arrays', async () => {
    const { handler, selfMock } = await loadSubject();

    const cb = vi.fn();
    handler.onMessage(cb);

    const listener = selfMock.addEventListener.mock.calls[0][1];

    const deep = buildDeepObject(150);
    const huge = 'z'.repeat(100000);
    const argsArray = [huge, deep];

    const modernOk = {
      type: 'execute',
      id: '007',
      moduleUrl: 'mod://modern',
      handlerName: 'run',
      args: argsArray,
    };

    listener({ data: modernOk });
    const normalized1 = cb.mock.calls[cb.mock.calls.length - 1][0];

    expect(normalized1).toEqual({
      type: 'execute',
      id: '007',
      moduleUrl: 'mod://modern',
      handlerName: 'run',
      args: argsArray,
    });
    expect(normalized1).not.toBe(modernOk);
    expect(normalized1.args).toBe(argsArray);

    const modernArgsObject = {
      type: 'execute',
      id: 0,
      moduleUrl: 'mod://modern-nonarray',
      handlerName: 'h',
      args: { 0: 'a', length: 1 },
    };

    listener({ data: modernArgsObject });
    const normalized2 = cb.mock.calls[cb.mock.calls.length - 1][0];

    expect(normalized2).toEqual({
      type: 'execute',
      id: 0,
      moduleUrl: 'mod://modern-nonarray',
      handlerName: 'h',
      args: [],
    });

    const modernArgsNull = {
      type: 'execute',
      id: -1,
      moduleUrl: '',
      handlerName: '   ',
      args: null,
    };

    listener({ data: modernArgsNull });
    const normalized3 = cb.mock.calls[cb.mock.calls.length - 1][0];

    expect(normalized3).toEqual({
      type: 'execute',
      id: -1,
      moduleUrl: '',
      handlerName: '   ',
      args: [],
    });

    const modernMissingFields = {
      type: 'execute',
      id: Number.MAX_SAFE_INTEGER,
      moduleUrl: undefined,
      args: [],
    };

    listener({ data: modernMissingFields });
    const normalized4 = cb.mock.calls[cb.mock.calls.length - 1][0];

    expect(normalized4).toEqual({
      type: 'execute',
      id: Number.MAX_SAFE_INTEGER,
      moduleUrl: undefined,
      handlerName: undefined,
      args: modernMissingFields.args,
    });
    expect(normalized4.args).toBe(modernMissingFields.args);
  });

  it('handles rapid consecutive messages and multiple onMessage registrations', async () => {
    const { handler, selfMock } = await loadSubject();

    const cb1 = vi.fn();
    const cb2 = vi.fn();

    handler.onMessage(cb1);
    handler.onMessage(cb2);

    expect(selfMock.addEventListener).toHaveBeenCalledTimes(2);

    const listener1 = selfMock.addEventListener.mock.calls[0][1];
    const listener2 = selfMock.addEventListener.mock.calls[1][1];

    const msg1 = { type: 'execute', id: 1, moduleUrl: 'mod://c', handlerName: 'h', args: [1] };
    const msg2 = { type: 'execute', id: 2, moduleUrl: 'mod://c', handlerName: 'h', args: [2] };

    listener1({ data: msg1 });
    listener1({ data: msg2 });

    expect(cb1).toHaveBeenCalledTimes(2);
    expect(cb1.mock.calls[0][0]).toEqual({
      type: 'execute',
      id: 1,
      moduleUrl: 'mod://c',
      handlerName: 'h',
      args: [1],
    });
    expect(cb1.mock.calls[1][0]).toEqual({
      type: 'execute',
      id: 2,
      moduleUrl: 'mod://c',
      handlerName: 'h',
      args: [2],
    });
    expect(cb1.mock.calls[0][0]).not.toBe(cb1.mock.calls[1][0]);

    await Promise.all([
      Promise.resolve().then(() => listener2({ data: msg1 })),
      Promise.resolve().then(() => listener2({ data: msg2 })),
    ]);

    expect(cb2).toHaveBeenCalledTimes(2);
    const receivedIds = cb2.mock.calls.map((call) => call[0]?.id).sort();
    expect(receivedIds).toEqual([1, 2]);
  });
});