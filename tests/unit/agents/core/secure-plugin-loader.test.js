import { describe, it, expect, vi, beforeEach } from 'vitest';

const sharedMocks = vi.hoisted(() => {
  let lastLogger = null;

  const createLogger = vi.fn(() => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };
    lastLogger = logger;
    return logger;
  });

  const toErrorMessage = vi.fn((err) => {
    if (err === null || err === undefined) return 'Unknown error';
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    if (typeof err === 'object') {
      const obj = err;
      if (typeof obj.message === 'string') return obj.message;
      if (typeof obj.error === 'string') return obj.error;
      if (typeof obj.reason === 'string') return obj.reason;
      try {
        return JSON.stringify(err);
      } catch {
        return String(err);
      }
    }
    return String(err);
  });

  const isPlainObject = vi.fn((value) => {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  const toNonEmptyString = vi.fn((value) => {
    if (value === null || value === undefined) return undefined;
    const str = String(value).trim();
    return str.length ? str : undefined;
  });

  const isNodeLike = vi.fn(() => false);

  return {
    createLogger,
    toErrorMessage,
    isPlainObject,
    toNonEmptyString,
    isNodeLike,
    getLastLogger: () => lastLogger,
    resetLastLogger: () => {
      lastLogger = null;
    },
  };
});

vi.mock('../../../../js/agents/shared/index.js', () => ({
  createLogger: sharedMocks.createLogger,
  toErrorMessage: sharedMocks.toErrorMessage,
  isPlainObject: sharedMocks.isPlainObject,
  toNonEmptyString: sharedMocks.toNonEmptyString,
  isNodeLike: sharedMocks.isNodeLike,
}));

import SecurePluginLoaderDefault, {
  SecurePluginLoader as SecurePluginLoaderNamed,
} from '../../../../js/agents/core/secure-plugin-loader.js';

const originalGlobals = {
  Blob: globalThis.Blob,
  URL: globalThis.URL,
  TextEncoder: globalThis.TextEncoder,
  fetch: globalThis.fetch,
  location: globalThis.location,
};
const originalCreateObjectURL = globalThis.URL?.createObjectURL;
const originalRevokeObjectURL = globalThis.URL?.revokeObjectURL;
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

const buildDeepObject = (depth) => {
  const root = { level: 0 };
  let cursor = root;
  for (let i = 1; i <= depth; i += 1) {
    cursor.next = { level: i };
    cursor = cursor.next;
  }
  cursor.leaf = 'end';
  return root;
};

const makeResponse = (text, ok = true, status = 200) => ({
  ok,
  status,
  text: vi.fn(async () => text),
});

const setGlobalLocation = (href) => {
  Object.defineProperty(globalThis, 'location', {
    value: { href },
    configurable: true,
  });
};

const setupObjectUrl = () => {
  class FakeBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.type = options?.type;
    }
  }

  globalThis.Blob = FakeBlob;

  let counter = 0;
  if (!globalThis.URL) {
    globalThis.URL = class URL {};
  }

  globalThis.URL.createObjectURL = vi.fn((blob) => {
    counter += 1;
    const code = Array.isArray(blob?.parts) ? blob.parts.join('') : '';
    return `data:text/javascript,${encodeURIComponent(code)}#${counter}`;
  });

  globalThis.URL.revokeObjectURL = vi.fn();
};

const setDigestBytes = (bytes) => {
  const digest = vi.fn(async () => bytes.buffer);
  Object.defineProperty(globalThis, 'crypto', {
    value: { subtle: { digest } },
    configurable: true,
    writable: true,
  });
  return digest;
};

beforeEach(() => {
  vi.clearAllMocks();
  sharedMocks.resetLastLogger();
  sharedMocks.isNodeLike.mockReturnValue(false);

  globalThis.Blob = originalGlobals.Blob;
  globalThis.TextEncoder = originalGlobals.TextEncoder;
  globalThis.fetch = originalGlobals.fetch;

  if (originalGlobals.URL) {
    if (originalCreateObjectURL) {
      originalGlobals.URL.createObjectURL = originalCreateObjectURL;
    } else {
      delete originalGlobals.URL.createObjectURL;
    }
    if (originalRevokeObjectURL) {
      originalGlobals.URL.revokeObjectURL = originalRevokeObjectURL;
    } else {
      delete originalGlobals.URL.revokeObjectURL;
    }
  }
  globalThis.URL = originalGlobals.URL;

  if (originalCryptoDescriptor) {
    Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
  } else {
    try {
      delete globalThis.crypto;
    } catch {
      // ignore
    }
  }

  if (originalGlobals.location) {
    globalThis.location = originalGlobals.location;
  } else {
    try {
      delete globalThis.location;
    } catch {
      // ignore
    }
  }

  if (!globalThis.TextEncoder) {
    globalThis.TextEncoder = class TextEncoder {
      encode(value) {
        const str = String(value);
        const bytes = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i += 1) {
          bytes[i] = str.charCodeAt(i) & 0xff;
        }
        return bytes;
      }
    };
  }
});

describe('SecurePluginLoader', () => {
  it('normalizes constructor options and logger', () => {
    globalThis.fetch = undefined;
    const loader = new SecurePluginLoaderNamed(null);

    expect(sharedMocks.createLogger).toHaveBeenCalledWith('core/secure-plugin-loader');
    expect(loader.fetchImpl).toBeNull();
    expect(loader.baseUrl).toBeNull();
    expect(loader.allowInsecure).toBe(false);

    const customLogger = { info: vi.fn(), warn: vi.fn() };
    const loaderWithLogger = new SecurePluginLoaderNamed({
      logger: customLogger,
      baseUrl: '   ',
      allowInsecure: true,
    });

    loaderWithLogger.logger.info('ping');

    expect(customLogger.info).toHaveBeenCalledWith('ping');
    expect(sharedMocks.createLogger).toHaveBeenCalledTimes(1);
    expect(loaderWithLogger.baseUrl).toBeNull();
    expect(loaderWithLogger.allowInsecure).toBe(true);
  });

  it('loadPlugin rejects invalid options and empty values', async () => {
    const loader = new SecurePluginLoaderNamed({
      baseUrl: 'https://example.com/',
      fetchImpl: vi.fn(),
    });

    const skipIntegrity = await loader.loadPlugin('https://example.com/plugin.js', {
      skipIntegrity: true,
      integrity: 'sha256-abc',
    });
    expect(skipIntegrity).toEqual({ ok: false, error: 'skipIntegrity is not allowed' });

    const missingIntegrity = await loader.loadPlugin('https://example.com/plugin.js', {});
    expect(missingIntegrity).toEqual({ ok: false, error: 'integrity is required' });

    const badConfig = await loader.loadPlugin('https://example.com/plugin.js', {
      integrity: 'sha256-abc',
      config: [],
    });
    expect(badConfig).toEqual({ ok: false, error: 'config must be a plain object' });

    for (const url of [undefined, null, '', '   ']) {
      const result = await loader.loadPlugin(url, { integrity: 'sha256-abc' });
      expect(result).toEqual({ ok: false, error: 'url must be a non-empty string' });
    }
  });

  it('loadPlugin rejects relative URLs without a base', async () => {
    const loader = new SecurePluginLoaderNamed({ fetchImpl: vi.fn() });

    const result = await loader.loadPlugin('./plugin.js', { integrity: 'sha256-abc' });

    expect(result).toEqual({
      ok: false,
      error: 'Invalid URL (baseUrl required for relative URLs)',
    });
  });

  it('loadPlugin validates protocol and insecure URLs', async () => {
    const fetchImpl = vi.fn(async () => ({}));
    const loader = new SecurePluginLoaderNamed({
      baseUrl: 'https://example.com/',
      fetchImpl,
    });

    const badProtocol = await loader.loadPlugin('ftp://example.com/plugin.js', {
      integrity: 'sha256-abc',
    });
    expect(badProtocol).toEqual({
      ok: false,
      error: 'Unsupported URL protocol: ftp:',
    });

    const insecure = await loader.loadPlugin('http://example.com/plugin.js', {
      integrity: 'sha256-abc',
    });
    expect(insecure).toEqual({
      ok: false,
      error: 'URL must use HTTPS unless targeting localhost (or enable allowInsecure)',
    });

    const localhost = await loader.loadPlugin('http://localhost/plugin.js', {
      integrity: 'sha256-abc',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(localhost).toEqual({ ok: false, error: 'fetch returned an invalid response' });
  });

  it('loadPlugin enforces baseUrl and same-origin in node-like environments', async () => {
    sharedMocks.isNodeLike.mockReturnValue(true);

    const loader = new SecurePluginLoaderNamed({ fetchImpl: vi.fn() });
    const missingBase = await loader.loadPlugin('https://example.com/plugin.js', {
      integrity: 'sha256-abc',
    });
    expect(missingBase).toEqual({ ok: false, error: 'baseUrl is required in Node environments' });

    const loaderWithBase = new SecurePluginLoaderNamed({
      fetchImpl: vi.fn(),
      baseUrl: 'https://example.com/app/',
    });
    const wrongOrigin = await loaderWithBase.loadPlugin('https://other.com/plugin.js', {
      integrity: 'sha256-abc',
    });
    expect(wrongOrigin).toEqual({ ok: false, error: 'URL must match baseUrl origin' });
  });

  it('loadPlugin uses global location for relative URLs when available', async () => {
    setupObjectUrl();
    setGlobalLocation('https://example.com/base/');

    const fetchImpl = vi.fn(async () => makeResponse('export default { name: "loc" };'));
    const loader = new SecurePluginLoaderNamed({ fetchImpl });
    vi.spyOn(loader, 'verifyIntegrity').mockResolvedValue(true);

    const plugin = await loader.loadPlugin('./plugin.js', { integrity: 'sha256-abc' });

    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/base/plugin.js', { method: 'GET' });
    expect(plugin).toEqual(expect.objectContaining({ name: 'loc' }));
  });

  it('loadPlugin reports missing fetch implementation', async () => {
    globalThis.fetch = undefined;
    const loader = new SecurePluginLoaderNamed({ baseUrl: 'https://example.com/' });

    const result = await loader.loadPlugin('https://example.com/plugin.js', {
      integrity: 'sha256-abc',
    });

    expect(result).toEqual({ ok: false, error: 'fetch is unavailable' });
  });

  it('loadPlugin handles invalid fetch responses and status codes', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ok: false, status: 404, text: vi.fn() });

    const loader = new SecurePluginLoaderNamed({
      baseUrl: 'https://example.com/',
      fetchImpl,
    });

    const invalidResponse = await loader.loadPlugin('https://example.com/a.js', {
      integrity: 'sha256-abc',
    });
    expect(invalidResponse).toEqual({ ok: false, error: 'fetch returned an invalid response' });

    const badStatus = await loader.loadPlugin('https://example.com/b.js', {
      integrity: 'sha256-abc',
    });
    expect(badStatus).toEqual({ ok: false, error: 'Failed to fetch plugin (status 404)' });
  });

  it('loadPlugin logs warnings on fetch errors', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('boom');
    });
    const loader = new SecurePluginLoaderNamed({
      baseUrl: 'https://example.com/',
      fetchImpl,
    });

    const result = await loader.loadPlugin('https://example.com/a.js', {
      integrity: 'sha256-abc',
    });

    expect(result).toEqual({ ok: false, error: 'boom' });
    expect(sharedMocks.getLastLogger().warn).toHaveBeenCalled();
  });

  it('loadPlugin reports integrity failures', async () => {
    const fetchImpl = vi.fn(async () => makeResponse('export default {}'));
    const loader = new SecurePluginLoaderNamed({
      baseUrl: 'https://example.com/',
      fetchImpl,
    });

    const verifySpy = vi.spyOn(loader, 'verifyIntegrity');
    verifySpy.mockResolvedValueOnce({ ok: false, error: 'bad hash' });

    const badIntegrity = await loader.loadPlugin('https://example.com/a.js', {
      integrity: 'sha256-abc',
    });
    expect(badIntegrity).toEqual({ ok: false, error: 'bad hash' });

    verifySpy.mockResolvedValueOnce(false);

    const mismatch = await loader.loadPlugin('https://example.com/b.js', {
      integrity: 'sha256-abc',
    });
    expect(mismatch).toEqual({ ok: false, error: 'Plugin integrity mismatch' });
    expect(sharedMocks.getLastLogger().warn).toHaveBeenCalled();
  });

  it('loadPlugin fails when Blob or URL.createObjectURL is unavailable', async () => {
    const fetchImpl = vi.fn(async () => makeResponse('export default {}'));
    const loader = new SecurePluginLoaderNamed({
      baseUrl: 'https://example.com/',
      fetchImpl,
    });

    vi.spyOn(loader, 'verifyIntegrity').mockResolvedValue(true);
    globalThis.Blob = undefined;
    if (globalThis.URL) {
      globalThis.URL.createObjectURL = undefined;
    }

    const result = await loader.loadPlugin('https://example.com/a.js', {
      integrity: 'sha256-abc',
    });

    expect(result).toEqual({
      ok: false,
      error: 'Blob or URL.createObjectURL is unavailable',
    });
  });

  it('loadPlugin loads plugin content with large payloads and deep config', async () => {
    setupObjectUrl();

    const largeCode = `export default { name: "big", version: 1 };${' '.repeat(200000)}`;
    const fetchImpl = vi.fn(async () => makeResponse(largeCode));
    const loader = new SecurePluginLoaderNamed({
      baseUrl: 'https://example.com/',
      fetchImpl,
    });

    vi.spyOn(loader, 'verifyIntegrity').mockResolvedValue(true);

    const deepConfig = buildDeepObject(40);
    const plugin = await loader.loadPlugin('/plugin.js', {
      integrity: 'sha256-abc',
      config: deepConfig,
    });

    expect(plugin).toEqual(expect.objectContaining({ name: 'big' }));
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('verifyIntegrity matches base64 and hex hashes', async () => {
    const loader = new SecurePluginLoaderNamed();

    setDigestBytes(new Uint8Array([1, 2, 3]));
    const base64Ok = await loader.verifyIntegrity('content', 'sha256-AQID==');
    expect(base64Ok).toBe(true);

    const base64Bad = await loader.verifyIntegrity('content', 'sha256-AQIE');
    expect(base64Bad).toBe(false);

    const hexBytes = Uint8Array.from({ length: 32 }, (_, i) => i);
    setDigestBytes(hexBytes);
    const hex = Array.from(hexBytes, (b) => b.toString(16).padStart(2, '0')).join('');

    const hexOk = await loader.verifyIntegrity('content', `sha256:${hex}`);
    expect(hexOk).toBe(true);

    const hexBad = await loader.verifyIntegrity('content', `sha256:${hex.slice(0, -1)}0`);
    expect(hexBad).toBe(false);
  });

  it('verifyIntegrity reports parse and digest errors', async () => {
    const loader = new SecurePluginLoaderNamed();

    const missing = await loader.verifyIntegrity('content', '   ');
    expect(missing).toEqual({ ok: false, error: 'integrity is required' });

    const unsupported = await loader.verifyIntegrity('content', Number.MAX_SAFE_INTEGER);
    expect(unsupported).toEqual({
      ok: false,
      error: 'Unsupported integrity format (expected sha256-... or sha256:...)',
    });

    Object.defineProperty(globalThis, 'crypto', {
      value: null,
      configurable: true,
      writable: true,
    });
    const noCrypto = await loader.verifyIntegrity('content', 'sha256-AQID');
    expect(noCrypto).toEqual({ ok: false, error: 'Web Crypto API is unavailable' });
  });

  it('computeHash returns SRI hashes for long strings', async () => {
    const loader = new SecurePluginLoaderNamed();

    setDigestBytes(new Uint8Array([1, 2, 3]));

    const longString = 'x'.repeat(120000);
    const result = await loader.computeHash(longString);

    expect(result).toBe('sha256-AQID');
  });

  it('computeHash reports digest errors for invalid input', async () => {
    const loader = new SecurePluginLoaderNamed();

    const invalid = await loader.computeHash(0);
    expect(invalid).toEqual({ ok: false, error: 'content must be a string' });

    globalThis.TextEncoder = undefined;
    const noEncoder = await loader.computeHash('hi');
    expect(noEncoder).toEqual({ ok: false, error: 'TextEncoder is unavailable' });
  });

  it('loadPlugins validates manifest structure and empty arrays', async () => {
    const loader = new SecurePluginLoaderNamed();

    const missingManifest = await loader.loadPlugins(null);
    expect(missingManifest).toEqual({ ok: false, error: 'manifest must be a plain object' });

    const undefinedManifest = await loader.loadPlugins(undefined);
    expect(undefinedManifest).toEqual({ ok: false, error: 'manifest must be a plain object' });

    const badPluginsObject = await loader.loadPlugins({ plugins: {} });
    expect(badPluginsObject).toEqual({
      ok: false,
      error: 'manifest.plugins must be an array',
    });

    const badPluginsString = await loader.loadPlugins({ plugins: 'not-array' });
    expect(badPluginsString).toEqual({
      ok: false,
      error: 'manifest.plugins must be an array',
    });

    const emptyList = await loader.loadPlugins({ plugins: [] });
    expect(emptyList).toEqual({ loaded: [], failed: [] });
  });

  it('loadPlugins aggregates loaded and failed entries', async () => {
    const loader = new SecurePluginLoaderNamed();
    const plugin = { name: 'ok' };

    vi.spyOn(loader, 'loadPlugin')
      .mockResolvedValueOnce(plugin)
      .mockResolvedValueOnce({ ok: false, error: 'bad' });

    const manifest = {
      plugins: [
        { url: 'https://example.com/a.js', integrity: 'sha256-abc', config: {} },
        { url: 'https://example.com/b.js', integrity: 'sha256-def' },
      ],
    };

    const result = await loader.loadPlugins(manifest);

    expect(result.loaded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.loaded[0]).toEqual(
      expect.objectContaining({
        url: 'https://example.com/a.js',
        integrity: 'sha256-abc',
        config: {},
        plugin,
      })
    );
    expect(result.failed[0]).toEqual(
      expect.objectContaining({
        url: 'https://example.com/b.js',
        integrity: 'sha256-def',
        error: 'bad',
      })
    );
  });

  it('_loadManifestEntry validates entries and propagates errors', async () => {
    const loader = new SecurePluginLoaderNamed();

    const notObject = await loader._loadManifestEntry(null, 0);
    expect(notObject).toEqual({ ok: false, url: '(unknown)', error: 'plugins[0] must be an object' });

    const missingUrl = await loader._loadManifestEntry({ integrity: 'sha256-abc' }, 1);
    expect(missingUrl).toEqual({
      ok: false,
      url: '(unknown)',
      error: 'plugins[1].url must be a non-empty string',
    });

    const missingIntegrity = await loader._loadManifestEntry({ url: 'https://example.com' }, 2);
    expect(missingIntegrity).toEqual({
      ok: false,
      url: 'https://example.com',
      error: 'plugins[2].integrity must be a non-empty string',
    });

    const badConfig = await loader._loadManifestEntry(
      { url: 'https://example.com', integrity: 'sha256-abc', config: [] },
      3
    );
    expect(badConfig).toEqual({
      ok: false,
      url: 'https://example.com',
      integrity: 'sha256-abc',
      error: 'plugins[3].config must be a plain object',
    });

    const loadSpy = vi.spyOn(loader, 'loadPlugin');
    loadSpy.mockResolvedValueOnce({ ok: false, error: 'load failed' });

    const loadFailure = await loader._loadManifestEntry(
      { url: 'https://example.com', integrity: 'sha256-abc' },
      4
    );
    expect(loadFailure).toEqual({
      ok: false,
      url: 'https://example.com',
      integrity: 'sha256-abc',
      error: 'load failed',
    });

    loadSpy.mockRejectedValueOnce(new Error('boom'));

    const thrown = await loader._loadManifestEntry(
      { url: 'https://example.com', integrity: 'sha256-abc' },
      5
    );
    expect(thrown).toEqual({
      ok: false,
      url: 'https://example.com',
      integrity: 'sha256-abc',
      error: 'boom',
    });
  });

  it('supports concurrent and rapid consecutive loads', async () => {
    setupObjectUrl();

    const fetchImpl = vi.fn(async (url) => {
      const href = String(url);
      const id = href.endsWith('/a.js') ? 'a' : href.endsWith('/b.js') ? 'b' : 'c';
      return makeResponse(`export default { name: "${id}" };`);
    });

    const loader = new SecurePluginLoaderNamed({
      baseUrl: 'https://example.com/',
      fetchImpl,
    });

    vi.spyOn(loader, 'verifyIntegrity').mockResolvedValue(true);

    const [pluginA, pluginB] = await Promise.all([
      loader.loadPlugin('/a.js', { integrity: 'sha256-abc' }),
      loader.loadPlugin('/b.js', { integrity: 'sha256-abc' }),
    ]);

    expect(pluginA).toEqual(expect.objectContaining({ name: 'a' }));
    expect(pluginB).toEqual(expect.objectContaining({ name: 'b' }));

    const pluginC = await loader.loadPlugin('/c.js', { integrity: 'sha256-abc' });

    expect(pluginC).toEqual(expect.objectContaining({ name: 'c' }));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('default export', () => {
  it('matches the named SecurePluginLoader export', () => {
    expect(SecurePluginLoaderDefault).toBe(SecurePluginLoaderNamed);
  });
});
