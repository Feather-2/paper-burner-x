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

  function injectStyles() {
    if (stylesInjected) return;
    var style = document.createElement('style');
    style.textContent = `
      /* 工具调用思考块 - 匹配AI消息风格 */
      .tool-thinking-block {
        background: linear-gradient(90deg, #f8fafc 80%, #f1f5f9 100%);
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        margin-bottom: 14px;
        margin-top: 24px;
        overflow: hidden;
        box-shadow: 0 1px 4px rgba(0,0,0,0.05);
        transition: all 0.2s;
      }

      .tool-thinking-block.collapsed .tool-thinking-body {
        display: none;
      }

      /* 头部 */
      .tool-thinking-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        cursor: pointer;
        user-select: none;
        transition: background 0.2s;
      }

      .tool-thinking-header:hover {
        background: rgba(226, 232, 240, 0.5);
      }

      .tool-thinking-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        color: #64748b;
      }

      .tool-thinking-icon {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.15);
      }

      .tool-thinking-icon.running {
        background: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        animation: pulse-icon 2s ease-in-out infinite;
      }

      @keyframes pulse-icon {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }

      .tool-thinking-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: #94a3b8;
      }

      .tool-thinking-toggle .toggle-arrow {
        transition: transform 0.2s;
        display: inline-block;
      }

      .tool-thinking-block.collapsed .tool-thinking-toggle .toggle-arrow {
        transform: rotate(-90deg);
      }

      /* 内容区 */
      .tool-thinking-body {
        padding: 0 16px 12px 16px;
        max-height: 300px;
        overflow-y: auto;
      }

      .tool-thinking-body::-webkit-scrollbar {
        width: 5px;
      }

      .tool-thinking-body::-webkit-scrollbar-thumb {
        background: rgba(148, 163, 184, 0.3);
        border-radius: 3px;
      }

      /* 步骤项 */
      .tool-step {
        display: flex;
        gap: 10px;
        margin-bottom: 8px;
        padding: 8px 10px;
        background: white;
        border-radius: 6px;
        border-left: 2px solid transparent;
        transition: all 0.15s;
        font-size: 12px;
      }

      .tool-step:hover {
        background: #fafafa;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
      }

      .tool-step.running {
        border-left-color: #3b82f6;
        background: rgba(239, 246, 255, 0.4);
      }

      .tool-step.done {
        border-left-color: #10b981;
        background: rgba(240, 253, 244, 0.3);
      }

      .tool-step.error {
        border-left-color: #ef4444;
        background: rgba(254, 242, 242, 0.3);
      }

      .tool-step-indicator {
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #64748b;
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
        width: 13px;
        height: 13px;
      }

      .tool-step-content {
        flex: 1;
        min-width: 0;
      }

      .tool-step-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .tool-step-title {
        flex: 1;
        font-weight: 500;
        color: #334155;
        font-size: 12px;
        word-break: break-word;
        line-height: 1.4;
      }

      .tool-step-detail-toggle {
        background: none;
        border: none;
        font-size: 10px;
        color: #94a3b8;
        cursor: pointer;
        padding: 2px 5px;
        border-radius: 3px;
        transition: all 0.15s;
      }

      .tool-step-detail-toggle:hover {
        background: rgba(148, 163, 184, 0.1);
        color: #64748b;
      }

      .tool-step-detail {
        display: none;
        margin-top: 6px;
        padding: 6px 8px;
        background: #f8fafc;
        border-radius: 4px;
        font-size: 10px;
        color: #64748b;
        white-space: pre-wrap;
        word-break: break-word;
        border: 1px solid #e2e8f0;
      }

      .tool-step.detail-open .tool-step-detail {
        display: block;
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
    batchBuffer = null;
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
  }

  /**
   * 添加步骤HTML
   */
  function addStepHtml(stepInfo, status) {
    status = status || 'running';
    var icon = getStepIcon(stepInfo.tool);
    var title = getStepTitle(stepInfo);
    var detail = formatDetail(stepInfo.args || {});

    var stepHtml = `
      <div class="tool-step ${status}">
        <div class="tool-step-indicator">${icon}</div>
        <div class="tool-step-content">
          <div class="tool-step-main">
            <span class="tool-step-title">${title}</span>
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
      var tokenStr = ' (' + result._tokens + ' tokens)';
      lastHtml = lastHtml.replace(/(<span class="tool-step-title">[^<]+)(<\/span>)/, '$1' + tokenStr + '$2');
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
    var iconClass = isFinished ? '' : 'running';
    var title = isFinished ? '上下文检索完成' : '正在检索上下文...';

    // console.log('[ToolTraceUI] generateBlockHtml 调用：', {
    //   stepCount: stepCount,
    //   isFinished: isFinished,
    //   hasSteps: currentStepsHtml.length > 0
    // });

    if (currentStepsHtml.length === 0) {
      console.warn('[ToolTraceUI] currentStepsHtml 为空，返回空字符串');
      return '';
    }

    var html = `
      <div class="tool-thinking-block collapsed">
        <div class="tool-thinking-header" onclick="event.stopPropagation(); this.closest('.tool-thinking-block').classList.toggle('collapsed');">
          <div class="tool-thinking-title">
            <span class="tool-thinking-icon ${iconClass}"></span>
            <span>${title}</span>
          </div>
          <div class="tool-thinking-toggle">
            <span>${stepCount}步</span>
            <span class="toggle-arrow">▼</span>
          </div>
        </div>
        <div class="tool-thinking-body">
          ${currentStepsHtml.join('')}
        </div>
      </div>
    `;

    // console.log('[ToolTraceUI] 生成HTML长度:', html.length);
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
          updateLastStepStatus('done', {
            operations: event.data.operations.length + ' 个操作',
            final: event.data.final
          });
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
   * 获取步骤图标（SVG）
   */
  function getStepIcon(tool) {
    var icons = {
      'vector_search': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>',
      'keyword_search': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h6"/><path d="M3 17h6"/><path d="m15 6 6 6-6 6"/></svg>',
      'fetch_group': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
      'fetch': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>',
      'map': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 9 2 15 6 23 2 23 18 15 22 9 18 1 22 1 6"/></svg>',
      'grep': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>',
      'preload': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      'planning': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
      'round': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>',
      'info': '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>'
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
      'keyword_search': '关键词搜索',
      'fetch_group': '获取意群详情',
      'fetch': '获取意群详情',
      'map': '获取意群地图',
      'grep': '全文短语搜索',
      'preload': '预加载意群',
      'planning': 'AI规划工具调用',
      'round': '第' + ((stepInfo.round || 0) + 1) + '轮取材',
      'info': '信息'
    };

    var title = titles[stepInfo.tool || stepInfo.phase] || stepInfo.message || '执行中';

    // 添加参数信息
    if (stepInfo.tool === 'vector_search' && stepInfo.args && stepInfo.args.query) {
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
    if (Array.isArray(cleanValue) && cleanValue.length > 0 && cleanValue[0].chunkId && cleanValue[0].score !== undefined) {
      var summary = cleanValue.length + ' 个结果';
      var topGroups = {};
      cleanValue.forEach(function(item) {
        if (item.belongsToGroup) {
          topGroups[item.belongsToGroup] = true;
        }
      });
      var groupCount = Object.keys(topGroups).length;
      if (groupCount > 0) {
        summary += '，涉及 ' + groupCount + ' 个意群';
      }
      summary += '，最高分: ' + cleanValue[0].score.toFixed(3);

      // 添加前3个结果的预览
      if (cleanValue.length > 0) {
        summary += '\n\n【前' + Math.min(3, cleanValue.length) + '个结果预览】\n';
        cleanValue.slice(0, 3).forEach(function(item, idx) {
          var preview = item.preview || '';
          if (preview.length > 150) preview = preview.substring(0, 150) + '...';
          summary += (idx + 1) + '. ' + item.belongsToGroup + ' (分数:' + item.score.toFixed(3) + ')\n   ' + preview + '\n';
        });
      }

      return summary;
    }

    // 特殊处理：关键词搜索结果
    if (Array.isArray(cleanValue) && cleanValue.length > 0 && cleanValue[0].preview !== undefined && cleanValue[0].matchedKeywords) {
      var summary = cleanValue.length + ' 个匹配片段';

      // 统计所有匹配的关键词
      var allMatched = {};
      cleanValue.forEach(function(item) {
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
      if (cleanValue.length > 0) {
        summary += '\n\n【前' + Math.min(3, cleanValue.length) + '个结果预览】\n';
        cleanValue.slice(0, 3).forEach(function(item, idx) {
          var preview = item.preview || '';
          if (preview.length > 150) preview = preview.substring(0, 150) + '...';
          var matched = item.matchedKeywords ? ' [' + item.matchedKeywords.join(',') + ']' : '';
          summary += (idx + 1) + '. ' + (item.belongsToGroup || '全文') + matched + '\n   ' + preview + '\n';
        });
      }

      return summary;
    }

    // 特殊处理：grep搜索结果
    if (Array.isArray(cleanValue) && cleanValue.length > 0 && cleanValue[0].preview !== undefined && cleanValue[0].matchedKeyword !== undefined) {
      var summary = cleanValue.length + ' 个匹配片段';

      // 统计匹配的关键词
      var keywordCounts = {};
      cleanValue.forEach(function(item) {
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
      cleanValue.forEach(function(item) {
        if (item.belongsToGroup) {
          topGroups[item.belongsToGroup] = true;
        }
      });
      var groupCount = Object.keys(topGroups).length;
      if (groupCount > 0) {
        summary += '，涉及 ' + groupCount + ' 个意群';
      }

      // 添加前3个结果的预览
      if (cleanValue.length > 0) {
        summary += '\n\n【前' + Math.min(3, cleanValue.length) + '个结果预览】\n';
        cleanValue.slice(0, 3).forEach(function(item, idx) {
          var preview = item.preview || '';
          if (preview.length > 150) preview = preview.substring(0, 150) + '...';
          var src = item.belongsToGroup ? item.belongsToGroup : '全文';
          var matched = item.matchedKeyword ? ' [' + item.matchedKeyword + ']' : '';
          summary += (idx + 1) + '. ' + src + matched + '\n   ' + preview + '\n';
        });
      }

      return summary;
    }

    // 特殊处理：其他grep搜索结果（无matchedKeyword字段）
    if (Array.isArray(cleanValue) && cleanValue.length > 0 && cleanValue[0].preview !== undefined) {
      var summary = cleanValue.length + ' 个匹配片段';

      var topGroups = {};
      cleanValue.forEach(function(item) {
        if (item.belongsToGroup) {
          topGroups[item.belongsToGroup] = true;
        }
      });
      var groupCount = Object.keys(topGroups).length;
      if (groupCount > 0) {
        summary += '，涉及 ' + groupCount + ' 个意群';
      }

      // 添加前3个结果的预览
      if (cleanValue.length > 0) {
        summary += '\n\n【前' + Math.min(3, cleanValue.length) + '个结果预览】\n';
        cleanValue.slice(0, 3).forEach(function(item, idx) {
          var preview = item.preview || '';
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
