import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';

const MODULE_SPECIFIER =
  '../../../../../js/agents/core/archive/storage-adapter.js';
const SOURCE_PATH = fileURLToPath(new URL(MODULE_SPECIFIER, import.meta.url));

vi.mock('node:fs/promises', () => {
  return { readFile: vi.fn() };
});

const longString = 'x'.repeat(1_000_000);

const deepNestedObject = (() => {
  let value = {};
  for (let i = 0; i < 250; i++) value = { nested: value };
  return value;
})();

const hugeArray = Array.from({ length: 50_000 }, (_, i) => i);

const keyEdgeCases = [
  null,
  undefined,
  '',
  '   ',
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  '123',
  [],
  {},
  longString,
];

const valueEdgeCases = [
  null,
  undefined,
  '',
  '   ',
  0,
  -1,
  Number.MAX_SAFE_INTEGER,
  '123',
  [],
  {},
  deepNestedObject,
  longString,
  hugeArray,
];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function importModule() {
  return await import(MODULE_SPECIFIER);
}

async function readActualSourceText() {
  const { readFile } = await vi.importActual('node:fs/promises');
  return await readFile(SOURCE_PATH, 'utf8');
}

async function readSourceTextViaMock() {
  const { readFile } = await import('node:fs/promises');
  return await readFile(SOURCE_PATH, 'utf8');
}

describe('js/agents/core/archive/storage-adapter.js', () => {
  it('imports successfully and has no runtime exports', async () => {
    const mod = await importModule();
    expect(Object.keys(mod)).toEqual([]);
    expect(Reflect.has(mod, 'default')).toBe(false);
  });

  it('is safe to import concurrently', async () => {
    const mods = await Promise.all(
      Array.from({ length: 25 }, () => importModule()),
    );

    for (const mod of mods) {
      expect(Object.keys(mod)).toEqual([]);
    }
  });

  it('documents StorageAdapter interface in JSDoc', async () => {
    const text = await readActualSourceText();

    expect(text).toContain('@typedef {Object} StorageAdapter');
    expect(text).toMatch(
      /@property\s+\{\s*\(key:\s*string\)\s*=>\s*Promise<any\|null>\s*\}\s+get\b/m,
    );
    expect(text).toMatch(
      /@property\s+\{\s*\(key:\s*string,\s*value:\s*any\)\s*=>\s*Promise<boolean>\s*\}\s+set\b/m,
    );
    expect(text).toMatch(
      /@property\s+\{\s*\(key:\s*string\)\s*=>\s*Promise<boolean>\s*\}\s+delete\b/m,
    );
    expect(text).toMatch(
      /@property\s+\{\s*\(pattern\?:\s*string\)\s*=>\s*Promise<string\[\]>\s*\}\s+keys\b/m,
    );
  });

  it('has no imports and declares an empty export', async () => {
    const text = await readActualSourceText();

    expect(text).not.toMatch(/^\s*import\s/m);
    expect(text).toMatch(/^\s*export\s*\{\s*\}\s*;\s*$/m);
  });

  it('can read source text concurrently (resource/concurrency boundary)', async () => {
    const reads = await Promise.all(
      Array.from({ length: 10 }, () => readActualSourceText()),
    );
    expect(new Set(reads).size).toBe(1);
  });

  it('propagates fs read errors (mocked dependency)', async () => {
    const fsPromises = await import('node:fs/promises');
    fsPromises.readFile.mockRejectedValueOnce(new Error('read failed'));

    await expect(readSourceTextViaMock()).rejects.toThrow('read failed');
  });
});

describe('StorageAdapter#get', () => {
  it('is not a runtime export (undefined)', async () => {
    const mod = await importModule();
    expect(mod.get).toBeUndefined();
  });

  it('throws TypeError for boundary keys', async () => {
    const mod = await importModule();
    const fn = /** @type {any} */ (mod).get;

    for (const key of keyEdgeCases) {
      expect(() => fn(key)).toThrow(TypeError);
    }
  });

  it('throws consistently under concurrent misuse calls', async () => {
    const mod = await importModule();
    const fn = /** @type {any} */ (mod).get;

    const results = await Promise.allSettled(
      keyEdgeCases.map((key) => Promise.resolve().then(() => fn(key))),
    );

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(
      results.every(
        (r) =>
          r.status === 'rejected' &&
          typeof r.reason?.name === 'string' &&
          r.reason.name === 'TypeError',
      ),
    ).toBe(true);
  });
});

describe('StorageAdapter#set', () => {
  it('is not a runtime export (undefined)', async () => {
    const mod = await importModule();
    expect(mod.set).toBeUndefined();
  });

  it('throws TypeError for boundary keys and values', async () => {
    const mod = await importModule();
    const fn = /** @type {any} */ (mod).set;

    const cases = [
      ...keyEdgeCases.map((key) => [key, 'v']),
      ...valueEdgeCases.map((value) => ['k', value]),
      [longString, deepNestedObject],
      ['k', hugeArray],
    ];

    for (const [key, value] of cases) {
      expect(() => fn(key, value)).toThrow(TypeError);
    }
  });

  it('throws consistently under rapid consecutive misuse calls', async () => {
    const mod = await importModule();
    const fn = /** @type {any} */ (mod).set;

    for (let i = 0; i < 50; i++) {
      expect(() => fn('k', i)).toThrow(TypeError);
    }
  });
});

describe('StorageAdapter#delete', () => {
  it('is not a runtime export (undefined)', async () => {
    const mod = await importModule();
    expect(mod.delete).toBeUndefined();
  });

  it('throws TypeError for boundary keys', async () => {
    const mod = await importModule();
    const fn = /** @type {any} */ (mod).delete;

    for (const key of keyEdgeCases) {
      expect(() => fn(key)).toThrow(TypeError);
    }
  });
});

describe('StorageAdapter#keys', () => {
  it('is not a runtime export (undefined)', async () => {
    const mod = await importModule();
    expect(mod.keys).toBeUndefined();
  });

  it('throws TypeError for boundary patterns', async () => {
    const mod = await importModule();
    const fn = /** @type {any} */ (mod).keys;

    const patternEdgeCases = [
      undefined,
      null,
      '',
      '   ',
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '123',
      [],
      {},
      longString,
    ];

    expect(() => fn()).toThrow(TypeError);
    for (const pattern of patternEdgeCases) {
      expect(() => fn(pattern)).toThrow(TypeError);
    }
  });
});