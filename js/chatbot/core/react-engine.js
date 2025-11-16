// react-engine.js
// ReAct (Reasoning + Acting) 引擎
// 支持推理与工具调用交织，动态构建上下文

(function(window) {
  'use strict';

  // ============================================
  // Token预算管理器
  // ============================================
  class TokenBudgetManager {
    constructor(config = {}) {
      this.totalBudget = config.totalBudget || 32000;  // 总token预算
      this.allocation = {
        system: config.systemTokens || 2000,
        history: config.historyTokens || 8000,
        context: config.contextTokens || 18000,  // 动态上下文
        response: config.responseTokens || 4000
      };
    }

    /**
     * 估算文本的token数量（粗略估算：中文1字≈1.5token，英文1字≈0.25token）
     */
    estimate(text) {
      if (!text) return 0;
      const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
      const otherChars = text.length - chineseChars;
      return Math.ceil(chineseChars * 1.5 + otherChars * 0.25);
    }

    /**
     * 检查是否超出预算
     */
    isOverBudget(contexts) {
      const total = Object.entries(contexts).reduce((sum, [key, text]) => {
        const allocated = this.allocation[key] || 0;
        const actual = this.estimate(text);
        return sum + Math.min(allocated, actual);
      }, 0);
      return total > this.totalBudget;
    }

    /**
     * 获取上下文的剩余token预算
     */
    getRemainingContextBudget(systemPrompt, history) {
      const used = this.estimate(systemPrompt) + this.estimate(history);
      return Math.max(0, this.allocation.context - used);
    }
  }

  // ============================================
  // 工具注册表
  // ============================================
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

      // 1. 向量语义搜索（推荐优先使用）
      this.register({
        name: 'vector_search',
        description: '智能语义搜索，理解同义词、相关概念、隐含关系。适合概念性、开放性、探索性问题。【前置条件：需要已构建向量索引】',
        parameters: {
          query: { type: 'string', description: '语义描述或问题' },
          limit: { type: 'number', description: '返回结果数量（概念性问题用10-15，精确查找用5）', default: 10 }
        },
        execute: async (params) => {
          // 前置检查：是否有向量搜索功能
          if (!window.SemanticVectorSearch || !window.SemanticVectorSearch.search) {
            return {
              success: false,
              error: '向量搜索功能未启用（需先构建向量索引），建议降级使用keyword_search或grep'
            };
          }

          // 检查是否有向量索引
          if (!window.data?.vectorIndex && !window.data?.semanticGroups) {
            return {
              success: false,
              error: '向量索引未构建，建议先使用map工具或降级使用keyword_search'
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
              error: `向量搜索失败: ${error.message}，建议降级使用keyword_search或grep`
            };
          }
        }
      });

      // 2. BM25关键词搜索
      this.register({
        name: 'keyword_search',
        description: '多关键词加权搜索（BM25算法）。适用于精确查找特定关键词组合。【前置条件：需要已生成意群或chunks】',
        parameters: {
          keywords: { type: 'array', description: '关键词数组，如["词1", "词2"]' },
          limit: { type: 'number', description: '返回结果数量（关键词明确用5，模糊查找用10）', default: 8 }
        },
        execute: async (params) => {
          if (!window.BM25Search || !window.BM25Search.search) {
            return {
              success: false,
              error: 'BM25搜索功能未加载，建议降级使用grep'
            };
          }

          // 检查是否有可搜索的内容
          if (!window.data?.semanticGroups && !window.data?.ocrChunks && !window.data?.translatedChunks) {
            return {
              success: false,
              error: '文档chunks未生成，建议使用grep直接搜索原文'
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
              error: `BM25搜索失败: ${error.message}，建议降级使用grep`
            };
          }
        }
      });

      // 3. GREP字面文本搜索
      this.register({
        name: 'grep',
        description: '字面文本搜索（精确匹配）。适合搜索专有名词、特定数字、固定术语。支持OR逻辑（用|分隔多个关键词）。',
        parameters: {
          query: { type: 'string', description: '搜索关键词或短语，支持 | 分隔（如"方程|公式|equation"）' },
          limit: { type: 'number', description: '返回结果数量', default: 20 },
          context: { type: 'number', description: '上下文长度（字符数）', default: 2000 },
          caseInsensitive: { type: 'boolean', description: '是否忽略大小写', default: true }
        },
        execute: async (params) => {
          // 在文档内容中搜索
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
        description: '正则表达式搜索，匹配特定格式。适用于：日期格式、编号（如"公式3.2"）、电话邮箱、数学公式编号、图表引用等。',
        parameters: {
          pattern: { type: 'string', description: '正则表达式模式（需转义特殊字符，如 \\d 表示数字）' },
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
        description: '布尔逻辑搜索（支持AND/OR/NOT和括号）。适用于复杂逻辑查询、多概念精确组合、排除干扰信息。语法示例："(词1 OR 词2) AND 词3 NOT 词4"',
        parameters: {
          query: { type: 'string', description: '布尔查询表达式，如"(CNN OR RNN) AND 对比 NOT 图像"' },
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

      // 6. 搜索意群（保留原有功能）
      this.register({
        name: 'search_semantic_groups',
        description: '在文档的语义意群中搜索相关内容。返回意群ID、摘要和关键词。【前置条件：需要已生成意群】',
        parameters: {
          query: { type: 'string', description: '搜索查询' },
          limit: { type: 'number', description: '返回结果数量', default: 5 }
        },
        execute: async (params) => {
          if (!window.SemanticTools) {
            return {
              success: false,
              error: 'SemanticTools未加载，意群功能不可用，建议使用grep搜索原文'
            };
          }

          // 检查是否有意群数据
          if (!window.data?.semanticGroups || window.data.semanticGroups.length === 0) {
            return {
              success: false,
              error: '文档意群未生成，建议使用grep、vector_search或keyword_search'
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

      // 7. 获取意群详细内容（简化版）
      this.register({
        name: 'fetch_group_text',
        description: '获取指定意群的详细文本内容。granularity可选：summary(摘要,800字), digest(精华,3000字), full(全文,8000字)。',
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

      // 8. 获取意群详细信息（完整版，包含结构信息）
      this.register({
        name: 'fetch',
        description: '获取指定意群的完整详细信息（包含完整论述、公式、数据、图表、结构信息）。当搜索到的chunk片段信息不足，需要看到完整上下文时使用。',
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
        description: '获取文档整体结构地图（意群ID、字数、关键词、摘要、章节/图表/公式）。适用于：综合性分析问题、需要了解文档整体脉络、或需要确定重点章节时。【前置条件：需要已生成意群】',
        parameters: {
          limit: { type: 'number', description: '返回意群数量', default: 50 },
          includeStructure: { type: 'boolean', description: '是否包含结构信息（章节、图表等）', default: true }
        },
        execute: async (params) => {
          if (!window.SemanticTools) {
            return {
              success: false,
              error: 'SemanticTools未加载，无法获取文档地图。可尝试直接使用grep搜索'
            };
          }

          const groups = window.data?.semanticGroups || [];

          // 检查是否有意群数据
          if (groups.length === 0) {
            return {
              success: false,
              error: '文档意群未生成，无法提供结构地图。建议直接使用grep、vector_search或keyword_search检索具体内容'
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

      // 10. 列出所有意群概览（简化版）
      this.register({
        name: 'list_all_groups',
        description: '列出文档中所有意群的概览信息（ID、关键词、摘要）。与map工具类似，但不包含结构信息。',
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

      // 4. 在意群中查找关键词
      this.register({
        name: 'grep_in_groups',
        description: '在意群内容中搜索包含特定关键词的段落。支持正则表达式。',
        parameters: {
          pattern: { type: 'string', description: '搜索模式（支持正则）' },
          scope: { type: 'string', description: '搜索范围', default: 'digest', enum: ['summary', 'digest', 'full'] },
          limit: { type: 'number', description: '返回结果数量', default: 10 }
        },
        execute: async (params) => {
          if (!window.SemanticTools || !window.SemanticTools.findInGroups) {
            throw new Error('SemanticTools.findInGroups未加载');
          }
          const results = window.SemanticTools.findInGroups(
            params.pattern,
            params.scope || 'digest',
            params.limit || 10
          );
          return {
            success: true,
            pattern: params.pattern,
            matchCount: results ? results.length : 0,
            matches: results || []
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
     * 获取工具定义（用于传递给LLM）
     */
    getToolDefinitions() {
      return Array.from(this.tools.values()).map(tool => ({
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

  // ============================================
  // 系统提示词构建器
  // ============================================
  class SystemPromptBuilder {
    /**
     * 构建 ReAct 系统提示词
     * 参考 Claude Code 的详细提示词风格
     */
    static buildReActSystemPrompt(toolRegistry) {
      const parts = [];

      // 1. 角色定义
      parts.push('你是一个智能文档助手，使用 ReAct（Reasoning + Acting）框架回答用户问题。');
      parts.push('');

      // 2. 工作流程说明
      parts.push('## 工作流程');
      parts.push('');
      parts.push('你将交替进行 **推理（Thought）** 和 **行动（Action）**：');
      parts.push('1. **推理阶段**：分析当前已知信息，判断是否足够回答问题');
      parts.push('2. **决策阶段**：');
      parts.push('   - 如果信息充足 → 直接回答用户');
      parts.push('   - 如果需要更多信息 → 选择合适的工具检索');
      parts.push('3. **行动阶段**：调用工具获取新信息');
      parts.push('4. **观察阶段**：工具返回结果，加入已知信息');
      parts.push('5. **迭代**：返回步骤1，直到可以回答问题');
      parts.push('');

      // 3. 工具选择策略
      parts.push('## 工具选择策略');
      parts.push('');
      parts.push('### 优先级规则（从高到低）：');
      parts.push('');
      parts.push('1. **结构化工具优先**（如果文档已生成意群）');
      parts.push('   - `map`: 首次接触文档时，获取整体结构');
      parts.push('   - `search_semantic_groups`: 概念性、探索性问题');
      parts.push('   - `fetch`: 需要完整上下文（公式、图表、完整论述）');
      parts.push('');
      parts.push('2. **语义搜索次之**（如果向量索引可用）');
      parts.push('   - `vector_search`: 理解同义词、相关概念、隐含关系');
      parts.push('   - 适合：开放性问题、概念解释、主题探索');
      parts.push('');
      parts.push('3. **精确搜索作为补充**');
      parts.push('   - `keyword_search`: 多关键词组合查找（BM25）');
      parts.push('   - `grep`: 精确文本匹配（专有名词、固定术语）');
      parts.push('   - `regex_search`: 特定格式（日期、编号、公式引用）');
      parts.push('');
      parts.push('4. **高级搜索**');
      parts.push('   - `boolean_search`: 复杂逻辑组合（AND/OR/NOT）');
      parts.push('');

      // 4. 并行工具调用指南
      parts.push('## 并行工具调用');
      parts.push('');
      parts.push('当需要从**不同角度**同时获取信息时，可以并行调用多个工具：');
      parts.push('');
      parts.push('**适合并行的场景**：');
      parts.push('- 同时搜索不同关键词（如"背景" + "意义"）');
      parts.push('- 语义搜索 + 精确搜索（覆盖更全面）');
      parts.push('- 获取多个不同意群的详细内容');
      parts.push('');
      parts.push('**不适合并行的场景**：');
      parts.push('- 工具之间有依赖关系（需先 map 再 fetch）');
      parts.push('- 同一个工具重复调用');
      parts.push('');
      parts.push('**并行格式**：返回数组');
      parts.push('```json');
      parts.push('{');
      parts.push('  "action": "use_tool",');
      parts.push('  "thought": "同时从语义和精确两个角度搜索",');
      parts.push('  "tool_calls": [');
      parts.push('    {"tool": "vector_search", "params": {"query": "研究背景", "limit": 5}},');
      parts.push('    {"tool": "grep", "params": {"query": "background|背景", "limit": 5}}');
      parts.push('  ]');
      parts.push('}');
      parts.push('```');
      parts.push('');

      // 5. 最佳实践
      parts.push('## 最佳实践');
      parts.push('');
      parts.push('### ✅ 推荐做法');
      parts.push('- 首次接触文档时，先用 `map` 了解整体结构');
      parts.push('- 语义问题优先用 `vector_search`，失败时降级到 `keyword_search` 或 `grep`');
      parts.push('- 需要完整上下文时使用 `fetch(groupId)`，而非片段搜索');
      parts.push('- 合理设置 `limit` 参数：精确查找用 5，探索性查找用 10');
      parts.push('- 工具失败时检查错误信息，按建议降级使用其他工具');
      parts.push('');
      parts.push('### ❌ 避免做法');
      parts.push('- 盲目调用工具而不分析错误信息');
      parts.push('- 重复调用同一工具和参数');
      parts.push('- 忽略已知信息，过度依赖工具');
      parts.push('- 在没有必要时使用 `full` 粒度（消耗过多 token）');
      parts.push('');

      // 6. 响应格式
      parts.push('## 响应格式');
      parts.push('');
      parts.push('### 单工具调用');
      parts.push('```json');
      parts.push('{');
      parts.push('  "action": "use_tool",');
      parts.push('  "thought": "需要XX信息，使用YY工具",');
      parts.push('  "tool": "工具名",');
      parts.push('  "params": {参数对象}');
      parts.push('}');
      parts.push('```');
      parts.push('');
      parts.push('### 多工具并行调用');
      parts.push('```json');
      parts.push('{');
      parts.push('  "action": "use_tool",');
      parts.push('  "thought": "从多个角度同时检索",');
      parts.push('  "tool_calls": [');
      parts.push('    {"tool": "工具1", "params": {...}},');
      parts.push('    {"tool": "工具2", "params": {...}}');
      parts.push('  ]');
      parts.push('}');
      parts.push('```');
      parts.push('');
      parts.push('### 直接回答');
      parts.push('```json');
      parts.push('{');
      parts.push('  "action": "answer",');
      parts.push('  "thought": "当前信息已足够回答",');
      parts.push('  "answer": "详细答案"');
      parts.push('}');
      parts.push('```');
      parts.push('');

      return parts.join('\n');
    }

    /**
     * 构建工具使用指南（详细的工具描述）
     */
    static buildToolUsageGuidelines(toolRegistry) {
      const parts = [];

      parts.push('## 可用工具详细说明');
      parts.push('');

      const toolDefs = toolRegistry.getToolDefinitions();

      // 按类型分组展示工具
      const searchTools = toolDefs.filter(t =>
        ['vector_search', 'keyword_search', 'grep', 'regex_search', 'boolean_search'].includes(t.name)
      );
      const groupTools = toolDefs.filter(t =>
        ['search_semantic_groups', 'fetch_group_text', 'fetch', 'map', 'list_all_groups'].includes(t.name)
      );

      if (searchTools.length > 0) {
        parts.push('### 🔍 搜索工具类');
        parts.push('');
        searchTools.forEach(tool => {
          parts.push(`**${tool.name}**`);
          parts.push(`- 描述：${tool.description}`);
          parts.push('- 参数：');
          Object.entries(tool.parameters).forEach(([key, param]) => {
            const defaultStr = param.default !== undefined ? ` (默认: ${param.default})` : '';
            parts.push(`  - \`${key}\` (${param.type})${defaultStr}: ${param.description}`);
          });
          parts.push('');
        });
      }

      if (groupTools.length > 0) {
        parts.push('### 📚 意群工具类');
        parts.push('');
        groupTools.forEach(tool => {
          parts.push(`**${tool.name}**`);
          parts.push(`- 描述：${tool.description}`);
          parts.push('- 参数：');
          Object.entries(tool.parameters).forEach(([key, param]) => {
            const defaultStr = param.default !== undefined ? ` (默认: ${param.default})` : '';
            parts.push(`  - \`${key}\` (${param.type})${defaultStr}: ${param.description}`);
          });
          parts.push('');
        });
      }

      return parts.join('\n');
    }
  }

  // ============================================
  // ReAct引擎核心
  // ============================================
  class ReActEngine {
    constructor(config = {}) {
      this.maxIterations = config.maxIterations || 5;
      this.budgetManager = new TokenBudgetManager(config.tokenBudget);
      this.toolRegistry = new ToolRegistry();
      this.eventHandlers = [];

      // LLM调用配置
      this.llmConfig = config.llmConfig || {};

      // 构建系统提示词（延迟到第一次使用，因为工具还未注册）
      this._systemPrompt = null;
      this._toolGuidelines = null;
    }

    /**
     * 获取系统提示词（懒加载）
     */
    getSystemPrompt() {
      if (!this._systemPrompt) {
        this._systemPrompt = SystemPromptBuilder.buildReActSystemPrompt(this.toolRegistry);
      }
      return this._systemPrompt;
    }

    /**
     * 获取工具使用指南（懒加载）
     */
    getToolGuidelines() {
      if (!this._toolGuidelines) {
        this._toolGuidelines = SystemPromptBuilder.buildToolUsageGuidelines(this.toolRegistry);
      }
      return this._toolGuidelines;
    }

    /**
     * 添加事件监听器
     */
    on(eventType, handler) {
      this.eventHandlers.push({ type: eventType, handler });
    }

    /**
     * 发送事件
     */
    emit(eventType, data) {
      this.eventHandlers
        .filter(h => h.type === eventType || h.type === '*')
        .forEach(h => {
          try {
            h.handler(data);
          } catch (e) {
            console.error('[ReActEngine] 事件处理器错误:', e);
          }
        });
    }

    /**
     * 构建初始轻量级上下文
     */
    buildInitialContext(docContent) {
      const parts = [];

      // 文档基本信息
      if (docContent.name) {
        parts.push(`文档名称: ${docContent.name}`);
      }

      // 如果有意群，提供概览
      if (Array.isArray(docContent.semanticGroups) && docContent.semanticGroups.length > 0) {
        const topGroups = docContent.semanticGroups.slice(0, 8);
        parts.push('\n文档意群概览（前8个）:');
        topGroups.forEach((g, idx) => {
          const keywords = Array.isArray(g.keywords) ? g.keywords.join('、') : '';
          parts.push(`${idx + 1}. [${g.groupId}] ${keywords} - ${(g.summary || '').slice(0, 80)}`);
        });
        parts.push(`\n总计${docContent.semanticGroups.length}个意群。如需详细内容，请使用工具检索。`);
      } else {
        // 没有意群，提供简短的文档片段
        const snippet = (docContent.translation || docContent.ocr || '').slice(0, 2000);
        if (snippet) {
          parts.push('\n文档内容片段（前2000字）:\n' + snippet);
          parts.push('\n[文档较长，如需更多内容请使用检索工具]');
        }
      }

      return parts.join('\n');
    }

    /**
     * 调用LLM进行推理
     * @param {string} systemPrompt - 系统提示词
     * @param {Array} conversationHistory - 对话历史
     * @param {string} currentContext - 当前上下文
     * @param {string} userQuestion - 用户问题
     * @param {Array} toolResults - 之前的工具调用结果
     * @returns {Promise<Object>} { thought, action, tool, params, answer }
     */
    async reasoning(systemPrompt, conversationHistory, currentContext, userQuestion, toolResults = []) {
      // 构建推理提示词
      const reasoningPrompt = this.buildReasoningPrompt(
        currentContext,
        userQuestion,
        toolResults
      );

      this.emit('reasoning_start', { prompt: reasoningPrompt });

      // 使用增强的系统提示词（合并原始 systemPrompt 和 ReAct 系统提示词）
      const enhancedSystemPrompt = systemPrompt + '\n\n' + this.getSystemPrompt();

      // 调用LLM
      const response = await this.callLLM(enhancedSystemPrompt, conversationHistory, reasoningPrompt);

      this.emit('reasoning_complete', { response });

      // 解析响应
      return this.parseReasoningResponse(response);
    }

    /**
     * 构建推理提示词（简化版，委托给 SystemPromptBuilder）
     */
    buildReasoningPrompt(context, question, toolResults) {
      const parts = [];

      // 当前已知信息
      parts.push('---');
      parts.push('当前已知信息:');
      parts.push(context);
      parts.push('');

      // 工具调用历史
      if (toolResults.length > 0) {
        parts.push('工具调用历史:');
        toolResults.forEach((result, idx) => {
          parts.push(`${idx + 1}. 调用 ${result.tool}(${JSON.stringify(result.params)})`);
          const resultStr = JSON.stringify(result.result);
          parts.push(`   结果: ${resultStr.length > 500 ? resultStr.slice(0, 500) + '...' : resultStr}`);
        });
        parts.push('');
      }

      // 用户问题
      parts.push('用户问题:');
      parts.push(question);
      parts.push('---');
      parts.push('');

      // 使用 SystemPromptBuilder 的详细工具指南
      parts.push(this.getToolGuidelines());
      parts.push('');

      // 响应格式提醒（从 SystemPrompt 中提取的简化版）
      parts.push('请以JSON格式返回你的决策（支持单工具或并行多工具）:');

      return parts.join('\n');
    }

    /**
     * 调用LLM
     */
    async callLLM(systemPrompt, conversationHistory, userPrompt) {
      if (!window.llmCaller) {
        throw new Error('LLMCaller未加载');
      }

      try {
        const response = await window.llmCaller.call(
          systemPrompt,
          conversationHistory,
          userPrompt,
          {
            externalConfig: this.llmConfig,
            timeout: 60000
          }
        );
        return response;
      } catch (error) {
        console.error('[ReActEngine] LLM调用失败:', error);
        throw error;
      }
    }

    /**
     * 解析LLM的推理响应（支持并行工具调用）
     */
    parseReasoningResponse(response) {
      // 添加日志：查看 LLM 原始响应
      console.log('[ReActEngine] LLM原始响应:');
      console.log('----------------------------------------');
      console.log(response);
      console.log('----------------------------------------');

      try {
        // 尝试提取JSON
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error('[ReActEngine] 响应中未找到JSON格式，原始响应长度:', response.length);
          throw new Error('响应中未找到JSON格式');
        }

        const parsed = JSON.parse(jsonMatch[0]);

        if (parsed.action === 'answer') {
          return {
            action: 'answer',
            thought: parsed.thought || '',
            answer: parsed.answer || response
          };
        } else if (parsed.action === 'use_tool') {
          // 支持两种格式：
          // 1. 单工具: { tool: "...", params: {...} }
          // 2. 并行工具: { tool_calls: [{tool: "...", params: {...}}, ...] }

          if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
            // 并行工具调用
            return {
              action: 'use_tool',
              thought: parsed.thought || '',
              parallel: true,
              tool_calls: parsed.tool_calls.map(call => ({
                tool: call.tool,
                params: call.params || {}
              }))
            };
          } else {
            // 单工具调用
            return {
              action: 'use_tool',
              thought: parsed.thought || '',
              parallel: false,
              tool: parsed.tool,
              params: parsed.params || {}
            };
          }
        } else {
          throw new Error('未知的action类型: ' + parsed.action);
        }
      } catch (error) {
        console.warn('[ReActEngine] 解析响应失败，降级为直接回答:', error);
        return {
          action: 'answer',
          thought: '无法解析工具调用，直接回答',
          answer: response
        };
      }
    }

    /**
     * 执行ReAct循环
     * @param {string} userQuestion - 用户问题
     * @param {Object} docContent - 文档内容
     * @param {string} systemPrompt - 系统提示词
     * @param {Array} conversationHistory - 对话历史
     * @returns {AsyncGenerator} 流式返回事件
     */
    async *run(userQuestion, docContent, systemPrompt, conversationHistory = []) {
      this.emit('session_start', { question: userQuestion });

      // 构建初始轻量级上下文
      let context = this.buildInitialContext(docContent);
      const toolResults = [];
      let iterations = 0;

      yield { type: 'context_initialized', context: context.slice(0, 500) + '...' };

      while (iterations < this.maxIterations) {
        iterations++;

        yield { type: 'iteration_start', iteration: iterations, maxIterations: this.maxIterations };

        // 1. 推理阶段
        yield { type: 'reasoning_start', iteration: iterations };

        let decision;
        try {
          decision = await this.reasoning(
            systemPrompt,
            conversationHistory,
            context,
            userQuestion,
            toolResults
          );
        } catch (error) {
          yield {
            type: 'error',
            error: '推理失败: ' + (error.message || String(error)),
            iteration: iterations
          };
          break;
        }

        yield {
          type: 'reasoning_complete',
          iteration: iterations,
          thought: decision.thought,
          action: decision.action
        };

        // 2. 判断是回答还是使用工具
        if (decision.action === 'answer') {
          yield {
            type: 'final_answer',
            answer: decision.answer,
            iterations: iterations,
            toolCallCount: toolResults.length
          };
          this.emit('session_complete', { answer: decision.answer, iterations });
          return;
        }

        // 3. 执行工具调用（支持并行）
        if (decision.action === 'use_tool') {
          // 判断是单工具还是并行工具
          const toolCalls = decision.parallel
            ? decision.tool_calls
            : [{ tool: decision.tool, params: decision.params }];

          // 发送工具调用开始事件
          for (const call of toolCalls) {
            yield {
              type: 'tool_call_start',
              iteration: iterations,
              tool: call.tool,
              params: call.params,
              parallel: decision.parallel,
              totalCalls: toolCalls.length
            };
          }

          // 并行执行所有工具
          const executePromises = toolCalls.map(async (call) => {
            let toolResult;
            try {
              toolResult = await this.toolRegistry.execute(call.tool, call.params);
            } catch (error) {
              toolResult = {
                success: false,
                error: error.message || String(error)
              };
            }

            return {
              tool: call.tool,
              params: call.params,
              result: toolResult
            };
          });

          // 等待所有工具完成
          const completedCalls = await Promise.all(executePromises);

          // 发送工具调用完成事件
          for (const call of completedCalls) {
            yield {
              type: 'tool_call_complete',
              iteration: iterations,
              tool: call.tool,
              params: call.params,
              result: call.result,
              parallel: decision.parallel
            };
          }

          // 4. 更新上下文
          for (const call of completedCalls) {
            const newContext = this.formatToolResultForContext(call.tool, call.result);
            context += '\n\n' + newContext;

            toolResults.push({
              tool: call.tool,
              params: call.params,
              result: call.result
            });
          }

          // 5. Token预算检查
          const contextTokens = this.budgetManager.estimate(context);
          const budgetLimit = this.budgetManager.allocation.context;

          if (contextTokens > budgetLimit) {
            yield {
              type: 'context_pruned',
              before: contextTokens,
              after: budgetLimit,
              iteration: iterations
            };
            context = this.pruneContext(context, budgetLimit);
          }

          yield {
            type: 'context_updated',
            iteration: iterations,
            contextSize: context.length,
            estimatedTokens: this.budgetManager.estimate(context),
            parallelCallsCount: decision.parallel ? toolCalls.length : 0
          };
        }
      }

      // 达到最大迭代次数，强制返回
      yield {
        type: 'max_iterations_reached',
        iterations: this.maxIterations,
        toolCallCount: toolResults.length
      };

      // 最后尝试基于当前上下文回答
      const fallbackAnswer = `经过${iterations}轮推理和工具调用，我收集到以下信息：\n\n${context.slice(0, 2000)}\n\n但未能在迭代限制内得出完整答案。建议您：\n1. 提供更具体的问题\n2. 或增加迭代次数限制`;

      yield {
        type: 'final_answer',
        answer: fallbackAnswer,
        iterations: iterations,
        toolCallCount: toolResults.length,
        fallback: true
      };

      this.emit('session_complete', { answer: fallbackAnswer, iterations, fallback: true });
    }

    /**
     * 格式化工具结果为上下文
     */
    formatToolResultForContext(toolName, result) {
      const parts = [`【工具调用结果: ${toolName}】`];

      if (!result.success) {
        parts.push(`错误: ${result.error}`);
        return parts.join('\n');
      }

      switch (toolName) {
        case 'vector_search':
          parts.push(`向量搜索 "${result.query || ''}"`);
          parts.push(`找到 ${result.count || 0} 个语义相关结果:`);
          if (result.results && result.results.length > 0) {
            result.results.forEach((r, idx) => {
              parts.push(`${idx + 1}. [${r.groupId}] 相关度: ${(r.score || 0).toFixed(3)}`);
              parts.push(`   关键词: ${r.keywords?.join('、') || ''}`);
              parts.push(`   内容片段: ${(r.text || '').slice(0, 300)}`);
            });
          }
          break;

        case 'keyword_search':
          parts.push(`BM25搜索 [${result.keywords?.join(', ') || ''}]`);
          parts.push(`找到 ${result.count || 0} 个匹配结果:`);
          if (result.results && result.results.length > 0) {
            result.results.forEach((r, idx) => {
              parts.push(`${idx + 1}. [${r.groupId}] 评分: ${(r.score || 0).toFixed(2)}`);
              parts.push(`   匹配关键词: ${r.matchedKeywords?.join('、') || ''}`);
              parts.push(`   内容片段: ${(r.text || '').slice(0, 300)}`);
            });
          }
          break;

        case 'grep':
          parts.push(`文本搜索 "${result.query || ''}"`);
          parts.push(`找到 ${result.count || 0} 处匹配:`);
          if (result.matches && result.matches.length > 0) {
            result.matches.slice(0, 5).forEach((m, idx) => {
              parts.push(`${idx + 1}. 关键词: ${m.keyword}`);
              parts.push(`   位置: 第 ${m.position} 字符`);
              parts.push(`   上下文: ${(m.preview || '').slice(0, 200)}`);
            });
          }
          break;

        case 'regex_search':
          parts.push(`正则搜索 /${result.pattern || ''}/`);
          parts.push(`找到 ${result.count || 0} 处匹配:`);
          if (result.matches && result.matches.length > 0) {
            result.matches.slice(0, 5).forEach((m, idx) => {
              parts.push(`${idx + 1}. 匹配文本: ${m.match}`);
              parts.push(`   上下文: ${(m.preview || '').slice(0, 200)}`);
            });
          }
          break;

        case 'boolean_search':
          parts.push(`布尔搜索 "${result.query || ''}"`);
          parts.push(`找到 ${result.count || 0} 处匹配:`);
          if (result.matches && result.matches.length > 0) {
            result.matches.slice(0, 5).forEach((m, idx) => {
              parts.push(`${idx + 1}. ${(m.preview || '').slice(0, 300)}`);
            });
          }
          break;

        case 'search_semantic_groups':
          if (result.results && result.results.length > 0) {
            parts.push(`找到 ${result.results.length} 个相关意群:`);
            result.results.forEach((r, idx) => {
              parts.push(`${idx + 1}. [${r.groupId}] ${r.keywords?.join('、') || ''}`);
              parts.push(`   摘要: ${(r.summary || '').slice(0, 200)}`);
            });
          } else {
            parts.push('未找到匹配的意群');
          }
          break;

        case 'fetch_group_text':
        case 'fetch':
          parts.push(`意群ID: ${result.groupId}`);
          parts.push(`详细程度: ${result.granularity || 'full'}`);
          if (result.structure) {
            parts.push(`结构信息: 章节${result.structure.sections?.length || 0}个, 图表${result.structure.figures?.length || 0}个`);
          }
          parts.push(`字符数: ${result.charCount || result.text?.length || 0}`);
          parts.push(`内容:\n${(result.text || '').slice(0, 2000)}`);
          break;

        case 'map':
          parts.push(`文档结构地图 (${result.returnedGroups}/${result.totalGroups} 个意群)`);
          if (result.docGist) {
            parts.push(`文档概要: ${result.docGist}`);
          }
          if (result.map && result.map.length > 0) {
            parts.push('\n意群列表:');
            result.map.forEach((g, idx) => {
              parts.push(`${idx + 1}. [${g.groupId}] ${g.charCount}字 - ${g.keywords?.join('、') || ''}`);
              if (g.structure) {
                const structInfo = [];
                if (g.structure.sections?.length > 0) structInfo.push(`章节${g.structure.sections.length}个`);
                if (g.structure.figures?.length > 0) structInfo.push(`图${g.structure.figures.length}个`);
                if (g.structure.formulas?.length > 0) structInfo.push(`公式${g.structure.formulas.length}个`);
                if (structInfo.length > 0) {
                  parts.push(`   结构: ${structInfo.join(', ')}`);
                }
              }
              parts.push(`   摘要: ${(g.summary || '').slice(0, 150)}`);
            });
          }
          break;

        case 'list_all_groups':
          parts.push(`共 ${result.count} 个意群:`);
          if (result.groups && result.groups.length > 0) {
            result.groups.forEach((g, idx) => {
              parts.push(`${idx + 1}. [${g.groupId}] ${g.keywords?.join('、') || ''}`);
            });
          }
          break;

        case 'grep_in_groups':
          parts.push(`搜索模式: ${result.pattern}`);
          parts.push(`匹配数量: ${result.matchCount}`);
          if (result.matches && result.matches.length > 0) {
            result.matches.slice(0, 5).forEach((m, idx) => {
              parts.push(`${idx + 1}. ${m}`);
            });
          }
          break;

        default:
          parts.push(JSON.stringify(result, null, 2).slice(0, 1000));
      }

      return parts.join('\n');
    }

    /**
     * 裁剪上下文以适应token预算
     */
    pruneContext(context, maxTokens) {
      // 简单策略：保留开头和最新的部分
      const lines = context.split('\n');
      const targetChars = Math.floor(maxTokens * 2.5); // 粗略反推字符数

      if (context.length <= targetChars) {
        return context;
      }

      // 保留前20%和后60%
      const keepStart = Math.floor(targetChars * 0.2);
      const keepEnd = Math.floor(targetChars * 0.6);

      const startPart = context.slice(0, keepStart);
      const endPart = context.slice(-keepEnd);

      return startPart + '\n\n[...中间部分已省略...]\n\n' + endPart;
    }
  }

  // 导出
  window.ReActEngine = ReActEngine;
  window.TokenBudgetManager = TokenBudgetManager;
  window.ToolRegistry = ToolRegistry;

  console.log('[ReActEngine] 模块已加载');

})(window);
