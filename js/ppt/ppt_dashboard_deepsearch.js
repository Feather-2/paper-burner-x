(()=>{
  window.PPTDashboard = window.PPTDashboard || {};
  const NS = window.PPTDashboard;
  NS.deepsearch = NS.deepsearch || {};

  const FALLBACK_UI_FLOW_CONFIG = NS.defaultUiFlowConfig || {
    stateOrder: [
      'idle',
      'briefing',
      'reading',
      'scanning',
      'researching',
      'deepsearch_review',
      'questioning',
      'script_review',
      'scripting',
      'outline_review',
      'outline_planning',
      'page_layout',
      'design_preferences',
      'designer',
      'completed',
      'failed'
    ],
    deepsearchStepper: [
      { state: 'reading', label: '阅读' },
      { state: 'researching', label: '研究' },
      { state: 'script_review', label: '脚本' },
      { state: 'page_layout', label: '规划' },
      { state: 'designer', label: '设计' }
    ],
    viewMap: {
      idle: 'upload',
      briefing: 'briefing',
      deepsearch_review: 'deepsearch_review',
      script_review: 'script_review',
      questioning: 'questioning',
      outline_review: 'outline_review',
      page_layout: 'page_layout'
    },
    defaultView: 'deepsearch_premium',
    stateAliases: {}
  };

  const mergeUiFlowConfig = (base, override) => {
    if (!override || typeof override !== 'object') return base;
    return {
      ...base,
      ...override,
      stateOrder: Array.isArray(override.stateOrder) && override.stateOrder.length
        ? override.stateOrder
        : base.stateOrder,
      deepsearchStepper: Array.isArray(override.deepsearchStepper) && override.deepsearchStepper.length
        ? override.deepsearchStepper
        : base.deepsearchStepper,
      viewMap: {
        ...base.viewMap,
        ...(override.viewMap && typeof override.viewMap === 'object' ? override.viewMap : {})
      },
      stateAliases: {
        ...base.stateAliases,
        ...(override.stateAliases && typeof override.stateAliases === 'object' ? override.stateAliases : {})
      },
      defaultView: typeof override.defaultView === 'string' && override.defaultView
        ? override.defaultView
        : base.defaultView
    };
  };

  const getUiFlowConfig = () => {
    if (typeof NS.getUiFlowConfig === 'function') return NS.getUiFlowConfig();
    if (!NS.defaultUiFlowConfig) NS.defaultUiFlowConfig = FALLBACK_UI_FLOW_CONFIG;
    return mergeUiFlowConfig(NS.defaultUiFlowConfig, NS.uiFlowConfig);
  };

  const getWorkflowStateOrder = () => {
    const config = getUiFlowConfig();
    return Array.isArray(config.stateOrder) && config.stateOrder.length ? config.stateOrder : [];
  };

  const getAliasedState = (state) => {
    const config = getUiFlowConfig();
    const aliases = config.stateAliases && typeof config.stateAliases === 'object' ? config.stateAliases : {};
    return aliases[state] || state;
  };

  const getStateIndex = (state) => {
    const order = getWorkflowStateOrder();
    const effective = getAliasedState(state);
    return order.indexOf(effective);
  };

  const getDeepsearchStepper = () => {
    const config = getUiFlowConfig();
    const steps = Array.isArray(config.deepsearchStepper) && config.deepsearchStepper.length
      ? config.deepsearchStepper
      : [];
    return steps.map((step) => {
      if (step && typeof step === 'object') {
        return {
          state: typeof step.state === 'string' ? step.state : '',
          label: typeof step.label === 'string' ? step.label : (typeof step.state === 'string' ? step.state : '')
        };
      }
      if (typeof step === 'string') {
        return { state: step, label: step };
      }
      return { state: '', label: '' };
    }).filter(step => step.state);
  };
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
                    <p>查看 gaps 覆盖情况与迭代进度；可继续下一轮或进入脚本编辑。</p>
                </div>
                <div class="form-body custom-scrollbar">
                    ${this._renderDeepSearchVisualization({ compact: false })}

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
                    <button class="ppt-btn-secondary" ${hasContinue ? '' : 'disabled'} onclick="${hasContinue ? 'window.PPTGenerator.continueDeepSearchIteration()' : ''}">
                        <iconify-icon icon="carbon:renew"></iconify-icon> 下一轮迭代
                    </button>
                    <button class="ppt-btn-primary" ${hasProceed ? '' : 'disabled'} onclick="${hasProceed ? 'window.PPTGenerator.proceedToScriptReview()' : ''}">
                        进入脚本编辑 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
                    </button>
                </div>
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

        const div = document.createElement('div');
        div.className = 'ds-step-item';

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
        } else if (event.name?.includes('warning') || event.name?.includes('error')) {
            div.classList.add('warning');
        }

        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const stageName = event.name?.split('.')[1] || 'event';

        // Determine icon
        let icon = '<iconify-icon icon="solar:record-circle-outline"></iconify-icon>';
        if (div.classList.contains('completed')) icon = '<iconify-icon icon="solar:check-circle-bold"></iconify-icon>';
        if (div.classList.contains('running')) icon = '<iconify-icon icon="solar:refresh-circle-bold"></iconify-icon>';
        if (div.classList.contains('info')) icon = '<iconify-icon icon="solar:info-circle-bold"></iconify-icon>';
        if (div.classList.contains('warning')) icon = '<iconify-icon icon="solar:danger-triangle-bold"></iconify-icon>';

        // Build details HTML (skip for progress items to keep compact)
        let detailsHtml = '';
        if (!progressMatch && event.details && Object.keys(event.details).length > 0) {
            detailsHtml = `
                <div class="ds-step-details">
                    ${Object.entries(event.details).map(([k, v]) => `
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
        this._flowVizModulePromise = import(new URL('js/ppt/deepsearch-flow-visualizer.js', document.baseURI).href);
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

        // Replay stored events (minimal {name,payload}) to rebuild graph.
        const events = this.workflowData?.flowVizEvents?.[k];
        if (Array.isArray(events) && events.length) {
            try {
                viz.processEvents(events);
            } catch (e) {
                console.warn('[flow-viz] replay failed:', e);
            }
        }

        // Live subscribe.
        const bus = this._orchestrator?.eventBus;
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

})();
