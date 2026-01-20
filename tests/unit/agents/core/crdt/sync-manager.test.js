import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/core/crdt/document.js', () => {
  class CRDTDocumentMock {
    constructor(options = {}) {
      this.docId = options.docId;
      this.nodeId = options.nodeId;
      this._applyOp = () => true;
      this._applyOps = () => [];
      this._getOps = () => [];
      this._snapshot = () => ({});
    }

    applyOp(op) {
      return this._applyOp(op);
    }

    applyOps(ops) {
      return this._applyOps(ops);
    }

    getOps(sinceVersion) {
      return this._getOps(sinceVersion);
    }

    snapshot() {
      return this._snapshot();
    }
  }

  return { CRDTDocument: CRDTDocumentMock };
});

import { CRDTSyncManager, createMemoryTransport } from '../../../../../js/agents/core/crdt/sync-manager.js';
import { CRDTDocument } from '../../../../../js/agents/core/crdt/document.js';

const makeEventBus = () => ({ emit: vi.fn() });

const makeTransport = () => {
  let handler;
  return {
    send: vi.fn(),
    onReceive: vi.fn(next => {
      handler = next;
    }),
    close: vi.fn(),
    trigger(message) {
      if (handler) {
        handler(message);
      }
    },
  };
};

const makeValidOp = (overrides = {}) => ({
  field: 'field',
  fieldType: 'register',
  type: 'set',
  value: 'value',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CRDTSyncManager', () => {
  it('initializes defaults and binds transport receiver', () => {
    const transport = makeTransport();
    const bus = makeEventBus();
    const manager = new CRDTSyncManager({ transport, events: bus });

    expect(manager.connected).toBe(false);
    expect(manager.peerCount).toBe(0);
    expect(manager.nodeId.startsWith('node_')).toBe(true);
    expect(transport.onReceive).toHaveBeenCalledTimes(1);

    const handler = transport.onReceive.mock.calls[0][0];
    handler({ type: 'crdt:peer-join', from: 'peer', ts: 1 });
    expect(manager.peerCount).toBe(1);
    expect(bus.emit).toHaveBeenCalledWith('crdt:peerJoin', { nodeId: 'peer' });
  });

  it('registerDocument accepts CRDTDocument and rejects invalid inputs', () => {
    const manager = new CRDTSyncManager({ nodeId: 'node-a' });
    const doc = new CRDTDocument({ docId: 'doc', nodeId: 'node-a' });

    const invalidDocs = [null, undefined, '', [], {}];
    for (const invalid of invalidDocs) {
      expect(() => manager.registerDocument(invalid)).toThrow(/Must be a CRDTDocument/);
    }

    expect(manager.registerDocument(doc)).toBe(manager);
    expect(manager.getDocument('doc')).toBe(doc);
    expect(manager.getDocument('missing')).toBeUndefined();
  });

  it('createDocument registers documents including empty and whitespace ids', () => {
    const manager = new CRDTSyncManager({ nodeId: 'node-a' });

    const emptyDoc = manager.createDocument('');
    const spaceDoc = manager.createDocument('   ');

    expect(emptyDoc.docId).toBe('');
    expect(spaceDoc.docId).toBe('   ');
    expect(emptyDoc.nodeId).toBe('node-a');
    expect(spaceDoc.nodeId).toBe('node-a');
    expect(manager.getDocument('')).toBe(emptyDoc);
    expect(manager.getDocument('   ')).toBe(spaceDoc);
    expect(manager.getStatus().documentCount).toBe(2);
  });

  it('broadcastOp sends when connected and supports simultaneous calls', async () => {
    const transport = makeTransport();
    const bus = makeEventBus();
    const manager = new CRDTSyncManager({ nodeId: 'node-a', transport, events: bus });
    manager._connected = true;

    const op1 = makeValidOp({ value: 'v1' });
    const op2 = makeValidOp({ value: 'v2' });

    await Promise.all([
      manager.broadcastOp('doc', op1),
      manager.broadcastOp('doc', op2),
    ]);

    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(transport.send.mock.calls[0][0]).toMatchObject({
      type: 'crdt:op',
      from: 'node-a',
      docId: 'doc',
      op: op1,
    });
    expect(transport.send.mock.calls[1][0]).toMatchObject({
      type: 'crdt:op',
      from: 'node-a',
      docId: 'doc',
      op: op2,
    });
    expect(bus.emit).toHaveBeenCalledWith('crdt:opSent', { docId: 'doc', op: op1 });
    expect(bus.emit).toHaveBeenCalledWith('crdt:opSent', { docId: 'doc', op: op2 });
  });

  it('queues pending ops while offline and drops oldest on overflow', () => {
    const transport = makeTransport();
    const bus = makeEventBus();
    const manager = new CRDTSyncManager({
      nodeId: 'node-a',
      transport,
      events: bus,
      maxPendingOps: 2,
    });

    const op1 = makeValidOp({ value: 'v1' });
    const op2 = makeValidOp({ value: 'v2' });
    const op3 = makeValidOp({ value: 'v3' });

    manager.broadcastOp('doc', op1);
    manager.broadcastOp('doc', op2);
    manager.broadcastOp('doc', op3);

    expect(manager.getStatus().pendingOps).toBe(2);
    expect(bus.emit).toHaveBeenCalledWith('crdt:pendingOverflow', { dropped: 1 });

    manager.connect();

    const sentOps = transport.send.mock.calls
      .map(([message]) => message)
      .filter(message => message.type === 'crdt:op')
      .map(message => message.op);

    expect(sentOps).toEqual([op2, op3]);
    expect(manager.getStatus().pendingOps).toBe(0);
  });

  it('requestSync sends sinceVersion boundaries and preserves string inputs', () => {
    const transport = makeTransport();
    const manager = new CRDTSyncManager({ nodeId: 'node-a', transport });

    manager.requestSync('doc');
    manager.requestSync('doc', -1);
    manager.requestSync('doc', Number.MAX_SAFE_INTEGER);
    manager.requestSync('doc', '1');
    manager.requestSync('   ', 0);

    const sinceVersions = transport.send.mock.calls.map(([message]) => message.sinceVersion);
    const docIds = transport.send.mock.calls.map(([message]) => message.docId);

    expect(sinceVersions).toEqual([0, -1, Number.MAX_SAFE_INTEGER, '1', 0]);
    expect(docIds[4]).toBe('   ');
  });

  it('_sendSyncResponse sends via transport and no-ops without one', () => {
    const transport = makeTransport();
    const manager = new CRDTSyncManager({ nodeId: 'node-a', transport });

    manager._sendSyncResponse('peer', 'doc', []);

    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'crdt:sync-response',
      from: 'node-a',
      to: 'peer',
      docId: 'doc',
      ops: [],
    }));

    const noTransport = new CRDTSyncManager({ nodeId: 'node-b' });
    expect(() => noTransport._sendSyncResponse('peer', 'doc', [])).not.toThrow();
  });

  it('_handleMessage ignores empty input and dispatches by type', () => {
    const manager = new CRDTSyncManager({ nodeId: 'node-a' });
    const opSpy = vi.spyOn(manager, '_handleOp');
    const requestSpy = vi.spyOn(manager, '_handleSyncRequest');
    const responseSpy = vi.spyOn(manager, '_handleSyncResponse');
    const joinSpy = vi.spyOn(manager, '_handlePeerJoin');
    const leaveSpy = vi.spyOn(manager, '_handlePeerLeave');

    manager._handleMessage(null);
    manager._handleMessage(undefined);
    manager._handleMessage({});
    manager._handleMessage({ type: 'crdt:unknown' });

    manager._handleMessage({ type: 'crdt:op', from: 'peer', docId: 'doc', op: {}, ts: 1 });
    manager._handleMessage({ type: 'crdt:sync-request', from: 'peer', docId: 'doc', sinceVersion: 0, ts: 1 });
    manager._handleMessage({ type: 'crdt:sync-response', from: 'peer', to: 'node-a', docId: 'doc', ops: [], ts: 1 });
    manager._handleMessage({ type: 'crdt:peer-join', from: 'peer', ts: 1 });
    manager._handleMessage({ type: 'crdt:peer-leave', from: 'peer', ts: 1 });

    expect(opSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(responseSpy).toHaveBeenCalledTimes(1);
    expect(joinSpy).toHaveBeenCalledTimes(1);
    expect(leaveSpy).toHaveBeenCalledTimes(1);
  });

  it('_handleOp applies valid ops with empty/whitespace fields', () => {
    const bus = makeEventBus();
    const manager = new CRDTSyncManager({ nodeId: 'node-a', events: bus });
    const doc = new CRDTDocument({ docId: 'doc', nodeId: 'node-a' });
    doc._applyOp = vi.fn().mockReturnValue(true);
    manager.registerDocument(doc);

    const op = makeValidOp({ field: '', fieldType: ' ' });
    manager._handleOp({ type: 'crdt:op', from: 'peer', docId: 'doc', op, ts: 1 });

    expect(doc._applyOp).toHaveBeenCalledWith(op);
    expect(bus.emit).toHaveBeenCalledWith('crdt:opApplied', {
      docId: 'doc',
      op,
      from: 'peer',
    });
  });

  it('_handleOp rejects invalid, oversized, and circular ops', () => {
    const bus = makeEventBus();
    const manager = new CRDTSyncManager({
      nodeId: 'node-a',
      events: bus,
      maxOpSize: 40,
    });
    const doc = new CRDTDocument({ docId: 'doc', nodeId: 'node-a' });
    doc._applyOp = vi.fn();
    manager.registerDocument(doc);

    const longStringOp = makeValidOp({ value: 'x'.repeat(10000) });
    const deepOp = makeValidOp({ value: { level: {} } });
    let cursor = deepOp.value;
    for (let i = 0; i < 20; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    const circularOp = makeValidOp();
    circularOp.self = circularOp;

    const invalidOps = [
      {},
      { field: 1, fieldType: 'register' },
      longStringOp,
      deepOp,
      circularOp,
    ];

    for (const op of invalidOps) {
      manager._handleOp({ type: 'crdt:op', from: 'peer', docId: 'doc', op, ts: 1 });
    }

    const rejected = bus.emit.mock.calls.filter(([event]) => event === 'crdt:opRejected');
    expect(rejected).toHaveLength(invalidOps.length);
    expect(rejected[0][1]).toEqual({ docId: 'doc', reason: 'invalid' });
    expect(doc._applyOp).not.toHaveBeenCalled();
  });

  it('_handleOp does not emit opApplied when applyOp returns false', () => {
    const bus = makeEventBus();
    const manager = new CRDTSyncManager({ nodeId: 'node-a', events: bus });
    const doc = new CRDTDocument({ docId: 'doc', nodeId: 'node-a' });
    doc._applyOp = vi.fn().mockReturnValue(false);
    manager.registerDocument(doc);

    const op = makeValidOp();
    manager._handleOp({ type: 'crdt:op', from: 'peer', docId: 'doc', op, ts: 1 });

    expect(doc._applyOp).toHaveBeenCalledWith(op);
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('_handleSyncRequest responds with document ops and handles string versions', () => {
    const manager = new CRDTSyncManager({ nodeId: 'node-a' });
    const doc = new CRDTDocument({ docId: 'doc', nodeId: 'node-a' });
    const ops = [makeValidOp()];
    doc._getOps = vi.fn().mockReturnValue(ops);
    manager.registerDocument(doc);

    const sendSpy = vi.spyOn(manager, '_sendSyncResponse').mockImplementation(() => {});

    manager._handleSyncRequest({
      type: 'crdt:sync-request',
      from: 'peer',
      docId: 'doc',
      sinceVersion: '1',
      ts: 1,
    });

    expect(doc._getOps).toHaveBeenCalledWith('1');
    expect(sendSpy).toHaveBeenCalledWith('peer', 'doc', ops);

    sendSpy.mockClear();
    manager._handleSyncRequest({
      type: 'crdt:sync-request',
      from: 'peer',
      docId: 'missing',
      sinceVersion: 0,
      ts: 1,
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('_handleSyncResponse ignores mismatched target or non-array ops', () => {
    const bus = makeEventBus();
    const manager = new CRDTSyncManager({ nodeId: 'node-a', events: bus });
    const doc = new CRDTDocument({ docId: 'doc', nodeId: 'node-a' });
    doc._applyOps = vi.fn().mockReturnValue(['applied']);
    manager.registerDocument(doc);

    manager._handleSyncResponse({
      type: 'crdt:sync-response',
      from: 'peer',
      to: 'someone-else',
      docId: 'doc',
      ops: [],
      ts: 1,
    });

    manager._handleSyncResponse({
      type: 'crdt:sync-response',
      from: 'peer',
      to: 'node-a',
      docId: 'doc',
      ops: {},
      ts: 1,
    });

    expect(doc._applyOps).not.toHaveBeenCalled();
    expect(bus.emit).not.toHaveBeenCalled();
  });

  it('_handleSyncResponse rejects oversized batches', () => {
    const bus = makeEventBus();
    const manager = new CRDTSyncManager({
      nodeId: 'node-a',
      events: bus,
      maxOpsPerSync: 1,
    });
    const doc = new CRDTDocument({ docId: 'doc', nodeId: 'node-a' });
    doc._applyOps = vi.fn().mockReturnValue([]);
    manager.registerDocument(doc);

    manager._handleSyncResponse({
      type: 'crdt:sync-response',
      from: 'peer',
      to: 'node-a',
      docId: 'doc',
      ops: [makeValidOp(), makeValidOp({ value: 'v2' })],
      ts: 1,
    });

    expect(bus.emit).toHaveBeenCalledWith('crdt:syncRejected', {
      docId: 'doc',
      reason: 'tooManyOps',
      count: 2,
    });
    expect(doc._applyOps).not.toHaveBeenCalled();
  });

  it('_handleSyncResponse filters invalid ops, supports empty arrays, and emits completion', () => {
    const bus = makeEventBus();
    const manager = new CRDTSyncManager({ nodeId: 'node-a', events: bus });
    const doc = new CRDTDocument({ docId: 'doc', nodeId: 'node-a' });
    doc._applyOps = vi.fn()
      .mockReturnValueOnce(['applied'])
      .mockReturnValueOnce([]);
    manager.registerDocument(doc);

    const validOp = makeValidOp();
    const invalidOp = { field: 'bad', fieldType: 3 };

    manager._handleSyncResponse({
      type: 'crdt:sync-response',
      from: 'peer',
      to: 'node-a',
      docId: 'doc',
      ops: [validOp, invalidOp],
      ts: 1,
    });

    expect(bus.emit).toHaveBeenCalledWith('crdt:syncPartial', {
      docId: 'doc',
      skipped: 1,
    });
    expect(doc._applyOps).toHaveBeenCalledWith([validOp]);
    expect(bus.emit).toHaveBeenCalledWith('crdt:syncComplete', {
      docId: 'doc',
      applied: ['applied'],
      from: 'peer',
    });

    manager._handleSyncResponse({
      type: 'crdt:sync-response',
      from: 'peer',
      to: 'node-a',
      docId: 'doc',
      ops: [],
      ts: 2,
    });

    expect(doc._applyOps).toHaveBeenCalledWith([]);
    expect(bus.emit).toHaveBeenCalledWith('crdt:syncComplete', {
      docId: 'doc',
      applied: [],
      from: 'peer',
    });
  });

  it('_handlePeerJoin requests sync for all documents and updates peers', () => {
    const bus = makeEventBus();
    const manager = new CRDTSyncManager({ nodeId: 'node-a', events: bus });
    manager.createDocument('doc-1');
    manager.createDocument('doc-2');

    const requestSpy = vi.spyOn(manager, 'requestSync');
    manager._handlePeerJoin({ type: 'crdt:peer-join', from: 'peer', ts: 1 });

    expect(manager.peerCount).toBe(1);
    expect(manager.getStatus().peers).toEqual(['peer']);
    expect(requestSpy).toHaveBeenCalledTimes(2);
    expect(bus.emit).toHaveBeenCalledWith('crdt:peerJoin', { nodeId: 'peer' });

    manager._handlePeerLeave({ type: 'crdt:peer-leave', from: 'peer', ts: 2 });
    expect(manager.peerCount).toBe(0);
    expect(bus.emit).toHaveBeenCalledWith('crdt:peerLeave', { nodeId: 'peer' });
  });

  it('connects, flushes pending ops, requests sync, and disconnects', () => {
    const transport = makeTransport();
    const bus = makeEventBus();
    const manager = new CRDTSyncManager({
      nodeId: 'node-a',
      transport,
      events: bus,
    });

    manager.createDocument('doc');
    const op = makeValidOp();
    manager.broadcastOp('doc', op);

    const requestSpy = vi.spyOn(manager, 'requestSync');
    manager.connect();

    expect(manager.connected).toBe(true);
    expect(bus.emit).toHaveBeenCalledWith('crdt:connect', undefined);
    expect(requestSpy).toHaveBeenCalledWith('doc', 0);

    const messages = transport.send.mock.calls.map(([message]) => message);
    expect(messages.some(message => message.type === 'crdt:peer-join')).toBe(true);
    expect(messages.some(message => message.type === 'crdt:op' && message.op === op)).toBe(true);
    expect(manager.getStatus().pendingOps).toBe(0);

    manager.disconnect();
    expect(manager.connected).toBe(false);
    expect(bus.emit).toHaveBeenCalledWith('crdt:disconnect', undefined);
    const finalMessages = transport.send.mock.calls.map(([message]) => message);
    expect(finalMessages.some(message => message.type === 'crdt:peer-leave')).toBe(true);
  });

  it('_flushPendingOps is a no-op without connection or transport', () => {
    const manager = new CRDTSyncManager({ nodeId: 'node-a' });
    manager.broadcastOp('doc', makeValidOp());

    manager._flushPendingOps();

    expect(manager.getStatus().pendingOps).toBe(1);
  });

  it('getAllSnapshots and getStatus report current state', () => {
    const manager = new CRDTSyncManager({ nodeId: 'node-a' });
    const docA = manager.createDocument('doc-a');
    const docB = manager.createDocument('doc-b');
    docA._snapshot = vi.fn().mockReturnValue({ v: 1 });
    docB._snapshot = vi.fn().mockReturnValue({ v: 2 });

    const snapshots = manager.getAllSnapshots();
    const status = manager.getStatus();

    expect(snapshots).toEqual({ 'doc-a': { v: 1 }, 'doc-b': { v: 2 } });
    expect(status).toMatchObject({
      nodeId: 'node-a',
      connected: false,
      documentCount: 2,
      pendingOps: 0,
    });
  });
});

describe('createMemoryTransport', () => {
  it('broadcasts to other nodes and stops after close', () => {
    vi.useFakeTimers();
    try {
      const network = createMemoryTransport();
      const transportA = network.register('A');
      const transportB = network.register('B');

      const receiveA = vi.fn();
      const receiveB = vi.fn();

      transportA.onReceive(receiveA);
      transportB.onReceive(receiveB);

      const message = { type: 'crdt:op', from: 'A', docId: 'doc', op: {}, ts: 1 };
      transportA.send(message);
      vi.runAllTimers();

      expect(receiveA).not.toHaveBeenCalled();
      expect(receiveB).toHaveBeenCalledWith(message);

      transportB.close();
      transportA.send({ ...message, ts: 2 });
      vi.runAllTimers();

      expect(receiveB).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
