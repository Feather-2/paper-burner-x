import { describe, it, expect, vi, beforeEach } from 'vitest';

const MODULE_PATH = '../../../../../js/agents/runtime/core/js-sandbox-worker.js';

// Use vi.mock() for external dependency simulation (pass-through, keeps behavior intact).
vi.mock('node:worker_threads', async (importOriginal) => {
  const actual = await importOriginal();
  return actual;
});

function getExport(mod, name) {
  if (mod && Object.prototype.hasOwnProperty.call(mod, name)) return mod[name];
  if (mod?.default && Object.prototype.hasOwnProperty.call(mod.default, name)) return mod.default[name];
  return undefined;
}

async function importFresh({ self = undefined } = {}) {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.stubGlobal('self', self);
  return import(MODULE_PATH);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('module initialization hardening', () => {
  it('best-effort undefines high-risk Worker globals when self is present', async () => {
    const self = {
      fetch: vi.fn(),
      XMLHttpRequest: vi.fn(),
      WebSocket: vi.fn(),
      importScripts: vi.fn(),
      postMessage: vi.fn(),
    };

    await importFresh({ self });

    expect(self.fetch).toBeUndefined();
    expect(self.XMLHttpRequest).toBeUndefined();
    expect(self.WebSocket).toBeUndefined();
    expect(self.importScripts).toBeUndefined();
    expect(self.postMessage).toBeUndefined();
  });

  it('does not throw when self is missing/undefined', async () => {
    const mod = await importFresh({ self: undefined });
    expect(mod).toBeTruthy();
  });
});

describe('validateSandboxCode', () => {
  it('returns { valid: true } for benign code', async () => {
    const mod = await importFresh();
    const validateSandboxCode = getExport(mod, 'validateSandboxCode');

    expect(validateSandboxCode).toBeTypeOf('function');
    expect(validateSandboxCode('const x = 1 + 2; x;')).toEqual({ valid: true });
  });

  it('blocks dynamic import() by pattern', async () => {
    const mod = await importFresh();
    const validateSandboxCode = getExport(mod, 'validateSandboxCode');

    const res = validateSandboxCode('import("fs")');
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Blocked pattern:');
    expect(res.reason).toContain('import');
  });

  it('blocks common Function-constructor escape chain by pattern', async () => {
    const mod = await importFresh();
    const validateSandboxCode = getExport(mod, 'validateSandboxCode');

    const res = validateSandboxCode('constructor  .  constructor("return 1")()');
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Blocked pattern:');
    expect(res.reason).toContain('constructor');
  });

  it('does not false-positive on similar words', async () => {
    const mod = await importFresh();
    const validateSandboxCode = getExport(mod, 'validateSandboxCode');

    expect(validateSandboxCode('const imported = 1; const constructorX = 2;')).toEqual({ valid: true });
  });

  it('handles empty and whitespace strings', async () => {
    const mod = await importFresh();
    const validateSandboxCode = getExport(mod, 'validateSandboxCode');

    expect(validateSandboxCode('')).toEqual({ valid: true });
    expect(validateSandboxCode(' \n\t ')).toEqual({ valid: true });
  });

  it('handles null/undefined/array/object/number inputs without throwing (type + empty boundaries)', async () => {
    const mod = await importFresh();
    const validateSandboxCode = getExport(mod, 'validateSandboxCode');

    const inputs = [
      null,
      undefined,
      '',
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '0',
      '   ',
      { a: 1 },
    ];

    for (const input of inputs) {
      expect(() => validateSandboxCode(input)).not.toThrow();
      expect(validateSandboxCode(input).valid).toBe(true);
    }
  });

  it('handles very long code strings (resource boundary)', async () => {
    const mod = await importFresh();
    const validateSandboxCode = getExport(mod, 'validateSandboxCode');

    const long = 'a'.repeat(200_000);
    expect(validateSandboxCode(long)).toEqual({ valid: true });

    const longBlocked = `${'a'.repeat(100_000)}import(${ 'a'.repeat(10) })`;
    const res = validateSandboxCode(longBlocked);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('import');
  });

  it('supports rapid consecutive and concurrent validation calls (concurrency boundary)', async () => {
    const mod = await importFresh();
    const validateSandboxCode = getExport(mod, 'validateSandboxCode');

    const cases = [
      'const ok = 1;',
      'import("x")',
      'constructor.constructor("return 1")',
      '',
      '   ',
    ];

    const consecutive = cases.map((c) => validateSandboxCode(c).valid);
    expect(consecutive).toEqual([true, false, false, true, true]);

    const results = await Promise.all(cases.map((c) => Promise.resolve().then(() => validateSandboxCode(c))));
    expect(results.map((r) => r.valid)).toEqual([true, false, false, true, true]);
  });
});

describe('createSandboxProxy', () => {
  it('provides a sandboxed globalThis/self reference and exposes base bindings', async () => {
    const mod = await importFresh();
    const createSandboxProxy = getExport(mod, 'createSandboxProxy');

    expect(createSandboxProxy).toBeTypeOf('function');

    const audit = { blockedAccesses: new Set() };
    const proxy = createSandboxProxy({ foo: 123, Math }, audit);

    expect(proxy).toBe(proxy.globalThis);
    expect(proxy).toBe(proxy.self);
    expect(proxy.foo).toBe(123);
    expect(proxy.Math).toBe(Math);
  });

  it('prevents fallback to host globals via Proxy has-trap (critical sandbox boundary)', async () => {
    const mod = await importFresh();
    const createSandboxProxy = getExport(mod, 'createSandboxProxy');

    const audit = { blockedAccesses: new Set() };
    const proxy = createSandboxProxy({}, audit);

    expect('anything' in proxy).toBe(true);
    expect(Reflect.has(proxy, 'process')).toBe(true);

    const outerType = new Function('return typeof process;')();
    expect(outerType).toBe('object');

    const sandboxType = new Function('sandbox', 'with (sandbox) { return typeof process; }')(proxy);
    expect(sandboxType).toBe('undefined');
  });

  it('blocks access to high-risk globals and records audit trail', async () => {
    const mod = await importFresh();
    const createSandboxProxy = getExport(mod, 'createSandboxProxy');

    const audit = { blockedAccesses: new Set() };
    const proxy = createSandboxProxy({ process: 'leak', postMessage: 'leak' }, audit);

    expect(proxy.eval).toBeUndefined();
    expect(proxy.Function).toBeUndefined();
    expect(proxy.process).toBeUndefined();
    expect(proxy.postMessage).toBeUndefined();
    expect(proxy.__proto__).toBeUndefined();
    expect(proxy.constructor).toBeUndefined();

    expect(audit.blockedAccesses.has('eval')).toBe(true);
    expect(audit.blockedAccesses.has('Function')).toBe(true);
    expect(audit.blockedAccesses.has('process')).toBe(true);
    expect(audit.blockedAccesses.has('postMessage')).toBe(true);
    expect(audit.blockedAccesses.has('__proto__')).toBe(true);
    expect(audit.blockedAccesses.has('constructor')).toBe(true);

    const sizeAfterFirstReads = audit.blockedAccesses.size;
    void proxy.eval;
    void proxy.eval;
    void proxy.process;
    expect(audit.blockedAccesses.size).toBe(sizeAfterFirstReads);
  });

  it('returns undefined for Symbol.unscopables and non-string properties', async () => {
    const mod = await importFresh();
    const createSandboxProxy = getExport(mod, 'createSandboxProxy');

    const audit = { blockedAccesses: new Set() };
    const proxy = createSandboxProxy({}, audit);

    expect(proxy[Symbol.unscopables]).toBeUndefined();

    const sym = Symbol('x');
    expect(proxy[sym]).toBeUndefined();
    expect(audit.blockedAccesses.size).toBe(0);
  });

  it('supports deep nested values in base (resource boundary)', async () => {
    const mod = await importFresh();
    const createSandboxProxy = getExport(mod, 'createSandboxProxy');

    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    const audit = { blockedAccesses: new Set() };
    const proxy = createSandboxProxy({ deep }, audit);

    expect(proxy.deep.a.b.c.d.e).toBe(1);
  });

  it('isolates parallel proxy instances (concurrency boundary)', async () => {
    const mod = await importFresh();
    const createSandboxProxy = getExport(mod, 'createSandboxProxy');

    const run = new Function('sandbox', 'with (sandbox) { return typeof process; }');

    const audits = Array.from({ length: 50 }, () => ({ blockedAccesses: new Set() }));
    const proxies = audits.map((audit, i) => createSandboxProxy({ id: i }, audit));

    const results = await Promise.all(proxies.map((proxy) => Promise.resolve().then(() => run(proxy))));
    expect(results.every((t) => t === 'undefined')).toBe(true);

    for (const audit of audits) {
      expect(audit.blockedAccesses.has('process')).toBe(true);
    }
  });

  it('handles base argument type boundary (array as base) without leaking host globals', async () => {
    const mod = await importFresh();
    const createSandboxProxy = getExport(mod, 'createSandboxProxy');

    const audit = { blockedAccesses: new Set() };
    const proxy = createSandboxProxy([], audit);

    expect(proxy.process).toBeUndefined();
    expect(audit.blockedAccesses.has('process')).toBe(true);
  });
});