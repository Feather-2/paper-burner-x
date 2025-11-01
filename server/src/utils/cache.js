// 轻量 TTL 缓存：默认使用进程内 Map；如配置了 REDIS_URL，则优先使用 Redis。
// 多实例生产建议配置 Redis，以获得跨实例共享缓存；未配置则自动降级为内存缓存（开箱即用）。

let useRedis = !!process.env.REDIS_URL;
let redisClient = null;
let redisReady = false;

if (useRedis) {
  try {
    // 延迟加载依赖，避免未安装时报错；无 REDIS_URL 时不触发
    const { createClient } = await import('redis');
    redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => {
      console.warn('[cache] Redis error, fallback to memory:', err?.message || err);
      useRedis = false;
      redisReady = false;
    });
    await redisClient.connect();
    redisReady = true;
    console.log('[cache] Redis connected for admin stats cache');
  } catch (e) {
    // 未安装 redis 包或连接失败，降级
    useRedis = false;
    redisReady = false;
    if (process.env.REDIS_URL) {
      console.warn('[cache] Redis not available, fallback to memory:', e?.message || e);
    }
  }
}

const store = new Map(); // key -> { value, expiresAt }

/**
 * 读取缓存
 * @param {string} key
 * @returns {any|null}
 */
export function cacheGet(key) {
  try {
    if (useRedis && redisReady) {
      return redisClient.get(key).then((val) => {
        if (val == null) return null;
        try { return JSON.parse(val); } catch { return null; }
      }).catch(() => null);
    }
    const hit = store.get(key);
    if (!hit) return null;
    if (hit.expiresAt && hit.expiresAt < Date.now()) {
      store.delete(key);
      return null;
    }
    return hit.value;
  } catch {
    return null;
  }
}

/**
 * 写入缓存
 * @param {string} key
 * @param {any} value
 * @param {number} ttlMs - 过期时间（毫秒）
 */
export function cacheSet(key, value, ttlMs = 30000) {
  if (useRedis && redisReady) {
    try {
      const payload = JSON.stringify(value);
      if (ttlMs > 0) {
        // PX 以毫秒为单位
        return redisClient.set(key, payload, { PX: ttlMs });
      }
      return redisClient.set(key, payload);
    } catch {
      // ignore and fallback
    }
  }
  const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : 0;
  store.set(key, { value, expiresAt });
}

/**
 * 删除缓存（单键）
 * @param {string} key
 */
export function cacheDel(key) {
  if (useRedis && redisReady) {
    try { return redisClient.del(key); } catch { /* ignore */ }
  }
  store.delete(key);
}

/**
 * 按前缀删除缓存（批量）
 * @param {string} prefix
 * @returns {number} 删除条数
 */
export function cacheDelByPrefix(prefix) {
  let count = 0;
  if (useRedis && redisReady) {
    // 注意：SCAN 按需实现，这里不强求；若使用 Redis，建议使用规范化 key 前缀
    // 为避免高复杂度，这里只清理内存副本；Redis 端清理依赖上层采用版本号或更细粒度 key
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) { store.delete(key); count++; }
  }
  return count;
}
