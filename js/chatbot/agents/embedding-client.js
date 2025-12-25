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
  function EmbeddingClient() {
    this.config = this.loadConfig();
    this.cache = new Map(); // 内存缓存
  }

  // 简单延时
  EmbeddingClient.prototype._delay = function(ms) { return new Promise(resolve => setTimeout(resolve, ms)); };

  // 是否应该重试（包含 401/403/429/408/5xx）
  EmbeddingClient.prototype._shouldRetry = function(status) {
    if (status === 401 || status === 403) return true;
    if (status === 429 || status === 408) return true;
    if (status >= 500 && status <= 599) return true;
    return false;
  };

  // 具备指数退避 + 抖动的重试封装
  EmbeddingClient.prototype._fetchWithRetry = async function(url, options = {}, retryOpts = {}) {
    const {
      maxRetries = 3,
      baseDelay = 500,
      maxDelay = 4000,
    } = retryOpts;

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, options);
        if (res.ok) return res;
        if (!this._shouldRetry(res.status) || attempt === maxRetries) {
          return res; // 交给上层解析/抛错
        }
        const jitter = Math.floor(Math.random() * 250);
        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt)) + jitter;
        await this._delay(delay);
      } catch (err) {
        lastError = err;
        if (attempt === maxRetries) throw err; // 网络错误且用尽重试
        const jitter = Math.floor(Math.random() * 250);
        const delay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt)) + jitter;
        await this._delay(delay);
      }
    }
    if (lastError) throw lastError;
    return fetch(url, options);
  };

  EmbeddingClient.prototype.loadConfig = function() {
    try {
      const saved = localStorage.getItem('embeddingConfig');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('[EmbeddingClient] 加载配置失败:', e);
    }

    return {
      provider: 'openai', // openai | jina | custom
      apiKey: '',
      endpoint: 'https://api.openai.com/v1/embeddings',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      maxBatchSize: 2048,
      concurrency: 5,
      enabled: false
    };
  };

  EmbeddingClient.prototype.saveConfig = function(config) {
    this.config = Object.assign({}, this.config, config);
    try {
      localStorage.setItem('embeddingConfig', JSON.stringify(this.config));
    } catch (e) {
      console.error('[EmbeddingClient] 保存配置失败:', e);
    }
  };

  /**
   * 获取文本的向量表示
   */
  EmbeddingClient.prototype.embed = async function(input) {
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
        input: uncachedTexts
      };

      // 根据服务商添加特定参数
      const provider = this.config.provider || 'openai';
      
      if (provider === 'openai') {
        // OpenAI 支持 encoding_format 和 dimensions
        requestBody.encoding_format = 'float';
        
        // 对于支持降维的模型（如 OpenAI text-embedding-3-*）
        if (this.config.dimensions && this.config.dimensions < 1536) {
          requestBody.dimensions = this.config.dimensions;
        }
      } else if (provider === 'alibaba') {
        // 阿里云百炼支持 dimensions
        if (this.config.dimensions) {
          requestBody.dimensions = this.config.dimensions;
        }
      }
      // Jina AI 和其他服务商不需要额外参数

      try {
        const response = await this._fetchWithRetry(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`
          },
          body: JSON.stringify(requestBody)
        }, { maxRetries: 3, baseDelay: 600, maxDelay: 5000 });

        if (!response.ok) {
          const errText = await response.text();
          const err = new Error(`Embedding API 错误 (${response.status}): ${errText}`);
          err.status = response.status;
          // 401/403 等鉴权问题认定为不可重试
          err.retryable = this._shouldRetry(response.status);
          throw err;
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

        console.log(`[EmbeddingClient] 成功生成 ${embeddings.length} 个向量，使用token: ${(data && data.usage && data.usage.total_tokens) || '未知'}`);

        return isBatch ? cachedResults : cachedResults[0];
      } catch (error) {
        console.error('[EmbeddingClient] 调用API失败:', error);
        const e = new Error(error.message || 'Embedding 调用失败');
        e.status = error.status;
        e.retryable = error.retryable;
        throw e;
      }
  };

    EmbeddingClient.prototype.getCacheKey = function(text) {
      // 简单的哈希函数
      let hash = 0;
      for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return `${this.config.model}_${hash}`;
    };

    /**
     * 批量生成向量（自动分批 + 并发处理）
     * @param {string[]} texts - 文本数组
     * @param {Object} options - 选项
     * @param {Function} options.onProgress - 进度回调 (current, total, message)
     * @returns {Promise<number[][]>} 向量数组
     */
    EmbeddingClient.prototype.batchEmbed = async function(texts, options = {}) {
      const onProgress = (options && options.onProgress) ? options.onProgress : null;

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

      let abortAll = false; // 硬错误（如 401/403）时中止

      async function processNext(self) {
        const i = nextIndex++;
        if (i >= batches.length) return;

        if (abortAll) return; // 已经判定为硬错误，停止排队

        console.log(`[EmbeddingClient] 处理批次 ${i + 1}/${batches.length}`);
        try {
          results[i] = await self.embed(batches[i]);
        } catch (err) {
          // 对于 401/403：停止继续调度新的批次，但保留已在飞的任务，返回部分结果
          if (err && (err.status === 401 || err.status === 403)) {
            abortAll = true;
            results[i] = new Array(batches[i].length).fill(null);
            if (onProgress && typeof onProgress === 'function') {
              onProgress(completedCount, batches.length, `鉴权失败 (${err.status})，停止新的批次，保留部分结果`);
            }
            // 不抛出，让其余并发任务自然结束，返回部分结果
          } else {
          // 其他错误（网络/429/5xx）在 _fetchWithRetry 已重试，此处标记该批失败并继续
          console.warn('[EmbeddingClient] 批次失败，已跳过:', (err && err.message) || err);
          results[i] = new Array(batches[i].length).fill(null);
          }

        completedCount++;
        if (onProgress && typeof onProgress === 'function') {
          onProgress(completedCount, batches.length, `正在生成向量 ${completedCount}/${batches.length}`);
        }

        if (!abortAll) return processNext(self);
      }

      // 启动并发worker
      const workers = [];
      for (let i = 0; i < Math.min(concurrency, batches.length); i++) {
        workers.push(processNext(this));
      }

      // 使用 Promise.allSettled 确保单个 worker 抛错不影响清理
      const settled = await Promise.allSettled(workers);
      const rejected = settled.find(r => r.status === 'rejected');
      if (rejected) {
        throw rejected.reason;
      }

      // 合并结果
      const allEmbeddings = [];
      for (const batchResult of results) {
        // 允许 batchResult 为空（理论上不应），做兜底
        if (Array.isArray(batchResult)) {
          allEmbeddings.push(...batchResult);
        }
      }

      return allEmbeddings;
    };

  /** 清空缓存 */
  EmbeddingClient.prototype.clearCache = function() {
    this.cache.clear();
    console.log('[EmbeddingClient] 缓存已清空');
  };

  // 导出全局实例
  window.EmbeddingClient = new EmbeddingClient();

  console.log('[EmbeddingClient] Embedding客户端已加载');

}

})(window);
