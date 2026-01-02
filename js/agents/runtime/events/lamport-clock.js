/**
 * Lamport 逻辑时钟
 *
 * 提供跨线程/跨组件的单调递增逻辑序列号，确保事件因果序的物理锁定。
 * 不再依赖物理时钟的启发式排序。
 */

let _globalSeq = 0;
let _instanceId = null;

/**
 * 获取实例 ID（用于跨 Worker 场景的序列号唯一性）
 */
function getInstanceId() {
  if (_instanceId === null) {
    // 生成 8 字符的随机实例 ID
    _instanceId = Math.random().toString(36).slice(2, 10);
  }
  return _instanceId;
}

/**
 * 生成下一个逻辑时钟值
 * @returns {{ seq: number, ts: number, id: string }}
 */
export function nextTick() {
  _globalSeq += 1;
  return {
    seq: _globalSeq,
    ts: typeof performance !== "undefined" ? performance.now() : Date.now(),
    id: `${getInstanceId()}_${_globalSeq}`,
  };
}

/**
 * 同步时钟（用于跨 Worker 场景）
 * 当收到其他 Worker 的消息时，更新本地时钟以保证因果序
 * @param {number} remoteSeq - 远端的序列号
 */
export function sync(remoteSeq) {
  if (typeof remoteSeq === "number" && Number.isFinite(remoteSeq) && remoteSeq > _globalSeq) {
    _globalSeq = remoteSeq;
  }
}

/**
 * 获取当前序列号（不递增）
 * @returns {number}
 */
export function currentSeq() {
  return _globalSeq;
}

/**
 * 重置时钟（仅用于测试）
 */
export function resetClock() {
  _globalSeq = 0;
  _instanceId = null;
}

/**
 * 比较两个时钟值的因果序
 * @param {{ seq: number }} a
 * @param {{ seq: number }} b
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
 * @template T
 * @param {T} event
 * @returns {T & { _clock: { seq: number, ts: number, id: string } }}
 */
export function stampEvent(event) {
  if (!event || typeof event !== "object") {
    return { ...event, _clock: nextTick() };
  }
  return { ...event, _clock: nextTick() };
}

/**
 * 按逻辑时钟排序事件数组
 * @template T
 * @param {T[]} events
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

export default {
  nextTick,
  sync,
  currentSeq,
  resetClock,
  compare,
  stampEvent,
  sortByLogicalOrder,
};
