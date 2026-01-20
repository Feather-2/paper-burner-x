import { describe, it, expect, vi, beforeEach } from "vitest";

const sharedMocks = vi.hoisted(() => {
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const isPlainObject = vi.fn((value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  const toNonEmptyString = vi.fn((value) => {
    if (value === null || value === undefined) return "";
    const str = String(value).trim();
    return str.length ? str : "";
  });

  const safeJsonParse = vi.fn((value) => {
    if (typeof value !== "string") return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  });

  const canUseStorageEncryption = vi.fn(() => true);
  const encryptString = vi.fn(async (value) => `enc:${value}`);
  const decryptString = vi.fn(async (value) => {
    if (typeof value !== "string" || !value.startsWith("enc:")) {
      throw new Error("invalid encrypted payload");
    }
    return value.slice(4);
  });
  const isEncryptedString = vi.fn((value) => typeof value === "string" && value.startsWith("enc:"));
  const isNodeLike = vi.fn(() => false);

  class FallbackAdapter {
    constructor() {
      this._store = new Map();
    }
    async get(key) {
      return this._store.has(key) ? this._store.get(key) : null;
    }
    async set(key, value) {
      this._store.set(key, value);
      return true;
    }
  }

  const createLogger = vi.fn(() => logger);

  return {
    logger,
    isPlainObject,
    toNonEmptyString,
    safeJsonParse,
    canUseStorageEncryption,
    encryptString,
    decryptString,
    isEncryptedString,
    isNodeLike,
    FallbackAdapter,
    createLogger,
  };
});

const mcpClientMocks = vi.hoisted(() => {
  class McpClient {
    constructor({ providers = [], defaultProviderId } = {}) {
      this._providers = new Map();
      providers.forEach((p) => this._providers.set(p.id, p));
      this._defaultProviderId = defaultProviderId || (providers[0]?.id ?? null);
    }
    getProvider(id) {
      return this._providers.get(id) || null;
    }
  }
  return { McpClient };
});

vi.mock("../../../../js/agents/shared/index.js", () => ({
  isPlainObject: sharedMocks.isPlainObject,
  toNonEmptyString: sharedMocks.toNonEmptyString,
  FallbackAdapter: sharedMocks.FallbackAdapter,
  isNodeLike: sharedMocks.isNodeLike,
  safeJsonParse: sharedMocks.safeJsonParse,
  canUseStorageEncryption: sharedMocks.canUseStorageEncryption,
  decryptString: sharedMocks.decryptString,
  encryptString: sharedMocks.encryptString,
  isEncryptedString: sharedMocks.isEncryptedString,
  createLogger: sharedMocks.createLogger,
}));

vi.mock("../../../../js/agents/mcp/mcp-client.js", () => ({
  McpClient: mcpClientMocks.McpClient,
}));

const RESOURCES_CACHE_KEY = "pb_mcp_resources_cache_v1";

async function loadResourceManager() {
  return await import("../../../../js/agents/mcp/resource-manager.js");
}

function makeClient(providers = [], defaultProviderId) {
  return new mcpClientMocks.McpClient({ providers, defaultProviderId });
}

function makeProvider(overrides = {}) {
  const base = {
    id: overrides.id ?? "p1",
    listResources: overrides.listResources ?? vi.fn(async () => []),
    listResourceTemplates: overrides.listResourceTemplates ?? vi.fn(async () => []),
    readResource: overrides.readResource ?? vi.fn(async (uri) => ({ uri, text: "data" })),
    subscribeResource: overrides.subscribeResource ?? vi.fn(async () => {}),
    unsubscribeResource: overrides.unsubscribeResource ?? vi.fn(async () => {}),
    subscribeNotifications: overrides.subscribeNotifications ?? vi.fn(() => vi.fn()),
  };
  return { ...base, ...overrides };
}

function createStorage() {
  const store = new Map();
  return {
    store,
    getItem: vi.fn((key) => (store.has(key) ? store.get(key) : null)),
    setItem: vi.fn((key, value) => {
      store.set(key, value);
    }),
  };
}

function createAsyncStore() {
  const store = new Map();
  return {
    store,
    get: vi.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key, value) => {
      store.set(key, value);
      return true;
    }),
  };
}

function cacheKey(providerId, uri) {
  return `${providerId}:${uri}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  sharedMocks.canUseStorageEncryption.mockReturnValue(true);
  sharedMocks.encryptString.mockImplementation(async (value) => `enc:${value}`);
  sharedMocks.decryptString.mockImplementation(async (value) => {
    if (typeof value !== "string" || !value.startsWith("enc:")) {
      throw new Error("invalid encrypted payload");
    }
    return value.slice(4);
  });
  sharedMocks.isEncryptedString.mockImplementation((value) => typeof value === "string" && value.startsWith("enc:"));
  sharedMocks.isNodeLike.mockReturnValue(false);
});

describe("McpResourceManager", () => {
  describe("constructor", () => {
    it("throws when encryption is required but unavailable", async () => {
      const { McpResourceManager } = await loadResourceManager();
      sharedMocks.canUseStorageEncryption.mockReturnValue(false);

      expect(
        () =>
          new McpResourceManager({
            encryption: { enabled: true, required: true, passphrase: "secret" },
          })
      ).toThrow(/encryption is required/i);
    });

    it("normalizes cache limits and disables encryption when passphrase is missing", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const manager = new McpResourceManager({
        defaultTtlMs: "-1",
        maxPersistBytes: "-1",
        maxContentCacheEntries: Number.MAX_SAFE_INTEGER,
        maxContentCacheBytes: "1000",
        encryption: { enabled: true, required: false, passphrase: "   " },
      });

      expect(manager.defaultTtlMs).toBe(60000);
      expect(manager.maxPersistBytes).toBe(50000);
      expect(manager.maxContentCacheEntries).toBe(Number.MAX_SAFE_INTEGER);
      expect(manager.maxContentCacheBytes).toBe(1000);
      expect(manager.encryption.enabled).toBe(false);
      expect(manager.encryption.available).toBe(true);
    });
  });

  describe("_getProvider", () => {
    it("throws when client is missing", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const manager = new McpResourceManager();

      await expect(manager.listResources()).rejects.toThrow(/missing client/i);
    });

    it("throws when provider id is missing or unknown", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const managerMissing = new McpResourceManager({ client: makeClient([]) });
      await expect(managerMissing.listResources()).rejects.toThrow(/missing providerId/i);

      const managerUnknown = new McpResourceManager({ client: makeClient([], "p1") });
      await expect(managerUnknown.listResources()).rejects.toThrow(/no provider/i);
    });
  });

  describe("listResources", () => {
    it("caches results, respects TTL, and accepts string TTL", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({
        listResources: vi.fn(async () => [{ uri: "r1" }]),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client, defaultTtlMs: 50 });

      const nowSpy = vi.spyOn(Date, "now");
      nowSpy.mockReturnValue(1000);
      const first = await manager.listResources({ providerId: "   ", ttlMs: "10" });
      expect(first).toEqual([{ uri: "r1" }]);
      expect(provider.listResources).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(1005);
      await manager.listResources({ ttlMs: 10 });
      expect(provider.listResources).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(1020);
      await manager.listResources({ ttlMs: 10 });
      expect(provider.listResources).toHaveBeenCalledTimes(2);
      nowSpy.mockRestore();
    });

    it("returns cached results for ttl=0 and handles non-array responses", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({
        listResources: vi.fn(async () => ({})),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });

      const first = await manager.listResources({ ttlMs: 0 });
      expect(first).toEqual([]);
      expect(provider.listResources).toHaveBeenCalledTimes(1);

      await manager.listResources({ ttlMs: 0 });
      expect(provider.listResources).toHaveBeenCalledTimes(1);
    });
  });

  describe("listResourceTemplates", () => {
    it("returns empty array for non-array responses and caches with ttl=0", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({
        listResourceTemplates: vi.fn(async () => ({})),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });

      const first = await manager.listResourceTemplates({ ttlMs: "0" });
      expect(first).toEqual([]);
      expect(provider.listResourceTemplates).toHaveBeenCalledTimes(1);

      await manager.listResourceTemplates({ ttlMs: 0 });
      expect(provider.listResourceTemplates).toHaveBeenCalledTimes(1);
    });
  });

  describe("readResource", () => {
    it("validates uri and provider support", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({ readResource: undefined });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });

      await expect(manager.readResource({ uri: "" })).rejects.toThrow(/uri is required/i);
      await expect(manager.readResource({ uri: "   " })).rejects.toThrow(/uri is required/i);
      await expect(manager.readResource({ uri: null })).rejects.toThrow(/uri is required/i);
      await expect(manager.readResource({ uri: "r1" })).rejects.toThrow(/resources\/read/i);
    });

    it("caches reads and supports force refresh", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({
        readResource: vi.fn(async (uri) => ({ uri, text: "hello" })),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });

      const first = await manager.readResource({ uri: "r1" });
      const second = await manager.readResource({ uri: "r1" });
      expect(first).toEqual({ uri: "r1", text: "hello" });
      expect(second).toEqual(first);
      expect(provider.readResource).toHaveBeenCalledTimes(1);

      await manager.readResource({ uri: "r1", forceRefresh: true });
      expect(provider.readResource).toHaveBeenCalledTimes(2);
    });

    it("normalizes non-object resource content", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({
        readResource: vi.fn(async () => "raw"),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });

      const result = await manager.readResource({ uri: "r1" });
      expect(result).toEqual({ uri: "r1" });
    });

    it("evicts entries by LRU order when maxContentCacheEntries is reached", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({
        readResource: vi.fn(async (uri) => ({ uri, text: uri })),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client, maxContentCacheEntries: 2 });

      await manager.readResource({ uri: "a" });
      await manager.readResource({ uri: "b" });
      await manager.readResource({ uri: "a" });
      await manager.readResource({ uri: "c" });

      expect(manager._contentCache.has(cacheKey("p1", "b"))).toBe(false);
      expect(manager._contentCache.has(cacheKey("p1", "a"))).toBe(true);
      expect(manager._contentCache.has(cacheKey("p1", "c"))).toBe(true);
    });

    it("evicts entries when maxContentCacheBytes is exceeded", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({
        readResource: vi.fn(async (uri) => ({ uri, text: "x".repeat(20) })),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client, maxContentCacheBytes: Infinity });

      await manager.readResource({ uri: "a" });
      const sizeA = manager._contentCache.get(cacheKey("p1", "a")).byteSize;
      manager.maxContentCacheBytes = sizeA + 1;

      await manager.readResource({ uri: "b" });
      expect(manager._contentCache.has(cacheKey("p1", "a"))).toBe(false);
      expect(manager._contentCache.has(cacheKey("p1", "b"))).toBe(true);
    });

    it("handles concurrent reads without sharing state", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({
        readResource: vi.fn(async (uri) => ({ uri, text: "data" })),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });

      const [first, second] = await Promise.all([
        manager.readResource({ uri: "r1", forceRefresh: true }),
        manager.readResource({ uri: "r1", forceRefresh: true }),
      ]);
      expect(first).toEqual({ uri: "r1", text: "data" });
      expect(second).toEqual(first);
      expect(provider.readResource).toHaveBeenCalledTimes(2);
    });

    it("avoids persisting oversized text content", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const storage = createStorage();
      const provider = makeProvider({
        listResources: vi.fn(async () => []),
        readResource: vi.fn(async (uri) => ({ uri, text: "x".repeat(200) })),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client, storage, maxPersistBytes: 10 });

      await manager.listResources();
      await manager.readResource({ uri: "big" });

      const payload = JSON.parse(storage.store.get(RESOURCES_CACHE_KEY));
      const providerData = payload.providers.p1;
      expect(providerData).toBeTruthy();
      expect(providerData.contents?.big).toBeUndefined();
    });
  });

  describe("_estimateContentByteSize", () => {
    it("handles strings, buffers, views, deep objects, and circular refs", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const manager = new McpResourceManager();

      expect(manager._estimateContentByteSize("abcd")).toBe(8);

      const buffer = new ArrayBuffer(16);
      expect(manager._estimateContentByteSize(buffer)).toBe(16);

      const view = new Uint8Array(8);
      expect(manager._estimateContentByteSize(view)).toBe(8);

      const deep = { a: { b: { c: { d: { e: 1 } } } } };
      expect(manager._estimateContentByteSize(deep)).toBeGreaterThan(0);

      const circular = {};
      circular.self = circular;
      expect(manager._estimateContentByteSize(circular)).toBe(1000);
    });
  });

  describe("subscribeResource / unsubscribeResource", () => {
    it("validates uri and callback types", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider();
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });

      await expect(manager.subscribeResource({ uri: "r1" })).rejects.toThrow(/callback/i);
      await expect(manager.subscribeResource({ callback: () => {} })).rejects.toThrow(/uri is required/i);
      await expect(manager.subscribeResource({ uri: "   ", callback: () => {} })).rejects.toThrow(/uri is required/i);
    });

    it("manages ref counts and server subscriptions", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const off = vi.fn();
      const provider = makeProvider({
        subscribeResource: vi.fn(async () => {}),
        unsubscribeResource: vi.fn(async () => {}),
        subscribeNotifications: vi.fn(() => off),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });

      const sub1 = await manager.subscribeResource({ uri: "r1", callback: vi.fn() });
      const sub2 = await manager.subscribeResource({ uri: "r1", callback: vi.fn() });

      expect(provider.subscribeResource).toHaveBeenCalledTimes(1);
      expect(manager._serverSubRefCounts.get(cacheKey("p1", "r1"))).toBe(2);

      await manager.unsubscribeResource(sub1.id);
      expect(provider.unsubscribeResource).not.toHaveBeenCalled();
      expect(manager._serverSubRefCounts.get(cacheKey("p1", "r1"))).toBe(1);

      await manager.unsubscribeResource(sub2.id);
      expect(provider.unsubscribeResource).toHaveBeenCalledTimes(1);
      expect(manager._serverSubRefCounts.has(cacheKey("p1", "r1"))).toBe(false);
      expect(off).toHaveBeenCalledTimes(1);
    });
  });

  describe("_ensureProviderNotifications", () => {
    it("rewires notifications and resubscribes on provider replacement", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const off1 = vi.fn();
      const off2 = vi.fn();

      const provider1 = makeProvider({
        listResources: vi.fn(async () => []),
        subscribeResource: vi.fn(async () => {}),
        subscribeNotifications: vi.fn(() => off1),
      });
      const provider2 = makeProvider({
        listResources: vi.fn(async () => []),
        subscribeResource: vi.fn(async () => {}),
        subscribeNotifications: vi.fn(() => off2),
      });

      const client = makeClient([provider1], "p1");
      const manager = new McpResourceManager({ client });

      await manager.subscribeResource({ uri: "r1", callback: vi.fn() });

      client._providers.set("p1", provider2);
      await manager.listResources({ providerId: "p1" });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(off1).toHaveBeenCalledTimes(1);
      expect(provider2.subscribeResource).toHaveBeenCalledWith("r1");
      expect(provider2.subscribeNotifications).toHaveBeenCalledTimes(1);
    });
  });

  describe("handleNotification", () => {
    it("ignores invalid inputs", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const manager = new McpResourceManager({ client: makeClient([]) });

      await manager.handleNotification("", null);
      await manager.handleNotification("p1", []);
      expect(manager._listCache.size).toBe(0);
    });

    it("clears list cache on list_changed notifications", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const storage = createStorage();
      const provider = makeProvider({ listResources: vi.fn(async () => []) });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client, storage });

      await manager.listResources();
      expect(manager._listCache.has("p1")).toBe(true);

      await manager.handleNotification("p1", { method: "notifications/resources/list_changed" });
      expect(manager._listCache.has("p1")).toBe(false);
      expect(storage.setItem).toHaveBeenCalled();
    });

    it("refreshes updated resources and notifies subscribers", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({
        readResource: vi.fn(async (uri) => ({ uri, text: "fresh" })),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });
      const callback = vi.fn();

      await manager.subscribeResource({ uri: "r1", callback });
      await manager.handleNotification("p1", {
        method: "notifications/resources/updated",
        params: { uri: "r1" },
      });

      expect(provider.readResource).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({
        providerId: "p1",
        uri: "r1",
        content: { uri: "r1", text: "fresh" },
      });
    });

    it("avoids refresh when no subscribers are present", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({
        readResource: vi.fn(async (uri) => ({ uri, text: "fresh" })),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });

      await manager.handleNotification("p1", {
        method: "notifications/resources/updated",
        params: { uri: "r1" },
      });

      expect(provider.readResource).not.toHaveBeenCalled();
    });

    it("propagates read errors to subscribers", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const provider = makeProvider({
        readResource: vi.fn(async () => {
          throw new Error("boom");
        }),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });
      const callback = vi.fn();

      await manager.subscribeResource({ uri: "r1", callback });
      await manager.handleNotification("p1", {
        method: "notifications/resources/updated",
        params: { uri: "r1" },
      });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: "p1",
          uri: "r1",
          content: null,
          error: "boom",
        })
      );
    });
  });

  describe("_hydratePersistedCache", () => {
    it("hydrates unencrypted cache entries and skips expired data", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const storage = createStorage();

      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);
      const payload = {
        schemaVersion: "0.1",
        ts: 900,
        providers: {
          p1: {
            ts: 900,
            ttlMs: 200,
            resources: [{ uri: "r1" }],
            templates: [{ uriTemplate: "t1" }],
            contents: {
              r1: { ts: 950, ttlMs: 200, content: { uri: "r1", text: "ok" } },
              r2: { ts: 700, ttlMs: 100, content: { uri: "r2", text: "expired" } },
            },
          },
          p2: {
            ts: 600,
            ttlMs: 100,
            resources: [{ uri: "old" }],
          },
        },
      };

      storage.store.set(RESOURCES_CACHE_KEY, JSON.stringify(payload));
      const manager = new McpResourceManager({ storage });
      await manager._hydrationPromise;

      expect(manager._listCache.has("p1")).toBe(true);
      expect(manager._templatesCache.has("p1")).toBe(true);
      expect(manager._listCache.has("p2")).toBe(false);
      expect(manager._contentCache.has(cacheKey("p1", "r1"))).toBe(true);
      expect(manager._contentCache.has(cacheKey("p1", "r2"))).toBe(false);

      nowSpy.mockRestore();
    });

    it("hydrates encrypted cache entries when encryption is enabled", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const storage = createStorage();
      const payload = { schemaVersion: "0.1", ts: 5, providers: { p1: { ts: 5, ttlMs: 100, resources: [] } } };

      storage.store.set(RESOURCES_CACHE_KEY, `enc:${JSON.stringify(payload)}`);
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10);
      const manager = new McpResourceManager({
        storage,
        encryption: { enabled: true, passphrase: "pw" },
      });
      await manager._hydrationPromise;

      expect(sharedMocks.decryptString).toHaveBeenCalled();
      expect(manager._listCache.has("p1")).toBe(true);
      nowSpy.mockRestore();
    });

    it("rejects when decryption fails and encryption is required", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const storage = createStorage();
      storage.store.set(RESOURCES_CACHE_KEY, "enc:bad");
      sharedMocks.decryptString.mockImplementation(async () => {
        throw new Error("decrypt failed");
      });

      const manager = new McpResourceManager({
        storage,
        encryption: { enabled: true, required: true, passphrase: "pw" },
      });
      await expect(manager._hydrationPromise).rejects.toThrow(/decrypt failed/i);
    });
  });

  describe("_persistCache", () => {
    it("returns false when storage writes fail", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const storage = {
        getItem: vi.fn(),
        setItem: vi.fn(() => {
          throw new Error("fail");
        }),
      };
      const manager = new McpResourceManager({ storage });
      manager._listCache.set("p1", { ts: 0, ttlMs: 1000, resources: [] });

      expect(manager._persistCache()).toBe(false);
    });

    it("persists payloads to async stores without stringifying", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const storage = createAsyncStore();
      const manager = new McpResourceManager({ storage });
      manager._listCache.set("p1", { ts: 0, ttlMs: 1000, resources: [] });

      expect(manager._persistCache()).toBe(true);
      expect(storage.set).toHaveBeenCalledTimes(1);
      const stored = storage.store.get(RESOURCES_CACHE_KEY);
      expect(typeof stored).toBe("object");
      expect(stored.schemaVersion).toBe("0.1");
    });

    it("logs when encryption fails during persistence", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const storage = createStorage();
      sharedMocks.encryptString.mockImplementation(async () => {
        throw new Error("boom");
      });
      const manager = new McpResourceManager({
        storage,
        encryption: { enabled: true, passphrase: "pw" },
      });
      manager._listCache.set("p1", { ts: 0, ttlMs: 1000, resources: [] });

      expect(manager._persistCache()).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(sharedMocks.logger.warn).toHaveBeenCalled();
    });
  });

  describe("_stopProviderNotifications", () => {
    it("returns false for missing provider id", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const manager = new McpResourceManager({ client: makeClient([]) });

      expect(manager._stopProviderNotifications("")).toBe(false);
      expect(manager._stopProviderNotifications(null)).toBe(false);
    });
  });

  describe("dispose", () => {
    it("cleans up notifications and subscription state", async () => {
      const { McpResourceManager } = await loadResourceManager();
      const off = vi.fn();
      const provider = makeProvider({
        subscribeResource: vi.fn(async () => {}),
        subscribeNotifications: vi.fn(() => off),
      });
      const client = makeClient([provider], "p1");
      const manager = new McpResourceManager({ client });

      await manager.subscribeResource({ uri: "r1", callback: vi.fn() });
      manager.dispose();

      expect(off).toHaveBeenCalledTimes(1);
      expect(manager._subs.size).toBe(0);
      expect(manager._serverSubRefCounts.size).toBe(0);
      expect(manager._providerNotifyUnsub.size).toBe(0);
    });
  });
});

describe("default export", () => {
  it("matches McpResourceManager", async () => {
    const module = await loadResourceManager();
    expect(module.default).toBe(module.McpResourceManager);
  });
});
