import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", () => {
  /** @param {any} v */
  const isPlainObjectImpl = (v) => {
    if (v === null || typeof v !== "object") return false;
    if (Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
  };

  /** @param {any} v */
  const toNonEmptyStringImpl = (v) => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  };

  /** @param {any} value */
  const safeNumber = (value) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const s = value.trim();
    if (!s) return null;
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  };

  /** @param {any} value */
  const safeInt = (value) => {
    const v = safeNumber(value);
    return v === null ? null : Math.floor(v);
  };

  /**
   * @param {any} value
   * @param {any} fallback
   */
  const toNonNegativeIntImpl = (value, fallback = 0) => {
    const v = safeInt(value);
    if (v !== null) return v >= 0 ? v : fallback;

    const s = typeof value === "string" ? value.trim() : "";
    if (!s) return fallback;
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  /**
   * @param {any} value
   * @param {any} fallback
   */
  const toPositiveIntImpl = (value, fallback = 1) => {
    const n = toNonNegativeIntImpl(value, fallback);
    return n > 0 ? n : fallback;
  };

  return {
    isPlainObject: vi.fn(isPlainObjectImpl),
    toNonEmptyString: vi.fn(toNonEmptyStringImpl),
    toNonNegativeInt: vi.fn(toNonNegativeIntImpl),
    toPositiveInt: vi.fn(toPositiveIntImpl),
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
    const { input } = JSON.parse(options?.body || "{}");
    const list = Array.isArray(input) ? input : [];
    const embeddings = list.map((text) => (mapper ? mapper(text) : [String(text).length]));
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

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("normalizeEmbeddingConfig", () => {
  it("should_return_null_when_raw_is_null", () => {
    expect(normalizeEmbeddingConfig(null)).toBeNull();
  });

  it("should_return_null_when_raw_is_undefined", () => {
    expect(normalizeEmbeddingConfig(undefined)).toBeNull();
  });

  it("should_return_null_when_raw_is_not_object", () => {
    expect(normalizeEmbeddingConfig("nope")).toBeNull();
  });

  it("should_return_null_when_raw_is_array", () => {
    expect(normalizeEmbeddingConfig([])).toBeNull();
  });

  it("should_return_null_when_endpoint_missing", () => {
    expect(normalizeEmbeddingConfig({})).toBeNull();
  });

  it("should_return_null_when_endpoint_is_whitespace", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "   " })).toBeNull();
  });

  it("should_return_null_when_endpoint_is_not_valid_url", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "not-a-url" })).toBeNull();
  });

  it("should_return_null_when_endpoint_is_not_https", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "http://example.com" })).toBeNull();
  });

  it("should_return_null_when_endpoint_hostname_is_localhost", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "https://localhost" })).toBeNull();
  });

  it("should_return_null_when_endpoint_hostname_is_dot_localhost", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "https://api.localhost" })).toBeNull();
  });

  it("should_return_null_when_endpoint_hostname_is_dot_local", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "https://example.local" })).toBeNull();
  });

  it("should_return_null_when_endpoint_hostname_is_private_ipv4", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "https://10.0.0.1" })).toBeNull();
  });

  it("should_return_null_when_endpoint_hostname_is_loopback_ipv4", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "https://127.0.0.1" })).toBeNull();
  });

  it("should_return_null_when_endpoint_hostname_is_loopback_ipv6", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "https://[::1]" })).toBeNull();
  });

  it("should_return_null_when_endpoint_hostname_is_link_local_ipv6", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "https://[fe80::1]" })).toBeNull();
  });

  it("should_return_null_when_endpoint_hostname_has_ipv6_zone_id", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "https://[fe80::1%25lo0]" })).toBeNull();
  });

  it("should_return_null_when_endpoint_hostname_is_ipv6_mapped_private_ipv4", () => {
    expect(normalizeEmbeddingConfig({ endpoint: "https://[::ffff:7f00:1]" })).toBeNull();
  });

  it("should_return_null_when_disabled_is_false", () => {
    expect(normalizeEmbeddingConfig({ endpoint: BASE_ENDPOINT, enabled: false })).toBeNull();
  });

  it("should_return_null_when_disabled_is_zero", () => {
    expect(normalizeEmbeddingConfig({ endpoint: BASE_ENDPOINT, enabled: 0 })).toBeNull();
  });

  it("should_accept_endpoint_from_url", () => {
    expect(normalizeEmbeddingConfig({ url: BASE_ENDPOINT })?.endpoint).toBe(BASE_ENDPOINT);
  });

  it("should_accept_endpoint_from_baseUrl", () => {
    expect(normalizeEmbeddingConfig({ baseUrl: BASE_ENDPOINT })?.endpoint).toBe(BASE_ENDPOINT);
  });

  it("should_use_key_as_apiKey_fallback", () => {
    expect(normalizeEmbeddingConfig({ endpoint: BASE_ENDPOINT, key: "k" })?.apiKey).toBe("k");
  });

  it("should_return_empty_headers_when_headers_is_not_plain_object", () => {
    expect(normalizeEmbeddingConfig({ endpoint: BASE_ENDPOINT, headers: [] })?.headers).toEqual({});
  });

  it("should_drop_headers_with_empty_keys", () => {
    expect(
      normalizeEmbeddingConfig({ endpoint: BASE_ENDPOINT, headers: { "": "skip", "  ": "skip2", Good: "ok" } })?.headers
    ).toEqual({ Good: "ok" });
  });

  it("should_return_normalized_config_when_values_have_whitespace_and_type_edges", () => {
    expect(
      normalizeEmbeddingConfig({
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
      })
    ).toEqual({
      endpoint: BASE_ENDPOINT,
      model: "text-embed",
      apiKey: "key",
      headers: { "X-Test": "123", Authorization: "Token abc", nested: "[object Object]" },
      timeoutMs: 2500,
      batchSize: 32,
      flushIntervalMs: 0,
      maxQueue: 5,
      cooldownMs: Number.MAX_SAFE_INTEGER,
    });
  });

  it("should_apply_default_numeric_values_when_not_provided", () => {
    expect(normalizeEmbeddingConfig({ endpoint: BASE_ENDPOINT })).toEqual({
      endpoint: BASE_ENDPOINT,
      model: null,
      apiKey: null,
      headers: {},
      timeoutMs: 5000,
      batchSize: 32,
      flushIntervalMs: 30,
      maxQueue: 2000,
      cooldownMs: 300_000,
    });
  });
});

describe("EmbeddingService", () => {
  it("should_return_false_when_config_is_invalid", () => {
    expect(new EmbeddingService({ endpoint: "http://example.com" }, { fetchImpl: vi.fn() }).enabled).toBe(false);
  });

  it("should_return_false_when_fetchImpl_is_explicitly_null", () => {
    expect(new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl: null }).enabled).toBe(false);
  });

  it("should_return_false_when_fetchImpl_is_explicitly_undefined", () => {
    expect(new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl: undefined }).enabled).toBe(false);
  });

  it("should_return_true_when_config_valid_and_fetchImpl_provided", () => {
    expect(new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl: vi.fn() }).enabled).toBe(true);
  });

  it("should_use_global_fetch_when_fetchImpl_not_provided", async () => {
    const fetchImpl = makeFetchFromInputs();
    globalThis.fetch = fetchImpl;
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT });
    await svc.embed("a");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("should_return_initial_status_when_created", () => {
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, model: "m1" }, { fetchImpl: vi.fn() });
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

  it("should_resolve_empty_array_when_enqueue_given_null", async () => {
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl: vi.fn() });
    await expect(svc.enqueue(null)).resolves.toEqual([]);
  });

  it("should_resolve_empty_array_when_enqueue_given_undefined", async () => {
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl: vi.fn() });
    await expect(svc.enqueue(undefined)).resolves.toEqual([]);
  });

  it("should_resolve_empty_array_when_enqueue_given_empty_array", async () => {
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl: vi.fn() });
    await expect(svc.enqueue([])).resolves.toEqual([]);
  });

  it("should_resolve_empty_array_when_enqueue_given_only_blank_strings", async () => {
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl: vi.fn() });
    await expect(svc.enqueue(["", "  "])).resolves.toEqual([]);
  });

  it("should_return_null_when_enqueue_exceeds_maxQueue", async () => {
    vi.useFakeTimers();
    try {
      const svc = new EmbeddingService(
        { endpoint: BASE_ENDPOINT, maxQueue: 1, flushIntervalMs: 1000 },
        { fetchImpl: makeFetchFromInputs() }
      );
      const p1 = svc.enqueue(["a"]);
      const p2 = svc.enqueue(["b"]);

      await expect(p2).resolves.toBeNull();

      vi.runAllTimers();
      await p1;
    } finally {
      vi.useRealTimers();
    }
  });

  it("should_resolve_null_when_request_signal_is_aborted_before_flush", async () => {
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl: makeFetchFromInputs() });
    const controller = new AbortController();
    controller.abort("stop");
    await expect(svc.enqueue(["a"], { signal: controller.signal, immediate: true })).resolves.toBeNull();
  });

  it("should_return_embedding_for_non_aborted_request_when_another_request_is_aborted", async () => {
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl: makeFetchFromInputs() });
    const controller = new AbortController();
    controller.abort("stop");
    const aborted = svc.enqueue(["a"], { signal: controller.signal, immediate: true });
    const ok = svc.enqueue(["bb"], { immediate: true });
    await aborted;
    const result = await ok;
    expect(Array.from(result[0])).toEqual([2]);
  });

  it("should_stringify_non_string_inputs_in_request_body", async () => {
    const fetchImpl = vi.fn(async (_url, options) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embedding: [1] }),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    await svc.embed({ foo: "bar" });
    const [, options] = fetchImpl.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.input).toEqual(["[object Object]"]);
  });

  it("should_add_bearer_authorization_when_apiKey_provided_and_no_header_present", async () => {
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, apiKey: "secret" }, { fetchImpl });
    await svc.embed("a");
    const [, options] = fetchImpl.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer secret");
  });

  it("should_not_override_existing_Authorization_header", async () => {
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService(
      { endpoint: BASE_ENDPOINT, apiKey: "secret", headers: { Authorization: "Token abc" } },
      { fetchImpl }
    );
    await svc.embed("a");
    const [, options] = fetchImpl.mock.calls[0];
    expect(options.headers.Authorization).toBe("Token abc");
  });

  it("should_not_add_Authorization_when_lowercase_authorization_present", async () => {
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService(
      { endpoint: BASE_ENDPOINT, apiKey: "secret", headers: { authorization: "Token abc" } },
      { fetchImpl }
    );
    await svc.embed("a");
    const [, options] = fetchImpl.mock.calls[0];
    expect(options.headers.authorization).toBe("Token abc");
  });

  it("should_include_model_in_request_body_when_configured", async () => {
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, model: "m1" }, { fetchImpl });
    await svc.embed("a");
    const [, options] = fetchImpl.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.model).toBe("m1");
  });

  it("should_send_very_long_input_strings_without_truncation", async () => {
    const longText = "x".repeat(100_000);
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    await svc.embed(longText);
    const [, options] = fetchImpl.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.input[0].length).toBe(longText.length);
  });

  it("should_batch_concurrent_embeds_into_single_fetch", async () => {
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, batchSize: 10 }, { fetchImpl });
    const p1 = svc.embed("a");
    const p2 = svc.embed("bb");
    await Promise.all([p1, p2]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("should_return_embeddings_for_batched_embeds_in_call_order", async () => {
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, batchSize: 10 }, { fetchImpl });
    const p1 = svc.embed("a");
    const p2 = svc.embed("bb");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect([r1[0][0], r2[0][0]]).toEqual([1, 2]);
  });

  it("should_call_fetch_multiple_times_when_request_exceeds_batchSize", async () => {
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, batchSize: 3 }, { fetchImpl });
    await svc.enqueue(["a", "bb", "ccc", "dddd", "eeeee"], { immediate: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("should_preserve_embedding_order_when_request_is_split_across_batches", async () => {
    const fetchImpl = makeFetchFromInputs();
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, batchSize: 3 }, { fetchImpl });
    const result = await svc.enqueue(["a", "bb", "ccc", "dddd", "eeeee"], { immediate: true });
    expect(result.map((v) => v[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it("should_sort_embeddings_by_index_when_response_uses_data_rows_with_index", async () => {
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
    const vectors = await svc.embed(["first", "second"]);
    expect(vectors.map((v) => v[0])).toEqual([1, 2]);
  });

  it("should_accept_response_with_data_arrays", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ data: [[1], [2]] }),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    const vectors = await svc.embed(["a", "b"]);
    expect(vectors.map((v) => v[0])).toEqual([1, 2]);
  });

  it("should_accept_response_with_embedding_property", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embedding: [1] }),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    const vectors = await svc.embed("a");
    expect(vectors.map((v) => v[0])).toEqual([1]);
  });

  it("should_accept_response_with_vector_property", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ vector: [1] }),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    const vectors = await svc.embed("a");
    expect(vectors.map((v) => v[0])).toEqual([1]);
  });

  it("should_trim_extra_vectors_when_only_one_embedding_expected", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embeddings: [[1], [2]] }),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    const vectors = await svc.embed("only-one");
    expect(vectors.map((v) => v[0])).toEqual([1]);
  });

  it("should_return_null_when_response_vector_count_does_not_match_expected", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embeddings: [[1]] }),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    await expect(svc.embed(["a", "b"])).resolves.toBeNull();
  });

  it("should_return_null_when_fetch_response_is_not_ok", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Bad",
      json: async () => ({}),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, cooldownMs: 1 }, { fetchImpl });
    await expect(svc.embed("a")).resolves.toBeNull();
  });

  it("should_set_available_false_when_request_fails", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Bad",
      json: async () => ({}),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, cooldownMs: 1 }, { fetchImpl });
    await svc.embed("a");
    expect(svc.getStatus().available).toBe(false);
  });

  it("should_increment_failures_when_request_fails", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Bad",
      json: async () => ({}),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, cooldownMs: 1 }, { fetchImpl });
    await svc.embed("a");
    expect(svc.getStatus().failures).toBe(1);
  });

  it("should_set_lastError_when_request_fails", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Bad",
      json: async () => ({}),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, cooldownMs: 1 }, { fetchImpl });
    await svc.embed("a");
    expect(svc.getStatus().lastError).toContain("EmbeddingService request failed");
  });

  it("should_set_nextRetryAt_based_on_cooldownMs_when_request_fails", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Bad",
        json: async () => ({}),
      }));
      const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, cooldownMs: 1000 }, { fetchImpl });
      await svc.embed("a");
      expect(svc.getStatus().nextRetryAt).toBe(Date.now() + 1000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should_return_null_when_in_cooldown_and_enqueue_called", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Bad",
        json: async () => ({}),
      }));
      const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, cooldownMs: 1000 }, { fetchImpl });
      await svc.embed("a");
      await expect(svc.enqueue(["b"], { immediate: true })).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("should_attempt_again_after_cooldown_and_return_vectors", async () => {
    vi.useFakeTimers();
    try {
      const start = new Date("2020-01-01T00:00:00.000Z");
      vi.setSystemTime(start);
      const fetchImpl = vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Bad",
        json: async () => ({}),
      }));
      fetchImpl.mockImplementationOnce(async () => ({
        ok: false,
        status: 500,
        statusText: "Bad",
        json: async () => ({}),
      }));
      fetchImpl.mockImplementationOnce(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ embedding: [1] }),
      }));

      const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, cooldownMs: 1000 }, { fetchImpl });
      await svc.embed("a");
      vi.setSystemTime(new Date(start.getTime() + 1000));
      const vectors = await svc.embed("a");
      expect(vectors.map((v) => v[0])).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should_clear_lastError_after_successful_request", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embedding: [1] }),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });
    await svc.embed("a");
    expect(svc.getStatus().lastError).toBeNull();
  });

  it("should_set_lastError_when_response_format_invalid", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embedding: [1, "nope"] }),
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, cooldownMs: 1 }, { fetchImpl });
    await svc.embed("a");
    expect(svc.getStatus().lastError).toBe("EmbeddingService response format invalid");
  });

  it("should_set_lastError_when_json_parsing_throws", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => {
        throw new Error("bad json");
      },
    }));
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, cooldownMs: 1 }, { fetchImpl });
    await svc.embed("a");
    expect(svc.getStatus().lastError).toBe("bad json");
  });

  it("should_set_lastError_when_fetch_throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT, cooldownMs: 1 }, { fetchImpl });
    await svc.embed("a");
    expect(svc.getStatus().lastError).toBe("network down");
  });

  it("should_return_null_when_embed_times_out", async () => {
    vi.useFakeTimers();
    try {
      const deferred = createDeferred();
      const fetchImpl = vi.fn(async () => deferred.promise);
      const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });

      const resultPromise = svc.embed("slow", { timeoutMs: 5 });
      await Promise.resolve();

      vi.advanceTimersByTime(5);
      await Promise.resolve();

      await expect(resultPromise).resolves.toBeNull();

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

  it("should_return_false_when_flush_called_on_disabled_service", async () => {
    const svc = new EmbeddingService({ endpoint: "http://example.com" }, { fetchImpl: vi.fn() });
    await expect(svc.flush()).resolves.toBe(false);
  });

  it("should_return_true_when_flush_called_with_empty_queue", async () => {
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl: vi.fn() });
    await expect(svc.flush()).resolves.toBe(true);
  });

  it("should_reuse_in_flight_flush_for_concurrent_calls", async () => {
    const deferred = createDeferred();
    const fetchImpl = vi.fn(async () => deferred.promise);
    const svc = new EmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl });

    const queued = svc.enqueue(["a"], { immediate: true });
    await Promise.resolve();

    const flush1 = svc.flush();
    const flush2 = svc.flush();

    deferred.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ embedding: [1] }),
    });

    await Promise.all([flush1, flush2, queued]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createEmbeddingService", () => {
  it("should_create_instance_when_called", () => {
    expect(createEmbeddingService({ endpoint: BASE_ENDPOINT }, { fetchImpl: vi.fn() })).toBeInstanceOf(EmbeddingService);
  });
});

describe("default export", () => {
  it("should_expose_named_exports", () => {
    expect(embeddingModule).toMatchObject({ EmbeddingService, createEmbeddingService, normalizeEmbeddingConfig });
  });
});