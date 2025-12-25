/**
 * TempSkillStore - 临时 Skill 存储
 *
 * 使用 IndexedDB 存储临时 Skill，支持 TTL 过期和 GC。
 * 可导出为 mcp-nexus 固定 Skills。
 *
 * Skill 数据结构支持迭代学习（预留能力，暂未启用）：
 * - iterations: 迭代历史记录
 * - learnings: 从执行中学到的经验
 * - improvements: 待改进项
 * - metrics: 执行指标
 */

const DB_NAME = "TempSkillsDB";
const DB_VERSION = 1;
const STORE_NAME = "skills";

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 小时

/**
 * @typedef {Object} SkillIteration
 * @property {number} version - 迭代版本号
 * @property {string} timestamp - 迭代时间
 * @property {string} trigger - 触发迭代的原因 (feedback|error|optimization|manual)
 * @property {Object} changes - 本次迭代的变更
 * @property {Object} [metrics] - 迭代前后的指标对比
 */

/**
 * @typedef {Object} SkillLearning
 * @property {string} id - 学习记录 ID
 * @property {string} timestamp - 记录时间
 * @property {string} type - 类型 (success|failure|edge_case|optimization)
 * @property {string} context - 触发上下文
 * @property {string} insight - 学到的经验
 * @property {boolean} applied - 是否已应用到 Skill
 */

/**
 * @typedef {Object} SkillMetrics
 * @property {number} executionCount - 执行次数
 * @property {number} successCount - 成功次数
 * @property {number} failureCount - 失败次数
 * @property {number} avgDuration - 平均执行时长 (ms)
 * @property {string} lastExecutedAt - 最后执行时间
 */

/**
 * @typedef {Object} TempSkillRecord
 * @property {string} name - 主键
 * @property {Object} definition - SkillDefinition
 * @property {string|null} handlerCode - 序列化的函数代码
 * @property {string} handlerType - inline|reference|none
 * @property {number} createdAt - 创建时间戳
 * @property {number} ttl - 生存时间 (ms)
 * @property {number} expiresAt - 过期时间戳
 * @property {boolean} exportedToNexus - 是否已导出
 * @property {number} version - 当前版本号
 * @property {SkillIteration[]} iterations - 迭代历史（预留）
 * @property {SkillLearning[]} learnings - 学习记录（预留）
 * @property {string[]} improvements - 待改进项（预留）
 * @property {SkillMetrics} metrics - 执行指标（预留）
 */

/**
 * 打开 IndexedDB 数据库
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "name" });
        store.createIndex("expiresAt", "expiresAt", { unique: false });
      }
    };
  });
}

/**
 * 序列化 handler 函数
 * @param {Function|null} handler
 * @returns {{ handlerCode: string|null, handlerType: string }}
 */
function serializeHandler(handler) {
  if (!handler) {
    return { handlerCode: null, handlerType: "none" };
  }
  if (typeof handler === "function") {
    try {
      const code = handler.toString();
      // 验证可以反序列化
      new Function(`return (${code})`)();
      return { handlerCode: code, handlerType: "inline" };
    } catch {
      return { handlerCode: null, handlerType: "none" };
    }
  }
  return { handlerCode: null, handlerType: "none" };
}

/**
 * 反序列化 handler 函数
 * @param {{ handlerCode: string|null, handlerType: string }} record
 * @returns {Function|null}
 */
function deserializeHandler(record) {
  if (record.handlerType === "inline" && record.handlerCode) {
    try {
      return new Function(`return (${record.handlerCode})`)();
    } catch {
      return null;
    }
  }
  return null;
}

export class TempSkillStore {
  /**
   * @param {Object} options
   * @param {number} [options.defaultTTL=86400000] - 默认 TTL（毫秒）
   */
  constructor({ defaultTTL = DEFAULT_TTL } = {}) {
    this.defaultTTL = defaultTTL;
    /** @type {Set<string>} 内存缓存，用于同步检查 */
    this._cache = new Set();
    this._cacheReady = false;
  }

  /**
   * 注册临时 Skill
   * @param {Object} definition - SkillDefinition
   * @param {Function|null} [handler] - 可选的执行处理器
   * @param {Object} [options]
   * @param {number} [options.ttl] - 自定义 TTL
   * @returns {Promise<string>} skillId (name)
   */
  async register(definition, handler = null, { ttl } = {}) {
    if (!definition?.name) {
      throw new Error("Skill definition must have a name");
    }

    const now = Date.now();
    const effectiveTTL = typeof ttl === "number" && ttl > 0 ? ttl : this.defaultTTL;
    const { handlerCode, handlerType } = serializeHandler(handler);

    const record = {
      name: definition.name,
      definition: {
        ...definition,
        metadata: {
          ...definition.metadata,
          source: "temp",
          createdAt: new Date(now).toISOString(),
        },
      },
      handlerCode,
      handlerType,
      createdAt: now,
      ttl: effectiveTTL,
      expiresAt: now + effectiveTTL,
      exportedToNexus: false,
      // 迭代学习能力（预留，暂未启用）
      version: 1,
      iterations: [],
      learnings: [],
      improvements: [],
      metrics: {
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        avgDuration: 0,
        lastExecutedAt: null,
      },
    };

    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    this._cache.add(definition.name);
    return definition.name;
  }

  /**
   * 获取 Skill（含过期检查）
   * @param {string} name
   * @returns {Promise<{ definition: Object, handler: Function|null }|null>}
   */
  async get(name) {
    const db = await openDB();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (!record) {
      this._cache.delete(name);
      return null;
    }

    // 过期检查
    if (record.expiresAt < Date.now()) {
      await this.remove(name);
      return null;
    }

    return {
      definition: record.definition,
      handler: deserializeHandler(record),
    };
  }

  /**
   * 列出所有有效 Skill
   * @returns {Promise<Object[]>} SkillDefinition[]
   */
  async list() {
    const db = await openDB();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    const now = Date.now();
    const valid = records.filter((r) => r.expiresAt >= now);

    // 更新缓存
    this._cache.clear();
    for (const r of valid) {
      this._cache.add(r.name);
    }
    this._cacheReady = true;

    return valid.map((r) => r.definition);
  }

  /**
   * 移除 Skill
   * @param {string} name
   * @returns {Promise<boolean>}
   */
  async remove(name) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    this._cache.delete(name);
    return true;
  }

  /**
   * 垃圾回收 - 清理过期 Skill
   * @returns {Promise<number>} 删除数量
   */
  async gc() {
    const db = await openDB();
    const now = Date.now();

    const expired = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const index = tx.objectStore(STORE_NAME).index("expiresAt");
      const range = IDBKeyRange.upperBound(now, true);
      const request = index.getAll(range);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });

    if (expired.length === 0) return 0;

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const record of expired) {
        store.delete(record.name);
        this._cache.delete(record.name);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return expired.length;
  }

  /**
   * 同步检查是否存在（使用内存缓存）
   * @param {string} name
   * @returns {boolean}
   */
  hasCapability(name) {
    return this._cache.has(name);
  }

  /**
   * 刷新内存缓存
   * @returns {Promise<void>}
   */
  async refreshCache() {
    await this.list();
  }

  /**
   * 导出为 NexusSkillProvider 兼容格式
   * @param {string} name
   * @returns {Promise<Object|null>}
   */
  async exportForNexus(name) {
    const skill = await this.get(name);
    if (!skill) return null;

    return {
      definition: {
        name: skill.definition.name,
        description: skill.definition.description || "",
        priority: skill.definition.priority || 0,
        mutexKey: skill.definition.mutexKey || null,
        metadata: {
          ...skill.definition.metadata,
          source: "nexus",
          originalSource: "temp",
          exportedAt: new Date().toISOString(),
        },
      },
      handler: skill.handler,
    };
  }

  /**
   * 标记为已导出到 Nexus
   * @param {string} name
   * @returns {Promise<boolean>}
   */
  async markExported(name) {
    const db = await openDB();
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (!record) return false;

    record.exportedToNexus = true;
    record.exportedAt = new Date().toISOString();

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return true;
  }
}

export default TempSkillStore;
