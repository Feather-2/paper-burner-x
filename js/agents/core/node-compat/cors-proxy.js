/**
 * @file CORS Proxy — opt-in proxy for cross-origin fetch.
 * No default proxy (secure by design); user must call setCorsProxy() explicitly.
 *
 * Preferred API: createCorsProxy() factory (instance-scoped).
 * Module-level functions retained for backward compatibility but @deprecated.
 */

/**
 * @typedef {Object} CorsProxy
 * @property {(url: string|null) => void} set - Set proxy URL prefix; null disables.
 * @property {() => string|null} get - Get current proxy URL.
 * @property {(targetUrl: string) => string} buildUrl - Build proxied URL.
 * @property {(url: string, options?: RequestInit) => Promise<Response>} fetch - Fetch through proxy.
 */

/**
 * Create an instance-scoped CORS proxy.
 * @param {string|null} [initialUrl=null] - Optional initial proxy URL prefix.
 * @returns {CorsProxy}
 */
export function createCorsProxy(initialUrl = null) {
  let proxyUrl = initialUrl;

  return {
    set(url) { proxyUrl = url; },
    get() { return proxyUrl; },
    buildUrl(targetUrl) {
      if (!proxyUrl) return targetUrl;
      return proxyUrl + encodeURIComponent(targetUrl);
    },
    async fetch(url, options) {
      const target = proxyUrl
        ? proxyUrl + encodeURIComponent(url)
        : url;
      return fetch(target, options);
    },
  };
}

/** Default instance for backward-compatible module-level API. */
const _legacyScopes = new Map();

function normalizeScopeKey(options = {}) {
  const raw = typeof options === "string" ? options : options?.scope;
  const key = typeof raw === "string" ? raw.trim() : "";
  return key || "default";
}

function getLegacyProxy(options = {}) {
  const scope = normalizeScopeKey(options);
  if (!_legacyScopes.has(scope)) {
    _legacyScopes.set(scope, createCorsProxy());
  }
  return _legacyScopes.get(scope);
}

/**
 * @deprecated Use createCorsProxy() instead.
 * Set the CORS proxy URL prefix.
 * @param {string|null} url
 * @param {{ scope?: string }=} [options]
 */
export function setCorsProxy(url, options = {}) {
  getLegacyProxy(options).set(url);
}

/**
 * @deprecated Use createCorsProxy() instead.
 * Get the current proxy URL.
 * @param {{ scope?: string }=} [options]
 * @returns {string|null}
 */
export function getCorsProxy(options = {}) {
  return getLegacyProxy(options).get();
}

/**
 * @deprecated Use createCorsProxy() instead.
 * Build a proxied URL (no request sent).
 * @param {string} url
 * @param {{ scope?: string }=} [options]
 * @returns {string}
 */
export function buildProxyUrl(url, options = {}) {
  return getLegacyProxy(options).buildUrl(url);
}

/**
 * @deprecated Use createCorsProxy() instead.
 * Fetch through the proxy.
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {{ scope?: string }=} [proxyOptions]
 * @returns {Promise<Response>}
 */
export async function proxyFetch(url, options, proxyOptions = {}) {
  return getLegacyProxy(proxyOptions).fetch(url, options);
}

/**
 * Reset legacy module-scope proxy state.
 * @param {{ scope?: string }=} [options]
 * @returns {void}
 */
export function resetCorsProxy(options = {}) {
  const scope = normalizeScopeKey(options);
  _legacyScopes.delete(scope);
}
