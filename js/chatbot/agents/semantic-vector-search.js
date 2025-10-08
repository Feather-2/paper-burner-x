// js/chatbot/agents/semantic-vector-search.js
// 意群向量搜索集成层
(function(window) {
  'use strict';

  /**
   * 意群向量搜索引擎
   * 集成 EmbeddingClient 和 VectorStore
   */
  class SemanticVectorSearch {
    constructor() {
      this.vectorStore = null;
      this.initialized = false;
      this.indexedDocs = new Set(); // 已建立索引的文档ID
    }

    /**
     * 初始化（检查配置）
     */
    async init() {
      if (this.initialized) return true;

      // 检查依赖
      if (!window.EmbeddingClient || !window.VectorStore) {
        console.warn('[SemanticVectorSearch] 依赖未加载');
        return false;
      }

      // 检查Embedding配置
      if (!window.EmbeddingClient.config.enabled || !window.EmbeddingClient.config.apiKey) {
        console.warn('[SemanticVectorSearch] Embedding API未配置');
        return false;
      }

      this.initialized = true;
      return true;
    }

    /**
     * 为意群建立向量索引
     * @param {Array<Object>} groups - 意群数组
     * @param {string} docId - 文档ID
     * @param {Object} options - 选项
     */
    async indexGroups(groups, docId, options = {}) {
      const { showProgress = true, forceRebuild = false } = options;

      if (!await this.init()) {
        throw new Error('向量搜索未初始化');
      }

      // 检查是否已索引
      if (this.indexedDocs.has(docId) && !forceRebuild) {
        console.log(`[SemanticVectorSearch] 文档 ${docId} 已建立索引，跳过`);
        return;
      }

      // 创建或获取VectorStore
      if (!this.vectorStore || this.vectorStore.namespace !== docId) {
        this.vectorStore = new window.VectorStore(docId);
        await this.vectorStore.init();
      }

      if (showProgress && window.ChatbotUtils?.showToast) {
        window.ChatbotUtils.showToast('正在建立向量索引...', 'info', 3000);
      }

      try {
        // 准备文本：关键词 + 摘要 + 完整digest
        const texts = groups.map(g => {
          const keywords = (g.keywords || []).join(' ');
          const summary = g.summary || '';
          const digest = g.digest || ''; // 使用完整digest，不截断
          return `${keywords}\n${summary}\n${digest}`.trim();
        });

        console.log(`[SemanticVectorSearch] 开始生成 ${texts.length} 个向量...`);

        // 批量生成向量
        const vectors = await window.EmbeddingClient.batchEmbed(texts);

        // 批量存储
        const items = groups.map((g, idx) => ({
          id: g.groupId,
          vector: vectors[idx],
          metadata: {
            docId: docId,
            groupId: g.groupId,
            charCount: g.charCount,
            keywords: g.keywords,
            summary: g.summary,
            segments: g.segments
          }
        }));

        await this.vectorStore.batchUpsert(items);

        // 加载到内存索引
        await this.vectorStore.loadMemoryIndex();

        this.indexedDocs.add(docId);

        console.log(`[SemanticVectorSearch] 向量索引建立完成，共 ${vectors.length} 个意群`);

        if (showProgress && window.ChatbotUtils?.showToast) {
          window.ChatbotUtils.showToast('向量索引建立完成', 'success', 2000);
        }

        // 保存索引状态到 window.data
        if (window.data) {
          window.data.vectorIndexReady = true;
          window.data.vectorIndexTimestamp = Date.now();
        }

      } catch (error) {
        console.error('[SemanticVectorSearch] 建立索引失败:', error);
        if (showProgress && window.ChatbotUtils?.showToast) {
          window.ChatbotUtils.showToast('向量索引建立失败', 'error', 3000);
        }
        throw error;
      }
    }

    /**
     * 为chunks建立向量索引（新版）
     * @param {Array<Object>} chunks - enrichedChunks数组
     * @param {string} docId - 文档ID
     * @param {Object} options - 选项
     */
    async indexChunks(chunks, docId, options = {}) {
      const { showProgress = true, forceRebuild = false } = options;

      if (!await this.init()) {
        throw new Error('向量搜索未初始化');
      }

      // 创建或获取VectorStore
      if (!this.vectorStore || this.vectorStore.namespace !== docId) {
        this.vectorStore = new window.VectorStore(docId);
        await this.vectorStore.init();
      }

      // 检查IndexedDB中是否已有向量（而不是仅检查内存）
      if (!forceRebuild) {
        try {
          await this.vectorStore.loadMemoryIndex();
          const existingCount = this.vectorStore.memoryIndex?.length || 0;

          // 如果向量数量匹配，说明已索引，直接使用
          if (existingCount === chunks.length) {
            console.log(`[SemanticVectorSearch] 文档 ${docId} 已有 ${existingCount} 个向量缓存，直接使用`);
            this.indexedDocs.add(docId);

            if (window.data) {
              window.data.vectorIndexReady = true;
              window.data.vectorIndexTimestamp = Date.now();
            }

            if (showProgress && window.ChatbotUtils?.showToast) {
              window.ChatbotUtils.showToast('向量索引已就绪（从缓存加载）', 'success', 2000);
            }

            return;
          } else if (existingCount > 0) {
            console.warn(`[SemanticVectorSearch] 向量数量不匹配（缓存${existingCount}个，当前${chunks.length}个），重新生成`);
          }
        } catch (err) {
          console.warn('[SemanticVectorSearch] 加载向量缓存失败，将重新生成:', err);
        }
      }

      // 创建进度toast
      let progressToast = null;
      if (showProgress && window.ChatbotUtils && typeof window.ChatbotUtils.showProgressToast === 'function') {
        progressToast = window.ChatbotUtils.showProgressToast('开始生成向量索引...', 0);
      }

      try {
        // 准备文本：直接使用chunk的text
        const texts = chunks.map(c => c.text);

        console.log(`[SemanticVectorSearch] 开始生成 ${texts.length} 个chunk向量...`);

        // 批量生成向量（带进度回调）
        const vectors = await window.EmbeddingClient.batchEmbed(texts, {
          onProgress: (current, total, message) => {
            const percent = Math.round((current / total) * 100);
            if (progressToast && typeof progressToast.update === 'function') {
              progressToast.update(`${message} (${percent}%)`, percent);
            }
            console.log(`[SemanticVectorSearch] 向量生成进度: ${current}/${total} (${percent}%)`);
          }
        });

        // 批量存储
        const items = chunks.map((chunk, idx) => ({
          id: chunk.chunkId,
          vector: vectors[idx],
          metadata: {
            docId: docId,
            chunkId: chunk.chunkId,
            belongsToGroup: chunk.belongsToGroup,
            position: chunk.position,
            charCount: chunk.charCount,
            text: chunk.text.substring(0, 200) // 只存储前200字作为预览
          }
        }));

        await this.vectorStore.batchUpsert(items);

        // 加载到内存索引
        await this.vectorStore.loadMemoryIndex();

        this.indexedDocs.add(docId);

        console.log(`[SemanticVectorSearch] 向量索引建立完成，共 ${vectors.length} 个chunks`);

        // 关闭进度toast，显示成功提示
        if (progressToast && typeof progressToast.close === 'function') {
          progressToast.close();
        }
        if (showProgress && window.ChatbotUtils?.showToast) {
          window.ChatbotUtils.showToast('向量索引建立完成', 'success', 2000);
        }

        // 保存索引状态到 window.data
        if (window.data) {
          window.data.vectorIndexReady = true;
          window.data.vectorIndexTimestamp = Date.now();
        }

      } catch (error) {
        console.error('[SemanticVectorSearch] 建立索引失败:', error);

        // 关闭进度toast
        if (progressToast && typeof progressToast.close === 'function') {
          progressToast.close();
        }

        if (showProgress && window.ChatbotUtils?.showToast) {
          window.ChatbotUtils.showToast('向量索引建立失败', 'error', 3000);
        }
        throw error;
      }
    }

    /**
     * 向量检索chunks（纯向量搜索，不做降级）
     * @param {string} query - 用户查询
     * @param {Array<Object>} chunks - enrichedChunks数组（用于返回完整chunk对象）
     * @param {Object} options - 选项
     * @returns {Promise<Array<Object>>} 匹配的chunks
     */
    async search(query, chunks = [], options = {}) {
      const { topK = 10, threshold = 0.3 } = options;

      if (!await this.init()) {
        console.warn('[SemanticVectorSearch] 向量搜索未初始化');
        return [];
      }

      const docId = this.getCurrentDocId();

      // 确保有VectorStore
      if (!this.vectorStore || this.vectorStore.namespace !== docId) {
        this.vectorStore = new window.VectorStore(docId);
        await this.vectorStore.init();
      }

      // 检查索引是否存在
      const stats = await this.vectorStore.stats();
      if (stats.count === 0) {
        console.warn('[SemanticVectorSearch] 索引为空');
        return [];
      }

      try {
        // 生成查询向量
        const queryVector = await window.EmbeddingClient.embed(query);

        // 向量检索
        const results = await this.vectorStore.search(queryVector, topK);

        // 过滤低分结果
        const filtered = results.filter(r => r.score >= threshold);

        console.log(`[SemanticVectorSearch] 向量检索匹配 ${filtered.length} 个chunks，分数范围: ${filtered[0]?.score.toFixed(3)} - ${filtered[filtered.length - 1]?.score.toFixed(3)}`);

        // 从chunks中找出对应的完整chunk对象
        const chunkMap = new Map(chunks.map(c => [c.chunkId, c]));
        const matchedChunks = filtered
          .map(r => {
            const chunk = chunkMap.get(r.metadata.chunkId);
            if (chunk) {
              return {
                ...chunk,
                score: r.score
              };
            }
            return null;
          })
          .filter(Boolean)
          .slice(0, topK);

        // 尝试使用重排（如果启用）
        if (window.RerankClient && window.RerankClient.shouldRerank('vector')) {
          try {
            console.log(`[SemanticVectorSearch] 对 ${matchedChunks.length} 个结果进行重排...`);

            // 准备文档文本
            const docs = matchedChunks.map(c => c.text || '');

            // 调用重排
            const rerankResults = await window.RerankClient.rerank(query, docs, {
              topN: topK,
              searchType: 'vector'
            });

            // 根据重排结果重新排序
            const rerankedChunks = rerankResults.map(r => ({
              ...matchedChunks[r.index],
              rerankScore: r.relevance_score,
              originalScore: matchedChunks[r.index].score,
              score: r.relevance_score // 使用重排分数作为最终分数
            }));

            console.log(`[SemanticVectorSearch] 重排完成，返回 ${rerankedChunks.length} 个结果`);
            return rerankedChunks;
          } catch (error) {
            console.warn('[SemanticVectorSearch] 重排失败，使用原始结果:', error);
            // 失败时返回原始结果
            return matchedChunks;
          }
        }

        return matchedChunks;

      } catch (error) {
        console.error('[SemanticVectorSearch] 检索失败:', error);
        return [];
      }
    }

    /**
     * 获取当前文档ID
     */
    getCurrentDocId() {
      if (window.ChatbotCore?.getCurrentDocId) {
        return window.ChatbotCore.getCurrentDocId();
      }
      if (window.data?.id) {
        return window.data.id;
      }
      return 'default';
    }

    /**
     * 删除文档索引
     */
    async deleteIndex(docId) {
      if (!this.vectorStore) {
        this.vectorStore = new window.VectorStore(docId);
        await this.vectorStore.init();
      }

      await this.vectorStore.deleteByDocId(docId);
      this.indexedDocs.delete(docId);

      console.log(`[SemanticVectorSearch] 已删除文档 ${docId} 的向量索引`);
    }

    /**
     * 检查索引状态
     */
    async getIndexStatus(docId) {
      if (!this.vectorStore || this.vectorStore.namespace !== docId) {
        this.vectorStore = new window.VectorStore(docId);
        await this.vectorStore.init();
      }

      const stats = await this.vectorStore.stats();
      return {
        indexed: stats.count > 0,
        count: stats.count,
        dimensions: stats.dimensions,
        size: (stats.size / 1024).toFixed(2) + ' KB'
      };
    }
  }

  // 导出全局实例
  window.SemanticVectorSearch = new SemanticVectorSearch();

  console.log('[SemanticVectorSearch] 意群向量搜索已加载');

})(window);
