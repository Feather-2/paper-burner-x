import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedCore = vi.hoisted(() => {
  const EventBus = vi.fn(function EventBus(options) {
    this.options = options;
  });

  const LamportClock = vi.fn(function LamportClock(state) {
    this.state = state;
  });

  const RunStoreAdapter = vi.fn(function RunStoreAdapter(runStore) {
    this.runStore = runStore;
  });

  const createEventRecord = vi.fn((options) => ({ record: options }));

  const isValidEventName = vi.fn((name) => {
    if (typeof name !== 'string') return false;
    return name.trim().length > 0;
  });

  const matchPattern = vi.fn((pattern, eventName) => pattern === eventName);

  return {
    EventBus,
    LamportClock,
    RunStoreAdapter,
    createEventRecord,
    isValidEventName,
    matchPattern,
  };
});

vi.mock('../../../../../js/agents/core/event-bus.js', () => mockedCore);

import EventBusDefault, {
  EventBus,
  LamportClock,
  RunStoreAdapter,
  createEventRecord,
  isValidEventName,
  matchPattern,
} from '../../../../../js/agents/runtime/events/event-bus.js';

const largeFileContent = 'x'.repeat(1024 * 1024);
const longString = 'y'.repeat(50_000);

const createDeepNestedObject = (depth) => {
  let current = { value: 'deep' };
  for (let i = depth; i > 0; i -= 1) {
    current = { [`level${i}`]: current };
  }
  return current;
};

const deepNested = createDeepNestedObject(25);
const objectAsArray = { 0: 'chunk', length: 1 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EventBus', () => {
  it('re-exports core EventBus', () => {
    expect(EventBus).toBe(mockedCore.EventBus);
  });

  it('constructs with options and returns instance', () => {
    const options = { runId: 'run-1' };
    const instance = new EventBus(options);

    expect(mockedCore.EventBus).toHaveBeenCalledTimes(1);
    expect(mockedCore.EventBus).toHaveBeenCalledWith(options);
    expect(instance).toBeInstanceOf(mockedCore.EventBus);
    expect(instance.options).toBe(options);
  });

  it('forwards empty and boundary constructor inputs', () => {
    const emptyObject = {};
    const emptyArray = [];

    // Empty values
    new EventBus();
    new EventBus(undefined);
    new EventBus(null);
    new EventBus(emptyObject);
    new EventBus(emptyArray);

    // Type boundary
    new EventBus(/** @type {any} */ ('not-an-object'));

    expect(mockedCore.EventBus.mock.calls.map((call) => call[0])).toEqual([
      undefined,
      undefined,
      null,
      emptyObject,
      emptyArray,
      'not-an-object',
    ]);
  });

  it('supports rapid consecutive constructions', () => {
    const optionsList = Array.from({ length: 25 }, (_, index) => ({ runId: `run-${index}` }));
    optionsList.forEach((options) => new EventBus(options));

    expect(mockedCore.EventBus).toHaveBeenCalledTimes(optionsList.length);
  });

  it('propagates constructor errors', () => {
    mockedCore.EventBus.mockImplementationOnce(function EventBusError() {
      throw new Error('EventBus ctor failed');
    });

    expect(() => new EventBus({ runId: 'bad' })).toThrow('EventBus ctor failed');
  });
});

describe('LamportClock', () => {
  it('re-exports core LamportClock', () => {
    expect(LamportClock).toBe(mockedCore.LamportClock);
  });

  it('constructs with initial state', () => {
    const state = { id: 'node-1', seq: 1 };
    const instance = new LamportClock(state);

    expect(mockedCore.LamportClock).toHaveBeenCalledTimes(1);
    expect(mockedCore.LamportClock).toHaveBeenCalledWith(state);
    expect(instance).toBeInstanceOf(mockedCore.LamportClock);
    expect(instance.state).toBe(state);
  });

  it('forwards boundary and type-edge states', () => {
    const states = [
      { seq: 0 },
      { seq: -1 },
      { seq: Number.MAX_SAFE_INTEGER },
      { seq: '0' },
      {},
      [],
      null,
    ];

    states.forEach((state) => new LamportClock(/** @type {any} */ (state)));

    expect(mockedCore.LamportClock).toHaveBeenCalledTimes(states.length);
    expect(mockedCore.LamportClock.mock.calls.map((call) => call[0])).toEqual(states);
  });

  it('supports rapid consecutive constructions', () => {
    for (let i = 0; i < 30; i += 1) new LamportClock({ seq: i });
    expect(mockedCore.LamportClock).toHaveBeenCalledTimes(30);
  });

  it('propagates constructor errors', () => {
    mockedCore.LamportClock.mockImplementationOnce(function LamportClockError() {
      throw new Error('LamportClock ctor failed');
    });

    expect(() => new LamportClock({ seq: 1 })).toThrow('LamportClock ctor failed');
  });
});

describe('RunStoreAdapter', () => {
  it('re-exports core RunStoreAdapter', () => {
    expect(RunStoreAdapter).toBe(mockedCore.RunStoreAdapter);
  });

  it('constructs with a run store', () => {
    const runStore = { getEvents: vi.fn(), appendEvents: vi.fn() };
    const instance = new RunStoreAdapter(runStore);

    expect(mockedCore.RunStoreAdapter).toHaveBeenCalledTimes(1);
    expect(mockedCore.RunStoreAdapter).toHaveBeenCalledWith(runStore);
    expect(instance).toBeInstanceOf(mockedCore.RunStoreAdapter);
    expect(instance.runStore).toBe(runStore);
  });

  it('forwards empty and boundary runStore inputs', () => {
    const emptyArray = [];
    const emptyObject = {};

    new RunStoreAdapter();
    new RunStoreAdapter(undefined);
    new RunStoreAdapter(null);
    new RunStoreAdapter(emptyArray);
    new RunStoreAdapter(emptyObject);

    expect(mockedCore.RunStoreAdapter.mock.calls.map((call) => call[0])).toEqual([
      undefined,
      undefined,
      null,
      emptyArray,
      emptyObject,
    ]);
  });

  it('propagates constructor errors', () => {
    mockedCore.RunStoreAdapter.mockImplementationOnce(function RunStoreAdapterError() {
      throw new Error('RunStoreAdapter ctor failed');
    });

    expect(() => new RunStoreAdapter({})).toThrow('RunStoreAdapter ctor failed');
  });
});

describe('createEventRecord', () => {
  it('re-exports core createEventRecord', () => {
    expect(createEventRecord).toBe(mockedCore.createEventRecord);
  });

  it('returns record from core for typical options', () => {
    const options = { name: 'event.normal', payload: { ok: true } };
    const expected = { ok: true };
    mockedCore.createEventRecord.mockReturnValueOnce(expected);

    const result = createEventRecord(options);

    expect(mockedCore.createEventRecord).toHaveBeenCalledWith(options);
    expect(result).toBe(expected);
  });

  it('forwards empty, type-edge, and resource inputs', () => {
    const emptyArray = [];
    const emptyObject = {};

    const cases = [
      undefined,
      null,
      '',
      emptyArray,
      emptyObject,
      { name: '' },
      { durationMs: '123' },
      { durationMs: 0 },
      { durationMs: -1 },
      { durationMs: Number.MAX_SAFE_INTEGER },
      { payload: objectAsArray },
      { payload: largeFileContent },
      { name: longString },
      { meta: deepNested },
    ];

    const results = cases.map((input) => createEventRecord(/** @type {any} */ (input)));

    expect(mockedCore.createEventRecord).toHaveBeenCalledTimes(cases.length);
    cases.forEach((input, index) => {
      expect(mockedCore.createEventRecord.mock.calls[index][0]).toBe(input);
      expect(results[index]).toEqual({ record: input });
    });
  });

  it('propagates errors from core', () => {
    mockedCore.createEventRecord.mockImplementationOnce(() => {
      throw new Error('createEventRecord failed');
    });

    expect(() => createEventRecord({ name: 'boom' })).toThrow('createEventRecord failed');
  });

  it('supports concurrent calls', async () => {
    const optionsList = [{ name: 'evt.1' }, { name: 'evt.2' }, { name: 'evt.3' }];

    const results = await Promise.all(
      optionsList.map((options) => Promise.resolve().then(() => createEventRecord(options)))
    );

    expect(mockedCore.createEventRecord).toHaveBeenCalledTimes(optionsList.length);
    results.forEach((result, index) => {
      expect(result).toEqual({ record: optionsList[index] });
    });
  });

  it('supports rapid consecutive calls', () => {
    for (let i = 0; i < 50; i += 1) createEventRecord({ name: `evt.${i}` });
    expect(mockedCore.createEventRecord).toHaveBeenCalledTimes(50);
  });
});

describe('isValidEventName', () => {
  it('re-exports core isValidEventName', () => {
    expect(isValidEventName).toBe(mockedCore.isValidEventName);
  });

  it('returns value from core for a typical valid name', () => {
    const result = isValidEventName('user.login');

    expect(mockedCore.isValidEventName).toHaveBeenCalledWith('user.login');
    expect(result).toBe(true);
  });

  it('handles empty, boundary, and type inputs', () => {
    const cases = [
      [null, false],
      [undefined, false],
      ['', false],
      ['   ', false],
      [0, false],
      [-1, false],
      [Number.MAX_SAFE_INTEGER, false],
      ['0', true],
      [{}, false],
      [[], false],
    ];

    cases.forEach(([input, expected]) => {
      expect(isValidEventName(/** @type {any} */ (input))).toBe(expected);
    });

    expect(mockedCore.isValidEventName).toHaveBeenCalledTimes(cases.length);
    cases.forEach(([input], index) => {
      expect(mockedCore.isValidEventName.mock.calls[index][0]).toBe(input);
    });
  });

  it('supports concurrent and rapid calls', async () => {
    const inputs = ['evt.a', 'evt.b', 'evt.c', '   ', 'evt.d'];

    const results = await Promise.all(inputs.map((name) => Promise.resolve(isValidEventName(name))));

    expect(results).toEqual([true, true, true, false, true]);
    expect(mockedCore.isValidEventName).toHaveBeenCalledTimes(inputs.length);
  });

  it('propagates errors from core', () => {
    mockedCore.isValidEventName.mockImplementationOnce(() => {
      throw new Error('isValidEventName failed');
    });

    expect(() => isValidEventName('bad')).toThrow('isValidEventName failed');
  });
});

describe('matchPattern', () => {
  it('re-exports core matchPattern', () => {
    expect(matchPattern).toBe(mockedCore.matchPattern);
  });

  it('returns value from core for a typical pattern', () => {
    mockedCore.matchPattern.mockReturnValueOnce(false);

    const result = matchPattern('user.*', 'user.login');

    expect(mockedCore.matchPattern).toHaveBeenCalledWith('user.*', 'user.login');
    expect(result).toBe(false);
  });

  it('forwards empty, whitespace, and long string boundaries', () => {
    const cases = [
      ['', ''],
      ['   ', '   '],
      [longString, longString],
    ];

    const results = cases.map(([pattern, eventName]) => matchPattern(pattern, eventName));

    expect(mockedCore.matchPattern).toHaveBeenCalledTimes(cases.length);
    results.forEach((result) => expect(result).toBe(true));
  });

  it('forwards type-edge inputs', () => {
    const result = matchPattern(/** @type {any} */ (0), /** @type {any} */ ('0'));

    expect(mockedCore.matchPattern).toHaveBeenCalledWith(0, '0');
    expect(result).toBe(false);
  });

  it('supports rapid consecutive calls', () => {
    for (let i = 0; i < 40; i += 1) matchPattern('evt', 'evt');
    expect(mockedCore.matchPattern).toHaveBeenCalledTimes(40);
  });

  it('propagates errors from core', () => {
    mockedCore.matchPattern.mockImplementationOnce(() => {
      throw new Error('matchPattern failed');
    });

    expect(() => matchPattern('x', 'y')).toThrow('matchPattern failed');
  });
});

describe('default', () => {
  it('aliases EventBus (default export)', () => {
    expect(EventBusDefault).toBe(EventBus);
    expect(EventBusDefault).toBe(mockedCore.EventBus);
  });

  it('constructs normally', () => {
    const options = { runId: 'default-run' };
    const instance = new EventBusDefault(options);

    expect(mockedCore.EventBus).toHaveBeenCalledTimes(1);
    expect(mockedCore.EventBus).toHaveBeenCalledWith(options);
    expect(instance).toBeInstanceOf(mockedCore.EventBus);
  });

  it('forwards boundary constructor inputs', () => {
    const emptyArray = [];
    const emptyObject = {};

    new EventBusDefault();
    new EventBusDefault(undefined);
    new EventBusDefault(null);
    new EventBusDefault(emptyArray);
    new EventBusDefault(emptyObject);

    expect(mockedCore.EventBus.mock.calls.map((call) => call[0])).toEqual([
      undefined,
      undefined,
      null,
      emptyArray,
      emptyObject,
    ]);
  });

  it('propagates constructor errors', () => {
    mockedCore.EventBus.mockImplementationOnce(function EventBusDefaultError() {
      throw new Error('default ctor failed');
    });

    expect(() => new EventBusDefault({ runId: 'bad' })).toThrow('default ctor failed');
  });
});
