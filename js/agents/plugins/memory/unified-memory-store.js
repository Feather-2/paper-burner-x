/**
 * UnifiedMemoryStore - 统一记忆存储
 *
 * 内核：StateEngine (dispatch/reducer + action history + Lamport clock)
 * 外壳：MemoryStore 风格的直接 API（内部转 dispatch）
 *
 * 设计目标：
 * - 单一状态源（SSOT）：所有层数据统一存放在 StateEngine state 中
 * - 兼容性：保留 StateEngine 订阅/重放/时钟等能力，同时提供 MemoryStore 便捷方法
 * - 低开销读取：L0/L1/L2/L3 getter 返回 frozen 浅拷贝（COW）
 */

import { getGlobalTokenCounter, isPlainObject, toNonEmptyString } from "../../shared/index.js";
import { diffLayers } from "./state-diff.js";
import { StateEngine } from "./state-engine.js";
import { applyIndexMethods } from "./unified-memory-store.index.js";
import { applyLifecycleMethods } from "./unified-memory-store.lifecycle.js";
import { applyQueryMethods } from "./unified-memory-store.query.js";
import { applyWriteMethods } from "./unified-memory-store.write.js";
import { DEFAULT_CONFIG, genId, isFiniteNumber } from "./unified-memory-store.utils.js";

export class UnifiedMemoryStore {
  constructor(options = {}) {
    this.runId = toNonEmptyString(options.runId) || genId("run");
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.eventBus = options.eventBus || null;
    this.archiveAdapter = options.archiveAdapter || null;
    this._tokenCounter = options.tokenCounter === null ? null : options.tokenCounter || getGlobalTokenCounter();

    this._embeddingService = options.embeddingService && typeof options.embeddingService === "object" ? options.embeddingService : null;
    this._vectorIndex = options.vectorIndex && typeof options.vectorIndex === "object" ? options.vectorIndex : null;
    this._retrievalEngine = options.retrievalEngine && typeof options.retrievalEngine === "object" ? options.retrievalEngine : null;

    this._sharedContext = options.sharedContext || null;
    this._discoveryManager = options.discoveryManager || null;

    this._vfs = null;
    this._l3Storage = null;
    this._l3StoragePromise = null;
    this._initPromise = null;

    const l3Storage = options.l3Storage;
    if (l3Storage && typeof l3Storage === "object") {
      this._l3Storage = l3Storage;
    } else if (options.vfs && typeof options.vfs === "object") {
      this._vfs = options.vfs;
      this._l3Storage = null;
    }

    this._engine = new StateEngine({
      initialState: {
        ...(isPlainObject(options.initialState) ? options.initialState : null),
        runId: this.runId,
      },
      maxActionHistory: isFiniteNumber(options.maxActionHistory) ? options.maxActionHistory : 1000,
      enableActionHistory: options.enableActionHistory !== false,
      eventBus: this.eventBus,
      actorId: options.actorId || this.runId,
    });

    this._stats = {
      l0Tokens: 0,
      l1Tokens: 0,
      l2Tokens: 0,
      tokenUsage: 0,
      compressionCount: 0,
      recallCount: 0,
    };

    this._dirty = {
      L0: true,
      L1: true,
      L2: true,
      L3: false,
    };
    this._lastSnapshotTs = 0;

    this._l3BytesUsed = 0;

    this._unsubscribeEngine = this._engine.subscribe((action, prevState, nextState) => {
      const diff = diffLayers(prevState, nextState);
      for (const [layer, changed] of Object.entries(diff)) {
        if (changed) this._markDirty(layer);
      }
    });
  }

  dispatch(action) {
    return this._engine.dispatch(action);
  }

  dispatchSync(action) {
    return this._engine.dispatchSync(action);
  }

  dispatchBatch(actions) {
    return this._engine.dispatchBatch(actions);
  }

  dispatchBatchSync(actions) {
    return this._engine.dispatchBatchSync(actions);
  }

  subscribe(listenerOrLayer, layerListener) {
    return this._engine.subscribe(listenerOrLayer, layerListener);
  }

  subscribeLayer(layer, listener) {
    return this._engine.subscribeLayer(layer, listener);
  }

  getActionHistory(limit) {
    return this._engine.getActionHistory(limit);
  }

  replay(actions, initialState) {
    return this._engine.replay(actions, initialState);
  }

  getClockValue() {
    return this._engine.getClockValue();
  }

  receiveClockValue(externalSeq) {
    return this._engine.receiveClockValue(externalSeq);
  }

  getState() {
    return this._engine.getState();
  }

  /**
   * @private
   */
  _getStateRef() {
    // @ts-expect-error - accessing internal StateEngine method
    return this._engine._getStateRef();
  }

  /**
   * Initialize UnifiedMemoryStore and L3Storage if present.
   * @returns {Promise<void>}
   */
  async init() {
    if (this._initPromise) return this._initPromise;

    this._initPromise = (async () => {
      const l3 = this._l3Storage;
      if (l3 && typeof l3.init === "function") {
        await l3.init();
      }
    })();

    return this._initPromise;
  }

  /**
   * @private
   * @param {string} layer
   */
  _markDirty(layer) {
    void layer;
  }
}

applyQueryMethods(UnifiedMemoryStore);
applyWriteMethods(UnifiedMemoryStore);
applyIndexMethods(UnifiedMemoryStore);
applyLifecycleMethods(UnifiedMemoryStore);

export default UnifiedMemoryStore;
