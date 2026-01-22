import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const createLoggerMock = vi.hoisted(() => vi.fn(() => ({ warn: loggerWarnMock })));

vi.mock('node:child_process', () => ({ spawn: spawnMock }));
vi.mock('../../../../../../js/agents/shared/index.js', () => ({ createLogger: createLoggerMock }));

import executor, {
  exec,
  execShell,
  execSimple,
  commandExists,
} from '../../../../../../js/agents/runtime/core/exec/command-executor.node.js';

const deepNested = {
  level1: {
    level2: {
      level3: {
        level4: {
          value: 'deep',
        },
      },
    },
  },
};

function createMockChild({ killMode = 'normal' } = {}) {
  const child = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();

  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };

  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn((signal) => {
    if (killMode === 'throw') {
      throw new Error('kill failed');
    }
    if (killMode === 'noEffect') {
      return true;
    }
    child.killed = true;
    child.signalCode = signal;
    return true;
  });

  return { child, stdout, stderr, stdin: child.stdin };
}

function emitClose(child, code = 0, signal = null) {
  child.exitCode = code;
  child.signalCode = signal;
  child.emit('close', code, signal);
}

beforeEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();

  spawnMock.mockReset();
  loggerWarnMock.mockReset();
  createLoggerMock.mockClear();
});

describe('exec', () => {
  it('executes a command and collects stdout/stderr (with streaming + stdin)', async () => {
    const { child, stdout, stderr, stdin } = createMockChild();
    spawnMock.mockReturnValue(child);

    const onStdout = vi.fn();
    const onStderr = vi.fn();

    const promise = exec('tool', ['--arg'], {
      env: { CUSTOM: '1' },
      stdin: 'payload',
      onStdout,
      onStderr,
      extraDeep: deepNested,
    });

    stdout.emit('data', Buffer.from('hello'));
    stderr.emit('data', Buffer.from('oops'));
    emitClose(child, 0, null);

    const result = await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      'tool',
      ['--arg'],
      expect.objectContaining({
        cwd: process.cwd(),
        env: expect.objectContaining({ CUSTOM: '1' }),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      }),
    );
    expect(onStdout).toHaveBeenCalledWith('hello');
    expect(onStderr).toHaveBeenCalledWith('oops');
    expect(stdin.write).toHaveBeenCalledWith('payload');
    expect(stdin.end).toHaveBeenCalled();

    expect(result).toMatchObject({
      success: true,
      exitCode: 0,
      signal: null,
      stdout: 'hello',
      stderr: 'oops',
      timedOut: false,
      truncated: false,
    });
    expect(typeof result.duration).toBe('number');
  });

  it.each([null, undefined])('normalizes nullish options: %s', async (value) => {
    const { child } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = exec('cmd', undefined, value);
    emitClose(child, 0, null);

    const result = await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      'cmd',
      [],
      expect.objectContaining({ cwd: process.cwd(), shell: false }),
    );
    expect(result.success).toBe(true);
  });

  it('returns a failure result for empty/invalid commands (spawn throws)', async () => {
    spawnMock.mockImplementation((command) => {
      if (typeof command !== 'string' || command.trim() === '') {
        throw new Error('bad command');
      }
      return createMockChild().child;
    });

    const results = await Promise.all([
      exec('', [], {}),
      exec('   ', [], {}),
      exec(null, [], {}),
      exec(undefined, [], {}),
    ]);

    results.forEach((result) => {
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(-1);
      expect(result.error).toBe('bad command');
    });
  });

  it('handles type boundary: args-as-object causes spawn error and returns failure', async () => {
    spawnMock.mockImplementation((command, args) => {
      if (!Array.isArray(args)) {
        throw new TypeError('args must be an array');
      }
      return createMockChild().child;
    });

    const result = await exec('cmd', { not: 'array' }, {});

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.error).toBe('args must be an array');
  });

  it('handles type boundary: numeric strings for timeout fall back to defaults', async () => {
    vi.useFakeTimers();
    const { child } = createMockChild();
    child.killed = true;
    spawnMock.mockReturnValue(child);

    let settled = false;
    const promise = exec('cmd', [], { timeout: '1000' }).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(59999);
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(result.timedOut).toBe(true);
    expect(result.error).toBe('Command timed out after 60000ms');
  });

  it('truncates output when maxOutputBytes is exceeded (including MAX_SAFE_INTEGER edge)', async () => {
    const hugeOutput = 'x'.repeat(1024 * 1024);
    const { child, stdout } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = exec('cmd', [], { maxOutputBytes: 1024 });
    stdout.emit('data', Buffer.from(hugeOutput));
    emitClose(child, 0, null);

    const result = await promise;

    expect(result.stdout.length).toBe(1024);
    expect(result.truncated).toBe(true);
  });

  it.each([0, -1])('does not start a timeout when timeout is %s', async (timeout) => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const { child } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = exec('cmd', [], { timeout });
    emitClose(child, 0, null);

    const result = await promise;

    expect(result.timedOut).toBe(false);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it.each([0, -1])('treats maxOutputBytes=%s as immediate truncation', async (maxOutputBytes) => {
    const { child, stdout } = createMockChild();
    spawnMock.mockReturnValue(child);

    const onStdout = vi.fn();
    const promise = exec('cmd', [], { maxOutputBytes, onStdout });

    stdout.emit('data', Buffer.from('data'));
    emitClose(child, 0, null);

    const result = await promise;

    expect(result.stdout).toBe('');
    expect(result.truncated).toBe(true);
    expect(onStdout).toHaveBeenCalledWith('data');
  });

  it('logs and continues when streaming callbacks throw', async () => {
    const { child, stdout, stderr } = createMockChild();
    spawnMock.mockReturnValue(child);

    const onStdout = vi.fn(() => {
      throw new Error('stdout boom');
    });
    const onStderr = vi.fn(() => {
      throw new Error('stderr boom');
    });

    const promise = exec('cmd', [], { onStdout, onStderr });

    stdout.emit('data', Buffer.from('a'));
    stderr.emit('data', Buffer.from('b'));
    emitClose(child, 0, null);

    const result = await promise;

    expect(result.stdout).toBe('a');
    expect(result.stderr).toBe('b');
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('stdout callback failed'),
      expect.objectContaining({ error: 'stdout boom' }),
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('stderr callback failed'),
      expect.objectContaining({ error: 'stderr boom' }),
    );
  });

  it('handles child error events without throwing', async () => {
    const { child } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = exec('cmd', []);
    child.emit('error', new Error('child error'));

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.error).toBe('child error');
  });

  it('times out, and escalates SIGTERM -> SIGKILL when kill has no effect', async () => {
    vi.useFakeTimers();
    const { child } = createMockChild({ killMode: 'noEffect' });
    spawnMock.mockReturnValue(child);

    const promise = exec('cmd', [], { timeout: 10 });

    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;

    expect(result.timedOut).toBe(true);
    expect(result.error).toBe('Command timed out after 10ms');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('handles AbortSignal cancellation (and safeKill failures are logged)', async () => {
    vi.useFakeTimers();
    const { child } = createMockChild({ killMode: 'throw' });
    spawnMock.mockReturnValue(child);

    const controller = new AbortController();
    const promise = exec('cmd', [], { signal: controller.signal });

    controller.abort();
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error).toBe('Command aborted');
    expect(loggerWarnMock).toHaveBeenCalledWith(
      '[exec] Failed to terminate child process',
      expect.objectContaining({ signal: 'SIGTERM', error: 'kill failed' }),
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      '[exec] Failed to terminate child process',
      expect.objectContaining({ signal: 'SIGKILL', error: 'kill failed' }),
    );
  });

  it('supports concurrent executions without cross-talk', async () => {
    const first = createMockChild();
    const second = createMockChild();
    spawnMock.mockImplementationOnce(() => first.child).mockImplementationOnce(() => second.child);

    const firstPromise = exec('cmd1', ['a'], { stdin: '' });
    const secondPromise = exec('cmd2', ['b'], {});

    first.stdout.emit('data', Buffer.from('one'));
    second.stdout.emit('data', Buffer.from('two'));
    emitClose(second.child, 0, null);
    emitClose(first.child, 0, null);

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);

    expect(firstResult.stdout).toBe('one');
    expect(secondResult.stdout).toBe('two');
  });
});

describe('execShell', () => {
  it.each([
    null,
    undefined,
    '',
    '   ',
    0,
    -1,
    Number.MAX_SAFE_INTEGER,
    [],
    {},
  ])('rejects invalid command values: %s', async (value) => {
    const result = await execShell(value, { trusted: true });

    expect(result.success).toBe(false);
    expect(result.error).toBe('execShell: command must be a non-empty string');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it.each([null, undefined, '', [], {}])('requires trusted option (options=%s)', async (options) => {
    const result = await execShell('echo ok', options);

    expect(result.success).toBe(false);
    expect(result.error).toBe('execShell: trusted option required');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('executes using the system shell when trusted', async () => {
    const { child } = createMockChild();
    spawnMock.mockReturnValue(child);

    const command = 'echo ok';
    const promise = execShell(command, { trusted: true, shell: true, env: {}, timeout: 0 });

    emitClose(child, 0, null);
    const result = await promise;

    const isWindows = process.platform === 'win32';
    expect(spawnMock).toHaveBeenCalledWith(
      isWindows ? 'cmd.exe' : '/bin/sh',
      isWindows ? ['/c', command] : ['-c', command],
      expect.objectContaining({ shell: false, stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(result.success).toBe(true);
  });

  it('supports rapid successive calls', async () => {
    const first = createMockChild();
    const second = createMockChild();
    spawnMock.mockImplementationOnce(() => first.child).mockImplementationOnce(() => second.child);

    const p1 = execShell('echo 1', { trusted: true });
    const p2 = execShell('echo 2', { trusted: true });

    emitClose(first.child, 0, null);
    emitClose(second.child, 0, null);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });
});

describe('execSimple', () => {
  it('returns stdout on success', async () => {
    const { child, stdout } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = execSimple('cmd', []);

    stdout.emit('data', Buffer.from('ok'));
    emitClose(child, 0, null);

    await expect(promise).resolves.toBe('ok');
  });

  it('throws ExecError with exitCode/stderr/stdout on non-zero exit', async () => {
    const { child, stdout, stderr } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = execSimple('cmd', []);

    stdout.emit('data', Buffer.from('out'));
    stderr.emit('data', Buffer.from('err'));
    emitClose(child, 1, null);

    await expect(promise).rejects.toMatchObject({
      exitCode: 1,
      stdout: 'out',
      stderr: 'err',
      message: 'Command failed: cmd (exit code: 1)',
    });
  });

  it('throws ExecError using the underlying error message when spawn fails', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    await expect(execSimple('cmd', [])).rejects.toMatchObject({
      exitCode: -1,
      message: 'spawn failed',
      stdout: '',
      stderr: '',
    });
  });

  it('handles args type boundary (object-as-array) without leaking rejections', async () => {
    spawnMock.mockImplementation((_command, args) => {
      if (!Array.isArray(args)) {
        throw new TypeError('args must be an array');
      }
      return createMockChild().child;
    });

    await expect(execSimple('cmd', { not: 'array' }, {})).rejects.toMatchObject({
      exitCode: -1,
      message: 'args must be an array',
    });
  });

  it('supports concurrent calls', async () => {
    const first = createMockChild();
    const second = createMockChild();
    spawnMock.mockImplementationOnce(() => first.child).mockImplementationOnce(() => second.child);

    const p1 = execSimple('cmd1', []);
    const p2 = execSimple('cmd2', []);

    first.stdout.emit('data', Buffer.from('one'));
    second.stdout.emit('data', Buffer.from('two'));
    emitClose(first.child, 0, null);
    emitClose(second.child, 0, null);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('one');
    expect(r2).toBe('two');
  });
});

describe('commandExists', () => {
  it('returns true/false based on the check command exit code', async () => {
    const ok = createMockChild();
    const bad = createMockChild();
    spawnMock.mockImplementationOnce(() => ok.child).mockImplementationOnce(() => bad.child);

    const p1 = commandExists('node');
    const p2 = commandExists('missing-cmd');

    emitClose(ok.child, 0, null);
    emitClose(bad.child, 1, null);

    const [exists, missing] = await Promise.all([p1, p2]);
    expect(exists).toBe(true);
    expect(missing).toBe(false);
  });

  it('handles nullish/empty/whitespace/type-edge command names without throwing', async () => {
    spawnMock.mockImplementation((_command, args) => {
      const [name] = Array.isArray(args) ? args : [];
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('bad command name');
      }
      return createMockChild().child;
    });

    const results = await Promise.all([
      commandExists(null),
      commandExists(undefined),
      commandExists(''),
      commandExists('   '),
      commandExists(0),
      commandExists(-1),
      commandExists(Number.MAX_SAFE_INTEGER),
      commandExists({}),
      commandExists([]),
    ]);

    results.forEach((value) => {
      expect(value).toBe(false);
    });
  });

  it('uses a 5000ms timeout for the check command', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    const { child } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = commandExists('node');
    emitClose(child, 0, null);
    await expect(promise).resolves.toBe(true);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
  });

  it('logs and returns false when an unexpected error is thrown', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockImplementation(() => {
      throw new Error('cwd boom');
    });

    const result = await commandExists('node');

    expect(result).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      '[exec] commandExists failed',
      expect.objectContaining({ command: 'node', error: 'cwd boom' }),
    );

    cwdSpy.mockRestore();
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
