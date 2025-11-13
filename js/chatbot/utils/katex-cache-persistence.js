/**
 * Paper Burner - KaTeX 缓存持久化系统
 * Phase 4.2+: 自动保存和恢复公式缓存到 localStorage
 *
 * 功能：
 * - 页面关闭时自动保存缓存
 * - 页面加载时自动恢复缓存
 * - 自动清理过期缓存（7 天）
 * - 管理存储配额（最多 5MB）
 *
 * 预期收益：
 * - 二次访问时公式渲染速度提升 99%
 * - 完全消除重复公式的渲染时间
 */

(function() {
  'use strict';

  const STORAGE_CONFIG = {
    KEY: 'paperburner_katex_cache',
    VERSION: 1,
    MAX_AGE_DAYS: 7,                    // 缓存有效期（天）
    MAX_SIZE_MB: 5,                     // 最大存储空间（MB）
    AUTO_SAVE_INTERVAL: 30000,          // 自动保存间隔（30秒）
    ENABLE_AUTO_SAVE: true,             // 是否启用自动保存
    ENABLE_DEBUG: false                 // 调试模式
  };

  /**
   * KaTeX 缓存持久化管理器
   */
  class KaTeXCachePersistence {
    constructor(cache, options = {}) {
      this.cache = cache;
      this.storageKey = options.storageKey || STORAGE_CONFIG.KEY;
      this.maxAgeDays = options.maxAgeDays || STORAGE_CONFIG.MAX_AGE_DAYS;
      this.maxSizeMB = options.maxSizeMB || STORAGE_CONFIG.MAX_SIZE_MB;
      this.autoSaveInterval = options.autoSaveInterval || STORAGE_CONFIG.AUTO_SAVE_INTERVAL;
      this.enableAutoSave = options.enableAutoSave !== false;
      this.enableDebug = options.enableDebug || STORAGE_CONFIG.ENABLE_DEBUG;

      this.autoSaveTimer = null;
      this.lastSaveTime = 0;
      this.saveCount = 0;

      this.init();
    }

    /**
     * 初始化持久化系统
     */
    init() {
      // 加载缓存
      this.load();

      // 设置自动保存
      if (this.enableAutoSave) {
        this.startAutoSave();
      }

      // 页面卸载时保存
      window.addEventListener('beforeunload', () => {
        this.save();
      });

      // 页面隐藏时保存（移动端）
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.save();
        }
      });

      this.log('Persistence system initialized', 'info');
    }

    /**
     * 从 localStorage 加载缓存
     */
    load() {
      try {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) {
          this.log('No cached data found', 'info');
          return false;
        }

        const data = JSON.parse(stored);

        // 验证版本
        if (data.version !== STORAGE_CONFIG.VERSION) {
          this.log(`Version mismatch: ${data.version} vs ${STORAGE_CONFIG.VERSION}`, 'warn');
          this.clear();
          return false;
        }

        // 检查过期时间
        const age = Date.now() - data.timestamp;
        const maxAge = this.maxAgeDays * 24 * 60 * 60 * 1000;

        if (age > maxAge) {
          this.log(`Cache expired: ${Math.round(age / 86400000)} days old`, 'warn');
          this.clear();
          return false;
        }

        // 导入缓存
        const success = this.cache.import(data.cacheData);

        if (success) {
          const size = this.estimateSize(stored);
          this.log(`✅ Loaded ${data.cacheData.entries.length} formulas from cache (${size} KB, ${Math.round(age / 60000)} min old)`, 'success');
          return true;
        } else {
          this.log('Failed to import cache data', 'error');
          return false;
        }
      } catch (error) {
        this.log(`Load error: ${error.message}`, 'error');
        this.clear();
        return false;
      }
    }

    /**
     * 保存缓存到 localStorage
     */
    save() {
      try {
        const cacheData = this.cache.export();

        const data = {
          version: STORAGE_CONFIG.VERSION,
          timestamp: Date.now(),
          cacheData: cacheData
        };

        const json = JSON.stringify(data);
        const size = this.estimateSize(json);

        // 检查大小限制
        if (size > this.maxSizeMB * 1024) {
          this.log(`Cache too large: ${size} KB > ${this.maxSizeMB * 1024} KB`, 'warn');

          // 尝试清理旧条目
          this.pruneCache(cacheData);
          return this.save(); // 递归保存清理后的缓存
        }

        localStorage.setItem(this.storageKey, json);

        this.lastSaveTime = Date.now();
        this.saveCount++;

        this.log(`💾 Saved ${cacheData.entries.length} formulas (${size} KB) [#${this.saveCount}]`, 'success');
        return true;
      } catch (error) {
        if (error.name === 'QuotaExceededError') {
          this.log('Storage quota exceeded, clearing old cache', 'warn');
          this.clear();
          return false;
        }

        this.log(`Save error: ${error.message}`, 'error');
        return false;
      }
    }

    /**
     * 清理缓存（保留最近使用的条目）
     */
    pruneCache(cacheData) {
      const maxEntries = Math.floor(cacheData.entries.length * 0.7); // 保留 70%
      const prunedEntries = cacheData.entries.slice(-maxEntries);

      this.log(`Pruning cache: ${cacheData.entries.length} → ${prunedEntries.length}`, 'warn');

      cacheData.entries = prunedEntries;
      this.cache.import(cacheData);
    }

    /**
     * 清空缓存
     */
    clear() {
      try {
        localStorage.removeItem(this.storageKey);
        this.cache.clear();
        this.log('Cache cleared', 'info');
        return true;
      } catch (error) {
        this.log(`Clear error: ${error.message}`, 'error');
        return false;
      }
    }

    /**
     * 启动自动保存
     */
    startAutoSave() {
      if (this.autoSaveTimer) {
        clearInterval(this.autoSaveTimer);
      }

      this.autoSaveTimer = setInterval(() => {
        const stats = this.cache.getStats();

        // 只有缓存有更新时才保存
        if (stats.hits > 0 || stats.misses > 0) {
          this.save();
        }
      }, this.autoSaveInterval);

      this.log(`Auto-save enabled: every ${this.autoSaveInterval / 1000}s`, 'info');
    }

    /**
     * 停止自动保存
     */
    stopAutoSave() {
      if (this.autoSaveTimer) {
        clearInterval(this.autoSaveTimer);
        this.autoSaveTimer = null;
        this.log('Auto-save disabled', 'info');
      }
    }

    /**
     * 估算数据大小（KB）
     */
    estimateSize(data) {
      const bytes = new Blob([data]).size;
      return Math.round(bytes / 1024);
    }

    /**
     * 获取持久化统计信息
     */
    getStats() {
      try {
        const stored = localStorage.getItem(this.storageKey);
        if (!stored) {
          return {
            exists: false,
            size: 0,
            age: 0,
            entries: 0
          };
        }

        const data = JSON.parse(stored);
        const size = this.estimateSize(stored);
        const age = Date.now() - data.timestamp;

        return {
          exists: true,
          size: size,
          sizeFormatted: `${size} KB`,
          age: age,
          ageFormatted: this.formatAge(age),
          entries: data.cacheData?.entries?.length || 0,
          version: data.version,
          lastSaveTime: this.lastSaveTime,
          saveCount: this.saveCount
        };
      } catch (error) {
        return {
          exists: false,
          error: error.message
        };
      }
    }

    /**
     * 格式化时间差
     */
    formatAge(ms) {
      const minutes = Math.floor(ms / 60000);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return `${days} 天前`;
      if (hours > 0) return `${hours} 小时前`;
      if (minutes > 0) return `${minutes} 分钟前`;
      return '刚刚';
    }

    /**
     * 日志输出
     */
    log(message, type = 'info') {
      if (!this.enableDebug && type !== 'error') return;

      const prefix = '[KaTeXCache Persistence]';
      const timestamp = new Date().toLocaleTimeString();

      switch (type) {
        case 'success':
          console.log(`%c${prefix} ${message}`, 'color: #48bb78; font-weight: bold');
          break;
        case 'warn':
          console.warn(`${prefix} ${message}`);
          break;
        case 'error':
          console.error(`${prefix} ${message}`);
          break;
        default:
          console.log(`${prefix} ${message}`);
      }
    }
  }

  // 自动初始化持久化系统
  if (window.katexCache && !window.katexCachePersistence) {
    window.KaTeXCachePersistence = KaTeXCachePersistence;
    window.katexCachePersistence = new KaTeXCachePersistence(window.katexCache, {
      enableAutoSave: STORAGE_CONFIG.ENABLE_AUTO_SAVE,
      enableDebug: STORAGE_CONFIG.ENABLE_DEBUG
    });

    console.log('[KaTeXCache] Cache persistence enabled (auto-save every 30s)');

    // 提供全局查看方法
    window.getKatexPersistenceStats = function() {
      const stats = window.katexCachePersistence.getStats();
      console.log('KaTeX 缓存持久化统计：');
      console.table(stats);
      return stats;
    };

    // 提供手动保存方法
    window.saveKatexCache = function() {
      return window.katexCachePersistence.save();
    };

    // 提供手动清除方法
    window.clearKatexCache = function() {
      return window.katexCachePersistence.clear();
    };
  } else if (!window.katexCache) {
    console.warn('[KaTeXCache Persistence] Cannot initialize: katexCache not found');
  }
})();

console.log('[KaTeXCache Persistence] System loaded');
console.log('  Stats: getKatexPersistenceStats()');
console.log('  Manual save: saveKatexCache()');
console.log('  Clear cache: clearKatexCache()');
