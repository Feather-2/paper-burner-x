// js/chatbot/ui/chatbot-tooltrace-ui.js
(function(window, document) {
  'use strict';

  if (window.ChatbotToolTraceUIScriptLoaded) return;

  var containerId = 'chatbot-tool-trace';
  var stylesInjected = false;
  var pendingLogs = [];
  var pendingUpdates = [];
  var retryTimer = null;

  var STATUS_TEXT = {
    granularity: { running: '分析问题类型…', done: '粒度策略已确定' },
    planner: { running: '生成调用指令中…', done: '调用指令生成完成' },
    'search_groups': { running: '检索候选意群…', done: '已获取候选意群' },
    find: { running: '获取匹配片段…', done: '匹配片段已返回' },
    'fetch_group': { running: '提取意群详情…', done: '意群摘要已加入上下文' },
    fallback: { running: '回退策略执行中…', done: '已生成备用上下文' },
    context: { running: '汇总上下文…', done: '上下文准备完成' }
  };

  function injectStyles() {
    if (stylesInjected) return;
    var style = document.createElement('style');
    style.textContent = `
      .tool-trace-panel {background:rgba(255,255,255,0.94);border:1px solid #e5e7eb;border-radius:16px;box-shadow:0 16px 30px rgba(15,23,42,0.08);margin-bottom:14px;overflow:hidden;backdrop-filter:blur(8px);}
      .tool-trace-header {display:flex;align-items:center;justify-content:space-between;padding:10px 16px 6px 16px;border-bottom:1px solid rgba(226,232,240,0.6);}
      .tool-trace-header-title {display:flex;align-items:center;gap:8px;font-weight:600;color:#111827;font-size:13px;letter-spacing:0.01em;}
      .tool-trace-dot {width:8px;height:8px;border-radius:999px;background:linear-gradient(135deg,#3b82f6,#2563eb);box-shadow:0 0 0 4px rgba(37,99,235,0.18);display:inline-block;}
      .tool-trace-actions {display:flex;align-items:center;gap:6px;}
      .tool-trace-actions button {border:none;background:none;color:#2563eb;font-size:12px;font-weight:500;cursor:pointer;padding:4px 8px;border-radius:6px;transition:all 0.2s;}
      .tool-trace-actions button:hover {background:rgba(37,99,235,0.12);}
      .tool-trace-actions button[data-role="collapse"] span {display:inline-block;transition:transform 0.2s ease;}
      .tool-trace-panel.collapsed .tool-trace-actions button[data-role="collapse"] span {transform:rotate(180deg);}
      .tool-trace-panel.collapsed .tool-trace-body {display:none;}
      .tool-trace-body {padding:12px 14px 16px 16px;display:flex;flex-direction:column;gap:10px;max-height:220px;overflow-y:auto;}
      .tool-trace-body::-webkit-scrollbar {width:6px;}
      .tool-trace-body::-webkit-scrollbar-thumb {background:rgba(148,163,184,0.5);border-radius:999px;}
      .tool-trace-status {border-radius:12px;border:1px solid rgba(226,232,240,0.9);background:rgba(248,250,252,0.9);box-shadow:0 4px 10px rgba(15,23,42,0.05);padding:10px 12px;transition:background 0.2s ease,border 0.2s ease;}
      .tool-trace-status.running {border-left:3px solid #3b82f6;}
      .tool-trace-status.done {border-left:3px solid #10b981;background:rgba(240,253,244,0.9);}
      .tool-trace-status-head {display:flex;align-items:center;justify-content:space-between;gap:8px;}
      .tool-trace-badge {display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;color:#0f172a;}
      .tool-trace-badge .dot {width:6px;height:6px;border-radius:999px;background:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,0.18);display:inline-block;}
      .tool-trace-status.done .tool-trace-badge .dot {background:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,0.2);}
      .tool-trace-toggle {border:none;background:none;color:#2563eb;font-size:11px;cursor:pointer;padding:2px 6px;border-radius:6px;transition:background 0.2s;}
      .tool-trace-toggle:hover {background:rgba(37,99,235,0.12);}
      .tool-trace-detail {margin-top:6px;border-radius:8px;background:#f1f5f9;padding:8px;font-size:11px;color:#0f172a;white-space:pre-wrap;word-break:break-word;border:1px solid rgba(226,232,240,0.9);display:none;}
      .tool-trace-status.open .tool-trace-detail {display:block;}
    `;
    document.head.appendChild(style);
    stylesInjected = true;
  }

  function requestFlush() {
    if (retryTimer) return;
    retryTimer = setInterval(function() {
      var list = ensureContainer();
      if (!list) return;
      clearInterval(retryTimer);
      retryTimer = null;
      flushPending();
    }, 400);
  }

  function ensureContainer() {
    var listContainer = document.querySelector('#' + containerId + ' .tool-trace-body');
    if (listContainer) return listContainer;

    var chatArea = document.getElementById('chatbot-main-content-area');
    if (!chatArea) {
      requestFlush();
      return null;
    }

    injectStyles();

    var panel = document.createElement('div');
    panel.id = containerId;
    panel.className = 'tool-trace-panel';

    var header = document.createElement('div');
    header.className = 'tool-trace-header';

    var titleWrap = document.createElement('div');
    titleWrap.className = 'tool-trace-header-title';
    titleWrap.innerHTML = '<span class="tool-trace-dot"></span><span>工具调用</span>';

    var actions = document.createElement('div');
    actions.className = 'tool-trace-actions';

    var collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.dataset.role = 'collapse';
    collapseBtn.innerHTML = '<span>▼</span>';
    collapseBtn.addEventListener('click', function() {
      panel.classList.toggle('collapsed');
    });

    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = '清空';
    clearBtn.addEventListener('click', clear);

    actions.appendChild(collapseBtn);
    actions.appendChild(clearBtn);

    header.appendChild(titleWrap);
    header.appendChild(actions);

    var body = document.createElement('div');
    body.className = 'tool-trace-body';

    panel.appendChild(header);
    panel.appendChild(body);
    chatArea.insertBefore(panel, chatArea.firstChild);
    return body;
  }

  function flushPending() {
    var list = ensureContainer();
    if (!list) return;
    if (pendingLogs.length) {
      var logs = pendingLogs.slice();
      pendingLogs = [];
      logs.forEach(function(info) { appendItem(info); });
    }
    if (pendingUpdates.length) {
      var updates = pendingUpdates.slice();
      pendingUpdates = [];
      updates.forEach(function(val) { setLastResult(val); });
    }
  }

  function appendItem(info) {
    info = info || {};
    info._traceId = info._traceId || ('trace-' + Date.now() + '-' + Math.random().toString(16).slice(2));

    var list = ensureContainer();
    if (!list) {
      pendingLogs.push(info);
      requestFlush();
      return;
    }

    var status = document.createElement('div');
    status.className = 'tool-trace-status running';
    status.dataset.traceId = info._traceId;
    status.dataset.tool = info.tool || '';

    var head = document.createElement('div');
    head.className = 'tool-trace-status-head';

    var badge = document.createElement('div');
    badge.className = 'tool-trace-badge';
    var dot = document.createElement('span');
    dot.className = 'dot';
    var text = document.createElement('span');
    text.className = 'text';
    text.textContent = getStatusText(info.tool, 'running');
    badge.appendChild(dot);
    badge.appendChild(text);

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tool-trace-toggle';
    toggle.textContent = '详情';
    toggle.addEventListener('click', function() {
      status.classList.toggle('open');
    });

    head.appendChild(badge);
    head.appendChild(toggle);

    var detail = document.createElement('pre');
    detail.className = 'tool-trace-detail';
    detail.textContent = formatDetail(info.args);

    status.appendChild(head);
    status.appendChild(detail);

    list.appendChild(status);
    list.scrollTop = list.scrollHeight;
  }

  function updateLastResult(result) {
    if (setLastResult(result)) return;
    pendingUpdates.push(result);
    requestFlush();
  }

  function setLastResult(result) {
    var panel = document.getElementById(containerId);
    if (!panel) return false;
    var running = panel.querySelectorAll('.tool-trace-status.running');
    if (!running.length) return false;
    var current = running[running.length - 1];
    current.classList.remove('running');
    current.classList.add('done');
    var tool = current.dataset.tool || '';
    var text = current.querySelector('.tool-trace-badge .text');
    if (text) text.textContent = getStatusText(tool, 'done');
    var detail = current.querySelector('.tool-trace-detail');
    if (detail) detail.textContent = formatDetail(result);
    return true;
  }

  function clear() {
    var panel = document.getElementById(containerId);
    if (!panel) return;
    var body = panel.querySelector('.tool-trace-body');
    if (body) body.innerHTML = '';
    pendingLogs = [];
    pendingUpdates = [];
  }

  function getStatusText(tool, phase) {
    var map = STATUS_TEXT[(tool || '').toLowerCase()] || { running: '执行中…', done: '已完成' };
    return phase === 'done' ? map.done : map.running;
  }

  function formatDetail(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    try {
      return JSON.stringify(value, null, 2);
    } catch (_) {
      return String(value);
    }
  }

  /**
   * 处理流式事件
   * @param {Object} event - 流式事件对象
   */
  function handleStreamEvent(event) {
    var list = ensureContainer();
    if (!list) {
      console.warn('[ChatbotToolTraceUI] Container not ready for stream event:', event.type);
      return;
    }

    switch (event.type) {
      case 'granularity_analysis':
        // 粒度分析结果
        appendItem({
          tool: 'granularity',
          args: event.strategy,
          _traceId: 'granularity-' + Date.now()
        });
        updateLastResult({
          queryType: event.strategy.queryType,
          granularity: event.strategy.granularity,
          maxGroups: event.strategy.maxGroups,
          estimatedTokens: event.strategy.estimatedTokens
        });
        break;

      case 'status':
        // 状态更新：分析问题、向量搜索等
        appendItem({
          tool: event.phase,
          args: { message: event.message },
          _traceId: 'stream-' + event.phase + '-' + Date.now()
        });
        break;

      case 'candidates':
        // 候选意群
        updateLastResult({
          method: event.phase,
          candidates: event.data,
          total: event.total
        });
        break;

      case 'round_start':
        // 轮次开始
        appendItem({
          tool: 'round-' + event.round,
          args: { round: event.round + 1, maxRounds: event.maxRounds },
          _traceId: 'round-' + event.round
        });
        break;

      case 'plan':
        // 规划结果
        updateLastResult({
          operations: event.data.operations,
          final: event.data.final
        });
        break;

      case 'tool_start':
        // 工具开始执行
        appendItem({
          tool: event.tool,
          args: event.args,
          _traceId: 'tool-' + event.round + '-' + event.opIndex
        });
        break;

      case 'tool_result':
        // 工具执行结果
        updateLastResult(event.result);
        break;

      case 'tool_error':
        // 工具错误
        updateLastResult({ error: event.error });
        break;

      case 'tool_skip':
        // 工具跳过
        updateLastResult({ skipped: true, reason: event.reason });
        break;

      case 'round_end':
        // 轮次结束
        if (event.final) {
          updateLastResult({ message: '✓ 取材完成' });
        } else {
          updateLastResult({ message: '→ 继续下一轮...' });
        }
        break;

      case 'complete':
        // 全部完成
        appendItem({
          tool: 'context',
          args: event.summary,
          _traceId: 'complete-' + Date.now()
        });
        updateLastResult({
          contextLength: event.summary.contextLength,
          groups: event.summary.groups
        });
        break;

      case 'fallback':
        // 降级策略
        appendItem({
          tool: 'fallback',
          args: { reason: event.reason },
          _traceId: 'fallback-' + Date.now()
        });
        updateLastResult({ context: event.context.slice(0, 200) + '...' });
        break;

      case 'error':
      case 'warning':
        // 错误或警告
        appendItem({
          tool: event.type,
          args: { message: event.message },
          _traceId: event.type + '-' + Date.now()
        });
        break;

      default:
        console.log('[ChatbotToolTraceUI] Unknown stream event:', event.type);
    }

    // 自动滚动到底部
    list.scrollTop = list.scrollHeight;
  }

  window.ChatbotToolTraceUI = {
    log: appendItem,
    updateLastResult: updateLastResult,
    clear: clear,
    handleStreamEvent: handleStreamEvent  // 新增流式事件处理
  };

  window.ChatbotToolTraceUIScriptLoaded = true;
})(window, document);
