import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';

const mockedLogger = vi.hoisted(() => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    logger,
    createLogger: vi.fn(() => logger),
  };
});

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  createLogger: mockedLogger.createLogger,
}));

async function loadModule() {
  return await import('../../../../../js/agents/plugins/deps/dependency-manager.js');
}

function makeVfs(overrides = {}) {
  return {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    list: vi.fn(),
    stat: vi.fn(),
    deleteFile: vi.fn(),
    ...overrides,
  };
}

function makeResponse({ ok = true, status = 200, url = '', data = new Uint8Array() } = {}) {
  return {
    ok,
    status,
    url,
    arrayBuffer: vi.fn(async () => data.buffer),
  };
}

function toBytes(text) {
  return new TextEncoder().encode(text);
}

function makeDeepNested(depth = 20) {
  let node = 'leaf';
  for (let i = 0; i < depth; i++) {
    node = [node];
  }
  return node;
}

function safeJson(value) {
  try {
    return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  } catch {
    return 'null';
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  if (!globalThis.crypto) {
    globalThis.crypto = webcrypto;
  }
});

describe('parsePackageName', () => {
  it('parses version constraints and extras', async () => {
    const { parsePackageName } = await loadModule();

    expect(parsePackageName('NumPy>=1.20')).toBe('numpy');
    expect(parsePackageName('requests[socks]==2.31')).toBe('requests');
    expect(parsePackageName('pandas!=1.5')).toBe('pandas');
  });

  it('handles empty and whitespace-only strings', async () => {
    const { parsePackageName } = await loadModule();

    expect(parsePackageName('')).toBe('');
    expect(parsePackageName('   ')).toBe('');
  });

  it('handles numeric-looking names and throws on null/undefined', async () => {
    const { parsePackageName } = await loadModule();

    expect(parsePackageName('123<=2')).toBe('123');
    expect(() => parsePackageName(null)).toThrow();
    expect(() => parsePackageName(undefined)).toThrow();
    expect(() => parsePackageName(0)).toThrow();
  });
});

describe('sha256', () => {
  it('hashes ArrayBuffer and Uint8Array consistently', async () => {
    const { sha256 } = await loadModule();

    const data = toBytes('abc');
    const expected = createHash('sha256').update(data).digest('hex');

    await expect(sha256(data)).resolves.toBe(expected);
    await expect(sha256(data.buffer)).resolves.toBe(expected);
  });

  it('hashes empty input and large buffers', async () => {
    const { sha256 } = await loadModule();

    const empty = new Uint8Array();
    const emptyExpected = createHash('sha256').update(empty).digest('hex');
    await expect(sha256(empty)).resolves.toBe(emptyExpected);

    const large = new Uint8Array(1024 * 1024);
    large[0] = 1;
    large[large.length - 1] = 2;
    const largeExpected = createHash('sha256').update(large).digest('hex');
    await expect(sha256(large)).resolves.toBe(largeExpected);
  });

  it('rejects unsupported types', async () => {
    const { sha256 } = await loadModule();

    await expect(sha256('not-bytes')).rejects.toThrow();
    await expect(sha256({})).rejects.toThrow();
  });
});

describe('DependencyManager', () => {
  it('constructs with defaults and tracks loaded packages', async () => {
    const { DependencyManager } = await loadModule();
    const manager = new DependencyManager();

    expect(manager.vfs).toBeNull();
    expect(manager.cacheDir).toBe('/cache/pyodide-wheels');
    expect(manager.maxCacheBytes).toBe(500 * 1024 * 1024);

    expect(manager.isBuiltin('numpy>=1.0')).toBe(true);
    expect(manager.isBuiltin('notapkg')).toBe(false);

    manager.markLoaded([]);
    for (let i = 0; i < 3; i++) {
      manager.markLoaded(['NumPy>=1.0', 'pandas']);
    }

    expect(manager.isLoaded('numpy')).toBe(true);
    expect(manager.isLoaded('numpy==1.0')).toBe(true);
    expect(manager.isLoaded('pandas')).toBe(true);
  });

  it('resolve builds plan, skips loaded, and falls back for non-builtin', async () => {
    const { DependencyManager } = await loadModule();
    const manager = new DependencyManager();

    const cachedWheel = { url: 'https://files.pythonhosted.org/a.whl', cached: true, localPath: '/cache/a.whl' };
    vi.spyOn(manager, '_getCachedWheel').mockResolvedValue(cachedWheel);

    manager.markLoaded(['pandas']);

    const plan = await manager.resolve({
      builtin: ['numpy>=1.0', 'notabuiltin', 'PANDAS'],
      micropip: ['pandas==2.0', 'requests>=2.0'],
      wheels: [{ url: 'https://files.pythonhosted.org/a.whl' }],
    });

    expect(plan.builtin).toEqual(['numpy']);
    expect(plan.micropip).toEqual(['notabuiltin', 'requests>=2.0']);
    expect(plan.wheels).toEqual([cachedWheel]);
    expect(mockedLogger.logger.warn).toHaveBeenCalled();
  });

  it('resolve handles empty deps and rejects invalid inputs', async () => {
    const { DependencyManager } = await loadModule();
    const manager = new DependencyManager();

    await expect(manager.resolve({ builtin: [], micropip: [], wheels: [] })).resolves.toEqual({
      builtin: [],
      micropip: [],
      wheels: [],
    });

    await expect(manager.resolve({})).resolves.toEqual({ builtin: [], micropip: [], wheels: [] });
    await expect(manager.resolve(null)).rejects.toThrow();
    await expect(manager.resolve({ builtin: {}, micropip: [], wheels: [] })).rejects.toThrow();
  });

  it('getCachedWheel returns cached entry with sha validation and sanitized filename', async () => {
    const { DependencyManager } = await loadModule();
    const data = toBytes('wheel-bytes');
    const hash = createHash('sha256').update(data).digest('hex');
    const vfs = makeVfs({ readFile: vi.fn().mockResolvedValue(data) });
    const manager = new DependencyManager({ vfs });

    const wheel = {
      url: 'https://files.pythonhosted.org/packages/my%20wheel.whl?token=1#hash',
      sha256: hash,
    };

    const result = await manager._getCachedWheel(wheel);

    expect(vfs.readFile).toHaveBeenCalledWith(`${manager.cacheDir}/my_20wheel.whl`);
    expect(result).toEqual({ ...wheel, localPath: `${manager.cacheDir}/my_20wheel.whl`, cached: true });
  });

  it('getCachedWheel returns null on sha mismatch or read failure', async () => {
    const { DependencyManager } = await loadModule();
    const data = toBytes('wheel-bytes');
    const vfs = makeVfs({ readFile: vi.fn().mockResolvedValue(data) });
    const manager = new DependencyManager({ vfs });

    const bad = await manager._getCachedWheel({
      url: 'https://files.pythonhosted.org/packages/bad.whl',
      sha256: 'deadbeef',
    });

    expect(bad).toBeNull();
    expect(mockedLogger.logger.warn).toHaveBeenCalled();

    vfs.readFile.mockRejectedValueOnce(new Error('boom'));
    const missing = await manager._getCachedWheel({ url: 'https://files.pythonhosted.org/packages/miss.whl' });
    expect(missing).toBeNull();
    expect(mockedLogger.logger.debug).toHaveBeenCalled();
  });

  it('ensureCacheDir creates directory and ignores EEXIST', async () => {
    const { DependencyManager } = await loadModule();
    const vfs = makeVfs({ mkdir: vi.fn().mockRejectedValue({ code: 'EEXIST' }) });
    const manager = new DependencyManager({ vfs });

    await manager._ensureCacheDir();

    expect(vfs.mkdir).toHaveBeenCalledWith(manager.cacheDir, { recursive: true });
    expect(mockedLogger.logger.debug).not.toHaveBeenCalled();
  });

  it('ensureCacheDir logs debug when mkdir fails', async () => {
    const { DependencyManager } = await loadModule();
    const vfs = makeVfs({ mkdir: vi.fn().mockRejectedValue(new Error('fail')) });
    const manager = new DependencyManager({ vfs });

    await manager._ensureCacheDir();

    expect(mockedLogger.logger.debug).toHaveBeenCalled();
  });

  it('cacheWheel returns original wheel when no vfs', async () => {
    const { DependencyManager } = await loadModule();
    globalThis.fetch = vi.fn();

    const manager = new DependencyManager();
    const wheel = { url: 'https://files.pythonhosted.org/a.whl' };

    const result = await manager.cacheWheel(wheel);

    expect(result).toBe(wheel);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('cacheWheel rejects insecure protocol and untrusted hosts', async () => {
    const { DependencyManager } = await loadModule();
    const manager = new DependencyManager({ vfs: makeVfs() });

    await expect(manager.cacheWheel({ url: 'http://files.pythonhosted.org/a.whl' })).rejects.toThrow('Insecure protocol');
    await expect(manager.cacheWheel({ url: 'https://evil.example/a.whl' })).rejects.toThrow('Untrusted wheel host');
    expect(mockedLogger.logger.error).toHaveBeenCalled();
  });

  it('cacheWheel rejects redirects to untrusted hosts', async () => {
    const { DependencyManager } = await loadModule();
    const manager = new DependencyManager({ vfs: makeVfs() });

    globalThis.fetch = vi.fn().mockResolvedValue(
      makeResponse({
        ok: true,
        url: 'https://evil.example/a.whl',
        data: toBytes('x'),
      }),
    );

    await expect(manager.cacheWheel({ url: 'https://files.pythonhosted.org/a.whl' })).rejects.toThrow('Untrusted wheel host');
  });

  it('cacheWheel returns original wheel on fetch failure', async () => {
    const { DependencyManager } = await loadModule();
    const manager = new DependencyManager({ vfs: makeVfs() });

    globalThis.fetch = vi.fn().mockResolvedValue(makeResponse({ ok: false, status: 500 }));

    const wheel = { url: 'https://files.pythonhosted.org/a.whl' };
    const result = await manager.cacheWheel(wheel);

    expect(result).toBe(wheel);
    expect(mockedLogger.logger.warn).toHaveBeenCalled();
  });

  it('cacheWheel throws on sha mismatch', async () => {
    const { DependencyManager } = await loadModule();
    const manager = new DependencyManager({ vfs: makeVfs() });

    globalThis.fetch = vi.fn().mockResolvedValue(makeResponse({ ok: true, data: toBytes('abc') }));

    await expect(
      manager.cacheWheel({ url: 'https://files.pythonhosted.org/a.whl', sha256: 'deadbeef' }),
    ).rejects.toThrow('SHA256 mismatch');
    expect(mockedLogger.logger.error).toHaveBeenCalled();
  });

  it('cacheWheel caches large wheels and truncates long filenames', async () => {
    const { DependencyManager } = await loadModule();
    const vfs = makeVfs({
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    });
    const manager = new DependencyManager({ vfs });

    const data = new Uint8Array(1024 * 1024);
    data[0] = 1;
    data[data.length - 1] = 2;
    const hash = createHash('sha256').update(data).digest('hex');
    const longName = `${'a'.repeat(250)}.whl`;
    const wheel = {
      url: `https://files.pythonhosted.org/packages/${longName}?token=abc`,
      sha256: hash,
    };

    globalThis.fetch = vi.fn().mockResolvedValue(
      makeResponse({
        ok: true,
        url: wheel.url,
        data,
      }),
    );

    const result = await manager.cacheWheel(wheel);

    expect(result.cached).toBe(true);
    expect(result.localPath).toMatch(`${manager.cacheDir}/`);

    const writtenPath = vfs.writeFile.mock.calls[0][0];
    const filename = writtenPath.split('/').pop();
    expect(filename.length).toBe(200);
    expect(vfs.writeFile.mock.calls[0][1]).toHaveLength(data.length);
    expect(mockedLogger.logger.info).toHaveBeenCalled();
  });

  it('cacheWheel returns original wheel when cache write fails', async () => {
    const { DependencyManager } = await loadModule();
    const vfs = makeVfs({
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockRejectedValue(new Error('disk full')),
    });
    const manager = new DependencyManager({ vfs });

    globalThis.fetch = vi.fn().mockResolvedValue(makeResponse({ ok: true, data: toBytes('data') }));

    const wheel = { url: 'https://files.pythonhosted.org/a.whl' };
    const result = await manager.cacheWheel(wheel);

    expect(result).toBe(wheel);
    expect(mockedLogger.logger.warn).toHaveBeenCalled();
  });

  it('cacheWheel supports concurrent calls', async () => {
    const { DependencyManager } = await loadModule();
    const vfs = makeVfs({
      mkdir: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    });
    const manager = new DependencyManager({ vfs });

    const deferred = [];
    globalThis.fetch = vi.fn().mockImplementation(() => new Promise((resolve) => deferred.push(resolve)));

    const wheelA = { url: 'https://files.pythonhosted.org/a.whl' };
    const wheelB = { url: 'https://files.pythonhosted.org/b.whl' };

    const promiseA = manager.cacheWheel(wheelA);
    const promiseB = manager.cacheWheel(wheelB);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    deferred[0](makeResponse({ ok: true, data: toBytes('a') }));
    deferred[1](makeResponse({ ok: true, data: toBytes('b') }));

    const [resultA, resultB] = await Promise.all([promiseA, promiseB]);

    expect(resultA.cached).toBe(true);
    expect(resultB.cached).toBe(true);
  });

  it('generateLoadScript builds script with cached wheels and filters invalid entries', async () => {
    const { DependencyManager } = await loadModule();
    const manager = new DependencyManager();

    const script = manager.generateLoadScript({
      builtin: ['numpy', null, ''],
      micropip: ['requests>=2.0', '', null],
      wheels: [
        { url: 'https://files.pythonhosted.org/a.whl' },
        { cached: true, localPath: '/cache/a.whl' },
        { url: '' },
        null,
      ],
    });

    expect(script).toContain('const __pb_builtin');
    expect(script).toContain('numpy');
    expect(script).toContain('emfs:/cache/a.whl');
    expect(script).toContain("pyodide.loadPackage('micropip')");
    expect(script).toContain('micropip.install');
  });

  it('generateLoadScript handles null plan and invalid shapes safely', async () => {
    const { DependencyManager } = await loadModule();
    const manager = new DependencyManager();

    const script = manager.generateLoadScript({
      builtin: [BigInt(1)],
      micropip: 'numpy',
      wheels: { url: 'https://files.pythonhosted.org/a.whl' },
    });

    expect(script).toContain('const __pb_builtin = null;');
    expect(script).toContain('const __pb_micropip = [];');
    expect(script).toContain('const __pb_wheels = [];');

    const fallback = manager.generateLoadScript(null);
    expect(fallback).toContain('const __pb_builtin = []');
    expect(fallback).toContain('const __pb_micropip = []');
    expect(fallback).toContain('const __pb_wheels = []');
  });

  it('generateLoadScript supports deep nested structures', async () => {
    const { DependencyManager } = await loadModule();
    const manager = new DependencyManager();

    const nested = makeDeepNested(30);
    const expected = safeJson([nested]);
    const script = manager.generateLoadScript({ builtin: [nested], micropip: [], wheels: [] });

    expect(script).toContain(`const __pb_builtin = ${expected};`);
  });

  it('cleanupCache evicts oldest files when over limit', async () => {
    const { DependencyManager } = await loadModule();
    const vfs = makeVfs({
      list: vi.fn().mockResolvedValue([
        { kind: 'file', name: 'old.whl' },
        { kind: 'file', name: 'new.whl' },
      ]),
      stat: vi
        .fn()
        .mockResolvedValueOnce({ size: 5, mtimeMs: 1 })
        .mockResolvedValueOnce({ size: 10, mtimeMs: 2 }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    });
    const manager = new DependencyManager({ vfs });

    await manager.cleanupCache('0');

    expect(vfs.deleteFile).toHaveBeenCalledTimes(2);
    expect(vfs.deleteFile).toHaveBeenNthCalledWith(1, `${manager.cacheDir}/old.whl`);
  });

  it('cleanupCache evicts on negative maxBytes and ignores stat failures', async () => {
    const { DependencyManager } = await loadModule();
    const vfs = makeVfs({
      list: vi.fn().mockResolvedValue([
        { kind: 'file', name: 'bad.whl' },
        { kind: 'file', name: 'ok.whl' },
      ]),
      stat: vi
        .fn()
        .mockRejectedValueOnce(new Error('stat fail'))
        .mockResolvedValueOnce({ size: 2, mtime: 10 }),
      deleteFile: vi.fn().mockResolvedValue(undefined),
    });
    const manager = new DependencyManager({ vfs });

    await manager.cleanupCache(-1);

    expect(vfs.deleteFile).toHaveBeenCalledWith(`${manager.cacheDir}/ok.whl`);
  });

  it('cleanupCache skips cleanup when under MAX_SAFE_INTEGER', async () => {
    const { DependencyManager } = await loadModule();
    const vfs = makeVfs({
      list: vi.fn().mockResolvedValue([{ kind: 'file', name: 'keep.whl' }]),
      stat: vi.fn().mockResolvedValue({ size: 1, mtimeMs: 5 }),
      deleteFile: vi.fn(),
    });
    const manager = new DependencyManager({ vfs });

    await manager.cleanupCache(Number.MAX_SAFE_INTEGER);

    expect(vfs.deleteFile).not.toHaveBeenCalled();
  });

  it('cleanupCache logs warning when list fails', async () => {
    const { DependencyManager } = await loadModule();
    const vfs = makeVfs({ list: vi.fn().mockRejectedValue(new Error('boom')) });
    const manager = new DependencyManager({ vfs });

    await manager.cleanupCache();

    expect(mockedLogger.logger.warn).toHaveBeenCalled();
  });

  it('getCacheStats returns unavailable without vfs', async () => {
    const { DependencyManager } = await loadModule();
    const manager = new DependencyManager();

    const stats = await manager.getCacheStats();

    expect(stats).toEqual({ available: false, totalSize: 0, fileCount: 0 });
  });

  it('getCacheStats computes totals and handles list failure', async () => {
    const { DependencyManager } = await loadModule();
    const vfs = makeVfs({
      list: vi.fn().mockResolvedValue([
        { kind: 'file', name: 'a.whl' },
        { kind: 'dir', name: 'nested' },
        { kind: 'file', name: 'b.whl' },
      ]),
      stat: vi.fn().mockResolvedValueOnce({ size: 3 }).mockResolvedValueOnce({ size: 7 }),
    });
    const manager = new DependencyManager({ vfs, maxCacheBytes: 123 });

    const stats = await manager.getCacheStats();

    expect(stats).toEqual({ available: true, totalSize: 10, fileCount: 2, maxBytes: 123 });

    vfs.list.mockRejectedValueOnce(new Error('fail'));
    const fallback = await manager.getCacheStats();
    expect(fallback).toEqual({ available: false, totalSize: 0, fileCount: 0 });
  });
});
