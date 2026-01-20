import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDBFactory } from "fake-indexeddb";

const INDEX_KEY = "paperburner_user_skills_index_v1";
const BODY_PREFIX = "paperburner_user_skills_body_v1:";
const IDB_DB_NAME = "paperburner_user_skills_db_v1";
const IDB_STORE_NAME = "user_skills_kv";

class LocalStorageMock {
  constructor() {
    this._data = new Map();
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

async function flushMicrotasks() {
  // Best-effort: allow `void promise.then(...)` chains to run.
  await Promise.resolve();
  await Promise.resolve();
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

  // Keep tests quiet (user-store logs are best-effort anyway).
  vi.doMock("../../../js/agents/shared/utils/logger.js", () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }),
  }));

  const mod = await import("../../../../js/agents/skills/user-store.js");
  return { mod, mocks: { isNodeLikeMock, canUseStorageEncryption, encryptString, decryptString, isEncryptedString } };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("skills/user-store (skill registry)", () => {
  it("configureUserSkillStoreEncryption throws when required but passphrase is missing", async () => {
    const { mod } = await importUserStore();
    expect(() => mod.configureUserSkillStoreEncryption({ enabled: true, required: true })).toThrow(/passphrase/i);
  });

  it("configureUserSkillStoreEncryption disables encryption when WebCrypto is unavailable (required=false)", async () => {
    const { mod, mocks } = await importUserStore({ cryptoAvailable: false });
    const res = mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p", required: false });
    expect(mocks.canUseStorageEncryption).toHaveBeenCalled();
    expect(res.enabled).toBe(false);
    expect(res.available).toBe(false);
  });

  it("initUserSkillStore uses memory mode in Node-like environments", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    const out = await mod.initUserSkillStore();
    expect(out).toEqual({ ok: true, mode: "memory" });
  });

  it("hydrates encrypted user skills from localStorage in browser mode (no IndexedDB)", async () => {
    const { mod } = await importUserStore({ nodeLike: false, cryptoAvailable: true, cryptoPrefix: "enc:" });
    const ls = new LocalStorageMock();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", undefined);

    const index = { schemaVersion: "0.1", skills: [{ name: "S1", description: "d1" }] };
    ls.setItem(INDEX_KEY, `enc:${JSON.stringify(index)}`);
    ls.setItem(BODY_PREFIX + "S1", "enc:body-text");

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    const out = await mod.initUserSkillStore({ forceReload: true });

    expect(out.ok).toBe(true);
    expect(out.mode).toBe("localstorage");
    expect(out.count).toBe(1);

    expect(mod.listUserSkills()).toEqual([{ name: "S1", description: "d1" }]);
    expect(mod.getUserSkillBody("S1")).toBe("body-text");
  });

  it("migrates localStorage skills to IndexedDB on first init (encryption disabled)", async () => {
    const { mod } = await importUserStore({ nodeLike: false });

    const ls = new LocalStorageMock();
    const idb = new IDBFactory();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", idb);

    const index = { schemaVersion: "0.1", skills: [{ name: "S2", description: "d2" }] };
    ls.setItem(INDEX_KEY, JSON.stringify(index));
    ls.setItem(BODY_PREFIX + "S2", "body-2");

    const out = await mod.initUserSkillStore({ forceReload: true });
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("indexeddb");
    expect(out.count).toBe(1);

    // localStorage should be cleaned up after migration.
    expect(ls.getItem(INDEX_KEY)).toBeNull();
    expect(ls.getItem(BODY_PREFIX + "S2")).toBeNull();

    // Memory reads should be available synchronously after init.
    expect(mod.listUserSkills()).toEqual([{ name: "S2", description: "d2" }]);
    expect(mod.getUserSkillBody("S2")).toBe("body-2");

    // And the data should have been persisted into IndexedDB.
    await expect(readIdbValue(idb, INDEX_KEY)).resolves.toEqual({ schemaVersion: "0.1", skills: [{ name: "S2", description: "d2" }] });
    await expect(readIdbValue(idb, BODY_PREFIX + "S2")).resolves.toBe("body-2");
  });

  it("migrates localStorage skills to IndexedDB with encryption enabled (stores ciphertext, hydrates plaintext)", async () => {
    const { mod, mocks } = await importUserStore({ nodeLike: false, cryptoAvailable: true, cryptoPrefix: "enc:" });

    const ls = new LocalStorageMock();
    const idb = new IDBFactory();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", idb);

    const index = { schemaVersion: "0.1", skills: [{ name: "S3", description: "d3" }] };
    ls.setItem(INDEX_KEY, JSON.stringify(index));
    ls.setItem(BODY_PREFIX + "S3", "body-3");

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p", required: true });
    const out = await mod.initUserSkillStore({ forceReload: true });
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("indexeddb");

    expect(mocks.encryptString).toHaveBeenCalled();
    expect(ls.getItem(INDEX_KEY)).toBeNull();

    // Read-through API exposes decrypted values.
    expect(mod.listUserSkills()).toEqual([{ name: "S3", description: "d3" }]);
    expect(mod.getUserSkillBody("S3")).toBe("body-3");

    // IndexedDB stores encrypted payloads (strings), not plain objects/strings.
    const storedIndex = await readIdbValue(idb, INDEX_KEY);
    const storedBody = await readIdbValue(idb, BODY_PREFIX + "S3");
    expect(typeof storedIndex).toBe("string");
    expect(String(storedIndex)).toMatch(/^enc:/);
    expect(String(storedBody)).toMatch(/^enc:/);
  });

  it("writes encrypted index/body into localStorage when encryption is enabled (no IndexedDB)", async () => {
    const { mod } = await importUserStore({ nodeLike: true, cryptoAvailable: true, cryptoPrefix: "enc:" });
    const ls = new LocalStorageMock();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", undefined);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });

    mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "S4", description: "d4" }] });
    mod.setUserSkillBody("S4", "body-4");

    await flushMicrotasks();
    expect(ls.getItem(INDEX_KEY)).toMatch(/^enc:/);
    expect(ls.getItem(BODY_PREFIX + "S4")).toMatch(/^enc:/);
  });

  it("reads/writes index from localStorage when encryption is disabled (no IndexedDB)", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    const ls = new LocalStorageMock();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", undefined);

    // Missing index -> empty list.
    expect(mod.listUserSkills()).toEqual([]);

    mod.saveUserSkillsIndex({
      schemaVersion: "0.1",
      skills: [{ name: "S7", description: "d7" }, { name: "", description: "bad" }, null],
    });

    // Stored as JSON text in localStorage.
    expect(typeof ls.getItem(INDEX_KEY)).toBe("string");
    expect(mod.listUserSkills()).toEqual([{ name: "S7", description: "d7" }]);
  });

  it("deletes bodies from localStorage when not using IndexedDB", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    const ls = new LocalStorageMock();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", undefined);

    mod.saveUserSkillsIndex({ schemaVersion: "0.1", skills: [{ name: "S8", description: "d8" }] });
    mod.setUserSkillBody("S8", "body-8");

    expect(mod.getUserSkillBody("S8")).toBe("body-8");
    expect(ls.getItem(BODY_PREFIX + "S8")).toBe("body-8");

    mod.deleteUserSkill("S8");
    expect(mod.listUserSkills()).toEqual([]);
    expect(ls.getItem(BODY_PREFIX + "S8")).toBeNull();
  });

  it("deleteUserSkill works in pure-memory mode when localStorage is unavailable", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("indexedDB", undefined);

    mod.upsertUserSkill({ metadata: { name: "S9", description: "d9" }, body: "body-9" });
    expect(mod.getUserSkillBody("S9")).toBe("body-9");

    mod.deleteUserSkill("S9");
    expect(mod.getUserSkillBody("S9")).toBe("");
    expect(mod.listUserSkills()).toEqual([]);
  });

  it("upsertUserSkill updates existing metadata (preserves createdAt)", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    vi.stubGlobal("localStorage", undefined);
    vi.stubGlobal("indexedDB", undefined);

    const first = mod.upsertUserSkill({ metadata: { name: "S10", description: "d10" }, body: "v1" });
    expect(first).toEqual({ ok: true, name: "S10" });
    const createdAt = mod.listUserSkills()[0].createdAt;
    expect(typeof createdAt).toBe("string");

    mod.upsertUserSkill({ metadata: { name: "S10", description: "d10b", priority: 5 }, body: "v2" });
    const [meta] = mod.listUserSkills();
    expect(meta.description).toBe("d10b");
    expect(meta.priority).toBe(5);
    expect(meta.createdAt).toBe(createdAt);
    expect(mod.getUserSkillBody("S10")).toBe("v2");
  });

  it("returns cached init outcome on subsequent calls (localstorage + indexeddb)", async () => {
    // localStorage mode (encryption enabled, no IndexedDB).
    {
      const { mod } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
      const ls = new LocalStorageMock();
      vi.stubGlobal("localStorage", ls);
      vi.stubGlobal("indexedDB", undefined);
      ls.setItem(INDEX_KEY, "enc:{\"schemaVersion\":\"0.1\",\"skills\":[]}");
      mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
      await mod.initUserSkillStore({ forceReload: true });
      await expect(mod.initUserSkillStore()).resolves.toEqual({ ok: true, mode: "localstorage" });
    }

    vi.resetModules();
    vi.unstubAllGlobals();

    // IndexedDB mode.
    {
      const { mod } = await importUserStore({ nodeLike: false });
      const ls = new LocalStorageMock();
      const idb = new IDBFactory();
      vi.stubGlobal("localStorage", ls);
      vi.stubGlobal("indexedDB", idb);
      await mod.initUserSkillStore({ forceReload: true });
      await expect(mod.initUserSkillStore()).resolves.toEqual({ ok: true, mode: "indexeddb" });
    }
  });

  it("stores already-encrypted localStorage values into IndexedDB without re-encrypting", async () => {
    const { mod } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
    const ls = new LocalStorageMock();
    const idb = new IDBFactory();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", idb);

    const rawIndex = "enc:{\"schemaVersion\":\"0.1\",\"skills\":[{\"name\":\"S11\",\"description\":\"d11\"}]}";
    const rawBody = "enc:body-11";
    ls.setItem(INDEX_KEY, rawIndex);
    ls.setItem(BODY_PREFIX + "S11", rawBody);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    await mod.initUserSkillStore({ forceReload: true });

    expect(await readIdbValue(idb, INDEX_KEY)).toBe(rawIndex);
    expect(await readIdbValue(idb, BODY_PREFIX + "S11")).toBe(rawBody);
    expect(mod.getUserSkillBody("S11")).toBe("body-11");
  });

  it("persists encrypted bodies to IndexedDB when encryption is enabled", async () => {
    const { mod } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
    const ls = new LocalStorageMock();
    const idb = new IDBFactory();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", idb);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    await mod.initUserSkillStore({ forceReload: true });

    mod.setUserSkillBody("S12", "body-12");
    await flushMicrotasks();

    // Best-effort: async IDB writes are scheduled via `void (async () => ...)`.
    let stored = null;
    for (let i = 0; i < 20; i++) {
      stored = await readIdbValue(idb, BODY_PREFIX + "S12");
      if (typeof stored === "string") break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 0));
    }

    expect(String(stored)).toMatch(/^enc:/);
  });

  it("swallows encryption failures when writing to localStorage (best-effort)", async () => {
    const { mod, mocks } = await importUserStore({ nodeLike: true, cryptoPrefix: "enc:" });
    const ls = new LocalStorageMock();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", undefined);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });

    // Cause encryptIfNeeded() to reject so the `.catch(...)` path runs.
    mocks.encryptString.mockRejectedValueOnce(new Error("boom"));
    mod.setUserSkillBody("S13", "body-13");
    await flushMicrotasks();

    // Should not crash; body might not be persisted.
    expect(ls.getItem(BODY_PREFIX + "S13") ?? "").not.toContain("body-13");
  });

  it("handles IndexedDB open failures by falling back to memory mode", async () => {
    const { mod } = await importUserStore({ nodeLike: false });
    vi.stubGlobal("localStorage", new LocalStorageMock());
    vi.stubGlobal("indexedDB", { open: () => { throw new Error("boom"); } });

    const out = await mod.initUserSkillStore({ forceReload: true });
    expect(out).toEqual({ ok: true, mode: "memory" });
  });

  it("upsert/delete/clear operate on the in-memory index and schedule persistence updates", async () => {
    const { mod } = await importUserStore({ nodeLike: false });

    const ls = new LocalStorageMock();
    const idb = new IDBFactory();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("indexedDB", idb);

    await mod.initUserSkillStore({ forceReload: true });

    expect(() => mod.upsertUserSkill({ metadata: { name: "", description: "" }, body: "" })).toThrow(/required/i);

    mod.upsertUserSkill({ metadata: { name: "S5", description: "d5", keywords: ["k1"], priority: 10 }, body: "body-5" });
    mod.upsertUserSkill({ metadata: { name: "S6", description: "d6" }, body: "body-6" });
    expect(mod.listUserSkills().map((s) => s.name).sort()).toEqual(["S5", "S6"]);
    expect(mod.getUserSkillBody("S5")).toBe("body-5");

    mod.deleteUserSkill("S5");
    expect(mod.listUserSkills().map((s) => s.name)).toEqual(["S6"]);
    expect(mod.getUserSkillBody("S5")).toBe("");

    mod.clearUserSkills();
    expect(mod.listUserSkills()).toEqual([]);
  });
});
