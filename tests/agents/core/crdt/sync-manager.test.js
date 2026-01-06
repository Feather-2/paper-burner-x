import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetClock } from '../../../../js/agents/core/lamport-clock.js';
import { CRDTDocument } from '../../../../js/agents/core/crdt/document.js';
import { CRDTSyncManager, createMemoryTransport } from '../../../../js/agents/core/crdt/sync-manager.js';

function flushNetwork() {
  vi.runAllTimers();
}

function makeEventBus() {
  return { emit: vi.fn() };
}

function pickSnapshotData(snapshot) {
  return {
    version: snapshot.version,
    registers: snapshot.registers,
    maps: snapshot.maps,
    sets: snapshot.sets,
    counters: snapshot.counters,
  };
}

function lastOp(doc) {
  const ops = doc.getOps(doc.version - 1);
  return ops[0];
}

beforeEach(() => {
  resetClock();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CRDTSyncManager (integration)', () => {
  it('broadcasts ops across 3 nodes and converges snapshots', () => {
    const network = createMemoryTransport();

    const busA = makeEventBus();
    const busB = makeEventBus();
    const busC = makeEventBus();

    const a = new CRDTSyncManager({ nodeId: 'A', transport: network.register('A'), events: busA });
    const b = new CRDTSyncManager({ nodeId: 'B', transport: network.register('B'), events: busB });
    const c = new CRDTSyncManager({ nodeId: 'C', transport: network.register('C'), events: busC });

    const docA = a.createDocument('doc');
    const docB = b.createDocument('doc');
    const docC = c.createDocument('doc');

    expect(a.nodeId).toBe('A');
    expect(a.getDocument('doc')).toBe(docA);
    expect(b.getDocument('doc')).toBe(docB);

    a.connect();
    b.connect();
    c.connect();
    flushNetwork();

    docA.setRegister('title', 'hello');
    const op1 = lastOp(docA);
    a.broadcastOp('doc', op1);

    docA.setMapValue('meta', 'k', 'v1');
    const op2 = lastOp(docA);
    a.broadcastOp('doc', op2);

    docA.addToSet('tags', 'x');
    const op3 = lastOp(docA);
    a.broadcastOp('doc', op3);

    docA.incrementCounter('cnt', 2);
    const op4 = lastOp(docA);
    a.broadcastOp('doc', op4);

    flushNetwork();

    const dataA = pickSnapshotData(docA.snapshot());
    expect(pickSnapshotData(docB.snapshot())).toEqual(dataA);
    expect(pickSnapshotData(docC.snapshot())).toEqual(dataA);

    const appliedBefore = busB.emit.mock.calls.filter(([name]) => name === 'crdt:op:applied').length;
    a.broadcastOp('doc', op4); // duplicate should be idempotent
    flushNetwork();
    const appliedAfter = busB.emit.mock.calls.filter(([name]) => name === 'crdt:op:applied').length;
    expect(appliedAfter).toBe(appliedBefore);

    expect(a.getAllSnapshots().doc.registers).toEqual({ title: 'hello' });
    expect(a.getStatus()).toMatchObject({ nodeId: 'A', connected: true, documentCount: 1 });
    expect(a.peerCount).toBe(2);
  });

  it('queues pending ops while offline and flushes on connect, then peer-leave updates peers', () => {
    const network = createMemoryTransport();

    const busA = makeEventBus();
    const busB = makeEventBus();

    const transportA = network.register('A');
    const transportB = network.register('B');

    const a = new CRDTSyncManager({ nodeId: 'A', transport: transportA, events: busA });
    const b = new CRDTSyncManager({ nodeId: 'B', transport: transportB, events: busB });

    const docA = a.createDocument('doc');
    const docB = b.createDocument('doc');

    b.connect();
    flushNetwork();

    // Still offline: pending queue should grow but remote should not receive anything.
    docA.setRegister('r', 'offline');
    const offlineOp = lastOp(docA);
    a.broadcastOp('doc', offlineOp);

    expect(a.connected).toBe(false);
    expect(a.getStatus().pendingOps).toBe(1);
    flushNetwork();
    expect(docB.getRegister('r')).toBeUndefined();

    // Exercise the early return in _flushPendingOps().
    a._flushPendingOps();
    expect(a.getStatus().pendingOps).toBe(1);

    a.connect();
    flushNetwork();
    expect(a.getStatus().pendingOps).toBe(0);
    expect(docB.getRegister('r')).toBe('offline');
    expect(b.peerCount).toBe(1);

    a.disconnect();
    flushNetwork();
    expect(b.peerCount).toBe(0);
    expect(busB.emit).toHaveBeenCalledWith('crdt:peer:leave', { nodeId: 'A' });
  });

  it('sync-request/response + peer-join full sync converges a late peer', () => {
    const network = createMemoryTransport();

    const busA = makeEventBus();
    const busB = makeEventBus();

    const a = new CRDTSyncManager({ nodeId: 'A', transport: network.register('A'), events: busA });
    const b = new CRDTSyncManager({ nodeId: 'B', transport: network.register('B'), events: busB });

    const docA = a.createDocument('doc');
    const docB = b.createDocument('doc');

    a.connect();
    b.connect();
    flushNetwork();

    docA.setRegister('title', 'from-A');
    a.broadcastOp('doc', lastOp(docA));
    docB.setMapValue('meta', 'k', 'from-B');
    b.broadcastOp('doc', lastOp(docB));
    docA.addToSet('tags', 'x');
    a.broadcastOp('doc', lastOp(docA));
    docB.incrementCounter('cnt', 3);
    b.broadcastOp('doc', lastOp(docB));
    flushNetwork();

    const convergedAB = pickSnapshotData(docA.snapshot());
    expect(pickSnapshotData(docB.snapshot())).toEqual(convergedAB);

    // Late peer joins after ops have already happened: should catch up via full sync.
    const busC = makeEventBus();
    const transportC = network.register('C');
    const c = new CRDTSyncManager({ nodeId: 'C', transport: transportC, events: busC });
    const docC = c.createDocument('doc');

    c.connect();
    flushNetwork();

    expect(pickSnapshotData(docC.snapshot())).toEqual(convergedAB);

    const syncEvents = busC.emit.mock.calls.filter(([name]) => name === 'crdt:sync:complete');
    expect(syncEvents.length).toBeGreaterThan(0);
    expect(syncEvents.some(([, payload]) => payload.docId === 'doc')).toBe(true);

    // Ensure createMemoryTransport.close() is covered.
    transportC.close();

    // Cover message filtering paths (invalid/unknown/missing doc/to mismatch).
    c._handleMessage(null);
    c._handleMessage({});
    c._handleMessage({ type: 'crdt:unknown' });
    c._handleMessage({ type: 'crdt:op', docId: 'missing', from: 'X', op: {} });
    c._handleMessage({ type: 'crdt:sync-request', docId: 'missing', from: 'X', sinceVersion: 0 });
    c._handleMessage({ type: 'crdt:sync-response', docId: 'missing', from: 'X', to: 'C', ops: [] });
    c._handleMessage({ type: 'crdt:sync-response', docId: 'doc', from: 'X', to: 'someone-else', ops: [] });
  });

  it('supports document registration and no-transport mode', () => {
    const solo = new CRDTSyncManager({ nodeId: 'solo' });
    expect(() => solo.registerDocument({})).toThrow(/Must be a CRDTDocument/);

    const doc = new CRDTDocument({ nodeId: 'solo', docId: 'doc' });
    solo.registerDocument(doc);
    expect(solo.getDocument('doc')).toBe(doc);

    solo.connect();
    expect(solo.connected).toBe(true);

    // No transport: broadcastOp queues.
    solo.broadcastOp('doc', { field: 'r', fieldType: 'register', type: 'set', value: 'v' });
    expect(solo.getStatus().pendingOps).toBe(1);

    // No transport: requestSync/_sendSyncResponse should be no-ops.
    solo.requestSync('doc', 0);
    solo._sendSyncResponse('nobody', 'doc', []);

    solo.disconnect();
    expect(solo.connected).toBe(false);
  });
});
