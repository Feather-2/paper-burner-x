/**
 * UI V2 State Store
 * 单一状态源，响应式更新
 */

import { getUIEventBus } from './event-bus.js';

// 工作流状态
export const WorkflowState = Object.freeze({
  IDLE: 'idle',
  BRIEFING: 'briefing',
  READING: 'reading',
  RESEARCHING: 'researching',
  REVIEWING: 'reviewing',
  DESIGNING: 'designing',
  COMPLETED: 'completed',
  FAILED: 'failed'
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

    const markDeepsearchStarted = (payload) => {
      this.update({
        'workflow.state': WorkflowState.RESEARCHING,
        'workflow.startedAt': Date.now(),
        'deepsearch.status': AgentStatus.RUNNING,
        'ui.view': ViewType.DEEPSEARCH_PREMIUM
      });
      setRunIdIfPresent(payload);
    };

    const markDeepsearchCompleted = (payload) => {
      this.update({
        'deepsearch.status': AgentStatus.COMPLETED,
        'workflow.state': WorkflowState.REVIEWING,
        'ui.view': ViewType.DEEPSEARCH_REVIEW
      });
      if (typeof payload?.iterations === 'number') {
        this.set('deepsearch.iteration', payload.iterations);
      } else if (typeof payload?.iteration === 'number') {
        this.set('deepsearch.iteration', payload.iteration + 1);
      }
    };

    const markDeepsearchFailed = (payload) => {
      this.update({
        'deepsearch.status': AgentStatus.FAILED,
        'workflow.state': WorkflowState.FAILED,
        'workflow.error': payload?.error || 'Unknown error'
      });
    };

    // DeepSearch Agent 事件
    bus.on('deepsearch.agent.started', (_, p) => markDeepsearchStarted(p));
    bus.on('deepsearch.started', (_, p) => markDeepsearchStarted(p));

    bus.on('deepsearch.agent.status.changed', (_, p) => {
      this.set('deepsearch.status', p?.to || AgentStatus.RUNNING);
    });

    bus.on('deepsearch.agent.completed', (_, p) => markDeepsearchCompleted(p));
    bus.on('deepsearch.completed', (_, p) => markDeepsearchCompleted(p));

    bus.on('deepsearch.agent.paused', () => {
      this.set('deepsearch.status', AgentStatus.PAUSED);
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
    bus.on('design.started', () => {
      this.update({
        'design.status': AgentStatus.RUNNING,
        'workflow.state': WorkflowState.DESIGNING,
        'ui.view': ViewType.DESIGNER
      });
    });

    bus.on('design.completed', () => {
      this.update({
        'design.status': AgentStatus.COMPLETED,
        'workflow.state': WorkflowState.COMPLETED,
        'workflow.completedAt': Date.now(),
        'ui.view': ViewType.COMPLETED
      });
    });
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
