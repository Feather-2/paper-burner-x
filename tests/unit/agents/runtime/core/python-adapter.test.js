import { describe, it, expect, vi, beforeEach } from 'vitest';

const hoisted = vi.hoisted(() => {
  const mockLogger = {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  const createLogger = vi.fn(() => mockLogger);

  const VfsProxyHost = vi.fn(function VfsProxyHost() {});
  const VFS_REQUEST = 'VFS_REQUEST';

  class RuntimeAdapter {
    constructor(options) {
      this.options = options;
    }
  }

  const RuntimeType = { PYTHON: 'PYTHON' };

  return { mockLogger, createLogger, VfsProxyHost, VFS_REQUEST, RuntimeAdapter, RuntimeType };
});

vi.mock('../../../../../js/agents/runtime/core/runtime-adapter.js', () => ({
  RuntimeAdapter: hoisted.RuntimeAdapter,
  RuntimeType: hoisted.RuntimeType,
}));

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  createLogger: hoisted.createLogger,
}));

vi.mock('../../../../../js/agents/runtime/core/vfs-proxy-host.js', () => ({
  VfsProxyHost: hoisted.VfsProxyHost,
}));

vi.mock('../../../../../js/agents/runtime/core/vfs-proxy-protocol.js', () => ({
  VFS_REQUEST: hoisted.VFS_REQUEST,
}));

import { PythonRuntimeAdapter } from '../../../../../js/agents/runtime/core/python-adapter.js';

describe('PythonRuntimeAdapter', () => {
  const DEFAULT_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
  const EXPECTED_SAB_SIZE = 16 + 4 * 1024 * 1024;

  /** @type {{ WorkerMock: import('vitest').Mock, instances: any[] }} */
  let workerHarness;

  function makeWorkerHarness() {
    const instances = [];
    const WorkerMock = vi.fn().mockImplementation(function (url, options) {
      this.url = url;
      this.options = options;
      this.postMessage = vi.fn();
      this.onmessage = null;
      this.emit = async (data) => {
        if (this.onmessage) await this.onmessage({ data });
      };
      instances.push(this);
    });

    vi.stubGlobal('Worker', WorkerMock);
    return { WorkerMock, instances };
  }

  async function initAdapter(adapter) {
    const initPromise = adapter.initialize();
    const worker = workerHarness.instances[0];
    const initMsg = worker.postMessage.mock.calls[0][0];
    await worker.emit({ type: 'ready', id: initMsg.id, data: 'ready' });
    await initPromise;
    return worker;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    workerHarness = makeWorkerHarness();
  });

  describe('constructor', () => {
    it('defaults runtime type, indexUrl, and watchPaths', () => {
      const adapter = new PythonRuntimeAdapter();

      expect(adapter.options).toEqual(expect.objectContaining({ type: 'PYTHON' }));
      expect(adapter.worker).toBe(null);
      expect(adapter.indexUrl).toBe(DEFAULT_INDEX_URL);
      expect(adapter.pendingRequests).toBeInstanceOf(Map);
      expect(adapter._requestId).toBe(0);
      expect(adapter.watchPaths).toEqual(['/mnt/workspace']);
      expect(adapter.vfsProxyHost).toBe(null);
      expect(adapter.vfsProxySharedBuffer).toBe(null);
    });

    it('falls back to default indexUrl when option is empty/nullish', () => {
      expect(new PythonRuntimeAdapter({ indexUrl: '' }).indexUrl).toBe(DEFAULT_INDEX_URL);
      expect(new PythonRuntimeAdapter({ indexUrl: null }).indexUrl).toBe(DEFAULT_INDEX_URL);
      expect(new PythonRuntimeAdapter({ indexUrl: undefined }).indexUrl).toBe(DEFAULT_INDEX_URL);
    });

    it('accepts an empty watchPaths array as-is', () => {
      const adapter = new PythonRuntimeAdapter({ watchPaths: [] });
      expect(adapter.watchPaths).toEqual([]);
    });
  });

  describe('_ensureVfsProxySharedBuffer', () => {
    it('returns null when SharedArrayBuffer is unavailable', () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const buf = adapter._ensureVfsProxySharedBuffer();

      expect(buf).toBe(null);
      expect(adapter.vfsProxySharedBuffer).toBe(null);
      expect(hoisted.mockLogger.warn).not.toHaveBeenCalled();
    });

    it('allocates and caches a reusable SharedArrayBuffer', () => {
      const allocations = [];
      class FakeSharedArrayBuffer {
        constructor(size) {
          this.byteLength = size;
          allocations.push(size);
        }
      }
      vi.stubGlobal('SharedArrayBuffer', FakeSharedArrayBuffer);

      const adapter = new PythonRuntimeAdapter();
      const first = adapter._ensureVfsProxySharedBuffer();

      expect(first).toBeInstanceOf(FakeSharedArrayBuffer);
      expect(first.byteLength).toBe(EXPECTED_SAB_SIZE);
      expect(allocations).toEqual([EXPECTED_SAB_SIZE]);
      expect(adapter.vfsProxySharedBuffer).toBe(first);

      const second = adapter._ensureVfsProxySharedBuffer();
      expect(second).toBe(first);
      expect(allocations).toEqual([EXPECTED_SAB_SIZE]);
    });

    it('logs a warning and returns null when SAB construction throws', () => {
      function ThrowingSAB() {
        throw new Error('blocked');
      }
      vi.stubGlobal('SharedArrayBuffer', ThrowingSAB);

      const adapter = new PythonRuntimeAdapter();
      const buf = adapter._ensureVfsProxySharedBuffer();

      expect(buf).toBe(null);
      expect(adapter.vfsProxySharedBuffer).toBe(null);
      expect(hoisted.mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SharedArrayBuffer unavailable'),
        expect.objectContaining({ error: expect.stringContaining('blocked') }),
      );
    });

    it('returns the existing buffer without accessing SharedArrayBuffer', () => {
      const adapter = new PythonRuntimeAdapter();
      adapter.vfsProxySharedBuffer = /** @type {any} */ ({ sentinel: true });
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const buf = adapter._ensureVfsProxySharedBuffer();

      expect(buf).toBe(adapter.vfsProxySharedBuffer);
      expect(hoisted.mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('_getVfsProxyAliases', () => {
    it('includes trimmed watchPaths plus /workspace and /output, without duplicates', () => {
      const adapter = new PythonRuntimeAdapter({
        watchPaths: ['/mnt/workspace', '/mnt/workspace', '  /custom  ', '', '   ', null, undefined],
      });

      const aliases = adapter._getVfsProxyAliases();

      expect(aliases).toEqual(expect.arrayContaining(['/mnt/workspace', '/custom', '/workspace', '/output']));
      expect(new Set(aliases).size).toBe(aliases.length);
      expect(aliases.filter((x) => x === '/mnt/workspace')).toHaveLength(1);
    });

    it('handles non-array, nullish, and mixed-type watchPaths safely', () => {
      const adapter = new PythonRuntimeAdapter({
        watchPaths: /** @type {any} */ ({
          not: 'an array',
        }),
      });

      const aliasesFromObject = adapter._getVfsProxyAliases();
      expect(aliasesFromObject).toEqual(expect.arrayContaining(['/workspace', '/output']));
      expect(aliasesFromObject).toHaveLength(2);

      adapter.watchPaths = /** @type {any} */ (null);
      const aliasesFromNull = adapter._getVfsProxyAliases();
      expect(aliasesFromNull).toEqual(expect.arrayContaining(['/workspace', '/output']));
      expect(aliasesFromNull).toHaveLength(2);

      adapter.watchPaths = /** @type {any} */ ([
        0,
        -1,
        Number.MAX_SAFE_INTEGER,
        '   ',
        { toString: () => '  /ok  ' },
        { toString: () => '   ' },
      ]);
      const aliasesMixed = adapter._getVfsProxyAliases();
      expect(aliasesMixed).toEqual(
        expect.arrayContaining(['0', '-1', String(Number.MAX_SAFE_INTEGER), '/ok', '/workspace', '/output']),
      );
      expect(aliasesMixed).not.toEqual(expect.arrayContaining(['']));
    });
  });

  describe('initialize', () => {
    it('creates a module Worker and sends init payload (with shared buffer when available)', async () => {
      class FakeSharedArrayBuffer {
        constructor(size) {
          this.byteLength = size;
        }
      }
      vi.stubGlobal('SharedArrayBuffer', FakeSharedArrayBuffer);

      const adapter = new PythonRuntimeAdapter({
        indexUrl: 'https://example.com/py/',
        watchPaths: ['/mnt/workspace', '/custom'],
      });

      const initPromise = adapter.initialize();

      expect(workerHarness.WorkerMock).toHaveBeenCalledTimes(1);
      const [workerUrl, workerOptions] = workerHarness.WorkerMock.mock.calls[0];
      expect(workerUrl).toBeInstanceOf(URL);
      expect(workerOptions).toEqual({ type: 'module' });

      const worker = workerHarness.instances[0];
      expect(adapter.worker).toBe(worker);
      expect(typeof worker.onmessage).toBe('function');

      expect(hoisted.VfsProxyHost).toHaveBeenCalledWith(null, worker);

      const initMsg = worker.postMessage.mock.calls[0][0];
      expect(initMsg).toEqual(
        expect.objectContaining({
          type: 'init',
          id: expect.any(Number),
          payload: expect.objectContaining({
            indexUrl: 'https://example.com/py/',
            vfsProxy: expect.objectContaining({
              enabled: false,
              sharedBuffer: expect.any(FakeSharedArrayBuffer),
              aliases: expect.arrayContaining(['/mnt/workspace', '/custom', '/workspace', '/output']),
            }),
          }),
        }),
      );

      await worker.emit({ type: 'ready', id: initMsg.id, data: { ok: true } });
      await expect(initPromise).resolves.toEqual({ ok: true });
      expect(adapter.pendingRequests.size).toBe(0);
    });

    it('sends init without shared buffer when SharedArrayBuffer is unavailable', async () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const initPromise = adapter.initialize();

      const worker = workerHarness.instances[0];
      const initMsg = worker.postMessage.mock.calls[0][0];

      expect(initMsg.payload).toEqual(
        expect.objectContaining({
          indexUrl: DEFAULT_INDEX_URL,
          vfsProxy: { enabled: false },
        }),
      );
      expect(hoisted.mockLogger.warn).not.toHaveBeenCalled();

      await worker.emit({ type: 'ready', id: initMsg.id, data: 'ok' });
      await expect(initPromise).resolves.toBe('ok');
    });

    it('is idempotent (including back-to-back calls) and does not create a second Worker', async () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();

      const p1 = adapter.initialize();
      const p2 = adapter.initialize();

      expect(workerHarness.WorkerMock).toHaveBeenCalledTimes(1);

      const worker = workerHarness.instances[0];
      const initMsg = worker.postMessage.mock.calls[0][0];

      await worker.emit({ type: 'ready', id: initMsg.id, data: 'ready' });
      await expect(p1).resolves.toBe('ready');
      await expect(p2).resolves.toBe(undefined);

      const callsAfter = worker.postMessage.mock.calls.length;
      await adapter.initialize();
      expect(workerHarness.WorkerMock).toHaveBeenCalledTimes(1);
      expect(worker.postMessage.mock.calls.length).toBe(callsAfter);
    });

    it('ignores VFS proxy requests (VFS_REQUEST) without affecting pending requests', async () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const initPromise = adapter.initialize();

      const worker = workerHarness.instances[0];
      const initMsg = worker.postMessage.mock.calls[0][0];

      await worker.emit({ type: hoisted.VFS_REQUEST, id: initMsg.id, data: { any: true } });

      expect(adapter.pendingRequests.has(initMsg.id)).toBe(true);
      expect(hoisted.mockLogger.debug).not.toHaveBeenCalled();
      expect(hoisted.mockLogger.error).not.toHaveBeenCalled();

      await worker.emit({ type: 'ready', id: initMsg.id, data: 'ready' });
      await expect(initPromise).resolves.toBe('ready');
      expect(adapter.pendingRequests.size).toBe(0);
    });
  });

  describe('_send / worker message handling', () => {
    it('logs stdout/stderr without settling the request until a result arrives', async () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const worker = await initAdapter(adapter);

      const promise = adapter._send('run', { code: 'print("x")' });
      const runMsg = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1][0];
      const id = runMsg.id;

      let settled = false;
      promise.finally(() => {
        settled = true;
      });

      await worker.emit({ type: 'stdout', id, text: 'hello' });
      expect(hoisted.mockLogger.debug).toHaveBeenCalledWith('[Python Stdout] hello');
      expect(adapter.pendingRequests.has(id)).toBe(true);

      await Promise.resolve();
      expect(settled).toBe(false);

      await worker.emit({ type: 'stderr', id, text: 'oops' });
      expect(hoisted.mockLogger.error).toHaveBeenCalledWith('[Python Stderr] oops');
      expect(adapter.pendingRequests.has(id)).toBe(true);

      await worker.emit({ type: 'result', id, data: 123 });
      await expect(promise).resolves.toBe(123);
      expect(adapter.pendingRequests.has(id)).toBe(false);

      await worker.emit({ type: 'stdout', id: 9999, text: 'orphan' });
      await worker.emit({ type: 'stderr', id: 9999, text: 'orphan' });
      expect(hoisted.mockLogger.debug).toHaveBeenCalledWith('[Python Stdout] orphan');
      expect(hoisted.mockLogger.error).toHaveBeenCalledWith('[Python Stderr] orphan');
    });

    it('writes returned files back to the provided VFS (large content + deep path) and resolves', async () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const worker = await initAdapter(adapter);

      const vfs = {
        writeFile: vi.fn().mockResolvedValue(undefined),
      };

      const bigContent = 'x'.repeat(1024 * 1024);

      const promise = adapter._send('run', { code: '...' }, vfs);
      const runMsg = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1][0];
      const id = runMsg.id;

      expect(adapter.pendingRequests.get(id)?.vfs).toBe(vfs);

      const files = [
        { path: '/output/simple.txt', content: 'hi' },
        { path: '/output/a/b/c/d/e/f/g/h/i/j/big.txt', content: bigContent },
      ];

      await worker.emit({ type: 'result', id, data: { ok: true }, files });

      await expect(promise).resolves.toEqual({ ok: true });
      expect(vfs.writeFile).toHaveBeenCalledTimes(2);
      expect(vfs.writeFile).toHaveBeenNthCalledWith(1, '/output/simple.txt', 'hi');
      expect(vfs.writeFile).toHaveBeenNthCalledWith(2, '/output/a/b/c/d/e/f/g/h/i/j/big.txt', bigContent);
      expect(adapter.pendingRequests.size).toBe(0);
    });

    it('does not attempt VFS writes when no VFS is provided, even if files exist', async () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const worker = await initAdapter(adapter);

      const promise = adapter._send('run', { code: '...' }, null);
      const runMsg = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1][0];
      const id = runMsg.id;

      await worker.emit({
        type: 'result',
        id,
        data: 'ok',
        files: [{ path: '/output/ignored.txt', content: 'x' }],
      });

      await expect(promise).resolves.toBe('ok');
      expect(adapter.pendingRequests.size).toBe(0);
    });

    it('rejects when writing files back to VFS fails and cleans up the pending request', async () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const worker = await initAdapter(adapter);

      const vfsWriteErr = new Error('disk full');
      const vfs = {
        writeFile: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(vfsWriteErr),
      };

      const promise = adapter._send('run', { code: '...' }, vfs);
      const runMsg = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1][0];
      const id = runMsg.id;

      await worker.emit({
        type: 'result',
        id,
        data: 'ignored',
        files: [
          { path: '/output/ok.txt', content: 'ok' },
          { path: '/output/fail.txt', content: 'nope' },
        ],
      });

      await expect(promise).rejects.toThrow('disk full');
      expect(adapter.pendingRequests.has(id)).toBe(false);
      expect(hoisted.mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to write file back to VFS'),
        expect.objectContaining({ error: expect.stringContaining('disk full') }),
      );
    });

    it('handles ready/preloaded/error response types and always cleans up pendingRequests', async () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const worker = await initAdapter(adapter);

      const pReady = adapter._send('one', { n: 0 });
      const msgReady = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1][0];
      await worker.emit({ type: 'ready', id: msgReady.id, data: 'READY' });
      await expect(pReady).resolves.toBe('READY');
      expect(adapter.pendingRequests.has(msgReady.id)).toBe(false);

      const pPreloaded = adapter._send('two', { n: -1 });
      const msgPreloaded = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1][0];
      await worker.emit({ type: 'preloaded', id: msgPreloaded.id, data: 'PRELOADED' });
      await expect(pPreloaded).resolves.toBe('PRELOADED');
      expect(adapter.pendingRequests.has(msgPreloaded.id)).toBe(false);

      const pError = adapter._send('three', { n: Number.MAX_SAFE_INTEGER });
      const msgError = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1][0];
      await worker.emit({ type: 'error', id: msgError.id, error: 'boom' });
      await expect(pError).rejects.toThrow('boom');
      expect(adapter.pendingRequests.has(msgError.id)).toBe(false);
    });

    it('supports concurrent _send calls and allows out-of-order responses', async () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const worker = await initAdapter(adapter);

      const pA = adapter._send('a', { idx: 0 });
      const msgA = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1][0];

      const pB = adapter._send('b', { idx: -1 });
      const msgB = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1][0];

      const pC = adapter._send('c', { idx: Number.MAX_SAFE_INTEGER });
      const msgC = worker.postMessage.mock.calls[worker.postMessage.mock.calls.length - 1][0];

      expect(adapter.pendingRequests.size).toBe(3);

      await worker.emit({ type: 'ready', id: msgB.id, data: 'B' });
      await worker.emit({ type: 'ready', id: msgC.id, data: 'C' });
      await worker.emit({ type: 'ready', id: msgA.id, data: 'A' });

      await expect(Promise.all([pA, pB, pC])).resolves.toEqual(['A', 'B', 'C']);
      expect(adapter.pendingRequests.size).toBe(0);
    });

    it('ignores messages for unknown request ids without throwing', async () => {
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const worker = await initAdapter(adapter);

      await worker.emit({ type: 'result', id: 999999, data: 'x' });
      await worker.emit({ type: 'ready', id: 999999, data: 'x' });
      await worker.emit({ type: 'preloaded', id: 999999, data: 'x' });
      await worker.emit({ type: 'error', id: 999999, error: 'x' });

      expect(adapter.pendingRequests.size).toBe(0);
    });
  });
});