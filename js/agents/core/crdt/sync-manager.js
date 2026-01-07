/**
 * CRDT Sync Manager - 多节点同步管理
 *
 * 处理：
 * - 节点发现与连接
 * - 操作广播
 * - 冲突解决
 * - 离线缓存与重连同步
 */

import { CRDTDocument } from './document.js';

/** @typedef {{ emit: (event: string, data?: unknown) => unknown }} CRDTEventBusLike */
/**
 * @typedef {{
 *   send: (message: CRDTSyncMessage) => void,
 *   onReceive?: (handler: (message: CRDTSyncMessage) => void) => void,
 *   close?: () => void
 * }} CRDTTransport
 */
/** @typedef {{ type: 'crdt:op', from: string, docId: string, op: unknown, ts: number }} CRDTOpMessage */
/** @typedef {{ type: 'crdt:sync-request', from: string, docId: string, sinceVersion: number, ts: number }} CRDTSyncRequestMessage */
/** @typedef {{ type: 'crdt:sync-response', from: string, to: string, docId: string, ops: unknown[], ts: number }} CRDTSyncResponseMessage */
/** @typedef {{ type: 'crdt:peer-join', from: string, ts: number }} CRDTPeerJoinMessage */
/** @typedef {{ type: 'crdt:peer-leave', from: string, ts: number }} CRDTPeerLeaveMessage */
/** @typedef {CRDTOpMessage | CRDTSyncRequestMessage | CRDTSyncResponseMessage | CRDTPeerJoinMessage | CRDTPeerLeaveMessage} CRDTSyncMessage */
/** @typedef {{ nodeId?: string, transport?: CRDTTransport, events?: CRDTEventBusLike }} CRDTSyncManagerOptions */
/**
 * @typedef {{
 *   nodeId: string,
 *   connected: boolean,
 *   peerCount: number,
 *   peers: string[],
 *   documentCount: number,
 *   pendingOps: number
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

    // 文档注册表
    /** @type {Map<string, CRDTDocument>} */
    this._documents = new Map(); // docId → CRDTDocument

    // 节点版本向量 (nodeId → version)
    /** @type {Map<string, number>} */
    this._versionVectors = new Map();

    // 待发送操作队列
    /** @type {CRDTOpMessage[]} */
    this._pendingOps = [];

    // 连接状态
    /** @type {boolean} */
    this._connected = false;
    /** @type {Set<string>} */
    this._peers = new Set();

    // 绑定传输层回调
    if (this._transport?.onReceive) {
      this._transport.onReceive(this._handleMessage.bind(this));
    }
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
      this._transport.send(message);
    } else {
      // 离线时缓存
      this._pendingOps.push(message);
    }

    this._emit('op:sent', { docId, op });
  }

  /**
   * 请求同步
   * @param {string} docId
   * @param {number} [sinceVersion=0]
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

    if (this._transport) {
      this._transport.send(message);
    }
  }

  /**
   * 发送同步响应
   * @param {string} to
   * @param {string} docId
   * @param {unknown[]} ops
   * @returns {void}
   */
  _sendSyncResponse(to, docId, ops) {
    /** @type {CRDTSyncResponseMessage} */
    const message = {
      type: 'crdt:sync-response',
      from: this._nodeId,
      to,
      docId,
      ops,
      ts: Date.now(),
    };

    if (this._transport) {
      this._transport.send(message);
    }
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

      case 'crdt:peer-join':
        this._handlePeerJoin(message);
        break;

      case 'crdt:peer-leave':
        this._handlePeerLeave(message);
        break;
    }
  }

  /**
   * @param {CRDTOpMessage} message
   * @returns {void}
   */
  _handleOp(message) {
    const doc = this._documents.get(message.docId);
    if (!doc) return;

    const applied = doc.applyOp(/** @type {any} */ (message.op));
    if (applied) {
      this._emit('op:applied', {
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

    const ops = doc.getOps(message.sinceVersion);
    this._sendSyncResponse(message.from, message.docId, ops);
  }

  /**
   * @param {CRDTSyncResponseMessage} message
   * @returns {void}
   */
  _handleSyncResponse(message) {
    // 只处理发给自己的响应
    if (message.to !== this._nodeId) return;

    const doc = this._documents.get(message.docId);
    if (!doc) return;

    const applied = doc.applyOps(/** @type {any} */ (message.ops));
    this._emit('sync:complete', {
      docId: message.docId,
      applied,
      from: message.from,
    });
  }

  /**
   * @param {CRDTPeerJoinMessage} message
   * @returns {void}
   */
  _handlePeerJoin(message) {
    this._peers.add(message.from);
    this._emit('peer:join', { nodeId: message.from });

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
    this._emit('peer:leave', { nodeId: message.from });
  }

  // ===== 连接管理 =====

  /**
   * 连接到同步网络
   * @returns {this}
   */
  connect() {
    this._connected = true;

    // 广播加入
    if (this._transport) {
      this._transport.send({
        type: 'crdt:peer-join',
        from: this._nodeId,
        ts: Date.now(),
      });
    }

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
    if (this._transport) {
      this._transport.send({
        type: 'crdt:peer-leave',
        from: this._nodeId,
        ts: Date.now(),
      });
    }

    this._connected = false;
    this._emit('disconnect');
    return this;
  }

  /**
   * 发送缓存的操作
   * @returns {void}
   */
  _flushPendingOps() {
    if (!this._connected || !this._transport) return;

    for (const message of this._pendingOps) {
      this._transport.send(message);
    }
    this._pendingOps = [];
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
    };
  }
}

/**
 * 创建内存传输层（用于测试）
 * @returns {{ register: (nodeId: string) => CRDTTransport }}
 */
export function createMemoryTransport() {
  /** @type {Set<unknown>} */
  const listeners = new Set();
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
