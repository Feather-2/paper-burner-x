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
      // 1. 搜索意群
      this.register({
        name: 'search_semantic_groups',
        description: '在文档的语义意群中搜索相关内容。适用于需要找到特定主题或关键词相关段落的场景。',
        parameters: {
          query: { type: 'string', description: '搜索查询，可以是关键词或问题' },
          limit: { type: 'number', description: '返回结果数量限制', default: 5 }
        },
        execute: async (params) => {
          if (!window.SemanticTools) {
            throw new Error('SemanticTools未加载');
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

      // 2. 获取意群详细内容
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

      // 3. 列出所有意群概览
      this.register({
        name: 'list_all_groups',
        description: '列出文档中所有意群的概览信息（ID、关键词、摘要）。适用于需要了解文档整体结构的场景。',
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

      // 调用LLM
      const response = await this.callLLM(systemPrompt, conversationHistory, reasoningPrompt);

      this.emit('reasoning_complete', { response });

      // 解析响应
      return this.parseReasoningResponse(response);
    }

    /**
     * 构建推理提示词
     */
    buildReasoningPrompt(context, question, toolResults) {
      const parts = [];

      // 当前上下文
      parts.push('当前已知信息:');
      parts.push(context);
      parts.push('');

      // 工具调用历史
      if (toolResults.length > 0) {
        parts.push('工具调用历史:');
        toolResults.forEach((result, idx) => {
          parts.push(`${idx + 1}. 调用 ${result.tool}(${JSON.stringify(result.params)})`);
          parts.push(`   结果: ${JSON.stringify(result.result).slice(0, 500)}`);
        });
        parts.push('');
      }

      // 可用工具
      parts.push('可用工具:');
      this.toolRegistry.getToolDefinitions().forEach(tool => {
        parts.push(`- ${tool.name}: ${tool.description}`);
      });
      parts.push('');

      // 用户问题
      parts.push('用户问题:');
      parts.push(question);
      parts.push('');

      // 推理指引
      parts.push('请按照以下格式思考并回应:');
      parts.push('1. 如果当前信息足够回答问题，返回: {"action": "answer", "thought": "你的思考过程", "answer": "最终答案"}');
      parts.push('2. 如果需要更多信息，返回: {"action": "use_tool", "thought": "你的思考过程", "tool": "工具名", "params": {参数对象}}');
      parts.push('');
      parts.push('请以JSON格式返回你的决策:');

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
     * 解析LLM的推理响应
     */
    parseReasoningResponse(response) {
      try {
        // 尝试提取JSON
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
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
          return {
            action: 'use_tool',
            thought: parsed.thought || '',
            tool: parsed.tool,
            params: parsed.params || {}
          };
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

        // 3. 执行工具调用
        if (decision.action === 'use_tool') {
          yield {
            type: 'tool_call_start',
            iteration: iterations,
            tool: decision.tool,
            params: decision.params
          };

          let toolResult;
          try {
            toolResult = await this.toolRegistry.execute(decision.tool, decision.params);
          } catch (error) {
            toolResult = {
              success: false,
              error: error.message || String(error)
            };
          }

          yield {
            type: 'tool_call_complete',
            iteration: iterations,
            tool: decision.tool,
            params: decision.params,
            result: toolResult
          };

          // 4. 更新上下文
          const newContext = this.formatToolResultForContext(decision.tool, toolResult);
          context += '\n\n' + newContext;

          toolResults.push({
            tool: decision.tool,
            params: decision.params,
            result: toolResult
          });

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
            estimatedTokens: this.budgetManager.estimate(context)
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
          parts.push(`意群ID: ${result.groupId}`);
          parts.push(`详细程度: ${result.granularity}`);
          parts.push(`内容:\n${result.text}`);
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
          parts.push(JSON.stringify(result, null, 2));
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
