/**
 * UI Event Adapter - 统一 UI 与 Agent 事件对接
 *
 * 解决问题：
 * 1. UI 靠轮询 workflowData，事件延迟
 * 2. 事件订阅分散在各 dashboard 文件
 * 3. 进度计算硬编码在 UI 中
 */

import { DESIGN_PHASES_CONFIG, calculateDesignProgress } from '../design/design-phases-config.js';

const LOOP_RUNNING_STATUSES = new Set(['running', 'observing', 'thinking', 'executing', 'reviewing']);
const LOOP_PAUSED_STATUSES = new Set(['paused']);
const LOOP_COMPLETED_STATUSES = new Set(['completed']);
const LOOP_FAILED_STATUSES = new Set(['aborted', 'failed']);

function normalizeLoopStatus(loopStatus) {
  if (!loopStatus || typeof loopStatus !== 'string') return null;
  if (LOOP_RUNNING_STATUSES.has(loopStatus)) return 'running';
  if (LOOP_PAUSED_STATUSES.has(loopStatus)) return 'paused';
  if (LOOP_COMPLETED_STATUSES.has(loopStatus)) return 'completed';
  if (LOOP_FAILED_STATUSES.has(loopStatus)) return 'failed';
  if (loopStatus === 'idle') return 'idle';
  return null;
}

/**
 * UI 事件适配器
 * - 聚合 DeepSearch/Design/Runtime 事件
 * - 标准化事件载荷
 * - 提供进度计算
 */
export class UIEventAdapter {
  constructor(eventBus) {
    this.eventBus = eventBus;
    this.listeners = new Map(); // eventPattern -> Set<callback>
    this._state = {
      deepsearch: { phase: 'idle', iteration: 0, progress: 0, gaps: [], status: 'idle' },
      design: { phase: 'idle', progress: 0, currentSlide: 0, totalSlides: 0, status: 'idle' },
    };
    this._unsubscribes = [];
  }

  /**
   * 启动事件监听
   */
  start() {
    if (!this.eventBus) return;

    const unsub = this.eventBus.on('*', (evt) => this._handleEvent(evt));
    this._unsubscribes.push(unsub);
  }

  /**
   * 停止事件监听
   */
  stop() {
    this._unsubscribes.forEach((fn) => fn?.());
    this._unsubscribes = [];
  }

  /**
   * 订阅 UI 事件（支持通配符）
   * @param {string} pattern - 事件模式，如 'deepsearch.*', 'design.phase.*'
   * @param {Function} callback - (eventName, payload, computedState) => void
   */
  on(pattern, callback) {
    if (!this.listeners.has(pattern)) {
      this.listeners.set(pattern, new Set());
    }
    this.listeners.get(pattern).add(callback);
    return () => this.off(pattern, callback);
  }

  off(pattern, callback) {
    const set = this.listeners.get(pattern);
    if (set) set.delete(callback);
  }

  /**
   * 获取当前状态快照
   */
  getState() {
    return { ...this._state };
  }

  /**
   * 内部：处理事件并分发到 UI
   */
  _handleEvent(evt) {
    const name = evt?.name || '';
    const payload = evt?.payload || {};

    this._updateState(name, payload);
    const computed = this._computeDerived(name, payload);
    this._dispatch(name, payload, computed);
  }

  _updateState(name, payload) {
    if (name.startsWith('deepsearch.')) {
      if (name === 'deepsearch.agent.status.changed') {
        const status = normalizeLoopStatus(payload?.to);
        if (status) this._state.deepsearch.status = status;
      }
      if (name === 'deepsearch.started') {
        this._state.deepsearch = { ...this._state.deepsearch, status: 'running', phase: 'scan', iteration: 0 };
      }
      if (name === 'deepsearch.phase.transition' || name.includes('.progress')) {
        const phase = payload?.phase || payload?.to || this._state.deepsearch.phase;
        this._state.deepsearch.phase = phase;
      }
      if (name === 'deepsearch.iteration.completed' || name === 'iteration.completed') {
        this._state.deepsearch.iteration = (payload?.iteration ?? -1) + 1;
      }
      if (name === 'deepsearch.gaps.completed') {
        this._state.deepsearch.gaps = payload?.gaps || [];
      }
      if (name === 'deepsearch.completed') {
        this._state.deepsearch.status = 'completed';
      }
      if (name === 'deepsearch.failed') {
        this._state.deepsearch.status = 'failed';
      }
    }

    if (name.startsWith('design.')) {
      if (name === 'design.agent.status.changed') {
        const status = normalizeLoopStatus(payload?.to);
        if (status) this._state.design.status = status;
      }
      if (name === 'design.started') {
        this._state.design = { ...this._state.design, status: 'running', phase: 'outline_parsing' };
        this._state.design.totalSlides = payload?.slideCount || 0;
      }
      if (name === 'design.phase.transition') {
        this._state.design.phase = payload?.to || payload?.phase || this._state.design.phase;
      }
      if (name === 'design.batch.progress') {
        this._state.design.currentSlide = payload?.doneSlides || this._state.design.currentSlide;
      }
      if (name === 'design.ended' || name === 'design.completed') {
        this._state.design.status = 'completed';
        this._state.design.phase = 'completed';
      }
      if (name === 'design.failed') {
        this._state.design.status = 'failed';
      }
    }
  }

  _computeDerived(name, payload) {
    const computed = {};

    if (name.startsWith('deepsearch.')) {
      const phases = ['scan', 'gaps', 'retrieve', 'understand', 'write'];
      const currentIdx = phases.indexOf(this._state.deepsearch.phase);
      computed.deepsearchProgress = currentIdx >= 0 ? Math.round(((currentIdx + 1) / phases.length) * 100) : 0;
    }

    if (name.startsWith('design.')) {
      computed.designProgress = calculateDesignProgress(
        this._state.design.phase,
        this._state.design.currentSlide,
        this._state.design.totalSlides
      );
      computed.designPhaseLabel = DESIGN_PHASES_CONFIG[this._state.design.phase]?.label || this._state.design.phase;
    }

    return computed;
  }

  _dispatch(name, payload, computed) {
    for (const [pattern, callbacks] of this.listeners) {
      if (this._matchPattern(pattern, name)) {
        for (const cb of callbacks) {
          try {
            cb(name, payload, { ...this._state, ...computed });
          } catch (err) {
            console.error('[UIEventAdapter] Callback error:', err);
          }
        }
      }
    }
  }

  _matchPattern(pattern, eventName) {
    if (pattern === '*') return true;
    if (pattern === eventName) return true;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return eventName.startsWith(`${prefix}.`);
    }
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return eventName.startsWith(prefix);
    }
    return false;
  }
}

/**
 * 创建 UI 事件适配器
 */
export function createUIEventAdapter(eventBus) {
  const adapter = new UIEventAdapter(eventBus);
  adapter.start();
  return adapter;
}

export default UIEventAdapter;
