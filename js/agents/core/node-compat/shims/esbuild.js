/**
 * esbuild shim - Minimal stub for browser environment
 * Provides basic API surface without actual bundling functionality
 */

/**
 * @typedef {Object} BuildOptions
 * @property {string[]} [entryPoints]
 * @property {string} [outfile]
 * @property {string} [outdir]
 * @property {boolean} [bundle]
 * @property {boolean} [minify]
 * @property {boolean} [sourcemap]
 * @property {string} [format]
 * @property {string} [platform]
 * @property {string} [target]
 * @property {Object} [define]
 * @property {Object} [loader]
 */

/**
 * @typedef {Object} BuildResult
 * @property {Array} errors
 * @property {Array} warnings
 * @property {Array} outputFiles
 * @property {Object} metafile
 */

/**
 * @typedef {Object} TransformOptions
 * @property {string} [loader]
 * @property {string} [format]
 * @property {string} [target]
 * @property {boolean} [minify]
 * @property {boolean} [sourcemap]
 */

/**
 * @typedef {Object} TransformResult
 * @property {string} code
 * @property {string} [map]
 * @property {Array} warnings
 */

/**
 * Build stub - not supported in browser
 * @param {BuildOptions} options
 * @returns {Promise<BuildResult>}
 */
export async function build(options) {
  throw new Error('esbuild.build() is not supported in browser environment');
}

/**
 * Transform stub - minimal implementation
 * @param {string} code
 * @param {TransformOptions} [options]
 * @returns {Promise<TransformResult>}
 */
export async function transform(code, options = {}) {
  // Minimal pass-through transformation
  return {
    code,
    map: options.sourcemap ? '' : undefined,
    warnings: [],
  };
}

/**
 * Initialize stub
 * @returns {Promise<void>}
 */
export async function initialize() {
  // No-op in browser
}

/**
 * Version string
 */
export const version = '0.0.0-stub';

export default {
  build,
  transform,
  initialize,
  version,
};
