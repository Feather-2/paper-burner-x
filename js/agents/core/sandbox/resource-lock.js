/**
 * Resource Lock - 资源文件锁
 *
 * 防止多进程访问同一资源目录，使用文件系统独占锁实现。
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from "../../shared/index.js";

const logger = createLogger("core/sandbox/resource-lock");
const LOCK_EXT = ".lock";
const MAX_RESOURCE_ID_LEN = 180;

/**
 * 将 resourceId 规范化为安全文件名，防止路径注入。
 * @param {string} resourceId
 * @returns {string}
 */
export function sanitizeResourceId(resourceId) {
  const raw = typeof resourceId === "string" ? resourceId.trim() : String(resourceId ?? "").trim();
  if (!raw) throw new Error("resourceId must be a non-empty string");
  if (raw.includes("\0")) throw new Error("resourceId must not contain null bytes");

  // 通过 URL 编码去除路径分隔符与控制字符，再替换 `%` 以保持文件名可读。
  const encoded = encodeURIComponent(raw).replace(/%/g, "_");
  const compact = encoded.replace(/_2F|_5C|_3A|_00/gi, "_");
  const safe = compact.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!safe) throw new Error("resourceId is invalid after sanitization");
  return safe.length > MAX_RESOURCE_ID_LEN ? safe.slice(0, MAX_RESOURCE_ID_LEN) : safe;
}

/**
 * 构造并校验 lockPath，确保落在 lockDir 内。
 * @param {string} lockDir
 * @param {string} safeResourceId
 * @returns {string}
 */
function buildLockPath(lockDir, safeResourceId) {
  const resolvedDir = path.resolve(lockDir);
  const candidate = path.resolve(resolvedDir, `${safeResourceId}${LOCK_EXT}`);
  const inDir = candidate === resolvedDir || candidate.startsWith(`${resolvedDir}${path.sep}`);
  if (!inDir) {
    throw new Error(`Invalid lock path for resourceId "${safeResourceId}"`);
  }
  return candidate;
}

/**
 * @typedef {Object} LockHandle
 * @property {string} lockPath - 锁文件路径
 * @property {number} fd - 文件描述符
 * @property {() => Promise<void>} release - 释放锁
 */

/**
 * ResourceLock - 资源锁管理器
 */
export class ResourceLock {
  /**
   * @param {Object} options
   * @param {string} [options.lockDir] - 锁文件目录
   * @param {number} [options.acquireTimeoutMs=5000] - 获取锁超时
   * @param {number} [options.staleTimeoutMs=60000] - 锁过期时间
   */
  constructor(options = {}) {
    this.lockDir = options.lockDir || path.join(os.tmpdir(), 'sandbox-locks');
    this.acquireTimeoutMs = options.acquireTimeoutMs || 5000;
    this.staleTimeoutMs = options.staleTimeoutMs || 60000;

    // 确保锁目录存在
    if (!fs.existsSync(this.lockDir)) {
      fs.mkdirSync(this.lockDir, { recursive: true });
    }
  }

  /**
   * 获取资源锁
   * @param {string} resourceId - 资源标识符
   * @returns {Promise<LockHandle>}
   */
  async acquire(resourceId) {
    const safeResourceId = sanitizeResourceId(resourceId);
    const lockPath = buildLockPath(this.lockDir, safeResourceId);
    const startTime = Date.now();

    while (true) {
      try {
        // 尝试创建独占锁文件
        const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);

        // 写入锁信息
        const lockInfo = {
          pid: process.pid,
          timestamp: Date.now(),
          resourceId: safeResourceId,
        };
        fs.writeSync(fd, JSON.stringify(lockInfo));

        logger.debug('Lock acquired', { resourceId: safeResourceId, lockPath });

        return {
          lockPath,
          fd,
          release: async () => {
            try {
              fs.closeSync(fd);
              fs.unlinkSync(lockPath);
              logger.debug('Lock released', { resourceId: safeResourceId, lockPath });
            } catch (err) {
              logger.warn('Lock release failed', { resourceId: safeResourceId, error: err?.message });
            }
          },
        };
      } catch (err) {
        if (err.code !== 'EEXIST') {
          throw new Error(`Failed to acquire lock for ${safeResourceId}: ${err.message}`);
        }

        // 锁文件已存在，检查是否过期
        try {
          const stats = fs.statSync(lockPath);
          const age = Date.now() - stats.mtimeMs;

          if (age > this.staleTimeoutMs) {
            // 锁已过期，尝试清理
            logger.warn('Stale lock detected, attempting cleanup', { resourceId: safeResourceId, age });
            try {
              fs.unlinkSync(lockPath);
              continue; // 重试获取锁
            } catch (cleanupErr) {
              // 清理失败，可能被其他进程抢先
              logger.debug('Stale lock cleanup failed', { resourceId: safeResourceId, error: cleanupErr?.message });
            }
          }
        } catch (statErr) {
          // 锁文件可能已被删除，重试
          continue;
        }

        // 检查超时
        if (Date.now() - startTime > this.acquireTimeoutMs) {
          throw new Error(`Lock acquire timeout for ${safeResourceId} after ${this.acquireTimeoutMs}ms`);
        }

        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  /**
   * 尝试获取锁（非阻塞）
   * @param {string} resourceId - 资源标识符
   * @returns {Promise<LockHandle|null>}
   */
  async tryAcquire(resourceId) {
    const safeResourceId = sanitizeResourceId(resourceId);
    const lockPath = buildLockPath(this.lockDir, safeResourceId);

    try {
      const fd = fs.openSync(lockPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);

      const lockInfo = {
        pid: process.pid,
        timestamp: Date.now(),
        resourceId: safeResourceId,
      };
      fs.writeSync(fd, JSON.stringify(lockInfo));

      logger.debug('Lock acquired (non-blocking)', { resourceId: safeResourceId, lockPath });

      return {
        lockPath,
        fd,
        release: async () => {
          try {
            fs.closeSync(fd);
            fs.unlinkSync(lockPath);
            logger.debug('Lock released', { resourceId: safeResourceId, lockPath });
          } catch (err) {
            logger.warn('Lock release failed', { resourceId: safeResourceId, error: err?.message });
          }
        },
      };
    } catch (err) {
      if (err.code === 'EEXIST') {
        return null; // 锁已被占用
      }
      throw new Error(`Failed to try acquire lock for ${safeResourceId}: ${err.message}`);
    }
  }

  /**
   * 清理所有过期锁
   */
  async cleanupStaleLocks() {
    try {
      const files = fs.readdirSync(this.lockDir);
      let cleaned = 0;

      for (const file of files) {
        if (!file.endsWith('.lock')) continue;

        const lockPath = path.join(this.lockDir, file);
        try {
          const stats = fs.statSync(lockPath);
          const age = Date.now() - stats.mtimeMs;

          if (age > this.staleTimeoutMs) {
            fs.unlinkSync(lockPath);
            cleaned++;
            logger.debug('Cleaned stale lock', { lockPath, age });
          }
        } catch (err) {
          // 文件可能已被删除
        }
      }

      if (cleaned > 0) {
        logger.info('Cleaned stale locks', { count: cleaned });
      }
    } catch (err) {
      logger.error('Stale lock cleanup failed', { error: err?.message });
    }
  }
}

export default ResourceLock;
