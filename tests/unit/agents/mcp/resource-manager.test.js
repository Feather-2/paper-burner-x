import { describe, it, expect, vi, beforeEach } from "vitest";

const MODULE_PATH = "../../../../js/agents/mcp/resource-manager.js";
const SHARED_PATH = "../../../../js/agents/shared/index.js";
const MCP_CLIENT_PATH = "../../../../js/agents/mcp/mcp-client.js";

const shared = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    logger,
    isNodeLike: vi.fn(() => true),
    canUseStorageEncryption: vi.fn(() => true),
    encryptString: vi.fn((plaintext, opts) => `enc:${opts?.aad ?? "aad"}:${plaintext}`),
    decryptString: vi.fn((ciphertext) => {
      if (typeof ciphertext !== "string") return "";
      const idx = ciphertext.indexOf(":", 4);
      return idx === -1 ? ciphertext : ciphertext.slice(idx + 1);
    }),
    isEncryptedString: vi.fn((value) => typeof value === "string" && value.startsWith("enc:")),
  };
});

vi.mock(SHARED_PATH, () => {
  const isPlainObject = (value) => {
    if (value === null || typeof value !== "object") return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const toNonEmptyString = (value) => {
    if (typeof value === "string") {
      const s = value.trim();
      return s.length ? s : null;
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "boolean") return String(value);
    if (typeof value === "bigint") return String(value);
    return null;
  };

  class FallbackAdapter {
    constructor(dbName, storeName) {
      this.dbName = dbName;
      this.storeName = storeName;
      this._kv = new Map();
    }
    async get(key) {
      return this._kv.has(String(key)) ? this._kv.get(String(key)) : null;
    }
    async set(key, value) {
      this._kv.set(String(key), value);
      return true;
    }
  }

  const safeJsonParse = (text) => {
    try {
      return JSON.parse(String(text));
    } catch {
      return null;
    }
  };

  const createLogger = () => shared.logger;

  return {
    isPlainObject,
    toNonEmptyString,
    FallbackAdapter,
    isNodeLike: shared.isNodeLike,
    safeJsonParse,
    canUseStorageEncryption: shared.canUseStorageEncryption,
    encryptString: shared.encryptString,
    decryptString: shared.decryptString,
    isEncryptedString: shared.isEncryptedString,
    createLogger,
  };
});

vi.mock(MCP_CLIENT_PATH, () => {
  class McpClient {
    constructor() {}
  }
  return { McpClient };
});

function isClass(fn) {
  return typeof fn === "function" && /^class\s/.test(Function.prototype.toString.call(fn));
}

function createStorageMock(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [String(k), v]));
  return {
    getItem: vi.fn((key) => (map.has(String(key)) ? map.get(String(key)) : null)),
    setItem: vi.fn((key, value) => {
      map.set(String(key), String(value));
    }),
    removeItem: vi.fn((key) => {
      map.delete(String(key));
    }),
    clear: vi.fn(() => {
      map.clear();
    }),
    _map: map,
  };
}

function createAsyncStoreMock(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [String(k), v]));
  return {
    get: vi.fn(async (key) => (map.has(String(key)) ? map.get(String(key)) : null)),
    set: vi.fn(async (key, value) => {
      map.set(String(key), value);
      return true;
    }),
    _map: map,
  };
}

function defer() {
  /** @type {(v:any)=>void} */
  let resolve;
  /** @type {(e:any)=>void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // @ts-ignore - assigned synchronously in executor
  return { promise, resolve, reject };
}

function deepNest(depth) {
  let obj = { level: depth };
  for (let i = depth - 1; i >= 0; i--) obj = { level: i, next: obj };
  return obj;
}

function getMethodNames(obj) {
  const proto = Object.getPrototypeOf(obj);
  if (!proto) return [];
  return Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor" && typeof obj[n] === "function");
}

function findMethod(obj, patterns) {
  const names = getMethodNames(obj);
  for (const name of names) {
    if (patterns.some((p) => p.test(name))) return name;
  }
  return null;
}

async function callWithFallback(fn, argLists) {
  let lastErr;
  for (const args of argLists) {
    try {
      return await fn(...args);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function unwrapResources(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.resources)) return value.resources;
  if (value && value.result && Array.isArray(value.result.resources)) return value.result.resources;
  return null;
}

function unwrapTemplates(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.resourceTemplates)) return value.resourceTemplates;
  if (value && value.result && Array.isArray(value.result.resourceTemplates)) return value.result.resourceTemplates;
  return null;
}

function unwrapContents(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.contents)) return value.contents;
  if (value && value.result && Array.isArray(value.result.contents)) return value.result.contents;
  return null;
}

function createClientStub(fixtures = {}) {
  const resources =
    fixtures.resources ??
    [
      {
        uri: "file:///project/README.md",
        name: "README.md",
        description: "Project documentation",
        mimeType: "text/markdown",
        annotations: deepNest(15),
      },
    ];
  const resourceTemplates =
    fixtures.resourceTemplates ??
    [
      {
        uriTemplate: "file:///{path}",
        name: "Project Files",
        description: "Access files in the project directory",
        mimeType: "application/octet-stream",
      },
    ];
  const contents =
    fixtures.contents ??
    [
      {
        uri: "file:///project/README.md",
        mimeType: "text/markdown",
        text: "# Hello\n",
      },
    ];

  const api = {
    listResources: vi.fn(async () => ({ resources })),
    listResourceTemplates: vi.fn(async () => ({ resourceTemplates })),
    readResource: vi.fn(async () => ({ contents })),
    subscribeResource: vi.fn(async () => ({ ok: true })),
    unsubscribeResource: vi.fn(async () => ({ ok: true })),
    request: vi.fn(async (...args) => {
      // Support a few common calling conventions.
      const arg0 = args[0];
      let method = null;
      let params = null;

      if (arg0 && typeof arg0 === "object") {
        method = arg0.method ?? null;
        params = arg0.params ?? null;
      } else {
        method = args.find((a) => typeof a === "string" && a.includes("/")) ?? null;
        params = args.find((a) => a && typeof a === "object") ?? null;
      }

      switch (method) {
        case "resources/list":
          return { resources, nextCursor: null };
        case "resources/templates/list":
          return { resourceTemplates, nextCursor: null };
        case "resources/read":
          // allow params.uri when present
          if (params && typeof params === "object" && "uri" in params) return { contents };
          return { contents };
        case "resources/subscribe":
          return { ok: true };
        case "resources/unsubscribe":
          return { ok: true };
        default:
          // Fallback to something list-ish to avoid unexpected crashes in call-path tests.
          return { ok: true };
      }
    }),
  };

  return { api, fixtures: { resources, resourceTemplates, contents } };
}

async function loadFresh() {
  vi.resetModules();
  return await import(MODULE_PATH);
}

async function instantiateMaybe(ctorOrFactory, options) {
  // Try a few plausible calling conventions without assuming exact signature.
  const attempts = [
    () => (isClass(ctorOrFactory) ? new ctorOrFactory(options) : ctorOrFactory(options)),
    () => new ctorOrFactory(options),
    () => ctorOrFactory(options),
    () => (options?.client ? new ctorOrFactory(options.client, { ...options, client: undefined }) : null),
    () => (options?.client ? ctorOrFactory(options.client, { ...options, client: undefined }) : null),
  ];

  let lastErr;
  for (const attempt of attempts) {
    try {
      const instance = attempt();
      if (instance && typeof instance === "object") return instance;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Unable to instantiate manager export");
}

function looksLikeManagerExport(exportName, value) {
  if (typeof value !== "function") return false;
  if (/resource.*manager/i.test(exportName) || /resource.*manager/i.test(value.name)) return true;
  if (isClass(value)) {
    const protoNames = Object.getOwnPropertyNames(value.prototype || {}).filter((n) => n !== "constructor");
    return protoNames.some((n) => /list.*resource|read.*resource/i.test(n));
  }
  return false;
}

beforeEach(() => {
  vi.clearAllMocks();
  shared.isNodeLike.mockReturnValue(true);
  shared.canUseStorageEncryption.mockReturnValue(true);
});

const initialModule = await import(MODULE_PATH);
const functionExports = Object.entries(initialModule).filter(([, v]) => typeof v === "function");
const managerExportName =
  functionExports.find(([name, v]) => looksLikeManagerExport(name, v))?.[0] ??
  functionExports.find(([name]) => name === "default")?.[0] ??
  null;

describe("resource-manager module shape", () => {
  it("exports at least one symbol", () => {
    expect(Object.keys(initialModule).length).toBeGreaterThan(0);
  });

  it("has at least one function/class export", () => {
    expect(functionExports.length).toBeGreaterThan(0);
  });
});

for (const [exportName] of functionExports) {
  describe(exportName, () => {
    it("is a function/class export (callable)", async () => {
      const mod = await loadFresh();
      expect(typeof mod[exportName]).toBe("function");
    });

    if (managerExportName && exportName === managerExportName) {
      describe("MCP resource manager behavior", () => {
        const RESOURCES_CACHE_KEY = "pb_mcp_resources_cache_v1";

        it("constructs with empty-ish options (null/undefined/empty object)", async () => {
          const mod = await loadFresh();
          const exported = mod[exportName];

          await expect(async () => instantiateMaybe(exported, undefined)).not.toThrow();
          await expect(async () => instantiateMaybe(exported, null)).not.toThrow();
          await expect(async () => instantiateMaybe(exported, {})).not.toThrow();
        });

        it("list resources: returns expected resources and calls client (normal path)", async () => {
          const { api: client, fixtures } = createClientStub();
          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], {
            client,
            storage,
            defaultTtlMs: 60_000,
            maxPersistBytes: 1024 * 1024,
          });

          const listMethod =
            findMethod(mgr, [/^listResources$/i, /resources.*list/i, /list.*resources/i]) ??
            findMethod(mgr, [/^getResources$/i, /resources/i]);
          expect(listMethod).toBeTruthy();

          const res = await callWithFallback(mgr[listMethod].bind(mgr), [
            ["p1"],
            [{ providerId: "p1" }],
            ["p1", {}],
            [{ providerId: "p1", cursor: undefined }],
            [],
          ]);

          const resources = unwrapResources(res);
          expect(resources).toBeTruthy();
          expect(resources).toEqual(fixtures.resources);

          // Assert we actually talked to the client.
          expect(client.listResources.mock.calls.length + client.request.mock.calls.length).toBeGreaterThan(0);
        });

        it("list resources: persists cache to storage when available", async () => {
          const { api: client } = createClientStub();
          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], {
            client,
            storage,
            defaultTtlMs: 60_000,
            maxPersistBytes: 1024 * 1024,
          });

          const listMethod = findMethod(mgr, [/^listResources$/i, /resources.*list/i, /list.*resources/i]);
          expect(listMethod).toBeTruthy();

          await callWithFallback(mgr[listMethod].bind(mgr), [["p1"], [{ providerId: "p1" }], ["p1", {}], []]);

          // Should write a string value under the well-known key.
          expect(storage.setItem).toHaveBeenCalled();
          const stored = storage._map.get(RESOURCES_CACHE_KEY);
          expect(typeof stored === "string" && stored.length > 0).toBe(true);
        });

        it("list resources: handles corrupted persisted cache without crashing (error handling)", async () => {
          const { api: client, fixtures } = createClientStub();
          const storage = createStorageMock({ [RESOURCES_CACHE_KEY]: "{not-json" });

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], {
            client,
            storage,
            defaultTtlMs: 60_000,
            maxPersistBytes: 1024 * 1024,
          });

          const listMethod = findMethod(mgr, [/^listResources$/i, /resources.*list/i, /list.*resources/i]);
          expect(listMethod).toBeTruthy();

          const res = await callWithFallback(mgr[listMethod].bind(mgr), [["p1"], [{ providerId: "p1" }], []]);
          const resources = unwrapResources(res);
          expect(resources).toEqual(fixtures.resources);
          expect(storage.setItem).toHaveBeenCalled();
        });

        it("list resources: enforces maxPersistBytes (resource boundary: very large payload)", async () => {
          const huge = "x".repeat(256 * 1024); // 256KB
          const { api: client } = createClientStub({
            resources: [
              {
                uri: "file:///big.txt",
                name: "big.txt",
                description: huge,
                mimeType: "text/plain",
                annotations: deepNest(50),
              },
            ],
          });

          const maxPersistBytes = 1024; // intentionally tiny
          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], {
            client,
            storage,
            defaultTtlMs: 60_000,
            maxPersistBytes,
            encryption: { enabled: false },
          });

          const listMethod = findMethod(mgr, [/^listResources$/i, /resources.*list/i, /list.*resources/i]);
          expect(listMethod).toBeTruthy();

          await callWithFallback(mgr[listMethod].bind(mgr), [["p1"], [{ providerId: "p1" }], []]);

          const stored = storage._map.get(RESOURCES_CACHE_KEY);
          if (stored != null) {
            expect(String(stored).length).toBeLessThanOrEqual(maxPersistBytes);
          } else {
            expect(storage.setItem).not.toHaveBeenCalled();
          }
        });

        it("list resources: encrypts persisted cache when encryption enabled", async () => {
          shared.canUseStorageEncryption.mockReturnValue(true);

          const { api: client } = createClientStub();
          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], {
            client,
            storage,
            defaultTtlMs: 60_000,
            maxPersistBytes: 1024 * 1024,
            encryption: { enabled: true, passphrase: "pw", aad: "test-aad", iterations: 10_000 },
          });

          const listMethod = findMethod(mgr, [/^listResources$/i, /resources.*list/i, /list.*resources/i]);
          expect(listMethod).toBeTruthy();

          await callWithFallback(mgr[listMethod].bind(mgr), [["p1"], [{ providerId: "p1" }], []]);

          const stored = storage._map.get(RESOURCES_CACHE_KEY);
          expect(stored).toBeTruthy();
          expect(shared.encryptString).toHaveBeenCalled();
          expect(shared.isEncryptedString(stored)).toBe(true);
        });

        it("list resources: when encryption is required but unavailable, it must not persist plaintext", async () => {
          shared.canUseStorageEncryption.mockReturnValue(false);

          const { api: client } = createClientStub();
          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], {
            client,
            storage,
            defaultTtlMs: 60_000,
            maxPersistBytes: 1024 * 1024,
            encryption: { enabled: true, required: true, passphrase: "pw" },
          });

          const listMethod = findMethod(mgr, [/^listResources$/i, /resources.*list/i, /list.*resources/i]);
          expect(listMethod).toBeTruthy();

          let err = null;
          try {
            await callWithFallback(mgr[listMethod].bind(mgr), [["p1"], [{ providerId: "p1" }], []]);
          } catch (e) {
            err = e;
          }

          if (err) {
            expect(err).toBeInstanceOf(Error);
          } else {
            // If it didn't throw, it still must not write unencrypted cache.
            expect(storage.setItem).not.toHaveBeenCalled();
          }
        });

        it("list resources: boundary inputs for providerId (null/undefined/empty/whitespace/number/object/array)", async () => {
          const { api: client } = createClientStub();
          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], {
            client,
            storage,
            defaultTtlMs: "60000", // type boundary: string as number
            maxPersistBytes: 1024 * 1024,
          });

          const listMethod = findMethod(mgr, [/^listResources$/i, /resources.*list/i, /list.*resources/i]);
          expect(listMethod).toBeTruthy();

          const providerIds = [
            null,
            undefined,
            "",
            "   ",
            0,
            -1,
            Number.MAX_SAFE_INTEGER,
            [],
            {},
            { toString: () => "p1" },
          ];

          for (const pid of providerIds) {
            let out;
            let err;
            try {
              out = await callWithFallback(mgr[listMethod].bind(mgr), [[pid], [{ providerId: pid }], [pid, {}], []]);
            } catch (e) {
              err = e;
            }

            if (err) {
              expect(err).toBeInstanceOf(Error);
            } else {
              const resources = unwrapResources(out);
              expect(resources === null || Array.isArray(resources)).toBe(true);
            }
          }
        });

        it("list resources: concurrency (simultaneous calls resolve consistently)", async () => {
          const d = defer();
          const resources = [
            { uri: "file:///a.txt", name: "a.txt", description: "A", mimeType: "text/plain", annotations: deepNest(5) },
          ];
          const { api: client } = createClientStub({ resources });

          client.listResources.mockImplementation(() => d.promise);
          client.request.mockImplementation(() => d.promise);

          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], {
            client,
            storage,
            defaultTtlMs: 60_000,
            maxPersistBytes: 1024 * 1024,
          });

          const listMethod = findMethod(mgr, [/^listResources$/i, /resources.*list/i, /list.*resources/i]);
          expect(listMethod).toBeTruthy();

          const p1 = callWithFallback(mgr[listMethod].bind(mgr), [["p1"], [{ providerId: "p1" }], []]);
          const p2 = callWithFallback(mgr[listMethod].bind(mgr), [["p1"], [{ providerId: "p1" }], []]);

          d.resolve({ resources });

          const [r1, r2] = await Promise.all([p1, p2]);
          expect(unwrapResources(r1)).toEqual(unwrapResources(r2));
        });

        it("list resource templates: returns expected templates (normal path)", async () => {
          const { api: client, fixtures } = createClientStub();
          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], {
            client,
            storage,
            defaultTtlMs: 60_000,
            maxPersistBytes: 1024 * 1024,
          });

          const tmplMethod = findMethod(mgr, [
            /^listResourceTemplates$/i,
            /templates.*list/i,
            /list.*templates/i,
            /resourceTemplates/i,
          ]);

          // Not all managers expose templates; if absent, treat as a hard failure for this module.
          expect(tmplMethod).toBeTruthy();

          const res = await callWithFallback(mgr[tmplMethod].bind(mgr), [
            ["p1"],
            [{ providerId: "p1" }],
            ["p1", {}],
            [{ providerId: "p1", cursor: undefined }],
            [],
          ]);

          const templates = unwrapTemplates(res);
          expect(templates).toBeTruthy();
          expect(templates).toEqual(fixtures.resourceTemplates);
        });

        it("read resource: returns text content and handles very long strings (resource boundary)", async () => {
          const hugeText = "y".repeat(1024 * 1024); // 1MB
          const contents = [
            {
              uri: "file:///project/big.md",
              mimeType: "text/markdown",
              text: hugeText,
              annotations: deepNest(20),
            },
          ];

          const { api: client } = createClientStub({ contents });
          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], {
            client,
            storage,
            defaultTtlMs: 60_000,
            maxPersistBytes: 1024 * 1024,
            maxContentCacheEntries: 10,
            maxContentCacheBytes: 2 * 1024 * 1024,
          });

          const readMethod = findMethod(mgr, [/^readResource$/i, /resource.*read/i, /read.*resource/i]);
          expect(readMethod).toBeTruthy();

          const res = await callWithFallback(mgr[readMethod].bind(mgr), [
            ["p1", "file:///project/big.md"],
            [{ providerId: "p1", uri: "file:///project/big.md" }],
            ["file:///project/big.md"],
            [{ uri: "file:///project/big.md" }],
          ]);

          const outContents = unwrapContents(res);
          expect(outContents).toBeTruthy();
          expect(outContents[0]?.text).toBe(hugeText);

          expect(client.readResource.mock.calls.length + client.request.mock.calls.length).toBeGreaterThan(0);
        });

        it("read resource: supports binary blob content (type boundary)", async () => {
          const blob = new Uint8Array([0, 1, 2, 255]);
          const contents = [{ uri: "file:///project/img.bin", mimeType: "application/octet-stream", blob }];

          const { api: client } = createClientStub({ contents });
          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], {
            client,
            storage,
            defaultTtlMs: 60_000,
            maxPersistBytes: 1024 * 1024,
          });

          const readMethod = findMethod(mgr, [/^readResource$/i, /resource.*read/i, /read.*resource/i]);
          expect(readMethod).toBeTruthy();

          const res = await callWithFallback(mgr[readMethod].bind(mgr), [
            ["p1", "file:///project/img.bin"],
            [{ providerId: "p1", uri: "file:///project/img.bin" }],
            ["file:///project/img.bin"],
            [{ uri: "file:///project/img.bin" }],
          ]);

          const outContents = unwrapContents(res);
          expect(outContents).toBeTruthy();

          const out = outContents[0];
          expect(out).toBeTruthy();
          expect(out.uri).toBe("file:///project/img.bin");
          expect(out.blob).toBeTruthy();
          expect(out.blob instanceof Uint8Array || typeof out.blob === "string").toBe(true);

          if (out.blob instanceof Uint8Array) {
            expect(Array.from(out.blob)).toEqual(Array.from(blob));
          }
        });

        it("read resource: error handling (client throws) surfaces an Error or returns an error-shaped result", async () => {
          const { api: client } = createClientStub();
          client.readResource.mockImplementation(async () => {
            throw new Error("boom");
          });
          client.request.mockImplementation(async () => {
            throw new Error("boom");
          });

          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], { client, storage });

          const readMethod = findMethod(mgr, [/^readResource$/i, /resource.*read/i, /read.*resource/i]);
          expect(readMethod).toBeTruthy();

          let err = null;
          let res = null;
          try {
            res = await callWithFallback(mgr[readMethod].bind(mgr), [
              ["p1", "file:///x"],
              [{ providerId: "p1", uri: "file:///x" }],
              ["file:///x"],
              [{ uri: "file:///x" }],
            ]);
          } catch (e) {
            err = e;
          }

          if (err) {
            expect(err).toBeInstanceOf(Error);
          } else {
            // If the manager chooses to swallow errors, it should not return undefined.
            expect(res).not.toBeUndefined();
          }
        });

        it("subscribe resource: returns a subscription with unsubscribe() (concurrency: rapid subscribe/unsubscribe)", async () => {
          const { api: client } = createClientStub();
          const storage = createStorageMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], { client, storage });

          const subMethod = findMethod(mgr, [/^subscribe/i, /resource.*subscribe/i, /subscribe.*resource/i]);
          expect(subMethod).toBeTruthy();

          const cb = vi.fn();
          const uri = "file:///project/README.md";

          const sub1 = await callWithFallback(mgr[subMethod].bind(mgr), [
            ["p1", uri, cb],
            [{ providerId: "p1", uri }, cb],
            [uri, cb],
            [{ uri }, cb],
          ]);

          const sub2 = await callWithFallback(mgr[subMethod].bind(mgr), [
            ["p1", uri, cb],
            [{ providerId: "p1", uri }, cb],
            [uri, cb],
            [{ uri }, cb],
          ]);

          expect(sub1).toBeTruthy();
          expect(sub2).toBeTruthy();

          expect(typeof sub1.unsubscribe).toBe("function");
          expect(typeof sub2.unsubscribe).toBe("function");

          const [u1, u2] = await Promise.all([sub1.unsubscribe(), sub2.unsubscribe()]);
          expect(u1 && typeof u1 === "object" && "ok" in u1).toBe(true);
          expect(u2 && typeof u2 === "object" && "ok" in u2).toBe(true);

          // IDs should be stable-ish and not falsy if provided.
          if ("id" in sub1 && "id" in sub2) {
            expect(sub1.id).toBeTruthy();
            expect(sub2.id).toBeTruthy();
          }
        });

        it("supports async store interface {get,set} (type boundary: object as Storage)", async () => {
          const { api: client } = createClientStub();
          const asyncStore = createAsyncStoreMock();

          const mod = await loadFresh();
          const mgr = await instantiateMaybe(mod[exportName], { client, storage: asyncStore });

          const listMethod = findMethod(mgr, [/^listResources$/i, /resources.*list/i, /list.*resources/i]);
          expect(listMethod).toBeTruthy();

          await callWithFallback(mgr[listMethod].bind(mgr), [["p1"], [{ providerId: "p1" }], []]);
          expect(asyncStore.set).toHaveBeenCalled();
        });
      });
    } else {
      // Generic non-manager export tests (keep minimal but meaningful).
      it("is stable across repeated calls for boundary inputs (does not throw non-Error)", async () => {
        const mod = await loadFresh();
        const exported = mod[exportName];
        expect(typeof exported).toBe("function");

        // If this is a class, skip call checks and just ensure it's constructible or throws Error.
        if (isClass(exported)) {
          let err = null;
          try {
            // Try a few boundary inputs for constructor.
            // eslint-disable-next-line no-new
            new exported();
            // eslint-disable-next-line no-new
            new exported({});
            // eslint-disable-next-line no-new
            new exported(null);
          } catch (e) {
            err = e;
          }
          if (err) expect(err).toBeInstanceOf(Error);
          return;
        }

        const arity = Math.min(3, Math.max(0, exported.length));
        const boundary = [
          null,
          undefined,
          "",
          "   ",
          0,
          -1,
          Number.MAX_SAFE_INTEGER,
          "123",
          [],
          {},
          deepNest(5),
        ];

        /** @type {any[][]} */
        const argLists = [];
        if (arity === 0) {
          argLists.push([]);
        } else if (arity === 1) {
          for (const a of boundary) argLists.push([a]);
        } else if (arity === 2) {
          argLists.push([null, null]);
          argLists.push([undefined, undefined]);
          argLists.push(["", "fallback"]);
          argLists.push(["   ", "fallback"]);
          argLists.push([0, -1]);
          argLists.push(["123", 10]);
          argLists.push([{}, []]);
        } else {
          argLists.push([null, null, null]);
          argLists.push([undefined, undefined, undefined]);
          argLists.push(["", "  ", "fallback"]);
          argLists.push([0, -1, Number.MAX_SAFE_INTEGER]);
          argLists.push(["123", {}, []]);
        }

        for (const args of argLists.slice(0, 10)) {
          const run = async () => {
            const out = exported(...args);
            return out && typeof out.then === "function" ? await out : out;
          };

          let aErr = null;
          let bErr = null;
          let aVal;
          let bVal;

          try {
            aVal = await run();
          } catch (e) {
            aErr = e;
          }
          try {
            bVal = await run();
          } catch (e) {
            bErr = e;
          }

          if (aErr || bErr) {
            expect(aErr || bErr).toBeInstanceOf(Error);
          } else {
            // Determinism check for primitives; for objects just ensure it's not undefined.
            const isPrimitive =
              aVal === null || aVal === undefined || (typeof aVal !== "object" && typeof aVal !== "function");
            if (isPrimitive) expect(bVal).toBe(aVal);
            else expect(aVal).not.toBeUndefined();
          }
        }
      });
    }
  });
}