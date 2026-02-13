import { MemoryVfs } from '../../../vfs/vfs.memory.js';
import { Registry } from './registry.js';
import { DependencyResolver } from './resolver.js';
import { TarballManager } from './tarball.js';
import { checkPackageCompatibility } from '../package-compatibility.js';

/**
 * @typedef {object} InstallOptions
 * @property {string} [version] semver range, default 'latest'
 * @property {boolean} [includeDeps] install dependencies, default true
 * @property {number} [compatibilityThreshold] warning threshold in [0, 1], default 0.3
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
 * @property {{
 *   name: string,
 *   version: string,
 *   score: number,
 *   threshold: number,
 *   warnings: string[],
 *   blockers: string[]
 * }} ['install:compatibility']
 * @property {{ name: string, version: string, index: number, total: number }} ['install:progress']
 * @property {{ name: string, version: string, deps: number }} ['install:complete']
 * @property {{ name: string, error: unknown }} ['install:error']
 */

/**
 * @typedef {object} InstallTarget
 * @property {string} name
 * @property {string} version
 * @property {string} tarballUrl
 */

/**
 * @typedef {object} PackageManagerOptions
 * @property {Registry} [registry]
 * @property {DependencyResolver} [resolver]
 * @property {TarballManager} [tarball]
 * @property {any} [vfs]
 * @property {string} [corsProxy]
 * @property {number} [concurrency] per-layer install concurrency, default 4
 * @property {(input: any) => Promise<any>} [compatibilityChecker]
 * @property {number} [compatibilityThreshold] warning threshold in [0, 1], default 0.3
 */

const DEFAULT_INSTALL_CONCURRENCY = 4;
const MAX_INSTALL_RETRIES = 2;
const DEFAULT_COMPATIBILITY_THRESHOLD = 0.3;

/**
 * @param {number|undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeConcurrency(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  const normalized = Math.floor(Number(value));
  if (normalized < 1) return fallback;
  return normalized;
}

/**
 * @param {number|undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeThreshold(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, Number(value)));
}

/**
 * Normalize compatibility score to [0, 1].
 * Supports legacy 0-100 scores.
 * @param {number|undefined} score
 * @returns {number}
 */
function normalizeCompatibilityScore(score) {
  if (!Number.isFinite(score)) return 1;
  const normalized = Number(score) > 1 ? Number(score) / 100 : Number(score);
  return Math.max(0, Math.min(1, normalized));
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.length > 0);
}

/**
 * @param {any} result
 * @returns {{ warnings: string[], blockers: string[] }}
 */
function extractCompatibilityData(result) {
  const warnings = toStringArray(result?.warnings);
  const blockers = toStringArray(result?.blockers);
  if (blockers.length > 0) return { warnings, blockers };
  return {
    warnings,
    blockers: toStringArray(result?.issues),
  };
}

/**
 * Invoke compatibility checker with signature fallback:
 * `checker(packageJson)` first, then `checker({ packageJson })`.
 * @param {(input: any) => Promise<any>} checker
 * @param {object} packageJson
 * @returns {Promise<any>}
 */
async function invokeCompatibilityChecker(checker, packageJson) {
  try {
    return await checker(packageJson);
  } catch {
    try {
      return await checker({ packageJson });
    } catch (secondError) {
      throw secondError;
    }
  }
}

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
   * @param {PackageManagerOptions} [options]
   */
  constructor({
    registry,
    resolver,
    tarball,
    vfs,
    corsProxy,
    concurrency,
    compatibilityChecker,
    compatibilityThreshold,
  } = {}) {
    super();
    this.registry = registry || new Registry();
    this.resolver = resolver || new DependencyResolver({ registry: this.registry });
    this.tarball = tarball || new TarballManager({ corsProxy });
    this.vfs = vfs || new MemoryVfs();
    this.concurrency = normalizeConcurrency(concurrency, DEFAULT_INSTALL_CONCURRENCY);
    this.maxInstallRetries = MAX_INSTALL_RETRIES;
    this.compatibilityChecker = compatibilityChecker || checkPackageCompatibility;
    this.compatibilityThreshold = normalizeThreshold(
      compatibilityThreshold,
      DEFAULT_COMPATIBILITY_THRESHOLD,
    );
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
    const compatibilityThreshold = normalizeThreshold(
      options.compatibilityThreshold,
      this.compatibilityThreshold,
    );
    this.emit('install:start', { name: packageName, version: requestedVersion });

    try {
      const resolvedVersion = await this.resolver.resolve(packageName, requestedVersion);
      const packageMetadata = await this._checkCompatibility(
        packageName,
        resolvedVersion,
        compatibilityThreshold,
      );
      const installTargets = includeDeps
        ? await this.resolver.buildDependencyTree(packageName, resolvedVersion)
        : [await this._resolveSingle(packageName, resolvedVersion, packageMetadata)];

      if (!includeDeps || installTargets.length <= 1) {
        await this._installSequentialTargets(installTargets);
      } else {
        const installLayers = await this._buildInstallLayers(installTargets);
        let installedCount = 0;
        for (const layer of installLayers) {
          await this._installLayer(layer, installedCount, installTargets.length);
          installedCount += layer.length;
        }
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
   * Run package compatibility check and emit install:compatibility.
   * A low score only emits warning and never blocks installation.
   * @private
   * @param {string} name
   * @param {string} version
   * @param {number} threshold
   * @returns {Promise<any|null>}
   */
  async _checkCompatibility(name, version, threshold) {
    let metadata = null;
    try {
      metadata = await this.registry.fetchPackageMetadata(name);
      const packageJson = metadata?.versions?.[version];
      if (!packageJson || typeof packageJson !== 'object') {
        this.emit('install:compatibility', {
          name,
          version,
          score: 1,
          threshold,
          warnings: ['No package manifest found for compatibility check'],
          blockers: [],
        });
        return metadata;
      }

      const rawResult = await invokeCompatibilityChecker(this.compatibilityChecker, packageJson);
      const score = normalizeCompatibilityScore(rawResult?.score);
      const { warnings, blockers } = extractCompatibilityData(rawResult || {});
      if (score < threshold) {
        warnings.push(
          `Compatibility score ${score.toFixed(2)} is below threshold ${threshold.toFixed(2)}; installation continues.`,
        );
      }
      this.emit('install:compatibility', {
        name,
        version,
        score,
        threshold,
        warnings,
        blockers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('install:compatibility', {
        name,
        version,
        score: 1,
        threshold,
        warnings: [`Compatibility check failed: ${message}`],
        blockers: [],
      });
    }

    return metadata;
  }

  /**
   * Install targets serially and keep original behavior for single-package installs.
   * @private
   * @param {InstallTarget[]} installTargets
   * @returns {Promise<void>}
   */
  async _installSequentialTargets(installTargets) {
    for (let index = 0; index < installTargets.length; index += 1) {
      const dep = installTargets[index];
      this.emit('install:progress', {
        name: dep.name,
        version: dep.version,
        index: index + 1,
        total: installTargets.length,
      });
      await this._installTargetWithRetry(dep);
    }
  }

  /**
   * Install one topological layer with bounded concurrency.
   * @private
   * @param {InstallTarget[]} layer
   * @param {number} installedCount
   * @param {number} total
   * @returns {Promise<void>}
   */
  async _installLayer(layer, installedCount, total) {
    /** @type {Array<{ dep: InstallTarget, index: number }>} */
    const scheduled = layer.map((dep, offset) => ({
      dep,
      index: installedCount + offset + 1,
    }));
    const workerCount = Math.min(this.concurrency, scheduled.length);
    let cursor = 0;

    const runWorker = async () => {
      while (cursor < scheduled.length) {
        const current = scheduled[cursor];
        cursor += 1;
        this.emit('install:progress', {
          name: current.dep.name,
          version: current.dep.version,
          index: current.index,
          total,
        });
        await this._installTargetWithRetry(current.dep);
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  }

  /**
   * Install one target with retry for transient failures.
   * @private
   * @param {InstallTarget} target
   * @returns {Promise<void>}
   */
  async _installTargetWithRetry(target) {
    for (let attempt = 0; attempt <= this.maxInstallRetries; attempt += 1) {
      try {
        const tarballBuffer = await this.tarball.download(target.tarballUrl);
        await this.tarball.extract(tarballBuffer, this.vfs, `/node_modules/${target.name}`);
        return;
      } catch (error) {
        if (attempt >= this.maxInstallRetries) throw error;
      }
    }
  }

  /**
   * Build install layers using dependency graph topological sorting.
   * Dependencies are installed before dependents.
   * @private
   * @param {InstallTarget[]} installTargets
   * @returns {Promise<InstallTarget[][]>}
   */
  async _buildInstallLayers(installTargets) {
    /** @type {Map<string, InstallTarget>} */
    const targetByKey = new Map();
    /** @type {Map<string, number>} */
    const orderByKey = new Map();
    /** @type {Map<string, number>} */
    const inDegree = new Map();
    /** @type {Map<string, Set<string>>} */
    const dependentsByKey = new Map();

    for (let index = 0; index < installTargets.length; index += 1) {
      const target = installTargets[index];
      const targetKey = this._getTargetKey(target.name, target.version);
      targetByKey.set(targetKey, target);
      orderByKey.set(targetKey, index);
      inDegree.set(targetKey, 0);
      dependentsByKey.set(targetKey, new Set());
    }

    /** @type {Map<string, any>} */
    const metadataCache = new Map();
    /** @type {Map<string, string>} */
    const versionCache = new Map();

    for (const target of installTargets) {
      const targetKey = this._getTargetKey(target.name, target.version);
      let metadata = metadataCache.get(target.name);
      if (!metadata) {
        metadata = await this.registry.fetchPackageMetadata(target.name);
        metadataCache.set(target.name, metadata);
      }

      const versionInfo = metadata?.versions?.[target.version];
      if (!versionInfo) continue;

      const dependencies = versionInfo.dependencies || {};
      for (const [dependencyName, dependencyRange] of Object.entries(dependencies)) {
        const dependencyVersion = await this._resolveDependencyVersion(
          dependencyName,
          dependencyRange,
          versionCache,
        );
        const dependencyKey = this._getTargetKey(dependencyName, dependencyVersion);
        if (!targetByKey.has(dependencyKey)) continue;

        dependentsByKey.get(dependencyKey)?.add(targetKey);
        inDegree.set(targetKey, (inDegree.get(targetKey) || 0) + 1);
      }
    }

    let currentLayerKeys = this._sortKeysByOrder(
      Array.from(inDegree.entries())
        .filter(([, degree]) => degree === 0)
        .map(([key]) => key),
      orderByKey,
    );

    /** @type {InstallTarget[][]} */
    const layers = [];
    let visitedCount = 0;

    while (currentLayerKeys.length > 0) {
      /** @type {InstallTarget[]} */
      const layer = [];
      /** @type {Set<string>} */
      const nextLayerKeys = new Set();

      for (const key of currentLayerKeys) {
        const target = targetByKey.get(key);
        if (!target) continue;
        layer.push(target);
        visitedCount += 1;

        const dependents = dependentsByKey.get(key);
        if (!dependents) continue;
        for (const dependentKey of dependents) {
          const nextDegree = (inDegree.get(dependentKey) || 0) - 1;
          inDegree.set(dependentKey, nextDegree);
          if (nextDegree === 0) nextLayerKeys.add(dependentKey);
        }
      }

      if (layer.length > 0) layers.push(layer);
      currentLayerKeys = this._sortKeysByOrder(Array.from(nextLayerKeys), orderByKey);
    }

    if (visitedCount !== installTargets.length || layers.length === 0) {
      return [installTargets];
    }

    return layers;
  }

  /**
   * Resolve dependency version with small in-memory cache.
   * @private
   * @param {string} dependencyName
   * @param {string} dependencyRange
   * @param {Map<string, string>} cache
   * @returns {Promise<string>}
   */
  async _resolveDependencyVersion(dependencyName, dependencyRange, cache) {
    const cacheKey = `${dependencyName}@${dependencyRange}`;
    if (cache.has(cacheKey)) return /** @type {string} */ (cache.get(cacheKey));
    const resolved = await this.resolver.resolve(dependencyName, dependencyRange);
    cache.set(cacheKey, resolved);
    return resolved;
  }

  /**
   * @private
   * @param {string} name
   * @param {string} version
   * @returns {string}
   */
  _getTargetKey(name, version) {
    return `${name}@${version}`;
  }

  /**
   * @private
   * @param {string[]} keys
   * @param {Map<string, number>} orderByKey
   * @returns {string[]}
   */
  _sortKeysByOrder(keys, orderByKey) {
    return keys.sort((left, right) => (orderByKey.get(left) || 0) - (orderByKey.get(right) || 0));
  }

  /**
   * Resolve tarball URL for a single package version.
   * @private
   * @param {string} name
   * @param {string} version
   * @param {any} [metadata]
   * @returns {Promise<{ name: string, version: string, tarballUrl: string }>}
   */
  async _resolveSingle(name, version, metadata) {
    const resolvedMetadata = metadata || await this.registry.fetchPackageMetadata(name);
    const info = resolvedMetadata.versions?.[version];
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
