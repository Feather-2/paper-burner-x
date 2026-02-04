import MemoryVfs from "./vfs.memory.js";
import { supportsOpfs, OpfsVfs } from "./vfs.opfs.js";
import { createStorageAdapter } from "./storage-adapter.js";
import { StorageVfs } from "./vfs.storage.js";

/**
 * @typedef {object} CreateBrowserVfsOptions
 * @property {'memory'|'mem'|'opfs'|'storage'} [kind] - VFS backend type
 * @property {string} [rootDirName] - Root directory name for OPFS
 * @property {boolean} [preferOpfs] - Prefer OPFS over StorageAdapter (default: true)
 * @property {boolean} [silent] - Suppress fallback warnings
 * @property {string} [keyPrefix] - Key prefix for StorageVfs
 * @property {import('./storage-adapter.js').StorageAdapter} [storageAdapter] - Custom storage adapter
 */

/**
 * Browser-only VFS entrypoint.
 *
 * - Prefers OPFS when available
 * - Falls back to StorageAdapter-backed VFS
 *
 * @param {CreateBrowserVfsOptions} [options] - VFS configuration options
 * @returns {Promise<MemoryVfs | OpfsVfs | StorageVfs>}
 */
export async function createVfs(options = {}) {
  const preferred = typeof options.kind === "string" ? options.kind.trim().toLowerCase() : "";

  if (preferred === "memory" || preferred === "mem") {
    return new MemoryVfs();
  }

  if (preferred === "opfs" || (!preferred && supportsOpfs())) {
    if (supportsOpfs()) {
      try {
        const vfs = await OpfsVfs.create({ rootDirName: options.rootDirName });
        // Best-effort: expose a StorageAdapter for checkpoint persistence fallback.
        // This does not change OPFS VFS semantics and remains optional.
        try {
	          const adapter =
	            options.storageAdapter && typeof options.storageAdapter.get === "function"
	              ? options.storageAdapter
	              : await createStorageAdapter({
	                  preferOpfs: true,
	                  silent: true,
	                });
	          /** @type {OpfsVfs & { storageAdapter?: import('./storage-adapter.js').StorageAdapter }} */ (vfs).storageAdapter = adapter;
	        } catch {
	          // ignore
	        }
	        return vfs;
      } catch {
        // fall through to StorageAdapter-backed VFS
      }
    }
  }

  // Browser fallback: StorageAdapter with automatic OPFS → IndexedDB → localStorage → Memory downgrade.
  const adapter =
    options.storageAdapter && typeof options.storageAdapter.get === "function"
      ? options.storageAdapter
      : await createStorageAdapter({
          preferOpfs: options.preferOpfs !== false,
          silent: options.silent === true,
        });
  return new StorageVfs(adapter, { keyPrefix: options.keyPrefix });
}

export { MemoryVfs } from "./vfs.memory.js";
export { OpfsVfs, supportsOpfs } from "./vfs.opfs.js";
export { StorageVfs } from "./vfs.storage.js";
export { createVfsGlobFn, matchGlob, globToRegExp, expandBraces } from "./glob.js";
