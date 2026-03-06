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
 * @property {boolean} [strictCompatibility] when true, blockers/low score fail installation
 */

/**
 * @typedef {object} InstallResult
 * @property {string} name
 * @property {string} version
 * @property {number} deps
 */

/**
 * @typedef {Record<string, unknown>} EventPayloadMap
 */

/**
 * @typedef {object} InstallTarget
 * @property {string} name
 * @property {string} version
 * @property {string} tarballUrl
 * @property {string} shasum
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
 * @property {boolean} [strictCompatibility] when true, blockers/low score fail installation
 * @property {number} [retryBackoffMs] retry base backoff in ms, default 100
 */

const DEFAULT_INSTALL_CONCURRENCY = 4;
const MAX_INSTALL_RETRIES = 2;
const DEFAULT_COMPATIBILITY_THRESHOLD = 0.3;
const DEFAULT_RETRY_BACKOFF_MS = 100;

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
 * @param {number|undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeBackoff(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(Number(value)));
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function delay(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {any} packageJson
 * @param {string} packageName
 * @returns {string[]}
 */
function collectBinCommands(packageJson, packageName) {
  if (!packageJson || typeof packageJson !== 'object') return [];
  const commands = [];
  const normalizedName = String(packageName || '').trim();
  const defaultCommand = normalizedName.startsWith('@')
    ? normalizedName.split('/')[1] || ''
    : normalizedName;
  const bin = packageJson.bin;
  if (typeof bin === 'string') {
    if (defaultCommand) commands.push(defaultCommand);
    return commands;
  }
  if (bin && typeof bin === 'object' && !Array.isArray(bin)) {
    for (const key of Object.keys(bin)) {
      const name = String(key || '').trim().replace(/^\/+/, '');
      if (name) commands.push(name);
    }
  }
  return commands;
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
    strictCompatibility,
    retryBackoffMs,
  } = {}) {
    super();
    this._integrityFailureReported = new Set();
    this.registry = registry || new Registry();
    this.resolver = resolver || new DependencyResolver({ registry: this.registry });
    this.tarball = tarball || new TarballManager({
      corsProxy,
      onIntegrityFailure: (details) => {
        this._emitIntegrityFailure({
          name: details.packageName || 'unknown',
          version: details.packageVersion || 'unknown',
          expectedShasum: details.expectedShasum,
          actualShasum: details.actualShasum,
          tarballUrl: details.url,
        });
      },
    });
    this.vfs = vfs || new MemoryVfs();
    this.concurrency = normalizeConcurrency(concurrency, DEFAULT_INSTALL_CONCURRENCY);
    this.maxInstallRetries = MAX_INSTALL_RETRIES;
    this.compatibilityChecker = compatibilityChecker || checkPackageCompatibility;
    this.compatibilityThreshold = normalizeThreshold(
      compatibilityThreshold,
      DEFAULT_COMPATIBILITY_THRESHOLD,
    );
    this.strictCompatibility = strictCompatibility === true;
    this.retryBackoffMs = normalizeBackoff(retryBackoffMs, DEFAULT_RETRY_BACKOFF_MS);
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
    const strictCompatibility = options.strictCompatibility === true || this.strictCompatibility;
    this.emit('install:start', { name: packageName, version: requestedVersion });

    try {
      const resolvedVersion = await this.resolver.resolve(packageName, requestedVersion);
      const packageMetadata = await this._checkCompatibility(
        packageName,
        resolvedVersion,
        compatibilityThreshold,
        strictCompatibility,
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
    await this._cleanupBinStubs(name, pkgPath);
    await this._removePath(pkgPath);
  }

  /**
   * @private
   * @param {string} packageName
   * @param {string} pkgPath
   * @returns {Promise<void>}
   */
  async _cleanupBinStubs(packageName, pkgPath) {
    let packageJson = null;
    try {
      if (typeof this.vfs.readText === 'function') {
        packageJson = JSON.parse(await this.vfs.readText(`${pkgPath}/package.json`));
      } else if (typeof this.vfs.readFile === 'function') {
        const bytes = await this.vfs.readFile(`${pkgPath}/package.json`);
        const content = typeof TextDecoder === 'function'
          ? new TextDecoder().decode(bytes)
          : String.fromCharCode(...bytes);
        packageJson = JSON.parse(content);
      }
    } catch {
      packageJson = null;
    }

    const commands = collectBinCommands(packageJson, packageName);
    for (const command of commands) {
      await this._removePath(`/node_modules/.bin/${command}`).catch(() => {});
    }
  }

  /**
   * @private
   * @param {string} path
   * @returns {Promise<void>}
   */
  async _removePath(path) {
    if (typeof this.vfs.rm === 'function') {
      await this.vfs.rm(path, { recursive: true, force: true });
      return;
    }
    if (typeof this.vfs.unlink === 'function') {
      try {
        await this.vfs.unlink(path);
        return;
      } catch {
        // fallthrough
      }
    }
    if (typeof this.vfs.rmdir === 'function') {
      await this.vfs.rmdir(path, { recursive: true });
      return;
    }
    if (typeof this.vfs.remove === 'function') {
      await this.vfs.remove(path);
      return;
    }
    throw new Error(`VFS does not support recursive removal: ${path}`);
  }

  /**
   * Run package compatibility check and emit install:compatibility.
   * @private
   * @param {string} name
   * @param {string} version
   * @param {number} threshold
   * @param {boolean} strictCompatibility
   * @returns {Promise<any|null>}
   */
  async _checkCompatibility(name, version, threshold, strictCompatibility) {
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

      if (strictCompatibility && blockers.length > 0) {
        const error = /** @type {Error & { code?: string }} */ (new Error(
          `Compatibility blockers detected for ${name}@${version}: ${blockers.join(', ')}`,
        ));
        error.code = 'ERR_COMPATIBILITY_BLOCKED';
        throw error;
      }
      if (strictCompatibility && score < threshold) {
        const error = /** @type {Error & { code?: string }} */ (new Error(
          `Compatibility score ${score.toFixed(2)} is below threshold ${threshold.toFixed(2)} for ${name}@${version}`,
        ));
        error.code = 'ERR_COMPATIBILITY_SCORE';
        throw error;
      }
    } catch (error) {
      if (error?.code === 'ERR_COMPATIBILITY_BLOCKED' || error?.code === 'ERR_COMPATIBILITY_SCORE') {
        throw error;
      }
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
   * Emit integrity-failed once per package@version.
   * @private
   * @param {{ name: string, version: string, expectedShasum: string, actualShasum: string, tarballUrl: string }} payload
   * @returns {void}
   */
  _emitIntegrityFailure(payload) {
    const key = `${payload.name}@${payload.version}`;
    if (this._integrityFailureReported.has(key)) return;
    this._integrityFailureReported.add(key);
    this.emit('install:integrity-failed', payload);
  }

  /**
   * Install one target with retry for transient failures.
   * @private
   * @param {InstallTarget} target
   * @returns {Promise<void>}
   */
  async _installTargetWithRetry(target) {
    if (!target.shasum) {
      throw new Error(`Missing tarball shasum for "${target.name}@${target.version}"`);
    }

    for (let attempt = 0; attempt <= this.maxInstallRetries; attempt += 1) {
      if (attempt > 0) {
        await this._removePath(`/node_modules/${target.name}`).catch(() => {});
      }
      try {
        const tarballBuffer = await this.tarball.download(target.tarballUrl, {
          expectedShasum: target.shasum,
          auditContext: {
            packageName: target.name,
            packageVersion: target.version,
          },
        });
        await this.tarball.extract(tarballBuffer, this.vfs, `/node_modules/${target.name}`);
        return;
      } catch (error) {
        if (error?.code === 'ERR_TARBALL_INTEGRITY_MISMATCH') {
          const expectedShasum = error?.details?.expectedShasum || target.shasum;
          const actualShasum = error?.details?.actualShasum || 'unknown';
          this._emitIntegrityFailure({
            name: target.name,
            version: target.version,
            expectedShasum,
            actualShasum,
            tarballUrl: target.tarballUrl,
          });
          throw error;
        }
        if (error?.code === 'ERR_TARBALL_SHASUM_INVALID') throw error;
        if (attempt >= this.maxInstallRetries) throw error;
        const backoffMs = this.retryBackoffMs * (2 ** attempt);
        await delay(backoffMs);
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
   * @returns {Promise<{ name: string, version: string, tarballUrl: string, shasum: string }>}
   */
  async _resolveSingle(name, version, metadata) {
    const resolvedMetadata = metadata || await this.registry.fetchPackageMetadata(name);
    const info = resolvedMetadata.versions?.[version];
    const tarballUrl = info?.dist?.tarball;
    const shasum = info?.dist?.shasum;
    if (!tarballUrl) {
      throw new Error(`Missing tarball URL for "${name}@${version}"`);
    }
    if (!shasum) {
      throw new Error(`Missing tarball shasum for "${name}@${version}"`);
    }
    return { name, version, tarballUrl, shasum };
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
        const typedEntries = [];
        for (const name of entries) {
          const normalizedName = String(name);
          const statPath = `${path.replace(/\/$/, '')}/${normalizedName}`;
          /** @type {'file'|'dir'} */
          let kind = 'dir';
          try {
            if (typeof this.vfs.stat === 'function') {
              const stat = await this.vfs.stat(statPath);
              kind = stat?.isDirectory?.() ? 'dir' : 'file';
            }
          } catch {
            kind = 'dir';
          }
          typedEntries.push({ name: normalizedName, kind });
        }
        return typedEntries;
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
