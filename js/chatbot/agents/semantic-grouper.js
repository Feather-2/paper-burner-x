// js/chatbot/agents/semantic-grouper.js
// -----------------------------------------
// 意群聚合模块：将现有翻译分段聚合成更大的语义意群
// 用于长文档（>5万字）的智能分段处理

(function(window) {
  'use strict';

  /**
   * 带重试的LLM调用包装器
   * @param {Function} fn - 要执行的异步函数
   * @param {number} maxRetries - 最大重试次数
   * @param {number} delayMs - 重试延迟（毫秒）
   * @returns {Promise} 函数执行结果
   */
  async function retryWithBackoff(fn, maxRetries = 2, delayMs = 1000) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        // 如果是最后一次尝试，或者不是5xx错误，直接抛出
        const is5xxError = error.message && /50\d/.test(error.message);
        if (attempt === maxRetries || !is5xxError) {
          throw error;
        }

        // 等待后重试，使用指数退避
        const delay = delayMs * Math.pow(2, attempt);
        console.warn(`[SemanticGrouper] API调用失败，${delay}ms后重试 (${attempt + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * 将分段数组聚合成意群
   * @param {Array<string>} chunks - 原始分段数组（ocrChunks 或 translatedChunks）
   * @param {Object} options - 配置选项
   * @param {number} options.targetChars - 目标字数（默认 5000）
   * @param {number} options.minChars - 最小字数（默认 2500）
   * @param {number} options.maxChars - 最大字数（默认 6000）
   * @param {Function} options.onProgress - 进度回调函数 (current, total, message)
   * @returns {Promise<Object>} 返回 {groups: 意群数组, enrichedChunks: 带元数据的chunks}
   */
  async function aggregateIntoSemanticGroups(chunks, options = {}) {
    const {
      targetChars = 5000,
      minChars = 2500,
      maxChars = 6000,
      concurrency = 20,  // 恢复默认并发数
      docContext = (window.data && window.data.semanticDocGist) ? window.data.semanticDocGist : '',
      onProgress = null
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

    // 调用进度回调：开始处理
    if (onProgress && typeof onProgress === 'function') {
      onProgress(0, candidates.length, '开始生成意群摘要和关键词...');
    }

    const groups = await finalizeGroupsInParallel(candidates, concurrency, docContext, onProgress);

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

  async function finalizeGroupsInParallel(candidates, concurrency, docContext, onProgress) {
    const results = new Array(candidates.length);
    let nextIndex = 0;
    let completedCount = 0;
    const total = candidates.length;

    async function runNext() {
      const i = nextIndex++;
      if (i >= candidates.length) return;

      // 添加随机延迟，避免同时发起大量请求
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
      }

      results[i] = await finalizeGroup(candidates[i], i, docContext);

      // 更新进度
      completedCount++;
      if (onProgress && typeof onProgress === 'function') {
        onProgress(completedCount, total, `正在处理意群 ${completedCount}/${total}`);
      }

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

      // 使用重试包装器
      const summary = await retryWithBackoff(async () => {
        return await window.ChatbotCore.singleChunkSummary(
          prompt,
          inputText,
          config,
          apiKey
        );
      });

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
      const prompt = `${ctx ? `背景（整篇文档总览）：\n${ctx}\n\n` : ''}请从以下内容中提取4-6个最重要的关键词，优先提取：
1. 专有名词（公司名、人名、产品名、机构名、地名）
2. 核心概念（重要术语、技术名称）
3. 主题词（核心话题）

要求：
- **优先级**：实体 > 专业术语 > 概念词
- **具体性**：优先提取具体名称（如"雷曼公司"而非"公司"）
- **完整性**：保留实体的完整表达（如"雷曼兄弟公司"而非拆分）
- 用逗号分隔，只返回关键词列表，不要解释

文档内容：
${inputText}`;

      // 使用重试包装器
      const result = await retryWithBackoff(async () => {
        return await window.ChatbotCore.singleChunkSummary(
          prompt,
          inputText,
          config,
          apiKey
        );
      });

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
      orderedElements: [],  // 按文档顺序的结构化元素
      // 保留旧格式用于兼容
      figures: [],
      tables: [],
      sections: [],
      keyPoints: []
    };

    try {
      // 使用LLM提取有序的结构化信息
      if (window.ChatbotCore && typeof window.ChatbotCore.singleChunkSummary === 'function') {
        const config = window.ChatbotCore.getChatbotConfig();
        const apiKey = config.apiKey;

        if (apiKey) {
          const inputText = text.length > 4000 ? text.substring(0, 4000) + '...' : text;
          const ctx = (docContext || '').slice(0, 500);
          const prompt = `${ctx ? `背景（文档总览）：\n${ctx}\n\n` : ''}请按照文档顺序，提取以下结构化信息（每行一个，保持原文档顺序）：

1. 大标题（章节主标题，如"第三章 XXX"）- 标记为 [TITLE]
2. 小节标题（如"3.1 XXX"）- 标记为 [SECTION]
3. 核心要点（重要论点或观点，不超过30字）- 标记为 [POINT]
4. 图片标题（如"图3.1: XXX"）- 标记为 [FIGURE]
5. 表格标题（如"表3.1: XXX"）- 标记为 [TABLE]
6. 公式标题/说明（如"公式3.1: XXX"或"E=mc²"）- 标记为 [FORMULA]

格式示例：
[TITLE] 第三章 理想投资的判断标准
[SECTION] 3.1 风险与收益的平衡
[POINT] 投资需要在风险与收益之间寻找最优平衡点
[FIGURE] 图3.1: 风险收益曲线
[FORMULA] 公式3.1: 夏普比率 = (Rp - Rf) / σp
[TABLE] 表3.1: 不同资产类别的历史表现

要求：
- **严格保持原文表达**：标题、图表名称、公式等必须完全引用原文，不要改写或概括，这对后续关键词搜索至关重要
- 严格按照内容在文档中的出现顺序提取
- 每个元素不超过50字
- 只提取最重要的10-15个元素
- 如果没有某类元素，跳过即可

文档内容：
${inputText}`;

          try {
            // 使用重试包装器
            const result = await retryWithBackoff(async () => {
              return await window.ChatbotCore.singleChunkSummary(
                prompt,
                inputText,
                config,
                apiKey
              );
            });

            // 解析结果
            const lines = result.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            for (const line of lines) {
              if (line.startsWith('[TITLE]')) {
                const content = line.replace('[TITLE]', '').trim();
                structure.orderedElements.push({ type: 'title', content });
                structure.sections.push(content); // 兼容
              } else if (line.startsWith('[SECTION]')) {
                const content = line.replace('[SECTION]', '').trim();
                structure.orderedElements.push({ type: 'section', content });
                structure.sections.push(content); // 兼容
              } else if (line.startsWith('[POINT]')) {
                const content = line.replace('[POINT]', '').trim();
                structure.orderedElements.push({ type: 'keypoint', content });
                structure.keyPoints.push(content); // 兼容
              } else if (line.startsWith('[FIGURE]')) {
                const content = line.replace('[FIGURE]', '').trim();
                structure.orderedElements.push({ type: 'figure', content });
                structure.figures.push(content); // 兼容
              } else if (line.startsWith('[TABLE]')) {
                const content = line.replace('[TABLE]', '').trim();
                structure.orderedElements.push({ type: 'table', content });
                structure.tables.push(content); // 兼容
              } else if (line.startsWith('[FORMULA]')) {
                const content = line.replace('[FORMULA]', '').trim();
                structure.orderedElements.push({ type: 'formula', content });
              }
            }

            console.log(`[SemanticGrouper] 提取了 ${structure.orderedElements.length} 个有序结构元素`);
          } catch (e) {
            console.warn('[SemanticGrouper] LLM提取结构失败，使用正则降级:', e.message);
            // 降级到正则提取（无顺序）
            fallbackRegexExtraction(text, structure);
          }
        } else {
          // 无API Key，使用正则降级
          fallbackRegexExtraction(text, structure);
        }
      } else {
        // 无ChatbotCore，使用正则降级
        fallbackRegexExtraction(text, structure);
      }

      return structure;
    } catch (error) {
      console.error('[SemanticGrouper] 提取结构化信息失败:', error);
      return structure;
    }
  }

  /**
   * 降级方案：使用正则提取（不保证顺序）
   */
  function fallbackRegexExtraction(text, structure) {
    const figureRegex = /(?:图|Figure|Fig\.?)\s*(\d+)[：:：]?\s*([^\n]{0,50})/gi;
    const tableRegex = /(?:表|Table)\s*(\d+)[：:：]?\s*([^\n]{0,50})/gi;
    const formulaRegex = /(?:公式|Formula|Equation)\s*(\d+)[：:：]?\s*([^\n]{0,50})/gi;
    const sectionRegex = /^(?:#+\s*)?(\d+(?:\.\d+)*)\s+([^\n]{3,60})$/gm;

    let match;
    while ((match = figureRegex.exec(text)) !== null) {
      const content = `图${match[1]}: ${match[2].trim()}`;
      structure.figures.push(content);
      structure.orderedElements.push({ type: 'figure', content });
    }
    while ((match = tableRegex.exec(text)) !== null) {
      const content = `表${match[1]}: ${match[2].trim()}`;
      structure.tables.push(content);
      structure.orderedElements.push({ type: 'table', content });
    }
    while ((match = formulaRegex.exec(text)) !== null) {
      const content = `公式${match[1]}: ${match[2].trim()}`;
      structure.orderedElements.push({ type: 'formula', content });
    }
    while ((match = sectionRegex.exec(text)) !== null) {
      const content = `${match[1]} ${match[2].trim()}`;
      structure.sections.push(content);
      structure.orderedElements.push({ type: 'section', content });
    }

    // 去重
    structure.figures = [...new Set(structure.figures)].slice(0, 5);
    structure.tables = [...new Set(structure.tables)].slice(0, 5);
    structure.sections = structure.sections.slice(0, 5);
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
