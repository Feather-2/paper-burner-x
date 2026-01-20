import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    toNonNegativeInt: vi.fn(actual.toNonNegativeInt),
    toPositiveInt: vi.fn(actual.toPositiveInt),
  };
});

import {
  EmbeddingService,
  createEmbeddingService,
  normalizeEmbeddingConfig,
  default as embeddingModule,
} from "../../../../../js/agents/retrieval/embeddings/embedding-service.js";

const BASE_ENDPOINT = "https://example.com/embeddings";

function makeFetchFromInputs(mapper) {
  return vi.fn(async (_url, options) => {
    const { input } = JSON.parse(options.body);
    const embeddings = input.map((text) => (mapper ? mapper(text) : [String(text).length]));
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embeddings }),
    };
  });
}

function createDeferred() {
  /** @type {(value: any) => void} */
  let resolve;
  /** @type {(reason?: any) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeEmbeddingConfig", () => {
  it("returns null for empty or invalid configs", () => {
    expect(normalizeEmbeddingConfig(null)).toBeNull();
    expect(normalizeEmbeddingConfig(undefined)).toBeNull();
    expect(normalizeEmbeddingConfig("")).toBeNull();
    expect(normalizeEmbeddingConfig([])).toBeNull();
    expect(normalizeEmbeddingConfig({})).toBeNull();
    expect(normalizeEmbeddingConfig({ endpoint: "   " })).toBeNull();
  });

  it("rejects non-https or private endpoints", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "http://example.com" })).toBeNull();
    expect(normalizeEmbeddingConfig({ endpoint: "https://localhost" })).toBeNull();
    expect(normalizeEmbeddingConfig({ endpoint: "https://127.0.0.1" })).toBeNull();
    expect(normalizeEmbeddingConfig({ endpoint: "https://[::1]" })).toBeNull();

    const cfg = normalizeEmbeddingConfig({ endpoint: "https://example.com/v1" });
    expect(cfg).not.toBeNull();
    expect(cfg?.endpoint).toBe("https://example.com/v1");
  });

  it("normalizes config values and headers with boundary inputs", () => {
    const cfg = normalizeEmbeddingConfig({
      endpoint: " https://example.com/embeddings ",
      model: " text-embed ",
      apiKey: " key ",
      headers: {
        "X-Test": 123,
        "": "skip",
        "  ": "skip2",
        Authorization: "Token abc",
        nested: { a: { b: { c: 1 } } },
      },
      timeoutMs: "2500",
      batchSize: -1,
      flushIntervalMs: 0,
      maxQueue: "5",
      cooldownMs: Number.MAX_SAFE_INTEGER,
    });

    expect(cfg?.endpoint).toBe("https://example.com/embeddings");
    expect(cfg?.model).toBe("text-embed");
    expect(cfg?.apiKey).toBe("key");
    expect(cfg?.headers).toEqual({
      "X-Test": "123",
      Authorization: "Token abc",
      nested: "[object Object]",
    });
    expect(cfg?.timeoutMs).toBe(2500);
    expect(cfg?.batchSize).toBe(32);
    expect(cfg?.flushIntervalMs).toBe(0);
    expect(cfg?.maxQueue).toBe(5);
    expect(cfg?.cooldownMs).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("returns null when disabled", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "https://example.com", enabled: false })).toBeNull();
    expect(normalizeEmbeddingConfig({ endpoint: "https://example.com", enabled: 0 })).toBeNull();
  });
});

describe("EmbeddingService", () => {
  it("reports disabled when config invalid or fetch missing", () => {
    const svcInvalid = new EmbeddingService({ endpoint: "http://example.com" }, { fetchImpl: vi.fn() });
    expect(svcInvalid.enabled).toBe(false);

    const svcNoFetch = new EmbeddingService({ endpoint: "https://example.com" }, { fetchImpl: null });
    expect(svcNoFetch.enabled).toBe(false);
  });

  it("returns initial status", () => {
    const fetchImpl = vi.fn();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, model: "m1" }, { fetchImpl });
    expect(svc.getStatus()).toEqual({
      enabled: true,
      available: null,
      failures: 0,
      nextRetryAt: 0,
      endpoint: BASE_ENDPOINT,
      model: "m1",
      lastError: null,
    });
  });

  it("returns empty arrays for empty inputs", async () => {
    const fetchImpl = vi.fn();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });

    await expect(svc.enqueue(null)).resolves.toEqual([]);
    await expect(svc.enqueue(undefined)).resolves.toEqual([]);
    await expect(svc.enqueue([])).resolves.toEqual([]);
    await expect(svc.enqueue(["", "  "])).resolves.toEqual([]);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns null when maxQueue is reached", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = makeFetchFromInputs();
      const svc = new EmbeddingService(
        { endpoint: BASE_ENDPOINT, maxQueue: 1, flushIntervalMs: 1000 },
        { fetchImpl }
      );

      const p1 = svc.enqueue(["a"]);
      const p2 = svc.enqueue(["b"]);

      await expect(p2).resolves.toBeNull();

      vi.runAllTimers();
      const r1 = await p1;
      expect(r1).toHaveLength(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips aborted requests during flush", async () => {
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });

    const controller = new AbortController();
    controller.abort("stop");

    const p1 = svc.enqueue(["a"], { signal: controller.signal, immediate: true });
    const p2 = svc.enqueue(["bb"], { immediate: true });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBeNull();
    expect(Array.from(r2[0])).toEqual([2]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stringifies non-array input and adds Authorization header", async () => {
    const fetchImpl = vi.fn(async (_url, options) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embedding: [1] }),
    }));

    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, apiKey: "secret" }, { fetchImpl });
    const result = await svc.embed({ foo: "bar" });

    expect(result).toHaveLength(1);
    const [, options] = fetchImpl.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.input).toEqual(["[object Object]"]);
    expect(options.headers.Authorization).toBe("Bearer secret");
  });

  it("handles very long input strings", async () => {
    const longText = "x".repeat(100000);
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });

    const result = await svc.embed(longText);

    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe(longText.length);
    const [, options] = fetchImpl.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.input[0].length).toBe(longText.length);
  });

  it("batches concurrent embed calls into one request", async () => {
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, batchSize: 10 }, { fetchImpl });

    const p1 = svc.embed("a");
    const p2 = svc.embed("bb");

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r1[0][0]).toBe(1);
    expect(r2[0][0]).toBe(2);
  });

  it("splits large requests across batches and preserves order", async () => {
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, batchSize: 3 }, { fetchImpl });

    const result = await svc.enqueue(["a", "bb", "ccc", "dddd", "eeeee"], { immediate: true });
    const values = result.map((vec) => vec[0]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(values).toEqual([1, 2, 3, 4, 5]);
  });

  it("orders embeddings by index when provided", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        data: [
          { index: 1, embedding: [2] },
          { index: 0, embedding: [1] },
        ],
      }),
    }));

    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    const vectors = await svc._callEmbeddings(["first", "second"]);

    expect(Array.from(vectors[0])).toEqual([1]);
    expect(Array.from(vectors[1])).toEqual([2]);
  });

  it("trims extra vectors when only one is expected", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embeddings: [[1], [2]] }),
    }));

    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    const vectors = await svc._callEmbeddings(["only-one"]);

    expect(vectors).toHaveLength(1);
    expect(Array.from(vectors[0])).toEqual([1]);
  });

  it("marks failure on non-ok response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Bad",
      json: async () => ({}),
    }));

    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    const now = Date.now();
    const result = await svc._callEmbeddings(["a"]);

    expect(result).toBeNull();
    const status = svc.getStatus();
    expect(status.available).toBe(false);
    expect(status.failures).toBe(1);
    expect(status.lastError).toContain("500");
    expect(status.nextRetryAt).toBeGreaterThanOrEqual(now);
  });

  it("marks failure on invalid embedding response format", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embedding: [1, "nope"] }),
    }));

    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    const result = await svc._callEmbeddings(["a"]);

    expect(result).toBeNull();
    const status = svc.getStatus();
    expect(status.failures).toBe(1);
    expect(status.lastError).toBe("EmbeddingService response format invalid");
  });

  it("returns null when embed times out", async () => {
    vi.useFakeTimers();
    try {
      const deferred = createDeferred();
      const fetchImpl = vi.fn(async () => deferred.promise);
      const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });

      const resultPromise = svc.embed("slow", { timeoutMs: 5 });
      await Promise.resolve();

      vi.advanceTimersByTime(5);
      await Promise.resolve();

      const result = await resultPromise;
      expect(result).toBeNull();

      deferred.resolve({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ embedding: [1] }),
      });

      await svc.flush();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses in-flight flush for concurrent calls", async () => {
    const deferred = createDeferred();
    const fetchImpl = vi.fn(async () => deferred.promise);
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });

    const queued = svc.enqueue(["a"], { immediate: true });
    await Promise.resolve();

    const flush1 = svc.flush();
    const flush2 = svc.flush();

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    deferred.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embedding: [1] }),
    });

    await expect(flush1).resolves.toBe(true);
    await expect(flush2).resolves.toBe(true);
    await expect(queued).resolves.toHaveLength(1);
  });
});

describe("createEmbeddingService", () => {
  it("creates an EmbeddingService instance", () => {
    const fetchImpl = vi.fn();
    const svc = createEmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });

    expect(svc).toBeInstanceOf(EmbeddingService);
    expect(svc.getStatus().endpoint).toBe(BASE_ENDPOINT);
  });
});

describe("default export", () => {
  it("exposes EmbeddingService and helpers", () => {
    expect(embeddingModule).toMatchObject({
      EmbeddingService,
      createEmbeddingService,
      normalizeEmbeddingConfig,
    });
  });
});
