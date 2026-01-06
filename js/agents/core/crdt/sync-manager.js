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

export class CRDTSyncManager {
  /**
   * @param {Object} options
   * @param {string} options.nodeId - 本节点 ID
   * @param {Object} options.transport - 传输层（需实现 send/onReceive）
   * @param {EventBus} [options.events] - 事件总线
   */
  constructor(options = {}) {
    this._nodeId = options.nodeId || `node_${Date.now()}`;
    this._transport = options.transport;
    this._events = options.events;

    // 文档注册表
    this._documents = new Map(); // docId → CRDTDocument

    // 节点版本向量 (nodeId → version)
    this._versionVectors = new Map();

    // 待发送操作队列
    this._pendingOps = [];

    // 连接状态
    this._connected = false;
    this._peers = new Set();

    // 绑定传输层回调
    if (this._transport?.onReceive) {
      this._transport.onReceive(this._handleMessage.bind(this));
    }
  }

  get nodeId() {
    return this._nodeId;
  }

  get connected() {
    return this._connected;
  }

  get peerCount() {
    return this._peers.size;
  }

  // ===== 文档管理 =====

  /**
   * 注册文档
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
   */
  getDocument(docId) {
    return this._documents.get(docId);
  }

  /**
   * 创建并注册新文档
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
   */
  broadcastOp(docId, op) {
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
   */
  requestSync(docId, sinceVersion = 0) {
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
   */
  _sendSyncResponse(to, docId, ops) {
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

  _handleOp(message) {
    const doc = this._documents.get(message.docId);
    if (!doc) return;

    const applied = doc.applyOp(message.op);
    if (applied) {
      this._emit('op:applied', {
        docId: message.docId,
        op: message.op,
        from: message.from,
      });
    }
  }

  _handleSyncRequest(message) {
    const doc = this._documents.get(message.docId);
    if (!doc) return;

    const ops = doc.getOps(message.sinceVersion);
    this._sendSyncResponse(message.from, message.docId, ops);
  }

  _handleSyncResponse(message) {
    // 只处理发给自己的响应
    if (message.to !== this._nodeId) return;

    const doc = this._documents.get(message.docId);
    if (!doc) return;

    const applied = doc.applyOps(message.ops);
    this._emit('sync:complete', {
      docId: message.docId,
      applied,
      from: message.from,
    });
  }

  _handlePeerJoin(message) {
    this._peers.add(message.from);
    this._emit('peer:join', { nodeId: message.from });

    // 向新节点发送所有文档的同步请求
    for (const docId of this._documents.keys()) {
      this.requestSync(docId, 0);
    }
  }

  _handlePeerLeave(message) {
    this._peers.delete(message.from);
    this._emit('peer:leave', { nodeId: message.from });
  }

  // ===== 连接管理 =====

  /**
   * 连接到同步网络
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

    this._emit('connect');
    return this;
  }

  /**
   * 断开连接
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
   */
  _flushPendingOps() {
    if (!this._connected || !this._transport) return;

    for (const message of this._pendingOps) {
      this._transport.send(message);
    }
    this._pendingOps = [];
  }

  // ===== 事件 =====

  _emit(event, data) {
    if (this._events) {
      this._events.emit(`crdt:${event}`, data);
    }
  }

  // ===== 工具方法 =====

  /**
   * 获取所有文档快照
   */
  getAllSnapshots() {
    const result = {};
    for (const [docId, doc] of this._documents) {
      result[docId] = doc.snapshot();
    }
    return result;
  }

  /**
   * 获取状态
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
 */
export function createMemoryTransport() {
  const listeners = new Set();
  const channels = new Map(); // nodeId → handler

  return {
    /**
     * 注册节点
     */
    register(nodeId) {
      return {
        send(message) {
          // 广播给其他节点
          for (const [id, handler] of channels) {
            if (id !== nodeId) {
              setTimeout(() => handler(message), 0);
            }
          }
        },
        onReceive(handler) {
          channels.set(nodeId, handler);
        },
        close() {
          channels.delete(nodeId);
        },
      };
    },
  };
}

export default CRDTSyncManager;
