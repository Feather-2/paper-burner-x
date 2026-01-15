import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDBFactory } from "fake-indexeddb";

const INDEX_KEY = "paperburner_user_skills_index_v1";
const BODY_PREFIX = "paperburner_user_skills_body_v1:";
const IDB_DB_NAME = "paperburner_user_skills_db_v1";
const IDB_STORE_NAME = "user_skills_kv";

class LocalStorageMock {
  constructor(seed = {}) {
    this._data = new Map(Object.entries(seed).map(([k, v]) => [String(k), String(v)]));
  }
  get length() {
    return this._data.size;
  }
  key(i) {
    return Array.from(this._data.keys())[i] ?? null;
  }
  getItem(k) {
    const v = this._data.get(String(k));
    return typeof v === "string" ? v : null;
  }
  setItem(k, v) {
    this._data.set(String(k), String(v));
  }
  removeItem(k) {
    this._data.delete(String(k));
  }
  clear() {
    this._data.clear();
  }
}

function readIdbValue(idb, key) {
  return new Promise((resolve) => {
    const req = idb.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME, { keyPath: "key" });
      }
    };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const store = tx.objectStore(IDB_STORE_NAME);
      const getReq = store.get(String(key));
      getReq.onerror = () => resolve(null);
      getReq.onsuccess = () => resolve(getReq.result ? getReq.result.value : null);
    };
  });
}

async function flushMicrotasks(turns = 3) {
  for (let i = 0; i < turns; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

async function flushFakeIndexedDbEvents(turns = 4) {
  // fake-indexeddb often dispatches open()/upgrade/success via setImmediate.
  for (let i = 0; i < turns; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function importUserStore({ nodeLike = true, cryptoAvailable = true, cryptoPrefix = "enc:" } = {}) {
  const isNodeLikeMock = vi.fn(() => nodeLike);

  const canUseStorageEncryption = vi.fn(() => cryptoAvailable);
  const isEncryptedString = vi.fn((value) => typeof value === "string" && value.startsWith(cryptoPrefix));
  const encryptString = vi.fn(async (plaintext) => `${cryptoPrefix}${String(plaintext ?? "")}`);
  const decryptString = vi.fn(async (payload) => {
    const raw = typeof payload === "string" ? payload : String(payload ?? "");
    return raw.startsWith(cryptoPrefix) ? raw.slice(cryptoPrefix.length) : raw;
  });

  vi.doMock("../../../js/agents/shared/platform.js", () => ({ isNodeLike: isNodeLikeMock }));
  vi.doMock("../../../js/agents/shared/utils/storage-crypto.js", () => ({
    canUseStorageEncryption,
    decryptString,
    encryptString,
    isEncryptedString,
  }));

  // user-store logs are best-effort; keep tests quiet and deterministic.
  vi.doMock("../../../js/agents/shared/utils/logger.js", () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }),
  }));

  const mod = await import("../../../js/agents/skills/user-store.js");
  return { mod, mocks: { isNodeLikeMock, canUseStorageEncryption, encryptString, decryptString, isEncryptedString } };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});

afterEach(async () => {
  // Ensure real timers before flushing `setImmediate`-scheduled fake-indexeddb events.
  // (A test may have enabled fake timers via vi.useFakeTimers()).
  vi.useRealTimers();
  await flushFakeIndexedDbEvents();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("skills/user-store branch coverage", () => {
  it("loadUserSkillsIndex uses the IndexedDB branch when shouldUseIndexedDB() is true", async () => {
    const { mod } = await importUserStore({ nodeLike: false });
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("localStorage", undefined);

    // _initDone starts false; the call should still synchronously return the in-memory snapshot.
    expect(mod.loadUserSkillsIndex()).toEqual({ schemaVersion: "0.1", skills: [] });
  });

  it("loadUserSkillsIndex uses the encryption branch when _encryptionConfig.enabled is true (no IndexedDB)", async () => {
    const { mod } = await importUserStore({ nodeLike: true, cryptoPrefix: "enc:" });
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", undefined);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "E1", description: "d1" }] });

    expect(mod.loadUserSkillsIndex()).toEqual({ schemaVersion: "0.1", skills: [{ name: "E1", description: "d1" }] });
  });

  it("loadUserSkillsIndex falls back to memory when hasLocalStorage() is false", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", undefined);

    mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "M1", description: "d1" }] });
    expect(mod.loadUserSkillsIndex()).toEqual({ schemaVersion: "0.1", skills: [{ name: "M1", description: "d1" }] });
  });

  it("loadUserSkillsIndex returns an empty schema when localStorage.getItem() returns null", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    vi.stubGlobal("indexedDB", undefined);

    // Seed memory first, then simulate a localStorage implementation that "loses" the index key.
    vi.stubGlobal("localStorage", undefined);
    mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "ShouldNotRead", description: "d" }] });

    const ls = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    };
    vi.stubGlobal("localStorage", ls);

    expect(mod.loadUserSkillsIndex()).toEqual({ schemaVersion: "0.1", skills: [] });
  });

  it("saveUserSkillsIndex: IndexedDB + encryption branch persists ciphertext into IndexedDB", async () => {
    const { mod, mocks } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
    const idb = new IDBFactory();
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("localStorage", undefined);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "S1", description: "d1" }] });

    await flushMicrotasks();
    let stored = null;
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      stored = await readIdbValue(idb, INDEX_KEY);
      if (typeof stored === "string") break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(mocks.encryptString).toHaveBeenCalled();
    expect(typeof stored).toBe("string");
    expect(String(stored)).toMatch(/^enc:/);
  });

  it("saveUserSkillsIndex: IndexedDB without encryption persists plain objects into IndexedDB", async () => {
    const { mod, mocks } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
    const idb = new IDBFactory();
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("localStorage", undefined);

    // Ensure encryption stays disabled.
    mod.configureUserSkillStoreEncryption({ enabled: false });
    mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "S2", description: "d2" }] });

    await flushMicrotasks();
    let stored = null;
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      stored = await readIdbValue(idb, INDEX_KEY);
      if (stored) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(mocks.encryptString).not.toHaveBeenCalled();
    expect(stored).toEqual({ schemaVersion: "0.1", skills: [{ name: "S2", description: "d2" }] });
  });

  it("saveUserSkillsIndex: localStorage + encryption branch persists ciphertext into localStorage", async () => {
    const { mod } = await importUserStore({ nodeLike: true, cryptoPrefix: "enc:" });
    const ls = new LocalStorageMock();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", undefined);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "LS1", description: "d1" }] });

    await flushMicrotasks();
    expect(ls.getItem(INDEX_KEY)).toMatch(/^enc:/);
  });

  it("saveUserSkillsIndex: hasLocalStorage() false still returns true and keeps the in-memory index", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("indexedDB", undefined);

    expect(mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "Mem", description: "d" }] })).toBe(true);
    expect(mod.loadUserSkillsIndex()).toEqual({ schemaVersion: "0.1", skills: [{ name: "Mem", description: "d" }] });
  });

  it("getUserSkillBody returns an empty string when name is empty", async () => {
    const { mod } = await importUserStore();
    expect(mod.getUserSkillBody("")).toBe("");
    expect(mod.getUserSkillBody("   ")).toBe("");
    expect(mod.getUserSkillBody(null)).toBe("");
  });

  it("getUserSkillBody: IndexedDB branch returns the in-memory cached body", async () => {
    const { mod } = await importUserStore({ nodeLike: false });
    vi.stubGlobal("indexedDB", new IDBFactory());
    vi.stubGlobal("localStorage", undefined);

    mod.setUserSkillBody("B1", "body-1");
    expect(mod.getUserSkillBody("B1")).toBe("body-1");
  });

  it("getUserSkillBody: encryption branch returns the in-memory cached body (no IndexedDB)", async () => {
    const { mod } = await importUserStore({ nodeLike: true, cryptoPrefix: "enc:" });
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", undefined);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    mod.setUserSkillBody("B2", "body-2");
    expect(mod.getUserSkillBody("B2")).toBe("body-2");
  });

  it("setUserSkillBody returns false when name is empty", async () => {
    const { mod } = await importUserStore();
    expect(mod.setUserSkillBody("", "x")).toBe(false);
    expect(mod.setUserSkillBody("   ", "x")).toBe(false);
    expect(mod.setUserSkillBody(null, "x")).toBe(false);
  });

  it("setUserSkillBody: IndexedDB + encryption branch persists ciphertext into IndexedDB", async () => {
    const { mod } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
    const idb = new IDBFactory();
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("localStorage", undefined);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    mod.setUserSkillBody("SBody", "payload");

    await flushMicrotasks();
    let stored = null;
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      stored = await readIdbValue(idb, BODY_PREFIX + "SBody");
      if (typeof stored === "string") break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(typeof stored).toBe("string");
    expect(String(stored)).toMatch(/^enc:/);
  });

  it("setUserSkillBody ignores localStorage write errors when encryption is enabled", async () => {
    const { mod } = await importUserStore({ nodeLike: true, cryptoPrefix: "enc:" });
    vi.stubGlobal("indexedDB", undefined);

    const setItem = vi.fn(() => {
      throw new Error("quota");
    });
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    });

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    expect(mod.setUserSkillBody("ThrowingLS", "x")).toBe(true);

    await flushMicrotasks();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls[0][0]).toBe(BODY_PREFIX + "ThrowingLS");
    expect(String(setItem.mock.calls[0][1])).toMatch(/^enc:/);
  });

  it("upsertUserSkill throws when metadata is not an object", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("indexedDB", undefined);

    expect(() => mod.upsertUserSkill({ metadata: "nope", body: "x" })).toThrow(/required/i);
  });

  it("upsertUserSkill throws when name or description are missing", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("indexedDB", undefined);

    expect(() => mod.upsertUserSkill({ metadata: { name: "OnlyName" }, body: "x" })).toThrow(/required/i);
    expect(() => mod.upsertUserSkill({ metadata: { description: "OnlyDesc" }, body: "x" })).toThrow(/required/i);
  });

  it("upsertUserSkill replaces an existing skill (localStorage mode)", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    const ls = new LocalStorageMock();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", undefined);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    mod.upsertUserSkill({ metadata: { name: "R1", description: "d1" }, body: "v1" });
    const [a] = mod.listUserSkills();
    expect(a.name).toBe("R1");
    const createdAt = a.createdAt;
    const updatedAt1 = a.updatedAt;

    vi.setSystemTime(new Date("2020-01-02T00:00:00.000Z"));
    mod.upsertUserSkill({ metadata: { name: "R1", description: "d2" }, body: "v2" });

    const skills = mod.listUserSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe("d2");
    expect(skills[0].createdAt).toBe(createdAt);
    expect(skills[0].updatedAt).not.toBe(updatedAt1);
    expect(mod.getUserSkillBody("R1")).toBe("v2");
  });

  it("deleteUserSkill returns false when name is empty", async () => {
    const { mod } = await importUserStore();
    expect(mod.deleteUserSkill("")).toBe(false);
    expect(mod.deleteUserSkill("   ")).toBe(false);
    expect(mod.deleteUserSkill(null)).toBe(false);
  });

  it("deleteUserSkill updates the index + removes the body key (localStorage mode)", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    const ls = new LocalStorageMock();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", undefined);

    mod.upsertUserSkill({ metadata: { name: "DelLS", description: "d1" }, body: "payload" });
    expect(mod.listUserSkills().map((s) => s.name)).toEqual(["DelLS"]);
    expect(ls.getItem(BODY_PREFIX + "DelLS")).toBe("payload");

    expect(mod.deleteUserSkill("DelLS")).toBe(true);
    expect(mod.listUserSkills()).toEqual([]);
    expect(ls.getItem(BODY_PREFIX + "DelLS")).toBe(null);
  });

  it("deleteUserSkill updates the in-memory index/bodies when localStorage is unavailable", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("indexedDB", undefined);

    mod.upsertUserSkill({ metadata: { name: "DelMem", description: "d1" }, body: "payload" });
    expect(mod.listUserSkills().map((s) => s.name)).toEqual(["DelMem"]);
    expect(mod.getUserSkillBody("DelMem")).toBe("payload");

    expect(mod.deleteUserSkill("DelMem")).toBe(true);
    expect(mod.listUserSkills()).toEqual([]);
    expect(mod.getUserSkillBody("DelMem")).toBe("");
  });

  it("deleteUserSkill uses the IndexedDB branch and deletes the stored body", async () => {
    const { mod } = await importUserStore({ nodeLike: false });
    const idb = new IDBFactory();
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("localStorage", undefined);

    mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "DelIDB", description: "d1" }] });
    mod.setUserSkillBody("DelIDB", "payload");

    await flushMicrotasks();
    let stored = null;
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      stored = await readIdbValue(idb, BODY_PREFIX + "DelIDB");
      if (stored !== null) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(stored).toBe("payload");

    expect(mod.deleteUserSkill("DelIDB")).toBe(true);

    await flushMicrotasks();
    let deleted = "__not_deleted__";
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      deleted = await readIdbValue(idb, BODY_PREFIX + "DelIDB");
      if (deleted === null) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(deleted).toBe(null);
  });

  it("initUserSkillStore migrates localStorage into IndexedDB (IndexedDB + encryption)", async () => {
    const { mod } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
    const idb = new IDBFactory();
    const ls = new LocalStorageMock({
      [INDEX_KEY]: JSON.stringify({ schemaVersion: "0.1", skills: [{ name: "Mig1", description: "d1" }] }),
      [BODY_PREFIX + "Mig1"]: "body-1",
    });
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("localStorage", ls);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    const outcome = await mod.initUserSkillStore({ forceReload: true });
    expect(outcome).toMatchObject({ ok: true, mode: "indexeddb", count: 1 });

    // Cleanup should keep localStorage small after migration.
    expect(ls.getItem(INDEX_KEY)).toBe(null);
    expect(ls.getItem(BODY_PREFIX + "Mig1")).toBe(null);

    // Data should be stored as ciphertext in IndexedDB.
    const storedIndex = await readIdbValue(idb, INDEX_KEY);
    const storedBody = await readIdbValue(idb, BODY_PREFIX + "Mig1");
    expect(String(storedIndex)).toMatch(/^enc:/);
    expect(String(storedBody)).toMatch(/^enc:/);

    // Sync reads should use the hydrated in-memory snapshot.
    expect(mod.listUserSkills().map((s) => s.name)).toEqual(["Mig1"]);
    expect(mod.getUserSkillBody("Mig1")).toBe("body-1");
  });

  it("saveUserSkillsIndex ignores localStorage write errors when encryption is enabled", async () => {
    const { mod } = await importUserStore({ nodeLike: true, cryptoPrefix: "enc:" });
    vi.stubGlobal("indexedDB", undefined);

    const setItem = vi.fn(() => {
      throw new Error("quota");
    });
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => null),
      setItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    });

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    expect(mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "ThrowingIndex", description: "d" }] })).toBe(true);

    await flushMicrotasks();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(setItem.mock.calls[0][0]).toBe(INDEX_KEY);
    expect(String(setItem.mock.calls[0][1])).toMatch(/^enc:/);
  });

  it("saveUserSkillsIndex swallows encrypt errors in localStorage encryption mode (catch branch)", async () => {
    const { mod, mocks } = await importUserStore({ nodeLike: true, cryptoPrefix: "enc:" });
    vi.stubGlobal("indexedDB", undefined);

    const ls = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    };
    vi.stubGlobal("localStorage", ls);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    mocks.encryptString.mockRejectedValueOnce(new Error("boom"));

    expect(mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "EncFailLS", description: "d" }] })).toBe(true);

    await flushMicrotasks();
    expect(mocks.encryptString).toHaveBeenCalled();
    expect(ls.setItem).not.toHaveBeenCalled();
  });

  it("saveUserSkillsIndex swallows encrypt errors in IndexedDB encryption mode (catch branch)", async () => {
    const { mod, mocks } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
    const idb = new IDBFactory();
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("localStorage", undefined);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    mocks.encryptString.mockRejectedValueOnce(new Error("boom"));

    expect(mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "EncFailIDB", description: "d" }] })).toBe(true);

    await flushFakeIndexedDbEvents();
    await flushMicrotasks();
    expect(mocks.encryptString).toHaveBeenCalled();
    expect(await readIdbValue(idb, INDEX_KEY)).toBe(null);
  });

  it("setUserSkillBody swallows encrypt errors in IndexedDB encryption mode (catch branch)", async () => {
    const { mod, mocks } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
    const idb = new IDBFactory();
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("localStorage", undefined);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    mocks.encryptString.mockRejectedValueOnce(new Error("boom"));

    expect(mod.setUserSkillBody("EncBodyFailIDB", "payload")).toBe(true);

    await flushFakeIndexedDbEvents();
    await flushMicrotasks();
    expect(mocks.encryptString).toHaveBeenCalled();
    expect(await readIdbValue(idb, BODY_PREFIX + "EncBodyFailIDB")).toBe(null);
  });

  it("initUserSkillStore falls back to { ok:false } when decrypt fails in the IndexedDB path (catch branch)", async () => {
    const { mod, mocks } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
    const idb = new IDBFactory();
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("localStorage", undefined);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "DecFail", description: "d" }] });

    await flushMicrotasks();
    let storedIndex = null;
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      storedIndex = await readIdbValue(idb, INDEX_KEY);
      if (typeof storedIndex === "string") break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(String(storedIndex)).toMatch(/^enc:/);

    mocks.decryptString.mockRejectedValueOnce(new Error("bad decrypt"));

    const outcome = await mod.initUserSkillStore({ forceReload: true });
    expect(outcome).toEqual({ ok: false, mode: "memory" });
  });

  it("configureUserSkillStoreEncryption disables encryption when passphrase is missing (non-required)", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    const cfg = mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "" });
    expect(cfg.enabled).toBe(false);
  });

  it("configureUserSkillStoreEncryption throws when encryption is required but passphrase is missing", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    expect(() => mod.configureUserSkillStoreEncryption({ enabled: true, required: true, passphrase: "" })).toThrow(/passphrase/i);
  });

  it("configureUserSkillStoreEncryption disables encryption when WebCrypto is unavailable (non-required)", async () => {
    const { mod } = await importUserStore({ nodeLike: true, cryptoAvailable: false });
    const cfg = mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    expect(cfg.enabled).toBe(false);
    expect(cfg.available).toBe(false);
  });

  it("configureUserSkillStoreEncryption throws when encryption is required but WebCrypto is unavailable", async () => {
    const { mod } = await importUserStore({ nodeLike: true, cryptoAvailable: false });
    expect(() => mod.configureUserSkillStoreEncryption({ enabled: true, required: true, passphrase: "p" })).toThrow(/unavailable/i);
  });
});
