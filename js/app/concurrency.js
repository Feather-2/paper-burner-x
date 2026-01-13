// concurrency.js - 并发控制

/**
 * @typedef {Object} Semaphore
 * @property {number} limit - 信号量允许的最大并发数。
 * @property {number} count - 当前已占用的并发数。
 * @property {Array<Function>} queue - 等待获取信号量的任务队列。
 */

/**
 * @type {Semaphore}
 * @description 用于控制翻译任务并发的信号量。
 */
export let translationSemaphore = {
    limit: 2, // 默认翻译并发数，可由设置覆盖
    count: 0,
    queue: []
};

/**
 * 获取一个翻译并发槽（基于信号量实现）。
 * 如果当前并发数未达到上限，则立即获取槽位。
 * 否则，将请求加入等待队列，直到有槽位释放。
 * @returns {Promise<void>} 当成功获取槽位时 resolve 的 Promise。
 * @async
 */
export async function acquireTranslationSlot() {
    if (translationSemaphore.count < translationSemaphore.limit) {
        translationSemaphore.count++;
        return Promise.resolve();
    } else {
        return new Promise(resolve => {
            translationSemaphore.queue.push(resolve);
        });
    }
}

/**
 * 释放一个翻译并发槽。
 * 减少当前并发数，并检查等待队列中是否有任务，如果有，则唤醒队列中的下一个任务。
 */
export function releaseTranslationSlot() {
    translationSemaphore.count--;
    if (translationSemaphore.queue.length > 0) {
        const nextResolve = translationSemaphore.queue.shift();
        acquireTranslationSlot().then(nextResolve);
    }
}

/**
 * 重置翻译信号量。
 * @param {number} limit - 新的并发限制。
 */
export function resetTranslationSemaphore(limit) {
    translationSemaphore.limit = limit;
    translationSemaphore.count = 0;
    translationSemaphore.queue = [];
}
