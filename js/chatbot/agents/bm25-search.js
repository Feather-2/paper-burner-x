// js/chatbot/agents/bm25-search.js
// BM25 检索算法实现（向量搜索的降级方案）
(function(window) {
  'use strict';

  /**
   * BM25 (Best Matching 25) 检索算法
   * 基于概率信息检索模型，考虑词频(TF)和逆文档频率(IDF)
   * 适合作为向量搜索失败时的降级方案
   */
  class BM25Search {
    constructor() {
      this.index = null;
      this.documents = [];
      this.avgDocLength = 0;

      // BM25参数（经验最优值）
      this.k1 = 1.5;  // 词频饱和参数（1.2-2.0）
      this.b = 0.75;  // 文档长度归一化参数（0.5-0.8）
    }

    /**
     * 中文分词（n-gram + 完整词保留）
     * @param {string} text - 待分词文本
     * @returns {Array<string>} 词语数组
     */
    tokenize(text) {
      if (!text) return [];

      // 移除标点符号
      const cleaned = text.replace(/[，。！？；：、""''（）《》【】\s]+/g, ' ');

      const tokens = [];

      // 处理中文：生成2-gram, 3-gram, 和单字
      const chineseChars = cleaned.match(/[\u4e00-\u9fa5]/g) || [];

      // 2-gram（如"雷曼"）
      for (let i = 0; i < chineseChars.length - 1; i++) {
        tokens.push(chineseChars[i] + chineseChars[i + 1]);
      }

      // 3-gram（如"雷曼公"、"曼公司"）
      for (let i = 0; i < chineseChars.length - 2; i++) {
        tokens.push(chineseChars[i] + chineseChars[i + 1] + chineseChars[i + 2]);
      }

      // 单字（兜底）
      tokens.push(...chineseChars);

      // 提取英文单词（转小写）
      const englishWords = cleaned.match(/[a-zA-Z]+/g) || [];
      tokens.push(...englishWords.map(w => w.toLowerCase()));

      // 提取数字
      const numbers = cleaned.match(/\d+/g) || [];
      tokens.push(...numbers);

      // 不去重：保留重复以反映真实词频（TF）
      // 若需限制内存，可在此处做频次上限截断（例如每词最多计数 N 次）
      return tokens;
    }

    /**
     * 构建BM25索引
     * @param {Array<Object>} groups - 意群数组
     */
    buildIndex(groups) {
      if (!groups || groups.length === 0) {
        console.warn('[BM25Search] 输入意群为空');
        return;
      }

      this.documents = groups.map(g => ({
        id: g.groupId,
        text: this.prepareDocumentText(g),
        tokens: [],
        length: 0,
        metadata: {
          summary: g.summary,
          keywords: g.keywords,
          charCount: g.charCount
        }
      }));

      // 分词
      this.documents.forEach(doc => {
        doc.tokens = this.tokenize(doc.text);
        doc.length = doc.tokens.length;
      });

      // 计算平均文档长度
      this.avgDocLength = this.documents.reduce((sum, doc) => sum + doc.length, 0) / this.documents.length;

      // 构建倒排索引
      this.index = this.buildInvertedIndex();

      console.log(`[BM25Search] 索引构建完成，文档数: ${this.documents.length}，平均长度: ${this.avgDocLength.toFixed(1)}`);
    }

    /**
     * 准备文档文本（用于索引）
     */
    prepareDocumentText(group) {
      const parts = [];

      // 关键词（权重最高，重复3次）
      if (group.keywords && group.keywords.length > 0) {
        const keywordText = group.keywords.join(' ');
        parts.push(keywordText, keywordText, keywordText);
      }

      // 摘要（权重次之，重复2次）
      if (group.summary) {
        parts.push(group.summary, group.summary);
      }

      // digest（权重正常）
      if (group.digest) {
        parts.push(group.digest.slice(0, 1000)); // 取前1000字
      }

      // 正文兜底：优先使用 text，其次 fullText（较低权重，单次加入）
      // 在 chunks 索引中，text 即为 chunk 正文；在意群中 fullText 为整段内容
      if (group.text && typeof group.text === 'string' && group.text.length > 0) {
        parts.push(group.text.slice(0, 1200));
      } else if (group.fullText && typeof group.fullText === 'string' && group.fullText.length > 0) {
        parts.push(group.fullText.slice(0, 1200));
      }

      return parts.join(' ');
    }

    /**
     * 构建倒排索引
     * @returns {Map} 倒排索引 { term: [{ docIndex, freq }, ...] }
     */
    buildInvertedIndex() {
      const index = new Map();

      this.documents.forEach((doc, docIndex) => {
        // 计算词频
        const termFreq = new Map();
        doc.tokens.forEach(token => {
          termFreq.set(token, (termFreq.get(token) || 0) + 1);
        });

        // 更新倒排索引
        termFreq.forEach((freq, term) => {
          if (!index.has(term)) {
            index.set(term, []);
          }
          index.get(term).push({ docIndex, freq });
        });
      });

      return index;
    }

    /**
     * 计算IDF (Inverse Document Frequency)
     * IDF(q) = log((N - df(q) + 0.5) / (df(q) + 0.5) + 1)
     */
    calculateIDF(term) {
      const N = this.documents.length;
      const df = this.index.has(term) ? this.index.get(term).length : 0;
      return Math.log((N - df + 0.5) / (df + 0.5) + 1);
    }

    /**
     * 计算BM25分数
     * BM25(D,Q) = Σ IDF(q) * (f(q,D) * (k1 + 1)) / (f(q,D) + k1 * (1 - b + b * |D| / avgdl))
     */
    calculateBM25Score(docIndex, queryTerms) {
      const doc = this.documents[docIndex];
      let score = 0;

      queryTerms.forEach(term => {
        if (!this.index.has(term)) return;

        const idf = this.calculateIDF(term);

        // 查找该词在文档中的频率
        const postings = this.index.get(term);
        const posting = postings.find(p => p.docIndex === docIndex);

        if (!posting) return;

        const freq = posting.freq;
        const docLength = doc.length;

        // BM25公式
        const numerator = freq * (this.k1 + 1);
        const denominator = freq + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));

        score += idf * (numerator / denominator);
      });

      return score;
    }

    /**
     * 搜索
     * @param {string} query - 查询文本
     * @param {number} topK - 返回top K结果
     * @param {number} threshold - 最低分数阈值（可选）
     * @returns {Array<{id: string, score: number, metadata: Object}>}
     */
    search(query, topK = 5, threshold = 0) {
      if (!this.index || this.documents.length === 0) {
        console.warn('[BM25Search] 索引未构建');
        return [];
      }

      // 分词
      const queryTerms = this.tokenize(query);
      if (queryTerms.length === 0) {
        console.warn('[BM25Search] 查询为空');
        return [];
      }

      console.log(`[BM25Search] 查询词: ${queryTerms.slice(0, 10).join(', ')}${queryTerms.length > 10 ? '...' : ''}`);

      // 计算所有文档的BM25分数
      const scores = this.documents.map((doc, docIndex) => ({
        id: doc.id,
        score: this.calculateBM25Score(docIndex, queryTerms),
        metadata: doc.metadata
      }));

      // 过滤低分结果
      const filtered = scores.filter(s => s.score > threshold);

      // 排序并返回topK
      filtered.sort((a, b) => b.score - a.score);

      const results = filtered.slice(0, topK);

      console.log(`[BM25Search] 返回 ${results.length} 个结果，分数范围: ${results[0]?.score.toFixed(3)} - ${results[results.length - 1]?.score.toFixed(3)}`);

      return results;
    }

    /**
     * 关键词精确搜索（使用n-gram分词+短语匹配加权）
     * @param {Array<string>} keywords - 关键词数组
     * @param {number} topK - 返回结果数
     * @param {number} threshold - 最低分数阈值
     * @returns {Array<{id: string, score: number, metadata: Object}>}
     */
    searchKeywords(keywords, topK = 5, threshold = 0) {
      if (!this.index || this.documents.length === 0) {
        console.warn('[BM25Search] 索引未构建');
        return [];
      }

      if (!Array.isArray(keywords) || keywords.length === 0) {
        console.warn('[BM25Search] 关键词为空');
        return [];
      }

      const originalKeywords = keywords.filter(kw => kw && typeof kw === 'string' && kw.trim());

      // 对每个关键词生成n-gram查询词
      const queryTerms = keywords.flatMap(kw => {
        if (!kw || typeof kw !== 'string') return [];
        const cleaned = kw.trim();
        if (!cleaned) return [];

        const terms = [];

        // 提取中文部分，生成2-gram和3-gram
        const chineseChars = cleaned.match(/[\u4e00-\u9fa5]/g) || [];

        if (chineseChars.length > 0) {
          // 2-gram
          for (let i = 0; i < chineseChars.length - 1; i++) {
            terms.push(chineseChars[i] + chineseChars[i + 1]);
          }

          // 3-gram
          for (let i = 0; i < chineseChars.length - 2; i++) {
            terms.push(chineseChars[i] + chineseChars[i + 1] + chineseChars[i + 2]);
          }

          // 单字
          terms.push(...chineseChars);
        }

        // 提取英文部分（转小写）
        const englishMatches = cleaned.match(/[a-zA-Z]+/g) || [];
        terms.push(...englishMatches.map(w => w.toLowerCase()));

        // 提取数字部分
        const numberMatches = cleaned.match(/\d+/g) || [];
        terms.push(...numberMatches);

        return terms;
      });

      if (queryTerms.length === 0) {
        console.warn('[BM25Search] 关键词处理后为空');
        return [];
      }

      console.log(`[BM25Search-Keywords] 原始关键词: ${originalKeywords.join(', ')}`);
      console.log(`[BM25Search-Keywords] 分词后查询词(前10个): ${[...new Set(queryTerms)].slice(0, 10).join(', ')}${queryTerms.length > 10 ? '...' : ''}`);

      // 计算所有文档的BM25分数
      const scores = this.documents.map((doc, docIndex) => {
        const bm25Score = this.calculateBM25Score(docIndex, queryTerms);

        // 短语匹配加权：检查原文是否包含完整关键词
        let phraseBoost = 1.0;
        for (const keyword of originalKeywords) {
          if (doc.text.includes(keyword)) {
            phraseBoost *= 3.0; // 包含完整短语，分数×3.0
          }
        }

        return {
          id: doc.id,
          score: bm25Score * phraseBoost,
          metadata: doc.metadata,
          _phraseBoost: phraseBoost // 用于debug
        };
      });

      // 过滤低分结果
      const filtered = scores.filter(s => s.score > threshold);

      // 排序并返回topK
      filtered.sort((a, b) => b.score - a.score);

      const results = filtered.slice(0, topK);

      if (results.length > 0) {
        const boostedCount = results.filter(r => r._phraseBoost > 1).length;
        console.log(`[BM25Search-Keywords] 返回 ${results.length} 个结果，分数范围: ${results[0]?.score.toFixed(3)} - ${results[results.length - 1]?.score.toFixed(3)}${boostedCount > 0 ? ` (${boostedCount}个短语加权)` : ''}`);
      } else {
        console.log(`[BM25Search-Keywords] 未找到匹配结果`);
      }

      // 移除debug字段
      results.forEach(r => delete r._phraseBoost);

      return results;
    }

    /**
     * 获取索引统计信息
     */
    getStats() {
      if (!this.index) return null;

      return {
        documentCount: this.documents.length,
        termCount: this.index.size,
        avgDocLength: this.avgDocLength.toFixed(1),
        totalTokens: this.documents.reduce((sum, doc) => sum + doc.length, 0)
      };
    }

    /**
     * 清空索引
     */
    clear() {
      this.index = null;
      this.documents = [];
      this.avgDocLength = 0;
      console.log('[BM25Search] 索引已清空');
    }
  }

  /**
   * 意群BM25搜索引擎（集成到现有系统）
   */
  class SemanticBM25Search {
    constructor() {
      this.bm25 = new BM25Search();
      this.indexedDocId = null;
    }

    /**
     * 为意群建立BM25索引
     */
    indexGroups(groups, docId) {
      if (!groups || groups.length === 0) {
        console.warn('[SemanticBM25Search] 意群为空');
        return;
      }

      this.bm25.buildIndex(groups);
      this.indexedDocId = docId;

      console.log('[SemanticBM25Search] BM25索引建立完成');
    }

    /**
     * 为chunks建立BM25索引
     */
    indexChunks(chunks, docId) {
      if (!chunks || chunks.length === 0) {
        console.warn('[SemanticBM25Search] chunks为空');
        return;
      }

      // 将chunks转换为类似意群的结构
      const chunkDocs = chunks.map(c => ({
        groupId: c.chunkId, // 使用chunkId作为id
        text: c.text,
        summary: c.text.substring(0, 150), // 前150字作为摘要
        keywords: [], // chunks没有keywords
        charCount: c.charCount
      }));

      this.bm25.buildIndex(chunkDocs);
      this.indexedDocId = docId;

      console.log(`[SemanticBM25Search] BM25索引建立完成，共 ${chunks.length} 个chunks`);
    }

    /**
     * 搜索chunks（返回完整chunk对象）
     */
    searchChunks(query, chunks, options = {}) {
      const { topK = 10, threshold = 0.1 } = options;

      // 检查索引是否存在
      if (!this.bm25.index || this.bm25.documents.length === 0) {
        console.warn('[SemanticBM25Search] 索引未建立，现在建立...');
        const docId = this.getCurrentDocId();
        this.indexChunks(chunks, docId);
      }

      // BM25搜索
      const results = this.bm25.search(query, topK, threshold);

      // 从chunks中找出对应的完整对象
      const chunkMap = new Map(chunks.map(c => [c.chunkId, c]));
      const matchedChunks = results
        .map(r => {
          const chunk = chunkMap.get(r.id);
          if (chunk) {
            return {
              ...chunk,
              score: r.score
            };
          }
          return null;
        })
        .filter(Boolean);

      return matchedChunks;
    }

    /**
     * 关键词精确搜索chunks（返回完整chunk对象，不做n-gram拆分）
     */
    searchChunksKeywords(keywords, chunks, options = {}) {
      const { topK = 10, threshold = 0.0 } = options; // 放宽阈值，尽量召回

      // 即时短语优先匹配（无需索引）：直接在 chunk 文本里找完整关键词
      const normalizedKeywords = (Array.isArray(keywords) ? keywords : [String(keywords || '')])
        .map(k => (k || '').trim())
        .filter(Boolean);

      const phraseHits = [];
      if (normalizedKeywords.length > 0 && Array.isArray(chunks)) {
        for (const chunk of chunks) {
          const text = String(chunk.text || '');
          if (!text) continue;
          const matched = normalizedKeywords.filter(kw => kw && text.includes(kw));
          if (matched.length > 0) {
            // 简单打分：完整短语优先，按匹配个数和最早出现位置加权
            const firstPos = Math.min(...matched.map(kw => Math.max(0, text.indexOf(kw))));
            const score = 1000 + matched.length * 10 - Math.floor(firstPos / 50);
            phraseHits.push({
              ...chunk,
              score,
              _matchedKeywords: matched
            });
          }
        }

        phraseHits.sort((a, b) => b.score - a.score);
      }

      // 若短语命中已有足量结果，优先返回
      if (phraseHits.length > 0) {
        return phraseHits.slice(0, topK).map(hit => ({
          ...hit,
          matchedKeywords: hit._matchedKeywords
        }));
      }

      // 短语无命中则走 BM25（需要索引）
      if (!this.bm25.index || this.bm25.documents.length === 0) {
        console.warn('[SemanticBM25Search] 索引未建立，现在建立...');
        const docId = this.getCurrentDocId();
        this.indexChunks(chunks, docId);
      }

      const results = this.bm25.searchKeywords(normalizedKeywords, topK, threshold);

      const chunkMap = new Map(chunks.map(c => [c.chunkId, c]));
      const matchedChunks = results
        .map(r => {
          const chunk = chunkMap.get(r.id);
          if (chunk) {
            // 标注匹配关键词（便于UI展示）
            const text = String(chunk.text || '');
            const matched = normalizedKeywords.filter(kw => kw && text.includes(kw));
            return {
              ...chunk,
              score: r.score,
              matchedKeywords: matched
            };
          }
          return null;
        })
        .filter(Boolean);

      return matchedChunks;
    }

    /**
     * 搜索意群（返回完整意群对象）
     */
    search(query, groups, options = {}) {
      const { topK = 8, threshold = 0.1 } = options;

      // 检查索引是否存在
      if (!this.bm25.index || this.bm25.documents.length === 0) {
        console.warn('[SemanticBM25Search] 索引未建立，现在建立...');
        const docId = this.getCurrentDocId();
        this.indexGroups(groups, docId);
      }

      // BM25搜索
      const results = this.bm25.search(query, topK, threshold);

      // 从groups中找出对应的完整对象
      const groupMap = new Map(groups.map(g => [g.groupId, g]));
      const matchedGroups = results
        .map(r => groupMap.get(r.id))
        .filter(Boolean);

      return matchedGroups;
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
     * 清空索引
     */
    clear() {
      this.bm25.clear();
      this.indexedDocId = null;
    }

    /**
     * 获取统计信息
     */
    getStats() {
      return this.bm25.getStats();
    }
  }

  // 导出
  window.BM25Search = BM25Search;
  window.SemanticBM25Search = new SemanticBM25Search();

  console.log('[BM25Search] BM25检索引擎已加载');

})(window);
