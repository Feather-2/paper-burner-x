import MemoryVfs from "./vfs.memory.js";
import { supportsOpfs, OpfsVfs } from "./vfs.opfs.js";
import { createStorageAdapter } from "./storage-adapter.js";
import { StorageVfs } from "./vfs.storage.js";

/** @type {any} */
const nodeProcess = /** @type {any} */ (globalThis).process;

function isNodeLike() {
  return !!nodeProcess && typeof nodeProcess === "object" && !!nodeProcess.versions?.node;
}

/**
 * Create a VFS implementation that works in both Browser and Node.
 *
 * - Browser: prefers OPFS when available
 * - Node: defaults to MemoryVfs unless explicitly requested
 */
export async function createVfs(options = {}) {
  const preferred = typeof options.kind === "string" ? options.kind.trim().toLowerCase() : "";

  if (preferred === "memory" || preferred === "mem") {
    return new MemoryVfs();
  }

  if (!isNodeLike()) {
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
            /** @type {any} */ (vfs).storageAdapter = adapter;
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

  if (preferred === "nodefs" && isNodeLike()) {
    const { NodeFsVfs } = await import(/* @vite-ignore */ "./vfs.node.js");
    return new NodeFsVfs({ rootPath: options.rootPath || "." });
  }

  return new MemoryVfs();
}

export { MemoryVfs } from "./vfs.memory.js";
export { OpfsVfs, supportsOpfs } from "./vfs.opfs.js";
export { StorageVfs } from "./vfs.storage.js";
export { createVfsGlobFn, matchGlob, globToRegExp, expandBraces } from "./glob.js";
