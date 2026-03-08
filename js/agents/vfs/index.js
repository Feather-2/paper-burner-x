import { isNodeLike } from "../shared/index.js";
import { createVfs as createBrowserVfs } from "./index.browser.js";

export * from "./index.browser.js";

/** @typedef {import("./index.browser.js").CreateBrowserVfsOptions} CreateBrowserVfsOptions */
/** @typedef {import("./index.node.js").CreateNodeVfsOptions} CreateNodeVfsOptions */

/**
 * Unified VFS interface shared by all backends (Memory, OPFS, Storage, NodeFs).
 *
 * @typedef {object} VfsInterface
 * @property {(path: string) => Promise<Uint8Array>} readFile
 * @property {(path: string) => Promise<string>} readText
 * @property {(path: string, data: unknown) => Promise<boolean>} writeFile
 * @property {(path: string, text: string) => Promise<boolean>} writeText
 * @property {(path: string) => Promise<import('./vfs.memory.js').VfsStat>} stat
 * @property {(path: string, options?: import('./vfs.memory.js').ReaddirOptions) => Promise<string[] | import('./vfs.memory.js').VfsDirent[]>} readdir
 * @property {(path: string, options?: import('./vfs.memory.js').MkdirOptions) => Promise<boolean>} mkdir
 * @property {(path: string, options?: import('./vfs.memory.js').RmdirOptions) => Promise<boolean>} rmdir
 * @property {(path: string) => Promise<boolean>} unlink
 * @property {(path: string) => Promise<boolean>} exists
 * @property {(src: string, dest: string) => Promise<boolean>} copy
 * @property {(src: string, dest: string) => Promise<boolean>} move
 * @property {(options?: import('./vfs.memory.js').ListFilesOptions) => Promise<string[]>} listFiles
 * @property {(options?: import('./vfs.memory.js').WalkFilesOptions) => AsyncGenerator<string, void, void>} walkFiles
 */

/** @type {Promise<any> | null} */
let _nodeModulePromise = null;
let _nodeModuleImporter = () => import(/* @vite-ignore */ "./index.node.js");

async function importNodeModule() {
  // Keep Node.js code paths isolated from browser bundlers.
  // Also de-duplicate concurrent dynamic imports (helps test runners and avoids extra microtasks).
  if (!_nodeModulePromise) {
    _nodeModulePromise = Promise.resolve()
      .then(() => _nodeModuleImporter())
      .catch((error) => {
        _nodeModulePromise = null;
        throw error;
      });
  }
  return _nodeModulePromise;
}

/**
 * Reset cached node-module import promise.
 * Mainly for tests/recovery paths.
 */
export function resetNodeModuleImportCache() {
  _nodeModulePromise = null;
}

/**
 * Override node-module importer (tests only).
 * @param {() => Promise<any>} importer
 */
export function setNodeModuleImporter(importer) {
  if (typeof importer !== "function") {
    throw new TypeError("setNodeModuleImporter(importer): importer must be a function");
  }
  _nodeModuleImporter = importer;
  _nodeModulePromise = null;
}

/**
 * Restore default importer (tests only).
 */
export function restoreDefaultNodeModuleImporter() {
  _nodeModuleImporter = () => import(/* @vite-ignore */ "./index.node.js");
  _nodeModulePromise = null;
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
 * @returns {Promise<VfsInterface>}
 */
export async function createVfs(options = {}) {
  if (!isNodeLike()) {
    return /** @type {VfsInterface} */ (/** @type {unknown} */ (await createBrowserVfs(/** @type {CreateBrowserVfsOptions} */ (options))));
  }

  const node = await importNodeModule();
  return node.createVfs(/** @type {CreateNodeVfsOptions} */ (options));
}
