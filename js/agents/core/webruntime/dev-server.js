import { normalizeVfsPath } from '../../vfs/path.js';

/**
 * @typedef {object} DevServerConfig
 * @property {object} vfs - VFS instance
 * @property {string} [root=''] - Document root directory
 * @property {Record<string, string>} [mimeOverrides] - Extra MIME mappings
 */

/**
 * @typedef {object} ServerResponse
 * @property {number} status
 * @property {Record<string, string>} headers
 * @property {Uint8Array|string} body
 */

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function createWeakEtag(bytes) {
  let hash = 5381;
  for (let i = 0; i < bytes.byteLength; i += 1) {
    hash = ((hash << 5) + hash) ^ bytes[i];
  }
  return `W/"${bytes.byteLength.toString(16)}-${(hash >>> 0).toString(16)}"`;
}

/**
 * @param {Record<string, string> | undefined} headers
 * @param {string} name
 * @returns {string | undefined}
 */
function getHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === 'string') {
      return value;
    }
  }
  return undefined;
}

/**
 * @typedef {object} HmrEvent
 * @property {'update'|'full-reload'} type
 * @property {string} path
 * @property {number} timestamp
 */

const MIME_TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

export class DevServer {
  /** @param {DevServerConfig} config */
  constructor(config) {
    this._vfs = config.vfs;
    this._root = normalizeVfsPath(config.root || '');
    this._mimeTypes = { ...MIME_TYPES, ...(config.mimeOverrides || {}) };
    this._hmrListeners = new Set();
    this._started = false;
  }

  /**
   * Handle a request and return a response.
   * @param {string} urlPath - Request path (e.g. '/index.html')
   * @param {Record<string, string>} [requestHeaders]
   * @returns {Promise<ServerResponse>}
   */
  async handleRequest(urlPath, requestHeaders) {
    try {
      let filePath = urlPath.startsWith('/') ? urlPath.slice(1) : urlPath;
      filePath = this._root ? `${this._root}/${filePath}` : filePath;
      filePath = normalizeVfsPath(filePath);

      const exists = await this._vfs.exists(filePath);
      if (!exists) {
        const indexPath = filePath ? `${filePath}/index.html` : 'index.html';
        const indexExists = await this._vfs.exists(indexPath);
        if (indexExists) filePath = indexPath;
        else return this._notFound(urlPath);
      } else {
        const stat = await this._vfs.stat(filePath);
        if (stat.isDirectory()) {
          const indexPath = filePath ? `${filePath}/index.html` : 'index.html';
          const indexExists = await this._vfs.exists(indexPath);
          if (indexExists) filePath = indexPath;
          else return this._notFound(urlPath);
        }
      }

      const body = await this._vfs.readFile(filePath);
      const ext = this._getExtension(filePath);
      const contentType = this._mimeTypes[ext] || 'application/octet-stream';
      const etag = createWeakEtag(body);
      const ifNoneMatch = getHeader(requestHeaders, 'if-none-match');
      if (ifNoneMatch && ifNoneMatch.split(',').map((token) => token.trim()).includes(etag)) {
        return {
          status: 304,
          headers: {
            ETag: etag,
            'Cache-Control': 'no-cache',
          },
          body: '',
        };
      }

      return {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(body.byteLength),
          ETag: etag,
          'Cache-Control': 'no-cache',
        },
        body,
      };
    } catch (err) {
      return this._serverError(err);
    }
  }

  /**
   * Register an HMR event listener.
   * @param {(event: HmrEvent) => void} listener
   */
  onHmr(listener) {
    this._hmrListeners.add(listener);
  }

  /**
   * Remove an HMR listener.
   * @param {(event: HmrEvent) => void} listener
   */
  offHmr(listener) {
    this._hmrListeners.delete(listener);
  }

  /**
   * Emit an HMR event.
   * @param {HmrEvent} event
   */
  emitHmr(event) {
    for (const listener of this._hmrListeners) {
      try { listener(event); } catch (_) { /* swallow */ }
    }
  }

  /**
   * Mark the server as started.
   * @param {number} [port=3000]
   */
  start(port = 3000) {
    this._port = port;
    this._started = true;
  }

  /** @returns {boolean} */
  get started() { return this._started; }

  /** @returns {number|undefined} */
  get port() { return this._port; }

  stop() { this._started = false; }

  _getExtension(path) {
    const dot = path.lastIndexOf('.');
    return dot >= 0 ? path.slice(dot).toLowerCase() : '';
  }

  _notFound(path) {
    return { status: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Not Found' };
  }

  _serverError(err) {
    return { status: 500, headers: { 'Content-Type': 'text/plain' }, body: 'Internal Server Error' };
  }
}

export { MIME_TYPES };
