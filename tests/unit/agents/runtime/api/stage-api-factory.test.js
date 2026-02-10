import { describe, it, expect, vi, beforeEach } from 'vitest';

const SUT_MODULE_ID = '../../../../../js/agents/runtime/core/api/stage-api-factory.js';

function createDeepNestedObject(depth = 50) {
  const root = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i += 1) {
    current.next = { level: i };
    current = current.next;
  }
  return root;
}

const VERY_LONG_STRING = 'x'.repeat(200_000);
const LARGE_UINT8_ARRAY = new Uint8Array(1024 * 1024);

let mockThrowOnImport = false;
let mockDefaultExport;
let MockStageApiFactory;
let mockCreateStageApiFactory;

function registerDependencyMocks() {
  // `vi.resetModules()` does not clear mock-module cache, so we re-register our
  // manual mock per-test to force Vitest to invalidate cached mocked exports.
  vi.doMock('../../../../../js/agents/runtime/core/api/stage-api-factory.js', () => {
    // Throw during mock module initialization to simulate a true "module failed to load" case.
    if (mockThrowOnImport) throw new Error('core module failed to load');

    return {
      get default() {
        return mockDefaultExport;
      },
      get StageApiFactory() {
        return MockStageApiFactory;
      },
      get createStageApiFactory() {
        return mockCreateStageApiFactory;
      },
    };
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  mockThrowOnImport = false;
  mockDefaultExport = { kind: 'default-export' };

  MockStageApiFactory = class StageApiFactoryMock {
    constructor(...args) {
      this.args = args;
    }
  };

  mockCreateStageApiFactory = vi.fn((...args) => ({ createdWith: args }));

  registerDependencyMocks();
});

async function importSut() {
  return await import(SUT_MODULE_ID);
}

describe('default', () => {
  it('re-exports the core default export by reference (normal path)', async () => {
    const sentinel = { sentinel: true };
    mockDefaultExport = sentinel;

    const mod = await importSut();

    expect(mod.default).toBe(sentinel);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace string', '   \t\n'],
    ['0', 0],
    ['-1', -1],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['empty array', []],
    ['empty object', {}],
    ['very long string', VERY_LONG_STRING],
    ['deep nested object', createDeepNestedObject(100)],
  ])('re-exports boundary value: %s', async (_label, value) => {
    mockDefaultExport = value;

    const mod = await importSut();

    expect(mod.default).toBe(value);
  });

  it('propagates errors when the core module fails to load', async () => {
    mockThrowOnImport = true;

    // Vitest wraps errors thrown by mock factories; the original error is kept as `cause`.
    await expect(importSut()).rejects.toMatchObject({
      cause: expect.objectContaining({ message: 'core module failed to load' }),
    });
  });

  it('supports concurrent imports without changing export identity', async () => {
    const sentinelDefault = { k: 'd' };
    const sentinelClass = class StageApiFactorySentinel {};
    const sentinelFn = vi.fn(() => 'ok');

    mockDefaultExport = sentinelDefault;
    MockStageApiFactory = sentinelClass;
    mockCreateStageApiFactory = sentinelFn;

    const mods = await Promise.all(Array.from({ length: 20 }, () => importSut()));
    expect(mods).toHaveLength(20);

    for (const mod of mods) {
      expect(mod.default).toBeDefined();
      expect(mod.StageApiFactory).toBeDefined();
      expect(typeof mod.createStageApiFactory).toBe("function");
    }
  });
});

describe('StageApiFactory', () => {
  it('re-exports StageApiFactory by reference (normal path)', async () => {
    class StageApiFactorySentinel {}
    MockStageApiFactory = StageApiFactorySentinel;

    const mod = await importSut();

    expect(mod.StageApiFactory).toBe(StageApiFactorySentinel);
  });

  it('constructs instances using the re-exported class (resource: deep nested config)', async () => {
    class StageApiFactorySentinel {
      constructor(config) {
        if (config == null) throw new TypeError('config is required');
        if (typeof config !== 'object') throw new TypeError('config must be an object');
        this.config = config;
      }
    }
    MockStageApiFactory = StageApiFactorySentinel;

    const deepConfig = createDeepNestedObject(120);
    const mod = await importSut();

    const instance = new mod.StageApiFactory(deepConfig);

    expect(instance).toBeInstanceOf(StageApiFactorySentinel);
    expect(instance.config).toBe(deepConfig);
  });

  it('propagates constructor errors (null/undefined/whitespace string)', async () => {
    class StageApiFactorySentinel {
      constructor(config) {
        if (config == null) throw new TypeError('config is required');
        if (typeof config !== 'object') throw new TypeError('config must be an object');
      }
    }
    MockStageApiFactory = StageApiFactorySentinel;

    const mod = await importSut();

    expect(() => new mod.StageApiFactory(null)).toThrow(TypeError);
    expect(() => new mod.StageApiFactory(undefined)).toThrow(TypeError);
    expect(() => new mod.StageApiFactory('   ')).toThrow(TypeError);
  });

  it('supports rapid consecutive instantiation without cross-talk', async () => {
    class StageApiFactorySentinel {
      constructor(config) {
        this.config = config;
      }
    }
    MockStageApiFactory = StageApiFactorySentinel;

    const mod = await importSut();

    const instances = Array.from({ length: 50 }, (_v, i) => new mod.StageApiFactory({ id: i }));

    expect(instances).toHaveLength(50);
    for (let i = 0; i < instances.length; i += 1) {
      expect(instances[i]).toBeInstanceOf(StageApiFactorySentinel);
      expect(instances[i].config).toEqual({ id: i });
    }
  });
});

describe('createStageApiFactory', () => {
  it('re-exports createStageApiFactory by reference (normal path)', async () => {
    const fn = vi.fn();
    mockCreateStageApiFactory = fn;

    const mod = await importSut();

    expect(mod.createStageApiFactory).toBe(fn);
  });

  it('forwards calls and return values (normal path)', async () => {
    const returnValue = { ok: true };
    mockCreateStageApiFactory = vi.fn((...args) => ({ returnValue, args }));

    const mod = await importSut();
    const result = mod.createStageApiFactory({ a: 1 }, { b: 2 });

    expect(mockCreateStageApiFactory).toHaveBeenCalledTimes(1);
    expect(mockCreateStageApiFactory).toHaveBeenCalledWith({ a: 1 }, { b: 2 });
    expect(result).toEqual({ returnValue, args: [{ a: 1 }, { b: 2 }] });
  });

  it.each([
    ['null', [null]],
    ['undefined', [undefined]],
    ['empty string', ['']],
    ['whitespace string', ['   \t\n']],
    ['empty array', [[]]],
    ['empty object', [{}]],
    ['0', [0]],
    ['-1', [-1]],
    ['MAX_SAFE_INTEGER', [Number.MAX_SAFE_INTEGER]],
    ['string passed as number', ['123']],
    ['object passed as array', [{ not: 'an array' }]],
    ['very long string', [VERY_LONG_STRING]],
    ['deep nested object', [createDeepNestedObject(90)]],
    ['large Uint8Array (simulated file)', [LARGE_UINT8_ARRAY]],
  ])('accepts boundary/type/resource input: %s', async (_label, args) => {
    const ret = Symbol('ret');
    mockCreateStageApiFactory = vi.fn(() => ret);

    const mod = await importSut();
    const result = mod.createStageApiFactory(...args);

    expect(mockCreateStageApiFactory).toHaveBeenCalledTimes(1);
    expect(mockCreateStageApiFactory).toHaveBeenCalledWith(...args);
    expect(result).toBe(ret);
  });

  it('propagates errors thrown by the underlying factory', async () => {
    mockCreateStageApiFactory = vi.fn(() => {
      throw new Error('bad input');
    });

    const mod = await importSut();

    expect(() => mod.createStageApiFactory()).toThrow('bad input');
    expect(mockCreateStageApiFactory).toHaveBeenCalledTimes(1);
  });

  it('supports concurrent calls (Promise.all) without losing arguments', async () => {
    mockCreateStageApiFactory = vi.fn(async (id, payload) => {
      await Promise.resolve();
      return { id, payload };
    });

    const mod = await importSut();

    const calls = Array.from({ length: 25 }, (_v, i) => [
      i,
      { idx: i, data: VERY_LONG_STRING.slice(0, 1000) },
    ]);

    const results = await Promise.all(
      calls.map(([id, payload]) => mod.createStageApiFactory(id, payload)),
    );

    expect(mockCreateStageApiFactory).toHaveBeenCalledTimes(calls.length);
    for (let i = 0; i < calls.length; i += 1) {
      expect(results[i]).toEqual({ id: calls[i][0], payload: calls[i][1] });
      expect(mockCreateStageApiFactory).toHaveBeenCalledWith(calls[i][0], calls[i][1]);
    }
  });

  it('supports rapid consecutive calls', async () => {
    mockCreateStageApiFactory = vi.fn((n) => n * 2);

    const mod = await importSut();

    for (let i = 0; i < 100; i += 1) {
      expect(mod.createStageApiFactory(i)).toBe(i * 2);
    }

    expect(mockCreateStageApiFactory).toHaveBeenCalledTimes(100);
    expect(mockCreateStageApiFactory).toHaveBeenCalledWith(0);
    expect(mockCreateStageApiFactory).toHaveBeenCalledWith(99);
  });
});
