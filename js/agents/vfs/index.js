import { Platform } from "../shared/index.js";
import { createVfs as createBrowserVfs } from "./index.browser.js";

export * from "./index.browser.js";

/** @typedef {import("./index.browser.js").CreateBrowserVfsOptions} CreateBrowserVfsOptions */
/** @typedef {import("./index.node.js").CreateNodeVfsOptions} CreateNodeVfsOptions */

/** @type {Promise<any> | null} */
let _nodeModulePromise = null;

async function importNodeModule() {
  // Keep Node.js code paths isolated from browser bundlers.
  // Also de-duplicate concurrent dynamic imports (helps test runners and avoids extra microtasks).
  if (!_nodeModulePromise) {
    _nodeModulePromise = import(/* @vite-ignore */ "./index.node.js");
  }
  return _nodeModulePromise;
}

/**
 * @typedef {object} CreateVfsOptions
 * @property {'memory'|'mem'|'opfs'|'nodefs'|'storage'} [kind] - VFS backend type
 * @property {string} [rootDirName] - Root directory name for OPFS
 * @property {string} [rootPath] - Root path for NodeFsVfs
 * @property {boolean} [preferOpfs] - Prefer OPFS over StorageAdapter
 * @property {boolean} [silent] - Suppress fallback warnings
 * @property {string} [keyPrefix] - Key prefix for StorageVfs
 * @property {import('./storage-adapter.js').StorageAdapter} [storageAdapter] - Custom storage adapter
 */

/**
 * Create a VFS implementation that works in both Browser and Node.
 *
 * - Browser: prefers OPFS when available
 * - Node: defaults to MemoryVfs unless explicitly requested
 *
 * @param {CreateVfsOptions} [options] - VFS configuration options
 * @returns {Promise<import('./vfs.memory.js').default | import('./vfs.opfs.js').OpfsVfs | import('./vfs.storage.js').StorageVfs | import('./vfs.node.js').NodeFsVfs>}
 */
export async function createVfs(options = {}) {
  if (!Platform.isNode) {
    return createBrowserVfs(/** @type {CreateBrowserVfsOptions} */ (options));
  }

  const node = await importNodeModule();
  return node.createVfs(/** @type {CreateNodeVfsOptions} */ (options));
}
