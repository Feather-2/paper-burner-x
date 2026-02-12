import { MemoryVfs } from '../../../vfs/vfs.memory.js';
import { Registry } from './registry.js';
import { DependencyResolver } from './resolver.js';
import { TarballManager } from './tarball.js';

/**
 * @typedef {object} InstallOptions
 * @property {string} [version] semver range, default 'latest'
 * @property {boolean} [includeDeps] install dependencies, default true
 */

/**
 * @typedef {object} InstallResult
 * @property {string} name
 * @property {string} version
 * @property {number} deps
 */

/**
 * @typedef {object} EventPayloadMap
 * @property {{ name: string, version: string }} ['install:start']
 * @property {{ name: string, version: string, index: number, total: number }} ['install:progress']
 * @property {{ name: string, version: string, deps: number }} ['install:complete']
 * @property {{ name: string, error: unknown }} ['install:error']
 */

/**
 * Minimal event emitter (on/off/emit).
 */
export class EventEmitter {
  constructor() {
    /** @type {Map<string, Set<(payload: any) => void>>} */
    this._listeners = new Map();
  }

  /**
   * Register event listener.
   * @param {string} event
   * @param {(payload: any) => void} listener
   * @returns {() => void}
   */
  on(event, listener) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)?.add(listener);
    return () => this.off(event, listener);
  }

  /**
   * Remove event listener.
   * @param {string} event
   * @param {(payload: any) => void} listener
   * @returns {void}
   */
  off(event, listener) {
    this._listeners.get(event)?.delete(listener);
  }

  /**
   * Emit event payload.
   * @param {string} event
   * @param {any} payload
   * @returns {void}
   */
  emit(event, payload) {
    const listeners = this._listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // ignore listener failure
      }
    }
  }
}

/**
 * Browser-oriented npm package manager facade.
 */
export class PackageManager extends EventEmitter {
  /**
   * @param {{
   *   registry?: Registry,
   *   resolver?: DependencyResolver,
   *   tarball?: TarballManager,
   *   vfs?: any,
   *   corsProxy?: string
   * }} [options]
   */
  constructor({ registry, resolver, tarball, vfs, corsProxy } = {}) {
    super();
    this.registry = registry || new Registry();
    this.resolver = resolver || new DependencyResolver({ registry: this.registry });
    this.tarball = tarball || new TarballManager({ corsProxy });
    this.vfs = vfs || new MemoryVfs();
  }

  /**
   * Install package to /node_modules with optional dependencies.
   * @param {string} packageName
   * @param {InstallOptions} [options]
   * @returns {Promise<InstallResult>}
   */
  async install(packageName, options = {}) {
    const requestedVersion = options.version || 'latest';
    const includeDeps = options.includeDeps !== false;
    this.emit('install:start', { name: packageName, version: requestedVersion });

    try {
      const resolvedVersion = await this.resolver.resolve(packageName, requestedVersion);
      const installTargets = includeDeps
        ? await this.resolver.buildDependencyTree(packageName, resolvedVersion)
        : [await this._resolveSingle(packageName, resolvedVersion)];

      for (let index = 0; index < installTargets.length; index += 1) {
        const dep = installTargets[index];
        this.emit('install:progress', {
          name: dep.name,
          version: dep.version,
          index: index + 1,
          total: installTargets.length,
        });
        const tarballBuffer = await this.tarball.download(dep.tarballUrl);
        await this.tarball.extract(tarballBuffer, this.vfs, `/node_modules/${dep.name}`);
      }

      const result = {
        name: packageName,
        version: resolvedVersion,
        deps: Math.max(0, installTargets.length - 1),
      };
      this.emit('install:complete', result);
      return result;
    } catch (error) {
      this.emit('install:error', { name: packageName, error });
      throw error;
    }
  }

  /**
   * List installed packages under /node_modules.
   * @returns {Promise<string[]>}
   */
  async list() {
    let topLevelEntries;
    try {
      topLevelEntries = await this._readDirectory('/node_modules');
    } catch {
      return [];
    }

    /** @type {string[]} */
    const packages = [];
    for (const entry of topLevelEntries) {
      if (entry.kind !== 'dir') continue;
      if (entry.name.startsWith('@')) {
        const scopedEntries = await this._readDirectory(`/node_modules/${entry.name}`).catch(() => []);
        for (const scoped of scopedEntries) {
          if (scoped.kind === 'dir') packages.push(`${entry.name}/${scoped.name}`);
        }
        continue;
      }
      packages.push(entry.name);
    }

    return packages.sort((a, b) => a.localeCompare(b));
  }

  /**
   * Uninstall a package from VFS.
   * @param {string} name - Package name
   * @returns {Promise<void>}
   */
  async uninstall(name) {
    const pkgPath = `/node_modules/${name}`;
    const exists = await this.vfs.exists(pkgPath);
    if (!exists) {
      throw new Error(`Package ${name} is not installed`);
    }
    if (typeof this.vfs.rm === 'function') {
      await this.vfs.rm(pkgPath, { recursive: true });
      return;
    }
    if (typeof this.vfs.rmdir === 'function') {
      await this.vfs.rmdir(pkgPath, { recursive: true });
      return;
    }
    throw new Error('VFS does not support recursive removal');
  }

  /**
   * Resolve tarball URL for a single package version.
   * @private
   * @param {string} name
   * @param {string} version
   * @returns {Promise<{ name: string, version: string, tarballUrl: string }>}
   */
  async _resolveSingle(name, version) {
    const metadata = await this.registry.fetchPackageMetadata(name);
    const info = metadata.versions?.[version];
    const tarballUrl = info?.dist?.tarball;
    if (!tarballUrl) {
      throw new Error(`Missing tarball URL for "${name}@${version}"`);
    }
    return { name, version, tarballUrl };
  }

  /**
   * Read directory entries from VFS.
   * @private
   * @param {string} path
   * @returns {Promise<Array<{ name: string, kind: 'dir'|'file' }>>}
   */
  async _readDirectory(path) {
    if (typeof this.vfs.list === 'function') {
      const entries = await this.vfs.list(path);
      return (entries || []).map((entry) => ({
        name: String(entry.name),
        kind: entry.kind === 'dir' ? 'dir' : 'file',
      }));
    }

    if (typeof this.vfs.readdir === 'function') {
      const entries = await this.vfs.readdir(path, { withFileTypes: true });
      if (!Array.isArray(entries)) return [];
      if (entries.length === 0) return [];
      const sample = entries[0];
      if (typeof sample === 'string') {
        return entries.map((name) => ({ name, kind: 'dir' }));
      }
      return entries.map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? 'dir' : 'file',
      }));
    }

    throw new Error('VFS does not support directory listing');
  }
}

export default PackageManager;
