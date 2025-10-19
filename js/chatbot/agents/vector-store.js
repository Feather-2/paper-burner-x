// js/chatbot/agents/vector-store.js
// 纯JS向量数据库，基于IndexedDB持久化
(function(window) {
  'use strict';

  const VECTOR_DB_NAME = 'SemanticVectorDB';
  const VECTOR_DB_VERSION = 1;
  const STORE_NAME = 'vectors';

  /**
   * 轻量级向量数据库
   * 功能：存储、检索、相似度计算
   */
  class VectorStore {
    constructor(namespace = 'default') {
      this.namespace = namespace;
      this.db = null;
      this.memoryIndex = null; // 内存中的向量索引（加速检索）
    }

    async init() {
      if (this.db) return;

      return new Promise((resolve, reject) => {
        const request = indexedDB.open(VECTOR_DB_NAME, VECTOR_DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          this.db = request.result;
          resolve();
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('namespace', 'namespace', { unique: false });
            store.createIndex('docId', 'docId', { unique: false });
          }
        };
      });
    }

    /**
     * 插入或更新向量
     * @param {string} id - 唯一标识（如 groupId）
     * @param {number[]} vector - 向量
     * @param {Object} metadata - 元数据（如摘要、关键词）
     */
    async upsert(id, vector, metadata = {}) {
      await this.init();

      const item = {
        id: `${this.namespace}:${id}`,
        namespace: this.namespace,
        docId: metadata.docId || this.namespace,
        vector: vector,
        metadata: metadata,
        timestamp: Date.now()
      };

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(item);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * 批量插入
     * @param {Array<{id: string, vector: number[], metadata: Object}>} items
     */
    async batchUpsert(items) {
      await this.init();

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        let completed = 0;
        items.forEach(item => {
          const record = {
            id: `${this.namespace}:${item.id}`,
            namespace: this.namespace,
            docId: item.metadata?.docId || this.namespace,
            vector: item.vector,
            metadata: item.metadata || {},
            timestamp: Date.now()
          };

          const request = store.put(record);
          request.onsuccess = () => {
            completed++;
            if (completed === items.length) {
              resolve();
            }
          };
          request.onerror = () => reject(request.error);
        });
      });
    }

    /**
     * 获取向量
     * @param {string} id
     */
    async get(id) {
      await this.init();

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(`${this.namespace}:${id}`);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * 加载内存索引（加速检索）
     */
    async loadMemoryIndex() {
      await this.init();

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('namespace');
        const request = index.getAll(this.namespace);

        request.onsuccess = () => {
          this.memoryIndex = request.result;
          console.log(`[VectorStore] 加载 ${this.memoryIndex.length} 个向量到内存`);
          resolve(this.memoryIndex);
        };
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * 余弦相似度
     */
    cosineSimilarity(vecA, vecB) {
      if (!vecA || !vecB || vecA.length !== vecB.length) {
        throw new Error('向量维度不匹配');
      }

      let dotProduct = 0;
      let normA = 0;
      let normB = 0;

      for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
      }

      const denominator = Math.sqrt(normA) * Math.sqrt(normB);
      return denominator === 0 ? 0 : dotProduct / denominator;
    }

    /**
     * 向量检索
     * @param {number[]} queryVector - 查询向量
     * @param {number} topK - 返回top K结果
     * @param {Object} filter - 过滤条件（如 {docId: 'xxx'}）
     * @returns {Promise<Array<{id: string, score: number, metadata: Object}>>}
     */
    async search(queryVector, topK = 5, filter = {}) {
      // 如果没有内存索引，先加载
      if (!this.memoryIndex) {
        await this.loadMemoryIndex();
      }

      // 计算相似度
      let candidates = this.memoryIndex.map(item => ({
        id: item.id.replace(`${this.namespace}:`, ''), // 移除namespace前缀
        score: this.cosineSimilarity(queryVector, item.vector),
        metadata: item.metadata,
        vector: item.vector
      }));

      // 应用过滤器
      if (filter.docId) {
        candidates = candidates.filter(c => c.metadata.docId === filter.docId);
      }

      // 排序并返回topK
      candidates.sort((a, b) => b.score - a.score);
      return candidates.slice(0, topK);
    }

    /**
     * 删除指定文档的所有向量
     * @param {string} docId
     */
    async deleteByDocId(docId) {
      await this.init();

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('docId');
        const request = index.openCursor(IDBKeyRange.only(docId));

        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            // 清空内存索引，强制重新加载
            this.memoryIndex = null;
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * 清空当前namespace的所有数据
     */
    async clear() {
      await this.init();

      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('namespace');
        const request = index.openCursor(IDBKeyRange.only(this.namespace));

        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            this.memoryIndex = null;
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
    }

    /**
     * 统计信息
     */
    async stats() {
      if (!this.memoryIndex) {
        await this.loadMemoryIndex();
      }

      return {
        namespace: this.namespace,
        count: this.memoryIndex.length,
        dimensions: this.memoryIndex.length > 0 ? this.memoryIndex[0].vector.length : 0,
        size: JSON.stringify(this.memoryIndex).length // 粗略估算大小
      };
    }
  }

  // 导出
  window.VectorStore = VectorStore;

  console.log('[VectorStore] 向量数据库已加载');

})(window);
