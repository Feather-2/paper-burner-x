/**
 * 性能优化工具模块
 *
 * 提供常用的性能优化工具函数：
 * - 防抖 (debounce)
 * - 节流 (throttle)
 * - LRU 缓存
 * - 安全定时器管理
 *
 * @module PerformanceHelpers
 */

export const PerformanceHelpers = {
    /**
     * 防抖函数
     * 在事件触发后等待指定时间才执行，如果在等待期间再次触发则重新计时
     *
     * @param {Function} fn - 要执行的函数
     * @param {number} delay - 延迟时间（毫秒）
     * @returns {Function} 防抖后的函数
     *
     * @example
     * const debouncedSearch = PerformanceHelpers.debounce((query) => {
     *     console.log('Searching for:', query);
     * }, 300);
     *
     * input.addEventListener('input', (e) => debouncedSearch(e.target.value));
     */
    debounce(fn, delay) {
        let timer = null;

        return function debounced(...args) {
            const context = this;

            // 清除之前的定时器
            if (timer) {
                clearTimeout(timer);
            }

            // 设置新的定时器
            timer = setTimeout(() => {
                timer = null;
                fn.apply(context, args);
            }, delay);
        };
    },

    /**
     * 节流函数
     * 在指定时间内只执行一次，无论触发多少次
     *
     * @param {Function} fn - 要执行的函数
     * @param {number} delay - 时间间隔（毫秒）
     * @param {Object} options - 配置选项
     * @param {boolean} options.leading - 是否在开始时立即执行（默认 true）
     * @param {boolean} options.trailing - 是否在结束时执行（默认 true）
     * @returns {Function} 节流后的函数
     *
     * @example
     * const throttledScroll = PerformanceHelpers.throttle(() => {
     *     console.log('Scroll position:', window.scrollY);
     * }, 200);
     *
     * window.addEventListener('scroll', throttledScroll);
     */
    throttle(fn, delay, options = {}) {
        const { leading = true, trailing = true } = options;

        let lastCall = 0;
        let timer = null;

        return function throttled(...args) {
            const context = this;
            const now = Date.now();
            const timeSinceLastCall = now - lastCall;

            // 首次调用且 leading 为 true
            if (leading && lastCall === 0) {
                lastCall = now;
                return fn.apply(context, args);
            }

            // 清除之前的尾调用定时器
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            // 如果距离上次调用超过了延迟时间
            if (timeSinceLastCall >= delay) {
                lastCall = now;
                return fn.apply(context, args);
            }

            // 设置尾调用
            if (trailing) {
                timer = setTimeout(() => {
                    lastCall = Date.now();
                    timer = null;
                    fn.apply(context, args);
                }, delay - timeSinceLastCall);
            }
        };
    },

    /**
     * LRU (Least Recently Used) 缓存
     * 当缓存达到最大容量时，自动删除最久未使用的项
     *
     * @param {number} maxSize - 最大缓存数量
     * @returns {Object} 缓存对象，包含 get/set/clear/getStats 方法
     *
     * @example
     * const cache = PerformanceHelpers.createLRUCache(100);
     * cache.set('key1', 'value1');
     * const value = cache.get('key1');  // 'value1'
     * const stats = cache.getStats();   // { size: 1, hits: 1, misses: 0, ... }
     */
    createLRUCache(maxSize = 1000) {
        const cache = new Map();

        // 性能统计
        const stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            sets: 0
        };

        return {
            /**
             * 获取缓存值
             * @param {*} key - 缓存键
             * @returns {*} 缓存值，不存在返回 undefined
             */
            get(key) {
                if (!cache.has(key)) {
                    stats.misses++;
                    return undefined;
                }

                stats.hits++;
                const value = cache.get(key);

                // 移到最后（标记为最近使用）
                cache.delete(key);
                cache.set(key, value);

                return value;
            },

            /**
             * 设置缓存值
             * @param {*} key - 缓存键
             * @param {*} value - 缓存值
             */
            set(key, value) {
                stats.sets++;

                // 如果已存在，先删除（会重新添加到末尾）
                if (cache.has(key)) {
                    cache.delete(key);
                } else if (cache.size >= maxSize) {
                    // 删除最久未使用的（第一个）
                    const firstKey = cache.keys().next().value;
                    cache.delete(firstKey);
                    stats.evictions++;
                }

                cache.set(key, value);
            },

            /**
             * 检查键是否存在
             * @param {*} key - 缓存键
             * @returns {boolean}
             */
            has(key) {
                return cache.has(key);
            },

            /**
             * 删除指定键
             * @param {*} key - 缓存键
             * @returns {boolean} 是否删除成功
             */
            delete(key) {
                return cache.delete(key);
            },

            /**
             * 清空缓存
             */
            clear() {
                cache.clear();
                stats.hits = 0;
                stats.misses = 0;
                stats.evictions = 0;
                stats.sets = 0;
            },

            /**
             * 获取当前大小
             * @returns {number}
             */
            get size() {
                return cache.size;
            },

            /**
             * 获取统计信息
             * @returns {Object} 包含命中率、大小等信息
             */
            getStats() {
                const total = stats.hits + stats.misses;
                return {
                    size: cache.size,
                    maxSize: maxSize,
                    hits: stats.hits,
                    misses: stats.misses,
                    sets: stats.sets,
                    evictions: stats.evictions,
                    hitRate: total > 0 ? (stats.hits / total) : 0,
                    hitRatePercent: total > 0 ? ((stats.hits / total) * 100).toFixed(2) + '%' : '0%'
                };
            }
        };
    },

    /**
     * 安全定时器管理器
     * 自动跟踪所有定时器，确保在页面卸载时清理
     *
     * @returns {Object} 定时器管理器，包含 setTimeout/setInterval/clearAll 方法
     *
     * @example
     * const timers = PerformanceHelpers.createManagedTimer();
     * const id = timers.setTimeout(() => console.log('Hello'), 1000);
     * // 页面卸载时自动清理
     * window.addEventListener('beforeunload', () => timers.clearAll());
     */
    createManagedTimer() {
        const timers = new Set();

        return {
            /**
             * 设置延迟定时器
             * @param {Function} fn - 回调函数
             * @param {number} delay - 延迟时间（毫秒）
             * @returns {number} 定时器 ID
             */
            setTimeout(fn, delay) {
                const id = setTimeout(() => {
                    timers.delete(id);
                    fn();
                }, delay);

                timers.add(id);
                return id;
            },

            /**
             * 设置循环定时器
             * @param {Function} fn - 回调函数
             * @param {number} delay - 时间间隔（毫秒）
             * @returns {number} 定时器 ID
             */
            setInterval(fn, delay) {
                const id = setInterval(fn, delay);
                timers.add(id);
                return id;
            },

            /**
             * 清除指定定时器
             * @param {number} id - 定时器 ID
             */
            clear(id) {
                clearTimeout(id);
                clearInterval(id);
                timers.delete(id);
            },

            /**
             * 清除所有定时器
             */
            clearAll() {
                timers.forEach(id => {
                    clearTimeout(id);
                    clearInterval(id);
                });
                timers.clear();
            },

            /**
             * 获取活跃定时器数量
             * @returns {number}
             */
            get activeCount() {
                return timers.size;
            }
        };
    },

    /**
     * 轮询管理器
     * 支持页面可见性检测，在页面隐藏时自动暂停
     *
     * @param {Function} checkFn - 轮询执行的函数
     * @param {number} interval - 轮询间隔（毫秒）
     * @param {Object} options - 配置选项
     * @param {boolean} options.pauseWhenHidden - 页面隐藏时是否暂停（默认 true）
     * @returns {Object} 轮询管理器，包含 start/stop/pause/resume 方法
     *
     * @example
     * const poller = PerformanceHelpers.createPoller(
     *     () => checkForUpdates(),
     *     5000,
     *     { pauseWhenHidden: true }
     * );
     * poller.start();
     */
    createPoller(checkFn, interval = 1000, options = {}) {
        const { pauseWhenHidden = true } = options;

        let timerId = null;
        let isActive = false;
        let isPaused = false;

        const poll = () => {
            if (!isActive) return;

            // 如果页面隐藏且配置了暂停，则跳过执行
            if (!isPaused && (!pauseWhenHidden || !document.hidden)) {
                try {
                    checkFn();
                } catch (error) {
                    console.error('[Poller] Error in check function:', error);
                }
            }

            // 继续下一次轮询
            timerId = setTimeout(poll, interval);
        };

        const handleVisibilityChange = () => {
            if (document.hidden) {
                console.log('[Poller] Page hidden, pausing...');
            } else {
                console.log('[Poller] Page visible, resuming...');
            }
        };

        // 设置页面可见性监听
        if (pauseWhenHidden) {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        return {
            /**
             * 启动轮询
             */
            start() {
                if (isActive) {
                    console.warn('[Poller] Already active');
                    return;
                }

                isActive = true;
                isPaused = false;
                poll();
            },

            /**
             * 停止轮询
             */
            stop() {
                isActive = false;
                isPaused = false;

                if (timerId) {
                    clearTimeout(timerId);
                    timerId = null;
                }
            },

            /**
             * 暂停轮询（不清除定时器）
             */
            pause() {
                isPaused = true;
            },

            /**
             * 恢复轮询
             */
            resume() {
                isPaused = false;
            },

            /**
             * 获取状态
             * @returns {Object}
             */
            getStatus() {
                return {
                    isActive,
                    isPaused,
                    interval
                };
            },

            /**
             * 销毁轮询器
             */
            destroy() {
                this.stop();

                if (pauseWhenHidden) {
                    document.removeEventListener('visibilitychange', handleVisibilityChange);
                }
            }
        };
    },

    /**
     * 性能测量工具
     * 简化 Performance API 的使用
     *
     * @example
     * PerformanceHelpers.measure('render', () => {
     *     renderList();
     * });
     */
    measure: {
        /**
         * 测量函数执行时间
         * @param {string} label - 标签
         * @param {Function} fn - 要测量的函数
         * @returns {*} 函数返回值
         */
        sync(label, fn) {
            const startMark = `${label}-start`;
            const endMark = `${label}-end`;

            performance.mark(startMark);
            const result = fn();
            performance.mark(endMark);

            performance.measure(label, startMark, endMark);
            const measure = performance.getEntriesByName(label)[0];

            console.log(`[Measure] ${label}: ${measure.duration.toFixed(2)}ms`);

            // 清理
            performance.clearMarks(startMark);
            performance.clearMarks(endMark);
            performance.clearMeasures(label);

            return result;
        },

        /**
         * 测量异步函数执行时间
         * @param {string} label - 标签
         * @param {Function} fn - 要测量的异步函数
         * @returns {Promise<*>} 函数返回值
         */
        async async(label, fn) {
            const startMark = `${label}-start`;
            const endMark = `${label}-end`;

            performance.mark(startMark);
            const result = await fn();
            performance.mark(endMark);

            performance.measure(label, startMark, endMark);
            const measure = performance.getEntriesByName(label)[0];

            console.log(`[Measure] ${label}: ${measure.duration.toFixed(2)}ms`);

            // 清理
            performance.clearMarks(startMark);
            performance.clearMarks(endMark);
            performance.clearMeasures(label);

            return result;
        }
    }
};

// 导出默认对象（兼容 CommonJS）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PerformanceHelpers;
}
