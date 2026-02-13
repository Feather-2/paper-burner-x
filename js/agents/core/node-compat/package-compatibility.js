/**
 * @file Package compatibility checker for node-compat runtime.
 * Detects if an npm package can run in the browser sandbox.
 */

/**
 * @typedef {object} CompatibilityResult
 * @property {boolean} compatible - Whether the package is compatible
 * @property {string[]} issues - List of compatibility issues
 * @property {string[]} warnings - List of warnings
 * @property {number} score - Compatibility score (0-100)
 */

/**
 * Known native modules that cannot run in browser.
 */
const NATIVE_MODULES = new Set([
  'sharp', 'sqlite3', 'bcrypt', 'node-sass', 'canvas', 'fsevents',
  'node-pty', 'node-gyp', 'node-pre-gyp', 'nan', 'node-addon-api',
  'better-sqlite3', 'leveldown', 'grpc', 'node-rdkafka', 'zeromq'
]);

/**
 * Unsupported Node.js APIs in browser.
 */
const UNSUPPORTED_APIS = {
  'child_process.spawn': 'Cannot spawn real processes',
  'child_process.exec': 'Cannot execute shell commands',
  'child_process.fork': 'Cannot fork processes',
  'net.createServer': 'Cannot create TCP server',
  'dgram.createSocket': 'Cannot create UDP socket',
  'cluster.fork': 'Cannot use cluster module',
  'worker_threads.Worker': 'Limited Worker support',
  'fs.watch': 'Limited file watching',
  'process.exit': 'Cannot exit browser process'
};

/**
 * Check if package.json indicates native dependencies.
 * @param {object} pkg - package.json content
 * @returns {string[]} List of native dependencies found
 */
function detectNativeDependencies(pkg) {
  const natives = [];
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies
  };

  for (const dep of Object.keys(allDeps)) {
    if (NATIVE_MODULES.has(dep)) {
      natives.push(dep);
    }
  }

  // Check for build scripts indicating native compilation
  if (pkg.scripts) {
    if (pkg.scripts.install?.includes('node-gyp') ||
        pkg.scripts.install?.includes('prebuild-install')) {
      natives.push('(build script uses node-gyp)');
    }
  }

  // Check for gypfile
  if (pkg.gypfile) {
    natives.push('(has binding.gyp)');
  }

  return natives;
}

/**
 * Scan code for unsupported API usage.
 * @param {string} code - Source code to scan
 * @returns {string[]} List of unsupported APIs found
 */
function scanForUnsupportedAPIs(code) {
  const found = [];

  for (const [api, reason] of Object.entries(UNSUPPORTED_APIS)) {
    const pattern = api.replace('.', '\\.');
    if (new RegExp(`\\b${pattern}\\s*\\(`).test(code)) {
      found.push(`${api}: ${reason}`);
    }
  }

  // Check for synchronous fs APIs
  if (/\bfs\.(readFileSync|writeFileSync|readdirSync)\b/.test(code)) {
    found.push('Sync fs APIs: Only work with MemoryVfs');
  }

  return found;
}

/**
 * Check package compatibility with node-compat runtime.
 * @param {object} options
 * @param {object} options.packageJson - package.json content
 * @param {string} [options.mainCode] - Main entry point code (optional)
 * @param {object} [options.vfs] - VFS instance to read files (optional)
 * @returns {Promise<CompatibilityResult>}
 */
export async function checkPackageCompatibility(options) {
  const { packageJson: pkg, mainCode, vfs } = options;
  const issues = [];
  const warnings = [];

  // 1. Check native dependencies
  const nativeDeps = detectNativeDependencies(pkg);
  if (nativeDeps.length > 0) {
    issues.push(`Native dependencies: ${nativeDeps.join(', ')}`);
  }

  // 2. Check engines requirement
  if (pkg.engines?.node) {
    const nodeVersion = pkg.engines.node;
    if (nodeVersion.includes('>') || nodeVersion.includes('<')) {
      warnings.push(`Requires Node.js ${nodeVersion} (may have compatibility issues)`);
    }
  }

  // 3. Scan main code if provided
  if (mainCode) {
    const unsupportedAPIs = scanForUnsupportedAPIs(mainCode);
    if (unsupportedAPIs.length > 0) {
      issues.push(...unsupportedAPIs);
    }
  }

  // 4. Read and scan main entry if VFS provided
  if (vfs && pkg.main && !mainCode) {
    try {
      const mainPath = pkg.main.startsWith('/') ? pkg.main : `/${pkg.main}`;
      const code = await vfs.readText(mainPath);
      const unsupportedAPIs = scanForUnsupportedAPIs(code);
      if (unsupportedAPIs.length > 0) {
        issues.push(...unsupportedAPIs);
      }
    } catch {
      warnings.push('Could not read main entry point');
    }
  }

  // 5. Check for browser field (good sign)
  if (pkg.browser) {
    warnings.push('Has browser field (likely compatible)');
  }

  // 6. Calculate compatibility score
  let score = 100;
  score -= issues.length * 20;
  score -= warnings.length * 5;
  score = Math.max(0, Math.min(100, score));

  const compatible = issues.length === 0;

  return {
    compatible,
    issues,
    warnings,
    score
  };
}

/**
 * Quick check if a package name is likely compatible.
 * @param {string} packageName
 * @returns {boolean}
 */
export function isLikelyCompatible(packageName) {
  // Known incompatible packages
  if (NATIVE_MODULES.has(packageName)) return false;

  // Known compatible packages
  const KNOWN_COMPATIBLE = [
    'lodash', 'moment', 'uuid', 'axios', 'ramda', 'date-fns',
    'ajv', 'joi', 'yup', 'validator', 'semver', 'chalk',
    'debug', 'ms', 'qs', 'mime', 'cookie', 'js-yaml',
    'acorn', '@babel/parser', 'marked', 'highlight.js'
  ];

  return KNOWN_COMPATIBLE.includes(packageName);
}

/**
 * Format compatibility result as human-readable string.
 * @param {CompatibilityResult} result
 * @returns {string}
 */
export function formatCompatibilityReport(result) {
  const lines = [];

  lines.push(`Compatibility: ${result.compatible ? '✅ Compatible' : '❌ Incompatible'}`);
  lines.push(`Score: ${result.score}/100`);

  if (result.issues.length > 0) {
    lines.push('\nIssues:');
    result.issues.forEach(issue => lines.push(`  ❌ ${issue}`));
  }

  if (result.warnings.length > 0) {
    lines.push('\nWarnings:');
    result.warnings.forEach(warn => lines.push(`  ⚠️  ${warn}`));
  }

  return lines.join('\n');
}
