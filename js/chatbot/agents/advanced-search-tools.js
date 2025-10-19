// js/chatbot/agents/advanced-search-tools.js
// 高级搜索工具：正则表达式搜索、布尔逻辑搜索、模糊搜索
(function(window) {
  'use strict';

  if (window.AdvancedSearchTools) return;

  /**
   * 正则表达式搜索
   * @param {string} pattern - 正则表达式模式
   * @param {string} text - 要搜索的文本
   * @param {Object} options - 选项
   * @returns {Array} 匹配结果
   */
  function regexSearch(pattern, text, options = {}) {
    const {
      limit = 20,
      context = 2000,
      caseInsensitive = true,
      multiline = true
    } = options;

    if (!pattern || !text) return [];

    const results = [];
    let regex;

    try {
      // 构建正则表达式
      let flags = 'g'; // 全局搜索
      if (caseInsensitive) flags += 'i';
      if (multiline) flags += 'm';

      regex = new RegExp(pattern, flags);
    } catch (e) {
      console.error('[AdvancedSearchTools] 正则表达式语法错误:', e.message);
      throw new Error(`正则表达式语法错误: ${e.message}`);
    }

    let match;
    let count = 0;

    // 执行正则匹配
    while ((match = regex.exec(text)) !== null && count < limit) {
      const matchText = match[0];
      const matchStart = match.index;
      const matchEnd = matchStart + matchText.length;

      // 提取上下文
      const contextStart = Math.max(0, matchStart - context);
      const contextEnd = Math.min(text.length, matchEnd + context);
      const snippet = text.slice(contextStart, contextEnd);

      results.push({
        match: matchText,
        matchOffset: matchStart,
        matchLength: matchText.length,
        preview: snippet,
        groups: match.slice(1) // 捕获组
      });

      count++;

      // 防止无限循环（零宽度匹配）
      if (match.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }

    return results;
  }

  /**
   * 布尔逻辑搜索
   * 支持 AND, OR, NOT, 括号
   * 示例: "(CNN OR RNN) AND 对比 NOT 图像"
   */
  function booleanSearch(query, text, options = {}) {
    const {
      limit = 20,
      context = 2000,
      caseInsensitive = true
    } = options;

    if (!query || !text) return [];

    try {
      // 解析布尔查询表达式
      const parsedQuery = parseBooleanQuery(query, caseInsensitive);

      // 查找所有可能的匹配位置
      const matches = findBooleanMatches(parsedQuery, text, caseInsensitive);

      // 限制结果数量
      const limitedMatches = matches.slice(0, limit);

      // 为每个匹配提取上下文
      return limitedMatches.map(match => {
        const contextStart = Math.max(0, match.position - context);
        const contextEnd = Math.min(text.length, match.position + match.length + context);
        const snippet = text.slice(contextStart, contextEnd);

        return {
          matchOffset: match.position,
          matchLength: match.length,
          preview: snippet,
          matchedTerms: match.matchedTerms,
          relevanceScore: match.score
        };
      });
    } catch (e) {
      console.error('[AdvancedSearchTools] 布尔查询解析错误:', e.message);
      throw new Error(`布尔查询语法错误: ${e.message}`);
    }
  }

  /**
   * 解析布尔查询表达式
   * 简化版：支持 AND, OR, NOT 和括号
   */
  function parseBooleanQuery(query, caseInsensitive = true) {
    // 标准化查询字符串
    let normalized = query
      .replace(/\s+AND\s+/gi, ' AND ')
      .replace(/\s+OR\s+/gi, ' OR ')
      .replace(/\s+NOT\s+/gi, ' NOT ')
      .trim();

    // 将查询解析为词项和操作符
    const tokens = tokenizeBooleanQuery(normalized);

    return {
      tokens,
      caseInsensitive
    };
  }

  /**
   * 将布尔查询分词
   */
  function tokenizeBooleanQuery(query) {
    const tokens = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < query.length) {
      const char = query[i];

      if (char === '"') {
        inQuotes = !inQuotes;
        i++;
        continue;
      }

      if (!inQuotes && (char === '(' || char === ')')) {
        if (current.trim()) {
          tokens.push({ type: 'term', value: current.trim() });
          current = '';
        }
        tokens.push({ type: char === '(' ? 'lparen' : 'rparen', value: char });
        i++;
        continue;
      }

      if (!inQuotes && char === ' ') {
        const word = current.trim();
        if (word) {
          if (word === 'AND' || word === 'OR' || word === 'NOT') {
            tokens.push({ type: 'operator', value: word });
          } else {
            tokens.push({ type: 'term', value: word });
          }
          current = '';
        }
        i++;
        continue;
      }

      current += char;
      i++;
    }

    if (current.trim()) {
      const word = current.trim();
      if (word === 'AND' || word === 'OR' || word === 'NOT') {
        tokens.push({ type: 'operator', value: word });
      } else {
        tokens.push({ type: 'term', value: word });
      }
    }

    return tokens;
  }

  /**
   * 查找满足布尔条件的匹配
   */
  function findBooleanMatches(parsedQuery, text, caseInsensitive) {
    const { tokens } = parsedQuery;

    // 简化实现：先找出所有词项的位置
    const termPositions = new Map();

    tokens.forEach(token => {
      if (token.type === 'term') {
        const positions = findTermPositions(token.value, text, caseInsensitive);
        termPositions.set(token.value, positions);
      }
    });

    // 评估布尔表达式
    const matches = evaluateBooleanExpression(tokens, termPositions, text, caseInsensitive);

    // 按位置排序并去重
    const uniqueMatches = deduplicateMatches(matches);
    uniqueMatches.sort((a, b) => a.position - b.position);

    return uniqueMatches;
  }

  /**
   * 查找单个词项在文本中的所有位置
   */
  function findTermPositions(term, text, caseInsensitive) {
    const positions = [];
    const searchText = caseInsensitive ? text.toLowerCase() : text;
    const searchTerm = caseInsensitive ? term.toLowerCase() : term;

    let pos = 0;
    while ((pos = searchText.indexOf(searchTerm, pos)) !== -1) {
      positions.push({
        start: pos,
        end: pos + term.length,
        term: term
      });
      pos += 1;
    }

    return positions;
  }

  /**
   * 评估布尔表达式
   * 简化版：递归下降解析
   */
  function evaluateBooleanExpression(tokens, termPositions, text, caseInsensitive) {
    // 简化实现：处理常见模式
    // 支持: "term1 AND term2", "term1 OR term2", "term1 NOT term2", "(term1 OR term2) AND term3"

    const matches = [];

    // 提取所有必须包含的词项（AND）
    const mustTerms = [];
    const shouldTerms = [];
    const notTerms = [];

    let currentOperator = 'AND'; // 默认操作符

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token.type === 'operator') {
        currentOperator = token.value;
      } else if (token.type === 'term') {
        if (currentOperator === 'NOT') {
          notTerms.push(token.value);
          currentOperator = 'AND'; // 重置
        } else if (currentOperator === 'OR') {
          shouldTerms.push(token.value);
        } else {
          mustTerms.push(token.value);
        }
      }
    }

    // 如果没有 must 词项，将 should 的第一个作为 must
    if (mustTerms.length === 0 && shouldTerms.length > 0) {
      mustTerms.push(shouldTerms.shift());
    }

    // 查找同时满足所有条件的位置
    if (mustTerms.length === 0) {
      return matches;
    }

    // 以第一个 must 词项为基础
    const basePositions = termPositions.get(mustTerms[0]) || [];

    basePositions.forEach(basePos => {
      let isValid = true;
      const matchedTerms = [mustTerms[0]];
      let minPos = basePos.start;
      let maxPos = basePos.end;
      let score = 1;

      // 检查其他 must 词项是否在附近（窗口范围内）
      const windowSize = 500; // 500字符窗口

      for (let i = 1; i < mustTerms.length; i++) {
        const term = mustTerms[i];
        const positions = termPositions.get(term) || [];

        // 在窗口范围内查找
        const nearbyPos = positions.find(p =>
          Math.abs(p.start - basePos.start) <= windowSize
        );

        if (!nearbyPos) {
          isValid = false;
          break;
        }

        matchedTerms.push(term);
        minPos = Math.min(minPos, nearbyPos.start);
        maxPos = Math.max(maxPos, nearbyPos.end);
        score += 1;
      }

      // 检查 should 词项（加分项）
      shouldTerms.forEach(term => {
        const positions = termPositions.get(term) || [];
        const nearbyPos = positions.find(p =>
          Math.abs(p.start - basePos.start) <= windowSize
        );
        if (nearbyPos) {
          matchedTerms.push(term);
          minPos = Math.min(minPos, nearbyPos.start);
          maxPos = Math.max(maxPos, nearbyPos.end);
          score += 0.5;
        }
      });

      // 检查 not 词项（排除）
      notTerms.forEach(term => {
        const positions = termPositions.get(term) || [];
        const nearbyPos = positions.find(p =>
          Math.abs(p.start - basePos.start) <= windowSize
        );
        if (nearbyPos) {
          isValid = false;
        }
      });

      if (isValid) {
        matches.push({
          position: minPos,
          length: maxPos - minPos,
          matchedTerms: [...new Set(matchedTerms)],
          score
        });
      }
    });

    return matches;
  }

  /**
   * 去重匹配结果
   */
  function deduplicateMatches(matches) {
    const seen = new Set();
    return matches.filter(match => {
      const key = `${match.position}-${match.length}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }


  // 导出工具
  window.AdvancedSearchTools = {
    regexSearch,
    booleanSearch
  };

  console.log('[AdvancedSearchTools] 高级搜索工具已加载');

})(window);

