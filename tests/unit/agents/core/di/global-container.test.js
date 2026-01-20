import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockContainerCtor = vi.hoisted(() =>
  vi.fn(function Container() {
    this.get = vi.fn();
  })
);

vi.mock('../../../../../js/agents/core/di/container.js', () => ({
  Container: mockContainerCtor,
}));

import { getGlobalContainer, setGlobalContainer } from '../../../../../js/agents/core/di/global-container.js';

const GLOBAL_CONTAINER_KEY = Symbol.for('pb.agents.di.globalContainer');
const LONG_STRING = 'x'.repeat(10000);
const HUGE_STRING = 'y'.repeat(1024 * 1024);
const HUGE_FILE = new Uint8Array(1024 * 1024);

const makeDeepObject = (depth) => {
  let root = {};
  let current = root;

  for (let i = 0; i < depth; i += 1) {
    current.next = {};
    current = current.next;
  }

  return root;
};

const DEEP_OBJECT = makeDeepObject(32);

beforeEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(globalThis, GLOBAL_CONTAINER_KEY);
  process.env.NODE_ENV = 'test';
});

describe('getGlobalContainer', () => {
  it('creates and stores a new container when missing', () => {
    const container = getGlobalContainer();

    expect(mockContainerCtor).toHaveBeenCalledTimes(1);
    expect(container).toBe(globalThis[GLOBAL_CONTAINER_KEY]);
    expect(typeof container.get).toBe('function');
  });

  it('returns existing container with get()', () => {
    const existing = { get: vi.fn() };
    globalThis[GLOBAL_CONTAINER_KEY] = existing;

    const container = getGlobalContainer();

    expect(container).toBe(existing);
    expect(mockContainerCtor).not.toHaveBeenCalled();
  });

  it('replaces non-container values without get()', () => {
    const existing = { get: 'nope' };
    globalThis[GLOBAL_CONTAINER_KEY] = existing;

    const container = getGlobalContainer();

    expect(container).not.toBe(existing);
    expect(container).toBe(globalThis[GLOBAL_CONTAINER_KEY]);
    expect(typeof container.get).toBe('function');
    expect(mockContainerCtor).toHaveBeenCalledTimes(1);
  });

  it('keeps a single instance under concurrent and rapid calls', async () => {
    const results = await Promise.all(
      Array.from({ length: 32 }, () => Promise.resolve(getGlobalContainer()))
    );

    const first = results[0];
    expect(results.every((item) => item === first)).toBe(true);

    const rapid = [];
    for (let i = 0; i < 50; i += 1) {
      rapid.push(getGlobalContainer());
    }

    expect(new Set(rapid).size).toBe(1);
    expect(mockContainerCtor).toHaveBeenCalledTimes(1);
  });
});

describe('setGlobalContainer', () => {
  it('throws outside test environments', () => {
    process.env.NODE_ENV = 'production';

    expect(() => setGlobalContainer({ get: vi.fn() })).toThrowError(
      'setGlobalContainer is only allowed in test environments'
    );
    expect(Reflect.has(globalThis, GLOBAL_CONTAINER_KEY)).toBe(false);
  });

  it('clears global container for nullish or falsy values', () => {
    const values = [null, undefined, '', 0];

    values.forEach((value) => {
      globalThis[GLOBAL_CONTAINER_KEY] = { get: vi.fn() };
      expect(Reflect.has(globalThis, GLOBAL_CONTAINER_KEY)).toBe(true);

      setGlobalContainer(value);

      expect(Reflect.has(globalThis, GLOBAL_CONTAINER_KEY)).toBe(false);
    });
  });

  it('stores boundary and resource values as-is', () => {
    const arrayLike = { 0: 'x', length: 1 };
    const values = [
      [],
      {},
      '   ',
      -1,
      Number.MAX_SAFE_INTEGER,
      '123',
      arrayLike,
      LONG_STRING,
      HUGE_STRING,
      HUGE_FILE,
      DEEP_OBJECT,
    ];

    values.forEach((value) => {
      setGlobalContainer(value);
      expect(globalThis[GLOBAL_CONTAINER_KEY]).toBe(value);
    });
  });

  it('handles rapid consecutive updates', () => {
    const first = { get: vi.fn(), id: 'first' };
    const second = { get: vi.fn(), id: 'second' };

    setGlobalContainer(first);
    setGlobalContainer(second);

    expect(globalThis[GLOBAL_CONTAINER_KEY]).toBe(second);

    let last = null;
    for (let i = 0; i < 10; i += 1) {
      last = { get: vi.fn(), seq: i };
      setGlobalContainer(last);
    }

    expect(globalThis[GLOBAL_CONTAINER_KEY]).toBe(last);
  });
});
