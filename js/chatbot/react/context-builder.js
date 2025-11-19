// context-builder.js
// 上下文构建器 - 改进初始上下文策略

(function(window) {
  'use strict';

  class ContextBuilder {
    /**
     * 构建初始上下文（改进策略：包含文档摘要）
     * @param {Object} docContent - 文档内容对象
     * @returns {string} 初始上下文
     */
    static buildInitialContext(docContent) {
      const parts = [];

      // 1. 文档基本信息
      parts.push('=== 文档信息 ===');
      parts.push(`名称: ${docContent.name || '未知'}`);

      if (docContent.pageCount) {
        parts.push(`页数: ${docContent.pageCount}`);
      }
      if (docContent.language) {
        parts.push(`语言: ${docContent.language}`);
      }
      parts.push('');

      // 2. 文档状态（决定可用工具）
      // 优先检查 docContent 传入的数据，回退到 window.data
      const hasSemanticGroups = (
        (Array.isArray(docContent.semanticGroups) && docContent.semanticGroups.length > 0) ||
        (Array.isArray(window.data?.semanticGroups) && window.data.semanticGroups.length > 0)
      );

      const hasVectorIndex = !!(
        window.data?.vectorIndex ||
        (hasSemanticGroups && window.SemanticVectorSearch?.isReady)
      );

      const groupCount = docContent.semanticGroups?.length || window.data?.semanticGroups?.length || 0;

      parts.push('=== 可用工具 ===');
      if (hasSemanticGroups) {
        parts.push(`✓ 结构化工具: map, search_semantic_groups, fetch (共 ${groupCount} 个意群)`);
      } else {
        parts.push('✗ 结构化工具不可用（意群未生成）');
      }

      if (hasVectorIndex) {
        parts.push('✓ 语义搜索: vector_search');
      } else {
        parts.push('✗ 语义搜索不可用（向量索引未构建）');
      }

      parts.push('✓ 精确搜索: grep, keyword_search, regex_search, boolean_search (始终可用)');
      parts.push('');

      // 3. 强制检索说明（参考 Roo Code 风格）
      parts.push('=== 当前状态 ===');
      parts.push('文档内容尚未加载到上下文中。');
      parts.push('');
      parts.push('你必须使用上述工具检索文档内容。在检索到相关内容之前，不要尝试回答用户问题。');
      parts.push('');

      return parts.join('\n');
    }

    /**
     * 格式化工具结果为上下文
     * @param {string} toolName - 工具名称
     * @param {Object} result - 工具执行结果
     * @returns {string} 格式化后的上下文
     */
    static formatToolResult(toolName, result) {
      const parts = [`【工具: ${toolName}】`];

      if (!result.success) {
        parts.push(`错误: ${result.error}`);
        return parts.join('\n');
      }

      switch (toolName) {
        case 'vector_search':
          parts.push(`找到 ${result.count || 0} 个语义相关结果:`);
          if (result.results && result.results.length > 0) {
            result.results.forEach((r, idx) => {
              parts.push(`${idx + 1}. [${r.groupId}] (相关度: ${(r.score || 0).toFixed(2)})`);
              parts.push(`   ${(r.text || '').slice(0, 200)}...`);
            });
          }
          break;

        case 'keyword_search':
          parts.push(`找到 ${result.count || 0} 个匹配结果:`);
          if (result.results && result.results.length > 0) {
            result.results.forEach((r, idx) => {
              parts.push(`${idx + 1}. [${r.groupId}] (评分: ${(r.score || 0).toFixed(2)})`);
              parts.push(`   ${(r.text || '').slice(0, 200)}...`);
            });
          }
          break;

        case 'grep':
          parts.push(`找到 ${result.count || 0} 处匹配:`);
          if (result.matches && result.matches.length > 0) {
            result.matches.slice(0, 5).forEach((m, idx) => {
              parts.push(`${idx + 1}. ${(m.preview || '').slice(0, 300)}`);
            });
          }
          break;

        case 'search_semantic_groups':
          parts.push(`找到 ${result.results?.length || 0} 个相关意群:`);
          if (result.results && result.results.length > 0) {
            result.results.forEach((r, idx) => {
              parts.push(`${idx + 1}. [${r.groupId}] ${r.keywords?.join(', ') || ''}`);
              parts.push(`   ${(r.summary || '').slice(0, 150)}...`);
            });
          }
          break;

        case 'fetch':
        case 'fetch_group_text':
          parts.push(`意群 [${result.groupId}]:`);
          parts.push(`字数: ${result.charCount || result.text?.length || 0}`);
          parts.push('');
          parts.push((result.text || '').slice(0, 1500));
          if ((result.text || '').length > 1500) {
            parts.push('...(内容较长，已截断)');
          }
          break;

        case 'map':
          parts.push(`文档结构 (${result.returnedGroups}/${result.totalGroups} 个意群):`);
          if (result.map && result.map.length > 0) {
            result.map.forEach((g, idx) => {
              parts.push(`${idx + 1}. [${g.groupId}] ${g.charCount}字 - ${g.keywords?.join(', ') || ''}`);
            });
          }
          break;

        default:
          parts.push(JSON.stringify(result, null, 2).slice(0, 500));
      }

      return parts.join('\n');
    }

    /**
     * 裁剪上下文以适应 token 预算
     * @param {string} context - 当前上下文
     * @param {number} maxTokens - 最大 token 数
     * @returns {string} 裁剪后的上下文
     */
    static pruneContext(context, maxTokens) {
      const targetChars = Math.floor(maxTokens * 2.5); // 粗略估算

      if (context.length <= targetChars) {
        return context;
      }

      // 保留前 30% 和后 50%（保留更多最新信息）
      const keepStart = Math.floor(targetChars * 0.3);
      const keepEnd = Math.floor(targetChars * 0.5);

      const startPart = context.slice(0, keepStart);
      const endPart = context.slice(-keepEnd);

      return startPart + '\n\n[...中间部分已省略以节省空间...]\n\n' + endPart;
    }
  }

  // 导出到全局
  window.ContextBuilder = ContextBuilder;

  console.log('[ContextBuilder] 模块已加载');

})(window);
