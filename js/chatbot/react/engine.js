// engine.js
// 简化的 ReAct 核心引擎

(function(window) {
  'use strict';

  /**
   * ReAct 引擎核心
   * 简化版本，移除了过度复杂的规则和强制模式匹配
   */
  class ReActEngine {
    constructor(config = {}) {
      this.maxIterations = config.maxIterations || 5;
      this.budgetManager = new window.TokenBudgetManager(config.tokenBudget);
      this.toolRegistry = new window.ToolRegistry();
      this.eventHandlers = [];
      this.llmConfig = config.llmConfig || {};

      // 文档状态（由 buildInitialContext 设置）
      this.hasSemanticGroups = false;
      this.hasVectorIndex = false;
    }

    /**
     * 获取系统提示词（动态生成）
     */
    getSystemPrompt() {
      return window.SystemPromptBuilder.buildReActSystemPrompt(
        this.hasSemanticGroups,
        this.hasVectorIndex
      );
    }

    /**
     * 获取工具使用指南
     */
    getToolGuidelines(hasSemanticGroups = false, hasVectorIndex = false) {
      const availableTools = this.toolRegistry.getAvailableToolDefinitions(hasSemanticGroups, hasVectorIndex);
      const availableToolNames = availableTools.map(t => t.name).join(', ');

      console.log(`[ReActEngine] 可用工具(${availableTools.length}个): ${availableToolNames}`);

      return window.SystemPromptBuilder.buildToolGuidelines(availableTools);
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
     * 构建初始上下文（改进策略：包含文档概览）
     */
    buildInitialContext(docContent) {
      // 检测文档状态
      this.hasSemanticGroups = Array.isArray(docContent.semanticGroups) && docContent.semanticGroups.length > 0;
      this.hasVectorIndex = !!(window.data?.vectorIndex || window.data?.semanticGroups);

      console.log('[ReActEngine] 文档状态 - 意群:', this.hasSemanticGroups, ', 向量:', this.hasVectorIndex);

      // 使用 ContextBuilder 构建初始上下文
      return window.ContextBuilder.buildInitialContext(docContent);
    }

    /**
     * 检测上下文是否为空（仅包含元数据）
     */
    isContextEmpty(context) {
      if (!context || context.length < 100) return true;

      // 检测是否只包含元数据标记
      const hasMetadata = context.includes('=== DOCUMENT METADATA ===');
      const hasCritical = context.includes('=== CRITICAL ===');
      const hasActualContent = context.length > 800; // 超过800字符说明有实际内容

      return hasMetadata && hasCritical && !hasActualContent;
    }

    /**
     * 检测是否存在重复工具调用
     */
    hasRepeatedCalls(toolResults) {
      if (toolResults.length < 2) return false;

      const lastCall = toolResults[toolResults.length - 1];
      const secondLastCall = toolResults[toolResults.length - 2];

      // 检查工具名称和参数是否相同
      if (lastCall.tool !== secondLastCall.tool) return false;

      const lastParams = JSON.stringify(lastCall.params);
      const secondLastParams = JSON.stringify(secondLastCall.params);

      return lastParams === secondLastParams;
    }

    /**
     * 检测最后一次工具调用是否返回空结果
     */
    checkEmptyResults(toolResults) {
      if (toolResults.length === 0) return false;

      const lastResult = toolResults[toolResults.length - 1];

      // 检查结果是否为空
      if (!lastResult.result || !lastResult.result.success) return false;

      const results = lastResult.result.results;
      if (!results) return false;

      // 数组为空或长度为0
      return Array.isArray(results) && results.length === 0;
    }

    /**
     * 分析信息充足性
     */
    analyzeInformationSufficiency(toolResults, question) {
      if (toolResults.length === 0) return 'insufficient';

      // 计算总检索内容长度
      let totalContentLength = 0;
      let successfulCalls = 0;

      for (const result of toolResults) {
        if (result.result && result.result.success && result.result.results) {
          totalContentLength += JSON.stringify(result.result.results).length;
          if (result.result.results.length > 0) {
            successfulCalls++;
          }
        }
      }

      console.log(`[ReActEngine] 信息充足性分析 - 总内容长度: ${totalContentLength}, 成功调用: ${successfulCalls}/${toolResults.length}`);

      // 启发式判断
      if (successfulCalls >= 2 && totalContentLength > 2000) {
        return 'likely_sufficient'; // 很可能足够
      } else if (successfulCalls >= 1 && totalContentLength > 1000) {
        return 'maybe_sufficient'; // 可能足够
      } else {
        return 'insufficient'; // 不足
      }
    }

    /**
     * 推理阶段（简化版，移除所有强制性规则）
     */
    async reasoning(systemPrompt, conversationHistory, currentContext, userQuestion, toolResults = []) {
      // 构建推理提示词（简化版）
      const reasoningPrompt = this.buildReasoningPrompt(
        currentContext,
        userQuestion,
        toolResults
      );

      this.emit('reasoning_start', { prompt: reasoningPrompt });

      // 增强的系统提示词
      const enhancedSystemPrompt = systemPrompt + '\n\n' + this.getSystemPrompt();

      // 调用 LLM
      const response = await this.callLLM(enhancedSystemPrompt, conversationHistory, reasoningPrompt);

      this.emit('reasoning_complete', { response });

      // 使用增强的 JSON 解析器
      return window.ReActJsonParser.parse(response);
    }

    /**
     * 构建推理提示词（智能版，动态添加警告）
     */
    buildReasoningPrompt(context, question, toolResults) {
      const parts = [];
      const iteration = toolResults.length + 1;

      // 1. 用户问题（始终简洁）
      parts.push('========================================');
      parts.push('用户问题：');
      parts.push(question);
      parts.push('========================================');
      parts.push('');

      // 2. 当前已知信息
      parts.push('---');
      parts.push('当前已知信息:');
      parts.push(context);
      parts.push('');

      // 3. 工具调用历史（如果有）
      if (toolResults.length > 0) {
        parts.push('工具调用历史:');
        toolResults.forEach((result, idx) => {
          parts.push(`${idx + 1}. ${result.tool}(${JSON.stringify(result.params)})`);
          const resultStr = JSON.stringify(result.result);
          parts.push(`   结果: ${resultStr.length > 300 ? resultStr.slice(0, 300) + '...' : resultStr}`);
        });
        parts.push('');
      }

      // ===== 智能警告系统 =====
      const warnings = [];

      // 检测 1：首轮空上下文
      if (iteration === 1 && this.isContextEmpty(context)) {
        warnings.push('⚠️ Context is empty or contains only metadata. You MUST use a tool to retrieve information before answering.');
        console.log('[ReActEngine] 检测到首轮空上下文，添加强制检索警告');
      }

      // 检测 2：重复工具调用
      if (this.hasRepeatedCalls(toolResults)) {
        warnings.push('⚠️ You are repeating the same tool call with the same parameters. Consider trying a different tool, different parameters, or providing an answer based on available information.');
        console.log('[ReActEngine] 检测到重复工具调用，添加警告');
      }

      // 检测 3：空结果
      if (this.checkEmptyResults(toolResults)) {
        warnings.push('💡 Your last search returned no results. This may mean the information doesn\'t exist in the document, or you need different search terms. Consider answering based on available information or trying a different approach.');
        console.log('[ReActEngine] 检测到空结果，添加提示');
      }

      // 检测 4：信息充足性
      const sufficiency = this.analyzeInformationSufficiency(toolResults, question);
      if (sufficiency === 'likely_sufficient') {
        warnings.push(`💡 You have retrieved substantial information (${toolResults.length} successful tool calls, significant content). Consider whether you can answer the question now.`);
        console.log('[ReActEngine] 信息可能充足，添加提示');
      }

      // 检测 5：接近迭代上限
      if (iteration >= this.maxIterations - 1) {
        warnings.push(`🚨 You are approaching the iteration limit (${iteration}/${this.maxIterations}). If you have sufficient information, provide an answer NOW.`);
        console.log('[ReActEngine] 接近迭代上限，添加紧急警告');
      }

      // 如果有警告，插入警告区块
      if (warnings.length > 0) {
        parts.push('=== SYSTEM NOTICES ===');
        warnings.forEach(w => parts.push(w));
        parts.push('');
        console.log(`[ReActEngine] 第${iteration}轮推理，触发${warnings.length}个警告`);
      }

      // 4. 工具指南
      parts.push(this.getToolGuidelines(this.hasSemanticGroups, this.hasVectorIndex));
      parts.push('');

      // 5. 决策提示（简洁）
      parts.push('---');
      parts.push('请根据上述信息决定下一步行动：');
      parts.push('- 如果当前信息足够回答问题 → 返回答案');
      parts.push('- 如果需要更多信息 → 调用工具检索');
      parts.push('');
      parts.push('返回 JSON 格式的决策：');
      parts.push('');

      return parts.join('\n');
    }

    /**
     * 调用 LLM
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
     * 执行 ReAct 循环（核心流程）
     */
    async *run(userQuestion, docContent, systemPrompt, conversationHistory = []) {
      this.emit('session_start', { question: userQuestion });

      // 构建初始上下文
      let context = this.buildInitialContext(docContent);
      const toolResults = [];
      let iterations = 0;

      console.log('[ReActEngine] 初始上下文长度:', context.length);

      yield { type: 'context_initialized', context: context.slice(0, 500) + '...' };

      while (iterations < this.maxIterations) {
        iterations++;

        yield { type: 'iteration_start', iteration: iterations, maxIterations: this.maxIterations };
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

        // 判断是回答还是使用工具
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

        // 执行工具调用（支持并行）
        if (decision.action === 'use_tool') {
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

          // 更新上下文
          for (const call of completedCalls) {
            const newContext = window.ContextBuilder.formatToolResult(call.tool, call.result);
            context += '\n\n' + newContext;

            toolResults.push({
              tool: call.tool,
              params: call.params,
              result: call.result
            });
          }

          // Token预算检查
          const contextTokens = this.budgetManager.estimate(context);
          const budgetLimit = this.budgetManager.allocation.context;

          if (contextTokens > budgetLimit) {
            yield {
              type: 'context_pruned',
              before: contextTokens,
              after: budgetLimit,
              iteration: iterations
            };
            context = window.ContextBuilder.pruneContext(context, budgetLimit);
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

      // 达到最大迭代次数
      yield {
        type: 'max_iterations_reached',
        iterations: this.maxIterations,
        toolCallCount: toolResults.length
      };

      const fallbackAnswer = `经过 ${iterations} 轮推理，我收集到了一些信息，但未能在迭代限制内得出完整答案。\n\n基于当前信息：\n\n${context.slice(0, 2000)}\n\n建议：\n1. 提供更具体的问题\n2. 或尝试增加迭代次数限制`;

      yield {
        type: 'final_answer',
        answer: fallbackAnswer,
        iterations: iterations,
        toolCallCount: toolResults.length,
        fallback: true
      };

      this.emit('session_complete', { answer: fallbackAnswer, iterations, fallback: true });
    }
  }

  // 导出到全局
  window.ReActEngine = ReActEngine;

  console.log('[ReActEngine] 核心引擎已加载');

})(window);
