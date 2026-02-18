/**
 * @typedef {object} ResolvedDep
 * @property {string} name
 * @property {string} version
 * @property {string} tarballUrl
 * @property {string} shasum
 */

/**
 * Parsed semver object.
 * @typedef {object} ParsedSemver
 * @property {number} major
 * @property {number} minor
 * @property {number} patch
 * @property {string[]} prerelease
 * @property {string[]} build
 */

/**
 * Parse strict semver string.
 * Accepts `v1.2.3` with optional pre-release/build metadata.
 * @param {string} str
 * @returns {ParsedSemver|null}
 */
export function parseSemver(str) {
  if (typeof str !== 'string') return null;
  const normalized = str.trim().replace(/^v/, '');
  const match = normalized.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
  };
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isNumericIdentifier(value) {
  return /^\d+$/.test(value);
}

/**
 * @param {string[]} left
 * @param {string[]} right
 * @returns {-1|0|1}
 */
function comparePrerelease(left, right) {
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;

    const aIsNumber = isNumericIdentifier(a);
    const bIsNumber = isNumericIdentifier(b);
    if (aIsNumber && bIsNumber) {
      const diff = Number(a) - Number(b);
      if (diff !== 0) return diff > 0 ? 1 : -1;
      continue;
    }
    if (aIsNumber && !bIsNumber) return -1;
    if (!aIsNumber && bIsNumber) return 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

/**
 * Compare two semver versions.
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return /** @type {-1|0|1} */ (a === b ? 0 : (a > b ? 1 : -1));
  if (!pa) return -1;
  if (!pb) return 1;

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;
  if (pa.prerelease.length === 0 && pb.prerelease.length > 0) return 1;
  if (pa.prerelease.length > 0 && pb.prerelease.length === 0) return -1;
  if (pa.prerelease.length > 0 || pb.prerelease.length > 0) {
    return comparePrerelease(pa.prerelease, pb.prerelease);
  }
  return 0;
}

/**
 * @param {string} range
 * @returns {string|null}
 */
function detectUnsupportedProtocol(range) {
  const trimmed = String(range || '').trim();
  const match = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!match) return null;
  const protocol = match[1].toLowerCase();
  if (['file', 'link', 'workspace', 'npm'].includes(protocol)) return protocol;
  return null;
}

/**
 * @param {string} name
 * @param {string} range
 * @throws {Error}
 */
function throwUnsupportedRangeProtocol(name, range) {
  const protocol = detectUnsupportedProtocol(range);
  if (!protocol) return;
  const error = new Error(
    `Unsupported version range protocol "${protocol}:" for "${name}" with range "${range}"`,
  );
  error.code = 'ERR_UNSUPPORTED_VERSION_RANGE_PROTOCOL';
  error.protocol = protocol;
  throw error;
}

/**
 * @param {string} version
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesWildcard(version, pattern) {
  const parsed = parseSemver(version);
  if (!parsed) return false;

  const normalized = pattern.trim().replace(/^v/, '');
  if (!normalized || normalized === '*' || normalized.toLowerCase() === 'x') return true;

  const parts = normalized.split('.');
  const values = [parsed.major, parsed.minor, parsed.patch];
  for (let index = 0; index < parts.length; index += 1) {
    const token = parts[index];
    if (!token || token === '*' || token.toLowerCase() === 'x') return true;
    const numeric = Number(token);
    if (!Number.isFinite(numeric) || numeric !== values[index]) return false;
  }
  return true;
}

/**
 * @param {string} version
 * @param {string} comparator
 * @returns {boolean}
 */
function applyComparator(version, comparator) {
  const match = comparator.match(/^(>=|<=|>|<)\s*(.+)$/);
  if (!match) return false;
  const operator = match[1];
  const target = match[2].trim();
  const diff = compareVersions(version, target);

  if (operator === '>=') return diff >= 0;
  if (operator === '>') return diff > 0;
  if (operator === '<=') return diff <= 0;
  if (operator === '<') return diff < 0;
  return false;
}

/**
 * Check whether a version satisfies a semver range.
 * Supports exact, caret, tilde, comparators, OR, wildcard, and hyphen ranges.
 * @param {string} version
 * @param {string} range
 * @returns {boolean}
 */
export function satisfies(version, range) {
  const parsedVersion = parseSemver(version);
  if (!parsedVersion || typeof range !== 'string') return false;

  const normalizedRange = range.trim();
  if (!normalizedRange) return false;

  if (normalizedRange.includes('||')) {
    return normalizedRange.split('||').some((part) => satisfies(version, part.trim()));
  }

  const hyphenMatch = normalizedRange.match(/^(.+)\s+-\s+(.+)$/);
  if (hyphenMatch) {
    const min = hyphenMatch[1].trim();
    const max = hyphenMatch[2].trim();
    return compareVersions(version, min) >= 0 && compareVersions(version, max) <= 0;
  }

  if (normalizedRange.startsWith('^')) {
    const baseRange = normalizedRange.slice(1).trim().replace(/^v/, '');
    const base = parseSemver(baseRange);
    if (!base) return false;
    if (compareVersions(version, baseRange) < 0) return false;
    if (base.major > 0) {
      return compareVersions(version, `${base.major + 1}.0.0`) < 0;
    }
    if (base.minor > 0) {
      return compareVersions(version, `0.${base.minor + 1}.0`) < 0;
    }
    return compareVersions(version, `0.0.${base.patch + 1}`) < 0;
  }

  if (normalizedRange.startsWith('~')) {
    const baseRange = normalizedRange.slice(1).trim().replace(/^v/, '');
    const base = parseSemver(baseRange);
    if (!base) return false;
    return compareVersions(version, baseRange) >= 0
      && compareVersions(version, `${base.major}.${base.minor + 1}.0`) < 0;
  }

  const compactComparators = normalizedRange.replace(/(>=|<=|>|<)\s+/g, '$1');
  const comparatorTokens = compactComparators.split(/\s+/).filter(Boolean);
  if (comparatorTokens.length > 0 && comparatorTokens.every((token) => /^(>=|<=|>|<)/.test(token))) {
    return comparatorTokens.every((token) => applyComparator(version, token));
  }

  if (
    normalizedRange === '*'
    || normalizedRange.toLowerCase() === 'x'
    || normalizedRange.includes('*')
    || /(^|\.)x($|\.)/i.test(normalizedRange)
  ) {
    return matchesWildcard(version, normalizedRange);
  }

  if (/^\d+(\.\d+)?$/.test(normalizedRange)) {
    return matchesWildcard(version, normalizedRange);
  }

  const parsedExact = parseSemver(normalizedRange);
  if (parsedExact) {
    return compareVersions(version, normalizedRange) === 0;
  }

  return false;
}

/**
 * @typedef {object} ResolverConfig
 * @property {{ fetchPackageMetadata: (name: string) => Promise<any> }} registry
 */

export class DependencyResolver {
  /**
   * @param {ResolverConfig} config
   */
  constructor({ registry }) {
    if (!registry || typeof registry.fetchPackageMetadata !== 'function') {
      throw new TypeError('DependencyResolver requires a registry with fetchPackageMetadata');
    }
    this.registry = registry;
  }

  /**
   * Resolve the best matching package version for a semver range.
   * @param {string} name
   * @param {string} [versionRange='latest']
   * @returns {Promise<string>}
   */
  async resolve(name, versionRange = 'latest') {
    const metadata = await this.registry.fetchPackageMetadata(name);
    const versions = Object.keys(metadata.versions || {});
    if (versions.length === 0) {
      throw new Error(`No versions found for package "${name}"`);
    }

    const distTags = metadata['dist-tags'] || {};
    const range = versionRange || 'latest';
    throwUnsupportedRangeProtocol(name, range);

    if (range === 'latest') {
      const latest = distTags.latest;
      if (typeof latest === 'string' && metadata.versions[latest]) return latest;
      return versions.sort(compareVersions).pop() || versions[0];
    }

    if (typeof distTags[range] === 'string' && metadata.versions[distTags[range]]) {
      return distTags[range];
    }

    const matches = versions.filter((version) => satisfies(version, range));
    if (matches.length === 0) {
      throw new Error(`No matching version for "${name}" with range "${range}"`);
    }

    matches.sort(compareVersions);
    return matches[matches.length - 1];
  }

  /**
   * Build a flat dependency list for package and transitive dependencies.
   * Uses visited set to avoid circular recursion.
   * @param {string} name
   * @param {string} version
   * @returns {Promise<ResolvedDep[]>}
   */
  async buildDependencyTree(name, version) {
    /** @type {ResolvedDep[]} */
    const resolved = [];
    /** @type {Set<string>} */
    const visited = new Set();

    /** @type {Array<{ depName: string, depRange: string }>} */
    const stack = [{ depName: name, depRange: version }];

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      const depVersion = await this.resolve(current.depName, current.depRange);
      const visitKey = `${current.depName}@${depVersion}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      const metadata = await this.registry.fetchPackageMetadata(current.depName);
      const versionInfo = metadata.versions?.[depVersion];
      const tarball = versionInfo?.dist?.tarball;
      const shasum = versionInfo?.dist?.shasum;
      if (!tarball) {
        throw new Error(`Missing tarball URL for "${current.depName}@${depVersion}"`);
      }
      if (!shasum) {
        throw new Error(`Missing tarball shasum for "${current.depName}@${depVersion}"`);
      }

      resolved.push({
        name: current.depName,
        version: depVersion,
        tarballUrl: tarball,
        shasum,
      });

      const dependencies = versionInfo.dependencies || {};
      const entries = Object.entries(dependencies);
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [childName, childRange] = entries[index];
        stack.push({ depName: childName, depRange: childRange });
      }
    }

    return resolved;
  }
}

export default DependencyResolver;
