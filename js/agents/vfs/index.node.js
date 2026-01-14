import MemoryVfs from "./vfs.memory.js";
import { NodeFsVfs } from "./vfs.node.js";

export * from "./index.browser.js";
export { NodeFsVfs } from "./vfs.node.js";

/**
 * Node-only VFS entrypoint (includes NodeFsVfs).
 *
 * - Defaults to MemoryVfs unless explicitly requested
 */
export async function createVfs(options = {}) {
  const preferred = typeof options.kind === "string" ? options.kind.trim().toLowerCase() : "";

  if (preferred === "memory" || preferred === "mem") {
    return new MemoryVfs();
  }

  if (preferred === "nodefs") {
    return new NodeFsVfs({ rootPath: options.rootPath || "." });
  }

  return new MemoryVfs();
}

