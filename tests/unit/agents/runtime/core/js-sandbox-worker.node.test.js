import { describe, it, expect, vi, beforeEach } from 'vitest';

const SUBJECT_PATH =
  '../../../../../js/agents/runtime/core/js-sandbox-worker.node.js';

let mockParentPort;
let mockWorkerData;

vi.mock('node:worker_threads', () => ({
  parentPort: mockParentPort,
  workerData: mockWorkerData,
  isMainThread: false,
}));

function makeParentPort() {
  const listeners = Object.create(null);

  /** @type {any} */
  const port = {
    postMessage: vi.fn(),
    on: vi.fn((event, handler) => {
      listeners[event] = handler;
      return port;
    }),
    once: vi.fn((event, handler) => {
      listeners[event] = handler;
      return port;
    }),
    addListener: vi.fn((event, handler) => {
      listeners[event] = handler;
      return port;
    }),
    removeListener: vi.fn((event) => {
      delete listeners[event];
      return port;
    }),
    off: vi.fn((event) => {
      delete listeners[event];
      return port;
    }),
  };

  return { port, listeners };
}

/**
 * Import subject with a fresh module cache and fresh worker_threads mocks.
 * @param {{ workerData?: any, parentPort?: any }} [opts]
 */
async function importFresh(opts = {}) {
  const { workerData = {}, parentPort } = opts;

  vi.resetModules();

  const { port: defaultPort, listeners } = makeParentPort();
  mockParentPort = parentPort ?? defaultPort;
  mockWorkerData = workerData;

  const mod = await import(SUBJECT_PATH);
  return { mod, parentPort: mockParentPort, listeners };
}

/**
 * Find an exported function by name across common export patterns.
 * @param {any} mod
 * @param {string} exportName
 * @returns {Function|undefined}
 */
function getFn(mod, exportName) {
  if (typeof mod?.[exportName] === 'function') return mod[exportName];
  if (mod?.default && typeof mod.default?.[exportName] === 'function')
    return mod.default[exportName];

  // Common patterns for exposing internals for tests.
  for (const containerKey of [
    '__test__',
    '__tests__',
    '__private__',
    '_test',
    '_private',
    'internals',
  ]) {
    const container = mod?.[containerKey] ?? mod?.default?.[containerKey];
    if (container && typeof container?.[exportName] === 'function')
      return container[exportName];
  }

  // Fallback: search nested exports for a function with matching .name.
  const seen = new Set();
  const stack = [mod, mod?.default];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;

    if (typeof cur === 'function') {
      if (cur.name === exportName) return cur;
      continue;
    }

    if (typeof cur !== 'object') continue;
    if (seen.has(cur)) continue;
    seen.add(cur);

    for (const v of Object.values(cur)) stack.push(v);
  }

  return undefined;
}

function makeDeepObject(depth) {
  const root = { level: 0 };
  let cur = root;
  for (let i = 1; i <= depth; i += 1) {
    cur.next = { level: i };
    cur = cur.next;
  }
  return root;
}

async function flushMicrotasks(turns = 3) {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockParentPort = undefined;
  mockWorkerData = undefined;
});

describe('validateSandboxCode', () => {
  it('returns { valid: true } for safe code and various boundary inputs', async () => {
    const { mod } = await importFresh();
    const validateSandboxCode = getFn(mod, 'validateSandboxCode');
    expect(typeof validateSandboxCode).toBe('function');

    const longSafe = 'a'.repeat(200_000);

    const inputs = [
      '',
      '   \n\t',
      '1 + 1',
      'const x = 1; x;',
      longSafe,

      // Null-ish
      null,
      undefined,

      // Empty structures
      [],
      {},

      // Boundary numbers + "string as number"
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '0',
      ' -1 ',
      String(Number.MAX_SAFE_INTEGER),
    ];

    const results = await Promise.all(
      inputs.map((code) => Promise.resolve(validateSandboxCode(code)))
    );

    for (const res of results) {
      expect(res).toMatchObject({ valid: true });
      expect(res.reason).toBeUndefined();
    }
  });

  it('blocks known dangerous patterns and reports which pattern matched', async () => {
    const { mod } = await importFresh();
    const validateSandboxCode = getFn(mod, 'validateSandboxCode');
    expect(typeof validateSandboxCode).toBe('function');

    const cases = [
      { code: 'import("fs")', expectSource: String.raw`\bimport\s*\(` },
      {
        code: 'constructor.constructor("return 1")()',
        expectSource: String.raw`\bconstructor\s*\.\s*constructor\b`,
      },
      { code: 'require("fs")', expectSource: String.raw`\brequire\s*\(` },
      { code: 'process.exit(0)', expectSource: String.raw`\bprocess\b` },
    ];

    for (const { code, expectSource } of cases) {
      const res = validateSandboxCode(code);
      expect(res).toMatchObject({ valid: false });
      expect(res.reason).toContain(expectSource);
    }
  });

  it('returns the first matching blocked pattern when multiple patterns are present', async () => {
    const { mod } = await importFresh();
    const validateSandboxCode = getFn(mod, 'validateSandboxCode');
    expect(typeof validateSandboxCode).toBe('function');

    const res = validateSandboxCode('process; require("fs")');
    expect(res).toMatchObject({ valid: false });
    // require() is checked before process
    expect(res.reason).toContain(String.raw`\brequire\s*\(`);
  });

  it('detects blocked patterns near the end of a very long string (resource boundary)', async () => {
    const { mod } = await importFresh();
    const validateSandboxCode = getFn(mod, 'validateSandboxCode');
    expect(typeof validateSandboxCode).toBe('function');

    const code = `${'x'.repeat(150_000)} require("fs")`;
    const res = validateSandboxCode(code);
    expect(res).toMatchObject({ valid: false });
    expect(res.reason).toContain(String.raw`\brequire\s*\(`);
  });

  it('is safe to call many times concurrently (concurrency boundary)', async () => {
    const { mod } = await importFresh();
    const validateSandboxCode = getFn(mod, 'validateSandboxCode');
    expect(typeof validateSandboxCode).toBe('function');

    const inputs = Array.from({ length: 50 }, (_, i) =>
      i % 7 === 0 ? 'process' : `const n = ${i}; n;`
    );

    const results = await Promise.all(
      inputs.map((code) => Promise.resolve(validateSandboxCode(code)))
    );

    for (let i = 0; i < results.length; i += 1) {
      if (i % 7 === 0) {
        expect(results[i]).toMatchObject({ valid: false });
      } else {
        expect(results[i]).toMatchObject({ valid: true });
      }
    }
  });
});

describe('createSandboxProxy', () => {
  it('creates a proxy that always claims properties exist (with-scope isolation)', async () => {
    const { mod } = await importFresh();
    const createSandboxProxy = getFn(mod, 'createSandboxProxy');
    expect(typeof createSandboxProxy).toBe('function');

    const audit = { blockedAccesses: new Set() };
    const base = { fromBase: 'ok' };
    const proxy = createSandboxProxy(base, audit);

    expect('anything' in proxy).toBe(true);
    expect('fromBase' in proxy).toBe(true);
    expect(proxy.fromBase).toBe('ok');

    // `in` should not trigger an audit entry by itself.
    expect(audit.blockedAccesses.size).toBe(0);
  });

  it('resolves globalThis/self/global to the proxy itself', async () => {
    const { mod } = await importFresh();
    const createSandboxProxy = getFn(mod, 'createSandboxProxy');
    expect(typeof createSandboxProxy).toBe('function');

    const audit = { blockedAccesses: new Set() };
    const proxy = createSandboxProxy({}, audit);

    expect(proxy.globalThis).toBe(proxy);
    expect(proxy.self).toBe(proxy);
    expect(proxy.global).toBe(proxy);
  });

  it('blocks reads/writes/defineProperty for blocked globals and records attempts', async () => {
    const { mod } = await importFresh();
    const createSandboxProxy = getFn(mod, 'createSandboxProxy');
    expect(typeof createSandboxProxy).toBe('function');

    const audit = { blockedAccesses: new Set() };
    const proxy = createSandboxProxy({ allowed: 1 }, audit);

    expect(proxy.allowed).toBe(1);

    expect(proxy.process).toBeUndefined();
    expect(proxy.require).toBeUndefined();
    expect(proxy.eval).toBeUndefined();
    expect(proxy.constructor).toBeUndefined();

    expect(audit.blockedAccesses.has('process')).toBe(true);
    expect(audit.blockedAccesses.has('require')).toBe(true);
    expect(audit.blockedAccesses.has('eval')).toBe(true);
    expect(audit.blockedAccesses.has('constructor')).toBe(true);

    proxy.process = 123;
    expect(proxy.process).toBeUndefined();

    expect(Reflect.defineProperty(proxy, 'process', { value: 1 })).toBe(false);
    expect(audit.blockedAccesses.has('process')).toBe(true);
  });

  it('isolates sandbox writes from the base object and prefers sandbox values', async () => {
    const { mod } = await importFresh();
    const createSandboxProxy = getFn(mod, 'createSandboxProxy');
    expect(typeof createSandboxProxy).toBe('function');

    const audit = { blockedAccesses: new Set() };
    const base = { shared: 'base', num: 0 };
    const proxy = createSandboxProxy(base, audit);

    expect(proxy.shared).toBe('base');

    proxy.shared = 'sandbox';
    proxy.num = Number.MAX_SAFE_INTEGER;

    expect(proxy.shared).toBe('sandbox');
    expect(proxy.num).toBe(Number.MAX_SAFE_INTEGER);

    expect(base.shared).toBe('base');
    expect(base.num).toBe(0);

    expect(
      Reflect.defineProperty(proxy, 'defined', { value: 42, enumerable: true })
    ).toBe(true);
    expect(proxy.defined).toBe(42);
  });

  it('hardens prototype-related operations', async () => {
    const { mod } = await importFresh();
    const createSandboxProxy = getFn(mod, 'createSandboxProxy');
    expect(typeof createSandboxProxy).toBe('function');

    const audit = { blockedAccesses: new Set() };
    const proxy = createSandboxProxy({}, audit);

    expect(Object.getPrototypeOf(proxy)).toBe(null);
    expect(Reflect.setPrototypeOf(proxy, {})).toBe(false);

    // __proto__ is treated as a blocked global name; should not mutate the proxy prototype.
    expect(Reflect.set(proxy, '__proto__', { hacked: true })).toBe(true);
    expect(Object.getPrototypeOf(proxy)).toBe(null);
    expect(audit.blockedAccesses.has('__proto__')).toBe(true);
  });

  it('handles non-string property keys safely (type boundary)', async () => {
    const { mod } = await importFresh();
    const createSandboxProxy = getFn(mod, 'createSandboxProxy');
    expect(typeof createSandboxProxy).toBe('function');

    const audit = { blockedAccesses: new Set() };
    const proxy = createSandboxProxy({}, audit);

    expect(proxy[Symbol.unscopables]).toBeUndefined();
    expect(proxy[Symbol.iterator]).toBeUndefined();
    expect(Reflect.set(proxy, Symbol.toStringTag, 'x')).toBe(false);
  });

  it('throws on invalid base when a missing property triggers base lookup (type boundary + error path)', async () => {
    const { mod } = await importFresh();
    const createSandboxProxy = getFn(mod, 'createSandboxProxy');
    expect(typeof createSandboxProxy).toBe('function');

    const audit = { blockedAccesses: new Set() };
    const proxy = createSandboxProxy(/** @type {any} */ (null), audit);

    expect(() => proxy.missing).toThrow();
  });

  it('is safe to create and use multiple proxies concurrently (concurrency boundary)', async () => {
    const { mod } = await importFresh();
    const createSandboxProxy = getFn(mod, 'createSandboxProxy');
    expect(typeof createSandboxProxy).toBe('function');

    const audits = Array.from({ length: 25 }, () => ({
      blockedAccesses: new Set(),
    }));
    const bases = audits.map((_, i) => ({ idx: i }));
    const proxies = bases.map((base, i) => createSandboxProxy(base, audits[i]));

    await Promise.all(
      proxies.map((p, i) =>
        Promise.resolve().then(() => {
          p.answer = i;
          // Trigger a blocked read to populate per-proxy audit.
          void p.process;
        })
      )
    );

    for (let i = 0; i < proxies.length; i += 1) {
      expect(proxies[i].idx).toBe(i);
      expect(proxies[i].answer).toBe(i);
      expect(audits[i].blockedAccesses.has('process')).toBe(true);
    }
  });
});

describe('createRestrictedGlobals', () => {
  it('exposes allowed built-ins, injects a frozen state, and does not expose blocked Node globals', async () => {
    const { mod } = await importFresh();
    const createRestrictedGlobals = getFn(mod, 'createRestrictedGlobals');
    expect(typeof createRestrictedGlobals).toBe('function');

    const audit = { blockedAccesses: new Set() };
    const state = { n: 0, deep: makeDeepObject(50) };

    const globals = {
      answer: 0,
      neg: -1,
      big: Number.MAX_SAFE_INTEGER,
      numAsString: '123',
      arr: [],
      deepObj: makeDeepObject(10),
    };

    const restricted = createRestrictedGlobals(state, globals, audit);

    // Null prototype either directly (Object.create(null)) or via proxy getPrototypeOf trap.
    expect(Object.getPrototypeOf(restricted)).toBe(null);

    expect(restricted.Array).toBe(Array);
    expect(restricted.Promise).toBe(Promise);
    expect(restricted.Math).toBe(Math);
    expect(restricted.JSON).toBe(JSON);
    expect(restricted.console).toBe(console);

    expect(restricted.process).toBeUndefined();
    expect(restricted.Buffer).toBeUndefined();
    expect(restricted.require).toBeUndefined();
    expect(restricted.parentPort).toBeUndefined();
    expect(restricted.workerData).toBeUndefined();

    expect(restricted.state).toEqual(state);
    expect(Object.isFrozen(restricted.state)).toBe(true);
    expect(() => {
      restricted.state.n = 1;
    }).toThrow(TypeError);

    // Host "globals" injection: support either flattened keys or nested under `.globals`.
    expect([restricted.answer, restricted.globals?.answer]).toContain(0);
    expect([restricted.neg, restricted.globals?.neg]).toContain(-1);
    expect([restricted.big, restricted.globals?.big]).toContain(
      Number.MAX_SAFE_INTEGER
    );
    expect([restricted.numAsString, restricted.globals?.numAsString]).toContain(
      '123'
    );
  });

  it('emit() posts to parentPort and swallows postMessage errors (error handling)', async () => {
    const { mod, parentPort } = await importFresh();
    const createRestrictedGlobals = getFn(mod, 'createRestrictedGlobals');
    expect(typeof createRestrictedGlobals).toBe('function');

    const restricted = createRestrictedGlobals({}, {}, { blockedAccesses: new Set() });
    expect(typeof restricted.emit).toBe('function');

    parentPort.postMessage.mockClear();

    restricted.emit('evt', { ok: true });
    await flushMicrotasks();

    expect(parentPort.postMessage).toHaveBeenCalledTimes(1);
    const msg = parentPort.postMessage.mock.calls[0][0];

    expect(msg).toEqual(expect.anything());
    expect(() => JSON.stringify(msg)).not.toThrow();
    expect(JSON.stringify(msg)).toContain('evt');

    parentPort.postMessage.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => restricted.emit('evt2', { ok: true })).not.toThrow();
  });

  it('handles null/undefined/empty and wrong-typed state/globals without throwing (boundaries + type)', async () => {
    const { mod } = await importFresh();
    const createRestrictedGlobals = getFn(mod, 'createRestrictedGlobals');
    expect(typeof createRestrictedGlobals).toBe('function');

    const cases = [
      { state: null, globals: null },
      { state: undefined, globals: undefined },
      { state: '', globals: '' },
      { state: '   ', globals: '   ' },
      { state: 0, globals: 0 },
      { state: -1, globals: -1 },
      { state: [], globals: [] },
      { state: {}, globals: {} },
    ];

    for (const { state, globals } of cases) {
      const restricted = createRestrictedGlobals(state, globals, {
        blockedAccesses: new Set(),
      });

      expect(restricted).toBeTruthy();
      expect(Object.isFrozen(restricted.state)).toBe(true);
      expect(typeof restricted.emit).toBe('function');
    }
  });

  it('can be created many times concurrently without cross-talk (concurrency boundary)', async () => {
    const { mod } = await importFresh();
    const createRestrictedGlobals = getFn(mod, 'createRestrictedGlobals');
    expect(typeof createRestrictedGlobals).toBe('function');

    const states = Array.from({ length: 20 }, (_, i) => ({
      i,
      nested: makeDeepObject(10),
    }));
    const globalsList = Array.from({ length: 20 }, (_, i) => ({
      value: i,
      str: String(i),
      num: i % 2 === 0 ? 0 : -1,
    }));

    const results = await Promise.all(
      states.map((state, i) =>
        Promise.resolve(
          createRestrictedGlobals(state, globalsList[i], {
            blockedAccesses: new Set(),
          })
        )
      )
    );

    for (let i = 0; i < results.length; i += 1) {
      expect(results[i].state).toEqual(states[i]);
      expect(Object.isFrozen(results[i].state)).toBe(true);
      expect([results[i].value, results[i].globals?.value]).toContain(i);
      expect([results[i].str, results[i].globals?.str]).toContain(String(i));
    }
  });

  it('accepts deep nested state and a very long string in globals (resource boundary)', async () => {
    const { mod } = await importFresh();
    const createRestrictedGlobals = getFn(mod, 'createRestrictedGlobals');
    expect(typeof createRestrictedGlobals).toBe('function');

    const deep = makeDeepObject(200);
    const long = 'x'.repeat(100_000);

    const restricted = createRestrictedGlobals(
      { deep },
      { long },
      { blockedAccesses: new Set() }
    );

    expect(restricted.state).toEqual({ deep });
    expect([restricted.long, restricted.globals?.long]).toContain(long);
  });
});