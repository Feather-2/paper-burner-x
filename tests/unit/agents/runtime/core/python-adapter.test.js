import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockedRuntimeAdapter = vi.hoisted(() => {
  class RuntimeAdapter {
    constructor(options = {}) {
      this.options = options;
    }
  }

  return {
    RuntimeAdapter,
    RuntimeType: { PYTHON: 'python' },
  };
});

const mockedLogger = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    logger,
    createLogger: vi.fn(() => logger),
  };
});

const mockedVfsProxyHost = vi.hoisted(() => {
  const instances = [];

  class VfsProxyHost {
    constructor(vfs, worker) {
      this.vfs = vfs;
      this.worker = worker;
      this.setVfs = vi.fn();
      this.dispose = vi.fn();
      instances.push(this);
    }
  }

  return { instances, VfsProxyHost };
});

const mockedVfsProtocol = vi.hoisted(() => ({
  VFS_REQUEST: 'vfs-request',
}));

vi.mock('../../../../../js/agents/runtime/core/runtime-adapter.js', () => ({
  RuntimeAdapter: mockedRuntimeAdapter.RuntimeAdapter,
  RuntimeType: mockedRuntimeAdapter.RuntimeType,
}));

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  createLogger: mockedLogger.createLogger,
}));

vi.mock('../../../../../js/agents/runtime/core/vfs-proxy-host.js', () => ({
  VfsProxyHost: mockedVfsProxyHost.VfsProxyHost,
}));

vi.mock('../../../../../js/agents/runtime/core/vfs-proxy-protocol.js', () => ({
  VFS_REQUEST: mockedVfsProtocol.VFS_REQUEST,
}));

async function loadModule() {
  return await import('../../../../../js/agents/runtime/core/python-adapter.js');
}

function createWorkerMock() {
  const instances = [];

  class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.postMessage = vi.fn();
      this.terminate = vi.fn();
      this.onmessage = null;
      instances.push(this);
    }
  }

  return { FakeWorker, instances };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mockedVfsProxyHost.instances.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PythonRuntimeAdapter', () => {
  describe('constructor', () => {
    it('sets defaults when options are empty', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();

      expect(adapter.worker).toBeNull();
      expect(adapter.indexUrl).toBe('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/');
      expect(adapter.pendingRequests.size).toBe(0);
      expect(adapter._requestId).toBe(0);
      expect(adapter.watchPaths).toEqual(['/mnt/workspace']);
      expect(adapter.vfsProxyHost).toBeNull();
      expect(adapter.vfsProxySharedBuffer).toBeNull();
      expect(adapter.options.type).toBe('python');
    });

    it('uses provided options and preserves empty watchPaths', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter({
        id: 'adapter-1',
        indexUrl: 'https://example.com/',
        watchPaths: [],
      });

      expect(adapter.indexUrl).toBe('https://example.com/');
      expect(adapter.watchPaths).toEqual([]);
      expect(adapter.options).toEqual({
        id: 'adapter-1',
        indexUrl: 'https://example.com/',
        watchPaths: [],
        type: 'python',
      });
    });

    it('falls back to default watchPaths when null is provided', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter({ watchPaths: null });

      expect(adapter.watchPaths).toEqual(['/mnt/workspace']);
    });
  });

  describe('_ensureVfsProxySharedBuffer', () => {
    it('creates and caches SharedArrayBuffer when available', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      function FakeSharedArrayBuffer(length) {
        this.byteLength = length;
      }

      vi.stubGlobal('SharedArrayBuffer', FakeSharedArrayBuffer);

      const adapter = new PythonRuntimeAdapter();
      const buffer = adapter._ensureVfsProxySharedBuffer();

      expect(buffer).toBeInstanceOf(FakeSharedArrayBuffer);
      expect(buffer.byteLength).toBe(16 + 4 * 1024 * 1024);
      expect(adapter.vfsProxySharedBuffer).toBe(buffer);
      expect(adapter._ensureVfsProxySharedBuffer()).toBe(buffer);
    });

    it('returns null when SharedArrayBuffer is unavailable', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const buffer = adapter._ensureVfsProxySharedBuffer();

      expect(buffer).toBeNull();
      expect(adapter.vfsProxySharedBuffer).toBeNull();
    });

    it('logs a warning and returns null when SharedArrayBuffer throws', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      function ThrowingSharedArrayBuffer() {
        throw new Error('nope');
      }

      vi.stubGlobal('SharedArrayBuffer', ThrowingSharedArrayBuffer);

      const adapter = new PythonRuntimeAdapter();
      const buffer = adapter._ensureVfsProxySharedBuffer();

      expect(buffer).toBeNull();
      expect(mockedLogger.logger.warn).toHaveBeenCalled();
    });
  });

  describe('_getVfsProxyAliases', () => {
    it('normalizes watch paths and includes defaults with boundary values', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter({
        watchPaths: [
          '/mnt/workspace',
          '  ',
          '',
          null,
          undefined,
          0,
          -1,
          Number.MAX_SAFE_INTEGER,
          '  /custom  ',
          '/workspace',
          '/output',
          '42',
        ],
      });

      const aliases = adapter._getVfsProxyAliases();
      const aliasSet = new Set(aliases);

      expect(aliasSet.has('/mnt/workspace')).toBe(true);
      expect(aliasSet.has('/custom')).toBe(true);
      expect(aliasSet.has('0')).toBe(true);
      expect(aliasSet.has('-1')).toBe(true);
      expect(aliasSet.has(String(Number.MAX_SAFE_INTEGER))).toBe(true);
      expect(aliasSet.has('42')).toBe(true);
      expect(aliasSet.has('/workspace')).toBe(true);
      expect(aliasSet.has('/output')).toBe(true);
      expect(aliasSet.has('')).toBe(false);
    });

    it('falls back to defaults when watchPaths is not an array', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter({ watchPaths: { path: '/noop' } });

      const aliases = adapter._getVfsProxyAliases();

      expect(new Set(aliases)).toEqual(new Set(['/workspace', '/output']));
    });
  });

  describe('initialize', () => {
    it('returns early when worker already exists', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const { FakeWorker, instances } = createWorkerMock();

      vi.stubGlobal('Worker', FakeWorker);

      const adapter = new PythonRuntimeAdapter();
      adapter.worker = { existing: true };

      const sendSpy = vi.spyOn(adapter, '_send');

      await adapter.initialize();

      expect(instances).toHaveLength(0);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('creates worker, vfs proxy, and sends init payload with shared buffer', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const { FakeWorker, instances } = createWorkerMock();
      function FakeSharedArrayBuffer(length) {
        this.byteLength = length;
      }

      vi.stubGlobal('Worker', FakeWorker);
      vi.stubGlobal('SharedArrayBuffer', FakeSharedArrayBuffer);

      const adapter = new PythonRuntimeAdapter({ watchPaths: ['/mnt/workspace'] });
      const initPromise = adapter.initialize();
      const worker = instances[0];
      const initMessage = worker.postMessage.mock.calls[0][0];

      expect(worker.options).toEqual({ type: 'module' });
      expect(mockedVfsProxyHost.instances).toHaveLength(1);
      expect(mockedVfsProxyHost.instances[0].worker).toBe(worker);
      expect(initMessage.type).toBe('init');
      expect(initMessage.payload.indexUrl).toBe(adapter.indexUrl);
      expect(initMessage.payload.vfsProxy.enabled).toBe(false);
      expect(initMessage.payload.vfsProxy.sharedBuffer).toBeInstanceOf(FakeSharedArrayBuffer);
      expect(initMessage.payload.vfsProxy.aliases).toEqual(
        expect.arrayContaining(['/workspace', '/output', '/mnt/workspace'])
      );
      expect(typeof worker.onmessage).toBe('function');

      await worker.onmessage({ data: { type: 'ready', id: initMessage.id, data: { ok: true } } });
      await initPromise;
    });

    it('sends init payload without aliases when shared buffer is unavailable', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const { FakeWorker, instances } = createWorkerMock();

      vi.stubGlobal('Worker', FakeWorker);
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const aliasSpy = vi.spyOn(adapter, '_getVfsProxyAliases');

      const initPromise = adapter.initialize();
      const worker = instances[0];
      const initMessage = worker.postMessage.mock.calls[0][0];

      expect(initMessage.payload.vfsProxy).toEqual({ enabled: false });
      expect(aliasSpy).not.toHaveBeenCalled();

      await worker.onmessage({ data: { type: 'ready', id: initMessage.id, data: null } });
      await initPromise;
    });
  });

  describe('_send', () => {
    it('stores pending requests and posts messages', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();
      const vfs = { tag: 'vfs' };

      adapter.worker = { postMessage: vi.fn() };

      const promise = adapter._send('custom', { value: 1 }, vfs);
      const request = adapter.pendingRequests.get(1);

      expect(adapter._requestId).toBe(1);
      expect(request).toBeTruthy();
      expect(request.vfs).toBe(vfs);
      expect(adapter.worker.postMessage).toHaveBeenCalledWith({
        type: 'custom',
        payload: { value: 1 },
        id: 1,
      });

      request.resolve('ok');
      await expect(promise).resolves.toBe('ok');
    });

    it('handles concurrent requests with out-of-order responses', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const { FakeWorker, instances } = createWorkerMock();

      vi.stubGlobal('Worker', FakeWorker);
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const initPromise = adapter.initialize();
      const worker = instances[0];
      const initMessage = worker.postMessage.mock.calls[0][0];

      await worker.onmessage({ data: { type: 'ready', id: initMessage.id, data: null } });
      await initPromise;

      const promiseA = adapter._send('execute', { code: 'a' });
      const idA = adapter._requestId;
      const promiseB = adapter._send('execute', { code: 'b' });
      const idB = adapter._requestId;

      expect(idB).toBe(idA + 1);

      await worker.onmessage({ data: { type: 'result', id: idB, data: 'b', files: [] } });
      await worker.onmessage({ data: { type: 'result', id: idA, data: 'a', files: [] } });

      await expect(promiseB).resolves.toBe('b');
      await expect(promiseA).resolves.toBe('a');
      expect(adapter.pendingRequests.size).toBe(0);
    });
  });

  describe('worker message handling', () => {
    it('logs stdout/stderr and ignores VFS proxy requests', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const { FakeWorker, instances } = createWorkerMock();

      vi.stubGlobal('Worker', FakeWorker);
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const initPromise = adapter.initialize();
      const worker = instances[0];
      const initMessage = worker.postMessage.mock.calls[0][0];

      await worker.onmessage({ data: { type: 'ready', id: initMessage.id, data: null } });
      await initPromise;

      await worker.onmessage({ data: { type: 'stdout', id: 999, text: 'hello' } });
      await worker.onmessage({ data: { type: 'stderr', id: 999, text: 'oops' } });

      expect(mockedLogger.logger.debug).toHaveBeenCalledWith('[Python Stdout] hello');
      expect(mockedLogger.logger.error).toHaveBeenCalledWith('[Python Stderr] oops');

      const promise = adapter._send('noop', {});
      const id = adapter._requestId;

      await worker.onmessage({ data: { type: mockedVfsProtocol.VFS_REQUEST, id } });

      expect(adapter.pendingRequests.has(id)).toBe(true);
      adapter.pendingRequests.get(id).resolve('ok');
      await expect(promise).resolves.toBe('ok');
    });

    it('writes files on result and resolves', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const { FakeWorker, instances } = createWorkerMock();

      vi.stubGlobal('Worker', FakeWorker);
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const initPromise = adapter.initialize();
      const worker = instances[0];
      const initMessage = worker.postMessage.mock.calls[0][0];

      await worker.onmessage({ data: { type: 'ready', id: initMessage.id, data: null } });
      await initPromise;

      const vfs = { writeFile: vi.fn().mockResolvedValue(undefined) };
      const promise = adapter._send('execute', { code: 'print(1)' }, vfs);
      const id = adapter._requestId;

      await worker.onmessage({
        data: {
          type: 'result',
          id,
          data: { ok: true },
          files: [{ path: '/output/result.txt', content: 'data' }],
        },
      });

      await expect(promise).resolves.toEqual({ ok: true });
      expect(vfs.writeFile).toHaveBeenCalledWith('/output/result.txt', 'data');
      expect(adapter.pendingRequests.has(id)).toBe(false);
    });

    it('rejects on file write error and logs failure', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const { FakeWorker, instances } = createWorkerMock();

      vi.stubGlobal('Worker', FakeWorker);
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const initPromise = adapter.initialize();
      const worker = instances[0];
      const initMessage = worker.postMessage.mock.calls[0][0];

      await worker.onmessage({ data: { type: 'ready', id: initMessage.id, data: null } });
      await initPromise;

      const vfs = {
        writeFile: vi.fn().mockRejectedValue(new Error('write-failed')),
      };
      const promise = adapter._send('execute', { code: 'print(1)' }, vfs);
      const id = adapter._requestId;

      await worker.onmessage({
        data: {
          type: 'result',
          id,
          data: { ok: true },
          files: [{ path: '/output/result.txt', content: 'data' }],
        },
      });

      await expect(promise).rejects.toThrow('write-failed');
      expect(mockedLogger.logger.error).toHaveBeenCalled();
      expect(adapter.pendingRequests.has(id)).toBe(false);
    });

    it('resolves ready/preloaded and rejects on error', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const { FakeWorker, instances } = createWorkerMock();

      vi.stubGlobal('Worker', FakeWorker);
      vi.stubGlobal('SharedArrayBuffer', undefined);

      const adapter = new PythonRuntimeAdapter();
      const initPromise = adapter.initialize();
      const worker = instances[0];
      const initMessage = worker.postMessage.mock.calls[0][0];

      await worker.onmessage({ data: { type: 'ready', id: initMessage.id, data: null } });
      await initPromise;

      const readyPromise = adapter._send('preload', {});
      const readyId = adapter._requestId;
      const preloadedPromise = adapter._send('preload', {});
      const preloadedId = adapter._requestId;
      const errorPromise = adapter._send('execute', {});
      const errorId = adapter._requestId;

      await worker.onmessage({ data: { type: 'ready', id: readyId, data: 'ready' } });
      await worker.onmessage({ data: { type: 'preloaded', id: preloadedId, data: 'preloaded' } });
      await worker.onmessage({ data: { type: 'error', id: errorId, error: 'boom' } });

      await expect(readyPromise).resolves.toBe('ready');
      await expect(preloadedPromise).resolves.toBe('preloaded');
      await expect(errorPromise).rejects.toThrow('boom');
    });
  });

  describe('_prepareFiles', () => {
    it('collects nested files, handles errors, and returns large content', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();

      const largeContent = 'x'.repeat(1024 * 1024);
      const entriesByPath = new Map();

      entriesByPath.set('/workspace', [
        { name: 'dir', kind: 'dir' },
        { name: 'dir2', kind: 'directory' },
        { name: 'file1.txt', kind: 'file' },
        { name: 'missing.txt', kind: 'file' },
        { name: 'bad.txt', kind: 'file' },
        { name: 'missingdir', kind: 'dir' },
        { name: 'baddir', kind: 'dir' },
        { name: 'deep', kind: 'dir' },
      ]);

      entriesByPath.set('/workspace/dir', [{ name: 'big.bin', kind: 'file' }]);
      entriesByPath.set('/workspace/dir2', [{ name: 'deepdir', kind: 'dir' }]);
      entriesByPath.set('/workspace/dir2/deepdir', [
        { name: 'deepfile.txt', kind: 'file' },
      ]);

      let deepPath = '/workspace/deep';
      for (let i = 0; i < 10; i++) {
        const name = `level${i}`;
        entriesByPath.set(deepPath, [{ name, kind: 'dir' }]);
        deepPath = `${deepPath}/${name}`;
      }
      entriesByPath.set(deepPath, [{ name: 'deep.txt', kind: 'file' }]);

      const vfs = {
        list: vi.fn(async (path) => {
          const key = String(path);
          if (key === '/workspace/missingdir') {
            const err = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
          }
          if (key === '/workspace/baddir') {
            throw new Error('list-failed');
          }
          const entries = entriesByPath.get(key);
          if (!entries) {
            const err = new Error('NotFoundError');
            err.code = 'ENOENT';
            throw err;
          }
          return entries;
        }),
        readFile: vi.fn(async (path) => {
          const key = String(path);
          if (key === '/workspace/missing.txt') {
            throw new Error('NotFoundError');
          }
          if (key === '/workspace/bad.txt') {
            throw new Error('read-failed');
          }
          if (key === '/workspace/dir/big.bin') return largeContent;
          if (key === '/workspace/dir2/deepdir/deepfile.txt') return 'deepfile';
          if (key === '/workspace/file1.txt') return 'file1';
          if (key.endsWith('deep.txt')) return 'deep';
          return 'other';
        }),
        writeFile: vi.fn(),
      };

      const files = await adapter._prepareFiles(vfs, ['/workspace', '', null]);

      const paths = files.map((file) => file.path);
      expect(paths).toEqual(
        expect.arrayContaining([
          '/workspace/file1.txt',
          '/workspace/dir/big.bin',
          '/workspace/dir2/deepdir/deepfile.txt',
          `${deepPath}/deep.txt`,
        ])
      );
      expect(files.find((file) => file.path === '/workspace/dir/big.bin').content).toBe(
        largeContent
      );
      expect(paths.includes('/workspace/missing.txt')).toBe(false);
      expect(paths.includes('/workspace/bad.txt')).toBe(false);

      const debugMessages = mockedLogger.logger.debug.mock.calls.map(([msg]) => msg);
      const warnMessages = mockedLogger.logger.warn.mock.calls.map(([msg]) => msg);

      expect(debugMessages.some((msg) => msg.includes('VFS path missing'))).toBe(true);
      expect(debugMessages.some((msg) => msg.includes('VFS file missing'))).toBe(true);
      expect(warnMessages.some((msg) => msg.includes('Failed to list VFS path'))).toBe(true);
      expect(warnMessages.some((msg) => msg.includes('Failed to read VFS file'))).toBe(true);
    });

    it('returns empty list for non-array, null, or empty paths', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();
      const vfs = {
        list: vi.fn(),
        readFile: vi.fn(),
        writeFile: vi.fn(),
      };

      expect(await adapter._prepareFiles(vfs, { nope: true })).toEqual([]);
      expect(await adapter._prepareFiles(vfs, null)).toEqual([]);
      expect(await adapter._prepareFiles(vfs, undefined)).toEqual([]);
      expect(await adapter._prepareFiles(vfs, [])).toEqual([]);
      expect(vfs.list).not.toHaveBeenCalled();
    });
  });

  describe('preload', () => {
    it('initializes and preloads dependencies', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();
      const initSpy = vi.spyOn(adapter, 'initialize').mockResolvedValue(undefined);
      const sendSpy = vi.spyOn(adapter, '_send').mockResolvedValue(undefined);
      const dependencies = ['0', '-1', String(Number.MAX_SAFE_INTEGER)];

      await adapter.preload(dependencies);

      expect(initSpy).toHaveBeenCalled();
      expect(sendSpy).toHaveBeenCalledWith('preload', {
        dependencies,
        indexUrl: adapter.indexUrl,
      });
    });

    it('skips preload for null, empty, or empty-string dependencies', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();
      const initSpy = vi.spyOn(adapter, 'initialize').mockResolvedValue(undefined);
      const sendSpy = vi.spyOn(adapter, '_send').mockResolvedValue(undefined);

      await adapter.preload(null);
      await adapter.preload([]);
      await adapter.preload(undefined);
      await adapter.preload('');

      expect(initSpy).toHaveBeenCalledTimes(4);
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });

  describe('preloadPlan', () => {
    it('skips preload when load plan has no work', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();
      const initSpy = vi.spyOn(adapter, 'initialize').mockResolvedValue(undefined);
      const sendSpy = vi.spyOn(adapter, '_send').mockResolvedValue(undefined);

      await adapter.preloadPlan(null);
      await adapter.preloadPlan({});
      await adapter.preloadPlan({ builtin: [], micropip: [], wheels: [] });

      expect(initSpy).toHaveBeenCalledTimes(3);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('sends preload plan when work exists', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();
      const initSpy = vi.spyOn(adapter, 'initialize').mockResolvedValue(undefined);
      const sendSpy = vi.spyOn(adapter, '_send').mockResolvedValue(undefined);
      const loadPlan = { builtin: ['stdlib'], micropip: [], wheels: [] };

      await adapter.preloadPlan(loadPlan);

      expect(initSpy).toHaveBeenCalled();
      expect(sendSpy).toHaveBeenCalledWith('preload', {
        loadPlan,
        indexUrl: adapter.indexUrl,
      });
    });
  });

  describe('execute', () => {
    it('uses vfs proxy when available and sends shared buffers', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      function FakeSharedArrayBuffer(length) {
        this.byteLength = length;
      }

      vi.stubGlobal('SharedArrayBuffer', FakeSharedArrayBuffer);

      const adapter = new PythonRuntimeAdapter({ watchPaths: ['/mnt/workspace', '/output'] });
      const sharedBuffer = new SharedArrayBuffer(16);
      const otherBuffer = new ArrayBuffer(8);
      const longCode = '0'.repeat(10_000);
      const vfs = { list: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() };

      adapter.vfsProxyHost = { setVfs: vi.fn() };

      vi.spyOn(adapter, 'initialize').mockResolvedValue(undefined);
      vi.spyOn(adapter, '_ensureVfsProxySharedBuffer').mockReturnValue(sharedBuffer);
      vi.spyOn(adapter, '_getVfsProxyAliases').mockReturnValue(['/mnt/workspace', '/output']);

      const prepareSpy = vi.spyOn(adapter, '_prepareFiles').mockResolvedValue([
        { path: '/workspace/a.py', content: 'print(1)' },
      ]);
      const sendSpy = vi.spyOn(adapter, '_send').mockResolvedValue({ ok: true });
      vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(250);

      const result = await adapter.execute(longCode, {
        vfs,
        state: { buf: sharedBuffer, other: otherBuffer, count: '0' },
      });

      expect(prepareSpy).not.toHaveBeenCalled();
      expect(adapter.vfsProxyHost.setVfs).toHaveBeenCalledWith(vfs);
      expect(sendSpy).toHaveBeenCalledWith(
        'execute',
        expect.objectContaining({
          code: longCode,
          state: { buf: sharedBuffer, other: otherBuffer, count: '0' },
          files: [],
          sharedBuffers: { buf: sharedBuffer },
          watchPaths: adapter.watchPaths,
          vfsProxy: {
            enabled: true,
            sharedBuffer,
            aliases: ['/mnt/workspace', '/output'],
          },
          indexUrl: adapter.indexUrl,
        }),
        vfs
      );
      expect(result).toEqual({
        success: true,
        data: { ok: true },
        metrics: { duration: 150 },
      });
    });

    it('falls back to snapshot mode when vfs proxy is unavailable', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();
      const vfs = { list: vi.fn(), readFile: vi.fn(), writeFile: vi.fn() };

      vi.spyOn(adapter, 'initialize').mockResolvedValue(undefined);
      vi.spyOn(adapter, '_ensureVfsProxySharedBuffer').mockReturnValue(null);
      const prepareSpy = vi.spyOn(adapter, '_prepareFiles').mockResolvedValue([
        { path: '/workspace/a.py', content: 'print(1)' },
      ]);
      const sendSpy = vi.spyOn(adapter, '_send').mockResolvedValue('done');
      vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(10);

      const result = await adapter.execute(0, { vfs, state: {} });

      expect(prepareSpy).toHaveBeenCalledWith(vfs, ['/workspace']);
      expect(sendSpy).toHaveBeenCalledWith(
        'execute',
        expect.objectContaining({
          code: 0,
          files: [{ path: '/workspace/a.py', content: 'print(1)' }],
          vfsProxy: { enabled: false },
        }),
        vfs
      );
      expect(result).toEqual({
        success: true,
        data: 'done',
        metrics: { duration: 10 },
      });
    });

    it('returns error when execution fails', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();

      vi.spyOn(adapter, 'initialize').mockResolvedValue(undefined);
      vi.spyOn(adapter, '_ensureVfsProxySharedBuffer').mockReturnValue(null);
      vi.spyOn(adapter, '_send').mockRejectedValue(new Error('boom'));
      vi.spyOn(Date, 'now').mockReturnValueOnce(200).mockReturnValueOnce(230);

      const result = await adapter.execute('', { vfs: null, state: null });

      expect(result).toEqual({
        success: false,
        error: 'boom',
        metrics: { duration: 30 },
      });
    });

    it('returns error for undefined context', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();

      vi.spyOn(adapter, 'initialize').mockResolvedValue(undefined);
      vi.spyOn(Date, 'now').mockReturnValueOnce(300).mockReturnValueOnce(320);

      const result = await adapter.execute('print(1)', undefined);

      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.metrics.duration).toBe(20);
    });
  });

  describe('terminate', () => {
    it('disposes vfs proxy host, terminates worker, and clears pending requests', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();
      const worker = { terminate: vi.fn() };
      const vfsProxyHost = { dispose: vi.fn() };

      adapter.worker = worker;
      adapter.vfsProxyHost = vfsProxyHost;
      adapter.pendingRequests.set(1, { resolve: vi.fn(), reject: vi.fn(), vfs: null });

      await adapter.terminate();

      expect(vfsProxyHost.dispose).toHaveBeenCalled();
      expect(worker.terminate).toHaveBeenCalled();
      expect(adapter.worker).toBeNull();
      expect(adapter.vfsProxyHost).toBeNull();
      expect(adapter.pendingRequests.size).toBe(0);
    });

    it('handles terminate with null worker and host', async () => {
      const { PythonRuntimeAdapter } = await loadModule();
      const adapter = new PythonRuntimeAdapter();

      await expect(adapter.terminate()).resolves.toBeUndefined();
      expect(adapter.worker).toBeNull();
      expect(adapter.vfsProxyHost).toBeNull();
    });
  });
});
