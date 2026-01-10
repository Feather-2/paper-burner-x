/**
 * @file js/core/processing/semaphore.js
 * @description 信号量实现，用于并发控制
 */

/**
 * 创建信号量
 * @param {number} limit - 最大并发数
 * @returns {Object} 信号量对象
 */
export function createSemaphore(limit = 2) {
  return {
    limit,
    count: 0,
    queue: []
  };
}

/**
 * 获取信号量槽位
 * @param {Object} semaphore - 信号量对象
 * @returns {Promise<void>}
 */
export async function acquire(semaphore) {
  if (semaphore.count < semaphore.limit) {
    semaphore.count++;
    return Promise.resolve();
  }
  return new Promise(resolve => {
    semaphore.queue.push(resolve);
  });
}

/**
 * 释放信号量槽位
 * @param {Object} semaphore - 信号量对象
 */
export function release(semaphore) {
  semaphore.count--;
  if (semaphore.queue.length > 0) {
    const nextResolve = semaphore.queue.shift();
    acquire(semaphore).then(nextResolve);
  }
}

/**
 * 更新信号量限制
 * @param {Object} semaphore - 信号量对象
 * @param {number} newLimit - 新的限制值
 */
export function updateLimit(semaphore, newLimit) {
  semaphore.limit = Math.max(1, newLimit);

  // If the limit increased (or if there is newly available capacity),
  // immediately grant slots to queued waiters.
  while (semaphore.queue.length > 0 && semaphore.count < semaphore.limit) {
    semaphore.count++;
    const nextResolve = semaphore.queue.shift();
    nextResolve();
  }
}

/**
 * 获取当前状态
 * @param {Object} semaphore - 信号量对象
 * @returns {Object} 状态信息
 */
export function getStatus(semaphore) {
  return {
    limit: semaphore.limit,
    active: semaphore.count,
    waiting: semaphore.queue.length
  };
}

/**
 * 信号量类封装
 */
export class Semaphore {
  constructor(limit = 2) {
    this._semaphore = createSemaphore(limit);
  }

  get limit() {
    return this._semaphore.limit;
  }

  set limit(value) {
    updateLimit(this._semaphore, value);
  }

  get active() {
    return this._semaphore.count;
  }

  get waiting() {
    return this._semaphore.queue.length;
  }

  async acquire() {
    return acquire(this._semaphore);
  }

  release() {
    release(this._semaphore);
  }

  getStatus() {
    return getStatus(this._semaphore);
  }

  /**
   * 使用信号量执行函数
   * @param {Function} fn - 要执行的异步函数
   * @returns {Promise<any>}
   */
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// 默认导出
export default Semaphore;
