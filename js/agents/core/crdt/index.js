/**
 * CRDT 共识层
 *
 * 基于 Operation-based CRDT，支持多 Agent 协作场景下的最终一致性。
 *
 * 核心类型：
 * - LWWRegister: Last-Writer-Wins 寄存器（适用于简单值）
 * - GCounter: 只增计数器（适用于累加场景）
 * - PNCounter: 正负计数器
 * - LWWMap: LWW 键值对（适用于状态管理）
 * - ORSet: Observed-Remove 集合（适用于 TODO 列表等）
 *
 * 设计原则：
 * - 使用 Lamport Clock 保证因果序
 * - 操作幂等，可安全重放
 * - 支持离线操作 + 在线合并
 */

export { LWWRegister } from './lww-register.js';
export { GCounter, PNCounter } from './counters.js';
export { LWWMap } from './lww-map.js';
export { ORSet } from './or-set.js';
export { CRDTDocument } from './document.js';
export { CRDTSyncManager, createMemoryTransport } from './sync-manager.js';

// 操作类型
export const OpType = {
  SET: 'set',
  DELETE: 'delete',
  INCREMENT: 'increment',
  DECREMENT: 'decrement',
  ADD: 'add',
  REMOVE: 'remove',
};

// 创建操作
export function createOp(type, key, value, clock) {
  return {
    type,
    key,
    value,
    clock: clock || { seq: 0, ts: Date.now(), id: '' },
    nodeId: clock?.id?.split('_')[0] || 'unknown',
  };
}

export default {
  OpType,
  createOp,
};
