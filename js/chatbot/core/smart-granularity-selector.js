// js/chatbot/core/smart-granularity-selector.js
// 智能粒度选择器 - 根据问题类型和意群特征自动选择最佳粒度
(function(window) {
  'use strict';

  /**
   * 问题类型分类
   * - overview: 概览性问题（需要summary）
   * - specific: 具体细节问题（需要digest或full）
   * - extraction: 信息提取问题（需要full）
   * - analytical: 分析性问题（需要digest）
   */
  const QUERY_PATTERNS = {
    overview: [
      /总结|概括|概述|简述|大意|主要内容|主题|讲.*什么|关于什么/,
      /整体|全文|全部|所有|overall|summary|general/i,
      /介绍|背景|目的|意义|作用/,
      /有哪些|包括.*什么|涉及.*什么/
    ],
    extraction: [
      /具体|详细|准确|精确|原文|exact|specific|detail/i,
      /数据|数值|数字|结果|table|figure|chart/i,
      /步骤|流程|过程|方法|algorithm|procedure/i,
      /公式|方程|equation|formula/,
      /引用|citation|reference|出处/,
      /代码|code|实现|implementation/
    ],
    analytical: [
      /分析|解释|说明|explain|analyze|why|how/i,
      /原因|理由|依据|根据|原理|机制/,
      /比较|对比|区别|差异|联系|关系|compare/i,
      /优缺点|利弊|advantage|disadvantage/,
      /影响|作用|效果|impact|effect/
    ]
  };

  /**
   * 粒度选择规则
   * - summary: 摘要（80字）- 用于快速浏览、索引匹配
   * - digest: 精要（1000字）- 用于一般性分析、问答
   * - full: 全文（完整文本）- 用于精确查找、详细分析
   */
  const GRANULARITY_RULES = {
    overview: {
      default: 'summary',
      maxGroups: 10,  // 概览问题可以返回更多意群
      description: '概览性查询：使用摘要快速扫描'
    },
    analytical: {
      default: 'digest',
      maxGroups: 5,
      description: '分析性查询：使用精要提供足够细节'
    },
    extraction: {
      default: 'full',
      maxGroups: 3,  // 精确查询限制意群数量，避免上下文过长
      description: '提取性查询：使用全文确保信息完整'
    },
    specific: {
      default: 'digest',
      maxGroups: 5,
      description: '具体性查询：使用精要平衡细节与长度'
    }
  };

  /**
   * 分析查询类型
   * @param {string} query - 用户查询
   * @returns {string} 查询类型 (overview/analytical/extraction/specific)
   */
  function analyzeQueryType(query) {
    const q = String(query || '').trim();
    if (!q) return 'specific';

    // 检查各类型模式
    for (const [type, patterns] of Object.entries(QUERY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(q)) {
          return type;
        }
      }
    }

    // 默认使用specific类型
    return 'specific';
  }

  /**
   * 根据意群特征调整粒度
   * @param {Object} group - 意群对象
   * @param {string} baseGranularity - 基础粒度
   * @returns {string} 调整后的粒度
   */
  function adjustByGroupFeatures(group, baseGranularity) {
    if (!group) return baseGranularity;

    const charCount = group.charCount || 0;
    const hasDigest = !!(group.digest && group.digest.length > 100);
    const hasFull = !!(group.fullText && group.fullText.length > 500);

    // 如果意群本身很短（<2000字），直接使用full
    if (charCount < 2000 && hasFull) {
      return 'full';
    }

    // 如果没有digest，降级到summary或升级到full
    if (!hasDigest) {
      if (baseGranularity === 'digest') {
        return hasFull ? 'full' : 'summary';
      }
    }

    // 如果没有full，digest是最高粒度
    if (!hasFull && baseGranularity === 'full') {
      return hasDigest ? 'digest' : 'summary';
    }

    return baseGranularity;
  }

  /**
   * 智能选择粒度
   * @param {string} query - 用户查询
   * @param {Array} groups - 候选意群列表
   * @param {Object} options - 选项
   * @returns {Object} { granularity, maxGroups, queryType, reasoning }
   */
  function selectGranularity(query, groups = [], options = {}) {
    // 分析查询类型
    const queryType = analyzeQueryType(query);
    const rule = GRANULARITY_RULES[queryType] || GRANULARITY_RULES.specific;

    let granularity = options.forceGranularity || rule.default;
    let maxGroups = options.maxGroups || rule.maxGroups;

    // 如果候选意群少，可以使用更高粒度
    if (groups.length <= 2 && granularity === 'summary') {
      granularity = 'digest';
    } else if (groups.length === 1 && granularity !== 'full') {
      granularity = 'full';
    }

    // Token限制检查
    const estimatedTokens = estimateTokenUsage(groups.slice(0, maxGroups), granularity);
    if (options.maxTokens && estimatedTokens > options.maxTokens) {
      // Token超限，降级粒度或减少意群数
      if (granularity === 'full') {
        granularity = 'digest';
      } else if (granularity === 'digest' && estimatedTokens > options.maxTokens * 1.5) {
        granularity = 'summary';
      } else {
        // 减少意群数量
        maxGroups = Math.max(1, Math.floor(maxGroups * 0.6));
      }
    }

    return {
      granularity,
      maxGroups,
      queryType,
      reasoning: rule.description,
      estimatedTokens: estimateTokenUsage(groups.slice(0, maxGroups), granularity)
    };
  }

  /**
   * 估算Token使用量
   * @param {Array} groups - 意群列表
   * @param {string} granularity - 粒度
   * @returns {number} 估算的token数
   */
  function estimateTokenUsage(groups, granularity) {
    if (!Array.isArray(groups) || groups.length === 0) return 0;

    let totalChars = 0;
    groups.forEach(g => {
      if (granularity === 'summary') {
        totalChars += (g.summary || '').length;
      } else if (granularity === 'digest') {
        totalChars += (g.digest || '').length;
      } else if (granularity === 'full') {
        totalChars += g.charCount || (g.fullText || '').length;
      }
    });

    // 中文平均1.5字符=1token，英文平均4字符=1token
    // 这里简化为平均2字符=1token
    return Math.ceil(totalChars / 2);
  }

  /**
   * 批量选择意群的粒度（支持混合粒度）
   * @param {string} query - 用户查询
   * @param {Array} rankedGroups - 已排序的候选意群（相关性从高到低）
   * @param {Object} options - 选项
   * @returns {Array} [ { group, granularity, score } ]
   */
  function selectMixedGranularity(query, rankedGroups = [], options = {}) {
    const queryType = analyzeQueryType(query);
    const baseRule = GRANULARITY_RULES[queryType] || GRANULARITY_RULES.specific;

    const maxTokens = options.maxTokens || 8000;
    const result = [];
    let accumulatedTokens = 0;

    for (let i = 0; i < rankedGroups.length; i++) {
      const item = rankedGroups[i];
      const group = item.group || item;
      const score = item.score || 1.0;

      // 排名越靠前，使用越高粒度
      let granularity;
      if (i === 0) {
        // 最相关的意群：使用最高粒度
        granularity = queryType === 'overview' ? 'digest' : 'full';
      } else if (i < 3) {
        // 前3个意群：使用中等粒度
        granularity = baseRule.default;
      } else {
        // 其他意群：使用低粒度
        granularity = 'summary';
      }

      // 根据意群特征调整
      granularity = adjustByGroupFeatures(group, granularity);

      // 估算token
      const tokens = estimateTokenUsage([group], granularity);

      // 检查是否会超限
      if (accumulatedTokens + tokens > maxTokens) {
        // 尝试降级
        if (granularity === 'full') {
          granularity = 'digest';
        } else if (granularity === 'digest') {
          granularity = 'summary';
        } else {
          // 已经是summary，无法继续添加
          break;
        }
      }

      const finalTokens = estimateTokenUsage([group], granularity);
      if (accumulatedTokens + finalTokens > maxTokens) {
        break; // 无法添加更多意群
      }

      accumulatedTokens += finalTokens;
      result.push({
        group,
        granularity,
        score,
        tokens: finalTokens
      });

      // 检查是否已有足够的意群
      if (result.length >= (baseRule.maxGroups || 5)) {
        break;
      }
    }

    return result;
  }

  /**
   * 构建混合粒度上下文
   * @param {Array} selections - selectMixedGranularity的结果
   * @returns {string} 组合后的上下文文本
   */
  function buildMixedContext(selections) {
    if (!Array.isArray(selections) || selections.length === 0) return '';

    const parts = [];
    selections.forEach(sel => {
      const g = sel.group;
      const gran = sel.granularity;

      let text = '';
      if (gran === 'summary') {
        text = g.summary || '';
      } else if (gran === 'digest') {
        text = g.digest || g.summary || '';
      } else if (gran === 'full') {
        text = g.fullText || g.digest || g.summary || '';
      }

      if (text) {
        const keywords = (g.keywords || []).join('、');
        parts.push(`【${g.groupId} - ${gran}】\n关键词: ${keywords}\n内容:\n${text}`);
      }
    });

    return parts.join('\n\n');
  }

  // 导出
  window.SmartGranularitySelector = {
    analyzeQueryType,
    selectGranularity,
    selectMixedGranularity,
    buildMixedContext,
    estimateTokenUsage,
    adjustByGroupFeatures,
    // 暴露规则以便测试和调整
    GRANULARITY_RULES,
    QUERY_PATTERNS
  };

  console.log('[SmartGranularitySelector] 智能粒度选择器已加载');

})(window);
