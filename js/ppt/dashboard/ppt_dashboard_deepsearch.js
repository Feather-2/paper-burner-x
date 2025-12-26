(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.deepsearch = NS.deepsearch || {};
  const FlowConfig = NS.PPTFlowConfig || {};
  const getAliasedState = (state) => (
    typeof FlowConfig.getAliasedState === 'function' ? FlowConfig.getAliasedState(state) : state
  );
  const getStateIndex = (state) => (
    typeof FlowConfig.getStateIndex === 'function' ? FlowConfig.getStateIndex(state) : -1
  );
  const getDeepsearchStepper = () => (
    typeof FlowConfig.getDeepsearchStepper === 'function' ? FlowConfig.getDeepsearchStepper() : []
  );
  Object.assign(NS.deepsearch, {
    _renderDeepSearchReview() {
        const md = typeof this.workflowData?.reportMarkdown === 'string'
            ? this.workflowData.reportMarkdown
            : (this.workflowData?.report?.markdown || '');

        const hasContinue = typeof window !== 'undefined' && window.PPTGenerator && typeof window.PPTGenerator.continueDeepSearchIteration === 'function';
        const hasProceed = typeof window !== 'undefined' && window.PPTGenerator && typeof window.PPTGenerator.proceedToScriptReview === 'function';

        return `
            <div class="ppt-question-form">
                <div class="form-header">
                    <h3><iconify-icon icon="carbon:search"></iconify-icon> DeepSearch 结果审阅</h3>
                    <p>查看 todos 覆盖情况与迭代进度；可继续下一轮或进入脚本编辑。</p>
                </div>
                <div class="form-body custom-scrollbar">
                    ${this._renderDeepSearchVisualization({ compact: false })}
                    ${this._renderDeepSearchTodos()}
                    ${this._renderDeepSearchRunLogs?.() || ''}

                    <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--ppt-border);">
                        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:8px;">
                            <div style="font-weight:650; color: var(--ppt-text);">研究报告预览</div>
                            <div style="font-size:12px; color: var(--ppt-text-secondary);">可在下一步编辑全文</div>
                        </div>
                        <textarea class="ppt-input-field" style="width: 100%; min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; line-height: 1.5;"
                            readonly>${this._escapeHtml(md)}</textarea>
                    </div>
                </div>
                <div class="form-footer">
                    <button class="ppt-btn-secondary" ${hasContinue ? '' : 'disabled'} data-action="continueDeepSearchIteration">
                        <iconify-icon icon="carbon:renew"></iconify-icon> 下一轮迭代
                    </button>
                    <button class="ppt-btn-primary" ${hasProceed ? '' : 'disabled'} data-action="proceedToScriptReview">
                        进入脚本编辑 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
            </div>
        `;
    },

    _renderDeepSearchRunLogs() {
        const logs = Array.isArray(this.workflowData?.runLogs) ? this.workflowData.runLogs : [];
        const items = logs.slice(-60).reverse();
        if (!items.length) return '';

        const badge = (level) => {
            const lv = String(level || 'info');
            if (lv === 'error') return { text: 'ERR', fg: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
            if (lv === 'warning' || lv === 'warn') return { text: 'WARN', fg: '#f59e0b', bg: 'rgba(245,158,11,0.14)' };
            if (lv === 'debug') return { text: 'DBG', fg: '#64748b', bg: 'rgba(100,116,139,0.12)' };
            return { text: 'INFO', fg: '#2563eb', bg: 'rgba(37,99,235,0.12)' };
        };

        const rows = items.map((log) => {
            const ts = typeof log?.timestamp === 'number' ? new Date(log.timestamp).toLocaleTimeString() : '';
            const lv = badge(log?.level);
            const agent = typeof log?.details?.agent === 'string' ? log.details.agent : (typeof log?.scope === 'string' ? log.scope : 'log');
            const msg = this._escapeHtml(log?.message || '');
            const meta = [];
            if (agent) meta.push(this._escapeHtml(agent));
            if (ts) meta.push(this._escapeHtml(ts));
            const metaText = meta.length ? meta.join(' · ') : '';
            return `
                <div style="display:flex; gap:10px; padding:10px 12px; border:1px solid var(--ppt-border); border-radius:10px; background:var(--ppt-panel-bg);">
                    <span style="flex:0 0 auto; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:650; color:${lv.fg}; background:${lv.bg};">${lv.text}</span>
                    <div style="flex:1; min-width:0;">
                        <div style="font-size:12px; color:var(--ppt-text-secondary);">${metaText}</div>
                        <div style="margin-top:2px; color:var(--ppt-text); white-space:pre-wrap; word-break:break-word;">${msg}</div>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div style="margin-top: 14px; padding: 12px; border: 1px solid var(--ppt-border); border-radius: 12px; background: var(--ppt-panel-bg);">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
                    <div style="font-weight:650; color: var(--ppt-text);">执行日志</div>
                    <div style="font-size:12px; color: var(--ppt-text-secondary);">最近 ${items.length} 条</div>
                </div>
                <div style="display:flex; flex-direction:column; gap:8px;">${rows}</div>
            </div>
        `;
    },

    _getDeepSearchTodos() {
        const pkgTodos = Array.isArray(this.workflowData?.contentPackage?.todos)
            ? this.workflowData.contentPackage.todos
            : [];
        const vizTodos = Array.isArray(this.workflowData?.deepsearchViz?.todos)
            ? this.workflowData.deepsearchViz.todos
            : [];
        const fallback = Array.isArray(this.workflowData?.todos) ? this.workflowData.todos : [];

        if (pkgTodos.length) return pkgTodos;
        if (vizTodos.length) return vizTodos;
        return fallback;
    },

    _renderDeepSearchTodos() {
        const todos = this._getDeepSearchTodos();
        const total = todos.length;

        const statusMeta = (status) => {
            const raw = String(status || 'open').toLowerCase();
            if (raw === 'completed') return { label: '已完成', color: '#16a34a', bg: 'rgba(22,163,74,0.12)' };
            if (raw === 'cancelled') return { label: '已取消', color: '#dc2626', bg: 'rgba(220,38,38,0.12)' };
            if (raw === 'pending') return { label: '进行中', color: '#2563eb', bg: 'rgba(37,99,235,0.12)' };
            return { label: '待处理', color: '#0f172a', bg: 'rgba(15,23,42,0.08)' };
        };

        const priorityMeta = (priority) => {
            const raw = String(priority || 'medium').toLowerCase();
            if (raw === 'high') return { label: '高优先', color: '#b91c1c', bg: 'rgba(185,28,28,0.12)' };
            if (raw === 'low') return { label: '低优先', color: '#0f172a', bg: 'rgba(15,23,42,0.08)' };
            return { label: '中优先', color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' };
        };

        const rows = (Array.isArray(todos) ? todos : []).slice(0, 12).map((todo) => {
            const text = this._escapeHtml(todo?.text || todo?.question || todo?.title || 'Untitled');
            const hints = Array.isArray(todo?.queryHints) ? todo.queryHints.filter(Boolean).slice(0, 4) : [];
            const status = statusMeta(todo?.status);
            const priority = priorityMeta(todo?.priority);
            const metaLine = hints.length ? `提示：${this._escapeHtml(hints.join(' · '))}` : '';
            return `
                <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:10px 12px; border:1px solid var(--ppt-border); border-radius:10px; background:var(--ppt-panel-bg);">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:600; color:var(--ppt-text);">${text}</div>
                        ${metaLine ? `<div style="margin-top:4px; font-size:12px; color:var(--ppt-text-secondary);">${metaLine}</div>` : ''}
                    </div>
                    <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px; white-space:nowrap;">
                        <span style="padding:2px 8px; border-radius:999px; font-size:12px; color:${status.color}; background:${status.bg};">${status.label}</span>
                        <span style="padding:2px 8px; border-radius:999px; font-size:12px; color:${priority.color}; background:${priority.bg};">${priority.label}</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div style="margin-top: 14px; padding: 12px; border: 1px solid var(--ppt-border); border-radius: 12px; background: var(--ppt-panel-bg);">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px;">
                    <div style="font-weight:650; color: var(--ppt-text);">研究待办</div>
                    <div style="font-size:12px; color: var(--ppt-text-secondary);">共 ${total} 条</div>
                </div>
                ${rows || '<div style="font-size:12px; color: var(--ppt-text-secondary);">暂无待办</div>'}
            </div>
        `;
    },


    _renderDeepSearchVisualization({ compact } = {}) {
        const id = compact ? 'pptDeepSearchFlowVizCompact' : 'pptDeepSearchFlowViz';
        const height = compact ? 320 : 520;
        const wrapClass = compact ? 'ppt-flow-embed compact' : 'ppt-flow-embed';
        return `
            <div class="${wrapClass}">
                <div class="ppt-flow-embed-header">
                    <div class="ppt-flow-embed-title">
                        <iconify-icon icon="carbon:ibm-watson-discovery"></iconify-icon>
                        <span>DeepSearch 流程</span>
                    </div>
                    <div class="ppt-flow-embed-hint">拖拽 / 缩放查看 · 自动聚焦最新节点</div>
                </div>
                <div id="${id}" class="ppt-flow-canvas" style="height:${height}px;"></div>
            </div>
        `;
    },

    /**
     * Premium DeepSearch UI - Flow fullscreen, Stepper top-center, Status bottom-left, Logs center
     */

    _renderDeepSearchPremiumUI() {
        const isDesigner = this.state === 'designer';
        const flowCanvasId = isDesigner ? 'pptDesignFlowVizFull' : 'pptDeepSearchFlowVizFull';
        const stepperSteps = getDeepsearchStepper();

        return `
            <div class="ds-research-stage">
                <!-- Flow Canvas - Full Screen Background -->
                <div class="ds-viz-panel">
                    <div id="${flowCanvasId}" class="ppt-flow-canvas"></div>
                </div>

                <!-- Stepper Bar - Top Center -->
                <div class="ds-stepper-bar">
                    <div class="ds-stepper-left">
                        ${stepperSteps.map((step, index) => {
                          const num = String(index + 1);
                          const line = index < stepperSteps.length - 1
                            ? `<div class="ds-step-line ${this._isStepCompleted(step.state) ? 'completed' : ''}"></div>`
                            : '';
                          return `${this._renderDsStep(step.state, num, step.label)}${line}`;
                        }).join('')}
                    </div>
                </div>

                <!-- Status Card - Bottom Left -->
                <div class="ds-stepper-status">
                    <div class="ds-status-badge-sm" id="dsPanelStatusBadge">
                        <iconify-icon icon="${this._getCurrentStatusIcon()}"></iconify-icon>
                    </div>
                    <span class="ds-status-label" id="dsPanelStatusTitle">${this._getCurrentStatusTitle()}</span>
                </div>

                <!-- Process Panel - Full Screen Center (execution logs) -->
                <div class="ds-process-panel">
                    <div class="ds-panel-header">
                        <span class="ds-panel-title">执行日志</span>
                        <span class="ds-panel-hint" id="dsPanelStatusSub">${this._getCurrentStatusDesc()}</span>
                    </div>
                    <div class="ds-context-panel" id="dsContextPanel">
                        <div class="ds-context-row">
                            <span class="ds-context-title">上下文压力</span>
                            <span class="ds-context-mode" id="dsContextMode">--</span>
                        </div>
                        <div class="ds-context-bar">
                            <div class="ds-context-bar-fill" id="dsContextBarFill"></div>
                        </div>
                        <div class="ds-context-meta" id="dsContextMeta">暂无压缩指标</div>
                        <div class="ds-context-spark is-empty" id="dsContextSpark"></div>
                    </div>
                    <div class="ds-process-content" id="dsProcessList">
                        <!-- Step items will be appended here -->
                    </div>
                </div>
            </div>
        `;
    },


    _renderDsStep(stepState, num, label) {
        const currentIndex = getStateIndex(this.state);
        const stepIndex = getStateIndex(stepState);
        const isCompleted = currentIndex !== -1 && stepIndex !== -1 && currentIndex > stepIndex;

        let className = 'ds-step';
        if (getAliasedState(this.state) === getAliasedState(stepState)) className += ' active';
        if (isCompleted) className += ' completed';

        const icon = isCompleted ? '<iconify-icon icon="carbon:checkmark"></iconify-icon>' : num;

        return `
            <div class="${className}">
                <div class="ds-step-num">${icon}</div>
                <span class="ds-step-text">${label}</span>
            </div>
        `;
    },


    _isStepCompleted(stepState) {
        const currentIndex = getStateIndex(this.state);
        const stepIndex = getStateIndex(stepState);
        return currentIndex !== -1 && stepIndex !== -1 && currentIndex > stepIndex;
    },

    /**
     * Add a step item to the floating process panel
     * Merges consecutive progress items (e.g., "提取论点 1/20", "2/20"...) into single updating row
     */

    addProcessPanelStep(event) {
        const list = document.getElementById('dsProcessList');
        if (!list || !event?.text) return;

        const rawName = typeof event.name === 'string' ? event.name : '';
        const isLogEvent = rawName.startsWith('log.');
        const rawDetails = event.details && typeof event.details === 'object' ? { ...event.details } : null;
        if (isLogEvent && rawDetails && rawDetails.agent) delete rawDetails.agent;

        const resolveStageLabel = () => {
            if (isLogEvent) {
                const agent = event.details?.agent;
                return typeof agent === 'string' && agent.trim() ? agent : '日志';
            }

            if (rawName === 'deepsearch.started' || rawName === 'deepsearch.completed') return '研究';
            if (rawName === 'iteration.completed' || rawName === 'deepsearch.iteration.completed') return '迭代';
            if (rawName.startsWith('deepsearch.')) {
                const phase = rawName.split('.')[1] || '';
                const labels = {
                    scan: '扫描',
                    todos: '待办',
                    gaps: '缺口',
                    retrieve: '检索',
                    understand: '理解',
                    write: '写作',
                    condense: '压缩'
                };
                return labels[phase] || phase || '研究';
            }

            if (rawName.startsWith('design.')) return '设计';
            if (rawName.startsWith('compression.')) return '压缩';

            const fallback = rawName.split('.')[1];
            return fallback || 'event';
        };

        const stageLabel = resolveStageLabel();
        const signature = JSON.stringify({
            name: rawName,
            text: event.text,
            details: rawDetails
        });

        // Check if this is a progress update that should merge with previous
        const progressMatch = event.text.match(/(\d+)\s*\/\s*(\d+)/);
        if (progressMatch) {
            const lastItem = list.querySelector('.ds-step-item.progress-item:last-of-type');
            if (lastItem) {
                // Check if same type of progress (same prefix before the numbers)
                const prefix = event.text.replace(/\d+\s*\/\s*\d+.*$/, '').trim();
                const lastPrefix = lastItem.dataset.progressPrefix;
                if (lastPrefix === prefix) {
                    // Update existing progress item
                    const descEl = lastItem.querySelector('.ds-step-desc');
                    const timeEl = lastItem.querySelector('.ds-step-time');
                    if (descEl) descEl.textContent = event.text;
                    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
                    list.scrollTop = list.scrollHeight;
                    return;
                }
            }
        }

        const lastItem = list.lastElementChild;
        if (lastItem && lastItem.dataset.signature === signature) {
            const descEl = lastItem.querySelector('.ds-step-desc');
            const timeEl = lastItem.querySelector('.ds-step-time');
            if (descEl) descEl.textContent = event.text;
            if (timeEl) timeEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            return;
        }

        const div = document.createElement('div');
        div.className = 'ds-step-item';
        div.dataset.signature = signature;

        // Mark as progress item if it contains X/Y pattern
        if (progressMatch) {
            div.classList.add('progress-item');
            div.dataset.progressPrefix = event.text.replace(/\d+\s*\/\s*\d+.*$/, '').trim();
        }

        // Determine step status
        if (event.name?.includes('completed') || event.name?.includes('upserted')) {
            div.classList.add('completed');
        } else if (event.name?.includes('started') && !event.name?.includes('node')) {
            div.classList.add('running');
        } else if (event.name?.includes('external')) {
            div.classList.add('info');
        } else if (event.name?.startsWith('compression.forced')) {
            div.classList.add('warning');
        } else if (event.name?.startsWith('compression.advised')) {
            div.classList.add('info');
        } else if (event.name?.includes('warning') || event.name?.includes('error')) {
            div.classList.add('warning');
        }

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const stageName = stageLabel;

        // Determine icon
        let icon = '<iconify-icon icon="solar:record-circle-outline"></iconify-icon>';
        if (div.classList.contains('completed')) icon = '<iconify-icon icon="solar:check-circle-bold"></iconify-icon>';
        if (div.classList.contains('running')) icon = '<iconify-icon icon="solar:refresh-circle-bold"></iconify-icon>';
        if (div.classList.contains('info')) icon = '<iconify-icon icon="solar:info-circle-bold"></iconify-icon>';
        if (div.classList.contains('warning')) icon = '<iconify-icon icon="solar:danger-triangle-bold"></iconify-icon>';

        // Build details HTML (skip for progress items to keep compact)
        let detailsHtml = '';
        if (!progressMatch && rawDetails && Object.keys(rawDetails).length > 0) {
            detailsHtml = `
                <div class="ds-step-details">
                    ${Object.entries(rawDetails).map(([k, v]) => `
                        <div class="ds-detail-row">
                            <span class="ds-detail-label">${this._escapeHtml(k)}:</span>
                            <span class="ds-detail-val">${this._escapeHtml(String(v))}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        div.innerHTML = `
            <div class="ds-step-icon">${icon}</div>
            <div class="ds-step-info">
                <div class="ds-step-header-line">
                    <span class="ds-step-name">${this._escapeHtml(stageName)}</span>
                    <span class="ds-step-time">${time}</span>
                </div>
                <div class="ds-step-desc">${this._escapeHtml(event.text)}</div>
                ${detailsHtml}
            </div>
        `;

        list.appendChild(div);
        list.scrollTop = list.scrollHeight;

        // Update status header
        this._updatePanelStatus(event);
    },


    _updatePanelStatus(event) {
        const badge = document.getElementById('dsPanelStatusBadge');
        const title = document.getElementById('dsPanelStatusTitle');
        const sub = document.getElementById('dsPanelStatusSub');

        if (!badge || !title || !sub) return;

        // Update based on event type
        if (event.name?.includes('scan')) {
            sub.textContent = '正在扫描文档...';
            badge.innerHTML = '<iconify-icon icon="solar:scanner-outline"></iconify-icon>';
        } else if (event.name?.includes('todos')) {
            sub.textContent = '正在生成研究待办...';
            badge.innerHTML = '<iconify-icon icon="solar:list-check-outline"></iconify-icon>';
        } else if (event.name?.includes('gaps')) {
            sub.textContent = '正在分析知识空白...';
            badge.innerHTML = '<iconify-icon icon="solar:atom-outline"></iconify-icon>';
        } else if (event.name?.includes('retrieve')) {
            sub.textContent = '正在检索相关内容...';
            badge.innerHTML = '<iconify-icon icon="solar:magnifer-outline"></iconify-icon>';
        } else if (event.name?.includes('understand')) {
            sub.textContent = '正在理解和提取要点...';
            badge.innerHTML = '<iconify-icon icon="solar:brain-outline"></iconify-icon>';
        } else if (event.name?.includes('write')) {
            sub.textContent = '正在撰写报告...';
            badge.innerHTML = '<iconify-icon icon="solar:pen-new-square-outline"></iconify-icon>';
        } else if (event.name?.includes('design')) {
            sub.textContent = '正在设计页面...';
            badge.innerHTML = '<iconify-icon icon="solar:pallete-outline"></iconify-icon>';
        }

        if (event.name === 'deepsearch.completed') {
            title.textContent = '研究完成';
            sub.textContent = '报告已生成';
            badge.innerHTML = '<iconify-icon icon="solar:check-circle-bold"></iconify-icon>';
            badge.classList.add('success');
        }
    },

    _updateCompressionPanel(metrics) {
        const panel = document.getElementById('dsContextPanel');
        if (!panel) return;

        const latest = metrics && typeof metrics === 'object' ? metrics.latest : null;
        const pressure = typeof latest?.pressure === 'number' ? latest.pressure : null;
        const pct = typeof pressure === 'number' ? Math.round(pressure * 100) : null;
        const predicted = Number.isFinite(latest?.predictedTokens) ? Math.round(latest.predictedTokens) : null;
        const budget = Number.isFinite(latest?.budgetTokens) ? Math.round(latest.budgetTokens) : null;
        const headroom = Number.isFinite(latest?.headroomTokens) ? Math.round(latest.headroomTokens) : null;
        const growth = Number.isFinite(latest?.growthTokens) ? Math.round(latest.growthTokens) : null;
        const stageId = typeof latest?.stageId === 'string' ? latest.stageId : '';
        const layers = Array.isArray(latest?.suggestedLayers) ? latest.suggestedLayers : [];
        const mode = typeof latest?.mode === 'string' ? latest.mode : '';

        panel.classList.remove('mode-forced', 'mode-advised', 'mode-none');
        if (mode === 'forced') panel.classList.add('mode-forced');
        else if (mode === 'advised') panel.classList.add('mode-advised');
        else panel.classList.add('mode-none');

        const modeEl = document.getElementById('dsContextMode');
        if (modeEl) {
            modeEl.textContent =
                mode === 'forced' ? '强制压缩' :
                mode === 'advised' ? '建议压缩' :
                '--';
        }

        const fill = document.getElementById('dsContextBarFill');
        if (fill) {
            fill.style.width = pct !== null ? `${Math.min(100, Math.max(0, pct))}%` : '0%';
            fill.classList.remove('level-low', 'level-mid', 'level-high');
            if (pressure !== null) {
                if (pressure >= 0.95) fill.classList.add('level-high');
                else if (pressure >= 0.8) fill.classList.add('level-mid');
                else fill.classList.add('level-low');
            }
        }

        const metaEl = document.getElementById('dsContextMeta');
        if (metaEl) {
            const parts = [];
            if (pct !== null) parts.push(`压力 ${pct}%`);
            if (predicted !== null && budget !== null) parts.push(`预测 ${predicted}/${budget}`);
            if (headroom !== null) parts.push(`余量 ${headroom}`);
            if (growth !== null && growth !== 0) parts.push(`增长 ${growth > 0 ? `+${growth}` : `${growth}`}`);
            if (stageId) parts.push(`阶段 ${stageId}`);
            if (layers.length) parts.push(`层 ${layers.join(', ')}`);
            metaEl.textContent = parts.length ? parts.join(' · ') : '暂无压缩指标';
        }

        const spark = document.getElementById('dsContextSpark');
        if (spark) {
            const history = Array.isArray(metrics?.history) ? metrics.history : [];
            const tail = history.slice(-24);
            if (!tail.length) {
                spark.classList.add('is-empty');
                spark.innerHTML = '';
                return;
            }
            spark.classList.remove('is-empty');
            spark.innerHTML = tail.map((point) => {
                const p = typeof point?.pressure === 'number' ? point.pressure : 0;
                const height = Math.max(3, Math.min(16, Math.round(p * 16)));
                const level =
                    p >= 0.95 ? 'level-high' :
                    p >= 0.8 ? 'level-mid' :
                    'level-low';
                return `<span class="ds-context-spark-bar ${level}" style="height:${height}px"></span>`;
            }).join('');
        }
    },


    _renderDesignVisualization({ compact } = {}) {
        const id = compact ? 'pptDesignFlowVizCompact' : 'pptDesignFlowViz';
        const height = compact ? 360 : 560;
        const wrapClass = compact ? 'ppt-flow-embed compact' : 'ppt-flow-embed';
        return `
            <div class="${wrapClass}">
                <div class="ppt-flow-embed-header">
                    <div class="ppt-flow-embed-title">
                        <iconify-icon icon="carbon:paint-brush"></iconify-icon>
                        <span>Design 流程</span>
                    </div>
                    <div class="ppt-flow-embed-hint">拖拽 / 缩放查看 · 生成中会持续更新</div>
                </div>
                <div id="${id}" class="ppt-flow-canvas" style="height:${height}px;"></div>
            </div>
        `;
    },


    _destroyFlowViz(kind) {
        const k = kind === 'design' ? 'design' : 'deepsearch';
        if (!this._flowVizUnsubs || typeof this._flowVizUnsubs !== 'object') this._flowVizUnsubs = {};

        try {
            const off = this._flowVizUnsubs[k];
            if (typeof off === 'function') off();
        } catch {
            // ignore
        }
        this._flowVizUnsubs[k] = null;

        const viz = k === 'design' ? this._designFlowViz : this._deepsearchFlowViz;
        try {
            viz?.destroy?.();
        } catch {
            // ignore
        }

        if (k === 'design') this._designFlowViz = null;
        else this._deepsearchFlowViz = null;
    },


    async _getFlowVizModule() {
        if (this._flowVizModulePromise) return this._flowVizModulePromise;
        // This file is loaded as a classic script; resolve import relative to the document.
        this._flowVizModulePromise = import(new URL('js/ppt/dashboard/deepsearch-flow-visualizer.js', document.baseURI).href);
        return this._flowVizModulePromise;
    },


    async _mountFlowViz({ kind, containerId, direction, height }) {
        const el = document.getElementById(containerId);
        if (!el) return;

        const k = kind === 'design' ? 'design' : 'deepsearch';
        this._destroyFlowViz(k);
        el.innerHTML = ''; // Clear without loading message

        let mod = null;
        try {
            mod = await this._getFlowVizModule();
        } catch (e) {
            console.warn('[flow-viz] failed to import visualizer:', e);
            const hint = location?.protocol === 'file:'
                ? '检测到 file:// 打开页面。请用本地服务打开（例如 npm run dev:fe，然后访问 http://localhost:5173/ppt.html）。'
                : '请刷新页面或查看控制台错误信息。';
            el.innerHTML = `<div style="padding:12px 14px; color: var(--ppt-warning); font-size:12px; line-height:1.5;">流程可视化加载失败（模块导入失败）。${this._escapeHtml(hint)}</div>`;
            return;
        }

        const init = mod?.initDeepSearchFlow;
        if (typeof init !== 'function') {
            el.innerHTML = `<div style="padding:12px 14px; color: var(--ppt-warning); font-size:12px; line-height:1.5;">流程可视化加载失败（initDeepSearchFlow 不存在）。</div>`;
            return;
        }

        let viz = null;
        try {
            viz = await init(containerId, {
                direction,
                height,
                acceptPrefixes: k === 'design' ? ['design.'] : ['deepsearch.'],
                acceptNames: k === 'design' ? [] : ['deepsearch.iteration.completed', 'iteration.completed'],
            });
        } catch (e) {
            console.warn('[flow-viz] init failed:', e);
            el.innerHTML = `<div style="padding:12px 14px; color: var(--ppt-warning); font-size:12px; line-height:1.5;">流程可视化初始化失败。请查看控制台错误信息。</div>`;
            return;
        }
        if (!viz) return;

        if (typeof this._ensureTelemetrySubscription === 'function') {
            try {
                this._ensureTelemetrySubscription();
            } catch {
                // ignore
            }
        }

        // Replay events from RunStore to rebuild graph.
        let events = null;
        if (typeof this._loadFlowVizEvents === 'function') {
            try {
                const replay = await this._loadFlowVizEvents();
                events = replay?.[k];
            } catch (e) {
                console.warn('[flow-viz] failed to load replay events:', e);
            }
        }

        if (Array.isArray(events) && events.length) {
            try {
                viz.processEvents(events);
            } catch (e) {
                console.warn('[flow-viz] replay failed:', e);
            }
        }

        // Live subscribe.
        const bus = this._agentEventBridge;
        if (!this._flowVizUnsubs || typeof this._flowVizUnsubs !== 'object') this._flowVizUnsubs = {};
        if (bus && typeof viz.subscribe === 'function') {
            try {
                this._flowVizUnsubs[k] = viz.subscribe(bus);
            } catch (e) {
                console.warn('[flow-viz] subscribe failed:', e);
            }
        }

        if (k === 'design') this._designFlowViz = viz;
        else this._deepsearchFlowViz = viz;
    },


    _mountActiveFlowVisualizers() {
        if (this.state === 'researching') {
            // Mount full-screen canvas
            const fullEl = document.getElementById('pptDeepSearchFlowVizFull');
            if (fullEl) {
                this._mountFlowViz({ kind: 'deepsearch', containerId: 'pptDeepSearchFlowVizFull', direction: 'LR', height: null });
            } else {
                this._mountFlowViz({ kind: 'deepsearch', containerId: 'pptDeepSearchFlowVizCompact', direction: 'LR', height: 400 });
            }
            return;
        }
        if (this.state === 'deepsearch_review') {
            this._mountFlowViz({ kind: 'deepsearch', containerId: 'pptDeepSearchFlowViz', direction: 'LR', height: 520 });
            return;
        }
        if (this.state === 'designer') {
            // Mount full-screen canvas
            const fullEl = document.getElementById('pptDesignFlowVizFull');
            if (fullEl) {
                this._mountFlowViz({ kind: 'design', containerId: 'pptDesignFlowVizFull', direction: 'TB', height: null });
            } else {
                this._mountFlowViz({ kind: 'design', containerId: 'pptDesignFlowVizCompact', direction: 'TB', height: 400 });
            }
        }
    },

  });

  const getDeepsearchReviewActions = (ctx) => ({
    continueDeepSearchIteration: () => ctx.continueDeepSearchIteration?.(),
    proceedToScriptReview: () => ctx.proceedToScriptReview?.(),
  });

  if (window.PPTFlowViews?.register) {
    window.PPTFlowViews.register('deepsearch_review', {
      render: (ctx) => ctx._renderDeepSearchReview?.(),
      actions: getDeepsearchReviewActions,
    });
    window.PPTFlowViews.register('deepsearch_premium', {
      render: (ctx) => ctx._renderDeepSearchPremiumUI?.(),
    });
  }

})();
