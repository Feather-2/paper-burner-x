/**
 * @typedef {object} PackageVersionInfo
 * @property {{ tarball: string, shasum: string }} dist
 * @property {Record<string, string>} [dependencies]
 */

/**
 * @typedef {object} PackageMetadata
 * @property {string} name
 * @property {Record<string, PackageVersionInfo>} versions
 * @property {Record<string, string>} [dist-tags]
 */

const INSTALL_V1_ACCEPT = 'application/vnd.npm.install-v1+json';

/**
 * Encode npm package name for registry URL.
 * Scoped packages must preserve `@` while escaping `/` to `%2f`.
 * @param {string} name
 * @returns {string}
 */
export function encodePackageName(name) {
  const encoded = encodeURIComponent(name);
  return encoded
    .replace(/^%40/, '@')
    .replace(/%2F/g, '%2f');
}

/**
 * Normalize registry URL by trimming trailing slash.
 * @param {string} registryUrl
 * @returns {string}
 */
export function normalizeRegistryUrl(registryUrl) {
  return String(registryUrl || 'https://registry.npmjs.org').replace(/\/+$/, '');
}

/**
 * Registry client with in-memory LRU cache.
 */
export class Registry {
  /**
   * @param {{
   *   registryUrl?: string,
   *   maxCacheSize?: number,
   *   fetchFn?: typeof fetch
   * }} [options]
   */
  constructor({
    registryUrl = 'https://registry.npmjs.org',
    maxCacheSize = 100,
    fetchFn = fetch,
  } = {}) {
    if (typeof fetchFn !== 'function') {
      throw new TypeError('Registry fetchFn must be a function');
    }

    this.registryUrl = normalizeRegistryUrl(registryUrl);
    this.maxCacheSize = Number.isFinite(maxCacheSize)
      ? Math.max(1, Math.trunc(maxCacheSize))
      : 100;
    this.fetchFn = fetchFn;
    /** @type {Map<string, PackageMetadata>} */
    this._cache = new Map();
  }

  /**
   * Fetch package metadata from npm registry.
   * Uses install-v1 metadata endpoint shape.
   * @param {string} name
   * @returns {Promise<PackageMetadata>}
   */
  async fetchPackageMetadata(name) {
    if (!name || typeof name !== 'string') {
      throw new TypeError('Package name must be a non-empty string');
    }

    const cached = this._getFromCache(name);
    if (cached) return cached;

    const encodedName = encodePackageName(name);
    const url = `${this.registryUrl}/${encodedName}`;
    const response = await this.fetchFn(url, {
      headers: { Accept: INSTALL_V1_ACCEPT },
    });

    if (!response || !response.ok) {
      const status = response ? response.status : 'unknown';
      throw new Error(`Failed to fetch package metadata for "${name}": HTTP ${status}`);
    }

    const metadata = /** @type {PackageMetadata} */ (await response.json());
    this._validateMetadata(name, metadata);
    this._setCache(name, metadata);
    return metadata;
  }

  /**
   * Clear in-memory metadata cache.
   * @returns {void}
   */
  clearCache() {
    this._cache.clear();
  }

  /**
   * @private
   * @param {string} name
   * @returns {PackageMetadata|null}
   */
  _getFromCache(name) {
    if (!this._cache.has(name)) return null;
    const value = this._cache.get(name) || null;
    if (!value) return null;
    this._cache.delete(name);
    this._cache.set(name, value);
    return value;
  }

  /**
   * @private
   * @param {string} name
   * @param {PackageMetadata} metadata
   * @returns {void}
   */
  _setCache(name, metadata) {
    if (this._cache.has(name)) this._cache.delete(name);
    this._cache.set(name, metadata);
    while (this._cache.size > this.maxCacheSize) {
      const oldestKey = this._cache.keys().next().value;
      if (typeof oldestKey === 'string') this._cache.delete(oldestKey);
      else break;
    }
  }

  /**
   * @private
   * @param {string} requestedName
   * @param {unknown} metadata
   * @returns {void}
   */
  _validateMetadata(requestedName, metadata) {
    if (!metadata || typeof metadata !== 'object') {
      throw new Error(`Invalid metadata for "${requestedName}"`);
    }
    const maybeMeta = /** @type {{ name?: unknown, versions?: unknown }} */ (metadata);
    if (typeof maybeMeta.name !== 'string' || !maybeMeta.versions || typeof maybeMeta.versions !== 'object') {
      throw new Error(`Invalid metadata shape for "${requestedName}"`);
    }
  }
}

export default Registry;
