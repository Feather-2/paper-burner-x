/**
 * SecurePluginLoader - load remote plugins with SRI verification.
 */

import { createLogger } from '../shared/index.js';
import { toErrorMessage } from '../shared/index.js';
import { isPlainObject, toNonEmptyString, isNodeLike } from '../shared/index.js';

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DEFAULT_BLOB_TYPE = 'text/javascript';

/**
 * @typedef {{ ok: false, error: string }} ErrorResult
 */

/**
 * @typedef {object} SecurePluginLoaderOptions
 * @property {{ info?: Function, warn?: Function }=} logger
 * @property {(input: RequestInfo, init?: RequestInit) => Promise<Response>=} fetchImpl
 * @property {string=} baseUrl
 * @property {boolean=} allowInsecure
 */

/**
 * @typedef {object} LoadPluginOptions
 * @property {string} integrity
 * @property {Record<string, unknown>=} config
 * @property {boolean=} allowInsecure
 */

/**
 * @typedef {object} PluginManifestEntry
 * @property {string} url
 * @property {string} integrity
 * @property {Record<string, unknown>=} config
 */

/**
 * @typedef {object} PluginManifest
 * @property {PluginManifestEntry[]} plugins
 */

/**
 * @typedef {object} LoadedPluginResult
 * @property {string} url
 * @property {string} integrity
 * @property {Record<string, unknown>=} config
 * @property {any} plugin
 */

/**
 * @typedef {object} FailedPluginResult
 * @property {string} url
 * @property {string=} integrity
 * @property {string} error
 */

/**
 * @typedef {{ loaded: LoadedPluginResult[], failed: FailedPluginResult[] }} LoadPluginsResult
 */

/**
 * @param {unknown} err
 * @returns {ErrorResult}
 */
function errorResult(err) {
  return { ok: false, error: toErrorMessage(err) };
}

/**
 * @param {unknown} value
 * @returns {value is ErrorResult}
 */
function isErrorResultValue(value) {
  if (!value || typeof value !== 'object') return false;
  /** @type {{ ok?: unknown, error?: unknown }} */
  const maybe = value;
  return maybe.ok === false && typeof maybe.error === 'string';
}

/**
 * @param {unknown} logger
 * @returns {{ info?: Function, warn?: Function }}
 */
function normalizeLogger(logger) {
  if (logger && typeof logger === 'object') {
    /** @type {{ info?: unknown, warn?: unknown }} */
    const maybe = logger;
    const info = typeof maybe.info === 'function' ? maybe.info.bind(logger) : undefined;
    const warn = typeof maybe.warn === 'function' ? maybe.warn.bind(logger) : undefined;
    if (info || warn) return { info, warn };
  }
  return createLogger('core/secure-plugin-loader');
}

function getDefaultBaseUrl() {
  if (typeof globalThis === 'undefined') return null;
  const href = toNonEmptyString(globalThis?.location?.href);
  return href || null;
}

/**
 * @param {string | null | undefined} baseUrl
 * @returns {URL | null}
 */
function parseBaseUrl(baseUrl) {
  const base = toNonEmptyString(baseUrl);
  if (!base) return null;
  try {
    return new URL(base);
  } catch {
    return null;
  }
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isLocalhostHost(hostname) {
  let h = String(hostname || '').trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (!h) return false;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '::1') return true;
  if (h === '0.0.0.0') return true;
  if (h === '127.0.0.1' || h.startsWith('127.')) return true;
  return false;
}

/**
 * @param {string} rawUrl
 * @param {string | null} baseUrl
 * @returns {{ ok: true, url: string, parsed: URL } | ErrorResult}
 */
function resolveUrl(rawUrl, baseUrl) {
  const input = toNonEmptyString(rawUrl);
  if (!input) return errorResult('url must be a non-empty string');

  const base = toNonEmptyString(baseUrl) || getDefaultBaseUrl();
  try {
    const parsed = base ? new URL(input, base) : new URL(input);
    return { ok: true, url: parsed.toString(), parsed };
  } catch (err) {
    const hint = base ? 'Invalid URL' : 'Invalid URL (baseUrl required for relative URLs)';
    return errorResult(hint);
  }
}

/**
 * @param {string} rawUrl
 * @param {{ baseUrl: string | null, allowInsecure: boolean, requireBaseUrl?: boolean, enforceSameOrigin?: boolean }} options
 * @returns {{ ok: true, url: string } | ErrorResult}
 */
function validatePluginUrl(rawUrl, { baseUrl, allowInsecure, requireBaseUrl, enforceSameOrigin }) {
  const base = toNonEmptyString(baseUrl) || null;
  if (requireBaseUrl && !base) {
    return errorResult('baseUrl is required in Node environments');
  }

  const resolved = resolveUrl(rawUrl, base);
  if (resolved.ok === false) return resolved;

  const { parsed } = resolved;
  const protocol = String(parsed.protocol || '').toLowerCase();
  if (protocol !== 'https:' && protocol !== 'http:') {
    return errorResult(`Unsupported URL protocol: ${protocol || '(empty)'}`);
  }

  const hostname = toNonEmptyString(parsed.hostname);
  if (!hostname) return errorResult('Invalid URL hostname');

  const isLocalhost = isLocalhostHost(hostname);
  if (protocol !== 'https:' && !isLocalhost && !allowInsecure) {
    return errorResult('URL must use HTTPS unless targeting localhost (or enable allowInsecure)');
  }

  if (enforceSameOrigin) {
    const baseParsed = parseBaseUrl(base);
    if (!baseParsed) return errorResult('baseUrl must be an absolute URL');
    if (parsed.origin !== baseParsed.origin) {
      return errorResult('URL must match baseUrl origin');
    }
  }

  return { ok: true, url: parsed.toString() };
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function bytesToBase64(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    out += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    out += BASE64_ALPHABET[(triple >> 6) & 0x3f];
    out += BASE64_ALPHABET[triple & 0x3f];
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const triple = bytes[i] << 16;
    out += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    out += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    out += '==';
  } else if (remaining === 2) {
    const triple = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    out += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    out += BASE64_ALPHABET[(triple >> 6) & 0x3f];
    out += '=';
  }

  return out;
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * @param {string} hash
 * @returns {string}
 */
function normalizeBase64(hash) {
  return String(hash || '').trim().replace(/=+$/g, '');
}

/**
 * @param {string} expectedHash
 * @returns {{ ok: true, format: 'base64' | 'hex', hash: string } | ErrorResult}
 */
function parseIntegrity(expectedHash) {
  const raw = toNonEmptyString(expectedHash);
  if (!raw) return errorResult('integrity is required');

  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith('sha256-')) {
    const hash = trimmed.slice('sha256-'.length).trim();
    if (!hash) return errorResult('integrity hash is missing');
    if (!/^[a-z0-9+/=]+$/i.test(hash)) return errorResult('integrity hash must be base64');
    return { ok: true, format: 'base64', hash };
  }

  if (lower.startsWith('sha256:')) {
    const hash = trimmed.slice('sha256:'.length).trim();
    if (!hash) return errorResult('integrity hash is missing');
    if (!/^[a-f0-9]+$/i.test(hash)) return errorResult('integrity hash must be hex');
    if (hash.length !== 64) return errorResult('integrity hash must be 64 hex chars');
    return { ok: true, format: 'hex', hash: hash.toLowerCase() };
  }

  return errorResult('Unsupported integrity format (expected sha256-... or sha256:...)');
}

/**
 * @param {string} content
 * @returns {Promise<{ ok: true, buffer: ArrayBuffer } | ErrorResult>}
 */
async function digestSha256(content) {
  if (typeof content !== 'string') return errorResult('content must be a string');
  if (typeof TextEncoder !== 'function') return errorResult('TextEncoder is unavailable');

  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (!cryptoObj?.subtle) return errorResult('Web Crypto API is unavailable');

  try {
    const data = new TextEncoder().encode(content);
    const buffer = await cryptoObj.subtle.digest('SHA-256', data);
    return { ok: true, buffer };
  } catch (err) {
    return errorResult(err);
  }
}

export class SecurePluginLoader {
  /**
   * @param {SecurePluginLoaderOptions} [options]
   */
  constructor(options = {}) {
    const opts = isPlainObject(options) ? options : {};
    this.logger = normalizeLogger(opts.logger);
    this.fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this.baseUrl = toNonEmptyString(opts.baseUrl) || null;
    this.allowInsecure = opts.allowInsecure === true;
  }

  /**
   * Load a single plugin with integrity verification.
   * @param {string} url
   * @param {LoadPluginOptions} [options]
   * @returns {Promise<any | ErrorResult>}
   */
  async loadPlugin(url, options) {
    const opts = isPlainObject(options) ? options : {};

    if (opts.skipIntegrity) {
      return errorResult('skipIntegrity is not allowed');
    }

    const integrity = toNonEmptyString(opts.integrity);
    if (!integrity) return errorResult('integrity is required');

    if (opts.config !== undefined && !isPlainObject(opts.config)) {
      return errorResult('config must be a plain object');
    }

    const allowInsecure = opts.allowInsecure === true || this.allowInsecure === true;
    const nodeLike = isNodeLike();
    const normalizedUrl = validatePluginUrl(url, {
      baseUrl: this.baseUrl,
      allowInsecure,
      requireBaseUrl: nodeLike,
      enforceSameOrigin: nodeLike,
    });
    if (normalizedUrl.ok === false) return normalizedUrl;

    if (!this.fetchImpl) return errorResult('fetch is unavailable');

    this.logger?.info?.('Loading plugin', { url: normalizedUrl.url });

    let code = '';
    try {
      const response = await this.fetchImpl(normalizedUrl.url, { method: 'GET' });
      if (!response || typeof response.ok !== 'boolean') {
        return errorResult('fetch returned an invalid response');
      }
      if (!response.ok) {
        return errorResult(`Failed to fetch plugin (status ${response.status})`);
      }
      code = await response.text();
    } catch (err) {
      this.logger?.warn?.('Plugin fetch failed', { url: normalizedUrl.url, error: toErrorMessage(err) });
      return errorResult(err);
    }

    const integrityResult = await this.verifyIntegrity(code, integrity);
    if (isErrorResultValue(integrityResult)) {
      this.logger?.warn?.('Plugin integrity check failed', { url: normalizedUrl.url, error: integrityResult.error });
      return integrityResult;
    }
    if (integrityResult !== true) {
      const msg = 'Plugin integrity mismatch';
      this.logger?.warn?.(msg, { url: normalizedUrl.url });
      return errorResult(msg);
    }

    if (typeof Blob !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return errorResult('Blob or URL.createObjectURL is unavailable');
    }

    let objectUrl = '';
    try {
      const blob = new Blob([code], { type: DEFAULT_BLOB_TYPE });
      objectUrl = URL.createObjectURL(blob);
      const mod = await import(/* @vite-ignore */ objectUrl);
      const plugin = mod?.default || mod;
      if (!plugin) return errorResult('Plugin module has no exports');

      this.logger?.info?.('Plugin loaded', { url: normalizedUrl.url, name: plugin?.name });
      return plugin;
    } catch (err) {
      this.logger?.warn?.('Plugin import failed', { url: normalizedUrl.url, error: toErrorMessage(err) });
      return errorResult(err);
    } finally {
      if (objectUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Verify a content string against an expected SRI hash.
   * @param {string} content
   * @param {string} expectedHash
   * @returns {Promise<boolean | ErrorResult>}
   */
  async verifyIntegrity(content, expectedHash) {
    const parsed = parseIntegrity(expectedHash);
    if (parsed.ok === false) return parsed;

    const digest = await digestSha256(content);
    if (digest.ok === false) return digest;

    if (parsed.format === 'hex') {
      const actual = bufferToHex(digest.buffer);
      return actual === parsed.hash;
    }

    const actual = normalizeBase64(bytesToBase64(new Uint8Array(digest.buffer)));
    const expected = normalizeBase64(parsed.hash);
    return actual === expected;
  }

  /**
   * Compute a SHA-256 hash in SRI format.
   * @param {string} content
   * @returns {Promise<string | ErrorResult>}
   */
  async computeHash(content) {
    const digest = await digestSha256(content);
    if (digest.ok === false) return digest;

    const base64 = bytesToBase64(new Uint8Array(digest.buffer));
    return `sha256-${base64}`;
  }

  /**
   * Load plugins from a manifest in parallel.
   * @param {PluginManifest} manifest
   * @returns {Promise<LoadPluginsResult | ErrorResult>}
   */
  async loadPlugins(manifest) {
    const data = isPlainObject(manifest) ? manifest : null;
    if (!data) return errorResult('manifest must be a plain object');

    const plugins = Array.isArray(data.plugins) ? data.plugins : null;
    if (!plugins) return errorResult('manifest.plugins must be an array');

    const tasks = plugins.map((entry, index) => this._loadManifestEntry(entry, index));
    const results = await Promise.all(tasks);

    /** @type {LoadedPluginResult[]} */
    const loaded = [];
    /** @type {FailedPluginResult[]} */
    const failed = [];

    for (const result of results) {
      if (result.ok) {
        loaded.push({
          url: result.url,
          integrity: result.integrity,
          config: result.config,
          plugin: result.plugin,
        });
      } else {
        const failedResult = /** @type {{ ok: false, url: string, integrity?: string, error: string }} */ (result);
        failed.push({
          url: failedResult.url,
          integrity: failedResult.integrity,
          error: failedResult.error,
        });
      }
    }

    return { loaded, failed };
  }

  /**
   * @param {unknown} entry
   * @param {number} index
   * @returns {Promise<{ ok: true, url: string, integrity: string, config?: Record<string, unknown>, plugin: any } | { ok: false, url: string, integrity?: string, error: string }>}
   */
  async _loadManifestEntry(entry, index) {
    if (!isPlainObject(entry)) {
      return {
        ok: false,
        url: '(unknown)',
        error: `plugins[${index}] must be an object`,
      };
    }

    const spec = /** @type {Record<string, unknown>} */ (entry);

    const rawUrl = toNonEmptyString(spec.url);
    const url = rawUrl || '(unknown)';
    const integrity = toNonEmptyString(spec.integrity);
    if (!rawUrl) {
      return {
        ok: false,
        url,
        error: `plugins[${index}].url must be a non-empty string`,
      };
    }
    if (!integrity) {
      return {
        ok: false,
        url,
        error: `plugins[${index}].integrity must be a non-empty string`,
      };
    }

    const rawConfig = spec.config;
    if (rawConfig !== undefined && !isPlainObject(rawConfig)) {
      return {
        ok: false,
        url,
        integrity,
        error: `plugins[${index}].config must be a plain object`,
      };
    }

    /** @type {Record<string, unknown> | undefined} */
    const config = rawConfig === undefined ? undefined : /** @type {Record<string, unknown>} */ (rawConfig);

    try {
      const plugin = await this.loadPlugin(url, { integrity, config });
      if (isErrorResultValue(plugin)) {
        return {
          ok: false,
          url,
          integrity,
          error: plugin.error,
        };
      }

      return {
        ok: true,
        url,
        integrity,
        config,
        plugin,
      };
    } catch (err) {
      return {
        ok: false,
        url,
        integrity,
        error: toErrorMessage(err),
      };
    }
  }
}

export default SecurePluginLoader;
