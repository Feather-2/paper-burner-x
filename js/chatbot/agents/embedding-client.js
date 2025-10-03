// js/chatbot/agents/embedding-client.js
// 统一的 Embedding API 客户端，支持 OpenAI 格式的各种服务
(function(window) {
  'use strict';

  /**
   * Embedding API 配置
   * 支持的服务：
   * - OpenAI: text-embedding-3-small, text-embedding-3-large
   * - BGE-M3: BAAI/bge-m3 (通过兼容接口)
   * - Jina AI: jina-embeddings-v2-base-zh (多语言)
   * - 本地部署: 任何 OpenAI 兼容的服务
   */
  class EmbeddingClient {
    constructor() {
      this.config = this.loadConfig();
      this.cache = new Map(); // 内存缓存
    }

    loadConfig() {
      try {
        const saved = localStorage.getItem('embeddingConfig');
        if (saved) return JSON.parse(saved);
      } catch (e) {
        console.warn('[EmbeddingClient] 加载配置失败:', e);
      }

      // 默认配置
      return {
        provider: 'openai', // openai | jina | custom
        apiKey: '',
        endpoint: 'https://api.openai.com/v1/embeddings',
        model: 'text-embedding-3-small',
        dimensions: 1536, // OpenAI默认维度
        maxBatchSize: 2048, // 单次请求最大token数
        concurrency: 5, // 并发请求数 (5-50)
        enabled: false
      };
    }

    saveConfig(config) {
      this.config = Object.assign({}, this.config, config);
      try {
        localStorage.setItem('embeddingConfig', JSON.stringify(this.config));
      } catch (e) {
        console.error('[EmbeddingClient] 保存配置失败:', e);
      }
    }

    /**
     * 获取文本的向量表示
     * @param {string|string[]} input - 单个文本或文本数组
     * @returns {Promise<number[]|number[][]>} 向量或向量数组
     */
    async embed(input) {
      if (!this.config.enabled || !this.config.apiKey) {
        throw new Error('Embedding API 未配置或未启用');
      }

      const isBatch = Array.isArray(input);
      const texts = isBatch ? input : [input];

      // 检查缓存
      const cachedResults = [];
      const uncachedTexts = [];
      const uncachedIndices = [];

      texts.forEach((text, idx) => {
        const cacheKey = this.getCacheKey(text);
        if (this.cache.has(cacheKey)) {
          cachedResults[idx] = this.cache.get(cacheKey);
        } else {
          uncachedTexts.push(text);
          uncachedIndices.push(idx);
        }
      });

      // 如果全部命中缓存
      if (uncachedTexts.length === 0) {
        return isBatch ? cachedResults : cachedResults[0];
      }

      // 调用API
      const requestBody = {
        model: this.config.model,
        input: uncachedTexts,
        encoding_format: 'float'
      };

      // 对于支持降维的模型（如 OpenAI text-embedding-3-*）
      if (this.config.dimensions && this.config.dimensions < 1536) {
        requestBody.dimensions = this.config.dimensions;
      }

      try {
        const response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Embedding API 错误 (${response.status}): ${errText}`);
        }

        const data = await response.json();

        // OpenAI 格式响应: { data: [{ embedding: [...] }], usage: {...} }
        const embeddings = data.data.map(item => item.embedding);

        // 缓存结果
        uncachedTexts.forEach((text, idx) => {
          const cacheKey = this.getCacheKey(text);
          this.cache.set(cacheKey, embeddings[idx]);
          cachedResults[uncachedIndices[idx]] = embeddings[idx];
        });

        console.log(`[EmbeddingClient] 成功生成 ${embeddings.length} 个向量，使用token: ${data.usage?.total_tokens || '未知'}`);

        return isBatch ? cachedResults : cachedResults[0];
      } catch (error) {
        console.error('[EmbeddingClient] 调用API失败:', error);
        throw error;
      }
    }

    getCacheKey(text) {
      // 简单的哈希函数
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return `${this.config.model}_${hash}`;
    }

    /**
     * 批量生成向量（自动分批 + 并发处理）
     * @param {string[]} texts - 文本数组
     * @param {Object} options - 选项
     * @param {Function} options.onProgress - 进度回调 (current, total, message)
     * @returns {Promise<number[][]>} 向量数组
     */
    async batchEmbed(texts, options = {}) {
      const { onProgress = null } = options;

      const batches = [];
      let currentBatch = [];
      let currentTokens = 0;

      for (const text of texts) {
        // 粗略估算 token 数（中文1字≈1.5token，英文1词≈1token）
        const estimatedTokens = Math.ceil(text.length * 1.5);

        if (currentTokens + estimatedTokens > this.config.maxBatchSize && currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [text];
          currentTokens = estimatedTokens;
        } else {
          currentBatch.push(text);
          currentTokens += estimatedTokens;
        }
      }

      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }

      const concurrency = Math.max(1, Math.min(this.config.concurrency || 5, 50));
      console.log(`[EmbeddingClient] 分为 ${batches.length} 批次，并发数: ${concurrency}`);

      // 并发处理批次
      const results = new Array(batches.length);
      let nextIndex = 0;
      let completedCount = 0;

      async function processNext(self) {
        const i = nextIndex++;
        if (i >= batches.length) return;

        console.log(`[EmbeddingClient] 处理批次 ${i + 1}/${batches.length}`);
        results[i] = await self.embed(batches[i]);

        completedCount++;
        if (onProgress && typeof onProgress === 'function') {
          onProgress(completedCount, batches.length, `正在生成向量 ${completedCount}/${batches.length}`);
        }

        return processNext(self);
      }

      // 启动并发worker
      const workers = [];
      for (let i = 0; i < Math.min(concurrency, batches.length); i++) {
        workers.push(processNext(this));
      }

      await Promise.all(workers);

      // 合并结果
      const allEmbeddings = [];
      for (const batchResult of results) {
        allEmbeddings.push(...batchResult);
      }

      return allEmbeddings;
    }

    /**
     * 清空缓存
     */
    clearCache() {
      this.cache.clear();
      console.log('[EmbeddingClient] 缓存已清空');
    }
  }

  // 导出全局实例
  window.EmbeddingClient = new EmbeddingClient();

  console.log('[EmbeddingClient] Embedding客户端已加载');

})(window);
