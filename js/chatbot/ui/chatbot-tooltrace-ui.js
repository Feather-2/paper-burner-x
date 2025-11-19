// js/chatbot/ui/chatbot-tooltrace-ui.js
// 工具调用UI - 生成HTML嵌入到AI消息中
(function(window, document) {
  'use strict';

  if (window.ChatbotToolTraceUIScriptLoaded) return;

  var stylesInjected = false;
  var currentStepsHtml = []; // 存储步骤HTML字符串
  var batchBuffer = null;
  var batchTimer = null;
  var isFinished = false;
  var isCollapsed = false; // 默认展开，避免更新时自动收起

  function injectStyles() {
    if (stylesInjected) return;
    var style = document.createElement('style');
    style.textContent = `
      /* 工具调用思考块 - 系统日志风格 */
      .tool-thinking-block {
        background: transparent;
        border-left: 3px solid #e2e8f0;
        margin-bottom: 16px;
        margin-top: 16px;
        padding-left: 16px;
        transition: all 0.3s ease;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      }

      .tool-thinking-block:hover {
        border-left-color: #cbd5e1;
      }

      .tool-thinking-block.collapsed .tool-thinking-body {
        display: none;
      }

      /* 头部 */
      .tool-thinking-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0;
        cursor: pointer;
        user-select: none;
        transition: all 0.2s;
        color: #64748b;
      }

      .tool-thinking-header:hover {
        color: #334155;
      }

      .tool-thinking-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
      }

      .tool-thinking-icon-wrapper {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 4px;
        background: #f1f5f9;
        color: #64748b;
        transition: all 0.3s;
      }

      .tool-thinking-icon-wrapper.running {
        background: #dbeafe;
        color: #2563eb;
      }
      
      .tool-thinking-icon-wrapper.done {
        background: #dcfce7;
        color: #16a34a;
      }

      .tool-thinking-icon-wrapper svg {
        width: 12px;
        height: 12px;
      }

      .tool-thinking-icon-wrapper.running svg {
        animation: spin 2s linear infinite;
      }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .tool-thinking-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: #94a3b8;
        padding: 2px 6px;
        border-radius: 4px;
        transition: all 0.2s;
      }
      
      .tool-thinking-header:hover .tool-thinking-toggle {
        background: #f1f5f9;
        color: #64748b;
      }

      .tool-thinking-toggle .toggle-arrow {
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: inline-block;
        font-size: 10px;
      }

      .tool-thinking-block.collapsed .tool-thinking-toggle .toggle-arrow {
        transform: rotate(-90deg);
      }

      /* 内容区 - 紧凑日志布局 */
      .tool-thinking-body {
        padding: 8px 0;
        max-height: 400px;
        overflow-y: auto;
        position: relative;
      }

      .tool-thinking-body::-webkit-scrollbar {
        width: 4px;
      }

      .tool-thinking-body::-webkit-scrollbar-track {
        background: transparent;
      }

      .tool-thinking-body::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 2px;
      }
      
      .tool-thinking-body::-webkit-scrollbar-thumb:hover {
        background: #94a3b8;
      }

      /* 步骤项 */
      .tool-step {
        display: flex;
        gap: 10px;
        margin-bottom: 8px;
        position: relative;
        z-index: 1;
        animation: slideIn 0.2s ease-out forwards;
        padding: 6px 8px;
        border-radius: 6px;
        transition: background 0.2s;
      }
      
      .tool-step:hover {
        background: #f8fafc;
      }
      
      @keyframes slideIn {
        from { opacity: 0; transform: translateX(-5px); }
        to { opacity: 1; transform: translateX(0); }
      }

      .tool-step:last-child {
        margin-bottom: 0;
      }

      .tool-step-indicator {
        flex-shrink: 0;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #94a3b8;
        margin-top: 2px;
      }

      .tool-step.running .tool-step-indicator {
        color: #3b82f6;
      }

      .tool-step.done .tool-step-indicator {
        color: #10b981;
      }

      .tool-step.error .tool-step-indicator {
        color: #ef4444;
      }

      .tool-step-indicator svg {
        width: 12px;
        height: 12px;
      }

      .tool-step-content {
        flex: 1;
        min-width: 0;
      }

      .tool-step-main {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }

      .tool-step-title {
        flex: 1;
        font-weight: 500;
        color: #475569;
        font-size: 12px;
        line-height: 1.5;
        font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
      }
      
      .tool-step.running .tool-step-title {
        color: #2563eb;
      }
      
      .tool-step.error .tool-step-title {
        color: #dc2626;
      }

      .tool-step-detail-toggle {
        background: transparent;
        border: none;
        font-size: 10px;
        color: #94a3b8;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 4px;
        transition: all 0.2s;
        white-space: nowrap;
      }

      .tool-step-detail-toggle:hover {
        background: #e2e8f0;
        color: #475569;
      }
      
      .tool-step.detail-open .tool-step-detail-toggle {
        background: #e2e8f0;
        color: #475569;
        font-weight: 600;
      }

      .tool-step-detail {
        display: none;
        margin-top: 6px;
        padding: 8px;
        background: #f1f5f9;
        border-radius: 4px;
        font-size: 11px;
        color: #475569;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
        line-height: 1.5;
        border-left: 2px solid #cbd5e1;
      }

      .tool-step.detail-open .tool-step-detail {
        display: block;
        animation: fadeIn 0.2s ease-out;
      }
      
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      /* 状态标签 */
      .step-tag {
        display: inline-block;
        padding: 0 4px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: normal;
        margin-left: 6px;
        vertical-align: middle;
        opacity: 0.8;
      }
      
      .step-tag.tokens {
        background: #e2e8f0;
        color: #64748b;
      }
      
      .step-tag.score {
        background: #ffedd5;
        color: #c2410c;
      }
    `;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  /**
   * 开始新的工具调用会话
   */
  function startSession() {
    // console.log('[ToolTraceUI] startSession 调用');
    injectStyles();
    currentStepsHtml = [];
    isFinished = false;
    isCollapsed = false; // 重置为展开
    batchBuffer = null;
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }

    // 提前插入一个初始化步骤，避免初次渲染为空
    try {
      addStepHtml({
        tool: 'preload',
        message: '准备检索上下文...',
        args: {}
      }, 'running');
    } catch (_) { /* ignore */ }
  }

  /**
   * 添加步骤HTML
   */
  function addStepHtml(stepInfo, status) {
    status = status || 'running';
    // 动态选择tool名称（如果是带重排的向量搜索，使用特殊tool名）
    var toolName = stepInfo.tool;
    if (stepInfo.tool === 'vector_search' && stepInfo.result && Array.isArray(stepInfo.result) &&
        stepInfo.result.length > 0 && stepInfo.result[0].rerankScore !== undefined) {
      toolName = 'vector_search_rerank';
    }
    var icon = getStepIcon(toolName);
    var title = getStepTitle(stepInfo);
    var detail = formatDetail(stepInfo.args || {});

    var stepHtml = `
      <div class="tool-step ${status}">
        <div class="tool-step-indicator">${icon}</div>
        <div class="tool-step-content">
          <div class="tool-step-main">
            <span class="tool-step-title">${escapeHtml(title)}</span>
            <button class="tool-step-detail-toggle" onclick="this.closest('.tool-step').classList.toggle('detail-open')">详情</button>
          </div>
          <div class="tool-step-detail">${escapeHtml(detail)}</div>
        </div>
      </div>
    `;

    currentStepsHtml.push(stepHtml);
  }

  /**
   * 更新最后一个步骤的状态
   */
  function updateLastStepStatus(status, result) {
    if (currentStepsHtml.length === 0) return;

    var lastIdx = currentStepsHtml.length - 1;
    var lastHtml = currentStepsHtml[lastIdx];

    // 替换status class
    lastHtml = lastHtml.replace(/class="tool-step (running|done|error)"/, 'class="tool-step ' + status + '"');

    // 如果有tokens信息，更新标题添加token统计
    if (result && result._tokens && status === 'done') {
      var tokenHtml = ' <span class="step-tag tokens">' + result._tokens + ' tok</span>';
      lastHtml = lastHtml.replace(/(<span class="tool-step-title">[\s\S]*?)(<\/span>)/, '$1' + tokenHtml + '$2');
    }

    // 更新detail
    if (result) {
      var detail = formatDetail(result);
      lastHtml = lastHtml.replace(/<div class="tool-step-detail">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
        '<div class="tool-step-detail">' + escapeHtml(detail) + '</div></div></div>');
    }

    currentStepsHtml[lastIdx] = lastHtml;
  }

  /**
   * 生成完整的thinking块HTML
   */
  function generateBlockHtml() {
    var stepCount = currentStepsHtml.length;
    var iconClass = isFinished ? 'done' : 'running';
    var title = isFinished ? '思考过程已完成' : '正在思考中...';
    var collapsedClass = isCollapsed ? 'collapsed' : '';
    
    // 顶部图标
    var headerIcon = isFinished
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';

    if (currentStepsHtml.length === 0) {
      return '';
    }

    // 使用全局变量 isCollapsed 控制状态，并添加 onclick 事件来切换该变量
    // 注意：这里我们使用 window.ChatbotToolTraceUI.toggleCollapse 来切换状态，而不是直接操作 DOM
    // 这样可以确保状态同步
    
    // 为了支持 onclick 调用，我们需要暴露一个 toggle 方法
    if (!window.ChatbotToolTraceUI.toggleCollapse) {
      window.ChatbotToolTraceUI.toggleCollapse = function(el) {
        isCollapsed = !isCollapsed;
        var block = el.closest('.tool-thinking-block');
        if (isCollapsed) {
          block.classList.add('collapsed');
        } else {
          block.classList.remove('collapsed');
        }
      };
    }

    var html = `
      <div class="tool-thinking-block ${collapsedClass}">
        <div class="tool-thinking-header" onclick="window.ChatbotToolTraceUI.toggleCollapse(this)">
          <div class="tool-thinking-title">
            <div class="tool-thinking-icon-wrapper ${iconClass}">
              ${headerIcon}
            </div>
            <span>${title}</span>
          </div>
          <div class="tool-thinking-toggle">
            <span>${stepCount} 步骤</span>
            <span class="toggle-arrow">▼</span>
          </div>
        </div>
        <div class="tool-thinking-body">
          ${currentStepsHtml.join('')}
        </div>
      </div>
    `;

    return html;
  }

  /**
   * 刷新批量缓冲区
   */
  function flushBatchBuffer() {
    if (!batchBuffer) return;

    var items = batchBuffer.items;
    var tool = batchBuffer.tool;

    if (tool === 'fetch_group') {
      var groupIds = items.map(function(item) { return item.groupId; });

      // 优化显示：如果groupId太多，只显示前3个和总数
      var displayText;
      if (groupIds.length > 5) {
        displayText = '获取意群详情: ' + groupIds.slice(0, 3).join(', ') + ' 等' + groupIds.length + '个';
      } else {
        displayText = '获取意群详情: ' + groupIds.join(', ');
      }

      var detail = formatDetail({
        tool: tool,
        count: items.length,
        groups: groupIds
      });

      addStepHtml({
        tool: tool,
        customTitle: displayText,
        args: { count: items.length, groups: groupIds }
      }, 'done');
    }

    batchBuffer = null;
  }

  /**
   * 处理流式事件
   */
  function handleStreamEvent(event) {
    // console.log('[ToolTraceUI] handleStreamEvent:', event.type, event);

    switch (event.type) {
      case 'status':
        if (event.phase === 'preload' || event.phase === 'planning') {
          flushBatchBuffer();
          addStepHtml({
            tool: event.phase,
            message: event.message,
            args: {}
          }, 'running');
        }
        break;

      case 'round_start':
        flushBatchBuffer();
        addStepHtml({
          tool: 'round',
          round: event.round,
          args: { round: event.round + 1 }
        }, 'running');
        updateLastStepStatus('done', { message: '开始取材...' });
        break;

      case 'plan':
        flushBatchBuffer();
        if (currentStepsHtml.length > 0) {
          const planInfo = {
            operations: event.data.operations.length + ' 个操作',
            final: event.data.final
          };
          // 如果有taskStatus，追加到显示信息中
          if (event.data.taskStatus && event.data.taskStatus.current) {
            planInfo.task = event.data.taskStatus.current;
          }
          updateLastStepStatus('done', planInfo);
        }
        break;

      case 'task_status':
        // 展示任务追踪状态
        flushBatchBuffer();
        const taskStatus = event.status || {};
        const taskParts = [];

        if (Array.isArray(taskStatus.completed) && taskStatus.completed.length > 0) {
          taskParts.push('已完成: ' + taskStatus.completed.join('; '));
        }
        if (taskStatus.current) {
          taskParts.push('当前: ' + taskStatus.current);
        }
        if (Array.isArray(taskStatus.pending) && taskStatus.pending.length > 0) {
          taskParts.push('待办: ' + taskStatus.pending.join('; '));
        }

        if (taskParts.length > 0) {
          addStepHtml({
            tool: 'task_status',
            message: '任务追踪',
            args: { status: taskParts.join(' | ') }
          }, 'done');
        }
        break;

      case 'tool_start':
        if (batchTimer) {
          clearTimeout(batchTimer);
          batchTimer = null;
        }

        // 批量合并fetch_group
        if (event.tool === 'fetch_group' && event.args && event.args.groupId) {
          if (batchBuffer && batchBuffer.tool === 'fetch_group') {
            batchBuffer.items.push({
              groupId: event.args.groupId,
              granularity: event.args.granularity
            });
          } else {
            flushBatchBuffer();
            batchBuffer = {
              tool: 'fetch_group',
              items: [{
                groupId: event.args.groupId,
                granularity: event.args.granularity
              }]
            };
          }
          batchTimer = setTimeout(flushBatchBuffer, 100);
        } else {
          flushBatchBuffer();
          addStepHtml({
            tool: event.tool,
            args: event.args
          }, 'running');
        }
        break;

      case 'tool_result':
        if (batchTimer) {
          clearTimeout(batchTimer);
          batchTimer = null;
        }
        flushBatchBuffer();
        // 保存tokens信息供标题使用
        var resultData = event.result || {};
        if (event.tokens) {
          resultData._tokens = event.tokens;
        }
        updateLastStepStatus('done', resultData);
        break;

      case 'token_usage':
        // 展示规划器token使用
        addStepHtml({
          tool: 'planning',
          customTitle: `AI规划器 (输入: ${event.tokens.input}tok, 输出: ${event.tokens.output}tok, 共: ${event.tokens.total}tok)`,
          args: {}
        }, 'done');
        break;

      case 'tool_error':
        flushBatchBuffer();
        updateLastStepStatus('error', { error: event.error });
        break;

      case 'tool_skip':
        // 静默处理，不显示
        break;

      case 'round_end':
        flushBatchBuffer();
        if (currentStepsHtml.length > 0) {
          if (event.final) {
            updateLastStepStatus('done', { message: '✓ 取材完成' });
          } else {
            updateLastStepStatus('done', { message: '→ 继续下一轮' });
          }
        }
        break;

      case 'complete':
        flushBatchBuffer();
        isFinished = true;
        // 展示最终token统计
        if (event.summary && event.summary.stats && event.summary.stats.finalContextTokens) {
          addStepHtml({
            tool: 'info',
            customTitle: `✓ 最终上下文 (共 ${event.summary.stats.finalContextTokens} tokens)`,
            args: {}
          }, 'done');
        }
        break;

      case 'info':
        flushBatchBuffer();
        addStepHtml({
          tool: 'info',
          message: event.message,
          args: {}
        }, 'running');
        updateLastStepStatus('done', { message: event.message });
        break;

      case 'error':
      case 'warning':
        flushBatchBuffer();
        addStepHtml({
          tool: event.type,
          message: event.message,
          args: {}
        }, 'running');
        updateLastStepStatus('error', { error: event.message });
        break;
    }
  }

  /**
   * 处理ReAct事件（新增）
   */
  // 并行工具调用追踪（用于匹配 start 和 complete 事件）
  var parallelCallsTracker = {};

  function handleReActEvent(event) {
    if (!event || !event.type) return;

    switch (event.type) {
      case 'context_initialized':
        addStepHtml({
          tool: 'preload',
          message: '初始化上下文',
          args: { preview: event.context ? event.context.slice(0, 100) : '' }
        }, 'done');
        break;

      case 'iteration_start':
        // 重置并行调用追踪
        parallelCallsTracker = {};
        addStepHtml({
          tool: 'round',
          message: `第 ${event.iteration}/${event.maxIterations} 轮推理`,
          args: { iteration: event.iteration, maxIterations: event.maxIterations }
        }, 'running');
        break;

      case 'reasoning_start':
        // 静默处理，不单独显示
        break;

      case 'reasoning_complete':
        if (currentStepsHtml.length > 0) {
          const thoughtPreview = event.thought ? event.thought.slice(0, 100) : '';
          updateLastStepStatus('done', {
            thought: thoughtPreview,
            action: event.action
          });
        }
        break;

      case 'tool_call_start':
        // 并行工具调用：显示组标题（只在第一个工具时）
        if (event.parallel && event.totalCalls > 1) {
          const trackKey = `iter_${event.iteration}`;
          if (!parallelCallsTracker[trackKey]) {
            parallelCallsTracker[trackKey] = {
              totalCalls: event.totalCalls,
              completedCalls: 0,
              startIndex: currentStepsHtml.length
            };
            addStepHtml({
              tool: 'parallel',
              message: `🔀 并行调用 ${event.totalCalls} 个工具`,
              args: { totalCalls: event.totalCalls }
            }, 'running');
          }
        }

        // 添加工具调用步骤
        const toolMessage = event.parallel
          ? `  ├─ ${event.tool}`
          : `调用工具: ${event.tool}`;
        addStepHtml({
          tool: event.tool,
          message: toolMessage,
          args: event.params || {},
          parallel: event.parallel || false,
          toolName: event.tool // 用于匹配 complete 事件
        }, 'running');
        break;

      case 'tool_call_complete':
        // 查找对应的 tool_call_start 步骤并更新
        const result = event.result || {};
        const status = result.success === false ? 'error' : 'done';

        // 从后往前找到匹配的工具步骤
        for (let i = currentStepsHtml.length - 1; i >= 0; i--) {
          const step = currentStepsHtml[i];
          if (step.toolName === event.tool && step.status === 'running') {
            // 更新这个步骤的状态
            currentStepsHtml[i].status = status;
            currentStepsHtml[i].result = result;

            // 如果是并行调用，更新计数
            if (event.parallel) {
              const trackKey = `iter_${event.iteration}`;
              if (parallelCallsTracker[trackKey]) {
                parallelCallsTracker[trackKey].completedCalls++;

                // 所有并行工具都完成了，更新组标题状态
                if (parallelCallsTracker[trackKey].completedCalls === parallelCallsTracker[trackKey].totalCalls) {
                  const groupIndex = parallelCallsTracker[trackKey].startIndex;
                  if (currentStepsHtml[groupIndex]) {
                    currentStepsHtml[groupIndex].status = 'done';
                    currentStepsHtml[groupIndex].message = `🔀 并行调用完成 (${parallelCallsTracker[trackKey].totalCalls} 个工具)`;
                  }
                }
              }
            }

            // 重新渲染
            renderSteps();
            break;
          }
        }
        break;

      case 'context_updated':
        const parallelInfo = event.parallelCallsCount > 0
          ? ` [并行${event.parallelCallsCount}个工具]`
          : '';
        addStepHtml({
          tool: 'info',
          message: `上下文更新 (${event.contextSize} 字符, ~${event.estimatedTokens} tokens)${parallelInfo}`,
          args: {}
        }, 'done');
        break;

      case 'context_pruned':
        addStepHtml({
          tool: 'warning',
          message: `上下文裁剪 (${event.before} → ${event.after} tokens)`,
          args: {}
        }, 'done');
        break;

      case 'final_answer':
        isFinished = true;
        const suffix = event.fallback ? ' (降级回答)' : '';
        addStepHtml({
          tool: 'info',
          customTitle: `✓ 完成推理${suffix} (${event.iterations} 轮, ${event.toolCallCount} 次工具调用)`,
          args: {}
        }, 'done');
        break;

      case 'max_iterations_reached':
        isFinished = true;
        addStepHtml({
          tool: 'warning',
          message: `达到最大迭代次数 (${event.iterations} 轮, ${event.toolCallCount} 次工具调用)`,
          args: {}
        }, 'error');
        break;

      case 'error':
        addStepHtml({
          tool: 'error',
          message: event.error || '未知错误',
          args: {}
        }, 'error');
        break;
    }
  }

  /**
   * 获取步骤图标（SVG）
   */
  function getStepIcon(tool) {
    var icons = {
      'vector_search': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>',
      'vector_search_rerank': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path><path d="M7 13l3-3 3 3" stroke="#059669"></path></svg>',
      'keyword_search': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h6"/><path d="M3 17h6"/><path d="m15 6 6 6-6 6"/></svg>',
      'fetch_group': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
      'fetch': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
      'map': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 9 2 15 6 23 2 23 18 15 22 9 18 1 22 1 6"/></svg>',
      'grep': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
      'parallel': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18V6H7v12"/><path d="M17 6l4 4-4 4"/><path d="M7 18l-4-4 4-4"/></svg>',
      'preload': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      'planning': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
      'round': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
      'task_status': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
      'info': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
      'warning': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
      'error': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>'
    };
    return icons[tool] || '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>';
  }

  /**
   * 获取步骤标题
   */
  function getStepTitle(stepInfo) {
    if (stepInfo.customTitle) return stepInfo.customTitle;

    var titles = {
      'vector_search': '向量搜索',
      'vector_search_rerank': '向量搜索+重排',
      'keyword_search': '关键词搜索',
      'fetch_group': '获取意群详情',
      'fetch': '获取意群详情',
      'map': '获取意群地图',
      'grep': '全文短语搜索',
      'parallel': '并行工具调用',
      'preload': '预加载意群',
      'planning': 'AI规划工具调用',
      'round': '第' + ((stepInfo.round || 0) + 1) + '轮取材',
      'task_status': '任务追踪',
      'info': '信息',
      'warning': '警告',
      'error': '错误'
    };

    var title = titles[stepInfo.tool || stepInfo.phase] || stepInfo.message || '执行中';

    // 添加参数信息
    if (stepInfo.tool === 'vector_search' && stepInfo.args && stepInfo.args.query) {
      // 检查是否使用了重排（通过result判断）
      if (stepInfo.result && Array.isArray(stepInfo.result) && stepInfo.result.length > 0 && stepInfo.result[0].rerankScore !== undefined) {
        title = '向量搜索+重排';
      }
      var query = stepInfo.args.query.substring(0, 30);
      if (stepInfo.args.query.length > 30) query += '...';
      title += ': ' + query;
    } else if (stepInfo.tool === 'grep' && stepInfo.args && stepInfo.args.query) {
      var gq = stepInfo.args.query.substring(0, 30);
      if (stepInfo.args.query.length > 30) gq += '...';
      title += ': ' + gq;
    } else if (stepInfo.tool === 'keyword_search' && stepInfo.args && stepInfo.args.keywords) {
      var keywords = stepInfo.args.keywords || [];
      title += ': ' + (Array.isArray(keywords) ? keywords.join(', ') : keywords);
    } else if ((stepInfo.tool === 'fetch_group' || stepInfo.tool === 'fetch') && stepInfo.args && stepInfo.args.groupId) {
      title += ': ' + stepInfo.args.groupId;
    }

    return title;
  }

  /**
   * 格式化详情
   */
  function formatDetail(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();

    // 提取并移除tokens信息（已在标题中显示）
    var tokens = value._tokens;
    var cleanValue = Object.assign({}, value);
    delete cleanValue._tokens;

    // 特殊处理：空数组
    if (Array.isArray(cleanValue) && cleanValue.length === 0) {
      return '无结果';
    }

    // 特殊处理：向量搜索结果
    // 支持数组格式和对象格式（如 {"0": {...}, "1": {...}}）
    var searchResults = null;
    if (Array.isArray(cleanValue) && cleanValue.length > 0 && cleanValue[0].chunkId && cleanValue[0].score !== undefined) {
      searchResults = cleanValue;
    } else if (typeof cleanValue === 'object' && !Array.isArray(cleanValue) && Object.keys(cleanValue).length > 0) {
      // 检查是否是对象格式的搜索结果（键为数字字符串）
      var firstKey = Object.keys(cleanValue)[0];
      var firstItem = cleanValue[firstKey];
      if (firstItem && firstItem.chunkId && firstItem.score !== undefined) {
        // 转换为数组格式
        searchResults = Object.keys(cleanValue).map(function(key) {
          return cleanValue[key];
        });
      }
    }

    if (searchResults) {
      // 检查是否使用了重排
      var hasRerank = searchResults[0].rerankScore !== undefined;

      var summary = searchResults.length + ' 个结果';
      if (hasRerank) {
        summary += ' (已重排)';
      }

      var topGroups = {};
      searchResults.forEach(function(item) {
        if (item.belongsToGroup) {
          topGroups[item.belongsToGroup] = true;
        }
      });
      var groupCount = Object.keys(topGroups).length;
      if (groupCount > 0) {
        summary += '，涉及 ' + groupCount + ' 个意群';
      }

      if (hasRerank) {
        summary += '，最高重排分: ' + searchResults[0].rerankScore.toFixed(3);
        summary += ' (原始分: ' + (searchResults[0].originalScore || searchResults[0].score).toFixed(3) + ')';
      } else {
        summary += '，最高分: ' + searchResults[0].score.toFixed(3);
      }

      // 添加前3个结果的预览
      if (searchResults.length > 0) {
        summary += '\n\n【前' + Math.min(3, searchResults.length) + '个结果预览】\n';
        searchResults.slice(0, 3).forEach(function(item, idx) {
          var preview = sanitizeText(item.preview || '');
          if (preview.length > 150) preview = preview.substring(0, 150) + '...';
          var scoreInfo = hasRerank
            ? '重排分:' + item.rerankScore.toFixed(3) + ' | 原始:' + (item.originalScore || item.score).toFixed(3)
            : '分数:' + item.score.toFixed(3);
          summary += (idx + 1) + '. ' + item.belongsToGroup + ' (' + scoreInfo + ')\n   ' + preview + '\n';
        });
      }

      return summary;
    }

    // 特殊处理：关键词搜索结果
    var keywordResults = null;
    if (Array.isArray(cleanValue) && cleanValue.length > 0 && cleanValue[0].preview !== undefined && cleanValue[0].matchedKeywords) {
      keywordResults = cleanValue;
    } else if (typeof cleanValue === 'object' && !Array.isArray(cleanValue) && Object.keys(cleanValue).length > 0) {
      var firstKey = Object.keys(cleanValue)[0];
      var firstItem = cleanValue[firstKey];
      if (firstItem && firstItem.preview !== undefined && firstItem.matchedKeywords) {
        keywordResults = Object.keys(cleanValue).map(function(key) {
          return cleanValue[key];
        });
      }
    }

    if (keywordResults) {
      var summary = keywordResults.length + ' 个匹配片段';

      // 统计所有匹配的关键词
      var allMatched = {};
      keywordResults.forEach(function(item) {
        if (item.matchedKeywords && Array.isArray(item.matchedKeywords)) {
          item.matchedKeywords.forEach(function(kw) {
            allMatched[kw] = (allMatched[kw] || 0) + 1;
          });
        }
      });

      var matchedList = Object.keys(allMatched);
      if (matchedList.length > 0) {
        summary += '，匹配: ' + matchedList.join(', ');
      }

      // 添加前3个结果的预览
      if (keywordResults.length > 0) {
        summary += '\n\n【前' + Math.min(3, keywordResults.length) + '个结果预览】\n';
        keywordResults.slice(0, 3).forEach(function(item, idx) {
          var preview = sanitizeText(item.preview || '');
          if (preview.length > 150) preview = preview.substring(0, 150) + '...';
          var matched = item.matchedKeywords ? ' [' + item.matchedKeywords.join(',') + ']' : '';
          summary += (idx + 1) + '. ' + (item.belongsToGroup || '全文') + matched + '\n   ' + preview + '\n';
        });
      }

      return summary;
    }

    // 特殊处理：grep搜索结果
    var grepResults = null;
    if (Array.isArray(cleanValue) && cleanValue.length > 0 && cleanValue[0].preview !== undefined && cleanValue[0].matchedKeyword !== undefined) {
      grepResults = cleanValue;
    } else if (typeof cleanValue === 'object' && !Array.isArray(cleanValue) && Object.keys(cleanValue).length > 0) {
      var firstKey = Object.keys(cleanValue)[0];
      var firstItem = cleanValue[firstKey];
      if (firstItem && firstItem.preview !== undefined && firstItem.matchedKeyword !== undefined) {
        grepResults = Object.keys(cleanValue).map(function(key) {
          return cleanValue[key];
        });
      }
    }

    if (grepResults) {
      var summary = grepResults.length + ' 个匹配片段';

      // 统计匹配的关键词
      var keywordCounts = {};
      grepResults.forEach(function(item) {
        if (item.matchedKeyword) {
          keywordCounts[item.matchedKeyword] = (keywordCounts[item.matchedKeyword] || 0) + 1;
        }
      });

      var keywords = Object.keys(keywordCounts);
      if (keywords.length > 0) {
        var keywordList = keywords.map(function(kw) {
          return kw + '(' + keywordCounts[kw] + ')';
        }).join(', ');
        summary += '，匹配: ' + keywordList;
      }

      var topGroups = {};
      grepResults.forEach(function(item) {
        if (item.belongsToGroup) {
          topGroups[item.belongsToGroup] = true;
        }
      });
      var groupCount = Object.keys(topGroups).length;
      if (groupCount > 0) {
        summary += '，涉及 ' + groupCount + ' 个意群';
      }

      // 添加前3个结果的预览
      if (grepResults.length > 0) {
        summary += '\n\n【前' + Math.min(3, grepResults.length) + '个结果预览】\n';
        grepResults.slice(0, 3).forEach(function(item, idx) {
          var preview = sanitizeText(item.preview || '');
          if (preview.length > 150) preview = preview.substring(0, 150) + '...';
          var src = item.belongsToGroup ? item.belongsToGroup : '全文';
          var matched = item.matchedKeyword ? ' [' + item.matchedKeyword + ']' : '';
          summary += (idx + 1) + '. ' + src + matched + '\n   ' + preview + '\n';
        });
      }

      return summary;
    }

    // 特殊处理：其他grep搜索结果（无matchedKeyword字段）
    var otherResults = null;
    if (Array.isArray(cleanValue) && cleanValue.length > 0 && cleanValue[0].preview !== undefined) {
      otherResults = cleanValue;
    } else if (typeof cleanValue === 'object' && !Array.isArray(cleanValue) && Object.keys(cleanValue).length > 0) {
      var firstKey = Object.keys(cleanValue)[0];
      var firstItem = cleanValue[firstKey];
      if (firstItem && firstItem.preview !== undefined) {
        otherResults = Object.keys(cleanValue).map(function(key) {
          return cleanValue[key];
        });
      }
    }

    if (otherResults) {
      var summary = otherResults.length + ' 个匹配片段';

      var topGroups = {};
      otherResults.forEach(function(item) {
        if (item.belongsToGroup) {
          topGroups[item.belongsToGroup] = true;
        }
      });
      var groupCount = Object.keys(topGroups).length;
      if (groupCount > 0) {
        summary += '，涉及 ' + groupCount + ' 个意群';
      }

      // 添加前3个结果的预览
      if (otherResults.length > 0) {
        summary += '\n\n【前' + Math.min(3, otherResults.length) + '个结果预览】\n';
        otherResults.slice(0, 3).forEach(function(item, idx) {
          var preview = sanitizeText(item.preview || '');
          if (preview.length > 150) preview = preview.substring(0, 150) + '...';
          var src = item.belongsToGroup ? item.belongsToGroup : '全文';
          summary += (idx + 1) + '. ' + src + '\n   ' + preview + '\n';
        });
      }

      return summary;
    }

    // 特殊处理：简单对象
    if (typeof cleanValue === 'object' && !Array.isArray(cleanValue)) {
      var keys = Object.keys(cleanValue);
      if (keys.length === 0) return '无数据';
      if (keys.length === 1 && cleanValue.message) return cleanValue.message;
      if (keys.length === 2 && cleanValue.operations && cleanValue.final !== undefined) {
        return cleanValue.operations + (cleanValue.final ? ' (最后一轮)' : '');
      }

      // 其他对象，简化显示
      var parts = [];
      for (var key in cleanValue) {
        if (cleanValue.hasOwnProperty(key)) {
          var val = cleanValue[key];
          if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
            parts.push(key + ': ' + val);
          } else if (Array.isArray(val)) {
            parts.push(key + ': ' + val.length + ' 项');
          }
        }
      }
      return parts.length > 0 ? parts.join(', ') : JSON.stringify(cleanValue, null, 2);
    }

    try {
      return JSON.stringify(cleanValue, null, 2);
    } catch (_) {
      return String(cleanValue);
    }
  }

  /**
   * 清理文本内容，移除潜在的危险字符和HTML标签
   * @param {string} text - 待清理的文本
   * @returns {string} - 清理后的文本
   */
  function sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';

    // 1. 移除HTML标签（包括不完整的标签）
    text = text.replace(/<[^>]*>/g, '');

    // 2. 移除剩余的尖括号（防止破坏DOM结构）
    // 注意：这会影响数学表达式如 "<0.001"，但为了安全性这是必要的
    text = text.replace(/[<>]/g, '');

    // 3. 移除控制字符（保留常用的空白字符）
    text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

    // 4. 规范化空白字符
    text = text.replace(/\s+/g, ' ').trim();

    // 5. 移除不完整的Unicode代理对
    text = text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/g, '');

    return text;
  }

  /**
   * HTML转义
   */
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  window.ChatbotToolTraceUI = {
    startSession: startSession,
    handleStreamEvent: handleStreamEvent,
    handleReActEvent: handleReActEvent,  // 新增：ReAct事件处理器
    generateBlockHtml: generateBlockHtml,
    ensureStyles: injectStyles  // 导出以便外部调用
  };

  // 页面加载时立即注入样式，确保刷新后样式可用
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyles);
  } else {
    injectStyles();
  }

  window.ChatbotToolTraceUIScriptLoaded = true;
})(window, document);
