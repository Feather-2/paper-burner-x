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
const _default = createCorsProxy();

/**
 * @deprecated Use createCorsProxy() instead.
 * Set the CORS proxy URL prefix.
 * @param {string|null} url
 */
export function setCorsProxy(url) {
  _default.set(url);
}

/**
 * @deprecated Use createCorsProxy() instead.
 * Get the current proxy URL.
 * @returns {string|null}
 */
export function getCorsProxy() {
  return _default.get();
}

/**
 * @deprecated Use createCorsProxy() instead.
 * Build a proxied URL (no request sent).
 * @param {string} url
 * @returns {string}
 */
export function buildProxyUrl(url) {
  return _default.buildUrl(url);
}

/**
 * @deprecated Use createCorsProxy() instead.
 * Fetch through the proxy.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function proxyFetch(url, options) {
  return _default.fetch(url, options);
}
