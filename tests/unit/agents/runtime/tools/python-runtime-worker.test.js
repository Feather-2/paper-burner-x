import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const MODULE_PATH = '../../../../../js/agents/runtime/tools/python-runtime-worker.js';
const LOGGER_MODULE_PATH = '../../../../../js/agents/shared/index.js';
const VFS_PROXY_MODULE_PATH = '../../../../../js/agents/runtime/core/vfs-proxy-client.js';

const PYODIDE_SRI = 'fyTGZVp56s8AYdPU5qYNwLGTiBLRXFLX/4s32eBonlE=';
const PYODIDE_CDN_BASE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

const ORIGINAL_URL_CREATE = URL.createObjectURL;
const ORIGINAL_URL_REVOKE = URL.revokeObjectURL;

const makeGlobalsStore = () => {
  const store = new Map();
  return {
    store,
    set: vi.fn((key, value) => {
      store.set(key, value);
    }),
    delete: vi.fn((key) => {
      store.delete(key);
    }),
  };
};

const makePyodideMock = (overrides = {}) => {
  const globals = makeGlobalsStore();
  const toPy = vi.fn((value) => ({ __value: value, destroy: vi.fn() }));
  const defaultFs = {
    mkdirTree: vi.fn(),
    writeFile: vi.fn(),
    readdir: vi.fn(() => ['.', '..']),
    stat: vi.fn(() => ({ mode: 0 })),
    isDir: vi.fn(() => false),
    isFile: vi.fn(() => false),
    readFile: vi.fn(() => new Uint8Array(0)),
    mount: vi.fn(),
    mkdir: vi.fn(),
    symlink: vi.fn(),
    createNode: vi.fn(() => ({ id: 1, path: '/' })),
    ERRNO_CODES: {},
    ErrnoError: function ErrnoError(errno) {
      this.errno = errno;
    },
  };
  const FS = { ...defaultFs, ...(overrides.FS || {}) };
  return {
    FS,
    globals,
    toPy,
    loadPackage: vi.fn(),
    runPythonAsync: vi.fn(async () => null),
    ...overrides,
  };
};

const setupWorker = async ({
  pyodideMock,
  vfsProxyConfig = {},
  selfLocation,
  cryptoAvailable = true,
  fetchOk = true,
} = {}) => {
  vi.resetModules();
  vi.clearAllMocks();

  const postMessages = [];
  const self = {
    location: selfLocation || {
      origin: 'https://example.com',
      href: 'https://example.com/worker.js',
    },
    postMessage: vi.fn((msg) => {
      postMessages.push(msg);
    }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('self', self);

  if (typeof SharedArrayBuffer === 'undefined') {
    vi.stubGlobal('SharedArrayBuffer', class SharedArrayBufferMock {
      constructor(byteLength) {
        this.byteLength = byteLength;
      }
    });
  }

  const logger = {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  globalThis.__loggerMock__ = logger;
  globalThis.__vfsProxyConfig__ = vfsProxyConfig;
  globalThis.__vfsProxyInstances__ = [];

  vi.doMock(LOGGER_MODULE_PATH, () => ({
    createLogger: vi.fn(() => logger),
  }));

  vi.doMock(VFS_PROXY_MODULE_PATH, () => ({
    VfsProxyClient: class VfsProxyClientMock {
      constructor(options = {}) {
        const cfg = globalThis.__vfsProxyConfig__ || {};
        this.options = options;
        this.supportsSync = cfg.supportsSync ?? false;
        this.statSync = cfg.statSync ?? vi.fn();
        this.listSync = cfg.listSync ?? vi.fn();
        this.readFileSync = cfg.readFileSync ?? vi.fn();
        this.writeFileSync = cfg.writeFileSync ?? vi.fn();
        this.mkdirSync = cfg.mkdirSync ?? vi.fn();
        this.deleteSync = cfg.deleteSync ?? vi.fn();
        globalThis.__vfsProxyInstances__.push(this);
      }
    },
  }));

  const moduleCode = `export async function loadPyodide(options) {
    if (globalThis.__loadPyodideSpy__) globalThis.__loadPyodideSpy__(options);
    return globalThis.__pyodideMock__;
  }`;
  const moduleBytes = Buffer.from(moduleCode, 'utf8');
  const moduleArrayBuffer = moduleBytes.buffer.slice(
    moduleBytes.byteOffset,
    moduleBytes.byteOffset + moduleBytes.byteLength,
  );
  const dataUrl = `data:text/javascript;base64,${moduleBytes.toString('base64')}`;

  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: fetchOk,
    status: fetchOk ? 200 : 500,
    arrayBuffer: async () => moduleArrayBuffer,
  })));

  if (cryptoAvailable) {
    const expectedDigest = Buffer.from(PYODIDE_SRI, 'base64');
    const expectedBuffer = expectedDigest.buffer.slice(
      expectedDigest.byteOffset,
      expectedDigest.byteOffset + expectedDigest.byteLength,
    );
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn(async () => expectedBuffer),
      },
    });
  } else {
    vi.stubGlobal('crypto', undefined);
  }

  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => dataUrl),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  });

  globalThis.__pyodideMock__ = pyodideMock || makePyodideMock();
  globalThis.__loadPyodideSpy__ = vi.fn();

  await import(MODULE_PATH);

  return {
    self,
    postMessages,
    pyodide: globalThis.__pyodideMock__,
    loadPyodideSpy: globalThis.__loadPyodideSpy__,
    vfsProxyInstances: globalThis.__vfsProxyInstances__,
    logger,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete globalThis.__loggerMock__;
  delete globalThis.__pyodideMock__;
  delete globalThis.__loadPyodideSpy__;
  delete globalThis.__vfsProxyConfig__;
  delete globalThis.__vfsProxyInstances__;

  if (ORIGINAL_URL_CREATE) {
    URL.createObjectURL = ORIGINAL_URL_CREATE;
  } else {
    delete URL.createObjectURL;
  }
  if (ORIGINAL_URL_REVOKE) {
    URL.revokeObjectURL = ORIGINAL_URL_REVOKE;
  } else {
    delete URL.revokeObjectURL;
  }
});

describe('python-runtime-worker', () => {
  describe('init message', () => {
    it('loads pyodide with a trailing-slash indexUrl and posts ready', async () => {
      const pyodide = makePyodideMock();
      const { self, postMessages, loadPyodideSpy, vfsProxyInstances } = await setupWorker({
        pyodideMock: pyodide,
      });

      await self.onmessage({
        data: {
          type: 'init',
          id: 1,
          payload: {
            indexUrl: 'https://example.com/pyodide',
            vfsProxy: { enabled: false },
          },
        },
      });

      expect(loadPyodideSpy).toHaveBeenCalledTimes(1);
      const options = loadPyodideSpy.mock.calls[0][0];
      expect(options.indexURL).toBe('https://example.com/pyodide/');

      options.stdout('hello');
      options.stderr('oops');

      expect(postMessages).toContainEqual({ type: 'ready', id: 1 });
      expect(postMessages).toContainEqual({ type: 'stdout', text: 'hello' });
      expect(postMessages).toContainEqual({ type: 'stderr', text: 'oops' });
      expect(vfsProxyInstances.length).toBe(1);
    });

    it('rejects disallowed indexUrl origins', async () => {
      const { self, postMessages, loadPyodideSpy } = await setupWorker();

      await self.onmessage({
        data: {
          type: 'init',
          id: 'bad-origin',
          payload: { indexUrl: 'https://evil.example.com/pyodide/' },
        },
      });

      expect(loadPyodideSpy).not.toHaveBeenCalled();
      expect(postMessages).toContainEqual({
        type: 'error',
        id: 'bad-origin',
        error: 'URL origin not allowed',
      });
    });
  });

  describe('preload message', () => {
    it('normalizes loadPlan entries and installs builtin + micropip + wheels', async () => {
      const pyodide = makePyodideMock({
        runPythonAsync: vi.fn(async () => 'ok'),
      });
      const { self, postMessages } = await setupWorker({ pyodideMock: pyodide });

      await self.onmessage({
        data: {
          type: 'preload',
          id: 2,
          payload: {
            loadPlan: {
              builtin: [0, -1, Number.MAX_SAFE_INTEGER, ' numpy ', '', '   '],
              micropip: 'requests',
              wheels: [
                { cached: true, localPath: 'cache/wheel-1.whl' },
                { url: `${PYODIDE_CDN_BASE_URL}wheels/pkg.whl` },
                { url: 'emfs:/custom/pkg.whl' },
                { url: 42 },
              ],
            },
          },
        },
      });

      expect(pyodide.loadPackage).toHaveBeenCalledTimes(2);
      expect(pyodide.loadPackage.mock.calls[0][0]).toEqual([
        '0',
        '-1',
        String(Number.MAX_SAFE_INTEGER),
        'numpy',
      ]);
      expect(pyodide.loadPackage.mock.calls[1][0]).toBe('micropip');

      const depsCall = pyodide.globals.set.mock.calls.find((call) => call[0] === '__pb_micropip_deps__');
      const wheelsCall = pyodide.globals.set.mock.calls.find((call) => call[0] === '__pb_micropip_wheels__');

      expect(depsCall).toBeTruthy();
      expect(wheelsCall).toBeTruthy();

      const depsProxy = depsCall[1];
      const wheelsProxy = wheelsCall[1];

      expect(depsProxy.__value).toEqual(['requests']);
      expect(wheelsProxy.__value).toEqual([
        'emfs:cache/wheel-1.whl',
        `${PYODIDE_CDN_BASE_URL}wheels/pkg.whl`,
        'emfs:/custom/pkg.whl',
      ]);

      expect(pyodide.runPythonAsync).toHaveBeenCalled();
      expect(pyodide.globals.delete).toHaveBeenCalledWith('__pb_micropip_deps__');
      expect(pyodide.globals.delete).toHaveBeenCalledWith('__pb_micropip_wheels__');
      expect(depsProxy.destroy).toHaveBeenCalled();
      expect(wheelsProxy.destroy).toHaveBeenCalled();
      expect(postMessages).toContainEqual({ type: 'preloaded', id: 2 });
    });

    it('accepts empty loadPlan object and legacy dependencies string', async () => {
      const pyodide = makePyodideMock();
      const { self, postMessages } = await setupWorker({ pyodideMock: pyodide });

      await self.onmessage({
        data: {
          type: 'preload',
          id: 3,
          payload: {
            loadPlan: {},
            dependencies: '123',
          },
        },
      });

      expect(pyodide.loadPackage).toHaveBeenCalledTimes(1);
      expect(pyodide.loadPackage).toHaveBeenCalledWith('123');
      expect(pyodide.runPythonAsync).not.toHaveBeenCalled();
      expect(postMessages).toContainEqual({ type: 'preloaded', id: 3 });
    });

    it('skips empty arrays in loadPlan without triggering micropip', async () => {
      const pyodide = makePyodideMock();
      const { self, postMessages } = await setupWorker({ pyodideMock: pyodide });

      await self.onmessage({
        data: {
          type: 'preload',
          id: 4,
          payload: {
            loadPlan: {
              builtin: [],
              micropip: [],
              wheels: [],
            },
            dependencies: [],
          },
        },
      });

      expect(pyodide.loadPackage).not.toHaveBeenCalled();
      expect(pyodide.runPythonAsync).not.toHaveBeenCalled();
      expect(postMessages).toContainEqual({ type: 'preloaded', id: 4 });
    });

    it('rejects legacy loadScript preloads', async () => {
      const { self, postMessages } = await setupWorker();

      await self.onmessage({
        data: {
          type: 'preload',
          id: 5,
          payload: {
            loadScript: 'print("hi")',
          },
        },
      });

      expect(postMessages).toContainEqual({
        type: 'error',
        id: 5,
        error: 'Legacy loadScript preload is disabled; use loadPlan instead',
      });
    });
  });

  describe('execute message', () => {
    it('syncs input files, injects state/buffers, and collects output files', async () => {
      const MODE_DIR = 0o040000;
      const MODE_FILE = 0o100000;
      const fsMock = {
        mkdirTree: vi.fn(),
        writeFile: vi.fn(),
        readdir: vi.fn((path) => {
          if (path === '/out') return ['.', '..', 'result.txt', 'sub'];
          if (path === '/out/sub') return ['.', '..', 'nested.bin'];
          throw new Error('ENOENT');
        }),
        stat: vi.fn((path) => {
          if (path === '/out' || path === '/out/sub') return { mode: MODE_DIR };
          if (path === '/out/result.txt' || path === '/out/sub/nested.bin') return { mode: MODE_FILE };
          throw new Error('ENOENT');
        }),
        isDir: vi.fn((mode) => mode === MODE_DIR),
        readFile: vi.fn((path) => {
          if (path === '/out/result.txt') return new Uint8Array([1, 2, 3]);
          if (path === '/out/sub/nested.bin') return new Uint8Array([4, 5]);
          return new Uint8Array(0);
        }),
      };

      const pyodide = makePyodideMock({
        FS: fsMock,
        runPythonAsync: vi.fn(async (code) => `ok:${code.length}`),
      });
      const { self, postMessages } = await setupWorker({ pyodideMock: pyodide });

      const bigContent = new Uint8Array(1024 * 1024).fill(7);
      const deepState = { level: 0 };
      let cursor = deepState;
      for (let i = 1; i < 40; i += 1) {
        cursor.next = { level: i };
        cursor = cursor.next;
      }

      const sharedBuffer = new SharedArrayBuffer(16);
      const longCode = 'x'.repeat(100000);

      await self.onmessage({
        data: {
          type: 'execute',
          id: 6,
          payload: {
            code: longCode,
            files: [
              { path: '/input/data.bin', content: bigContent },
              { path: '/deep/a/b/c/file.txt', content: new Uint8Array([9]) },
            ],
            watchPaths: ['/out'],
            state: deepState,
            sharedBuffers: { buf: sharedBuffer },
          },
        },
      });

      expect(fsMock.mkdirTree).toHaveBeenCalledWith('/input');
      expect(fsMock.mkdirTree).toHaveBeenCalledWith('/deep/a/b/c');
      expect(fsMock.writeFile).toHaveBeenCalledWith('/input/data.bin', bigContent);
      expect(fsMock.writeFile).toHaveBeenCalledWith('/deep/a/b/c/file.txt', new Uint8Array([9]));

      expect(pyodide.globals.set).toHaveBeenCalledWith('__context_state__', expect.any(Object));
      expect(pyodide.globals.set).toHaveBeenCalledWith('buf', expect.any(Object));
      expect(pyodide.runPythonAsync).toHaveBeenCalledWith(longCode);

      const resultMsg = postMessages.find((msg) => msg.type === 'result' && msg.id === 6);
      expect(resultMsg).toBeTruthy();
      expect(resultMsg.data).toBe(`ok:${longCode.length}`);
      expect(Array.isArray(resultMsg.files)).toBe(true);
      expect(resultMsg.files.map((file) => file.path)).toEqual([
        '/out/result.txt',
        '/out/sub/nested.bin',
      ]);
    });

    it('skips file sync and collection when proxy VFS is mounted', async () => {
      const fsMock = {
        mkdirTree: vi.fn(),
        writeFile: vi.fn(),
        readdir: vi.fn(),
        mount: vi.fn(),
        mkdir: vi.fn(),
        symlink: vi.fn(),
      };

      const pyodide = makePyodideMock({
        FS: fsMock,
        runPythonAsync: vi.fn(async () => 'proxy-ok'),
      });

      const { self, postMessages } = await setupWorker({
        pyodideMock: pyodide,
        vfsProxyConfig: { supportsSync: true },
      });

      await self.onmessage({
        data: {
          type: 'execute',
          id: 7,
          payload: {
            code: 'print("proxy")',
            files: [{ path: '/input/ignored.txt', content: new Uint8Array([1]) }],
            watchPaths: ['/out'],
            vfsProxy: { enabled: true },
          },
        },
      });

      expect(fsMock.mount).toHaveBeenCalledTimes(1);
      expect(fsMock.writeFile).not.toHaveBeenCalled();
      expect(fsMock.readdir).not.toHaveBeenCalled();

      const resultMsg = postMessages.find((msg) => msg.type === 'result' && msg.id === 7);
      expect(resultMsg.files).toEqual([]);
      expect(resultMsg.data).toBe('proxy-ok');
    });

    it('returns error when files payload is a non-iterable object', async () => {
      const pyodide = makePyodideMock({
        runPythonAsync: vi.fn(async () => 'unused'),
      });
      const { self, postMessages } = await setupWorker({ pyodideMock: pyodide });

      await self.onmessage({
        data: {
          type: 'execute',
          id: 8,
          payload: {
            code: 'print("bad files")',
            files: {},
          },
        },
      });

      expect(pyodide.runPythonAsync).not.toHaveBeenCalled();
      expect(postMessages.some((msg) => msg.type === 'error' && msg.id === 8)).toBe(true);
    });

    it('handles simultaneous and rapid consecutive execute calls', async () => {
      const pyodide = makePyodideMock({
        runPythonAsync: vi.fn(async (code) => `result:${code}`),
      });
      const { self, postMessages } = await setupWorker({ pyodideMock: pyodide });

      await Promise.all([
        self.onmessage({
          data: {
            type: 'execute',
            id: 9,
            payload: { code: 'A' },
          },
        }),
        self.onmessage({
          data: {
            type: 'execute',
            id: 10,
            payload: { code: 'B' },
          },
        }),
      ]);

      await self.onmessage({
        data: {
          type: 'execute',
          id: 11,
          payload: { code: 'C' },
        },
      });
      await self.onmessage({
        data: {
          type: 'execute',
          id: 12,
          payload: { code: 'D' },
        },
      });

      const results = postMessages.filter((msg) => msg.type === 'result');
      const byId = new Map(results.map((msg) => [msg.id, msg.data]));

      expect(byId.get(9)).toBe('result:A');
      expect(byId.get(10)).toBe('result:B');
      expect(byId.get(11)).toBe('result:C');
      expect(byId.get(12)).toBe('result:D');
    });
  });
});
