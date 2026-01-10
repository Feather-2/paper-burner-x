/**
 * UI V2 State Store
 * 单一状态源，响应式更新
 */

import { getUIEventBus } from './event-bus.js';
import { WorkflowState as RuntimeWorkflowState } from '../../workflow/workflow-states.js';
import { mapWorkflowStateFromLoopStatus, normalizeLoopStatusForUi } from '../../workflow/unified-state-mapping.js';

// 工作流状态（对齐 workflow-states.js）
export const WorkflowState = Object.freeze({
  ...RuntimeWorkflowState,
  REVIEWING: RuntimeWorkflowState.SCRIPT_REVIEW,
  DESIGNING: RuntimeWorkflowState.DESIGNER
});

// Agent 状态
export const AgentStatus = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed'
});

// 视图类型
export const ViewType = Object.freeze({
  UPLOAD: 'upload',
  BRIEFING: 'briefing',
  DEEPSEARCH_PREMIUM: 'deepsearch_premium',
  DEEPSEARCH_REVIEW: 'deepsearch_review',
  QUESTIONING: 'questioning',
  SCRIPT_REVIEW: 'script_review',
  OUTLINE_REVIEW: 'outline_review',
  PAGE_LAYOUT: 'page_layout',
  DESIGN_PREFERENCES: 'design_preferences',
  DESIGNER: 'designer',
  COMPLETED: 'completed',
  FAILED: 'failed'
});

const DEEPSEARCH_VIEW_STATES = new Set([
  WorkflowState.READING,
  WorkflowState.SCANNING,
  WorkflowState.RESEARCHING
]);

function resolveViewForWorkflowState(state) {
  if (!state) return null;
  if (DEEPSEARCH_VIEW_STATES.has(state)) return ViewType.DEEPSEARCH_PREMIUM;
  if (typeof window !== 'undefined') {
    const view = window.PPTDashboard?.PPTFlowConfig?.getViewKey?.(state);
    if (view) return view;
  }
  switch (state) {
    case WorkflowState.IDLE:
      return ViewType.UPLOAD;
    case WorkflowState.BRIEFING:
      return ViewType.BRIEFING;
    case WorkflowState.DEEPSEARCH_REVIEW:
      return ViewType.DEEPSEARCH_REVIEW;
    case WorkflowState.SCRIPT_REVIEW:
      return ViewType.SCRIPT_REVIEW;
    case WorkflowState.QUESTIONING:
      return ViewType.QUESTIONING;
    case WorkflowState.OUTLINE_REVIEW:
    case WorkflowState.OUTLINE_PLANNING:
      return ViewType.OUTLINE_REVIEW;
    case WorkflowState.PAGE_LAYOUT:
      return ViewType.PAGE_LAYOUT;
    case WorkflowState.DESIGN_PREFERENCES:
      return ViewType.DESIGN_PREFERENCES;
    case WorkflowState.DESIGNER:
      return ViewType.DESIGNER;
    case WorkflowState.COMPLETED:
      return ViewType.COMPLETED;
    case WorkflowState.FAILED:
      return ViewType.FAILED;
    default:
      return ViewType.DEEPSEARCH_PREMIUM;
  }
}

// 初始状态
const createInitialState = () => ({
  workflow: {
    state: WorkflowState.IDLE,
    runId: null,
    error: null,
    startedAt: null,
    completedAt: null
  },
  deepsearch: {
    status: AgentStatus.IDLE,
    loopStatus: null,
    iteration: 0,
    maxIterations: 5,
    gaps: [],
    claims: [],
    evidences: [],
    report: null,
    draftPreview: null,  // 实时草稿预览 (Forge demo)
    progress: {
      phase: null,
      step: null,
      current: 0,
      total: 0,
      message: ''
    }
  },
  design: {
    status: AgentStatus.IDLE,
    loopStatus: null,
    phase: null,
    currentPhase: 'idle',      // 当前设计阶段 (Timeline demo)
    previousPhase: null,
    slides: [],
    currentSlide: null,        // 当前生成的幻灯片
    currentBatch: null,        // 当前批次信息
    deckHtmlDsl: null,         // 实时 deck 内容
    slidesMeta: [],            // 幻灯片元数据
    pendingChatAsk: null,      // 待用户回答的问题
    designSystem: null,
    progress: {
      step: null,
      current: 0,
      total: 0
    }
  },
  ui: {
    view: ViewType.UPLOAD,
    uploadStep: 1,
    pendingStart: false,
    logs: [],
    modals: {},
    stepper: {
      current: 0,
      steps: [
        { id: 'upload', label: '上传' },
        { id: 'research', label: '研究' },
        { id: 'review', label: '审阅' },
        { id: 'design', label: '设计' }
      ]
    }
  },
  data: {
    files: [],
    sources: [],
    runLogs: [],
    generationMode: 'deepsearch',
    workflowMode: 'auto',
    reportConfig: {
      reportLength: 'standard',
      tone: 'business',
      audience: 'general',
      language: 'auto',
      enableReviewer: false
    },
    taskGoal: '',
    projectBrief: {
      taskGoal: '',
      projectSummary: '',
      audience: '',
      tone: ''
    },
    questions: [],
    userAnswers: {},
    reportMarkdown: '',
    report: null,
    outline: [],
    plannedOutline: null,
    contentPackage: null,
    slideIntents: [],
    slideStatuses: null,
    designPhase: null,
    designSystem: null,
    batchSize: 4,
    deckPackage: null
  }
});

export class StateStore {
  constructor(eventBus) {
    this._eventBus = eventBus || getUIEventBus();
    this._state = createInitialState();
    this._subscribers = new Set();
    this._unsubscribers = [];
    this._setupAgentEventListeners();
  }

  /**
   * 获取当前状态（只读副本）
   */
  getState() {
    return JSON.parse(JSON.stringify(this._state));
  }

  /**
   * 获取状态片段
   */
  get(path) {
    const parts = path.split('.');
    let value = this._state;
    for (const part of parts) {
      if (value == null) return undefined;
      value = value[part];
    }
    return value;
  }

  /**
   * 更新状态
   * @param {string} path - 状态路径，如 'workflow.state'
   * @param {any} value - 新值
   */
  set(path, value) {
    const parts = path.split('.');
    const key = parts.pop();
    let target = this._state;

    for (const part of parts) {
      if (target[part] == null) {
        target[part] = {};
      }
      target = target[part];
    }

    const oldValue = target[key];
    if (oldValue === value) return;

    target[key] = value;
    this._notify(path, value, oldValue);
  }

  /**
   * 批量更新
   */
  update(updates) {
    for (const [path, value] of Object.entries(updates)) {
      this.set(path, value);
    }
  }

  /**
   * 订阅状态变化
   */
  subscribe(handler) {
    this._subscribers.add(handler);
    return () => this._subscribers.delete(handler);
  }

  /**
   * 通知订阅者
   */
  _notify(path, newValue, oldValue) {
    const event = { path, newValue, oldValue, state: this.getState() };

    for (const handler of this._subscribers) {
      try {
        handler(event);
      } catch (err) {
        console.error('[StateStore] Subscriber error:', err);
      }
    }

    // 发送状态变化事件
    this._eventBus.emit('ui.state.changed', event);
  }

  /**
   * 设置 Agent 事件监听
   */
  _setupAgentEventListeners() {
    const bus = this._eventBus;

    const setRunIdIfPresent = (payload) => {
      if (payload && typeof payload.runId === 'string') {
        this.set('workflow.runId', payload.runId);
      }
    };

    const addAgentLog = (eventName, payload) => {
      const m = typeof eventName === 'string' ? eventName.match(/^(deepsearch|design)\.log\.(debug|info|warn|error)$/) : null;
      if (!m) return;
      const scope = m[1];
      const level = m[2] === 'warn' ? 'warning' : m[2];
      const message = typeof payload?.message === 'string' ? payload.message : '';
      if (!message) return;
      const stage = typeof payload?.stage === 'string' ? payload.stage : '';
      const iteration = typeof payload?.iteration === 'number' ? payload.iteration : null;
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : null;

      this.addLog({
        scope,
        level,
        message,
        stage,
        iteration: iteration !== null ? iteration + 1 : null,
        reason: typeof data?.reason === 'string' ? data.reason : null,
      });
    };

    const applyAgentLoopStatus = (agentKey, loopStatus, payload) => {
      if (!loopStatus || typeof loopStatus !== 'string') return;
      const normalized = normalizeLoopStatusForUi(loopStatus, { empty: AgentStatus.IDLE, unknown: AgentStatus.RUNNING });
      const updates = {
        [`${agentKey}.loopStatus`]: loopStatus,
        [`${agentKey}.status`]: normalized
      };
      const workflowState = mapWorkflowStateFromLoopStatus(agentKey, loopStatus, this.get('workflow.state'));

      if (workflowState) {
        updates['workflow.state'] = workflowState;
        const view = resolveViewForWorkflowState(workflowState);
        if (view) updates['ui.view'] = view;
        if (workflowState === WorkflowState.COMPLETED) {
          updates['workflow.completedAt'] = Date.now();
        }
        if (workflowState === WorkflowState.RESEARCHING && !this.get('workflow.startedAt')) {
          updates['workflow.startedAt'] = Date.now();
        }
      }

      this.update(updates);
      setRunIdIfPresent(payload);
    };

    const markDeepsearchStarted = (payload) => {
      applyAgentLoopStatus('deepsearch', 'running', payload);
    };

    const markDeepsearchCompleted = (payload) => {
      applyAgentLoopStatus('deepsearch', 'completed', payload);
      if (typeof payload?.iterations === 'number') {
        this.set('deepsearch.iteration', payload.iterations);
      } else if (typeof payload?.iteration === 'number') {
        this.set('deepsearch.iteration', payload.iteration + 1);
      }

      const workflowMode = this.get('data.workflowMode') || 'auto';
      if (workflowMode === 'auto') {
        this.update({
          'workflow.state': WorkflowState.SCRIPT_REVIEW,
          'ui.view': ViewType.SCRIPT_REVIEW,
        });
      } else {
        this.update({
          'workflow.state': WorkflowState.DEEPSEARCH_REVIEW,
          'ui.view': ViewType.DEEPSEARCH_REVIEW,
        });
      }
    };

    const markDeepsearchFailed = (payload) => {
      applyAgentLoopStatus('deepsearch', 'aborted', payload);
      this.set('workflow.error', payload?.error || 'Unknown error');
    };

    const markRunStarted = (payload) => {
      this.update({
        'workflow.state': WorkflowState.READING,
        'workflow.startedAt': Date.now(),
        'ui.view': ViewType.DEEPSEARCH_PREMIUM
      });
      setRunIdIfPresent(payload);
    };

    const markRunCompleted = (payload) => {
      this.update({
        'workflow.state': WorkflowState.COMPLETED,
        'workflow.completedAt': Date.now(),
        'ui.view': ViewType.COMPLETED,
      });
      setRunIdIfPresent(payload);
    };

    const markRunFailed = (payload) => {
      const error =
        (payload && typeof payload === 'object' ? (payload.error || payload.message || payload.reason) : null) ||
        'Run failed';
      this.update({
        'workflow.state': WorkflowState.FAILED,
        'workflow.error': String(error),
        'workflow.completedAt': Date.now(),
        'ui.view': ViewType.FAILED,
      });
      setRunIdIfPresent(payload);
    };

    const markRunCancelled = (payload) => {
      const reason =
        (payload && typeof payload === 'object' ? (payload.reason || payload.message) : null) ||
        'cancelled';
      this.update({
        'workflow.state': WorkflowState.IDLE,
        'workflow.error': String(reason),
        'workflow.completedAt': Date.now(),
        'ui.view': ViewType.UPLOAD,
      });
      setRunIdIfPresent(payload);
    };

    const markIngestStarted = (payload) => {
      this.update({
        'workflow.state': WorkflowState.READING,
        'ui.view': ViewType.DEEPSEARCH_PREMIUM
      });
      setRunIdIfPresent(payload);
    };

    const markIngestCompleted = (payload) => {
      this.update({
        'workflow.state': WorkflowState.SCANNING,
        'ui.view': ViewType.DEEPSEARCH_PREMIUM
      });
      setRunIdIfPresent(payload);
    };

    const markDesignStarted = (payload) => {
      applyAgentLoopStatus('design', 'running', payload);
    };

    const markDesignCompleted = (payload) => {
      applyAgentLoopStatus('design', 'completed', payload);
    };

    this._unsubscribers.push(bus.on('run.started', (_, p) => markRunStarted(p)));
    this._unsubscribers.push(bus.on('run.completed', (_, p) => markRunCompleted(p)));
    this._unsubscribers.push(bus.on('run.failed', (_, p) => markRunFailed(p)));
    this._unsubscribers.push(bus.on('run.cancelled', (_, p) => markRunCancelled(p)));
    this._unsubscribers.push(bus.on('ingest.started', (_, p) => markIngestStarted(p)));
    this._unsubscribers.push(bus.on('ingest.completed', (_, p) => markIngestCompleted(p)));

    // DeepSearch Agent 事件
    this._unsubscribers.push(bus.on('deepsearch.agent.started', (_, p) => markDeepsearchStarted(p)));
    this._unsubscribers.push(bus.on('deepsearch.started', (_, p) => markDeepsearchStarted(p)));
    this._unsubscribers.push(bus.on('deepsearch.log.*', (name, p) => addAgentLog(name, p)));

    this._unsubscribers.push(bus.on('deepsearch.agent.status.changed', (_, p) => {
      applyAgentLoopStatus('deepsearch', p?.to, p);
    }));

    this._unsubscribers.push(bus.on('deepsearch.agent.completed', (_, p) => markDeepsearchCompleted(p)));
    this._unsubscribers.push(bus.on('deepsearch.completed', (_, p) => markDeepsearchCompleted(p)));

    this._unsubscribers.push(bus.on('deepsearch.agent.paused', (_, p) => {
      applyAgentLoopStatus('deepsearch', 'paused', p);
    }));

    this._unsubscribers.push(bus.on('deepsearch.agent.failed', (_, p) => markDeepsearchFailed(p)));
    this._unsubscribers.push(bus.on('deepsearch.failed', (_, p) => markDeepsearchFailed(p)));

    const updateIteration = (payload) => {
      if (typeof payload?.iteration === 'number') {
        this.set('deepsearch.iteration', payload.iteration + 1);
      }
    };

    this._unsubscribers.push(bus.on('deepsearch.iteration.completed', (_, p) => updateIteration(p)));
    this._unsubscribers.push(bus.on('iteration.completed', (_, p) => updateIteration(p)));

    this._unsubscribers.push(bus.on('deepsearch.gaps.completed', (_, p) => {
      if (Array.isArray(p?.gaps)) this.set('deepsearch.gaps', p.gaps);
    }));

    // 进度事件
    this._unsubscribers.push(bus.on('deepsearch.*', (eventName, p) => {
      if (eventName.includes('.progress')) {
        const progress = {
          phase: p?.phase || this.get('deepsearch.progress.phase'),
          step: p?.step || this.get('deepsearch.progress.step'),
          current: p?.current ?? this.get('deepsearch.progress.current'),
          total: p?.total ?? this.get('deepsearch.progress.total'),
          message: p?.msg || p?.message || ''
        };
        this.set('deepsearch.progress', progress);
      }
    }));

    // Design Agent 事件
    this._unsubscribers.push(bus.on('design.agent.status.changed', (_, p) => {
      applyAgentLoopStatus('design', p?.to, p);
    }));

    this._unsubscribers.push(bus.on('design.started', (_, p) => markDesignStarted(p)));
    this._unsubscribers.push(bus.on('design.ended', (_, p) => markDesignCompleted(p)));
    this._unsubscribers.push(bus.on('design.completed', (_, p) => markDesignCompleted(p)));
    this._unsubscribers.push(bus.on('design.log.*', (name, p) => addAgentLog(name, p)));

    // =========================================================================
    // 新增事件处理器（events.d.ts 适配）
    // =========================================================================

    // DeepSearch 证据/草稿事件（Forge demo）
    this._unsubscribers.push(bus.on('deepsearch.evidence.synthesized', (_, p) => {
      const evidences = this.get('deepsearch.evidences') || [];
      if (p?.evidenceId) {
        evidences.push({ id: p.evidenceId, source: p.source, content: p.content });
        this.set('deepsearch.evidences', evidences.slice(-20)); // 保留最近20条
      }
    }));

    this._unsubscribers.push(bus.on('deepsearch.draft.updated', (_, p) => {
      if (p?.phrase) {
        this.set('deepsearch.draftPreview', {
          sectionId: p.sectionId,
          phrase: p.phrase,
          isComplete: p.isComplete || false,
          updatedAt: Date.now()
        });
      }
    }));

    // Design 阶段事件（Timeline demo）
    this._unsubscribers.push(bus.on('design.phase.transition', (_, p) => {
      if (p?.to) this.set('design.currentPhase', p.to);
      if (p?.from) this.set('design.previousPhase', p.from);
    }));

    this._unsubscribers.push(bus.on('design.batch.started', (_, p) => {
      if (typeof p?.batchIndex === 'number') {
        this.set('design.currentBatch', {
          batchIndex: p.batchIndex,
          batchSize: p.batchSize || 0,
          slideIds: p.slideIds || [],
          status: 'running'
        });
      }
    }));

    this._unsubscribers.push(bus.on('design.batch.completed', (_, p) => {
      if (typeof p?.batchIndex === 'number') {
        this.set('design.currentBatch', {
          batchIndex: p.batchIndex,
          slidesGenerated: p.slidesGenerated || 0,
          duration: p.duration || 0,
          status: 'completed'
        });
      }
    }));

    this._unsubscribers.push(bus.on('design.slide.started', (_, p) => {
      if (typeof p?.slideIndex === 'number') {
        this.set('design.currentSlide', {
          slideId: p.slideId,
          slideIndex: p.slideIndex,
          slideIntentId: p.slideIntentId,
          title: p.title || '',
          status: 'generating'
        });
      }
    }));

    this._unsubscribers.push(bus.on('design.slide.completed', (_, p) => {
      if (typeof p?.slideIndex === 'number') {
        this.set('design.currentSlide', {
          slideId: p.slideId,
          slideIndex: p.slideIndex,
          status: p.status || 'success'
        });
      }
    }));

    this._unsubscribers.push(bus.on('design.deck.updated', (_, p) => {
      if (p?.deckHtmlDsl) this.set('design.deckHtmlDsl', p.deckHtmlDsl);
      if (Array.isArray(p?.slidesMeta)) this.set('design.slidesMeta', p.slidesMeta);
    }));

    this._unsubscribers.push(bus.on('design.chat.ask', (_, p) => {
      if (p?.question) {
        this.set('design.pendingChatAsk', {
          question: p.question,
          options: p.options || [],
          timestamp: Date.now()
        });
      }
    }));
  }

  /**
   * 重置状态
   */
  reset() {
    this._state = createInitialState();
    this._notify('', this._state, null);
  }

  /**
   * 添加日志
   */
  addLog(log) {
    const logs = [...this._state.ui.logs, {
      ...log,
      timestamp: Date.now()
    }].slice(-100);
    this.set('ui.logs', logs);
  }

  destroy() {
    for (const unsubscribe of this._unsubscribers) {
      try {
        if (typeof unsubscribe === 'function') unsubscribe();
      } catch (err) {
        console.error('[StateStore] Failed to unsubscribe listener:', err);
      }
    }
    this._unsubscribers = [];
    this._subscribers.clear();
  }
}

// 全局单例
let _instance = null;

export function getStateStore() {
  if (!_instance) {
    _instance = new StateStore();
  }
  return _instance;
}

export function resetStateStore() {
  if (_instance) {
    _instance.reset();
    _instance.destroy();
    _instance = null;
  }
}

export default StateStore;
