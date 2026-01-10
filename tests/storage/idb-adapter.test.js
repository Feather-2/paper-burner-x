/**
 * @file tests/storage/idb-adapter.test.js
 * @description js/storage/adapters/idb-adapter.js unit tests
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';

import { IdbAdapter } from '../../js/storage/adapters/idb-adapter.js';

let dbCounter = 0;

function nextDbName(prefix = 'IdbAdapterTest') {
  dbCounter += 1;
  return `${prefix}_${Date.now()}_${dbCounter}`;
}

async function createDbWithStore(dbName, storeName, version = 1) {
  await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
    };
    req.onsuccess = () => {
      req.result.close();
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

describe('storage/adapters/idb-adapter (IdbAdapter)', () => {
  it('validates constructor options', () => {
    expect(() => new IdbAdapter()).toThrow('IdbAdapter: dbName is required');
    expect(() => new IdbAdapter({ dbName: 'db' })).toThrow('IdbAdapter: storeName is required');
    expect(() => new IdbAdapter({ dbName: 'db', storeName: 's', indexedDB: null })).toThrow(
      'IdbAdapter: indexedDB is not available',
    );
  });

  it('creates an out-of-line key store and supports get/set/remove/keys/clear', async () => {
    const adapter = new IdbAdapter({ dbName: nextDbName(), storeName: 'kv' });

    await expect(adapter.get('missing')).resolves.toBeNull();

    await adapter.set('a', 'A');
    await adapter.set('b', { ok: true });

    await expect(adapter.get('a')).resolves.toBe('A');
    await expect(adapter.get('b')).resolves.toEqual({ ok: true });

    const keys = await adapter.keys();
    expect(keys).toEqual(expect.arrayContaining(['a', 'b']));

    await adapter.remove('a');
    await expect(adapter.get('a')).resolves.toBeNull();

    await adapter.clear();
    await expect(adapter.keys()).resolves.toEqual([]);
  });

  it('normalizes values when using an inline keyPath store', async () => {
    const adapter = new IdbAdapter({
      dbName: nextDbName(),
      storeName: 'results',
      storeOptions: { keyPath: 'id' },
    });

    await adapter.set('r1', { id: 'wrong', value: 1 });
    await adapter.set('r2', { value: 2 });

    await expect(adapter.get('r1')).resolves.toEqual({ id: 'r1', value: 1 });
    await expect(adapter.get('r2')).resolves.toEqual({ id: 'r2', value: 2 });
  });

  it('upgrades an existing DB to ensure a missing store exists', async () => {
    const dbName = nextDbName();
    await createDbWithStore(dbName, 'other', 1);

    const adapter = new IdbAdapter({ dbName, storeName: 'target' });
    await adapter.set('k', 'v');
    await expect(adapter.get('k')).resolves.toBe('v');
  });

  it('keys() falls back to cursor iteration when getAllKeys is not available', async () => {
    const adapter = new IdbAdapter({ dbName: nextDbName(), storeName: 'kv' });
    await adapter.set('a', 1);
    await adapter.set('b', 2);

    const IDBObjectStoreCtor = globalThis.IDBObjectStore;
    const original = IDBObjectStoreCtor?.prototype?.getAllKeys;

    if (!IDBObjectStoreCtor?.prototype) {
      // Should not happen under fake-indexeddb/auto, but keep the test robust.
      const keys = await adapter.keys();
      expect(keys).toEqual(expect.arrayContaining(['a', 'b']));
      return;
    }

    try {
      // Force the fallback branch.
      IDBObjectStoreCtor.prototype.getAllKeys = undefined;

      const keys = await adapter.keys();
      expect(keys.sort()).toEqual(['a', 'b']);
    } finally {
      // Restore.
      IDBObjectStoreCtor.prototype.getAllKeys = original;
    }
  });
});
