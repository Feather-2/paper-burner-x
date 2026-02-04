import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

const SUT_SPECIFIER = '../../../../../../js/agents/runtime/core/exec/command-executor.node.js';
const SHARED_SPECIFIER = vi.hoisted(() => '../../../../../../js/agents/runtime/shared/index.js');

const spawnMock = vi.fn();

const loggerWarnMock = vi.fn();
const logger = {
  warn: loggerWarnMock,
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
};
const createLoggerMock = vi.fn(() => logger);

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

vi.mock(SHARED_SPECIFIER, () => ({
  createLogger: createLoggerMock,
}));

function extractExportNames(src) {
  const names = new Set();

  if (/\bexport\s+default\b/.test(src)) names.add('default');

  const declRegexes = [
    /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+class\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/g,
    /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g,
    /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(?[^\n=]*=>/g,
    /\bexport\s+let\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g,
  ];

  for (const re of declRegexes) {
    let m;
    while ((m = re.exec(src))) names.add(m[1]);
  }

  const namedExportRe = /\bexport\s*\{\s*([^}]+)\s*\}\s*(?:from\s*['"][^'"]+['"])?\s*;?/g;
  let match;
  while ((match = namedExportRe.exec(src))) {
    const inside = match[1] || '';
    const parts = inside
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    for (const part of parts) {
      const m = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!m) continue;
      names.add(m[2] || m[1]);
    }
  }

  return Array.from(names).sort();
}

const SUT_SOURCE = readFileSync(new URL(SUT_SPECIFIER, import.meta.url), 'utf8');
const EXPORT_NAMES = extractExportNames(SUT_SOURCE);

async function importSut() {
  return await import(SUT_SPECIFIER);
}

function createMockChildProcess() {
  const child = new EventEmitter();

  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  child.stdout.setEncoding = vi.fn();
  child.stderr.setEncoding = vi.fn();

  child.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };

  child.kill = vi.fn(() => true);

  return child;
}

function emitStdout(child, chunk) {
  child.stdout.emit('data', Buffer.from(chunk));
}

function emitStderr(child, chunk) {
  child.stderr.emit('data', Buffer.from(chunk));
}

function finishChild(child, code = 0, signal = null) {
  if (child.listenerCount('exit') > 0) child.emit('exit', code, signal);
  if (child.listenerCount('close') > 0) child.emit('close', code, signal);
}

function emitChildError(child, err) {
  if (child.listenerCount('error') > 0) child.emit('error', err);
}

async function settle(promise) {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
}

function getSpawnOptionsFromCall(call) {
  if (!Array.isArray(call)) return undefined;
  if (call.length >= 3) return call[2];
  if (call.length === 2) return call[1];
  return undefined;
}

function getSpawnArgsFromCall(call) {
  if (!Array.isArray(call)) return undefined;
  return Array.isArray(call[1]) ? call[1] : undefined;
}

function expectExecResultShape(result) {
  expect(result).toBeTruthy();
  expect(result).toEqual(
    expect.objectContaining({
      success: expect.any(Boolean),
      exitCode: expect.any(Number),
      stdout: expect.any(String),
      stderr: expect.any(String),
      duration: expect.any(Number),
      timedOut: expect.any(Boolean),
      truncated: expect.any(Boolean),
    }),
  );
  expect(Object.prototype.hasOwnProperty.call(result, 'signal')).toBe(true);
  expect(result.signal === null || typeof result.signal === 'string').toBe(true);
  if (Object.prototype.hasOwnProperty.call(result, 'error')) {
    expect(result.error == null || typeof result.error === 'string').toBe(true);
  }
}

function expectWarnCalledContaining(substr) {
  const found = loggerWarnMock.mock.calls.some((call) => String(call[0] || '').includes(substr));
  expect(found).toBe(true);
}

function restoreEnvSnapshot(snapshot) {
  const currentKeys = new Set(Object.keys(process.env));
  for (const k of currentKeys) {
    if (!Object.prototype.hasOwnProperty.call(snapshot, k)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(snapshot)) process.env[k] = v;
}

beforeEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
  spawnMock.mockReset();
});

describe('exports', () => {
  it('has at least one export', () => {
    expect(EXPORT_NAMES.length).toBeGreaterThan(0);
  });
});

describe.each(EXPORT_NAMES)('%s', (exportName) => {
  it('is exported', async () => {
    const mod = await importSut();
    expect(mod).toHaveProperty(exportName);
  });

  if (exportName === 'execCommand') {
    describe('execCommand', () => {
      it('executes a command, collects stdout/stderr, and returns ExecResult (success path)', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/workdir');

        let now = 1000;
        const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

        try {
          const p = mod.execCommand('cmd', ['arg1'], { timeout: 0 });

          expect(spawnMock).toHaveBeenCalledTimes(1);
          const call = spawnMock.mock.calls[0];
          expect(call[0]).toBe('cmd');
          expect(getSpawnArgsFromCall(call)).toEqual(['arg1']);
          expect(getSpawnOptionsFromCall(call)).toEqual(
            expect.objectContaining({
              cwd: '/workdir',
              shell: false,
            }),
          );

          emitStdout(child, 'hello');
          emitStderr(child, 'oops');

          now = 1123;
          finishChild(child, 0, null);

          const outcome = await settle(p);
          expect(outcome.ok).toBe(true);

          const result = outcome.value;
          expectExecResultShape(result);
          expect(result.success).toBe(true);
          expect(result.exitCode).toBe(0);
          expect(result.signal).toBe(null);
          expect(result.stdout).toBe('hello');
          expect(result.stderr).toBe('oops');
          expect(result.duration).toBe(123);
          expect(result.timedOut).toBe(false);
          expect(result.truncated).toBe(false);
        } finally {
          cwdSpy.mockRestore();
          nowSpy.mockRestore();
        }
      });

      it('supports onStdout/onStderr streaming and logs when callbacks throw (safeInvoke)', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const onStdout = vi.fn(() => {
          throw new Error('boom');
        });
        const onStderr = vi.fn();

        const p = mod.execCommand('cmd', [], { timeout: 0, onStdout, onStderr });

        emitStdout(child, 'a');
        emitStderr(child, 'b');
        finishChild(child, 0, null);

        const outcome = await settle(p);
        expect(outcome.ok).toBe(true);

        expect(onStdout).toHaveBeenCalledWith('a');
        expect(onStderr).toHaveBeenCalledWith('b');
        expect(outcome.value.stdout).toBe('a');
        expect(outcome.value.stderr).toBe('b');
        expectWarnCalledContaining('callback failed');
      });

      it('writes stdin (including empty string) and ends stdin', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        // Non-empty stdin
        {
          const child = createMockChildProcess();
          spawnMock.mockReturnValueOnce(child);

          const p = mod.execCommand('cmd', [], { timeout: 0, stdin: 'input\n' });
          finishChild(child, 0, null);

          const outcome = await settle(p);
          expect(outcome.ok).toBe(true);

          expect(child.stdin.write).toHaveBeenCalledTimes(1);
          expect(child.stdin.write).toHaveBeenCalledWith('input\n');
          expect(child.stdin.end).toHaveBeenCalledTimes(1);
        }

        // Empty-string stdin boundary
        {
          const child = createMockChildProcess();
          spawnMock.mockReturnValueOnce(child);

          const p = mod.execCommand('cmd', [], { timeout: 0, stdin: '' });
          finishChild(child, 0, null);

          const outcome = await settle(p);
          expect(outcome.ok).toBe(true);

          const writes = child.stdin.write.mock.calls;
          if (writes.length > 0) expect(writes[0][0]).toBe('');
          expect(child.stdin.end).toHaveBeenCalledTimes(1);
        }
      });

      it('normalizes options: null/undefined/empty object; merges env; cwd empty string uses process.cwd; whitespace cwd passes through', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const envSnapshot = { ...process.env };
        const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/cwd-default');

        try {
          process.env.__TEST_EXISTING = 'EXISTING';

          // null options boundary
          {
            const child = createMockChildProcess();
            spawnMock.mockReturnValueOnce(child);

            const p = mod.execCommand('cmd', [], null);
            finishChild(child, 0, null);

            const outcome = await settle(p);
            expect(outcome.ok).toBe(true);

            const call = spawnMock.mock.calls.at(-1);
            const opts = getSpawnOptionsFromCall(call);
            expect(opts).toEqual(
              expect.objectContaining({
                cwd: '/cwd-default',
              }),
            );
          }

          // undefined options boundary
          {
            const child = createMockChildProcess();
            spawnMock.mockReturnValueOnce(child);

            const p = mod.execCommand('cmd', [], undefined);
            finishChild(child, 0, null);

            const outcome = await settle(p);
            expect(outcome.ok).toBe(true);

            const call = spawnMock.mock.calls.at(-1);
            const opts = getSpawnOptionsFromCall(call);
            expect(opts).toEqual(
              expect.objectContaining({
                cwd: '/cwd-default',
              }),
            );
          }

          // env merge + deep nested value boundary + cwd empty string boundary
          {
            const child = createMockChildProcess();
            spawnMock.mockReturnValueOnce(child);

            const deep = { a: { b: { c: { d: { e: { f: 'g' } } } } } };

            const p = mod.execCommand('cmd', [], {
              timeout: 0,
              cwd: '',
              env: { __TEST_NEW: 'NEW', __TEST_DEEP: deep },
            });

            finishChild(child, 0, null);

            const outcome = await settle(p);
            expect(outcome.ok).toBe(true);

            const call = spawnMock.mock.calls.at(-1);
            const opts = getSpawnOptionsFromCall(call);
            expect(opts.env.__TEST_EXISTING).toBe('EXISTING');
            expect(opts.env.__TEST_NEW).toBe('NEW');
            expect(opts.env.__TEST_DEEP).toBe(deep);
            expect(opts.cwd).toBe('/cwd-default');
          }

          // whitespace cwd boundary (truthy -> passes through)
          {
            const child = createMockChildProcess();
            spawnMock.mockReturnValueOnce(child);

            const p = mod.execCommand('cmd', [], { timeout: 0, cwd: '   ' });
            finishChild(child, 0, null);

            const outcome = await settle(p);
            expect(outcome.ok).toBe(true);

            const call = spawnMock.mock.calls.at(-1);
            const opts = getSpawnOptionsFromCall(call);
            expect(opts.cwd).toBe('   ');
          }

          // empty object env boundary
          {
            const child = createMockChildProcess();
            spawnMock.mockReturnValueOnce(child);

            const p = mod.execCommand('cmd', [], { timeout: 0, env: {} });
            finishChild(child, 0, null);

            const outcome = await settle(p);
            expect(outcome.ok).toBe(true);

            const call = spawnMock.mock.calls.at(-1);
            const opts = getSpawnOptionsFromCall(call);
            expect(opts.env.__TEST_EXISTING).toBe('EXISTING');
          }
        } finally {
          cwdSpy.mockRestore();
          restoreEnvSnapshot(envSnapshot);
        }
      });

      it('validates/handles empty command inputs (null/undefined/empty string/whitespace string)', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const candidates = [null, undefined, '', '   '];

        for (const command of candidates) {
          spawnMock.mockReset();

          const outcome = await settle(mod.execCommand(command, [], { timeout: 0 }));
          if (outcome.ok) {
            expectExecResultShape(outcome.value);
            expect(outcome.value.success).toBe(false);
          } else {
            expect(outcome.error).toBeInstanceOf(Error);
          }
          expect(spawnMock).toHaveBeenCalledTimes(0);
        }
      });

      it('handles args type boundary (object-as-array) by using an array for spawn args', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const p = mod.execCommand('cmd', { not: 'an array' }, { timeout: 0 });

        expect(spawnMock).toHaveBeenCalledTimes(1);
        const call = spawnMock.mock.calls[0];
        const args = getSpawnArgsFromCall(call);
        expect(Array.isArray(args)).toBe(true);

        finishChild(child, 0, null);

        const outcome = await settle(p);
        expect(outcome.ok).toBe(true);
        expectExecResultShape(outcome.value);
      });

      it('truncates stdout when exceeding maxOutputBytes (resource boundary: long output)', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const p = mod.execCommand('cmd', [], { timeout: 0, maxOutputBytes: 5 });

        emitStdout(child, '123456789');
        finishChild(child, 0, null);

        const outcome = await settle(p);
        expect(outcome.ok).toBe(true);

        expect(outcome.value.stdout).toBe('12345');
        expect(outcome.value.truncated).toBe(true);
      });

      it('truncates stderr when exceeding maxOutputBytes', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const p = mod.execCommand('cmd', [], { timeout: 0, maxOutputBytes: 5 });

        emitStderr(child, 'abcdef');
        finishChild(child, 0, null);

        const outcome = await settle(p);
        expect(outcome.ok).toBe(true);

        expect(outcome.value.stderr).toBe('abcde');
        expect(outcome.value.truncated).toBe(true);
      });

      it('handles maxOutputBytes boundary values: 0 and -1', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        for (const maxOutputBytes of [0, -1]) {
          const child = createMockChildProcess();
          spawnMock.mockReturnValueOnce(child);

          const p = mod.execCommand('cmd', [], { timeout: 0, maxOutputBytes });

          emitStdout(child, 'x');
          emitStderr(child, 'y');
          finishChild(child, 0, null);

          const outcome = await settle(p);
          expect(outcome.ok).toBe(true);

          expect(outcome.value.stdout).toBe('');
          expect(outcome.value.stderr).toBe('');
          expect(outcome.value.truncated).toBe(true);
        }
      });

      it('does not treat string maxOutputBytes as a number (type boundary) and avoids accidental truncation', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const big = 'a'.repeat(100);

        const p = mod.execCommand('cmd', [], { timeout: 0, maxOutputBytes: '10' });

        emitStdout(child, big);
        finishChild(child, 0, null);

        const outcome = await settle(p);
        expect(outcome.ok).toBe(true);

        expect(outcome.value.stdout).toBe(big);
        expect(outcome.value.truncated).toBe(false);
      });

      it('returns failure (or throws ExecError) on non-zero exit code', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const p = mod.execCommand('cmd', [], { timeout: 0 });

        emitStdout(child, 'out');
        emitStderr(child, 'err');
        finishChild(child, 2, null);

        const outcome = await settle(p);
        if (outcome.ok) {
          expectExecResultShape(outcome.value);
          expect(outcome.value.success).toBe(false);
          expect(outcome.value.exitCode).toBe(2);
          expect(outcome.value.stdout).toBe('out');
          expect(outcome.value.stderr).toBe('err');
        } else {
          expect(outcome.error).toBeInstanceOf(Error);
          expect(outcome.error.exitCode).toBe(2);
          expect(outcome.error.stdout).toBe('out');
          expect(outcome.error.stderr).toBe('err');
        }
      });

      it('handles child process error event and surfaces error details', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const p = mod.execCommand('cmd', [], { timeout: 0 });

        emitStdout(child, 'partial');
        emitChildError(child, new Error('spawn failed'));
        finishChild(child, 1, null);

        const outcome = await settle(p);
        if (outcome.ok) {
          expectExecResultShape(outcome.value);
          expect(outcome.value.success).toBe(false);
          expect(outcome.value.stdout).toBe('partial');
          expect(outcome.value.error || '').toEqual(expect.stringContaining('spawn failed'));
        } else {
          expect(outcome.error).toBeInstanceOf(Error);
          expect(String(outcome.error.message || '')).toEqual(expect.stringContaining('spawn failed'));
        }
      });

      it('handles spawn() throwing synchronously and surfaces the error', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        spawnMock.mockImplementation(() => {
          throw new Error('spawn crash');
        });

        const outcome = await settle(mod.execCommand('cmd', [], { timeout: 0 }));
        if (outcome.ok) {
          expectExecResultShape(outcome.value);
          expect(outcome.value.success).toBe(false);
          expect(outcome.value.error || '').toEqual(expect.stringContaining('spawn crash'));
        } else {
          expect(outcome.error).toBeInstanceOf(Error);
          expect(String(outcome.error.message || '')).toEqual(expect.stringContaining('spawn crash'));
        }
      });

      it('enforces shell safety: shell:true requires trusted:true (security control)', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const outcome = await settle(mod.execCommand('cmd', [], { timeout: 0, shell: true, trusted: false }));
        if (outcome.ok) {
          expectExecResultShape(outcome.value);
          expect(outcome.value.success).toBe(false);
          expect(outcome.value.error || '').toEqual(expect.stringMatching(/trust|trusted|shell/i));
        } else {
          expect(outcome.error).toBeInstanceOf(Error);
          expect(String(outcome.error.message || '')).toEqual(expect.stringMatching(/trust|trusted|shell/i));
        }
        expect(spawnMock).toHaveBeenCalledTimes(0);
      });

      it('allows shell execution when trusted:true and passes shell:true to spawn', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const p = mod.execCommand('echo hi', [], { timeout: 0, shell: true, trusted: true });

        expect(spawnMock).toHaveBeenCalledTimes(1);
        const call = spawnMock.mock.calls[0];
        const opts = getSpawnOptionsFromCall(call);
        expect(opts.shell).toBe(true);

        finishChild(child, 0, null);

        const outcome = await settle(p);
        expect(outcome.ok).toBe(true);
        expectExecResultShape(outcome.value);
      });

      it('times out when timeout > 0, kills the child, and sets timedOut=true', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        vi.useFakeTimers();

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        let now = 1000;
        const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

        try {
          const p = mod.execCommand('cmd', [], { timeout: 10 });

          expect(spawnMock).toHaveBeenCalledTimes(1);

          now = 1005;
          vi.advanceTimersByTime(9);
          expect(child.kill).not.toHaveBeenCalled();

          now = 1015;
          vi.advanceTimersByTime(1);
          expect(child.kill).toHaveBeenCalled();

          finishChild(child, null, 'SIGKILL');

          const outcome = await settle(p);
          if (outcome.ok) {
            expectExecResultShape(outcome.value);
            expect(outcome.value.success).toBe(false);
            expect(outcome.value.timedOut).toBe(true);
          } else {
            expect(outcome.error).toBeInstanceOf(Error);
          }
        } finally {
          nowSpy.mockRestore();
          vi.useRealTimers();
        }
      });

      it('logs a warning if child.kill throws (safeKill) and still settles the promise', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        vi.useFakeTimers();

        const child = createMockChildProcess();
        child.kill.mockImplementation(() => {
          throw new Error('cannot kill');
        });
        spawnMock.mockReturnValue(child);

        try {
          const p = mod.execCommand('cmd', [], { timeout: 1 });

          vi.advanceTimersByTime(1);
          expect(child.kill).toHaveBeenCalled();

          finishChild(child, null, 'SIGKILL');

          const outcome = await settle(p);
          expect(outcome.ok).toBe(true);
          expectExecResultShape(outcome.value);

          expectWarnCalledContaining('Failed to terminate child process');
        } finally {
          vi.useRealTimers();
        }
      });

      it('handles timeout boundary values: 0 (no timeout), -1 (no timeout), MAX_SAFE_INTEGER (practically no timeout)', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        vi.useFakeTimers();

        try {
          // 0 => no timeout
          {
            const child = createMockChildProcess();
            spawnMock.mockReturnValueOnce(child);

            const p = mod.execCommand('cmd', [], { timeout: 0 });
            vi.advanceTimersByTime(10_000);
            expect(child.kill).not.toHaveBeenCalled();

            finishChild(child, 0, null);

            const outcome = await settle(p);
            expect(outcome.ok).toBe(true);
            expectExecResultShape(outcome.value);
            expect(outcome.value.timedOut).toBe(false);
          }

          // -1 => no timeout
          {
            const child = createMockChildProcess();
            spawnMock.mockReturnValueOnce(child);

            const p = mod.execCommand('cmd', [], { timeout: -1 });
            vi.advanceTimersByTime(10_000);
            expect(child.kill).not.toHaveBeenCalled();

            finishChild(child, 0, null);

            const outcome = await settle(p);
            expect(outcome.ok).toBe(true);
            expectExecResultShape(outcome.value);
            expect(outcome.value.timedOut).toBe(false);
          }

          // MAX_SAFE_INTEGER => timer exists but should not fire in a short advance window
          {
            const child = createMockChildProcess();
            spawnMock.mockReturnValueOnce(child);

            const p = mod.execCommand('cmd', [], { timeout: Number.MAX_SAFE_INTEGER });
            vi.advanceTimersByTime(10_000);
            expect(child.kill).not.toHaveBeenCalled();

            finishChild(child, 0, null);

            const outcome = await settle(p);
            expect(outcome.ok).toBe(true);
            expectExecResultShape(outcome.value);
          }
        } finally {
          vi.useRealTimers();
        }
      });

      it('does not treat string timeout as a number (type boundary) and falls back to default timeout scheduling', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        vi.useFakeTimers();

        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

        try {
          const child = createMockChildProcess();
          spawnMock.mockReturnValue(child);

          const p = mod.execCommand('cmd', [], { timeout: '10' });

          expect(spawnMock).toHaveBeenCalledTimes(1);
          expect(setTimeoutSpy).toHaveBeenCalled();

          const delays = setTimeoutSpy.mock.calls.map((c) => c[1]);
          expect(delays).toContain(60_000);

          finishChild(child, 0, null);

          const outcome = await settle(p);
          expect(outcome.ok).toBe(true);
          expectExecResultShape(outcome.value);
        } finally {
          setTimeoutSpy.mockRestore();
          vi.useRealTimers();
        }
      });

      it('responds to AbortSignal abort by killing the child and surfacing cancellation', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const controller = new AbortController();

        const p = mod.execCommand('cmd', [], { timeout: 0, signal: controller.signal });

        controller.abort();

        expect(child.kill).toHaveBeenCalled();

        finishChild(child, null, 'SIGTERM');

        const outcome = await settle(p);
        if (outcome.ok) {
          expectExecResultShape(outcome.value);
          expect(outcome.value.success).toBe(false);
          expect(outcome.value.timedOut).toBe(false);
        } else {
          expect(outcome.error).toBeInstanceOf(Error);
        }
      });

      it('handles pre-aborted AbortSignal without hanging (empty/abort boundary)', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const controller = new AbortController();
        controller.abort();

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const p = mod.execCommand('cmd', [], { timeout: 0, signal: controller.signal });

        if (spawnMock.mock.calls.length > 0) {
          expect(child.kill).toHaveBeenCalled();
          finishChild(child, null, 'SIGTERM');
        }

        const outcome = await settle(p);
        if (outcome.ok) {
          expectExecResultShape(outcome.value);
          expect(outcome.value.success).toBe(false);
        } else {
          expect(outcome.error).toBeInstanceOf(Error);
        }
      });

      it('supports concurrent executions without cross-talk (concurrency boundary)', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child1 = createMockChildProcess();
        const child2 = createMockChildProcess();

        spawnMock.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

        const p1 = mod.execCommand('cmd1', ['a'], { timeout: 0 });
        const p2 = mod.execCommand('cmd2', ['b'], { timeout: 0 });

        emitStdout(child2, 'two');
        emitStdout(child1, 'one');

        finishChild(child1, 0, null);
        finishChild(child2, 0, null);

        const [o1, o2] = await Promise.all([settle(p1), settle(p2)]);
        expect(o1.ok).toBe(true);
        expect(o2.ok).toBe(true);

        expect(o1.value.stdout).toBe('one');
        expect(o2.value.stdout).toBe('two');

        expect(spawnMock.mock.calls[0][0]).toBe('cmd1');
        expect(spawnMock.mock.calls[1][0]).toBe('cmd2');
      });

      it('supports rapid successive calls (concurrency boundary: quick consecutive)', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child1 = createMockChildProcess();
        const child2 = createMockChildProcess();

        spawnMock.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

        const p1 = mod.execCommand('cmd', [], { timeout: 0 });
        emitStdout(child1, 'first');
        finishChild(child1, 0, null);

        const r1 = await settle(p1);
        expect(r1.ok).toBe(true);
        expect(r1.value.stdout).toBe('first');

        const p2 = mod.execCommand('cmd', [], { timeout: 0 });
        emitStdout(child2, 'second');
        finishChild(child2, 0, null);

        const r2 = await settle(p2);
        expect(r2.ok).toBe(true);
        expect(r2.value.stdout).toBe('second');

        expect(spawnMock).toHaveBeenCalledTimes(2);
      });

      it('handles very large stdout efficiently by truncating at maxOutputBytes (resource boundary: huge output)', async () => {
        const mod = await importSut();
        expect(typeof mod.execCommand).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const huge = 'a'.repeat(1024 * 1024); // 1MB
        const p = mod.execCommand('cmd', [], { timeout: 0, maxOutputBytes: 1024 });

        emitStdout(child, huge);
        finishChild(child, 0, null);

        const outcome = await settle(p);
        expect(outcome.ok).toBe(true);
        expect(outcome.value.stdout.length).toBe(1024);
        expect(outcome.value.truncated).toBe(true);
      });
    });
  } else if (exportName === 'execShell') {
    describe('execShell', () => {
      it('rejects untrusted shell execution (security control)', async () => {
        const mod = await importSut();
        expect(typeof mod.execShell).toBe('function');

        const outcome = await settle(mod.execShell('echo hello', { timeout: 0, trusted: false }));
        if (outcome.ok) {
          expectExecResultShape(outcome.value);
          expect(outcome.value.success).toBe(false);
          expect(outcome.value.error || '').toEqual(expect.stringMatching(/trust|trusted|shell/i));
        } else {
          expect(outcome.error).toBeInstanceOf(Error);
          expect(String(outcome.error.message || '')).toEqual(expect.stringMatching(/trust|trusted|shell/i));
        }
        expect(spawnMock).toHaveBeenCalledTimes(0);
      });

      it('executes shell when trusted:true and invokes the system shell', async () => {
        const mod = await importSut();
        expect(typeof mod.execShell).toBe('function');

        const child = createMockChildProcess();
        spawnMock.mockReturnValue(child);

        const p = mod.execShell('echo hello', { timeout: 0, trusted: true });

        expect(spawnMock).toHaveBeenCalledTimes(1);
        const call = spawnMock.mock.calls[0];
        const isWindows = process.platform === 'win32';
        expect(call[0]).toBe(isWindows ? 'cmd.exe' : '/bin/sh');
        expect(getSpawnArgsFromCall(call)).toEqual(isWindows ? ['/c', 'echo hello'] : ['-c', 'echo hello']);
        const opts = getSpawnOptionsFromCall(call);
        expect(opts).toEqual(expect.objectContaining({ shell: false }));

        finishChild(child, 0, null);

        const outcome = await settle(p);
        expect(outcome.ok).toBe(true);
        expectExecResultShape(outcome.value);
      });

      it('handles null/undefined/empty-string command inputs without spawning', async () => {
        const mod = await importSut();
        expect(typeof mod.execShell).toBe('function');

        const candidates = [null, undefined, '', '   '];

        for (const cmd of candidates) {
          spawnMock.mockReset();

          const outcome = await settle(mod.execShell(cmd, { timeout: 0, trusted: true }));
          if (outcome.ok) {
            expectExecResultShape(outcome.value);
            expect(outcome.value.success).toBe(false);
          } else {
            expect(outcome.error).toBeInstanceOf(Error);
          }
          expect(spawnMock).toHaveBeenCalledTimes(0);
        }
      });
    });
  } else {
    it('has a stable type (function/class or other value)', async () => {
      const mod = await importSut();
      const value = mod[exportName];

      expect(value).not.toBeUndefined();

      const t = typeof value;
      expect(['function', 'object', 'string', 'number', 'boolean', 'bigint', 'symbol', 'undefined']).toContain(t);
      if (t === 'function') {
        // Basic sanity check for function exports (avoid calling unknown APIs).
        expect(value.name === exportName || value.name === 'default' || value.name.length >= 0).toBe(true);
      }
    });
  }
});
