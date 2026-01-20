import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const createLoggerMock = vi.hoisted(() => vi.fn(() => ({ warn: loggerWarnMock })));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock(
  '../../shared/index.js',
  () => ({
    createLogger: createLoggerMock,
  }),
  { virtual: true }
);

import commandExecutor, {
  exec,
  execShell,
  execSimple,
  commandExists,
} from '../../../../../../js/agents/runtime/core/exec/command-executor.node.js';

function createMockChild({ keepAlive = false } = {}) {
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
    if (!keepAlive) {
      child.killed = true;
      child.signalCode = signal;
    }
  });

  return { child, stdout, stderr, stdin: child.stdin };
}

function emitClose(child, code = 0, signal = null) {
  child.exitCode = code;
  child.signalCode = signal;
  child.emit('close', code, signal);
}

beforeEach(() => {
  spawnMock.mockReset();
  loggerWarnMock.mockReset();
  createLoggerMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('exec', () => {
  it('executes command and collects stdout/stderr with streaming callbacks', async () => {
    const { child, stdout, stderr, stdin } = createMockChild();
    spawnMock.mockReturnValue(child);

    const onStdout = vi.fn();
    const onStderr = vi.fn();
    const deepEnv = { NESTED: { level: { depth: 'value' } } };

    const promise = exec('tool', ['--arg'], {
      env: deepEnv,
      stdin: 'payload',
      onStdout,
      onStderr,
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
        env: expect.objectContaining(deepEnv),
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    );
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
    expect(onStdout).toHaveBeenCalledWith('hello');
    expect(onStderr).toHaveBeenCalledWith('oops');
    expect(stdin.write).toHaveBeenCalledWith('payload');
    expect(stdin.end).toHaveBeenCalled();
  });

  it('logs and continues when stdout callback throws', async () => {
    const { child, stdout } = createMockChild();
    spawnMock.mockReturnValue(child);

    const onStdout = vi.fn(() => {
      throw new Error('boom');
    });

    const promise = exec('cmd', [], { onStdout });

    stdout.emit('data', Buffer.from('data'));
    emitClose(child, 0, null);

    const result = await promise;

    expect(result.stdout).toBe('data');
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('stdout callback failed'),
      expect.objectContaining({ error: 'boom' })
    );
  });

  it('accepts non-array args and ends stdin even when empty', async () => {
    const { child, stdin } = createMockChild();
    spawnMock.mockReturnValue(child);

    const args = { not: 'array' };
    const promise = exec('cmd', args, { stdin: '' });

    emitClose(child, 0, null);

    const result = await promise;

    expect(spawnMock).toHaveBeenCalledWith('cmd', args, expect.any(Object));
    expect(stdin.write).not.toHaveBeenCalled();
    expect(stdin.end).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('normalizes null/undefined options to defaults', async () => {
    const { child } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = exec('cmd', undefined, null);

    emitClose(child, 0, null);

    const result = await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      'cmd',
      [],
      expect.objectContaining({ cwd: process.cwd() })
    );
    expect(result.success).toBe(true);
  });

  it('falls back to default timeout/maxOutputBytes when given non-numeric values', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const { child, stdout } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = exec('cmd', [], { timeout: '1000', maxOutputBytes: '5' });

    stdout.emit('data', Buffer.from('0123456789'));
    emitClose(child, 0, null);

    const result = await promise;

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
    expect(result.truncated).toBe(false);
  });

  it('truncates stdout when output exceeds limit and keeps stderr within limit', async () => {
    const { child, stdout, stderr } = createMockChild();
    spawnMock.mockReturnValue(child);

    const onStdout = vi.fn();
    const promise = exec('cmd', [], { maxOutputBytes: 5, onStdout });

    stdout.emit('data', Buffer.from('1234567'));
    stderr.emit('data', Buffer.from('err'));
    emitClose(child, 0, null);

    const result = await promise;

    expect(result.stdout).toBe('12345');
    expect(result.stderr).toBe('err');
    expect(result.truncated).toBe(true);
    expect(onStdout).toHaveBeenCalledWith('1234567');
  });

  it('truncates immediately when maxOutputBytes is 0', async () => {
    const { child, stdout } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = exec('cmd', [], { maxOutputBytes: 0 });

    stdout.emit('data', Buffer.from('data'));
    emitClose(child, 0, null);

    const result = await promise;

    expect(result.stdout).toBe('');
    expect(result.truncated).toBe(true);
  });

  it('handles very large maxOutputBytes without truncation', async () => {
    const { child, stdout } = createMockChild();
    spawnMock.mockReturnValue(child);

    const longOutput = 'x'.repeat(20000);
    const promise = exec('cmd', [], { maxOutputBytes: Number.MAX_SAFE_INTEGER });

    stdout.emit('data', Buffer.from(longOutput));
    emitClose(child, 0, null);

    const result = await promise;

    expect(result.stdout.length).toBe(longOutput.length);
    expect(result.truncated).toBe(false);
  });

  it('does not start timeouts when timeout is 0 or negative', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const first = createMockChild();
    const second = createMockChild();
    spawnMock.mockImplementationOnce(() => first.child).mockImplementationOnce(() => second.child);

    const p1 = exec('cmd', [], { timeout: 0 });
    emitClose(first.child, 0, null);

    const p2 = exec('cmd', [], { timeout: -1 });
    emitClose(second.child, 0, null);

    await Promise.all([p1, p2]);

    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 0);
    expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), -1);
  });

  it('times out and attempts to terminate the child process', async () => {
    vi.useFakeTimers();

    const { child } = createMockChild({ keepAlive: true });
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

  it('handles abort signals and reports an aborted error', async () => {
    const { child } = createMockChild();
    spawnMock.mockReturnValue(child);

    const controller = new AbortController();
    const promise = exec('cmd', [], { signal: controller.signal });

    controller.abort();

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(result.error).toBe('Command aborted');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('returns a failure result when spawn throws synchronously', async () => {
    spawnMock.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    const result = await exec('cmd', []);

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(-1);
    expect(result.error).toBe('spawn failed');
  });

  it('returns a failure result when child emits an error', async () => {
    const { child } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = exec('cmd', []);

    child.emit('error', new Error('child error'));

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toBe('child error');
  });

  it('supports concurrent executions without cross-talk', async () => {
    const first = createMockChild();
    const second = createMockChild();
    spawnMock.mockImplementationOnce(() => first.child).mockImplementationOnce(() => second.child);

    const firstPromise = exec('cmd1', ['a']);
    const secondPromise = exec('cmd2', ['b']);

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
  it.each([null, undefined, '', '   '])('rejects invalid command: %s', async (value) => {
    const result = await execShell(value, { trusted: true });

    expect(result.success).toBe(false);
    expect(result.error).toBe('execShell: command must be a non-empty string');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('requires trusted option to execute shell commands', async () => {
    const result = await execShell('echo ok', { trusted: false });

    expect(result.success).toBe(false);
    expect(result.error).toBe('execShell: trusted option required');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('executes using the system shell when trusted', async () => {
    const { child } = createMockChild();
    spawnMock.mockReturnValue(child);

    const command = 'echo ok';
    const promise = execShell(command, { trusted: true, shell: true, env: {} });

    emitClose(child, 0, null);

    const result = await promise;
    const isWindows = process.platform === 'win32';

    expect(spawnMock).toHaveBeenCalledWith(
      isWindows ? 'cmd.exe' : '/bin/sh',
      isWindows ? ['/c', command] : ['-c', command],
      expect.objectContaining({
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    );
    expect(result.success).toBe(true);
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

  it('throws with exitCode/stderr/stdout when command fails', async () => {
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
});

describe('commandExists', () => {
  it('returns true when the check command succeeds', async () => {
    const { child } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = commandExists('node');

    emitClose(child, 0, null);

    await expect(promise).resolves.toBe(true);
  });

  it('returns false when the check command fails', async () => {
    const { child } = createMockChild();
    spawnMock.mockReturnValue(child);

    const promise = commandExists('missing-cmd');

    emitClose(child, 1, null);

    await expect(promise).resolves.toBe(false);
  });
});

describe('default export', () => {
  it('exposes exec helpers', () => {
    expect(commandExecutor.exec).toBe(exec);
    expect(commandExecutor.execShell).toBe(execShell);
    expect(commandExecutor.execSimple).toBe(execSimple);
    expect(commandExecutor.commandExists).toBe(commandExists);
  });
});
