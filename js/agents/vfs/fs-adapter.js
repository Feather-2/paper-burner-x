/**
 * Node-like fs adapter built on top of the browser-safe VFS interface.
 *
 * Required by CodeSearch tools which expect:
 * - readFile(path) -> Buffer-like / Uint8Array / string
 * - readdir(path, { withFileTypes }) -> string[] | Dirent-like[]
 * - stat(path) -> { size }
 */

/**
 * @typedef {object} VfsDirentLike
 * @property {string} name
 * @property {() => boolean} isDirectory
 * @property {() => boolean} isFile
 */

/**
 * @typedef {object} VfsStatLike
 * @property {number} size
 * @property {number=} mtimeMs
 * @property {() => boolean=} isFile
 * @property {() => boolean=} isDirectory
 */

/**
 * @typedef {object} VfsLike
 * @property {(path: string) => Promise<Uint8Array | string>} readFile
 * @property {(path: string, options?: { withFileTypes?: boolean }) => Promise<string[] | VfsDirentLike[]>} readdir
 * @property {(path: string) => Promise<VfsStatLike>} stat
 */

/**
 * @typedef {object} FsAdapterLike
 * @property {(path: string) => Promise<Uint8Array | string>} readFile
 * @property {(path: string, options?: { withFileTypes?: boolean }) => Promise<string[] | VfsDirentLike[]>} readdir
 * @property {(path: string) => Promise<VfsStatLike>} stat
 */

/**
 * @param {VfsLike} vfs
 * @returns {FsAdapterLike|null}
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
