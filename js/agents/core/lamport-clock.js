/**
 * Lamport 逻辑时钟
 *
 * 提供跨线程/跨组件的单调递增逻辑序列号，确保事件因果序的物理锁定。
 * 不再依赖物理时钟的启发式排序。
 */

import { cryptoRandomHex } from "../shared/utils/secure-id.js";

/** @typedef {import("./types.d.ts").LamportClockState} LamportClockState */
/** @typedef {{ _clock?: LamportClockState | null, seq?: number | null, ts?: number | null }} LogicalOrderEvent */

/** @type {LamportClockService | null} */
let _defaultService = null;

/**
 * Lazily create and return the default LamportClockService instance.
 * @returns {LamportClockService}
 */
function getDefaultService() {
  if (!_defaultService) {
    _defaultService = new LamportClockService();
  }
  return _defaultService;
}

/**
 * Get the default (global) LamportClockService instance.
 * Modules should prefer injecting a clockService via DI;
 * this getter exists for backward compat and as the DI container's default binding.
 * @returns {LamportClockService}
 */
export function getDefaultClockService() {
  return getDefaultService();
}

/**
 * Replace the default LamportClockService (useful for testing isolation).
 * @param {LamportClockService} service
 */
export function setDefaultClockService(service) {
  if (service instanceof LamportClockService) {
    _defaultService = service;
  }
}

/**
 * Lamport clock service.
 *
 * Each instance maintains its own sequence, so it's safe to register in a DI container.
 */
export class LamportClockService {
  constructor() {
    /** @type {number} */
    this._seq = 0;
    /** @type {string | null} */
    this._instanceId = null;
  }

  /**
   * 获取实例 ID（用于跨 Worker 场景的序列号唯一性）
   * @returns {string}
   */
  _getInstanceId() {
    if (this._instanceId === null) {
      // 生成 8 字符的随机实例 ID
      this._instanceId = cryptoRandomHex(4);
    }
    return this._instanceId;
  }

  /**
   * 生成下一个逻辑时钟值
   * @returns {LamportClockState}
   */
  nextTick() {
    this._seq += 1;
    return {
      seq: this._seq,
      ts: typeof performance !== "undefined" ? performance.now() : Date.now(),
      id: `${this._getInstanceId()}_${this._seq}`,
    };
  }

  /**
   * 同步时钟（用于跨 Worker 场景）
   * 当收到其他 Worker 的消息时，更新本地时钟以保证因果序
   * @param {number} remoteSeq - 远端的序列号
   * @returns {void}
   */
  sync(remoteSeq) {
    if (typeof remoteSeq === "number" && Number.isFinite(remoteSeq) && remoteSeq > this._seq) {
      this._seq = remoteSeq;
    }
  }

  /**
   * 获取当前序列号（不递增）
   * @returns {number}
   */
  currentSeq() {
    return this._seq;
  }

  /**
   * 重置时钟（仅用于测试）
   * @returns {void}
   */
  resetClock() {
    this._seq = 0;
    this._instanceId = null;
  }
}

/**
 * 生成下一个逻辑时钟值
 * @returns {LamportClockState}
 */
export function nextTick() {
  return getDefaultService().nextTick();
}

/**
 * 同步时钟（用于跨 Worker 场景）
 * 当收到其他 Worker 的消息时，更新本地时钟以保证因果序
 * @param {number} remoteSeq - 远端的序列号
 * @returns {void}
 */
export function sync(remoteSeq) {
  getDefaultService().sync(remoteSeq);
}

/**
 * 获取当前序列号（不递增）
 * @returns {number}
 */
export function currentSeq() {
  return getDefaultService().currentSeq();
}

/**
 * 重置时钟（仅用于测试）
 * @returns {void}
 */
export function resetClock() {
  _defaultService = null;
}

/**
 * 比较两个时钟值的因果序
 * @param {{ seq?: number | null } | null | undefined} a
 * @param {{ seq?: number | null } | null | undefined} b
 * @returns {number} -1 if a < b, 0 if equal, 1 if a > b
 */
export function compare(a, b) {
  const seqA = a?.seq ?? 0;
  const seqB = b?.seq ?? 0;
  if (seqA < seqB) return -1;
  if (seqA > seqB) return 1;
  return 0;
}

/**
 * 为事件对象附加逻辑时钟
 * @template {Record<string, unknown>} T
 * @param {T} event
 * @returns {T & { _clock: LamportClockState }}
 */
export function stampEvent(event) {
  if (!event || typeof event !== "object") {
    return { ...event, _clock: nextTick() };
  }
  return { ...event, _clock: nextTick() };
}

/**
 * 按逻辑时钟排序事件数组
 * @template {LogicalOrderEvent} T
 * @param {ReadonlyArray<T> | null | undefined} events
 * @returns {T[]}
 */
export function sortByLogicalOrder(events) {
  if (!Array.isArray(events)) return [];
  return [...events].sort((a, b) => {
    const seqA = a?._clock?.seq ?? a?.seq ?? 0;
    const seqB = b?._clock?.seq ?? b?.seq ?? 0;
    if (seqA !== seqB) return seqA - seqB;
    // 回退到物理时间戳
    const tsA = a?._clock?.ts ?? a?.ts ?? 0;
    const tsB = b?._clock?.ts ?? b?.ts ?? 0;
    return tsA - tsB;
  });
}

/**
 * LamportClock 类 - 实例化的 Lamport 时钟
 *
 * 每个实例维护独立的序列号，适用于需要隔离时钟的场景。
 */
export class LamportClock {
  /**
   * @param {string} [nodeId]
   */
  constructor(nodeId) {
    /** @type {string} */
    this._nodeId = nodeId || cryptoRandomHex(4);
    /** @type {number} */
    this._seq = 0;
  }

  /**
   * 生成下一个时钟状态
   * @returns {LamportClockState}
   */
  tick() {
    this._seq += 1;
    return {
      seq: this._seq,
      ts: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      id: `${this._nodeId}_${this._seq}`,
    };
  }

  /**
   * 根据远端时钟更新本地时钟
   * @param {LamportClockState} remote
   * @returns {LamportClockState}
   */
  update(remote) {
    if (remote && typeof remote.seq === 'number' && remote.seq > this._seq) {
      this._seq = remote.seq;
    }
    return this.tick();
  }

  /**
   * 获取当前时钟状态（不递增）
   * @returns {LamportClockState}
   */
  get() {
    return {
      seq: this._seq,
      ts: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      id: `${this._nodeId}_${this._seq}`,
    };
  }
}

export default {
  nextTick,
  sync,
  currentSeq,
  resetClock,
  compare,
  stampEvent,
  sortByLogicalOrder,
  LamportClock,
  LamportClockService,
  getDefaultClockService,
  setDefaultClockService,
};
