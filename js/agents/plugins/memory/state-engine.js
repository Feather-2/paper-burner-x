/**
 * StateEngine - 统一状态引擎
 *
 * P1.1: SSOT (Single Source of Truth) 实现
 *
 * 核心职责：
 * 1. 所有状态变更通过 dispatch(action) 提交
 * 2. Action 序列化支持调试/重放
 * 3. 并发安全（队列化 dispatch）
 * 4. 集成 Lamport 时钟确保因果排序
 *
 * 设计原则：
 * - 不可变更新：reducer 返回新状态，不修改原状态
 * - 单向数据流：Action → Reducer → State → Listeners
 * - 可序列化：所有 Action 和 State 可 JSON 序列化
 */

import { nextTick, sync as syncClock, currentSeq } from "../../core/lamport-clock.js";
import { DisposableBase } from "../../shared/index.js";
import { createLogger } from "../../shared/index.js";
import { cloneJson } from "./state-diff.js";
import { createInitialState, rootReducer } from "./state-engine.reducers.js";
import {
  notifyListeners,
  notifyListenersBatch,
  emitStateChange,
  emitBatchStateChange,
} from "./state-engine.events.js";
import {
  createSnapshot,
  restoreSnapshot,
  saveCheckpoint,
  restoreCheckpoint,
} from "./state-engine.persistence.js";

const logger = createLogger("runtime/memory/state-engine");

// ─────────────────────────────────────────────────────────────────────────────
// StateEngine Class
// ─────────────────────────────────────────────────────────────────────────────

export class StateEngine extends DisposableBase {
  /**
   * @param {object} options
   * @param {object} [options.initialState] - Initial state
   * @param {number} [options.maxActionHistory=1000] - Max action history size
   * @param {boolean} [options.enableActionHistory=true] - Enable action history for replay
   * @param {object} [options.eventBus] - EventBus for emitting state changes
   * @param {string} [options.actorId] - Actor ID for Lamport clock
   * @param {number} [options.maxQueueSize=1000] - Max dispatch queue size (backpressure)
   */
  constructor({
    initialState,
    maxActionHistory = 1000,
    enableActionHistory = true,
    eventBus = null,
    actorId,
    maxQueueSize = 1000,
  } = {}) {
    super();

    this._state = initialState
      ? { ...createInitialState(), ...initialState }
      : createInitialState();

    this._maxActionHistory = maxActionHistory;
    this._enableActionHistory = enableActionHistory;
    this._actionHistory = [];
    this._listeners = new Set();
    this._layerListeners = new Map(); // layer → Set<listener>
    this._eventBus = eventBus;
    this._checkpoints = new Map(); // checkpointId → { state, clock, encoding, baseId? }

    // Actor ID used for Lamport causal ordering metadata (clock itself is global in core/lamport-clock.js)
    this._actorId = actorId || this._state.runId;

    // Dispatch queue for serializing concurrent dispatches
    this._dispatchQueue = [];
    this._isDispatching = false;

    // Backpressure: limit queue size to prevent OOM
    this._maxQueueSize = maxQueueSize;
    this._queueDropCount = 0;

    // Register cleanup for dispose
    this._registerDisposable(() => {
      this._listeners.clear();
      this._layerListeners.clear();
      this._actionHistory.length = 0;
      this._checkpoints.clear();
      this._dispatchQueue.length = 0;
    });
  }

  /**
   * Get current state (read-only clone)
   */
  getState() {
    return cloneJson(this._state);
  }

  /**
   * Get raw state reference (for internal use only)
   * @private
   */
  _getStateRef() {
    return this._state;
  }

  /**
   * Enqueue a dispatch item with backpressure handling
   * @param {object} item - Queue item { action?, actions?, isBatch?, resolve }
   * @returns {boolean} true if enqueued, false if queue was full and oldest dropped
   * @private
   */
  _enqueue(item) {
    let dropped = false;

    // Backpressure: drop oldest when queue is full
    if (this._dispatchQueue.length >= this._maxQueueSize) {
      const droppedItem = this._dispatchQueue.shift();
      this._queueDropCount++;
      dropped = true;

      // Reject the dropped promise to notify caller
      if (droppedItem?.resolve) {
        droppedItem.resolve({ dropped: true, reason: "queue_overflow" });
      }

      // Emit overflow event
      if (this._eventBus?.emit) {
        this._eventBus.emit("stateEngine:queueOverflow", {
          dropped: 1,
          totalDropped: this._queueDropCount,
          queueSize: this._dispatchQueue.length,
          maxQueueSize: this._maxQueueSize,
        });
      }

      logger.warn("[StateEngine] Queue overflow, dropped oldest action", {
        totalDropped: this._queueDropCount,
        queueSize: this._dispatchQueue.length,
      });
    }

    this._dispatchQueue.push(item);
    return !dropped;
  }

  /**
   * Get queue metrics for monitoring
   * @returns {object} Queue metrics
   */
  getQueueMetrics() {
    return {
      queueSize: this._dispatchQueue.length,
      maxQueueSize: this._maxQueueSize,
      isDispatching: this._isDispatching,
      totalDropped: this._queueDropCount,
      utilizationPercent: Math.round((this._dispatchQueue.length / this._maxQueueSize) * 100),
    };
  }

  /**
   * Dispatch an action to update state
   * @param {object} action - Action object { type, payload, meta? }
   * @returns {object} The dispatched action with metadata
   */
  dispatch(action) {
    this._ensureNotDisposed();

    if (!action || typeof action !== "object" || !action.type) {
      throw new TypeError("StateEngine.dispatch: action must have a type");
    }

    // Queue the action with backpressure
    return new Promise((resolve) => {
      this._enqueue({ action, resolve });
      this._processQueue();
    });
  }

  /**
   * Batch dispatch multiple actions atomically
   * - Single clock tick for all actions
   * - Single listener notification after all actions complete
   * - Single EventBus emit
   * @param {object[]} actions - Array of action objects
   * @returns {Promise<object[]>} The dispatched actions with metadata
   */
  async dispatchBatch(actions) {
    this._ensureNotDisposed();

    if (!Array.isArray(actions) || actions.length === 0) {
      return [];
    }

    // Validate all actions first
    for (const action of actions) {
      if (!action || typeof action !== "object" || !action.type) {
        throw new TypeError("StateEngine.dispatchBatch: each action must have a type");
      }
    }

    return new Promise((resolve) => {
      this._enqueue({ actions, isBatch: true, resolve });
      this._processQueue();
    });
  }

  /**
   * Synchronous batch dispatch
   * @param {object[]} actions - Array of action objects
   * @returns {object[]} The dispatched actions with metadata
   */
  dispatchBatchSync(actions) {
    if (!Array.isArray(actions) || actions.length === 0) {
      return [];
    }

    return this._executeBatchDispatch(actions);
  }

  /**
   * Synchronous dispatch (for internal use / compatibility)
   * @param {object} action
   * @returns {object} The dispatched action
   */
  dispatchSync(action) {
    if (!action || typeof action !== "object" || !action.type) {
      throw new TypeError("StateEngine.dispatchSync: action must have a type");
    }

    return this._executeDispatch(action);
  }

  /**
   * Process dispatch queue
   * @private
   */
  async _processQueue() {
    if (this._isDispatching) return;
    this._isDispatching = true;

    while (this._dispatchQueue.length > 0) {
      const item = this._dispatchQueue.shift();
      if (item.isBatch) {
        const result = this._executeBatchDispatch(item.actions);
        item.resolve(result);
      } else {
        const result = this._executeDispatch(item.action);
        item.resolve(result);
      }
    }

    this._isDispatching = false;
  }

  /**
   * Execute batch dispatch - single clock tick, single notification
   * @private
   */
  _executeBatchDispatch(actions) {
    const ts = Date.now();
    const seq = nextTick().seq; // Single tick for entire batch
    const actorId = this._actorId;

    const prevState = this._state;
    let currentState = prevState;
    const enrichedActions = [];

    // Apply all actions sequentially but atomically
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const enrichedAction = {
        ...action,
        meta: {
          ...action.meta,
          ts,
          seq,
          batchIndex: i,
          batchSize: actions.length,
          actorId,
        },
      };
      enrichedActions.push(enrichedAction);

      // Reduce
      currentState = rootReducer(currentState, enrichedAction);
    }

    // Only update if state changed
    if (currentState !== prevState) {
      this._state = currentState;

      // Record action history (batch as single entry or individual)
      if (this._enableActionHistory) {
        for (const action of enrichedActions) {
          this._actionHistory.push(action);
        }
        while (this._actionHistory.length > this._maxActionHistory) {
          this._actionHistory.shift();
        }
      }

      // Single notification for entire batch
      this._notifyListenersBatch(enrichedActions, prevState, currentState);

      // Single EventBus emit for batch
      this._emitBatchStateChange(enrichedActions, prevState, currentState);
    }

    return enrichedActions;
  }

  /**
   * Execute a single dispatch
   * @private
   */
  _executeDispatch(action) {
    // Add metadata
    const seq = nextTick().seq;
    const enrichedAction = {
      ...action,
      meta: {
        ...action.meta,
        ts: action.meta?.ts || Date.now(),
        seq,
        actorId: this._actorId,
      },
    };

    // Reduce
    const prevState = this._state;
    const nextState = rootReducer(this._state, enrichedAction);

    // Only update if state changed
    if (nextState !== prevState) {
      this._state = nextState;

      // Record action history
      if (this._enableActionHistory) {
        this._actionHistory.push(enrichedAction);
        while (this._actionHistory.length > this._maxActionHistory) {
          this._actionHistory.shift();
        }
      }

      // Notify listeners
      this._notifyListeners(enrichedAction, prevState, nextState);

      // Emit to EventBus
      this._emitStateChange(enrichedAction, prevState, nextState);
    }

    return enrichedAction;
  }

  /**
   * Subscribe to state changes
   * @param {function|string} listenerOrLayer - Callback or layer name ("L0", "L1", etc.)
   * @param {function} [layerListener] - Callback when first arg is layer name
   * @returns {function} Unsubscribe function
   */
  subscribe(listenerOrLayer, layerListener) {
    this._ensureNotDisposed();

    // Overload: subscribe("L0", fn) -> layer subscription
    if (typeof listenerOrLayer === "string" && typeof layerListener === "function") {
      return this.subscribeLayer(listenerOrLayer, layerListener);
    }

    if (typeof listenerOrLayer !== "function") {
      throw new TypeError("StateEngine.subscribe: listener must be a function");
    }

    this._listeners.add(listenerOrLayer);
    return () => this._listeners.delete(listenerOrLayer);
  }

  /**
   * Subscribe to specific layer changes
   * @param {string} layer - "L0", "L1", "L2", or "L3"
   * @param {function} listener - Callback (action, prevLayer, nextLayer) => void
   * @returns {function} Unsubscribe function
   */
  subscribeLayer(layer, listener) {
    if (!["L0", "L1", "L2", "L3"].includes(layer)) {
      throw new Error(`Invalid layer: ${layer}`);
    }
    if (typeof listener !== "function") {
      throw new TypeError("StateEngine.subscribeLayer: listener must be a function");
    }

    if (!this._layerListeners.has(layer)) {
      this._layerListeners.set(layer, new Set());
    }
    this._layerListeners.get(layer).add(listener);

    return () => {
      const set = this._layerListeners.get(layer);
      if (set) set.delete(listener);
    };
  }

  /**
   * Notify all listeners
   * @private
   */
  _notifyListeners(action, prevState, nextState) {
    notifyListeners(this._listeners, this._layerListeners, action, prevState, nextState);
  }

  /**
   * Notify listeners for batch dispatch (single notification for multiple actions)
   * @private
   */
  _notifyListenersBatch(actions, prevState, nextState) {
    notifyListenersBatch(this._listeners, this._layerListeners, actions, prevState, nextState);
  }

  /**
   * Emit state change to EventBus
   * @private
   */
  _emitStateChange(action, prevState, nextState) {
    emitStateChange(this._eventBus, action, nextState);
  }

  /**
   * Emit batch state change to EventBus (single emit for multiple actions)
   * @private
   */
  _emitBatchStateChange(actions, prevState, nextState) {
    emitBatchStateChange(this._eventBus, actions, nextState);
  }

  /**
   * Get action history for replay/debugging
   * @param {number} [limit] - Limit number of actions returned
   * @returns {object[]} Action history
   */
  getActionHistory(limit) {
    if (!this._enableActionHistory) return [];
    const n = typeof limit === "number" && limit > 0 ? limit : this._actionHistory.length;
    return this._actionHistory.slice(-n).map(cloneJson);
  }

  /**
   * Replay actions on a fresh state
   * @param {object[]} actions - Actions to replay
   * @param {object} [initialState] - Starting state
   * @returns {object} Final state after replay
   */
  replay(actions, initialState) {
    let state = initialState ? { ...createInitialState(), ...initialState } : createInitialState();

    for (const action of actions) {
      state = rootReducer(state, action);
    }

    return state;
  }

  /**
   * Reset state to initial
   * @param {object} [newState] - Optional new initial state
   */
  reset(newState) {
    const prevState = this._state;
    this._state = newState
      ? { ...createInitialState(), ...newState }
      : createInitialState();
    this._actionHistory = [];
    this._actorId = this._state.runId;

    // Notify listeners of reset
    const resetAction = { type: "@@RESET", payload: {}, meta: { ts: Date.now(), seq: 0 } };
    this._notifyListeners(resetAction, prevState, this._state);
  }

  /**
   * Get current Lamport clock value
   */
  getClockValue() {
    return currentSeq();
  }

  /**
   * Receive external clock value (for distributed sync)
   * @param {number} externalSeq
   */
  receiveClockValue(externalSeq) {
    // Lamport rule: local = max(local, remote) + 1
    syncClock(externalSeq);
    nextTick();
  }

  /**
   * Create a snapshot of current state
   */
  createSnapshot() {
    return createSnapshot(this._state);
  }

  /**
   * Restore from a snapshot
   * @param {object} snapshot
   */
  restoreSnapshot(snapshot) {
    return restoreSnapshot(this, snapshot);
  }

  /**
   * Save differential checkpoint
   * @param {object} [options]
   * @param {number} [options.fullSnapshotEvery=10] - Force full snapshot every N checkpoints
   * @returns {object} Checkpoint metadata
   */
  saveCheckpoint(options = {}) {
    return saveCheckpoint(this, options);
  }

  /**
   * Restore from checkpoint by ID
   * @param {string} checkpointId
   * @returns {boolean} Success
   */
  restoreCheckpoint(checkpointId) {
    return restoreCheckpoint(this, checkpointId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { createInitialState, rootReducer, reduceL0, reduceL1, reduceL2, reduceL3 } from "./state-engine.reducers.js";

export default StateEngine;
