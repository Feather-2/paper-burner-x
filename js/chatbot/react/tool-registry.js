// tool-registry.js
// 工具注册表（从 react-engine.js 提取）

(function(window) {
  'use strict';

  /**
   * 工具注册表
   * 管理所有可用的检索工具
   */
  class ToolRegistry {
    constructor() {
      this.tools = new Map();
      this.registerBuiltinTools();
    }

    /**
     * 注册内置工具
     */
    registerBuiltinTools() {
      // === 搜索工具类 ===

      // 1. 向量语义搜索
      this.register({
        name: 'vector_search',
        description: '智能语义搜索，理解同义词、相关概念、隐含关系。适合概念性、开放性、探索性问题。',
        parameters: {
          query: { type: 'string', description: '语义描述或问题' },
          limit: { type: 'number', description: '返回结果数量', default: 10 }
        },
        execute: async (params) => {
          if (!window.SemanticVectorSearch || !window.SemanticVectorSearch.search) {
            return {
              success: false,
              error: '向量搜索功能未启用，建议使用 keyword_search 或 grep'
            };
          }

          if (!window.data?.vectorIndex && !window.data?.semanticGroups) {
            return {
              success: false,
              error: '向量索引未构建，建议使用 keyword_search 或 grep'
            };
          }

          try {
            const results = await window.SemanticVectorSearch.search(params.query, params.limit || 10);
            return {
              success: true,
              count: results.length,
              results: results.map(r => ({
                groupId: r.groupId,
                score: r.score,
                text: r.text,
                keywords: r.keywords
              }))
            };
          } catch (error) {
            return {
              success: false,
              error: `向量搜索失败: ${error.message}`
            };
          }
        }
      });

      // 2. BM25关键词搜索
      this.register({
        name: 'keyword_search',
        description: '多关键词加权搜索（BM25算法）。适用于精确查找特定关键词组合。',
        parameters: {
          keywords: { type: 'array', description: '关键词数组，如["词1", "词2"]' },
          limit: { type: 'number', description: '返回结果数量', default: 8 }
        },
        execute: async (params) => {
          if (!window.BM25Search || !window.BM25Search.search) {
            return {
              success: false,
              error: 'BM25搜索功能未加载，建议使用 grep'
            };
          }

          if (!window.data?.semanticGroups && !window.data?.ocrChunks && !window.data?.translatedChunks) {
            return {
              success: false,
              error: '文档chunks未生成，建议使用 grep'
            };
          }

          try {
            const results = await window.BM25Search.search(params.keywords, params.limit || 8);
            return {
              success: true,
              count: results.length,
              results: results.map(r => ({
                groupId: r.groupId,
                score: r.score,
                text: r.text,
                matchedKeywords: r.matchedKeywords
              }))
            };
          } catch (error) {
            return {
              success: false,
              error: `BM25搜索失败: ${error.message}`
            };
          }
        }
      });

      // 3. GREP字面文本搜索
      this.register({
        name: 'grep',
        description: '字面文本搜索（精确匹配）。支持OR逻辑（用|分隔多个关键词，如"词1|词2|词3"）。',
        parameters: {
          query: { type: 'string', description: '搜索关键词或短语' },
          limit: { type: 'number', description: '返回结果数量', default: 20 },
          context: { type: 'number', description: '上下文长度（字符数）', default: 2000 },
          caseInsensitive: { type: 'boolean', description: '是否忽略大小写', default: true }
        },
        execute: async (params) => {
          const docContent = (window.data?.translation || window.data?.ocr || '');
          if (!docContent) {
            return { success: false, error: '文档内容为空' };
          }

          const query = params.query || '';
          const limit = params.limit || 20;
          const context = params.context || 2000;
          const caseInsensitive = params.caseInsensitive !== false;

          const results = [];
          const keywords = query.split('|').map(k => k.trim()).filter(k => k);

          for (const keyword of keywords) {
            const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseInsensitive ? 'gi' : 'g');
            let match;
            while ((match = regex.exec(docContent)) !== null && results.length < limit) {
              const start = Math.max(0, match.index - context);
              const end = Math.min(docContent.length, match.index + keyword.length + context);
              results.push({
                keyword: keyword,
                position: match.index,
                preview: docContent.slice(start, end)
              });

              if (match.index === regex.lastIndex) regex.lastIndex++;
            }

            if (results.length >= limit) break;
          }

          return {
            success: true,
            count: results.length,
            matches: results
          };
        }
      });

      // 4. 正则表达式搜索
      this.register({
        name: 'regex_search',
        description: '正则表达式搜索，匹配特定格式。适用于：日期、编号、公式引用、图表标注等。',
        parameters: {
          pattern: { type: 'string', description: '正则表达式模式（需转义特殊字符）' },
          limit: { type: 'number', description: '返回结果数量', default: 10 },
          context: { type: 'number', description: '上下文长度（字符数）', default: 1500 }
        },
        execute: async (params) => {
          if (!window.AdvancedSearchTools || !window.AdvancedSearchTools.regexSearch) {
            return { success: false, error: 'AdvancedSearchTools未加载' };
          }

          const docContent = (window.data?.translation || window.data?.ocr || '');
          if (!docContent) {
            return { success: false, error: '文档内容为空' };
          }

          try {
            const results = window.AdvancedSearchTools.regexSearch(
              params.pattern,
              docContent,
              {
                limit: params.limit || 10,
                context: params.context || 1500
              }
            );

            return {
              success: true,
              count: results.length,
              matches: results
            };
          } catch (error) {
            return {
              success: false,
              error: error.message || '正则搜索失败'
            };
          }
        }
      });

      // 5. 布尔逻辑搜索
      this.register({
        name: 'boolean_search',
        description: '布尔逻辑搜索（支持AND/OR/NOT和括号）。语法示例："(词1 OR 词2) AND 词3 NOT 词4"',
        parameters: {
          query: { type: 'string', description: '布尔查询表达式' },
          limit: { type: 'number', description: '返回结果数量', default: 10 },
          context: { type: 'number', description: '上下文长度（字符数）', default: 1500 }
        },
        execute: async (params) => {
          if (!window.AdvancedSearchTools || !window.AdvancedSearchTools.booleanSearch) {
            return { success: false, error: 'AdvancedSearchTools未加载' };
          }

          const docContent = (window.data?.translation || window.data?.ocr || '');
          if (!docContent) {
            return { success: false, error: '文档内容为空' };
          }

          try {
            const results = window.AdvancedSearchTools.booleanSearch(
              params.query,
              docContent,
              {
                limit: params.limit || 10,
                context: params.context || 1500
              }
            );

            return {
              success: true,
              count: results.length,
              matches: results
            };
          } catch (error) {
            return {
              success: false,
              error: error.message || '布尔搜索失败'
            };
          }
        }
      });

      // === 意群工具类 ===

      // 6. 搜索意群
      this.register({
        name: 'search_semantic_groups',
        description: '在文档的语义意群中搜索相关内容。返回意群ID、摘要和关键词。',
        parameters: {
          query: { type: 'string', description: '搜索查询' },
          limit: { type: 'number', description: '返回结果数量', default: 5 }
        },
        execute: async (params) => {
          if (!window.SemanticTools) {
            return {
              success: false,
              error: 'SemanticTools未加载，建议使用 grep'
            };
          }

          if (!window.data?.semanticGroups || window.data.semanticGroups.length === 0) {
            return {
              success: false,
              error: '文档意群未生成，建议使用 grep 或 vector_search'
            };
          }

          const results = window.SemanticTools.searchGroups(params.query, params.limit || 5);
          return {
            success: true,
            results: results.map(r => ({
              groupId: r.groupId,
              summary: r.summary,
              keywords: r.keywords,
              charCount: r.charCount
            }))
          };
        }
      });

      // 7. 获取意群详细内容
      this.register({
        name: 'fetch_group_text',
        description: '获取指定意群的详细文本内容。granularity可选：summary(摘要), digest(精华), full(全文)。',
        parameters: {
          groupId: { type: 'string', description: '意群ID' },
          granularity: { type: 'string', description: '详细程度', default: 'digest', enum: ['summary', 'digest', 'full'] }
        },
        execute: async (params) => {
          if (!window.SemanticTools) {
            throw new Error('SemanticTools未加载');
          }
          const result = window.SemanticTools.fetchGroupText(params.groupId, params.granularity || 'digest');
          return {
            success: true,
            groupId: result.groupId,
            granularity: result.granularity,
            text: result.text,
            charCount: result.text.length
          };
        }
      });

      // 8. 获取意群完整信息
      this.register({
        name: 'fetch',
        description: '获取意群的完整详细信息（包含完整论述、公式、数据、图表、结构信息）。',
        parameters: {
          groupId: { type: 'string', description: '意群ID' }
        },
        execute: async (params) => {
          if (!window.SemanticTools || !window.SemanticTools.fetchGroupDetailed) {
            throw new Error('SemanticTools.fetchGroupDetailed未加载');
          }
          const result = window.SemanticTools.fetchGroupDetailed(params.groupId);
          return {
            success: true,
            groupId: result.groupId,
            text: result.text,
            structure: result.structure,
            keywords: result.keywords,
            summary: result.summary,
            digest: result.digest,
            charCount: result.charCount
          };
        }
      });

      // 9. 文档结构地图
      this.register({
        name: 'map',
        description: '获取文档整体结构地图（意群ID、字数、关键词、摘要、章节/图表/公式）。适用于了解文档整体脉络。',
        parameters: {
          limit: { type: 'number', description: '返回意群数量', default: 50 },
          includeStructure: { type: 'boolean', description: '是否包含结构信息（章节、图表等）', default: true }
        },
        execute: async (params) => {
          if (!window.SemanticTools) {
            return {
              success: false,
              error: 'SemanticTools未加载，可尝试使用 grep'
            };
          }

          const groups = window.data?.semanticGroups || [];

          if (groups.length === 0) {
            return {
              success: false,
              error: '文档意群未生成，建议使用 grep 或 vector_search'
            };
          }

          const limit = Math.min(params.limit || 50, groups.length);
          const includeStructure = params.includeStructure !== false;

          const mapData = groups.slice(0, limit).map(g => {
            const entry = {
              groupId: g.groupId,
              charCount: g.charCount || 0,
              keywords: g.keywords || [],
              summary: g.summary || ''
            };

            if (includeStructure && g.structure) {
              entry.structure = {
                sections: g.structure.sections || [],
                figures: g.structure.figures || [],
                formulas: g.structure.formulas || [],
                tables: g.structure.tables || []
              };
            }

            return entry;
          });

          return {
            success: true,
            totalGroups: groups.length,
            returnedGroups: mapData.length,
            docGist: window.data?.semanticDocGist || '',
            map: mapData
          };
        }
      });

      // 10. 列出所有意群概览
      this.register({
        name: 'list_all_groups',
        description: '列出文档中所有意群的概览信息（ID、关键词、摘要）。',
        parameters: {
          limit: { type: 'number', description: '返回数量限制', default: 20 },
          includeDigest: { type: 'boolean', description: '是否包含精华摘要', default: false }
        },
        execute: async (params) => {
          if (!window.SemanticTools) {
            throw new Error('SemanticTools未加载');
          }
          const results = window.SemanticTools.listGroups(params.limit || 20, params.includeDigest || false);
          return {
            success: true,
            count: results.length,
            groups: results
          };
        }
      });
    }

    /**
     * 注册新工具
     */
    register(tool) {
      if (!tool.name || !tool.execute) {
        throw new Error('工具必须包含name和execute字段');
      }
      this.tools.set(tool.name, tool);
    }

    /**
     * 获取所有工具定义
     */
    getToolDefinitions() {
      return Array.from(this.tools.values()).map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }));
    }

    /**
     * 根据文档状态获取可用的工具定义（动态过滤）
     */
    getAvailableToolDefinitions(hasSemanticGroups = false, hasVectorIndex = false, hasChunks = false) {
      const allTools = Array.from(this.tools.values());

      const requiresSemanticGroups = ['search_semantic_groups', 'fetch_group_text', 'fetch', 'map', 'list_all_groups'];
      const requiresVectorIndex = ['vector_search'];
      const requiresChunks = ['keyword_search'];

      const availableTools = allTools.filter(tool => {
        if (requiresSemanticGroups.includes(tool.name)) {
          return hasSemanticGroups;
        }
        if (requiresVectorIndex.includes(tool.name)) {
          return hasVectorIndex;
        }
        if (requiresChunks.includes(tool.name)) {
          return hasSemanticGroups || hasChunks;
        }
        return true;
      });

      return availableTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }));
    }

    /**
     * 执行工具
     */
    async execute(toolName, params) {
      const tool = this.tools.get(toolName);
      if (!tool) {
        throw new Error(`未找到工具: ${toolName}`);
      }
      try {
        return await tool.execute(params);
      } catch (error) {
        return {
          success: false,
          error: error.message || String(error)
        };
      }
    }
  }

  // 导出到全局
  window.ToolRegistry = ToolRegistry;

  console.log('[ToolRegistry] 模块已加载');

})(window);
