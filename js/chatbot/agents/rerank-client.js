// js/chatbot/agents/rerank-client.js
// Rerank API 客户端
(function(window) {
  'use strict';

  /**
   * Rerank API 配置
   * 支持的服务：
   * - Jina AI: jina-reranker-v2-base-multilingual
   * - Cohere: rerank-english-v2.0, rerank-multilingual-v2.0
   * - OpenAI格式：兼容OpenAI API格式的重排服务
   */
  class RerankClient {
    constructor() {
      this.config = this.loadConfig();
    }

    /**
     * 从localStorage加载配置
     */
    loadConfig() {
      try {
        const saved = localStorage.getItem('rerankConfig');
        if (saved) return JSON.parse(saved);
      } catch (e) {
        console.warn('[RerankClient] 加载配置失败:', e);
      }

      // 默认配置
      return {
        enabled: false,
        scope: 'vector-only', // 'vector-only' | 'all'
        provider: 'jina',
        apiKey: '',
        endpoint: '',
        model: 'jina-reranker-v2-base-multilingual',
        topN: 10
      };
    }

    /**
     * 保存配置到localStorage
     */
    saveConfig(config) {
      this.config = { ...this.config, ...config };
      try {
        localStorage.setItem('rerankConfig', JSON.stringify(this.config));
      } catch (e) {
        console.error('[RerankClient] 保存配置失败:', e);
      }
    }

    /**
     * 检查是否应该对某种搜索类型使用重排
     * @param {string} searchType - 搜索类型: 'vector' | 'bm25' | 'hybrid'
     * @returns {boolean}
     */
    shouldRerank(searchType) {
      if (!this.config.enabled) return false;
      if (this.config.scope === 'all') return true;
      if (this.config.scope === 'vector-only' && searchType === 'vector') return true;
      return false;
    }

    /**
     * 重排文档（带容错）
     * @param {string} query - 查询文本
     * @param {Array<string|Object>} documents - 文档数组，可以是字符串或包含text字段的对象
     * @param {Object} options - 可选参数
     * @returns {Promise<Array>} 排序后的结果，包含index和relevance_score。失败时返回原始顺序
     */
    async rerank(query, documents, options = {}) {
      if (!this.config.enabled || !this.config.apiKey) {
        console.warn('[RerankClient] 重排未启用，返回原始顺序');
        return documents.map((doc, idx) => ({ index: idx, relevance_score: 1.0 - idx * 0.01 }));
      }

      if (!query || !documents || documents.length === 0) {
        console.warn('[RerankClient] 查询或文档为空，返回原始顺序');
        return documents.map((doc, idx) => ({ index: idx, relevance_score: 1.0 - idx * 0.01 }));
      }

      const { topN = this.config.topN, searchType = 'vector' } = options;

      // 检查是否应该对这种搜索类型使用重排
      if (!this.shouldRerank(searchType)) {
        console.log(`[RerankClient] ${searchType} 搜索不使用重排，返回原始顺序`);
        return documents.map((doc, idx) => ({ index: idx, relevance_score: 1.0 - idx * 0.01 }));
      }

      // 统一文档格式
      const formattedDocs = documents.map(doc =>
        typeof doc === 'string' ? doc : (doc.text || doc.content || '')
      );

      try {
        let result;

        switch (this.config.provider) {
          case 'jina':
            result = await this.rerankWithJina(query, formattedDocs, topN);
            break;
          case 'cohere':
            result = await this.rerankWithCohere(query, formattedDocs, topN);
            break;
          case 'openai':
            result = await this.rerankWithOpenAI(query, formattedDocs, topN);
            break;
          default:
            throw new Error(`不支持的重排服务商: ${this.config.provider}`);
        }

        console.log(`[RerankClient] 重排成功，返回 ${result.length} 个结果`);
        return result;
      } catch (error) {
        console.error('[RerankClient] 重排失败，降级为原始顺序:', error);
        // 失败时返回原始顺序
        return documents.map((doc, idx) => ({
          index: idx,
          relevance_score: 1.0 - idx * 0.01,
          document: typeof doc === 'string' ? { text: doc } : doc
        }));
      }
    }

    /**
     * 使用Jina AI重排
     */
    async rerankWithJina(query, documents, topN) {
      const endpoint = this.config.endpoint || 'https://api.jina.ai/v1/rerank';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          query: query,
          documents: documents,
          top_n: topN
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Jina AI 重排失败: ${response.status} ${error}`);
      }

      const data = await response.json();
      return data.results || [];
    }

    /**
     * 使用Cohere重排
     */
    async rerankWithCohere(query, documents, topN) {
      const endpoint = this.config.endpoint || 'https://api.cohere.ai/v1/rerank';

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          query: query,
          documents: documents,
          top_n: topN
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Cohere 重排失败: ${response.status} ${error}`);
      }

      const data = await response.json();
      return data.results || [];
    }

    /**
     * 使用OpenAI格式API重排
     */
    async rerankWithOpenAI(query, documents, topN) {
      if (!this.config.endpoint) {
        throw new Error('OpenAI格式需要配置endpoint');
      }

      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          query: query,
          documents: documents,
          top_n: topN
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI格式重排失败: ${response.status} ${error}`);
      }

      const data = await response.json();
      return data.results || [];
    }
  }

  // 导出到全局
  window.RerankClient = new RerankClient();

  console.log('[RerankClient] 客户端已加载');

})(window);

