import MemoryVfs from "./vfs.memory.js";
import { supportsOpfs, OpfsVfs } from "./vfs.opfs.js";

function isNodeLike() {
  return typeof process !== "undefined" && !!process.versions?.node;
}

/**
 * Create a VFS implementation that works in both Browser and Node.
 *
 * - Browser: prefers OPFS when available
 * - Node: defaults to MemoryVfs unless explicitly requested
 */
export async function createVfs(options = {}) {
  const preferred = typeof options.kind === "string" ? options.kind.trim().toLowerCase() : "";

  if (preferred === "opfs" || (!preferred && !isNodeLike() && supportsOpfs())) {
    if (supportsOpfs()) {
      return OpfsVfs.create({ rootDirName: options.rootDirName });
    }
    // fallthrough to memory
  }

  if (preferred === "nodefs" && isNodeLike()) {
    const { NodeFsVfs } = await import("./vfs.node.js");
    return new NodeFsVfs({ rootPath: options.rootPath || "." });
  }

  return new MemoryVfs();
}

export { MemoryVfs } from "./vfs.memory.js";
export { OpfsVfs, supportsOpfs } from "./vfs.opfs.js";
export { createVfsGlobFn, matchGlob, globToRegExp, expandBraces } from "./glob.js";
