/**
 * @fileoverview Node.js `querystring` module shim for browser sandbox.
 */

/**
 * Serialize an object to a query string.
 * @param {object} obj
 * @param {string} [sep='&']
 * @param {string} [eq='=']
 * @returns {string}
 */
export function stringify(obj, sep = '&', eq = '=') {
  return Object.entries(obj)
    .map(([k, v]) => encodeURIComponent(k) + eq + encodeURIComponent(v))
    .join(sep);
}

/**
 * Parse a query string into an object.
 * @param {string} str
 * @param {string} [sep='&']
 * @param {string} [eq='=']
 * @returns {object}
 */
export function parse(str, sep = '&', eq = '=') {
  const result = {};
  if (!str) return result;
  str.split(sep).forEach(pair => {
    const [k, ...rest] = pair.split(eq);
    result[decodeURIComponent(k)] = decodeURIComponent(rest.join(eq));
  });
  return result;
}

/** @param {string} str */
export function escape(str) { return encodeURIComponent(str); }

/** @param {string} str */
export function unescape(str) { return decodeURIComponent(str); }

export const encode = stringify;
export const decode = parse;

export default { stringify, parse, escape, unescape, encode, decode };
