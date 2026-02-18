/**
 * POSIX path shim for browser sandbox.
 * @module path
 */

export const sep = '/';
export const delimiter = ':';

function getCurrentWorkingDirectory() {
  try {
    if (globalThis.process && typeof globalThis.process.cwd === 'function') {
      const cwd = globalThis.process.cwd();
      if (typeof cwd === 'string' && cwd) return cwd;
    }
  } catch {
    // Ignore and fallback to root.
  }
  return '/';
}

/**
 * Normalize a path string, resolving '.' and '..' segments.
 * @param {string} p
 * @returns {string}
 */
export function normalize(p) {
  if (typeof p !== 'string') throw new TypeError('Path must be a string');
  if (p.length === 0) return '.';
  const isAbs = p.charCodeAt(0) === 47; // '/'
  const trailingSlash = p.charCodeAt(p.length - 1) === 47;
  const segments = p.split('/');
  const out = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') {
        out.pop();
      } else if (!isAbs) {
        out.push('..');
      }
    } else {
      out.push(seg);
    }
  }
  let result = out.join('/');
  if (isAbs) result = '/' + result;
  if (trailingSlash && result.length > 1) result += '/';
  if (result === '') return isAbs ? '/' : '.';
  return result;
}

/**
 * Join path segments and normalize.
 * @param {...string} segments
 * @returns {string}
 */
export function join(...segments) {
  if (segments.length === 0) return '.';
  return normalize(segments.filter(s => typeof s === 'string' && s.length > 0).join('/'));
}

/**
 * Resolve path segments to an absolute path.
 * @param {...string} segments
 * @returns {string}
 */
export function resolve(...segments) {
  let resolvedPath = '';
  let resolvedAbsolute = false;

  for (let i = segments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    let segment;
    if (i >= 0) {
      segment = segments[i];
      if (typeof segment !== 'string') {
        throw new TypeError('Path must be a string');
      }
      if (!segment) continue;
    } else {
      segment = getCurrentWorkingDirectory();
    }

    resolvedPath = segment + (resolvedPath ? `/${resolvedPath}` : '');
    resolvedAbsolute = segment.charCodeAt(0) === 47;
  }

  if (!resolvedAbsolute) {
    resolvedPath = `/${resolvedPath}`;
  }

  return normalize(resolvedPath);
}

/**
 * Return the directory portion of a path.
 * @param {string} p
 * @returns {string}
 */
export function dirname(p) {
  if (typeof p !== 'string') throw new TypeError('Path must be a string');
  if (p.length === 0) return '.';
  const isAbs = p.charCodeAt(0) === 47;
  let end = -1;
  for (let i = p.length - 1; i >= 1; i--) {
    if (p.charCodeAt(i) === 47) {
      if (i !== p.length - 1) { end = i; break; }
    }
  }
  if (end === -1) return isAbs ? '/' : '.';
  if (isAbs && end === 0) return '/';
  return p.slice(0, end);
}

/**
 * Return the last segment of a path, optionally stripping an extension.
 * @param {string} p
 * @param {string} [ext]
 * @returns {string}
 */
export function basename(p, ext) {
  if (typeof p !== 'string') throw new TypeError('Path must be a string');
  let start = 0;
  for (let i = p.length - 1; i >= 0; i--) {
    if (p.charCodeAt(i) === 47) { start = i + 1; break; }
  }
  let base = p.slice(start);
  if (ext && base.endsWith(ext)) {
    base = base.slice(0, base.length - ext.length);
  }
  return base;
}

/**
 * Return the extension of a path (including the dot).
 * @param {string} p
 * @returns {string}
 */
export function extname(p) {
  if (typeof p !== 'string') throw new TypeError('Path must be a string');
  const base = basename(p);
  const idx = base.lastIndexOf('.');
  if (idx <= 0) return '';
  return base.slice(idx);
}

/**
 * Test whether a path is absolute.
 * @param {string} p
 * @returns {boolean}
 */
export function isAbsolute(p) {
  if (typeof p !== 'string') throw new TypeError('Path must be a string');
  return p.length > 0 && p.charCodeAt(0) === 47;
}

/**
 * Compute the relative path from `from` to `to`.
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function relative(from, to) {
  from = resolve(from);
  to = resolve(to);
  if (from === to) return '';
  const fromParts = from.split('/').filter(Boolean);
  const toParts = to.split('/').filter(Boolean);
  let common = 0;
  const len = Math.min(fromParts.length, toParts.length);
  for (let i = 0; i < len; i++) {
    if (fromParts[i] === toParts[i]) common++;
    else break;
  }
  const ups = fromParts.length - common;
  const rest = toParts.slice(common);
  const parts = [];
  for (let i = 0; i < ups; i++) parts.push('..');
  parts.push(...rest);
  return parts.join('/') || '.';
}

/**
 * Parse a path into { root, dir, base, name, ext }.
 * @param {string} p
 * @returns {{ root: string, dir: string, base: string, name: string, ext: string }}
 */
export function parse(p) {
  if (typeof p !== 'string') throw new TypeError('Path must be a string');
  const root = isAbsolute(p) ? '/' : '';
  const dir = dirname(p);
  const base = basename(p);
  const ext = extname(p);
  const name = ext ? base.slice(0, base.length - ext.length) : base;
  return { root, dir, base, name, ext };
}

/**
 * Build a path string from a parsed object (inverse of parse).
 * @param {{ dir?: string, root?: string, base?: string, name?: string, ext?: string }} obj
 * @returns {string}
 */
export function format(obj) {
  const dir = obj.dir || obj.root || '';
  const base = obj.base || ((obj.name || '') + (obj.ext || ''));
  if (dir === '/') return dir + base;
  return dir ? dir + '/' + base : base;
}

export const posix = {
  join, resolve, normalize, dirname, basename, extname,
  isAbsolute, relative, parse, format, sep, delimiter,
};

export default posix;
