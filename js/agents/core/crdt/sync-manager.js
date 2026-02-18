/**
 * CRDT Sync Manager - 多节点同步管理
 *
 * 基于 CRDTTransport 的 op-log 级别实时同步，使用 Lamport Clock 排序。
 * 与 VFS DeltaSync（vfs/delta-sync.js）互补而非竞争：
 *   - SyncManager: CRDT 状态同步（小粒度、实时）
 *   - DeltaSync: 文件二进制 diff（大粒度、批量）
 *
 * 处理：
 * - 节点发现与连接
 * - 操作广播
 * - 冲突解决
 * - 离线缓存与重连同步
 */

import { createLogger } from '../../shared/index.js';
import { CRDTDocument } from './document.js';

const logger = createLogger('core/crdt/sync-manager');

/** @typedef {{ emit: (event: string, data?: unknown) => unknown }} CRDTEventBusLike */
/**
 * @typedef {{
 *   send: (...args: unknown[]) => void,
 *   onReceive?: (handler: (message: CRDTSyncMessage) => void) => void,
 *   on?: (event: string, handler: (data?: unknown) => void) => void,
 *   off?: (event: string, handler: (data?: unknown) => void) => void,
 *   close?: () => void
 * }} CRDTTransport
 */
/** @typedef {{ type: 'crdt:op', from: string, docId: string, op: unknown, ts: number }} CRDTOpMessage */
/** @typedef {{ type: 'crdt:sync-request', from: string, docId: string, sinceVersion: number | string | null, ts: number }} CRDTSyncRequestMessage */
/** @typedef {{ type: 'crdt:sync-response', from: string, to: string, docId: string, ops: unknown[], complete?: boolean, ts: number }} CRDTSyncResponseMessage */
/** @typedef {{ type: 'crdt:snapshot-request', from: string, docId: string, ts: number }} CRDTSnapshotRequestMessage */
/** @typedef {{ type: 'crdt:snapshot-response', from: string, to: string, docId: string, snapshot: unknown, version?: number, ts: number }} CRDTSnapshotResponseMessage */
/** @typedef {{ type: 'crdt:peer-join', from: string, ts: number }} CRDTPeerJoinMessage */
/** @typedef {{ type: 'crdt:peer-leave', from: string, ts: number }} CRDTPeerLeaveMessage */
/** @typedef {CRDTOpMessage | CRDTSyncRequestMessage | CRDTSyncResponseMessage | CRDTSnapshotRequestMessage | CRDTSnapshotResponseMessage | CRDTPeerJoinMessage | CRDTPeerLeaveMessage} CRDTSyncMessage */
/** @typedef {'two-node' | 'multi-node-experimental'} CRDTTopologyMode */
/** @typedef {{ nodeId?: string, transport?: CRDTTransport, events?: CRDTEventBusLike, maxPendingOps?: number, maxOpsPerSync?: number, maxOpSize?: number, topologyMode?: CRDTTopologyMode }} CRDTSyncManagerOptions */
/**
 * @typedef {{
 *   nodeId: string,
 *   connected: boolean,
 *   peerCount: number,
 *   peers: string[],
 *   documentCount: number,
 *   pendingOps: number,
 *   topologyMode: CRDTTopologyMode
 * }} CRDTSyncStatus
 */

/**
 * CRDT Sync Manager - 多节点同步管理
 *
 * 负责：
 * - 文档注册与创建
 * - 操作广播与同步请求/响应
 * - peer join/leave 事件与离线队列
 */
export class CRDTSyncManager {
  /**
   * @param {CRDTSyncManagerOptions} [options={}]
   */
  constructor(options = {}) {
    /** @type {string} */
    this._nodeId = options.nodeId || `node_${Date.now()}`;
    /** @type {CRDTTransport | undefined} */
    this._transport = options.transport;
    /** @type {CRDTEventBusLike | undefined} */
    this._events = options.events;

    // 配额限制
    /** @type {number} */
    this._maxPendingOps = options.maxPendingOps || 500;
    /** @type {number} */
    this._maxOpsPerSync = options.maxOpsPerSync || 200;
    /** @type {number} */
    this._maxOpSize = options.maxOpSize || 65536; // 64KB per op
    /** @type {CRDTTopologyMode} */
    this._topologyMode = options.topologyMode === 'multi-node-experimental'
      ? 'multi-node-experimental'
      : 'two-node';

    // 文档注册表
    /** @type {Map<string, CRDTDocument>} */
    this._documents = new Map(); // docId → CRDTDocument

    /**
     * @limitation Single version number sync only supports 2-node topology.
     * For 3+ nodes, implement version vectors (per-node Lamport clocks).
     * See docs/agents-code-audit.md BUG-CRDT2 for details.
     */

    // 待发送操作队列
    /** @type {CRDTOpMessage[]} */
    this._pendingOps = [];

    // 连接状态
    /** @type {boolean} */
    this._connected = false;
    /** @type {Set<string>} */
    this._peers = new Set();

    // 绑定传输层回调（保留引用以便 dispose 时取消）
    /** @type {((message: CRDTSyncMessage) => void) | null} */
    this._boundMessageHandler = null;
    /** @type {((data?: unknown) => void) | null} */
    this._boundSyncResponseHandler = null;
    /** @type {((data?: unknown) => void) | null} */
    this._boundSnapshotResponseHandler = null;
    if (this._transport?.onReceive) {
      this._boundMessageHandler = this._handleMessage.bind(this);
      this._transport.onReceive(this._boundMessageHandler);
    }
    this._startPeerSync();
  }

  /**
   * @returns {string}
   */
  get nodeId() {
    return this._nodeId;
  }

  /**
   * @returns {boolean}
   */
  get connected() {
    return this._connected;
  }

  /**
   * @returns {number}
   */
  get peerCount() {
    return this._peers.size;
  }

  // ===== 文档管理 =====

  /**
   * 注册文档
   * @param {unknown} doc
   * @returns {this}
   */
  registerDocument(doc) {
    if (!(doc instanceof CRDTDocument)) {
      throw new Error('Must be a CRDTDocument');
    }
    this._documents.set(doc.docId, doc);
    return this;
  }

  /**
   * 获取文档
   * @param {string} docId
   * @returns {CRDTDocument | undefined}
   */
  getDocument(docId) {
    return this._documents.get(docId);
  }

  /**
   * 创建并注册新文档
   * @param {string} docId
   * @returns {CRDTDocument}
   */
  createDocument(docId) {
    const doc = new CRDTDocument({
      docId,
      nodeId: this._nodeId,
    });
    this._documents.set(docId, doc);
    return doc;
  }

  // ===== 操作同步 =====

  /**
   * 广播本地操作
   * @param {string} docId
   * @param {unknown} op
   * @returns {void}
   */
  broadcastOp(docId, op) {
    /** @type {CRDTOpMessage} */
    const message = {
      type: 'crdt:op',
      from: this._nodeId,
      docId,
      op,
      ts: Date.now(),
    };

    if (this._connected && this._transport) {
      this._sendTransportMessage(message);
    } else {
      // 离线时缓存，超限丢弃最旧消息
      if (this._pendingOps.length >= this._maxPendingOps) {
        this._pendingOps.shift();
        this._emit('pendingOverflow', { dropped: 1 });
      }
      this._pendingOps.push(message);
    }

    this._emit('opSent', { docId, op });
  }

  /**
   * 请求同步
   * @param {string} docId
   * @param {number | string | null} [sinceVersion=0]
   * @returns {void}
   */
  requestSync(docId, sinceVersion = 0) {
    /** @type {CRDTSyncRequestMessage} */
    const message = {
      type: 'crdt:sync-request',
      from: this._nodeId,
      docId,
      sinceVersion,
      ts: Date.now(),
    };

    this._sendTransportMessage(message);
  }

  /**
   * 发送同步响应
   * @param {string} to
   * @param {string} docId
   * @param {unknown[]} ops
   * @param {boolean} [complete=true]
   * @returns {void}
   */
  _sendSyncResponse(to, docId, ops, complete = true) {
    /** @type {CRDTSyncResponseMessage} */
    const message = {
      type: 'crdt:sync-response',
      from: this._nodeId,
      to,
      docId,
      ops,
      ts: Date.now(),
    };

    if (complete === false) {
      message.complete = false;
    }

    this._sendTransportMessage(message);
  }

  /**
   * 发送全量快照响应
   * @param {string} to
   * @param {string} docId
   * @param {unknown} snapshot
   * @param {number} [version]
   * @returns {void}
   */
  _sendSnapshotResponse(to, docId, snapshot, version) {
    /** @type {CRDTSnapshotResponseMessage} */
    const message = {
      type: 'crdt:snapshot-response',
      from: this._nodeId,
      to,
      docId,
      snapshot,
      version,
      ts: Date.now(),
    };

    this._sendTransportMessage(message);
  }

  // ===== 消息处理 =====

  /**
   * @param {CRDTSyncMessage | null | undefined} message
   * @returns {void}
   */
  _handleMessage(message) {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'crdt:op':
        this._handleOp(message);
        break;

      case 'crdt:sync-request':
        this._handleSyncRequest(message);
        break;

      case 'crdt:sync-response':
        this._handleSyncResponse(message);
        break;

      case 'crdt:snapshot-request':
        this._handleSnapshotRequest(message);
        break;

      case 'crdt:snapshot-response':
        this._handleSnapshotResponse(message);
        break;

      case 'crdt:peer-join':
        this._handlePeerJoin(message);
        break;

      case 'crdt:peer-leave':
        this._handlePeerLeave(message);
        break;
    }
  }

  /**
   * 校验单条 op 的必需字段与大小
   * @param {unknown} op
   * @returns {boolean}
   */
  _validateOp(op) {
    if (!op || typeof op !== 'object') return false;
    const o = /** @type {Record<string, unknown>} */ (op);
    // 必需字段
    if (typeof o.field !== 'string' || typeof o.fieldType !== 'string') return false;
    // 大小限制（序列化后）
    try {
      const size = JSON.stringify(op).length;
      if (size > this._maxOpSize) return false;
    } catch {
      return false;
    }
    return true;
  }

  /**
   * @param {CRDTOpMessage} message
   * @returns {void}
   */
  _handleOp(message) {
    const doc = this._documents.get(message.docId);
    if (!doc) return;

    if (!this._validateOp(message.op)) {
      this._emit('opRejected', { docId: message.docId, reason: 'invalid' });
      return;
    }

    const applied = doc.applyOp(/** @type {Parameters<CRDTDocument['applyOp']>[0]} */ (message.op));
    if (applied) {
      this._emit('opApplied', {
        docId: message.docId,
        op: message.op,
        from: message.from,
      });
    }
  }

  /**
   * @param {CRDTSyncRequestMessage} message
   * @returns {void}
   */
  _handleSyncRequest(message) {
    const doc = this._documents.get(message.docId);
    if (!doc) return;

    // sinceVersion = null 表示对端显式请求全量快照
    if (message.sinceVersion === null) {
      this._sendSnapshotResponse(message.from, message.docId, doc.snapshot(), doc.version);
      return;
    }

    const ops = doc.getOps(message.sinceVersion);
    const complete = this._isSyncResponseComplete(message.sinceVersion, ops, doc.version, doc.prunedUpToVersion);
    if (complete === false) {
      this._sendSyncResponse(message.from, message.docId, ops, false);
      return;
    }
    this._sendSyncResponse(message.from, message.docId, ops);
  }

  /**
   * @param {CRDTSyncResponseMessage} message
   * @returns {void}
   */
  _handleSyncResponse(message) {
    // 只处理发给自己的响应
    if (message.to !== this._nodeId) return;

    if (message.complete === false) {
      this._requestSnapshotFallback(message.docId);
      return;
    }

    const doc = this._documents.get(message.docId);
    if (!doc) return;

    // 校验 ops 数组长度与各条结构
    if (!Array.isArray(message.ops)) return;
    if (message.ops.length > this._maxOpsPerSync) {
      this._emit('syncRejected', { docId: message.docId, reason: 'tooManyOps', count: message.ops.length });
      return;
    }
    const validOps = message.ops.filter(op => this._validateOp(op));
    if (validOps.length !== message.ops.length) {
      this._emit('syncPartial', { docId: message.docId, skipped: message.ops.length - validOps.length });
    }

    const applied = doc.applyOps(/** @type {Parameters<CRDTDocument['applyOps']>[0]} */ (validOps));
    this._emit('syncComplete', {
      docId: message.docId,
      applied,
      from: message.from,
    });
  }

  /**
   * @param {CRDTSnapshotRequestMessage} message
   * @returns {void}
   */
  _handleSnapshotRequest(message) {
    this._handleSyncRequest({
      type: 'crdt:sync-request',
      from: message.from,
      docId: message.docId,
      sinceVersion: null,
      ts: message.ts,
    });
  }

  /**
   * @param {CRDTSnapshotResponseMessage} message
   * @returns {void}
   */
  _handleSnapshotResponse(message) {
    // 只处理发给自己的响应
    if (message.to !== this._nodeId) return;
    this._applySnapshotPayload(message.docId, message.snapshot, message.version);
  }

  /**
   * @param {CRDTPeerJoinMessage} message
   * @returns {void}
   */
  _handlePeerJoin(message) {
    if (!message?.from || message.from === this._nodeId) return;
    if (this._topologyMode === 'two-node' && !this._peers.has(message.from) && this._peers.size >= 1) {
      logger.warn(`Rejected peer ${message.from}: topologyMode=two-node supports only one remote peer`);
      this._emit('topologyRejected', {
        nodeId: message.from,
        mode: this._topologyMode,
        maxPeers: 1,
      });
      return;
    }

    this._peers.add(message.from);
    this._emit('peerJoin', { nodeId: message.from });

    // 向新节点发送所有文档的同步请求
    for (const docId of this._documents.keys()) {
      this.requestSync(docId, 0);
    }
  }

  /**
   * @param {CRDTPeerLeaveMessage} message
   * @returns {void}
   */
  _handlePeerLeave(message) {
    this._peers.delete(message.from);
    this._emit('peerLeave', { nodeId: message.from });
  }

  /**
   * 为支持 EventEmitter 风格 transport（on/off）绑定响应处理器。
   * @returns {void}
   */
  _startPeerSync() {
    if (typeof this._transport?.on !== 'function') return;
    if (typeof this._transport?.onReceive === 'function') {
      // Prefer onReceive pipeline to avoid duplicate processing when transport supports both APIs.
      return;
    }

    this._boundSyncResponseHandler = (data) => {
      const payload = /** @type {{ docId?: string, ops?: unknown[], complete?: boolean }} */ (data || {});
      const { docId, ops, complete } = payload;
      if (!docId) return;

      // If response is explicitly incomplete (ops were trimmed), request full snapshot
      if (complete === false) {
        logger.warn(`Incomplete ops for doc ${docId}, requesting full snapshot`);
        this._requestSnapshotFallback(docId);
        return;
      }

      if (!Array.isArray(ops)) return;
      const doc = this._documents.get(docId);
      if (doc) {
        try {
          doc.applyOps(/** @type {Parameters<CRDTDocument['applyOps']>[0]} */ (ops));
        } catch (err) {
          logger.error(`Failed to apply ops for doc ${docId}:`, { error: err?.message });
        }
      }
    };

    this._transport.on?.('crdt:sync-response', this._boundSyncResponseHandler);

    // Handle snapshot responses (full document state)
    this._boundSnapshotResponseHandler = (data) => {
      const payload = /** @type {{ docId?: string, snapshot?: unknown, version?: number }} */ (data || {});
      const { docId, snapshot, version } = payload;
      if (!docId || !snapshot) return;
      this._applySnapshotPayload(docId, snapshot, version);
    };

    this._transport.on?.('crdt:snapshot-response', this._boundSnapshotResponseHandler);
  }

  /**
   * @param {string} docId
   * @returns {void}
   */
  _requestSnapshotFallback(docId) {
    if (!docId) return;

    try {
      this.requestSync(docId, null);
    } catch (err) {
      logger.error(`Failed to request snapshot for doc ${docId}:`, { error: err?.message });
    }
  }

  /**
   * @param {string} docId
   * @param {unknown} snapshot
   * @param {number | undefined} version
   * @returns {void}
   */
  _applySnapshotPayload(docId, snapshot, version) {
    const doc = this._documents.get(docId);
    if (!doc) return;

    const snapshotDoc = /** @type {CRDTDocument & { applySnapshot?: (value: unknown, version?: number) => void }} */ (doc);
    if (typeof snapshotDoc.applySnapshot === 'function') {
      try {
        snapshotDoc.applySnapshot(snapshot, version);
        logger.debug(`Applied full snapshot for doc ${docId} at version ${version}`);
      } catch (err) {
        logger.error(`Failed to apply snapshot for doc ${docId}:`, { error: err?.message });
      }
      return;
    }

    logger.warn(`Snapshot received for doc ${docId}, but applySnapshot() is unavailable`);
  }

  /**
   * 判断 sync-response 是否完整（无日志裁剪缺口）。
   * @param {number | string | null | undefined} sinceVersion
   * @param {unknown[]} ops
   * @param {number} latestVersion
   * @param {number} [prunedUpToVersion=0] 文档 opLog 已裁剪掉的最高 version
   * @returns {boolean}
   */
  _isSyncResponseComplete(sinceVersion, ops, latestVersion, prunedUpToVersion = 0) {
    if (!Array.isArray(ops)) return false;
    if (sinceVersion === null || sinceVersion === undefined) return false;

    const numericSince = typeof sinceVersion === 'number' ? sinceVersion : Number(sinceVersion);
    if (!Number.isFinite(numericSince)) return true;

    // 请求的版本在裁剪水位之前，说明存在不可恢复的缺口
    if (numericSince < prunedUpToVersion) return false;

    if (ops.length === 0) {
      return numericSince >= latestVersion;
    }

    const firstOp = /** @type {{ version?: number } | undefined} */ (ops[0]);
    const firstVersion = typeof firstOp?.version === 'number' ? firstOp.version : null;
    if (firstVersion === null) {
      // 无法确认连续性时，保守视为完整，避免错误触发全量快照。
      return true;
    }

    const expectedFirstVersion = numericSince >= 0 ? numericSince + 1 : 1;
    return firstVersion <= expectedFirstVersion;
  }

  // ===== 连接管理 =====

  /**
   * 连接到同步网络
   * @returns {this}
   */
  connect() {
    this._connected = true;

    // 广播加入
    this._sendTransportMessage({
      type: 'crdt:peer-join',
      from: this._nodeId,
      ts: Date.now(),
    });

    // 发送缓存的操作
    this._flushPendingOps();

    // 主动拉取所有文档的全量同步（用于新节点加入/重连追赶）
    for (const docId of this._documents.keys()) {
      this.requestSync(docId, 0);
    }

    this._emit('connect');
    return this;
  }

  /**
   * 断开连接
   * @returns {this}
   */
  disconnect() {
    this._sendTransportMessage({
      type: 'crdt:peer-leave',
      from: this._nodeId,
      ts: Date.now(),
    });

    this._connected = false;
    this._emit('disconnect');
    return this;
  }

  /**
   * 释放所有资源，清理 transport 订阅
   * @returns {void}
   */
  dispose() {
    if (this._connected) {
      this.disconnect();
    }
    if (this._boundSyncResponseHandler) {
      this._transport?.off?.('crdt:sync-response', this._boundSyncResponseHandler);
    }
    if (this._boundSnapshotResponseHandler) {
      this._transport?.off?.('crdt:snapshot-response', this._boundSnapshotResponseHandler);
    }
    // 清理 transport 订阅，防止内存泄漏
    if (this._transport?.close) {
      this._transport.close();
    }
    this._boundMessageHandler = null;
    this._boundSyncResponseHandler = null;
    this._boundSnapshotResponseHandler = null;
    this._documents.clear();
    this._peers.clear();
    this._pendingOps = [];
    this._transport = undefined;
    this._events = undefined;
  }

  /**
   * 发送缓存的操作
   * @returns {void}
   */
  _flushPendingOps() {
    if (!this._connected || !this._transport) return;

    for (const message of this._pendingOps) {
      this._sendTransportMessage(message);
    }
    this._pendingOps = [];
  }

  /**
   * 兼容两种 transport 发送风格：
   * - send(message)
   * - send(eventName, payload)
   * @param {CRDTSyncMessage} message
   * @returns {void}
   */
  _sendTransportMessage(message) {
    if (!this._transport?.send) return;
    if (typeof this._transport.on === 'function' && !this._transport.onReceive) {
      const { type, ...data } = message;
      this._transport.send(type, data);
      return;
    }
    this._transport.send(message);
  }

  // ===== 事件 =====

  /**
   * @param {string} event
   * @param {unknown} [data]
   * @returns {void}
   */
  _emit(event, data) {
    if (this._events) {
      this._events.emit(`crdt:${event}`, data);
    }
  }

  // ===== 工具方法 =====

  /**
   * 获取所有文档快照
   * @returns {Record<string, ReturnType<CRDTDocument['snapshot']>>}
   */
  getAllSnapshots() {
    /** @type {Record<string, ReturnType<CRDTDocument['snapshot']>>} */
    const result = {};
    for (const [docId, doc] of this._documents) {
      result[docId] = doc.snapshot();
    }
    return result;
  }

  /**
   * 获取状态
   * @returns {CRDTSyncStatus}
   */
  getStatus() {
    return {
      nodeId: this._nodeId,
      connected: this._connected,
      peerCount: this._peers.size,
      peers: Array.from(this._peers),
      documentCount: this._documents.size,
      pendingOps: this._pendingOps.length,
      topologyMode: this._topologyMode,
    };
  }
}

/**
 * 创建内存传输层（用于测试）
 * @returns {{ register: (nodeId: string) => CRDTTransport }}
 */
export function createMemoryTransport() {
  /** @type {Map<string, (message: CRDTSyncMessage) => void>} */
  const channels = new Map(); // nodeId → handler

  return {
    /**
     * 注册节点
     * @param {string} nodeId
     * @returns {CRDTTransport}
     */
    register(nodeId) {
      return {
        /**
         * @param {CRDTSyncMessage} message
         * @returns {void}
         */
        send(message) {
          // 广播给其他节点
          for (const [id, handler] of channels) {
            if (id !== nodeId) {
              setTimeout(() => handler(message), 0);
            }
          }
        },
        /**
         * @param {(message: CRDTSyncMessage) => void} handler
         * @returns {void}
         */
        onReceive(handler) {
          channels.set(nodeId, handler);
        },
        /**
         * @returns {void}
         */
        close() {
          channels.delete(nodeId);
        },
      };
    },
  };
}

export default CRDTSyncManager;
