/**
 * @fileoverview Node.js `url` module shim for browser sandbox.
 * Wraps the browser-native URL/URLSearchParams APIs and provides
 * legacy `url.parse()`, `url.format()`, `url.resolve()` helpers.
 */

// Re-export browser-native constructors
export { URL, URLSearchParams };

/**
 * Parse a URL string into its component parts (legacy Node API).
 * @param {string} urlString
 * @returns {object}
 */
export function parse(urlString) {
  const u = new URL(urlString, 'http://localhost');
  return {
    protocol: u.protocol,
    hostname: u.hostname,
    port: u.port,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    host: u.host,
    href: u.href,
    query: Object.fromEntries(u.searchParams),
    path: u.pathname + u.search,
  };
}

/**
 * Format a URL object back into a string.
 * @param {string|object} urlObj
 * @returns {string}
 */
export function format(urlObj) {
  if (typeof urlObj === 'string') return urlObj;
  const { protocol, hostname, port, pathname, search, hash } = urlObj;
  let result = '';
  if (protocol) result += protocol + '//';
  if (hostname) result += hostname;
  if (port) result += ':' + port;
  if (pathname) result += pathname;
  if (search) result += (search.startsWith('?') ? '' : '?') + search;
  if (hash) result += (hash.startsWith('#') ? '' : '#') + hash;
  return result;
}

/**
 * Resolve a relative URL against a base URL.
 * @param {string} from - base URL
 * @param {string} to   - relative URL
 * @returns {string}
 */
export function resolve(from, to) {
  return new URL(to, from).href;
}

export default { parse, format, resolve, URL, URLSearchParams };
