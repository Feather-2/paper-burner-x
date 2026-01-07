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
      this.hasChunks = false;

      // 去重：记录已检索过的内容片段（避免重复展示）
      this.seenContentHashes = new Set();
      this.seenContentSummaries = new Map(); // hash -> summary
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
    getToolGuidelines(hasSemanticGroups = false, hasVectorIndex = false, hasChunks = false) {
      const availableTools = this.toolRegistry.getAvailableToolDefinitions(hasSemanticGroups, hasVectorIndex, hasChunks);
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
      this.hasSemanticGroups = (
        (Array.isArray(docContent.semanticGroups) && docContent.semanticGroups.length > 0) ||
        (Array.isArray(window.data?.semanticGroups) && window.data.semanticGroups.length > 0)
      );
      this.hasVectorIndex = !!(
        docContent.vectorIndexReady ||
        docContent.vectorIndex ||
        window.data?.vectorIndexReady ||
        window.data?.vectorIndex
      );
      this.hasChunks = !!(
        (Array.isArray(docContent.translatedChunks) && docContent.translatedChunks.length > 0) ||
        (Array.isArray(docContent.ocrChunks) && docContent.ocrChunks.length > 0) ||
        (docContent.translation && docContent.translation.length > 0) ||
        (docContent.ocr && docContent.ocr.length > 0) ||
        (Array.isArray(window.data?.translatedChunks) && window.data.translatedChunks.length > 0) ||
        (Array.isArray(window.data?.ocrChunks) && window.data.ocrChunks.length > 0) ||
        (window.data?.translation && window.data.translation.length > 0) ||
        (window.data?.ocr && window.data.ocr.length > 0)
      );

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
     * 分析信息充足性（修复：支持 grep 的 matches 字段）
     */
    analyzeInformationSufficiency(toolResults, question) {
      if (toolResults.length === 0) return 'insufficient';

      // 计算总检索内容长度
      let totalContentLength = 0;
      let successfulCalls = 0;
      let itemsFound = 0;

      for (const result of toolResults) {
        if (!result.result || !result.result.success) continue;

        // 支持不同工具的返回格式
        let items = null;
        if (result.result.results) {
          // vector_search, keyword_search, search_semantic_groups
          items = result.result.results;
        } else if (result.result.matches) {
          // grep, regex_search
          items = result.result.matches;
        } else if (result.result.text) {
          // fetch, fetch_group_text
          items = [{ text: result.result.text }];
        }

        if (items && items.length > 0) {
          totalContentLength += JSON.stringify(items).length;
          successfulCalls++;
          itemsFound += items.length;
        }
      }

      console.log(`[ReActEngine] 信息充足性分析 - 总内容长度: ${totalContentLength}, 成功调用: ${successfulCalls}/${toolResults.length}, 检索到 ${itemsFound} 条结果`);

      // 启发式判断（更宽松的阈值，因为去重后内容会减少）
      if (successfulCalls >= 2 && totalContentLength > 1500) {
        return 'likely_sufficient'; // 很可能足够
      } else if (successfulCalls >= 1 && totalContentLength > 800) {
        return 'maybe_sufficient'; // 可能足够
      } else {
        return 'insufficient'; // 不足
      }
    }

    /**
     * 总结已检索的内容（用于警告提示）
     */
    summarizeRetrievedContent(toolResults) {
      const summaryParts = [];
      let totalItems = 0;

      for (const result of toolResults) {
        if (!result.result || !result.result.success) continue;

        const tool = result.tool;
        let count = 0;

        if (result.result.results) {
          count = result.result.results.length;
        } else if (result.result.matches) {
          count = result.result.matches.length;
        } else if (result.result.text) {
          count = 1;
        }

        if (count > 0) {
          totalItems += count;
          summaryParts.push(`${count} items from ${tool}`);
        }
      }

      if (summaryParts.length === 0) {
        return 'No content retrieved yet';
      }

      return `${totalItems} total items (${summaryParts.join(', ')})`;
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

      // 检测 1：首轮强制检索（更严格）
      if (iteration === 1) {
        warnings.push('🚨 CRITICAL - FIRST ITERATION:');
        warnings.push('   - The context contains NO document content, only metadata');
        warnings.push('   - You MUST call a tool in this iteration');
        warnings.push('   - DO NOT return action: "answer" in the first iteration');
        warnings.push('   - DO NOT ask the user for more details');
        warnings.push('   - Choose appropriate search keywords based on the question and start retrieving');
        console.log('[ReActEngine] 首轮迭代，强制要求调用工具');
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

      // 检测 4：信息充足性（强化版 - 明确告诉 LLM 已检索到什么）
      const sufficiency = this.analyzeInformationSufficiency(toolResults, question);
      if (sufficiency === 'likely_sufficient' || sufficiency === 'maybe_sufficient') {
        const summary = this.summarizeRetrievedContent(toolResults);
        warnings.push(`💡 INFORMATION RETRIEVED SUMMARY:`);
        warnings.push(`   - You have made ${toolResults.length} tool calls`);
        warnings.push(`   - Retrieved content includes: ${summary}`);
        warnings.push(`   - CRITICAL: Review the "当前已知信息" section above`);
        warnings.push(`   - If the information is sufficient to answer the question, provide an answer NOW`);
        warnings.push(`   - DO NOT say "文档内容尚未加载" if you can see content above`);
        console.log('[ReActEngine] 信息可能充足，添加强化提示');
      }

      // 检测 5：接近迭代上限
      if (iteration >= this.maxIterations - 1) {
        warnings.push(`🚨 FINAL ITERATION WARNING:`);
        warnings.push(`   - This is iteration ${iteration}/${this.maxIterations}`);
        warnings.push(`   - You MUST provide an answer based on available information`);
        warnings.push(`   - Even partial information is better than no answer`);
        warnings.push(`   - DO NOT end without attempting to answer`);
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
      parts.push(this.getToolGuidelines(this.hasSemanticGroups, this.hasVectorIndex, this.hasChunks));
      parts.push('');

      // 5. 决策提示（根据迭代轮次调整）
      parts.push('---');
      if (iteration === 1) {
        parts.push('**第一轮决策（必须调用工具）**：');
        parts.push('- 分析用户问题，提取关键概念');
        parts.push('- 选择合适的工具和检索关键词');
        parts.push('- 返回 JSON 格式：{ "action": "use_tool", "thought": "...", "tool": "...", "params": {...} }');
      } else {
        parts.push('**后续轮次决策**：');
        parts.push('- 如果检索到的内容足够回答问题 → 返回答案');
        parts.push('- 如果需要更多信息 → 继续调用工具检索');
        parts.push('- 返回 JSON 格式的决策');
      }
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
      const reactLog = []; // Store the execution log

      console.log('[ReActEngine] 初始上下文长度:', context.length);

      yield { type: 'context_initialized', context: context.slice(0, 500) + '...', reactLog };

      while (iterations < this.maxIterations) {
        iterations++;

        const iterationPayload = { type: 'iteration_start', iteration: iterations, maxIterations: this.maxIterations };
        yield iterationPayload;
        this.emit('iteration_start', iterationPayload);
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
          this.emit('error', { error: error.message || String(error), iteration: iterations });
          yield {
            type: 'error',
            error: '推理失败: ' + (error.message || String(error)),
            iteration: iterations
          };
          break;
        }

        if (decision.thought) {
            reactLog.push({
                type: 'thought',
                iteration: iterations,
                content: decision.thought
            });
        }

        yield {
          type: 'reasoning_complete',
          iteration: iterations,
          thought: decision.thought,
          action: decision.action,
          reactLog
        };

        // 判断是回答还是使用工具
        if (decision.action === 'answer') {
          const finalPayload = {
            type: 'final_answer',
            answer: decision.answer,
            iterations: iterations,
            toolCallCount: toolResults.length,
            reactLog
          };
          yield finalPayload;
          this.emit('final_answer', finalPayload);
          this.emit('session_complete', { answer: decision.answer, iterations, reactLog });
          return;
        }

        // 执行工具调用（支持并行）
        if (decision.action === 'use_tool') {
          const toolCalls = decision.parallel
            ? decision.tool_calls
            : [{ tool: decision.tool, params: decision.params }];

          // 发送工具调用开始事件
          for (const call of toolCalls) {
            reactLog.push({
                type: 'action',
                iteration: iterations,
                tool: call.tool,
                params: call.params
            });

            const startPayload = {
              type: 'tool_call_start',
              iteration: iterations,
              tool: call.tool,
              params: call.params,
              parallel: decision.parallel,
              totalCalls: toolCalls.length,
              reactLog
            };
            yield startPayload;
            this.emit('tool_call_start', startPayload);
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
            reactLog.push({
                type: 'observation',
                iteration: iterations,
                result: call.result
            });

            const completePayload = {
              type: 'tool_call_complete',
              iteration: iterations,
              tool: call.tool,
              params: call.params,
              result: call.result,
              parallel: decision.parallel,
              reactLog
            };
            yield completePayload;
            this.emit('tool_call_complete', completePayload);
          }

          // 更新上下文（支持去重）
          for (const call of completedCalls) {
            const newContext = window.ContextBuilder.formatToolResult(
              call.tool,
              call.result,
              this.seenContentHashes,
              this.seenContentSummaries
            );
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
            const prunedPayload = {
              type: 'context_pruned',
              before: contextTokens,
              after: budgetLimit,
              iteration: iterations
            };
            yield prunedPayload;
            this.emit('context_pruned', prunedPayload);
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

      const fallbackPayload = {
        type: 'final_answer',
        answer: fallbackAnswer,
        iterations: iterations,
        toolCallCount: toolResults.length,
        fallback: true,
        reactLog
      };
      yield fallbackPayload;
      this.emit('final_answer', fallbackPayload);

      this.emit('session_complete', { answer: fallbackAnswer, iterations, fallback: true, reactLog });
    }
  }

  // 导出到全局
  window.ReActEngine = ReActEngine;

  console.log('[ReActEngine] 核心引擎已加载');

})(window);

// ESM 导出
export { ReActEngine };
