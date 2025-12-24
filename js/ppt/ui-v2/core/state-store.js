/**
 * UI V2 State Store
 * 单一状态源，响应式更新
 */

import { getUIEventBus } from './event-bus.js';
import { WorkflowState as RuntimeWorkflowState } from '../../workflow/workflow-states.js';

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
  WorkflowState.RESEARCHING,
  WorkflowState.DEEPSEARCH_REVIEW
]);

const LOOP_RUNNING_STATUSES = new Set(['running', 'observing', 'thinking', 'executing', 'reviewing']);
const LOOP_PAUSED_STATUSES = new Set(['paused']);
const LOOP_COMPLETED_STATUSES = new Set(['completed']);
const LOOP_FAILED_STATUSES = new Set(['aborted', 'failed']);

function normalizeAgentStatus(loopStatus) {
  if (!loopStatus || typeof loopStatus !== 'string') return AgentStatus.IDLE;
  if (LOOP_RUNNING_STATUSES.has(loopStatus)) return AgentStatus.RUNNING;
  if (LOOP_PAUSED_STATUSES.has(loopStatus)) return AgentStatus.PAUSED;
  if (LOOP_COMPLETED_STATUSES.has(loopStatus)) return AgentStatus.COMPLETED;
  if (LOOP_FAILED_STATUSES.has(loopStatus)) return AgentStatus.FAILED;
  if (loopStatus === 'idle') return AgentStatus.IDLE;
  return AgentStatus.RUNNING;
}

function mapDeepsearchWorkflowState(loopStatus) {
  if (!loopStatus) return null;
  if (['running', 'observing', 'thinking', 'executing'].includes(loopStatus)) {
    return WorkflowState.RESEARCHING;
  }
  if (loopStatus === 'reviewing' || loopStatus === 'paused') {
    return WorkflowState.DEEPSEARCH_REVIEW;
  }
  if (loopStatus === 'completed') return WorkflowState.SCRIPT_REVIEW;
  if (loopStatus === 'aborted') return WorkflowState.FAILED;
  return null;
}

function mapDesignWorkflowState(loopStatus) {
  if (!loopStatus) return null;
  if (['running', 'observing', 'thinking', 'executing', 'reviewing', 'paused'].includes(loopStatus)) {
    return WorkflowState.DESIGNER;
  }
  if (loopStatus === 'completed') return WorkflowState.COMPLETED;
  if (loopStatus === 'aborted') return WorkflowState.FAILED;
  return null;
}

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
    slides: [],
    currentSlide: 0,
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

    const applyAgentLoopStatus = (agentKey, loopStatus, payload) => {
      if (!loopStatus || typeof loopStatus !== 'string') return;
      const normalized = normalizeAgentStatus(loopStatus);
      const updates = {
        [`${agentKey}.loopStatus`]: loopStatus,
        [`${agentKey}.status`]: normalized
      };
      const workflowState = agentKey === 'deepsearch'
        ? mapDeepsearchWorkflowState(loopStatus)
        : agentKey === 'design'
          ? mapDesignWorkflowState(loopStatus)
          : null;

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

    bus.on('run.started', (_, p) => markRunStarted(p));
    bus.on('ingest.started', (_, p) => markIngestStarted(p));
    bus.on('ingest.completed', (_, p) => markIngestCompleted(p));

    // DeepSearch Agent 事件
    bus.on('deepsearch.agent.started', (_, p) => markDeepsearchStarted(p));
    bus.on('deepsearch.started', (_, p) => markDeepsearchStarted(p));

    bus.on('deepsearch.agent.status.changed', (_, p) => {
      applyAgentLoopStatus('deepsearch', p?.to, p);
    });

    bus.on('deepsearch.agent.completed', (_, p) => markDeepsearchCompleted(p));
    bus.on('deepsearch.completed', (_, p) => markDeepsearchCompleted(p));

    bus.on('deepsearch.agent.paused', (_, p) => {
      applyAgentLoopStatus('deepsearch', 'paused', p);
    });

    bus.on('deepsearch.agent.failed', (_, p) => markDeepsearchFailed(p));
    bus.on('deepsearch.failed', (_, p) => markDeepsearchFailed(p));

    const updateIteration = (payload) => {
      if (typeof payload?.iteration === 'number') {
        this.set('deepsearch.iteration', payload.iteration + 1);
      }
    };

    bus.on('deepsearch.iteration.completed', (_, p) => updateIteration(p));
    bus.on('iteration.completed', (_, p) => updateIteration(p));

    bus.on('deepsearch.gaps.completed', (_, p) => {
      if (Array.isArray(p?.gaps)) this.set('deepsearch.gaps', p.gaps);
    });

    // 进度事件
    bus.on('deepsearch.*', (eventName, p) => {
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
    });

    // Design Agent 事件
    bus.on('design.agent.status.changed', (_, p) => {
      applyAgentLoopStatus('design', p?.to, p);
    });

    bus.on('design.started', (_, p) => markDesignStarted(p));
    bus.on('design.ended', (_, p) => markDesignCompleted(p));
    bus.on('design.completed', (_, p) => markDesignCompleted(p));
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
    _instance = null;
  }
}

export default StateStore;
