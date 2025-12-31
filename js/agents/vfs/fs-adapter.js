/**
 * Node-like fs adapter built on top of the browser-safe VFS interface.
 *
 * Required by CodeSearch tools which expect:
 * - readFile(path) -> Buffer-like / Uint8Array / string
 * - readdir(path, { withFileTypes }) -> string[] | Dirent-like[]
 * - stat(path) -> { size }
 */

export function createFsAdapterFromVfs(vfs) {
  if (!vfs || typeof vfs.readFile !== "function") return null;

  return {
    readFile: (path) => vfs.readFile(path),
    readdir: (path, options) => vfs.readdir(path, options),
    stat: (path) => vfs.stat(path),
  };
}

export default { createFsAdapterFromVfs };

