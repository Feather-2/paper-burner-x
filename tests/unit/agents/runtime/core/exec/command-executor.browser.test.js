import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../js/agents/runtime/core/exec/command-executor.node.js', () => ({
  exec: vi.fn(),
  execShell: vi.fn(),
  execSimple: vi.fn(),
  commandExists: vi.fn(),
}));

import executor, {
  exec,
  execShell,
  execSimple,
  commandExists,
} from '../../../../../../js/agents/runtime/core/exec/command-executor.browser.js';

const UNSUPPORTED_MSG = 'Command execution is not supported in browser environments';
const EXPECTED_RESULT = {
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

const expectUnsupportedResult = (result) => {
  expect(result).toEqual(EXPECTED_RESULT);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('exec', () => {
  it('returns the unsupported stub for a normal command', async () => {
    const result = await exec('echo', ['hello'], { timeout: 1000 });

    expectUnsupportedResult(result);
  });

  it('handles edge values and type boundaries without throwing', async () => {
    const cases = [
      { command: null, args: undefined, options: undefined },
      { command: undefined, args: undefined, options: undefined },
      { command: '', args: [], options: {} },
      { command: '   ', args: [], options: {} },
      { command: 0, args: [], options: {} },
      { command: -1, args: [], options: {} },
      { command: Number.MAX_SAFE_INTEGER, args: [], options: {} },
      { command: 'cmd', args: { not: 'array' }, options: {} },
      { command: 'cmd', args: [], options: { timeout: '1000' } },
      { command: 'cmd', args: null, options: null },
    ];

    for (const { command, args, options } of cases) {
      const result = await exec(command, args, options);
      expectUnsupportedResult(result);
    }
  });

  it('handles concurrent and rapid sequential calls', async () => {
    const concurrentResults = await Promise.all([
      exec('cmd-a'),
      exec('cmd-b', ['arg']),
      exec('cmd-c', [], { timeout: 0 }),
    ]);

    concurrentResults.forEach(expectUnsupportedResult);
    expect(concurrentResults[0]).not.toBe(concurrentResults[1]);

    const sequentialResults = [];
    for (let i = 0; i < 5; i += 1) {
      sequentialResults.push(await exec(`cmd-${i}`));
    }

    sequentialResults.forEach(expectUnsupportedResult);
  });

  it('handles resource-heavy inputs', async () => {
    const hugePayload = 'x'.repeat(1024 * 1024);
    const longArg = 'y'.repeat(10000);
    const deepOptions = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                level6: 'value',
              },
            },
          },
        },
      },
    };

    const result = await exec(hugePayload, [longArg, hugePayload], deepOptions);

    expectUnsupportedResult(result);
  });
});

describe('execShell', () => {
  it('returns the unsupported stub for a normal command', async () => {
    const result = await execShell('echo "hi"', { timeout: 500 });

    expectUnsupportedResult(result);
  });

  it('handles edge values and type boundaries without throwing', async () => {
    const results = await Promise.all([
      execShell('', {}),
      execShell('   ', {}),
      execShell(null, { timeout: '0' }),
      execShell(undefined, undefined),
    ]);

    results.forEach(expectUnsupportedResult);
  });

  it('handles concurrent and rapid sequential calls', async () => {
    const concurrentResults = await Promise.all([
      execShell('cmd-a'),
      execShell('cmd-b', { timeout: 0 }),
      execShell('cmd-c', {}),
    ]);

    concurrentResults.forEach(expectUnsupportedResult);

    const sequentialResults = [];
    for (let i = 0; i < 3; i += 1) {
      sequentialResults.push(await execShell(`cmd-${i}`));
    }

    sequentialResults.forEach(expectUnsupportedResult);
  });
});

describe('execSimple', () => {
  it('rejects with the unsupported error for a normal command', async () => {
    await expect(execSimple('echo', ['hello'], { timeout: 1000 })).rejects.toThrow(
      UNSUPPORTED_MSG,
    );
  });

  it('rejects for edge values and type boundaries', async () => {
    const hugePayload = 'x'.repeat(1024 * 1024);
    const deepOptions = {
      level1: {
        level2: {
          level3: {
            level4: {
              level5: {
                level6: 'value',
              },
            },
          },
        },
      },
    };

    const cases = [
      [null, undefined, undefined],
      [undefined, undefined, undefined],
      ['', [], {}],
      ['   ', [], {}],
      [0, [], {}],
      [-1, [], {}],
      [Number.MAX_SAFE_INTEGER, [], {}],
      ['cmd', { not: 'array' }, {}],
      ['cmd', [], { timeout: '500' }],
      ['cmd', null, null],
      [hugePayload, [hugePayload], deepOptions],
    ];

    const results = await Promise.allSettled(
      cases.map(([command, args, options]) => execSimple(command, args, options)),
    );

    results.forEach((result) => {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(Error);
        expect(result.reason.message).toBe(UNSUPPORTED_MSG);
      }
    });
  });

  it('rejects concurrent calls with consistent errors', async () => {
    const results = await Promise.allSettled([
      execSimple('one'),
      execSimple('two', []),
      execSimple('three', [], { timeout: 0 }),
    ]);

    results.forEach((result) => {
      expect(result.status).toBe('rejected');
      if (result.status === 'rejected') {
        expect(result.reason.message).toBe(UNSUPPORTED_MSG);
      }
    });
  });
});

describe('commandExists', () => {
  it('returns false for a normal command', async () => {
    const result = await commandExists('ls');

    expect(result).toBe(false);
  });

  it('returns false for edge values and type boundaries', async () => {
    const cases = [
      null,
      undefined,
      '',
      '   ',
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      {},
      [],
      { cmd: 'ls' },
      '123',
    ];

    const concurrentResults = await Promise.all(cases.map((value) => commandExists(value)));

    concurrentResults.forEach((result) => {
      expect(result).toBe(false);
    });
  });

  it('handles concurrent and rapid sequential calls', async () => {
    const concurrentResults = await Promise.all([
      commandExists('cmd-a'),
      commandExists('cmd-b'),
      commandExists('cmd-c'),
    ]);

    concurrentResults.forEach((result) => {
      expect(result).toBe(false);
    });

    const sequentialResults = [];
    for (let i = 0; i < 4; i += 1) {
      sequentialResults.push(await commandExists(`cmd-${i}`));
    }

    sequentialResults.forEach((result) => {
      expect(result).toBe(false);
    });
  });
});

describe('default', () => {
  it('exposes the named executors on the default export', () => {
    expect(executor).toMatchObject({
      exec,
      execShell,
      execSimple,
      commandExists,
    });

    expect(executor.exec).toBe(exec);
    expect(executor.execShell).toBe(execShell);
    expect(executor.execSimple).toBe(execSimple);
    expect(executor.commandExists).toBe(commandExists);
  });
});
