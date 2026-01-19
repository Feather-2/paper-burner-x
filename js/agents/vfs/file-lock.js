/**
 * File Lock - VFS 文件锁
 *
 * 浏览器环境下的协作式文件锁，用于：
 * - 防止并发写入冲突
 * - 读写锁分离（多读单写）
 * - 超时自动释放
 * - 死锁检测
 */

import { createLogger } from "../shared/index.js";
import { getGlobalContainer } from "../runtime/di/global-container.js";

const logger = createLogger("vfs/file-lock");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_LOCK_TIMEOUT_MS = 30000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 10000;
const DEADLOCK_CHECK_INTERVAL_MS = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// Lock Types
// ─────────────────────────────────────────────────────────────────────────────

export const LockType = {
  READ: "read",
  WRITE: "write",
};

// ─────────────────────────────────────────────────────────────────────────────
// FileLock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} LockEntry
 * @property {string} path
 * @property {string} type
 * @property {string} holder
 * @property {number} acquiredAt
 * @property {number} expiresAt
 */

export class FileLock {
  /**
   * @param {object} [options]
   * @param {number} [options.lockTimeoutMs=30000]
   * @param {number} [options.acquireTimeoutMs=10000]
   */
  constructor({
    lockTimeoutMs = DEFAULT_LOCK_TIMEOUT_MS,
    acquireTimeoutMs = DEFAULT_ACQUIRE_TIMEOUT_MS,
  } = {}) {
    this._lockTimeoutMs = lockTimeoutMs;
    this._acquireTimeoutMs = acquireTimeoutMs;

    /** @type {Map<string, LockEntry[]>} path → locks */
    this._locks = new Map();

    /** @type {Map<string, Array<{ type: string, holder: string, resolve: Function, reject: Function }>>} */
    this._waiters = new Map();

    this._deadlockTimer = null;
    this._nextLockId = 0;
  }

  /**
   * Generate unique holder ID
   */
  generateHolderId() {
    return `lock_${Date.now().toString(36)}_${(++this._nextLockId).toString(36)}`;
  }

  /**
   * Acquire lock
   * @param {string} path
   * @param {object} [options]
   * @param {string} [options.type='write']
   * @param {string} [options.holder]
   * @param {number} [options.timeoutMs]
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{ release: Function, holder: string }>}
   */
  async acquire(path, options = {}) {
    const {
      type = LockType.WRITE,
      holder = this.generateHolderId(),
      timeoutMs = this._acquireTimeoutMs,
      signal,
    } = options;

    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    // Clean expired locks first
    this._cleanExpiredLocks(path);

    // Try immediate acquire
    if (this._canAcquire(path, type)) {
      return this._doAcquire(path, type, holder);
    }

    // Wait for lock
    return this._waitForLock(path, type, holder, timeoutMs, signal);
  }

  /**
   * Try acquire without waiting
   * @param {string} path
   * @param {object} [options]
   * @returns {{ acquired: boolean, release?: Function, holder?: string }}
   */
  tryAcquire(path, options = {}) {
    const { type = LockType.WRITE, holder = this.generateHolderId() } = options;

    this._cleanExpiredLocks(path);

    if (this._canAcquire(path, type)) {
      const result = this._doAcquire(path, type, holder);
      return { acquired: true, ...result };
    }

    return { acquired: false };
  }

  /**
   * Release lock
   * @param {string} path
   * @param {string} holder
   * @returns {boolean} Success
   */
  release(path, holder) {
    const locks = this._locks.get(path);
    if (!locks) return false;

    const idx = locks.findIndex((l) => l.holder === holder);
    if (idx < 0) return false;

    locks.splice(idx, 1);
    if (locks.length === 0) {
      this._locks.delete(path);
    }

    logger.info("Lock released", { path, holder });

    // Wake up waiters
    this._processWaiters(path);

    return true;
  }

  /**
   * Check if path is locked
   * @param {string} path
   * @returns {{ locked: boolean, type?: string, holders?: string[] }}
   */
  isLocked(path) {
    this._cleanExpiredLocks(path);
    const locks = this._locks.get(path);

    if (!locks || locks.length === 0) {
      return { locked: false };
    }

    const hasWrite = locks.some((l) => l.type === LockType.WRITE);
    return {
      locked: true,
      type: hasWrite ? LockType.WRITE : LockType.READ,
      holders: locks.map((l) => l.holder),
    };
  }

  /**
   * Get all locks
   * @returns {Map<string, LockEntry[]>}
   */
  getAllLocks() {
    // Clean all expired locks first
    for (const path of this._locks.keys()) {
      this._cleanExpiredLocks(path);
    }
    return new Map(this._locks);
  }

  /**
   * Force release all locks for a holder
   * @param {string} holder
   * @returns {number} Number of locks released
   */
  releaseAllForHolder(holder) {
    let count = 0;
    for (const [path, locks] of this._locks) {
      const before = locks.length;
      const filtered = locks.filter((l) => l.holder !== holder);
      if (filtered.length < before) {
        count += before - filtered.length;
        if (filtered.length === 0) {
          this._locks.delete(path);
        } else {
          this._locks.set(path, filtered);
        }
        this._processWaiters(path);
      }
    }
    if (count > 0) {
      logger.info("Force released locks", { holder, count });
    }
    return count;
  }

  /**
   * Check if can acquire lock
   * @private
   */
  _canAcquire(path, type) {
    const locks = this._locks.get(path);
    if (!locks || locks.length === 0) {
      return true;
    }

    if (type === LockType.READ) {
      // Read lock: allowed if no write locks
      return !locks.some((l) => l.type === LockType.WRITE);
    }

    // Write lock: only allowed if no locks at all
    return false;
  }

  /**
   * Do acquire lock
   * @private
   */
  _doAcquire(path, type, holder) {
    const now = Date.now();
    const entry = {
      path,
      type,
      holder,
      acquiredAt: now,
      expiresAt: now + this._lockTimeoutMs,
    };

    let locks = this._locks.get(path);
    if (!locks) {
      locks = [];
      this._locks.set(path, locks);
    }
    locks.push(entry);

    logger.info("Lock acquired", { path, type, holder });

    const release = () => this.release(path, holder);
    return { release, holder };
  }

  /**
   * Wait for lock
   * @private
   */
  _waitForLock(path, type, holder, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      const waiter = { type, holder, resolve, reject };

      let waiters = this._waiters.get(path);
      if (!waiters) {
        waiters = [];
        this._waiters.set(path, waiters);
      }
      waiters.push(waiter);

      // Timeout
      const timer = setTimeout(() => {
        this._removeWaiter(path, waiter);
        reject(new Error(`Lock acquire timeout for ${path}`));
      }, timeoutMs);

      // Abort
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          this._removeWaiter(path, waiter);
          reject(new Error("Aborted"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }

      // Wrap resolve to clear timeout
      const originalResolve = waiter.resolve;
      waiter.resolve = (result) => {
        clearTimeout(timer);
        originalResolve(result);
      };
    });
  }

  /**
   * Process waiters for a path
   * @private
   */
  _processWaiters(path) {
    const waiters = this._waiters.get(path);
    if (!waiters || waiters.length === 0) return;

    const toRemove = [];

    for (const waiter of waiters) {
      if (this._canAcquire(path, waiter.type)) {
        toRemove.push(waiter);
        const result = this._doAcquire(path, waiter.type, waiter.holder);
        waiter.resolve(result);
      }
    }

    for (const w of toRemove) {
      this._removeWaiter(path, w);
    }
  }

  /**
   * Remove waiter
   * @private
   */
  _removeWaiter(path, waiter) {
    const waiters = this._waiters.get(path);
    if (!waiters) return;

    const idx = waiters.indexOf(waiter);
    if (idx >= 0) {
      waiters.splice(idx, 1);
    }
    if (waiters.length === 0) {
      this._waiters.delete(path);
    }
  }

  /**
   * Clean expired locks for a path
   * @private
   */
  _cleanExpiredLocks(path) {
    const locks = this._locks.get(path);
    if (!locks) return;

    const now = Date.now();
    const valid = locks.filter((l) => l.expiresAt > now);

    if (valid.length < locks.length) {
      const expired = locks.length - valid.length;
      logger.info("Expired locks cleaned", { path, count: expired });

      if (valid.length === 0) {
        this._locks.delete(path);
      } else {
        this._locks.set(path, valid);
      }

      this._processWaiters(path);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Instance
// ─────────────────────────────────────────────────────────────────────────────

const FILE_LOCK_SERVICE_ID = "fileLock";

/**
 * Get global file lock instance
 * @returns {FileLock}
 *
 * @deprecated Prefer resolving via DI container (`ServiceId.FILE_LOCK`) or passing an explicit FileLock instance.
 */
export function getFileLock() {
  const container = getGlobalContainer();
  if (!container.has(FILE_LOCK_SERVICE_ID)) {
    container.register(FILE_LOCK_SERVICE_ID, () => new FileLock());
  }
  return container.get(FILE_LOCK_SERVICE_ID);
}

/**
 * Acquire lock using global instance
 * @param {string} path
 * @param {object} [options]
 * @returns {Promise<{ release: Function, holder: string }>}
 */
export function acquireLock(path, options) {
  return getFileLock().acquire(path, options);
}

/**
 * Execute with lock
 * @param {string} path
 * @param {function} fn
 * @param {object} [options]
 * @returns {Promise<any>}
 */
export async function withLock(path, fn, options = {}) {
  const lock = await acquireLock(path, options);
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

export default FileLock;
