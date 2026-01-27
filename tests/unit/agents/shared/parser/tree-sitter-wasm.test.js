import { describe, it, expect, vi, beforeEach } from 'vitest';

let wasmSupported = true;
let nodeLike = false;

const mockParser = { init: vi.fn() };
const mockLanguage = { load: vi.fn() };
let webTreeSitterFactory = () => ({ Parser: mockParser, Language: mockLanguage });

vi.mock('../../../../../js/agents/shared/utils/wasm-support.js', () => ({
  isWasmSupported: vi.fn(() => wasmSupported),
}));

vi.mock('../../../../../js/agents/shared/platform.js', () => ({
  isNodeLike: vi.fn(() => nodeLike),
}));

vi.mock('web-tree-sitter', () => webTreeSitterFactory());

function setGlobalProperty(name, value) {
  const hadOwn = Object.prototype.hasOwnProperty.call(globalThis, name);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  const originalValue = globalThis[name];

  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch {
    try {
      globalThis[name] = value;
    } catch {
      // ignore
    }
  }

  return () => {
    try {
      if (!hadOwn) {
        delete globalThis[name];
      } else if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        globalThis[name] = originalValue;
      }
    } catch {
      try {
        globalThis[name] = originalValue;
      } catch {
        // ignore
      }
    }
  };
}

function createDeferred() {
  /** @type {(value?: any) => void} */
  let resolve;
  /** @type {(reason?: any) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function importSubject() {
  return await import('../../../../../js/agents/shared/parser/tree-sitter-wasm.js');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  wasmSupported = true;
  nodeLike = false;

  mockParser.init = vi.fn().mockResolvedValue(undefined);
  mockLanguage.load = vi.fn().mockResolvedValue({ mock: true });

  webTreeSitterFactory = () => ({ Parser: mockParser, Language: mockLanguage });
});

describe('DEFAULT_TREE_SITTER_WASM_BASE_URL', () => {
  it('exports the expected default base URL', async () => {
    const mod = await importSubject();
    expect(mod.DEFAULT_TREE_SITTER_WASM_BASE_URL).toBe('wasm/tree-sitter/');
  });
});

describe('initTreeSitter', () => {
  it('returns null in node-like runtime', async () => {
    nodeLike = true;

    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const { initTreeSitter } = await importSubject();
      await expect(initTreeSitter()).resolves.toBeNull();

      const wasmSupport = await import('../../../../../js/agents/shared/utils/wasm-support.js');
      expect(wasmSupport.isWasmSupported).not.toHaveBeenCalled();
      expect(mockParser.init).not.toHaveBeenCalled();
    } finally {
      restoreFetch();
    }
  });

  it('returns null when fetch is unavailable', async () => {
    const restoreFetch = setGlobalProperty('fetch', undefined);
    try {
      const { initTreeSitter } = await importSubject();
      await expect(initTreeSitter()).resolves.toBeNull();

      const wasmSupport = await import('../../../../../js/agents/shared/utils/wasm-support.js');
      expect(wasmSupport.isWasmSupported).not.toHaveBeenCalled();
      expect(mockParser.init).not.toHaveBeenCalled();
    } finally {
      restoreFetch();
    }
  });

  it('throws when WebAssembly is unsupported in a web runtime', async () => {
    wasmSupported = false;

    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const { initTreeSitter } = await importSubject();
      await expect(initTreeSitter()).rejects.toThrow('Tree-sitter requires WebAssembly support');

      const wasmSupport = await import('../../../../../js/agents/shared/utils/wasm-support.js');
      expect(wasmSupport.isWasmSupported).toHaveBeenCalledTimes(1);
      expect(mockParser.init).not.toHaveBeenCalled();
    } finally {
      restoreFetch();
    }
  });

  it('rejects with TypeError when options is null', async () => {
    const { initTreeSitter } = await importSubject();
    await expect(initTreeSitter(null)).rejects.toBeInstanceOf(TypeError);
  });

  it('initializes successfully and wires locateFile using an absolute base URL', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      let locateFile;
      mockParser.init.mockImplementation(async (opts) => {
        locateFile = opts?.locateFile;
      });

      const { initTreeSitter } = await importSubject();
      const env = await initTreeSitter({ wasmBaseUrl: 'https://example.com/wasm/tree-sitter' });

      expect(env).toEqual(
        expect.objectContaining({
          Parser: mockParser,
          Language: mockLanguage,
          wasmBaseUrl: 'https://example.com/wasm/tree-sitter/',
        }),
      );

      expect(mockParser.init).toHaveBeenCalledTimes(1);
      expect(locateFile).toEqual(expect.any(Function));
      expect(locateFile('tree-sitter.wasm')).toBe('https://example.com/wasm/tree-sitter/tree-sitter.wasm');
    } finally {
      restoreFetch();
    }
  });

  it('returns the cached initialized module on repeated calls', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const { initTreeSitter } = await importSubject();

      const first = await initTreeSitter({ wasmBaseUrl: 'https://cdn.example.com/ts/' });
      const second = await initTreeSitter({ wasmBaseUrl: 'https://other.example.com/ts/' });

      expect(second).toBe(first);
      expect(first.wasmBaseUrl).toBe('https://cdn.example.com/ts/');
      expect(mockParser.init).toHaveBeenCalledTimes(1);
    } finally {
      restoreFetch();
    }
  });

  it('coalesces concurrent calls and only initializes once', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const deferred = createDeferred();
      mockParser.init.mockImplementation(() => deferred.promise);

      const { initTreeSitter } = await importSubject();
      const p1 = initTreeSitter({ wasmBaseUrl: 'https://cdn.example.com/ts/' });
      const p2 = initTreeSitter({ wasmBaseUrl: 'https://cdn.example.com/ts/' });

      deferred.resolve();

      const [env1, env2] = await Promise.all([p1, p2]);
      expect(env2).toBe(env1);
      expect(mockParser.init).toHaveBeenCalledTimes(1);
    } finally {
      restoreFetch();
    }
  });

  it('clears the cached init promise on failure so it can retry', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const { initTreeSitter } = await importSubject();

      mockParser.init.mockRejectedValueOnce(new Error('boom'));
      await expect(initTreeSitter({ wasmBaseUrl: 'https://cdn.example.com/ts/' })).rejects.toThrow('boom');

      mockParser.init.mockResolvedValueOnce(undefined);
      await expect(initTreeSitter({ wasmBaseUrl: 'https://cdn.example.com/ts/' })).resolves.toEqual(
        expect.objectContaining({ wasmBaseUrl: 'https://cdn.example.com/ts/' }),
      );

      expect(mockParser.init).toHaveBeenCalledTimes(2);
    } finally {
      restoreFetch();
    }
  });

  it('throws a clear error if web-tree-sitter Parser.init is unavailable', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      webTreeSitterFactory = () => ({ Parser: {}, Language: mockLanguage });

      const { initTreeSitter } = await importSubject();
      await expect(initTreeSitter({ wasmBaseUrl: 'https://cdn.example.com/ts/' })).rejects.toThrow(
        'web-tree-sitter Parser.init unavailable',
      );
    } finally {
      restoreFetch();
    }
  });

  it('throws a clear error if web-tree-sitter Language.load is unavailable', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      webTreeSitterFactory = () => ({ Parser: mockParser, Language: {} });

      const { initTreeSitter } = await importSubject();
      await expect(initTreeSitter({ wasmBaseUrl: 'https://cdn.example.com/ts/' })).rejects.toThrow(
        'web-tree-sitter Language.load unavailable',
      );
    } finally {
      restoreFetch();
    }
  });

  it('supports web-tree-sitter default export shape { default: { Parser, Language } }', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      webTreeSitterFactory = () => ({ default: { Parser: mockParser, Language: mockLanguage } });

      const { initTreeSitter } = await importSubject();
      const env = await initTreeSitter({ wasmBaseUrl: 'https://cdn.example.com/ts/' });

      expect(env.Parser).toBe(mockParser);
      expect(env.Language).toBe(mockLanguage);
      expect(mockParser.init).toHaveBeenCalledTimes(1);
    } finally {
      restoreFetch();
    }
  });

  it('supports web-tree-sitter shape where Parser is the default export', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      webTreeSitterFactory = () => ({ default: mockParser, Language: mockLanguage });

      const { initTreeSitter } = await importSubject();
      const env = await initTreeSitter({ wasmBaseUrl: 'https://cdn.example.com/ts/' });

      expect(env.Parser).toBe(mockParser);
      expect(env.Language).toBe(mockLanguage);
      expect(mockParser.init).toHaveBeenCalledTimes(1);
    } finally {
      restoreFetch();
    }
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace string', '   '],
    ['0', 0],
    ['-1', -1],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['empty object', {}],
    ['empty array', []],
    ['deep object', { a: { b: { c: [1, 2, 3] } } }],
  ])('falls back to the default base URL for wasmBaseUrl=%s', async (_label, wasmBaseUrl) => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const { initTreeSitter } = await importSubject();
      const env = await initTreeSitter({ wasmBaseUrl });

      expect(env).toEqual(expect.objectContaining({ wasmBaseUrl: 'wasm/tree-sitter/' }));
      expect(mockParser.init).toHaveBeenCalledTimes(1);
    } finally {
      restoreFetch();
    }
  });

  it('handles very long wasmBaseUrl strings', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const longPath = 'a'.repeat(5000);
      const { initTreeSitter } = await importSubject();
      const env = await initTreeSitter({ wasmBaseUrl: `https://example.com/${longPath}` });

      expect(env.wasmBaseUrl).toBe(`https://example.com/${longPath}/`);
      expect(mockParser.init).toHaveBeenCalledTimes(1);
    } finally {
      restoreFetch();
    }
  });

  it('accepts options passed as an array and uses the default base URL', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const { initTreeSitter } = await importSubject();
      const env = await initTreeSitter([]);

      expect(env).toEqual(expect.objectContaining({ wasmBaseUrl: 'wasm/tree-sitter/' }));
      expect(mockParser.init).toHaveBeenCalledTimes(1);
    } finally {
      restoreFetch();
    }
  });
});

describe('loadTreeSitterLanguage', () => {
  it('returns null in node-like runtime (does not validate wasmFileName)', async () => {
    nodeLike = true;

    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const { loadTreeSitterLanguage } = await importSubject();
      await expect(loadTreeSitterLanguage('')).resolves.toBeNull();

      expect(mockLanguage.load).not.toHaveBeenCalled();
      expect(mockParser.init).not.toHaveBeenCalled();
    } finally {
      restoreFetch();
    }
  });

  it('returns null when fetch is unavailable (does not validate wasmFileName)', async () => {
    const restoreFetch = setGlobalProperty('fetch', undefined);
    try {
      const { loadTreeSitterLanguage } = await importSubject();
      await expect(loadTreeSitterLanguage('', { wasmBaseUrl: 'https://cdn.example.com/ts/' })).resolves.toBeNull();

      expect(mockLanguage.load).not.toHaveBeenCalled();
      expect(mockParser.init).not.toHaveBeenCalled();
    } finally {
      restoreFetch();
    }
  });

  it('rejects with TypeError when options is null', async () => {
    const { loadTreeSitterLanguage } = await importSubject();
    await expect(loadTreeSitterLanguage('x.wasm', null)).rejects.toBeInstanceOf(TypeError);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty string', ''],
    ['whitespace string', '   '],
    ['0', 0],
    ['-1', -1],
    ['MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER],
    ['empty object', {}],
    ['empty array', []],
  ])('throws when wasmFileName is required (%s)', async (_label, wasmFileName) => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const { loadTreeSitterLanguage } = await importSubject();
      await expect(
        loadTreeSitterLanguage(wasmFileName, { wasmBaseUrl: 'https://cdn.example.com/ts/' }),
      ).rejects.toThrow('loadTreeSitterLanguage(wasmFileName): wasmFileName is required');

      expect(mockLanguage.load).not.toHaveBeenCalled();
    } finally {
      restoreFetch();
    }
  });

  it('trims wasmFileName and loads the language using a resolved absolute URL', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      mockLanguage.load.mockResolvedValueOnce({ id: 'lang' });

      const { loadTreeSitterLanguage } = await importSubject();
      const result = await loadTreeSitterLanguage('  tree-sitter-javascript.wasm  ', {
        wasmBaseUrl: 'https://cdn.example.com/ts',
      });

      expect(result).toEqual({ id: 'lang' });
      expect(mockParser.init).toHaveBeenCalledTimes(1);
      expect(mockLanguage.load).toHaveBeenCalledTimes(1);
      expect(mockLanguage.load).toHaveBeenCalledWith('https://cdn.example.com/ts/tree-sitter-javascript.wasm');
    } finally {
      restoreFetch();
    }
  });

  it('coalesces concurrent calls via initTreeSitter and loads each language once', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const deferred = createDeferred();
      mockParser.init.mockImplementation(() => deferred.promise);
      mockLanguage.load.mockImplementation(async (url) => ({ url }));

      const { loadTreeSitterLanguage } = await importSubject();

      const p1 = loadTreeSitterLanguage('a.wasm', { wasmBaseUrl: 'https://cdn.example.com/ts/' });
      const p2 = loadTreeSitterLanguage('b.wasm', { wasmBaseUrl: 'https://cdn.example.com/ts/' });

      deferred.resolve();

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toEqual({ url: 'https://cdn.example.com/ts/a.wasm' });
      expect(r2).toEqual({ url: 'https://cdn.example.com/ts/b.wasm' });
      expect(mockParser.init).toHaveBeenCalledTimes(1);
      expect(mockLanguage.load).toHaveBeenCalledTimes(2);
    } finally {
      restoreFetch();
    }
  });

  it('fails with TypeError when default/relative wasmBaseUrl cannot form an absolute URL base', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const { loadTreeSitterLanguage } = await importSubject();
      await expect(loadTreeSitterLanguage('lang.wasm', { wasmBaseUrl: '' })).rejects.toBeInstanceOf(TypeError);

      expect(mockParser.init).toHaveBeenCalledTimes(1);
      expect(mockLanguage.load).not.toHaveBeenCalled();
    } finally {
      restoreFetch();
    }
  });

  it('handles very long wasmFileName strings', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const longName = `${'a'.repeat(5000)}.wasm`;
      const { loadTreeSitterLanguage } = await importSubject();
      await loadTreeSitterLanguage(longName, { wasmBaseUrl: 'https://cdn.example.com/ts/' });

      expect(mockLanguage.load).toHaveBeenCalledTimes(1);
      expect(mockLanguage.load).toHaveBeenCalledWith(`https://cdn.example.com/ts/${longName}`);
    } finally {
      restoreFetch();
    }
  });

  it('accepts options passed as an array but may fail if the base URL is not absolute', async () => {
    const restoreFetch = setGlobalProperty('fetch', vi.fn());
    try {
      const { loadTreeSitterLanguage } = await importSubject();
      await expect(loadTreeSitterLanguage('lang.wasm', [])).rejects.toBeInstanceOf(TypeError);

      expect(mockParser.init).toHaveBeenCalledTimes(1);
      expect(mockLanguage.load).not.toHaveBeenCalled();
    } finally {
      restoreFetch();
    }
  });
});

describe('default export', () => {
  it('exposes the named exports on the default object', async () => {
    const mod = await importSubject();

    expect(mod.default).toEqual(
      expect.objectContaining({
        DEFAULT_TREE_SITTER_WASM_BASE_URL: mod.DEFAULT_TREE_SITTER_WASM_BASE_URL,
        initTreeSitter: mod.initTreeSitter,
        loadTreeSitterLanguage: mod.loadTreeSitterLanguage,
      }),
    );
  });
});