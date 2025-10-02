// js/chatbot/agents/semantic-grouper.js
// -----------------------------------------
// 意群聚合模块：将现有翻译分段聚合成更大的语义意群
// 用于长文档（>5万字）的智能分段处理

(function(window) {
  'use strict';

  /**
   * 将分段数组聚合成意群
   * @param {Array<string>} chunks - 原始分段数组（ocrChunks 或 translatedChunks）
   * @param {Object} options - 配置选项
   * @param {number} options.targetChars - 目标字数（默认 5000）
   * @param {number} options.minChars - 最小字数（默认 2500）
   * @param {number} options.maxChars - 最大字数（默认 6000）
   * @returns {Promise<Object>} 返回 {groups: 意群数组, enrichedChunks: 带元数据的chunks}
   */
  async function aggregateIntoSemanticGroups(chunks, options = {}) {
    const {
      targetChars = 5000,
      minChars = 2500,
      maxChars = 6000,
      concurrency = 20,
      docContext = (window.data && window.data.semanticDocGist) ? window.data.semanticDocGist : ''
    } = options;

    if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
      console.warn('[SemanticGrouper] 无效的输入分段');
      return { groups: [], enrichedChunks: [] };
    }

    console.log(`[SemanticGrouper] 开始聚合 ${chunks.length} 个分段，目标字数: ${targetChars}`);

    // 创建带元数据的chunks
    const enrichedChunks = chunks.map((text, index) => ({
      chunkId: `chunk-${index}`,
      text: text,
      belongsToGroup: null, // 稍后填充
      position: index,
      charCount: text.length
    }));

    const candidates = [];
    let currentGroup = {
      segments: [],
      texts: [],
      charCount: 0
    };

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i] || '';
      const chunkLength = chunk.length;

      // 决策逻辑：是否将当前块加入当前组
      if (currentGroup.charCount > 0) {
        const potentialTotal = currentGroup.charCount + chunkLength;
        // 情况1：加入后仍在合理范围内（不超过最大）
        if (potentialTotal <= maxChars) {
          currentGroup.segments.push(i);
          currentGroup.texts.push(chunk);
          currentGroup.charCount = potentialTotal;
          continue;
        }
        // 情况2：加入后超过最大限制 -> 完成当前组（最小要求为软约束，允许 < min）
        candidates.push(currentGroup);
        currentGroup = {
          segments: [i],
          texts: [chunk],
          charCount: chunkLength
        };
        continue;
      } else {
        // 空组，直接加入
        currentGroup.segments.push(i);
        currentGroup.texts.push(chunk);
        currentGroup.charCount = chunkLength;
      }
    }

    // 处理最后一组
    if (currentGroup.segments.length > 0) {
      candidates.push(currentGroup);
    }

    console.log(`[SemanticGrouper] 初步分组完成，共 ${candidates.length} 个候选意群。开始并发处理，最大并发: ${concurrency}`);

    const groups = await finalizeGroupsInParallel(candidates, concurrency, docContext);

    // 更新enrichedChunks的belongsToGroup字段
    groups.forEach(group => {
      group.segments.forEach(segmentIndex => {
        enrichedChunks[segmentIndex].belongsToGroup = group.groupId;
      });
    });

    console.log(`[SemanticGrouper] 聚合完成，生成 ${groups.length} 个意群`);

    return {
      groups: groups,
      enrichedChunks: enrichedChunks
    };
  }

  /**
   * 完成意群的处理（生成摘要和关键词）
   * @param {Object} currentGroup - 当前意群
   * @param {Array} groups - 意群数组
   */
  async function finalizeGroup(currentGroup, groupIndex, docContext) {
    const fullText = currentGroup.texts.join('\n\n');
    const groupId = `group-${groupIndex}`;

    console.log(`[SemanticGrouper] 处理意群 ${groupId}，包含 ${currentGroup.segments.length} 个分段，共 ${currentGroup.charCount} 字`);

    try {
      // 并发生成摘要、关键词和结构化信息
      const [summary, keywords, structure] = await Promise.all([
        generateSummary(fullText, 400, docContext), // 400字详细摘要
        extractKeywords(fullText, docContext),
        extractStructure(fullText, docContext)      // 提取图表、章节、要点
      ]);

      const result = {
        groupId,
        segments: currentGroup.segments,  // 保留原始分段索引
        charCount: currentGroup.charCount,
        summary,      // 400字详细摘要
        keywords,     // 关键词数组
        structure,    // 结构化信息（图表、章节、要点）
        fullText      // 完整文本
      };

      console.log(`[SemanticGrouper] 意群 ${groupId} 处理完成:`, {
        segments: currentGroup.segments,
        charCount: currentGroup.charCount,
        keywords: (keywords || []).join(', '),
        figures: structure.figures?.length || 0,
        tables: structure.tables?.length || 0,
        sections: structure.sections?.length || 0
      });

      return result;
    } catch (error) {
      console.error(`[SemanticGrouper] 处理意群 ${groupId} 失败:`, error);

      // 降级：不生成摘要，仅保存基本信息
      return {
        groupId,
        segments: currentGroup.segments,
        charCount: currentGroup.charCount,
        summary: `该意群包含 ${currentGroup.segments.length} 个分段，共 ${currentGroup.charCount} 字`,
        keywords: [],
        structure: { figures: [], tables: [], sections: [], keyPoints: [] },
        fullText,
        error: error.message
      };
    }
  }

  async function finalizeGroupsInParallel(candidates, concurrency, docContext) {
    const results = new Array(candidates.length);
    let nextIndex = 0;

    async function runNext() {
      const i = nextIndex++;
      if (i >= candidates.length) return;
      results[i] = await finalizeGroup(candidates[i], i, docContext);
      return runNext();
    }

    const poolSize = Math.max(1, Math.min(concurrency || 1, candidates.length));
    const runners = [];
    for (let i = 0; i < poolSize; i++) {
      runners.push(runNext());
    }
    await Promise.all(runners);
    return results;
  }

  /**
   * 生成意群摘要
   * @param {string} text - 完整文本
   * @param {number} maxLength - 最大长度
   * @returns {Promise<string>} 摘要文本
   */
  async function generateSummary(text, maxLength, docContext = '') {
    // 检查依赖
    if (!window.ChatbotCore || typeof window.ChatbotCore.singleChunkSummary !== 'function') {
      console.warn('[SemanticGrouper] ChatbotCore 未加载，使用截断作为摘要');
      return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
    }

    try {
      const config = window.ChatbotCore.getChatbotConfig();
      const apiKey = config.apiKey;

      if (!apiKey) {
        throw new Error('未配置 API Key');
      }

      // 限制输入文本长度（避免 token 过多）
      const inputText = text.length > 5000 ? text.substring(0, 5000) + '...' : text;

      const ctx = (docContext || '').slice(0, 1000);
      const prompt = `${ctx ? `背景（整篇文档总览）：\n${ctx}\n\n` : ''}请用不超过${maxLength}字概括以下内容的核心要点，保持专业性和准确性：

${inputText}

要求：
1. 概括核心内容和主要观点，并保持与背景一致性
2. ${maxLength <= 100 ? '极度精简' : '突出重点'}
3. 不要添加"本段讲述"等描述性前缀`;

      const summary = await window.ChatbotCore.singleChunkSummary(
        prompt,
        inputText,
        config,
        apiKey
      );

      return summary.trim();
    } catch (error) {
      console.error('[SemanticGrouper] 生成摘要失败:', error);
      // 降级：使用截断
      return text.substring(0, maxLength) + (text.length > maxLength ? '...' : '');
    }
  }

  /**
   * 提取关键词
   * @param {string} text - 完整文本
   * @returns {Promise<Array<string>>} 关键词数组
   */
  async function extractKeywords(text, docContext = '') {
    if (!window.ChatbotCore || typeof window.ChatbotCore.singleChunkSummary !== 'function') {
      console.warn('[SemanticGrouper] ChatbotCore 未加载，无法提取关键词');
      return [];
    }

    try {
      const config = window.ChatbotCore.getChatbotConfig();
      const apiKey = config.apiKey;

      if (!apiKey) {
        throw new Error('未配置 API Key');
      }

      const inputText = text.length > 3000 ? text.substring(0, 3000) + '...' : text;

      const ctx = (docContext || '').slice(0, 500);
      const prompt = `${ctx ? `背景（整篇文档总览）：\n${ctx}\n\n` : ''}请从以下内容中提取3-5个最重要的关键词或关键短语，用逗号分隔。
只返回关键词，不要解释：

${inputText}`;

      const result = await window.ChatbotCore.singleChunkSummary(
        prompt,
        inputText,
        config,
        apiKey
      );

      // 解析关键词
      const keywords = result
        .split(/[,，、]/)
        .map(k => k.trim())
        .filter(k => k.length > 0 && k.length < 20)
        .slice(0, 5);

      return keywords;
    } catch (error) {
      console.error('[SemanticGrouper] 提取关键词失败:', error);
      return [];
    }
  }

  /**
   * 提取结构化信息（图表、章节、要点）
   * @param {string} text - 完整文本
   * @param {string} docContext - 文档上下文
   * @returns {Promise<Object>} 结构化信息对象
   */
  async function extractStructure(text, docContext = '') {
    const structure = {
      figures: [],
      tables: [],
      sections: [],
      keyPoints: []
    };

    try {
      // 1. 提取图表引用（使用正则）
      const figureRegex = /(?:图|Figure|Fig\.?)\s*(\d+)[：:：]?\s*([^\n]{0,50})/gi;
      const tableRegex = /(?:表|Table)\s*(\d+)[：:：]?\s*([^\n]{0,50})/gi;

      let match;
      while ((match = figureRegex.exec(text)) !== null) {
        structure.figures.push(`Figure ${match[1]}: ${match[2].trim()}`);
      }
      while ((match = tableRegex.exec(text)) !== null) {
        structure.tables.push(`Table ${match[1]}: ${match[2].trim()}`);
      }

      // 去重
      structure.figures = [...new Set(structure.figures)].slice(0, 5);
      structure.tables = [...new Set(structure.tables)].slice(0, 5);

      // 2. 提取章节标题（使用正则匹配常见模式）
      const sectionRegex = /^(?:#+\s*)?(\d+(?:\.\d+)*)\s+([^\n]{3,60})$/gm;
      while ((match = sectionRegex.exec(text)) !== null) {
        structure.sections.push(`${match[1]} ${match[2].trim()}`);
      }
      structure.sections = structure.sections.slice(0, 5);

      // 3. 使用LLM提取核心要点
      if (window.ChatbotCore && typeof window.ChatbotCore.singleChunkSummary === 'function') {
        const config = window.ChatbotCore.getChatbotConfig();
        const apiKey = config.apiKey;

        if (apiKey) {
          const inputText = text.length > 3000 ? text.substring(0, 3000) + '...' : text;
          const ctx = (docContext || '').slice(0, 500);
          const prompt = `${ctx ? `背景：\n${ctx}\n\n` : ''}请从以下内容中提取3-5个核心要点或主要论点，每个要点用一句话概括（不超过30字）。
只返回要点列表，每行一个，不要编号：

${inputText}`;

          try {
            const result = await window.ChatbotCore.singleChunkSummary(
              prompt,
              inputText,
              config,
              apiKey
            );

            structure.keyPoints = result
              .split('\n')
              .map(p => p.replace(/^[-*\d\.]+\s*/, '').trim())
              .filter(p => p.length > 5 && p.length < 100)
              .slice(0, 5);
          } catch (e) {
            console.warn('[SemanticGrouper] LLM提取要点失败:', e.message);
          }
        }
      }

      return structure;
    } catch (error) {
      console.error('[SemanticGrouper] 提取结构化信息失败:', error);
      return structure;
    }
  }

  /**
   * 快速匹配：根据关键词查找相关意群
   * @param {string} query - 用户查询
   * @param {Array<Object>} groups - 意群数组
   * @returns {Array<Object>} 匹配的意群（按相关度排序）
   */
  function quickMatch(query, groups) {
    if (!query || !groups || groups.length === 0) {
      return [];
    }

    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/[\s，,、。.]+/).filter(w => w.length > 1);

    // 为每个意群计算相关度分数
    const scored = groups.map(group => {
      let score = 0;

      // 关键词匹配（权重 3）
      if (group.keywords && group.keywords.length > 0) {
        group.keywords.forEach(kw => {
          if (queryLower.includes(kw.toLowerCase())) {
            score += 3;
          }
        });
      }

      // 摘要匹配（权重 2）
      if (group.summary) {
        const summaryLower = group.summary.toLowerCase();
        queryWords.forEach(word => {
          if (summaryLower.includes(word)) {
            score += 2;
          }
        });
      }

      // digest 匹配（权重 1）
      if (group.digest) {
        const digestLower = group.digest.toLowerCase();
        queryWords.forEach(word => {
          if (digestLower.includes(word)) {
            score += 1;
          }
        });
      }

      return { group, score };
    });

    // 按分数降序排序
    scored.sort((a, b) => b.score - a.score);

    // 返回有分数的意群
    return scored.filter(item => item.score > 0).map(item => item.group);
  }

  // 导出公共接口
  window.SemanticGrouper = {
    aggregate: aggregateIntoSemanticGroups,
    quickMatch: quickMatch,
    // 辅助方法（供测试使用）
    generateSummary: generateSummary,
    extractKeywords: extractKeywords
  };

  console.log('[SemanticGrouper] 意群聚合模块已加载');

})(window);
