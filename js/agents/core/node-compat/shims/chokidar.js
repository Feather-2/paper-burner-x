/**
 * chokidar shim - File watcher library used by Vite
 * Wraps our VirtualFS watch implementation
 */

import { EventEmitter } from './events.js';

/**
 * @typedef {{
 *   close(): void
 * }} VfsWatcher
 *
 * @typedef {{
 *   existsSync(path: string): boolean
 *   statSync(path: string): { isDirectory(): boolean }
 *   readdirSync(path: string): string[]
 *   watch(path: string, options: { recursive?: boolean }, callback: (eventType: string, filename: string) => void): VfsWatcher
 * }} VirtualFS
 */

/** @type {VirtualFS | null} */
let globalVFS = null;

/**
 * Set the global VFS instance
 * @param {VirtualFS} vfs
 */
export function setVFS(vfs) {
  globalVFS = vfs;
}

/**
 * @typedef {Object} ChokidarOptions
 * @property {boolean} [persistent]
 * @property {string | RegExp | ((path: string) => boolean) | Array<string | RegExp | ((path: string) => boolean)>} [ignored]
 * @property {boolean} [ignoreInitial]
 * @property {boolean} [followSymlinks]
 * @property {string} [cwd]
 * @property {boolean} [disableGlobbing]
 * @property {boolean} [usePolling]
 * @property {number} [interval]
 * @property {number} [binaryInterval]
 * @property {boolean} [alwaysStat]
 * @property {number} [depth]
 * @property {boolean | { stabilityThreshold?: number; pollInterval?: number }} [awaitWriteFinish]
 * @property {boolean} [ignorePermissionErrors]
 * @property {boolean | number} [atomic]
 * @property {VirtualFS} [vfs]
 * @property {boolean} [debug]
 * @property {{ debug?: (...args: unknown[]) => void, warn?: (...args: unknown[]) => void }} [logger]
 */

export class FSWatcher extends EventEmitter {
  /**
   * @param {ChokidarOptions} [options]
   */
  constructor(options = {}) {
    super();
    /** @type {ChokidarOptions} */
    this.options = options;

    /** @type {VirtualFS | null | undefined} */
    const selectedVfs = options?.vfs || globalVFS;
    if (!selectedVfs) {
      throw new Error('chokidar: VirtualFS not initialized. Call setVFS first.');
    }
    /** @type {VirtualFS} */
    this.vfs = selectedVfs;
    /** @type {Map<string, VfsWatcher>} */
    this.watched = new Map();
    /** @type {boolean} */
    this.closed = false;
    /** @type {boolean} */
    this.ready = false;
    /** @type {Map<string, number> | undefined} */
    this._eventCounts = undefined;
    this._debug = !!this.options.debug;
    this._logger = this.options.logger || null;
  }

  /**
   * @param {...unknown} args
   */
  _logDebug(...args) {
    if (!this._debug) return;
    if (this._logger && typeof this._logger.debug === 'function') {
      this._logger.debug(...args);
      return;
    }
    console.debug(...args);
  }

  /**
   * @param {...unknown} args
   */
  _logWarn(...args) {
    if (this._logger && typeof this._logger.warn === 'function') {
      this._logger.warn(...args);
      return;
    }
    if (this._debug) console.warn(...args);
  }

  /**
   * @param {string} path
   * @returns {boolean}
   */
  shouldIgnore(path) {
    const { ignored } = this.options;
    if (!ignored) return false;

    const ignoreList = Array.isArray(ignored) ? ignored : [ignored];

    for (const pattern of ignoreList) {
      if (typeof pattern === 'string') {
        if (path === pattern || path.startsWith(pattern + '/')) return true;
      } else if (pattern instanceof RegExp) {
        if (pattern.test(path)) return true;
      } else if (typeof pattern === 'function') {
        if (pattern(path)) return true;
      }
    }

    return false;
  }

  /**
   * @param {string} path
   * @returns {string}
   */
  normalizePath(path) {
    // Apply cwd if set
    if (this.options.cwd && !path.startsWith('/')) {
      path = this.options.cwd + '/' + path;
    }
    // Normalize path
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    return path;
  }

  /**
   * @param {string | readonly string[]} paths
   * @returns {this}
   */
  add(paths) {
    if (this.closed) return this;

    const pathArray = Array.isArray(paths) ? paths : [paths];
    /** @type {Array<() => void>} */
    const pendingEmits = [];
    this._logDebug('[chokidar] add:', pathArray);

    for (const p of pathArray) {
      const normalized = this.normalizePath(p);

      if (this.shouldIgnore(normalized)) continue;
      if (this.watched.has(normalized)) continue;

      try {
        // Check if path exists
        if (!this.vfs.existsSync(normalized)) {
          // Path doesn't exist yet - that's ok, we'll watch the parent
          const parentPath = normalized.substring(0, normalized.lastIndexOf('/')) || '/';
          if (this.vfs.existsSync(parentPath)) {
            this.watchPath(parentPath, normalized);
          }
          continue;
        }

        const stats = this.vfs.statSync(normalized);

        // Emit initial 'add' events unless ignoreInitial is set
        if (!this.options.ignoreInitial) {
          if (stats.isDirectory()) {
            this.collectDirContents(normalized, pendingEmits);
          } else {
            pendingEmits.push(() => this.emit('add', normalized, stats));
          }
        }

        // Set up watching
        this.watchPath(normalized);

        // If directory, also watch contents recursively
        if (stats.isDirectory()) {
          this.watchDirRecursive(normalized);
        }
      } catch (err) {
        this.emit('error', err);
      }
    }

    // Emit ready event and initial add events asynchronously
    // so listeners can be attached after watch() is called
    if (!this.ready) {
      this.ready = true;
      setTimeout(() => {
        for (const emitFn of pendingEmits) {
          emitFn();
        }
        this.emit('ready');
      }, 0);
    }

    return this;
  }

  /**
   * @param {string} dirPath
   * @param {Array<() => void>} pendingEmits
   */
  collectDirContents(dirPath, pendingEmits) {
    try {
      const entries = this.vfs.readdirSync(dirPath);
      for (const entry of entries) {
        const fullPath = dirPath === '/' ? '/' + entry : dirPath + '/' + entry;
        if (this.shouldIgnore(fullPath)) continue;

        const stats = this.vfs.statSync(fullPath);
        if (stats.isDirectory()) {
          pendingEmits.push(() => this.emit('addDir', fullPath, stats));
          this.collectDirContents(fullPath, pendingEmits);
        } else {
          pendingEmits.push(() => this.emit('add', fullPath, stats));
        }
      }
    } catch {
      // Ignore errors during initial scan
    }
  }

  /**
   * @param {string} path
   * @param {string} [watchFor]
   */
  watchPath(path, watchFor) {
    if (this.watched.has(path)) return;

    const watcher = this.vfs.watch(path, { recursive: true }, (eventType, filename) => {
      if (this.closed) return;

      let fullPath;
      if (filename) {
        fullPath = path === '/' ? '/' + filename : path + '/' + filename;
      } else {
        fullPath = path;
      }

      // Debug: Track watch events per path to detect infinite loops
      const eventKey = `${eventType}:${fullPath}`;
      if (!this._eventCounts) this._eventCounts = new Map();
      const count = (this._eventCounts.get(eventKey) || 0) + 1;
      this._eventCounts.set(eventKey, count);
      if (count === 5) {
        this._logWarn(`[chokidar] Repeated event: ${eventType} on ${fullPath} (${count}+ times)`);
      }

      this._logDebug('[chokidar] event:', eventType, fullPath);

      // If we're watching for a specific path, only emit for that
      if (watchFor && fullPath !== watchFor && !fullPath.startsWith(watchFor + '/')) {
        return;
      }

      if (this.shouldIgnore(fullPath)) {
        this._logDebug('[chokidar] ignored:', fullPath);
        return;
      }

      if (eventType === 'rename') {
        // File was added or removed
        if (this.vfs.existsSync(fullPath)) {
          try {
            const stats = this.vfs.statSync(fullPath);
            if (stats.isDirectory()) {
              this._logDebug('[chokidar] emit addDir:', fullPath);
              this.emit('addDir', fullPath, stats);
            } else {
              this._logDebug('[chokidar] emit add:', fullPath);
              this.emit('add', fullPath, stats);
            }
          } catch {
            // Race condition - file may have been deleted
          }
        } else {
          this._logDebug('[chokidar] emit unlink:', fullPath);
          this.emit('unlink', fullPath);
        }
      } else if (eventType === 'change') {
        // File was modified
        try {
          const stats = this.vfs.statSync(fullPath);
          this._logDebug('[chokidar] emit change:', fullPath);
          this.emit('change', fullPath, stats);
        } catch {
          // File may have been deleted
          this.emit('unlink', fullPath);
        }
      }
    });

    this.watched.set(path, watcher);
  }

  /**
   * @param {string} dirPath
   * @param {number} [depth]
   */
  watchDirRecursive(dirPath, depth = 0) {
    if (this.options.depth !== undefined && depth > this.options.depth) return;

    try {
      const entries = this.vfs.readdirSync(dirPath);
      for (const entry of entries) {
        const fullPath = dirPath === '/' ? '/' + entry : dirPath + '/' + entry;
        if (this.shouldIgnore(fullPath)) continue;

        try {
          const stats = this.vfs.statSync(fullPath);
          if (stats.isDirectory()) {
            this.watchPath(fullPath);
            this.watchDirRecursive(fullPath, depth + 1);
          }
        } catch {
          // Ignore errors
        }
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * @param {string | readonly string[]} paths
   * @returns {this}
   */
  unwatch(paths) {
    const pathArray = Array.isArray(paths) ? paths : [paths];

    for (const p of pathArray) {
      const normalized = this.normalizePath(p);
      const watcher = this.watched.get(normalized);
      if (watcher) {
        watcher.close();
        this.watched.delete(normalized);
      }
    }

    return this;
  }

  /**
   * @returns {Promise<void>}
   */
  close() {
    this.closed = true;

    for (const watcher of this.watched.values()) {
      watcher.close();
    }
    this.watched.clear();

    this.emit('close');
    return Promise.resolve();
  }

  /**
   * @returns {Record<string, string[]>}
   */
  getWatched() {
    /** @type {Record<string, string[]>} */
    const result = {};

    for (const path of this.watched.keys()) {
      const dir = path.substring(0, path.lastIndexOf('/')) || '/';
      const basename = path.substring(path.lastIndexOf('/') + 1);

      if (!result[dir]) {
        result[dir] = [];
      }
      result[dir].push(basename);
    }

    return result;
  }
}

/**
 * Watch files/directories for changes
 * @param {string | readonly string[]} paths
 * @param {ChokidarOptions} [options]
 * @returns {FSWatcher}
 */
export function watch(paths, options) {
  const watcher = new FSWatcher(options);
  watcher.add(paths);
  return watcher;
}

export default { watch, FSWatcher, setVFS };
