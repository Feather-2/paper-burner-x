import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
import ProcessTransportDefault, {
  ProcessTransport,
  createProcessTransport,
} from '../../../../../js/agents/plugins/transports/process-transport.js';

const MAX_MESSAGE_LENGTH = 256 * 1024;
const MAX_STRING_LENGTH = 10000;
const MAX_JSON_DEPTH = 8;
const MAX_COLLECTION_ENTRIES = 2000;
const MAX_ARG_LENGTH = 4096;
const MAX_ENV_VALUE_LENGTH = 10000;

const ORIGINAL_ENV = { ...process.env };

function createMockProcess() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    write: vi.fn(),
    end: vi.fn(),
  };
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
  });
  return proc;
}

function makeTransport(options = {}) {
  return new ProcessTransport({
    command: 'echo',
    ...options,
  });
}

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

beforeEach(() => {
  spawn.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  restoreEnv();
});

describe('ProcessTransport', () => {
  it('constructs with normalized options and defaults', () => {
    process.env.TEST_BASE = 'base';
    const transport = new ProcessTransport({
      command: 'echo',
      args: ['--version'],
      cwd: '.',
      env: { TEST_OK: 'ok' },
      allowedEnvKeys: ['TEST_OK'],
    });

    expect(transport.cwd).toBe(path.resolve('.'));
    expect(transport.command).toBe('echo');
    expect(transport.args).toEqual(['--version']);
    expect(transport.env.TEST_OK).toBe('ok');
    expect(transport.env.TEST_BASE).toBe('base');
    expect(transport.timeout).toBe(30000);
    expect(transport.signal).toBe(null);
    expect(transport.connected).toBe(false);
    expect(transport.process).toBe(null);
  });

  it('uses process.cwd for null/undefined/empty cwd values', () => {
    for (const value of [undefined, null, '']) {
      const transport = new ProcessTransport({ command: 'echo', cwd: value });
      expect(transport.cwd).toBe(process.cwd());
    }
  });

  it('rejects invalid cwd values', () => {
    expect(() => new ProcessTransport({ command: 'echo', cwd: 123 }))
      .toThrow('ProcessTransport cwd must be a string');
    expect(() => new ProcessTransport({ command: 'echo', cwd: '   ' }))
      .toThrow('ProcessTransport cwd is required');
    expect(() => new ProcessTransport({ command: 'echo', cwd: '../escape' }))
      .toThrow('ProcessTransport cwd contains path traversal');
    expect(() => new ProcessTransport({ command: 'echo', cwd: 'bad\u0000' }))
      .toThrow('ProcessTransport cwd contains invalid characters');

    const allowedRoot = path.join(process.cwd(), 'allowed-root');
    const outsideRoot = path.join(process.cwd(), 'outside-root');
    expect(() => new ProcessTransport({
      command: 'echo',
      cwd: outsideRoot,
      allowedCwdRoots: [allowedRoot],
    })).toThrow('ProcessTransport cwd not in allowlist');
  });

  it('rejects invalid commands and allowlist mismatches', () => {
    expect(() => new ProcessTransport({ command: 123 }))
      .toThrow('ProcessTransport command must be a string');
    expect(() => new ProcessTransport({ command: '' }))
      .toThrow('ProcessTransport command is required');
    expect(() => new ProcessTransport({ command: '   ' }))
      .toThrow('ProcessTransport command is required');
    expect(() => new ProcessTransport({ command: 'bad\u0000' }))
      .toThrow('ProcessTransport command contains invalid characters');
    expect(() => new ProcessTransport({ command: 'bad;rm' }))
      .toThrow('ProcessTransport command contains invalid characters');
    expect(() => new ProcessTransport({ command: '../bad' }))
      .toThrow('ProcessTransport command contains path traversal');
    expect(() => new ProcessTransport({ command: 'echo', allowedCommands: ['other'] }))
      .toThrow('ProcessTransport command not allowlisted');
  });

  it('accepts allowlisted command paths and enforces allowed roots', () => {
    const root = path.join(process.cwd(), 'root');
    const commandPath = './bin/tool';

    const transport = new ProcessTransport({
      command: commandPath,
      cwd: root,
      allowedCwdRoots: [root],
      allowedCommands: ['tool'],
    });

    expect(transport.command).toBe(path.resolve(root, commandPath));

    const outside = path.join(process.cwd(), 'outside', 'tool');
    expect(() => new ProcessTransport({
      command: outside,
      cwd: root,
      allowedCwdRoots: [root],
      allowedCommands: [outside],
    })).toThrow('ProcessTransport command path not in allowlist');
  });

  it('normalizes args and enforces limits', () => {
    const emptyArgs = new ProcessTransport({ command: 'echo', args: [] });
    expect(emptyArgs.args).toEqual([]);

    const objectArgs = new ProcessTransport({ command: 'echo', args: { foo: 'bar' } });
    expect(objectArgs.args).toEqual([]);

    expect(() => new ProcessTransport({ command: 'echo', args: [123] }))
      .toThrow('ProcessTransport args must be strings');

    const longArg = 'a'.repeat(MAX_ARG_LENGTH + 1);
    expect(() => new ProcessTransport({ command: 'echo', args: [longArg] }))
      .toThrow('ProcessTransport arg contains invalid characters');
    expect(() => new ProcessTransport({ command: 'echo', args: ['bad\u0000'] }))
      .toThrow('ProcessTransport arg contains invalid characters');
  });

  it('applies timeout boundaries', () => {
    const transportZero = new ProcessTransport({ command: 'echo', timeout: 0 });
    expect(transportZero.timeout).toBe(30000);

    const transportNegative = new ProcessTransport({ command: 'echo', timeout: -1 });
    expect(transportNegative.timeout).toBe(-1);

    const transportMax = new ProcessTransport({
      command: 'echo',
      timeout: Number.MAX_SAFE_INTEGER,
    });
    expect(transportMax.timeout).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('sanitizes env overrides with allowlist and blocked keys', () => {
    process.env.TEST_BASE = 'base';
    process.env.LD_PRELOAD = 'orig';

    const transport = new ProcessTransport({
      command: 'echo',
      env: {
        TEST_OK: 'ok',
        BADKEY: 'allowed',
        lower: 'skip',
        LD_PRELOAD: 'blocked',
        LONGVALUE: 'x'.repeat(MAX_ENV_VALUE_LENGTH + 1),
        NULLVAL: 'bad\u0000',
        NUMBERVAL: 123,
      },
      allowedEnvKeys: ['TEST_OK', 'BADKEY'],
    });

    const env = transport.env;
    expect(env.TEST_OK).toBe('ok');
    expect(env.BADKEY).toBe('allowed');
    expect(env.LD_PRELOAD).toBe('orig');
    expect(Object.prototype.hasOwnProperty.call(env, 'lower')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(env, 'LONGVALUE')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(env, 'NULLVAL')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(env, 'NUMBERVAL')).toBe(false);
    expect(env.TEST_BASE).toBe('base');
  });

  it('allows blocked env keys only when allowlisted', () => {
    process.env.LD_PRELOAD = 'orig';

    const transport = new ProcessTransport({
      command: 'echo',
      env: { LD_PRELOAD: 'allowed' },
      allowedEnvKeys: ['LD_PRELOAD'],
    });

    expect(transport.env.LD_PRELOAD).toBe('allowed');
  });

  it('uses process.env when env overrides are missing or empty', () => {
    process.env.TEST_BASE = 'base';

    const t1 = new ProcessTransport({ command: 'echo' });
    expect(t1.env.TEST_BASE).toBe('base');

    const t2 = new ProcessTransport({ command: 'echo', env: null });
    expect(t2.env.TEST_BASE).toBe('base');

    const t3 = new ProcessTransport({ command: 'echo', env: {} });
    expect(t3.env.TEST_BASE).toBe('base');
  });

  it('applies PROCESS_TRANSPORT_ALLOWED_COMMANDS env allowlist', () => {
    process.env.PROCESS_TRANSPORT_ALLOWED_COMMANDS = 'echo,tool';

    const allowed = new ProcessTransport({ command: 'echo' });
    expect(allowed.command).toBe('echo');

    expect(() => new ProcessTransport({ command: 'nope' }))
      .toThrow('ProcessTransport command not allowlisted');
  });

  it('connect spawns the process and resolves on stdout data', async () => {
    const proc = createMockProcess();
    spawn.mockReturnValue(proc);

    const transport = makeTransport();
    const connectedSpy = vi.fn();
    transport.on('transport:connected', connectedSpy);

    const connectPromise = transport.connect();
    proc.stdout.emit(
      'data',
      Buffer.from('{"jsonrpc":"2.0","method":"ping","params":{}}\n'),
    );

    await expect(connectPromise).resolves.toBeUndefined();
    expect(transport.connected).toBe(true);
    expect(connectedSpy).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      transport.command,
      transport.args,
      expect.objectContaining({
        cwd: transport.cwd,
        env: transport.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        signal: null,
      }),
    );
  });

  it('connect resolves after timeout when no stdout arrives', async () => {
    vi.useFakeTimers();
    const proc = createMockProcess();
    spawn.mockReturnValue(proc);

    const transport = makeTransport();
    const connectPromise = transport.connect();

    vi.advanceTimersByTime(100);

    await expect(connectPromise).resolves.toBeUndefined();
    expect(transport.connected).toBe(true);
  });

  it('connect rejects on process error and emits transport:error', async () => {
    const proc = createMockProcess();
    spawn.mockReturnValue(proc);

    const transport = makeTransport();
    const errorSpy = vi.fn();
    transport.on('transport:error', errorSpy);

    const connectPromise = transport.connect();
    const err = new Error('boom');
    proc.emit('error', err);

    await expect(connectPromise).rejects.toThrow('boom');
    expect(errorSpy).toHaveBeenCalledWith(err);
  });

  it('connect rejects when process exits during connect', async () => {
    const proc = createMockProcess();
    spawn.mockReturnValue(proc);

    const transport = makeTransport();
    const exitSpy = vi.fn();
    transport.on('transport:exit', exitSpy);

    const connectPromise = transport.connect();
    proc.emit('exit', 1, 'SIGTERM');

    await expect(connectPromise).rejects.toThrow(
      'Process exited during connect: code=1, signal=SIGTERM',
    );
    expect(exitSpy).toHaveBeenCalledWith({ code: 1, signal: 'SIGTERM' });
    expect(transport.connected).toBe(false);
  });

  it('connect is a no-op when already connected', async () => {
    const transport = makeTransport();
    transport.connected = true;

    await expect(transport.connect()).resolves.toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('send writes JSON lines to stdin when connected', () => {
    const transport = makeTransport();
    transport.connected = true;
    transport.process = createMockProcess();

    const message = { jsonrpc: '2.0', method: 'notify', params: { ok: true } };
    transport.send(message);

    expect(transport.process.stdin.write).toHaveBeenCalledTimes(1);
    const [payload] = transport.process.stdin.write.mock.calls[0];
    expect(payload.endsWith('\n')).toBe(true);
    expect(JSON.parse(payload.trim())).toEqual(message);
  });

  it('send throws when not connected or missing stdin', () => {
    const transport = makeTransport();
    expect(() => transport.send({})).toThrow('ProcessTransport not connected');

    transport.connected = true;
    transport.process = { stdin: null };
    expect(() => transport.send({})).toThrow('ProcessTransport not connected');
  });

  it('request sends a message and resolves when response arrives', async () => {
    const transport = makeTransport();
    transport.connected = true;
    transport.process = createMockProcess();

    const promise = transport.request('sum', { value: 2 });

    expect(transport._pending.size).toBe(1);
    transport._handleMessage({ id: 1, result: 3 });

    await expect(promise).resolves.toBe(3);
    expect(transport._pending.size).toBe(0);
  });

  it('request rejects on timeout and cleans up pending state', async () => {
    vi.useFakeTimers();
    const transport = makeTransport();
    transport.connected = true;
    transport.process = createMockProcess();
    transport.timeout = 10;

    const promise = transport.request('slow', { value: 1 });
    vi.advanceTimersByTime(10);

    await expect(promise).rejects.toThrow('Request timeout: slow');
    expect(transport._pending.size).toBe(0);
  });

  it('request rejects when response contains error', async () => {
    const transport = makeTransport();
    transport.connected = true;
    transport.process = createMockProcess();

    const promise = transport.request('fail', {});
    transport._handleMessage({ id: 1, error: { message: 'boom' } });

    await expect(promise).rejects.toThrow('boom');
  });

  it('handles rapid consecutive requests independently', async () => {
    const transport = makeTransport();
    transport.connected = true;
    transport.process = createMockProcess();

    const p1 = transport.request('one', { value: 1 });
    const p2 = transport.request('two', { value: 2 });

    expect(transport._pending.size).toBe(2);

    transport._handleMessage({ id: 2, result: 'second' });
    transport._handleMessage({ id: 1, result: 'first' });

    await expect(p1).resolves.toBe('first');
    await expect(p2).resolves.toBe('second');
    expect(transport._pending.size).toBe(0);
  });

  it('notify delegates to send with JSON-RPC payload', () => {
    const transport = makeTransport();
    const sendSpy = vi.spyOn(transport, 'send').mockImplementation(() => {});

    transport.notify('event', { ok: true });

    expect(sendSpy).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'event',
      params: { ok: true },
    });
  });

  it('processBuffer emits buffer overflow and trims buffer', () => {
    const transport = makeTransport();
    transport._maxBufferSize = 10;

    const overflowSpy = vi.fn();
    transport.on('transport:buffer_overflow', overflowSpy);

    transport.buffer = 'a'.repeat(20);
    transport._processBuffer();

    expect(overflowSpy).toHaveBeenCalledWith({ size: 20, limit: 10 });
    expect(transport.buffer.length).toBe(5);
  });

  it('processBuffer emits message_too_large for oversized lines', () => {
    const transport = makeTransport();
    const tooLargeSpy = vi.fn();
    transport.on('transport:message_too_large', tooLargeSpy);

    const largeLine = 'a'.repeat(MAX_MESSAGE_LENGTH + 1);
    transport.buffer = `${largeLine}\n`;
    transport._processBuffer();

    expect(tooLargeSpy).toHaveBeenCalledWith({
      size: largeLine.length,
      limit: transport._maxMessageSize,
    });
  });

  it('processBuffer emits parse_error for invalid JSON', () => {
    const transport = makeTransport();
    const parseSpy = vi.fn();
    transport.on('transport:parse_error', parseSpy);

    transport.buffer = 'not-json\n';
    transport._processBuffer();

    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(parseSpy.mock.calls[0][0].line).toBe('not-json');
    expect(parseSpy.mock.calls[0][0].error).toBeInstanceOf(Error);
  });

  it('processBuffer emits invalid_message for empty or unknown fields', () => {
    const transport = makeTransport();
    const reasons = [];
    transport.on('transport:invalid_message', ({ reason }) => reasons.push(reason));

    transport.buffer = `${JSON.stringify({})}\n${JSON.stringify({ foo: 'bar' })}\n`;
    transport._processBuffer();

    expect(reasons).toEqual(['invalid_keys', 'unknown_field']);
  });

  it('processBuffer rejects long strings, deep nesting, and large collections', () => {
    const transport = makeTransport();
    const reasons = [];
    transport.on('transport:invalid_message', ({ reason }) => reasons.push(reason));

    const longString = 'a'.repeat(MAX_STRING_LENGTH + 1);

    let deep = { value: 'end' };
    for (let i = 0; i <= MAX_JSON_DEPTH; i += 1) {
      deep = { next: deep };
    }

    const bigArray = Array.from({ length: MAX_COLLECTION_ENTRIES + 1 }, (_, i) => i);

    const lines = [
      { jsonrpc: '2.0', method: 'm', params: { value: longString } },
      { jsonrpc: '2.0', method: 'm', params: deep },
      { jsonrpc: '2.0', method: 'm', params: bigArray },
    ].map((payload) => JSON.stringify(payload));

    transport.buffer = `${lines.join('\n')}\n`;
    transport._processBuffer();

    expect(reasons).toEqual(['invalid_params', 'invalid_params', 'invalid_params']);
  });

  it('processBuffer emits transport:message and method events with sanitized payloads', () => {
    const transport = makeTransport();
    const messages = [];
    const methodParams = [];

    transport.on('transport:message', (message) => messages.push(message));
    transport.on('method:ping', (params) => methodParams.push(params));

    const payloads = [
      { jsonrpc: '2.0', method: 'ping', params: { ok: true } },
      { jsonrpc: '2.0', error: { code: 1, message: 'oops', data: { ok: false }, extra: 'skip' } },
    ];

    transport.buffer = `${payloads.map((p) => JSON.stringify(p)).join('\n')}\n`;
    transport._processBuffer();

    expect(messages).toHaveLength(2);
    expect(methodParams).toEqual([{ ok: true }]);
    expect(messages[1].error).toEqual({ code: 1, message: 'oops', data: { ok: false } });
    expect(messages[1].error.extra).toBeUndefined();
  });

  it('processBuffer accepts boundary ids and string ids', () => {
    const transport = makeTransport();
    const receivedIds = [];
    transport.on('transport:message', (message) => receivedIds.push(message.id));

    const payloads = [
      { jsonrpc: '2.0', id: 0, result: 'zero' },
      { jsonrpc: '2.0', id: -1, result: 'neg' },
      { jsonrpc: '2.0', id: Number.MAX_SAFE_INTEGER, result: 'max' },
      { jsonrpc: '2.0', id: '1', result: 'string' },
    ];

    transport.buffer = `${payloads.map((p) => JSON.stringify(p)).join('\n')}\n`;
    transport._processBuffer();

    expect(receivedIds).toEqual([0, -1, Number.MAX_SAFE_INTEGER, '1']);
  });

  it('disconnect rejects pending requests and closes the process', () => {
    const transport = makeTransport();
    const proc = createMockProcess();
    transport.process = proc;
    transport.connected = true;

    const rejectOne = vi.fn();
    const rejectTwo = vi.fn();
    transport._pending.set(1, { resolve: vi.fn(), reject: rejectOne, timer: setTimeout(() => {}, 1000) });
    transport._pending.set(2, { resolve: vi.fn(), reject: rejectTwo, timer: setTimeout(() => {}, 1000) });

    const disconnectedSpy = vi.fn();
    transport.on('transport:disconnected', disconnectedSpy);

    transport.disconnect();

    expect(rejectOne).toHaveBeenCalledWith(expect.any(Error));
    expect(rejectTwo).toHaveBeenCalledWith(expect.any(Error));
    expect(proc.stdin.end).toHaveBeenCalled();
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(transport.connected).toBe(false);
    expect(transport.process).toBe(null);
    expect(disconnectedSpy).toHaveBeenCalledTimes(1);
  });

  it('disconnect emits transport:error when kill throws', () => {
    const transport = makeTransport();
    const proc = createMockProcess();
    proc.kill = vi.fn(() => {
      throw new Error('kill failed');
    });
    transport.process = proc;
    transport.connected = true;

    const errorSpy = vi.fn();
    transport.on('transport:error', errorSpy);

    transport.disconnect();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(transport.process).toBe(null);
  });

  it('isConnected reflects connection and killed state', () => {
    const transport = makeTransport();
    expect(transport.isConnected()).toBe(false);

    transport.connected = true;
    transport.process = createMockProcess();
    transport.process.killed = false;
    expect(transport.isConnected()).toBe(true);

    transport.process.killed = true;
    expect(transport.isConnected()).toBe(false);
  });
});

describe('createProcessTransport', () => {
  it('creates a ProcessTransport instance', () => {
    const transport = createProcessTransport({ command: 'echo' });
    expect(transport).toBeInstanceOf(ProcessTransport);
  });
});

describe('default export', () => {
  it('matches the ProcessTransport class', () => {
    expect(ProcessTransportDefault).toBe(ProcessTransport);
  });
});
