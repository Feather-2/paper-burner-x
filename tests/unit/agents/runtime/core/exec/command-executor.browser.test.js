import { describe, it, expect, vi, beforeEach } from 'vitest';

const IMPORT_PATH =
  '../../../../../../js/agents/runtime/core/exec/command-executor.browser.js';

const UNSUPPORTED_MSG = 'Command execution is not supported in browser environments';

vi.mock('node:child_process', () => ({}));

/** @type {Awaited<ReturnType<typeof importExecutor>>} */
let executor;

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
  executor = await importExecutor();
});

async function importExecutor() {
  return await import(IMPORT_PATH);
}

function expectedExecResult() {
  return {
    success: false,
    exitCode: -1,
    signal: null,
    stdout: '',
    stderr: '',
    duration: 0,
    timedOut: false,
    truncated: false,
    error: UNSUPPORTED_MSG,
  };
}

function createDeepObject(depth) {
  /** @type {Record<string, any>} */
  const root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
}

describe('exec', () => {
  it('returns an unsupported ExecResult for a normal command', async () => {
    const result = await executor.exec('echo', ['hello'], { timeoutMs: 1000 });
    expect(result).toEqual(expectedExecResult());
  });

  it('handles boundary and type-mismatch inputs', async () => {
    /** @type {Array<[any, any, any]>} */
    const cases = [
      [undefined, undefined, undefined], // defaults
      [null, null, null], // nulls
      ['', [], {}], // empties
      ['   ', ['  '], { env: {} }], // whitespace
      [0, 'not-an-array', 'not-an-object'], // type boundary
      [-1, {}, []], // type boundary + negative
      [Number.MAX_SAFE_INTEGER, [0, -1, Number.MAX_SAFE_INTEGER], { timeoutMs: Number.MAX_SAFE_INTEGER }], // numeric edges
      [{ command: 'obj' }, { not: 'array' }, { nested: createDeepObject(5) }], // object-as-string/array
    ];

    for (const [command, args, options] of cases) {
      const result = await executor.exec(command, args, options);
      expect(result).toEqual(expectedExecResult());
    }
  });

  it('does not mutate provided args/options (frozen inputs)', async () => {
    const args = Object.freeze(['--flag', '', '   ']);
    const options = Object.freeze({
      env: Object.freeze({}),
      nested: Object.freeze(createDeepObject(3)),
    });

    const result = await executor.exec('cmd', args, options);
    expect(result).toEqual(expectedExecResult());
  });

  it('supports concurrent and rapid successive calls without shared state', async () => {
    const concurrent = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        executor.exec(`cmd-${i}`, [String(i)], { idx: i }),
      ),
    );

    for (const result of concurrent) expect(result).toEqual(expectedExecResult());
    expect(new Set(concurrent).size).toBe(concurrent.length);

    const r1 = await executor.exec('a');
    const r2 = await executor.exec('b');
    expect(r1).toEqual(expectedExecResult());
    expect(r2).toEqual(expectedExecResult());
    expect(r1).not.toBe(r2);
  });

  it('accepts very large inputs (resource boundaries)', async () => {
    const hugeString = 'x'.repeat(1024 * 1024); // ~1MB
    const hugeArgs = Array.from({ length: 5000 }, (_, i) => `arg-${i}`);
    const deepOptions = { nested: createDeepObject(100) };

    const result = await executor.exec(hugeString, hugeArgs, deepOptions);
    expect(result).toEqual(expectedExecResult());
  });
});

describe('execShell', () => {
  it('returns an unsupported ExecResult for a normal shell command', async () => {
    const result = await executor.execShell('echo hello', { timeoutMs: 1 });
    expect(result).toEqual(expectedExecResult());
  });

  it('handles boundary and type-mismatch inputs', async () => {
    /** @type {Array<[any, any]>} */
    const cases = [
      [undefined, undefined],
      [null, null],
      ['', {}],
      ['   ', { env: {} }],
      [0, 'not-an-object'],
      [Number.MAX_SAFE_INTEGER, { nested: createDeepObject(10) }],
    ];

    for (const [command, options] of cases) {
      const result = await executor.execShell(command, options);
      expect(result).toEqual(expectedExecResult());
    }
  });

  it('does not mutate provided options (frozen inputs)', async () => {
    const options = Object.freeze({ env: Object.freeze({}), nested: Object.freeze(createDeepObject(2)) });
    const result = await executor.execShell('cmd', options);
    expect(result).toEqual(expectedExecResult());
  });

  it('supports concurrent calls without shared state', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => executor.execShell(`cmd ${i}`, { i })),
    );

    for (const result of results) expect(result).toEqual(expectedExecResult());
    expect(new Set(results).size).toBe(results.length);
  });

  it('accepts a very long command string (resource boundary)', async () => {
    const longCommand = 'y'.repeat(512 * 1024); // ~512KB
    const result = await executor.execShell(longCommand, { nested: createDeepObject(50) });
    expect(result).toEqual(expectedExecResult());
  });
});

describe('execSimple', () => {
  it('rejects with the unsupported message for a normal command', async () => {
    await expect(executor.execSimple('echo', ['ok'], { timeoutMs: 1 })).rejects.toMatchObject({
      message: UNSUPPORTED_MSG,
    });
  });

  it('rejects for boundary and type-mismatch inputs', async () => {
    /** @type {Array<[any, any, any]>} */
    const cases = [
      [undefined, undefined, undefined],
      [null, null, null],
      ['', [], {}],
      ['   ', ['  '], { env: {} }],
      [0, 'not-an-array', 'not-an-object'],
      [-1, {}, []],
      [Number.MAX_SAFE_INTEGER, [0, -1, Number.MAX_SAFE_INTEGER], { timeoutMs: Number.MAX_SAFE_INTEGER }],
      [{ command: 'obj' }, { not: 'array' }, { nested: createDeepObject(5) }],
    ];

    for (const [command, args, options] of cases) {
      await expect(executor.execSimple(command, args, options)).rejects.toThrow(UNSUPPORTED_MSG);
    }
  });

  it('rejects concurrently and in rapid successive calls', async () => {
    const settled = await Promise.allSettled(
      Array.from({ length: 30 }, (_, i) => executor.execSimple(`cmd-${i}`)),
    );

    expect(settled.every((r) => r.status === 'rejected')).toBe(true);
    for (const r of settled) {
      expect(r.status).toBe('rejected');
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(Error);
        expect(String(r.reason?.message ?? r.reason)).toContain(UNSUPPORTED_MSG);
      }
    }

    await expect(executor.execSimple('a')).rejects.toThrow(UNSUPPORTED_MSG);
    await expect(executor.execSimple('b')).rejects.toThrow(UNSUPPORTED_MSG);
  });

  it('rejects even with very large inputs (resource boundaries)', async () => {
    const hugeString = 'z'.repeat(1024 * 1024); // ~1MB
    const hugeArgs = Array.from({ length: 5000 }, (_, i) => `arg-${i}`);
    const deepOptions = { nested: createDeepObject(100) };

    await expect(executor.execSimple(hugeString, hugeArgs, deepOptions)).rejects.toThrow(UNSUPPORTED_MSG);
  });
});

describe('commandExists', () => {
  it('resolves false for a normal command', async () => {
    await expect(executor.commandExists('bash')).resolves.toBe(false);
  });

  it('resolves false for boundary and type-mismatch inputs', async () => {
    /** @type {any[]} */
    const cases = [
      undefined,
      null,
      '',
      '   ',
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '0',
      { toString: () => 'obj' },
      [],
      {},
    ];

    for (const command of cases) {
      // @ts-ignore - intentional type boundary tests
      await expect(executor.commandExists(command)).resolves.toBe(false);
    }
  });

  it('resolves false concurrently and in rapid successive calls', async () => {
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => executor.commandExists(`cmd-${i}`)),
    );

    expect(results.every((v) => v === false)).toBe(true);

    const r1 = await executor.commandExists('a');
    const r2 = await executor.commandExists('b');
    expect(r1).toBe(false);
    expect(r2).toBe(false);
  });

  it('resolves false for very large command strings (resource boundary)', async () => {
    const hugeString = 'c'.repeat(512 * 1024); // ~512KB
    await expect(executor.commandExists(hugeString)).resolves.toBe(false);
  });
});

describe('default', () => {
  it('exposes the expected API surface and references', () => {
    expect(executor.default).toBeTruthy();
    expect(typeof executor.default).toBe('object');

    expect(executor.default.exec).toBe(executor.exec);
    expect(executor.default.execShell).toBe(executor.execShell);
    expect(executor.default.execSimple).toBe(executor.execSimple);
    expect(executor.default.commandExists).toBe(executor.commandExists);
  });

  it('behaves identically when called via the default export', async () => {
    await expect(executor.default.exec('cmd')).resolves.toEqual(expectedExecResult());
    await expect(executor.default.execShell('cmd')).resolves.toEqual(expectedExecResult());
    await expect(executor.default.commandExists('cmd')).resolves.toBe(false);
    await expect(executor.default.execSimple('cmd')).rejects.toThrow(UNSUPPORTED_MSG);
  });
});