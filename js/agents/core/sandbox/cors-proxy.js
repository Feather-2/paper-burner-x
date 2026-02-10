/**
 * @file CORS Proxy — opt-in proxy for cross-origin fetch.
 * No default proxy (secure by design); user must call setCorsProxy() explicitly.
 */

/** @type {string|null} */
let proxyUrl = null;

/**
 * Set the CORS proxy URL prefix.
 * @param {string|null} url - Proxy URL prefix, e.g. 'https://corsproxy.io/?'. null disables.
 */
export function setCorsProxy(url) {
  proxyUrl = url;
}

/**
 * Get the current proxy URL.
 * @returns {string|null}
 */
export function getCorsProxy() {
  return proxyUrl;
}

/**
 * Build a proxied URL (no request sent).
 * @param {string} url - Target URL
 * @returns {string} Proxied URL, or the original URL when no proxy is set
 */
export function buildProxyUrl(url) {
  if (!proxyUrl) return url;
  return proxyUrl + encodeURIComponent(url);
}

/**
 * Fetch through the proxy. Falls back to plain fetch when no proxy is set.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export async function proxyFetch(url, options) {
  const target = buildProxyUrl(url);
  return fetch(target, options);
}
