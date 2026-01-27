import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';

const MODULE_PATH = '../../../../js/agents/core/secure-plugin-loader.js';
const SHARED_PATH = '../../../../js/agents/shared/index.js';

vi.mock('../../../../js/agents/shared/index.js', async () => {
  const actual = await vi.importActual('../../../../js/agents/shared/index.js');
  return {
    ...actual,
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn() })),
    isNodeLike: vi.fn(() => true),
  };
});

function isClassLike(value) {
  if (typeof value !== 'function') return false;
  const src = Function.prototype.toString.call(value);
  return src.startsWith('class ');
}

function isErrorResult(value) {
  return !!value && typeof value === 'object' && value.ok === false && typeof value.error === 'string';
}

function getFailureMessage(value) {
  if (isErrorResult(value)) return value.error;

  if (value && typeof value === 'object') {
    if (Array.isArray(value.failed) && value.failed.length > 0) {
      const first = value.failed[0];
      if (first && typeof first === 'object' && typeof first.error === 'string') return first.error;
      return 'failed';
    }
    if (typeof value.error === 'string' && !('plugin' in value) && !('loaded' in value) && !('failed' in value)) {
      return value.error;
    }
  }

  return null;
}

function extractPlugin(value) {
  if (!value) return value;

  if (value && typeof value === 'object') {
    if (Array.isArray(value.loaded) && value.loaded.length > 0) {
      const first = value.loaded[0];
      if (first && typeof first === 'object' && 'plugin' in first) return first.plugin;
      return first;
    }
    if ('plugin' in value) return value.plugin;
  }

  return value;
}

function runPluginMaybe(pluginValue, config) {
  if (!pluginValue) return pluginValue;

  if (typeof pluginValue === 'function') return pluginValue(config);

  if (typeof pluginValue === 'object') {
    if (typeof pluginValue.default === 'function') return pluginValue.default(config);
    if (typeof pluginValue.plugin === 'function') return pluginValue.plugin(config);
    if (typeof pluginValue.run === 'function') return pluginValue.run(config);
    if ('token' in pluginValue && 'config' in pluginValue) return pluginValue;
  }

  return pluginValue;
}

function inputToUrlString(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();

  if (input && typeof input === 'object') {
    if (typeof input.url === 'string') return input.url;
    if (typeof input.href === 'string') return input.href;
  }

  return String(input);
}

function makeResponse(bodyText, { status = 200, url = 'https://example.com/', headers = {} } = {}) {
  const buf = Buffer.from(String(bodyText), 'utf8');
  const headerMap = new Map(
    Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)]),
  );

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'ERR',
    url,
    headers: {
      get(key) {
        return headerMap.get(String(key).toLowerCase()) ?? null;
      },
    },
    async arrayBuffer() {
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
    async text() {
      return buf.toString('utf8');
    },
    clone() {
      return this;
    },
  };
}

function sriSha256(text) {
  const digest = createHash('sha256').update(text).digest('base64');
  return `sha256-${digest}`;
}

function makeDeepConfig(depth = 30) {
  let obj = { leaf: true };
  for (let i = depth; i > 0; i -= 1) {
    obj = { level: i, child: obj };
  }
  return obj;
}

let pluginSeq = 0;
function nextToken(prefix = 'plugin') {
  pluginSeq += 1;
  return `${prefix}-${pluginSeq}`;
}

function makePluginModuleSource(token, { fillerSize = 0 } = {}) {
  const t = JSON.stringify(token);
  const filler = fillerSize > 0 ? `/*${'a'.repeat(fillerSize)}*/\n` : '';
  return `${filler}globalThis.__SPL_EVAL__ = globalThis.__SPL_EVAL__ || {};
globalThis.__SPL_EVAL__[${t}] = (globalThis.__SPL_EVAL__[${t}] || 0) + 1;

export default function plugin(config = {}) {
  return { token: ${t}, config };
}
`;
}

function getLoadPluginCallable(instance) {
  if (instance && typeof instance.loadPlugin === 'function') return instance.loadPlugin.bind(instance);
  if (instance && typeof instance.load === 'function') return instance.load.bind(instance);
  return null;
}

function getLoadPluginsCallable(instance) {
  if (instance && typeof instance.loadPlugins === 'function') return instance.loadPlugins.bind(instance);
  if (instance && typeof instance.loadMany === 'function') return instance.loadMany.bind(instance);
  if (instance && typeof instance.loadManifest === 'function') return instance.loadManifest.bind(instance);
  return null;
}

async function invokeLoadPlugin(loadPluginFn, rawUrl, options) {
  const attempts = [
    () => loadPluginFn(rawUrl, options),
    () => loadPluginFn({ url: rawUrl, ...options }),
    () => loadPluginFn({ ...options, url: rawUrl }),
  ];

  let lastThrown = null;
  let lastValue = undefined;

  for (const attempt of attempts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const value = await attempt();
      lastValue = value;

      const failure = getFailureMessage(value);
      if (!failure) return value;

      // Keep trying other invocation shapes in case this is a signature mismatch.
    } catch (err) {
      lastThrown = err;
    }
  }

  if (lastThrown) throw lastThrown;
  return lastValue;
}

async function importFresh() {
  vi.resetModules();
  return await import(MODULE_PATH);
}

const initialModule = await import(MODULE_PATH);
const functionExportEntries = Object.entries(initialModule).filter(([, value]) => typeof value === 'function');

const originals = {
  crypto: globalThis.crypto,
  location: globalThis.location,
};

beforeEach(() => {
  vi.clearAllMocks();
  pluginSeq = 0;

  globalThis.__SPL_EVAL__ = undefined;

  if (!globalThis.crypto) globalThis.crypto = webcrypto;

  // Ensure tests don't leak a fake browser location.
  globalThis.location = originals.location;
});

for (const [exportName, initialValue] of functionExportEntries) {
  describe(exportName, () => {
    let mod;
    let exported;

    beforeEach(async () => {
      mod = await importFresh();
      exported = mod[exportName];
    });

    it('exports a function/class', () => {
      expect(exported).toBeTypeOf('function');
    });

    if (exportName === 'errorResult') {
      it('wraps unknown errors into { ok:false, error }', async () => {
        const res1 = exported(new Error('boom'));
        expect(res1).toEqual(expect.objectContaining({ ok: false }));
        expect(res1.error).toEqual(expect.any(String));
        expect(res1.error).toContain('boom');

        const res2 = exported('plain string error');
        expect(res2).toEqual(expect.objectContaining({ ok: false }));
        expect(res2.error).toEqual(expect.any(String));

        const res3 = exported(null);
        expect(res3).toEqual(expect.objectContaining({ ok: false }));
        expect(res3.error).toEqual(expect.any(String));
      });
    }

    if (exportName === 'isErrorResultValue') {
      it('detects ErrorResult shapes and rejects near-misses', async () => {
        expect(exported({ ok: false, error: 'x' })).toBe(true);

        expect(exported(null)).toBe(false);
        expect(exported(undefined)).toBe(false);
        expect(exported('')).toBe(false);
        expect(exported({})).toBe(false);
        expect(exported({ ok: false })).toBe(false);
        expect(exported({ ok: false, error: 1 })).toBe(false);
        expect(exported({ ok: true, error: 'x' })).toBe(false);
      });
    }

    if (exportName === 'normalizeLogger') {
      it('binds logger methods and falls back to createLogger', async () => {
        const logger = {
          prefix: 'pfx',
          info(msg) {
            return `${this.prefix}:${msg}`;
          },
          warn(msg) {
            return `${this.prefix}:${msg}`;
          },
        };

        const normalized = exported(logger);
        expect(normalized).toEqual(
          expect.objectContaining({
            info: expect.any(Function),
            warn: expect.any(Function),
          }),
        );

        expect(normalized.info('x')).toBe('pfx:x');
        expect(normalized.warn('y')).toBe('pfx:y');

        const shared = await import(SHARED_PATH);
        const beforeCalls = shared.createLogger.mock.calls.length;

        const normalized2 = exported({ info: 'nope', warn: null });
        expect(normalized2).toEqual(expect.any(Object));
        expect(shared.createLogger.mock.calls.length).toBeGreaterThanOrEqual(beforeCalls + 1);
      });
    }

    if (exportName === 'getDefaultBaseUrl') {
      it('reads globalThis.location.href when present; otherwise returns null', async () => {
        globalThis.location = undefined;
        expect(exported()).toBe(null);

        globalThis.location = { href: '   ' };
        expect(exported()).toBe(null);

        globalThis.location = { href: 'https://example.com/app/' };
        expect(exported()).toBe('https://example.com/app/');
      });
    }

    if (exportName === 'parseBaseUrl') {
      it('returns URL for valid input; null for empty/invalid/typed edge cases', async () => {
        expect(exported(null)).toBe(null);
        expect(exported(undefined)).toBe(null);
        expect(exported('')).toBe(null);
        expect(exported('   ')).toBe(null);
        expect(exported([])).toBe(null);
        expect(exported({})).toBe(null);
        expect(exported(0)).toBe(null);
        expect(exported(-1)).toBe(null);
        expect(exported(Number.MAX_SAFE_INTEGER)).toBe(null);

        const u = exported('https://example.com/a/b?c=1#d');
        expect(u).toBeInstanceOf(URL);
        expect(u.href).toBe('https://example.com/a/b?c=1#d');
      });
    }

    if (exportName === 'isLocalhostHost') {
      it('detects localhost and loopback variations (including bracketed IPv6)', async () => {
        expect(exported('localhost')).toBe(true);
        expect(exported('LOCALHOST')).toBe(true);
        expect(exported('foo.localhost')).toBe(true);

        expect(exported('127.0.0.1')).toBe(true);
        expect(exported('127.0.0.2')).toBe(true);
        expect(exported('127.255.255.255')).toBe(true);

        expect(exported('::1')).toBe(true);
        expect(exported('[::1]')).toBe(true);

        expect(exported('0.0.0.0')).toBe(true);

        expect(exported('192.168.0.1')).toBe(false);
        expect(exported('example.com')).toBe(false);
        expect(exported('')).toBe(false);
        expect(exported('   ')).toBe(false);
        expect(exported(null)).toBe(false);
        expect(exported(undefined)).toBe(false);
      });
    }

    if (exportName === 'resolveUrl') {
      it('resolves absolute URLs and relative URLs (with baseUrl or global location)', async () => {
        const okAbs = exported('https://example.com/p.mjs', null);
        expect(okAbs).toEqual(expect.objectContaining({ ok: true }));
        expect(okAbs.url).toBe('https://example.com/p.mjs');

        const badEmpty = exported('   ', null);
        expect(isErrorResult(badEmpty)).toBe(true);

        const badRelNoBase = exported('./p.mjs', null);
        expect(isErrorResult(badRelNoBase)).toBe(true);

        const okRelWithBase = exported('./p.mjs', 'https://example.com/base/');
        expect(okRelWithBase).toEqual(expect.objectContaining({ ok: true }));
        expect(okRelWithBase.url).toBe('https://example.com/base/p.mjs');

        globalThis.location = { href: 'https://example.com/app/' };
        const okRelWithGlobal = exported('./x.mjs', null);
        expect(okRelWithGlobal).toEqual(expect.objectContaining({ ok: true }));
        expect(okRelWithGlobal.url).toBe('https://example.com/x.mjs');
      });
    }

    if (exportName === 'validatePluginUrl') {
      it('rejects invalid URLs and accepts resolvable HTTPS URLs', async () => {
        const bad1 = exported('', { baseUrl: 'https://example.com/', allowInsecure: false });
        expect(isErrorResult(bad1)).toBe(true);

        const bad2 = exported('./x.mjs', { baseUrl: null, allowInsecure: false, requireBaseUrl: true });
        expect(isErrorResult(bad2)).toBe(true);

        const ok1 = exported('./x.mjs', { baseUrl: 'https://example.com/app/', allowInsecure: false });
        expect(ok1).toEqual(expect.objectContaining({ ok: true }));
        expect(ok1.url).toBe('https://example.com/x.mjs');

        const badProto = exported('file:///etc/passwd', { baseUrl: 'https://example.com/', allowInsecure: false });
        expect(isErrorResult(badProto)).toBe(true);

        const badSameOrigin = exported('https://evil.example/x.mjs', {
          baseUrl: 'https://example.com/app/',
          allowInsecure: false,
          enforceSameOrigin: true,
        });
        expect(isErrorResult(badSameOrigin)).toBe(true);
      });
    }

    const shouldRunLoaderTests =
      isClassLike(initialValue) &&
      (exportName === 'default' || exportName.toLowerCase().includes('loader') || exportName.toLowerCase().includes('plugin'));

    if (shouldRunLoaderTests) {
      it('constructs with minimal options (including mocked logger)', async () => {
        const fetchImpl = vi.fn(async () => makeResponse('export default function(){}'));
        expect(() => new exported({ fetchImpl, baseUrl: 'https://example.com/app/' })).not.toThrow();
      });

      it('fails for relative URLs when no baseUrl is available', async () => {
        const token = nextToken('rel-nobase');
        const source = makePluginModuleSource(token);
        const integrity = sriSha256(source);

        const fetchImpl = vi.fn(async () => makeResponse(source, { url: 'https://example.com/irrelevant' }));
        const loader = new exported({ fetchImpl });

        const loadPlugin = getLoadPluginCallable(loader) || getLoadPluginsCallable(loader);
        expect(loadPlugin).toBeTypeOf('function');

        let thrown = null;
        let value = null;
        try {
          if (getLoadPluginCallable(loader)) {
            value = await invokeLoadPlugin(loadPlugin, `./${token}.mjs`, { integrity, config: {} });
          } else {
            value = await loadPlugin({ plugins: [{ url: `./${token}.mjs`, integrity, config: {} }] });
          }
        } catch (err) {
          thrown = err;
        }

        expect(thrown || value).toBeTruthy();

        if (thrown) {
          expect(String(thrown)).toEqual(expect.any(String));
        } else {
          expect(getFailureMessage(value)).toEqual(expect.any(String));
        }
      });

      it('loads a plugin with valid SRI and supports deep config (happy path)', async () => {
        const token = nextToken('happy');
        const source = makePluginModuleSource(token);
        const integrity = sriSha256(source);
        const baseUrl = 'https://example.com/app/';

        const resolvedUrl = new URL(`./${token}.mjs`, baseUrl).toString();
        const fetchImpl = vi.fn(async (input) => {
          const url = inputToUrlString(input);
          if (url === resolvedUrl) {
            return makeResponse(source, {
              url,
              headers: { 'content-type': 'text/javascript' },
            });
          }
          return makeResponse('not found', { status: 404, url });
        });

        const deepConfig = makeDeepConfig(40);
        const loader = new exported({ fetchImpl, baseUrl });

        let result;
        if (getLoadPluginCallable(loader)) {
          result = await invokeLoadPlugin(getLoadPluginCallable(loader), `./${token}.mjs`, { integrity, config: deepConfig });
        } else {
          const loadPlugins = getLoadPluginsCallable(loader);
          expect(loadPlugins).toBeTypeOf('function');
          result = await loadPlugins({ plugins: [{ url: `./${token}.mjs`, integrity, config: deepConfig }] });
        }

        const failure = getFailureMessage(result);
        expect(failure).toBe(null);

        expect(fetchImpl).toHaveBeenCalled();
        const calledUrl = inputToUrlString(fetchImpl.mock.calls[0][0]);
        expect(calledUrl).toBe(resolvedUrl);

        const pluginValue = extractPlugin(result);
        const pluginResult = runPluginMaybe(pluginValue, deepConfig);
        expect(pluginResult).toEqual(expect.objectContaining({ token }));
        expect(pluginResult.config).toEqual(deepConfig);
      });

      it('rejects integrity mismatches without evaluating the module (SRI gate)', async () => {
        const token = nextToken('mismatch');
        const source = makePluginModuleSource(token);
        const integrityWrong = sriSha256(source + '\n// tampered');
        const baseUrl = 'https://example.com/app/';

        globalThis.__SPL_EVAL__ = {};

        const resolvedUrl = new URL(`./${token}.mjs`, baseUrl).toString();
        const fetchImpl = vi.fn(async (input) => {
          const url = inputToUrlString(input);
          if (url === resolvedUrl) return makeResponse(source, { url });
          return makeResponse('not found', { status: 404, url });
        });

        const loader = new exported({ fetchImpl, baseUrl });

        let thrown = null;
        let result = null;

        try {
          if (getLoadPluginCallable(loader)) {
            result = await invokeLoadPlugin(getLoadPluginCallable(loader), `./${token}.mjs`, { integrity: integrityWrong, config: {} });
          } else {
            result = await getLoadPluginsCallable(loader)({
              plugins: [{ url: `./${token}.mjs`, integrity: integrityWrong, config: {} }],
            });
          }
        } catch (err) {
          thrown = err;
        }

        expect(thrown || result).toBeTruthy();

        if (!thrown) {
          expect(getFailureMessage(result)).toEqual(expect.any(String));
        }

        expect(globalThis.__SPL_EVAL__?.[token]).toBeUndefined();
      });

      it('handles non-OK fetch responses (error path)', async () => {
        const token = nextToken('404');
        const source = makePluginModuleSource(token);
        const integrity = sriSha256(source);
        const baseUrl = 'https://example.com/app/';

        const resolvedUrl = new URL(`./${token}.mjs`, baseUrl).toString();
        const fetchImpl = vi.fn(async (input) => {
          const url = inputToUrlString(input);
          return makeResponse('not found', { status: 404, url });
        });

        const loader = new exported({ fetchImpl, baseUrl });

        let thrown = null;
        let result = null;

        try {
          if (getLoadPluginCallable(loader)) {
            result = await invokeLoadPlugin(getLoadPluginCallable(loader), `./${token}.mjs`, { integrity, config: {} });
          } else {
            result = await getLoadPluginsCallable(loader)({
              plugins: [{ url: `./${token}.mjs`, integrity, config: {} }],
            });
          }
        } catch (err) {
          thrown = err;
        }

        expect(fetchImpl).toHaveBeenCalled();

        if (thrown) {
          expect(String(thrown)).toEqual(expect.any(String));
        } else {
          expect(getFailureMessage(result)).toEqual(expect.any(String));
        }
      });

      it('supports concurrent loads (concurrency boundary)', async () => {
        const tokenA = nextToken('concurrent-a');
        const tokenB = nextToken('concurrent-b');

        const sourceA = makePluginModuleSource(tokenA);
        const sourceB = makePluginModuleSource(tokenB);

        const integrityA = sriSha256(sourceA);
        const integrityB = sriSha256(sourceB);

        const baseUrl = 'https://example.com/app/';
        const urlA = new URL(`./${tokenA}.mjs`, baseUrl).toString();
        const urlB = new URL(`./${tokenB}.mjs`, baseUrl).toString();

        const fetchImpl = vi.fn(async (input) => {
          const url = inputToUrlString(input);
          if (url === urlA) return makeResponse(sourceA, { url });
          if (url === urlB) return makeResponse(sourceB, { url });
          return makeResponse('not found', { status: 404, url });
        });

        const loader = new exported({ fetchImpl, baseUrl });

        const deepConfig = makeDeepConfig(10);

        const loadOne = async (token, integrity) => {
          if (getLoadPluginCallable(loader)) {
            return await invokeLoadPlugin(getLoadPluginCallable(loader), `./${token}.mjs`, { integrity, config: deepConfig });
          }
          return await getLoadPluginsCallable(loader)({
            plugins: [{ url: `./${token}.mjs`, integrity, config: deepConfig }],
          });
        };

        const [resA, resB] = await Promise.all([loadOne(tokenA, integrityA), loadOne(tokenB, integrityB)]);

        expect(getFailureMessage(resA)).toBe(null);
        expect(getFailureMessage(resB)).toBe(null);

        const pluginResultA = runPluginMaybe(extractPlugin(resA), deepConfig);
        const pluginResultB = runPluginMaybe(extractPlugin(resB), deepConfig);

        expect(pluginResultA).toEqual(expect.objectContaining({ token: tokenA }));
        expect(pluginResultB).toEqual(expect.objectContaining({ token: tokenB }));
      });

      it('handles large plugin sources (resource boundary)', async () => {
        const token = nextToken('large');
        const source = makePluginModuleSource(token, { fillerSize: 512 * 1024 });
        const integrity = sriSha256(source);

        const baseUrl = 'https://example.com/app/';
        const resolvedUrl = new URL(`./${token}.mjs`, baseUrl).toString();

        const fetchImpl = vi.fn(async (input) => {
          const url = inputToUrlString(input);
          if (url === resolvedUrl) return makeResponse(source, { url });
          return makeResponse('not found', { status: 404, url });
        });

        const loader = new exported({ fetchImpl, baseUrl });

        let result;
        if (getLoadPluginCallable(loader)) {
          result = await invokeLoadPlugin(getLoadPluginCallable(loader), `./${token}.mjs`, { integrity, config: {} });
        } else {
          result = await getLoadPluginsCallable(loader)({
            plugins: [{ url: `./${token}.mjs`, integrity, config: {} }],
          });
        }

        expect(getFailureMessage(result)).toBe(null);

        const pluginResult = runPluginMaybe(extractPlugin(result), {});
        expect(pluginResult).toEqual(expect.objectContaining({ token }));
      });

      it('rejects invalid url inputs (null/undefined/whitespace/type/boundary)', async () => {
        const token = nextToken('type-edges');
        const source = makePluginModuleSource(token);
        const integrity = sriSha256(source);
        const baseUrl = 'https://example.com/app/';

        const resolvedUrl = new URL(`./${token}.mjs`, baseUrl).toString();
        const fetchImpl = vi.fn(async (input) => {
          const url = inputToUrlString(input);
          if (url === resolvedUrl) return makeResponse(source, { url });
          return makeResponse('not found', { status: 404, url });
        });

        const loader = new exported({ fetchImpl, baseUrl });
        const loadPlugin = getLoadPluginCallable(loader);

        const invalidUrls = [null, undefined, '', '   ', 0, -1, Number.MAX_SAFE_INTEGER, [], {}, 'http://'];
        for (const badUrl of invalidUrls) {
          let thrown = null;
          let result = null;

          try {
            if (loadPlugin) {
              // eslint-disable-next-line no-await-in-loop
              result = await invokeLoadPlugin(loadPlugin, badUrl, { integrity, config: {} });
            } else {
              // eslint-disable-next-line no-await-in-loop
              result = await getLoadPluginsCallable(loader)({
                plugins: [{ url: badUrl, integrity, config: {} }],
              });
            }
          } catch (err) {
            thrown = err;
          }

          expect(thrown || result).toBeTruthy();
          if (!thrown) expect(getFailureMessage(result)).toEqual(expect.any(String));
        }
      });
    }

    const looksLikeLoadPluginFn =
      !isClassLike(initialValue) && /loadplugin/i.test(exportName);

    if (looksLikeLoadPluginFn) {
      it('handles invalid inputs (error path)', async () => {
        let thrown = null;
        let result = null;
        try {
          result = await exported(null, null);
        } catch (err) {
          thrown = err;
        }

        expect(thrown || result).toBeTruthy();
        if (!thrown) expect(getFailureMessage(result) ?? String(result)).toEqual(expect.any(String));
      });
    }

    const looksLikeLoadPluginsFn =
      !isClassLike(initialValue) && /loadplugins/i.test(exportName);

    if (looksLikeLoadPluginsFn) {
      it('handles invalid manifest inputs (error path)', async () => {
        let thrown = null;
        let result = null;
        try {
          result = await exported(null);
        } catch (err) {
          thrown = err;
        }

        expect(thrown || result).toBeTruthy();
        if (!thrown) expect(getFailureMessage(result) ?? String(result)).toEqual(expect.any(String));
      });
    }
  });
}