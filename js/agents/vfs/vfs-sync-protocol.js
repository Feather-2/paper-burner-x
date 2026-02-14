/**
 * VFS Sync Protocol - 主-从 VFS 同步协议
 *
 * 提供 VFS 快照序列化、恢复和增量更新能力，支持主-从同步场景。
 *
 * 特性：
 * - toSnapshot(): 序列化整个 VFS 为快照
 * - fromSnapshot(): 从快照恢复 VFS
 * - applyDelta(): 应用增量更新
 * - 事件通知: 'change' 和 'delete' 事件
 * - Base64 编码: 二进制安全的内容传输
 *
 * @module vfs/vfs-sync-protocol
 */

import { EventEmitter } from "../shared/index.js";
import { normalizeVfsPath } from "./path.js";

/**
 * @typedef {object} VfsFileSnapshot
 * @property {string} path - 文件路径
 * @property {'file'|'dir'} type - 文件类型
 * @property {string} [content] - Base64 编码的文件内容（仅 type='file' 时存在）
 */

/**
 * @typedef {object} VfsSnapshot
 * @property {VfsFileSnapshot[]} files - 文件列表
 * @property {number} timestamp - 快照时间戳
 * @property {string} [version] - 快照版本
 */

/**
 * @typedef {object} VfsDelta
 * @property {string} path - 文件路径
 * @property {string|null} content - Base64 编码的内容，null 表示删除
 */

/**
 * VFS 同步协议
 *
 * 包装 VFS 实例，提供快照和增量同步能力。
 */
export class VfsSyncProtocol extends EventEmitter {
  /**
   * @param {any} vfs - VFS 实例（需要实现 readFile/writeFile/unlink/listFiles/walkFiles/exists/stat）
   */
  constructor(vfs) {
    super();
    if (!vfs) {
      throw new TypeError("VfsSyncProtocol: vfs is required");
    }
    this._vfs = vfs;
  }

  /**
   * 序列化整个 VFS 为快照
   *
   * @param {object} [options]
   * @param {string} [options.prefix] - 只导出指定前缀的文件
   * @returns {Promise<VfsSnapshot>}
   */
  async toSnapshot({ prefix = "" } = {}) {
    const files = [];
    const pfx = normalizeVfsPath(prefix);

    // 遍历所有文件
    for await (const path of this._vfs.walkFiles({ prefix: pfx, recursive: true })) {
      try {
        const bytes = await this._vfs.readFile(path);
        const content = this._bytesToBase64(bytes);
        files.push({ path, type: "file", content });
      } catch (err) {
        // 跳过无法读取的文件
        continue;
      }
    }

    return {
      files,
      timestamp: Date.now(),
      version: "1.0",
    };
  }

  /**
   * 从快照恢复 VFS
   *
   * 注意：此操作会清空 VFS 中的所有文件，然后写入快照中的文件。
   *
   * @param {VfsSnapshot} snapshot - 快照数据
   * @param {object} [options]
   * @param {boolean} [options.clear] - 是否先清空 VFS（默认 false）
   * @returns {Promise<void>}
   */
  async fromSnapshot(snapshot, { clear = false } = {}) {
    if (!snapshot || !Array.isArray(snapshot.files)) {
      throw new TypeError("VfsSyncProtocol.fromSnapshot: invalid snapshot");
    }

    // 可选：清空现有文件
    if (clear) {
      await this._clearVfs();
    }

    // 写入快照中的文件
    for (const file of snapshot.files) {
      if (file.type === "file" && file.content) {
        try {
          const bytes = this._base64ToBytes(file.content);
          await this._vfs.writeFile(file.path, bytes);
          this.emit("change", { path: file.path, source: "snapshot" });
        } catch (err) {
          // 跳过写入失败的文件
          continue;
        }
      }
    }
  }

  /**
   * 应用增量更新
   *
   * @param {VfsDelta|VfsDelta[]} delta - 增量更新（单个或数组）
   * @returns {Promise<void>}
   */
  async applyDelta(delta) {
    const deltas = Array.isArray(delta) ? delta : [delta];

    for (const d of deltas) {
      if (!d || typeof d.path !== "string") {
        continue;
      }

      const path = normalizeVfsPath(d.path);

      // content 为 null 表示删除
      if (d.content === null) {
        try {
          const exists = await this._vfs.exists(path);
          if (exists) {
            await this._vfs.unlink(path);
            this.emit("delete", { path });
          }
        } catch (err) {
          // 删除失败，跳过
          continue;
        }
      } else if (typeof d.content === "string") {
        // 写入或更新文件
        try {
          const bytes = this._base64ToBytes(d.content);
          await this._vfs.writeFile(path, bytes);
          this.emit("change", { path });
        } catch (err) {
          // 写入失败，跳过
          continue;
        }
      }
    }
  }

  /**
   * 清空 VFS（删除所有文件）
   *
   * @private
   * @returns {Promise<void>}
   */
  async _clearVfs() {
    const files = await this._vfs.listFiles({ recursive: true });
    for (const path of files) {
      try {
        await this._vfs.unlink(path);
      } catch {
        // 忽略删除失败
      }
    }
  }

  /**
   * 将 Uint8Array 转换为 Base64
   *
   * @private
   * @param {Uint8Array} bytes
   * @returns {string}
   */
  _bytesToBase64(bytes) {
    if (typeof Buffer !== "undefined") {
      // Node.js
      return Buffer.from(bytes).toString("base64");
    }
    // Browser
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * 将 Base64 转换为 Uint8Array
   *
   * @private
   * @param {string} base64
   * @returns {Uint8Array}
   */
  _base64ToBytes(base64) {
    if (typeof Buffer !== "undefined") {
      // Node.js
      return new Uint8Array(Buffer.from(base64, "base64"));
    }
    // Browser
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * 获取底层 VFS 实例
   *
   * @returns {any}
   */
  get vfs() {
    return this._vfs;
  }
}

export default VfsSyncProtocol;
