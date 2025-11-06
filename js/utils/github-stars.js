/**
 * GitHub Stars 统一获取模块
 * 支持本地缓存和智能更新策略
 */
(function(window) {
  'use strict';

  const CACHE_KEY = 'pbx_github_stars_cache';
  const CACHE_DURATION = 3 * 60 * 60 * 1000; // 3小时（毫秒）
  const REPO_OWNER = 'Feather-2';
  const REPO_NAME = 'paper-burner';

  /**
   * 从 localStorage 获取缓存的 stars 数据
   * @returns {Object|null} 缓存数据 {stars: number, timestamp: number} 或 null
   */
  function getCachedStars() {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) return null;

      const data = JSON.parse(cached);
      if (!data || typeof data.stars !== 'number' || typeof data.timestamp !== 'number') {
        return null;
      }

      return data;
    } catch (e) {
      console.warn('[GitHubStars] Failed to read cache:', e);
      return null;
    }
  }

  /**
   * 将 stars 数据保存到 localStorage
   * @param {number} stars - stars 数量
   */
  function setCachedStars(stars) {
    try {
      const data = {
        stars: stars,
        timestamp: Date.now()
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[GitHubStars] Failed to save cache:', e);
    }
  }

  /**
   * 检查缓存是否过期
   * @param {number} timestamp - 缓存时间戳
   * @returns {boolean} 是否过期
   */
  function isCacheExpired(timestamp) {
    return (Date.now() - timestamp) >= CACHE_DURATION;
  }

  /**
   * 格式化 stars 数量显示
   * @param {number} stars - stars 数量
   * @returns {string} 格式化后的字符串（如 "5.5k"）
   */
  function formatStars(stars) {
    if (stars >= 1000) {
      return (stars / 1000).toFixed(1) + 'k';
    }
    return stars.toString();
  }

  /**
   * 从 GitHub API 获取 stars 数量
   * @returns {Promise<number>} stars 数量
   */
  function fetchStarsFromAPI() {
    return fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        if (data && typeof data.stargazers_count === 'number') {
          return data.stargazers_count;
        }
        throw new Error('Invalid API response');
      });
  }

  /**
   * 获取 GitHub stars 数量（带缓存）
   * @param {Object} options - 配置选项
   * @param {boolean} options.forceRefresh - 是否强制刷新（忽略缓存）
   * @returns {Promise<{stars: number, formatted: string, fromCache: boolean}>}
   */
  function getStars(options = {}) {
    const { forceRefresh = false } = options;

    return new Promise((resolve, reject) => {
      // 1. 尝试从缓存读取
      const cached = getCachedStars();

      if (cached && !forceRefresh && !isCacheExpired(cached.timestamp)) {
        // 缓存有效，直接返回
        console.log('[GitHubStars] Using cached data:', cached.stars);
        resolve({
          stars: cached.stars,
          formatted: formatStars(cached.stars),
          fromCache: true
        });
        return;
      }

      // 2. 如果有缓存但已过期，先返回缓存数据，然后在后台更新
      if (cached && !forceRefresh) {
        console.log('[GitHubStars] Cache expired, returning cached data and updating in background');
        resolve({
          stars: cached.stars,
          formatted: formatStars(cached.stars),
          fromCache: true
        });

        // 后台更新
        fetchStarsFromAPI()
          .then(stars => {
            setCachedStars(stars);
            console.log('[GitHubStars] Background update completed:', stars);
          })
          .catch(error => {
            console.warn('[GitHubStars] Background update failed:', error);
          });
        return;
      }

      // 3. 没有缓存或强制刷新，从 API 获取
      console.log('[GitHubStars] Fetching from API...');
      fetchStarsFromAPI()
        .then(stars => {
          setCachedStars(stars);
          resolve({
            stars: stars,
            formatted: formatStars(stars),
            fromCache: false
          });
        })
        .catch(error => {
          console.error('[GitHubStars] Failed to fetch from API:', error);

          // 如果有缓存（即使过期），作为后备返回
          if (cached) {
            console.log('[GitHubStars] Using expired cache as fallback');
            resolve({
              stars: cached.stars,
              formatted: formatStars(cached.stars),
              fromCache: true
            });
          } else {
            reject(error);
          }
        });
    });
  }

  /**
   * 清除缓存
   */
  function clearCache() {
    try {
      localStorage.removeItem(CACHE_KEY);
      console.log('[GitHubStars] Cache cleared');
    } catch (e) {
      console.warn('[GitHubStars] Failed to clear cache:', e);
    }
  }

  // 暴露到全局
  window.GitHubStars = {
    getStars: getStars,
    clearCache: clearCache,
    formatStars: formatStars
  };

})(window);
