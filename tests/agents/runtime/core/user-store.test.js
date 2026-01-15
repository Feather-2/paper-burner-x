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

async function flushFakeIndexedDbEvents(turns = 4) {
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

  vi.doMock("../../../../js/agents/shared/platform.js", () => ({ isNodeLike: isNodeLikeMock }));
  vi.doMock("../../../../js/agents/shared/utils/storage-crypto.js", () => ({
    canUseStorageEncryption,
    decryptString,
    encryptString,
    isEncryptedString,
  }));
  vi.doMock("../../../../js/agents/shared/utils/logger.js", () => ({
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn() }),
  }));

  const mod = await import("../../../../js/agents/skills/user-store.js");
  return { mod, mocks: { isNodeLikeMock, canUseStorageEncryption, encryptString, decryptString, isEncryptedString } };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.useRealTimers();
});

afterEach(async () => {
  vi.useRealTimers();
  await flushFakeIndexedDbEvents();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("runtime/core/user-store", () => {
  it("migrates fallback body keys from localStorage when the index is empty", async () => {
    const { mod } = await importUserStore({ nodeLike: false });
    const idb = new IDBFactory();
    const ls = new LocalStorageMock({
      [INDEX_KEY]: JSON.stringify({ schemaVersion: "0.1", skills: [] }),
      [BODY_PREFIX + "Orphan"]: "body-orphan",
      [BODY_PREFIX + "Extra"]: "body-extra",
      other: "skip",
    });
    vi.stubGlobal("indexedDB", idb);
    vi.stubGlobal("localStorage", ls);

    const out = await mod.initUserSkillStore({ forceReload: true });
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("indexeddb");

    await flushFakeIndexedDbEvents();
    expect(await readIdbValue(idb, BODY_PREFIX + "Orphan")).toBe("body-orphan");
    expect(await readIdbValue(idb, BODY_PREFIX + "Extra")).toBe("body-extra");

    expect(ls.getItem(INDEX_KEY)).toBeNull();
    expect(ls.getItem(BODY_PREFIX + "Orphan")).toBeNull();
    expect(ls.getItem(BODY_PREFIX + "Extra")).toBeNull();
    expect(ls.getItem("other")).toBe("skip");
  });

  it("initUserSkillStore returns { ok:false } when decrypt fails in localStorage mode", async () => {
    const { mod, mocks } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
    const ls = new LocalStorageMock({
      [INDEX_KEY]: "enc:bad-index",
    });
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", ls);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p" });
    mocks.decryptString.mockRejectedValueOnce(new Error("bad decrypt"));

    const out = await mod.initUserSkillStore({ forceReload: true });
    expect(out).toEqual({ ok: false, mode: "memory" });
    expect(mocks.decryptString).toHaveBeenCalled();
  });

  it("initUserSkillStore catches failures when decryption is required", async () => {
    const { mod, mocks } = await importUserStore({ nodeLike: false, cryptoPrefix: "enc:" });
    const ls = new LocalStorageMock({
      [INDEX_KEY]: "enc:bad-index",
    });
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", ls);

    mod.configureUserSkillStoreEncryption({ enabled: true, passphrase: "p", required: true });
    mocks.decryptString.mockRejectedValueOnce(new Error("bad decrypt"));

    const out = await mod.initUserSkillStore({ forceReload: true });
    expect(out).toEqual({ ok: false, mode: "memory" });
    expect(mocks.decryptString).toHaveBeenCalled();
  });

  it("loadUserSkillsIndex filters invalid entries from localStorage", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    const ls = new LocalStorageMock({
      [INDEX_KEY]: JSON.stringify({
        schemaVersion: "0.1",
        skills: [{ name: "", description: "bad" }, null, { name: "Valid", description: "ok" }],
      }),
    });
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", ls);

    const index = mod.loadUserSkillsIndex();
    expect(index.skills).toEqual([{ name: "Valid", description: "ok" }]);
  });

  it("clearUserSkills removes stored bodies and resets the index", async () => {
    const { mod } = await importUserStore({ nodeLike: true });
    const ls = new LocalStorageMock();
    vi.stubGlobal("indexedDB", undefined);
    vi.stubGlobal("localStorage", ls);

    mod.upsertUserSkill({ metadata: { name: "A1", description: "d1" }, body: "body-1" });
    mod.upsertUserSkill({ metadata: { name: "B2", description: "d2" }, body: "body-2" });
    expect(mod.listUserSkills().map((s) => s.name)).toEqual(["A1", "B2"]);

    mod.clearUserSkills();

    expect(mod.listUserSkills()).toEqual([]);
    expect(ls.getItem(BODY_PREFIX + "A1")).toBeNull();
    expect(ls.getItem(BODY_PREFIX + "B2")).toBeNull();
    expect(JSON.parse(ls.getItem(INDEX_KEY))).toEqual({ schemaVersion: "0.1", skills: [] });
  });
});
