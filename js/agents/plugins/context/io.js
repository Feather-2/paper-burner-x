/**
 * context/io.js — VFS-backed JSONL I/O 适配器
 *
 * 将 context-cli 的 node:fs I/O 替换为 VFS 调用，
 * 使 intent 数据在 Browser (OPFS) 和 Node (nodefs) 下均可读写。
 * @module plugins/context/io
 */

import { fillNonCryptoRandomBytes } from '../../shared/utils/secure-id.js';

// ── 常量 ──────────────────────────────────────────────────────────

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const PERSPECTIVES = new Set([
  'architecture', 'performance', 'maintenance',
  'security', 'compatibility', 'user-impact',
]);

export const DECISION_OPS = new Set(['upsert', 'supersede', 'restructure']);

export const SIGNAL_TYPES = new Set([
  'referenced_by', 'backtrack_hit', 'cross_validated',
  'human_confirmed', 'superseded', 'retracted', 'excluded_checked',
  'conflict', 'archived',
]);

// ── ULID (跨平台) ────────────────────────────────────────────────

/**
 * 生成 ULID。优先 crypto.getRandomValues，回退到共享非加密 PRNG。
 * @returns {string}  26 字符 Crockford base32
 */
export function ulid() {
  const now = Date.now();
  let out = '';
  let ts = now;
  for (let i = 9; i >= 0; i--) {
    out = CROCKFORD[ts & 0x1f] + out;
    ts = Math.floor(ts / 32);
  }
  const rnd = _randomBytes(10);
  let bitBuf = 0, bitLen = 0, ri = 0;
  for (let i = 0; i < 16; i++) {
    while (bitLen < 5) {
      bitBuf = (bitBuf << 8) | (rnd[ri++] || 0);
      bitLen += 8;
    }
    bitLen -= 5;
    out += CROCKFORD[(bitBuf >> bitLen) & 0x1f];
  }
  return out;
}

/** @returns {Uint8Array} */
function _randomBytes(n) {
  try {
    const buf = new Uint8Array(n);
    // globalThis.crypto 在 Browser + Node 18+ 均可用
    globalThis.crypto.getRandomValues(buf);
    return buf;
  } catch {
    // 极端回退：保持跨模块一致的非加密随机策略。
    return fillNonCryptoRandomBytes(new Uint8Array(n));
  }
}

// ── 内容哈希 (跨平台) ────────────────────────────────────────────

/**
 * SHA-256 前 8 hex。使用 Web Crypto API (Browser + Node 18+)。
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function contentHash(text) {
  try {
    const data = new TextEncoder().encode(text);
    const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
    const arr = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < 4; i++) hex += arr[i].toString(16).padStart(2, '0');
    return hex;
  } catch {
    // fallback: djb2
    let h = 5381;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
}

// ── 分片路由 ─────────────────────────────────────────────────────

/**
 * 模块路径转 shard 文件名。
 * @param {string} modulePath
 * @returns {string}
 */
export function moduleToShard(modulePath) {
  return modulePath.replace(/\/+$/, '').replace(/\//g, '-') + '.jsonl';
}

/**
 * @returns {string}  YYYY-MM-DD
 */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── VFS JSONL I/O ────────────────────────────────────────────────

/**
 * 通过 VFS 读取 JSONL 文件，返回解析后的对象数组。
 * @param {object} vfs   VFS 服务实例
 * @param {string} path  VFS 路径
 * @returns {Promise<object[]>}
 */
export async function readJsonl(vfs, path) {
  try {
    const text = await vfs.readText(path);
    const results = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed));
      } catch {
        // skip malformed line
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * 通过 VFS 追加一条 JSONL 记录。
 * @param {object} vfs     VFS 服务实例
 * @param {string} path    VFS 路径
 * @param {object} record  要追加的记录
 */
export async function appendJsonl(vfs, path, record) {
  const line = JSON.stringify(record) + '\n';
  try {
    await vfs.appendText(path, line);
  } catch {
    // appendText 不存在时创建文件
    const dir = path.split('/').slice(0, -1).join('/');
    if (dir) {
      try { await vfs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
    }
    try {
      // 尝试读取已有内容 + 追加
      let existing = '';
      try { existing = await vfs.readText(path); } catch { /* new file */ }
      await vfs.writeText(path, existing + line);
    } catch (e) {
      throw new Error(`appendJsonl failed for ${path}: ${e.message}`);
    }
  }
}

// ── Dirty 追踪 ──────────────────────────────────────────────────

/**
 * 追加一条 dirty 标记。
 * @param {object} vfs
 * @param {string} dirtyPath
 * @param {string} shard
 * @param {string} type
 */
export async function appendDirty(vfs, dirtyPath, shard, type) {
  const line = JSON.stringify({ shard, type, ts: new Date().toISOString() }) + '\n';
  try { await vfs.appendText(dirtyPath, line); } catch {
    try { await vfs.writeText(dirtyPath, line); } catch { /* best effort */ }
  }
}

/**
 * 读取 dirty 标记。
 * @param {object} vfs
 * @param {string} dirtyPath
 * @returns {Promise<{total:number, by_shard:Record<string,number>, entries:object[]}>}
 */
export async function readDirty(vfs, dirtyPath) {
  const entries = await readJsonl(vfs, dirtyPath);
  /** @type {Record<string,number>} */
  const by_shard = {};
  for (const e of entries) {
    by_shard[e.shard] = (by_shard[e.shard] || 0) + 1;
  }
  return { total: entries.length, by_shard, entries };
}

/**
 * 清空 dirty 标记。
 * @param {object} vfs
 * @param {string} dirtyPath
 */
export async function clearDirty(vfs, dirtyPath) {
  try { await vfs.unlink(dirtyPath); } catch { /* not exists */ }
}
