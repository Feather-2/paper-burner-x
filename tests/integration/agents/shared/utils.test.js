import { describe, it, expect, vi, afterEach } from "vitest";

import { createLogger, logEvent, trackToolCall, useLogger } from '../../../../js/agents/shared/utils/logger.js';
import {
  checkCancelled,
  createLinkedSignal,
  isAbortError,
  withCancellation,
} from '../../../../js/agents/shared/utils/cancellation.js';
import { Deque } from '../../../../js/agents/shared/utils/deque.js';
import LRUCacheDefault, { createAutoPruningCache, LRUCache } from '../../../../js/agents/shared/utils/lru-cache.js';
import {
  cryptoRandomHex,
  cryptoRandomUuid,
  makeSecureId,
  makeSecureTimestampedId,
} from '../../../../js/agents/shared/utils/secure-id.js';
import { clearTokenCache, estimateTokensCached, getTokenCacheStats } from '../../../../js/agents/shared/utils/token-cache.js';
import {
  deepClone,
  estimateTokenCount,
  estimateTokenCountFast,
  estimateTokens,
  isCjkChar,
  normalizeKey,
  sanitizeForJson,
  toBoolean,
  toNonNegativeInt,
  toNumber,
  toPositiveInt,
} from '../../../../js/agents/shared/utils/value-utils.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shared/utils/logger.js", () => {
  it("createLogger emits structured events and writes to console", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const emitted = [];
    const emit = vi.fn((name, payload, meta) => emitted.push({ name, payload, meta }));

    const logger = createLogger({
      emit,
      getContext: () => ({ runId: "run_1", stage: "ctx_stage" }),
      actor: "shared",
      stage: "override_stage",
    });

    logger.info("hello", { data: { ok: true } });

    expect(useLogger).toBe(createLogger);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].name).toBe("shared:log");
    expect(emitted[0].meta).toEqual({ status: "info" });
    expect(emitted[0].payload).toMatchObject({
      level: "info",
      message: "hello",
      runId: "run_1",
      stage: "override_stage",
      data: { ok: true },
    });
    expect(new Date(emitted[0].payload.timestamp).toString()).not.toBe("Invalid Date");

    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(consoleLog.mock.calls[0][0]).toBe("[shared:override_stage]");
    expect(consoleLog.mock.calls[0][1]).toBe("hello");
    expect(consoleLog.mock.calls[0][2]).toEqual({ data: { ok: true } });

    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("createLogger: enabled=false suppresses emit and console", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const emit = vi.fn();

    const logger = createLogger({ emit, enabled: false, actor: "shared", stage: "x" });
    logger.warn("nope");
    logger.error("nope");

    expect(emit).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("createLogger: data overrides context fields", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const emitted = [];
    const emit = vi.fn((name, payload) => emitted.push({ name, payload }));

    const logger = createLogger({
      emit,
      actor: "shared",
      getContext: () => ({ stage: "ctx_stage", runId: "run_ctx" }),
    });

    logger.info("override", { stage: "data_stage" });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].payload.stage).toBe("data_stage");
    expect(emitted[0].payload.runId).toBe("run_ctx");
    expect(consoleLog).toHaveBeenCalledTimes(1);
  });

  it("trackToolCall: success and failure log structured events", async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };

    const ok = await trackToolCall(logger, "grep", { pattern: "x" }, async () => ["a", "b"]);
    expect(ok).toEqual(["a", "b"]);

    expect(logger.info).toHaveBeenCalledTimes(2);
    expect(logger.info.mock.calls[0][0]).toBe("Tool call: grep");
    expect(logger.info.mock.calls[1][0]).toBe("Tool completed: grep");
    expect(logger.info.mock.calls[1][1]).toMatchObject({
      stage: "tool",
      data: { tool: "grep", success: true },
      toolCalls: [
        {
          tool: "grep",
          args: { pattern: "x" },
          result: { type: "object", length: 2 },
        },
      ],
    });

    await expect(
      trackToolCall(logger, "glob", { pattern: "*.js" }, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow(/boom/);

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toBe("Tool failed: glob");
    expect(logger.error.mock.calls[0][1]).toMatchObject({
      stage: "tool",
      data: { tool: "glob", success: false, error: "boom" },
      toolCalls: [{ tool: "glob", args: { pattern: "*.js" }, error: "boom" }],
    });
  });

  it("logEvent preserves legacy behavior", () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    logEvent({ message: "legacy" });
    logEvent("raw");

    expect(consoleLog).toHaveBeenCalledTimes(2);
    expect(consoleLog.mock.calls[0]).toEqual(["[Agent]", "legacy"]);
    expect(consoleLog.mock.calls[1]).toEqual(["[Agent]", "raw"]);
  });
});

describe("shared/utils/secure-id.js", () => {
  it("cryptoRandomHex returns deterministic lower-case hex and normalizes bytes", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(buf) {
        for (let i = 0; i < buf.length; i++) buf[i] = i;
        return buf;
      },
    });

    expect(cryptoRandomHex(4)).toBe("00010203");
    expect(cryptoRandomHex(0)).toBe("00");
    expect(cryptoRandomHex("nope")).toHaveLength(32);
    expect(cryptoRandomHex("nope")).toMatch(/^[0-9a-f]+$/);
  });

  it("cryptoRandomHex throws when crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => cryptoRandomHex(1)).toThrow(/globalThis\.crypto is unavailable/i);
  });

  it("cryptoRandomHex throws when getRandomValues is unavailable", () => {
    vi.stubGlobal("crypto", {});
    expect(() => cryptoRandomHex(1)).toThrow(/crypto\.getRandomValues is unavailable/i);
  });

  it("cryptoRandomUuid uses crypto.randomUUID when available", () => {
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000000");
    vi.stubGlobal("crypto", { randomUUID });

    expect(cryptoRandomUuid()).toBe("00000000-0000-4000-8000-000000000000");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("cryptoRandomUuid falls back to a v4-ish uuid when randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(buf) {
        for (let i = 0; i < buf.length; i++) buf[i] = i;
        return buf;
      },
    });

    const uuid = cryptoRandomUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("makeSecureId trims prefix and defaults to id", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid" });

    expect(makeSecureId("  foo ")).toBe("foo_uuid");
    expect(makeSecureId("")).toBe("id_uuid");
    expect(makeSecureId(null)).toBe("id_uuid");
  });

  it("makeSecureTimestampedId includes base36 timestamp and random hex", () => {
    vi.stubGlobal("crypto", {
      getRandomValues(buf) {
        for (let i = 0; i < buf.length; i++) buf[i] = i;
        return buf;
      },
    });
    vi.spyOn(Date, "now").mockReturnValue(1700000000000);

    const expectedTs = (1700000000000).toString(36);
    expect(makeSecureTimestampedId("sess")).toBe(`sess_${expectedTs}_0001020304050607`);
    expect(makeSecureTimestampedId("   ")).toBe(`id_${expectedTs}_0001020304050607`);
  });
});

describe("shared/utils/deque.js", () => {
  it("supports double-ended operations and peeking", () => {
    const deque = new Deque([1, 2]);

    expect(deque.size).toBe(2);
    expect(deque.peekFront()).toBe(1);
    expect(deque.peekBack()).toBe(2);

    deque.unshift(0);
    deque.push(3);

    expect(deque.toArray()).toEqual([0, 1, 2, 3]);
    expect(deque.peekFront()).toBe(0);
    expect(deque.peekBack()).toBe(3);

    expect(deque.pop()).toBe(3);
    expect(deque.shift()).toBe(0);
    expect(deque.toArray()).toEqual([1, 2]);

    deque.clear();
    expect(deque.isEmpty()).toBe(true);
    expect(deque.size).toBe(0);
  });

  it("returns undefined when empty and iterates in order", () => {
    const deque = new Deque();
    expect(deque.pop()).toBeUndefined();
    expect(deque.shift()).toBeUndefined();

    deque.push("a");
    deque.push("b");
    deque.unshift("z");

    expect([...deque]).toEqual(["z", "a", "b"]);

    const iterator = deque[Symbol.iterator]();
    expect(iterator.next()).toEqual({ value: "z", done: false });
    expect(iterator.next()).toEqual({ value: "a", done: false });
    expect(iterator.next()).toEqual({ value: "b", done: false });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });
});

describe("shared/utils/cancellation.js", () => {
  it("checkCancelled throws AbortError with message/cause derived from the reason", () => {
    expect(() => checkCancelled({ aborted: false })).not.toThrow();

    try {
      checkCancelled({ aborted: true, reason: "User cancelled" });
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("AbortError");
      expect(err.message).toBe("User cancelled");
      expect(err.cause).toBe("User cancelled");
      expect(isAbortError(err)).toBe(true);
    }

    const reasonError = new Error("parent aborted");
    expect(() => checkCancelled({ aborted: true, reason: reasonError })).toThrow(/parent aborted/);

    // Blank string -> default message.
    expect(() => checkCancelled({ aborted: true, reason: "   " })).toThrow(/Run cancelled/);

    // Object with message -> use it.
    expect(() => checkCancelled({ aborted: true, reason: { message: "from object" } })).toThrow(/from object/);

    expect(isAbortError({ code: "ABORT_ERR" })).toBe(true);
  });

  it("withCancellation checks options.signal before invoking fn", async () => {
    const fn = vi.fn(() => "ok");
    const wrapped = withCancellation(fn, "unit");

    await expect(wrapped({ signal: { aborted: true, reason: "stop" } })).rejects.toMatchObject({
      name: "AbortError",
      message: "stop",
    });
    expect(fn).not.toHaveBeenCalled();

    await expect(wrapped({ signal: { aborted: false } })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("withCancellation preserves this-binding and arguments", async () => {
    const obj = {
      value: 2,
      add(n) {
        return this.value + n;
      },
    };

    const wrapped = withCancellation(obj.add, "add");
    await expect(wrapped.call(obj, 3, { signal: null })).resolves.toBe(5);
  });

  it("createLinkedSignal links to parent abort and supports timeout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));

    try {
      const immediate = createLinkedSignal({ aborted: true, reason: "bye" }, 50);
      expect(immediate.aborted).toBe(true);
      expect(() => checkCancelled(immediate)).toThrow(/bye/);

      const listeners = new Set();
      const parent = {
        aborted: false,
        reason: undefined,
        addEventListener: vi.fn((type, listener) => {
          if (type === "abort") listeners.add(listener);
        }),
        removeEventListener: vi.fn((type, listener) => {
          if (type === "abort") listeners.delete(listener);
        }),
      };

      const linked = createLinkedSignal(parent, 50);
      expect(linked.aborted).toBe(false);

      parent.aborted = true;
      parent.reason = new Error("parent stop");
      for (const listener of listeners) listener();

      expect(linked.aborted).toBe(true);
      expect(() => checkCancelled(linked)).toThrow(/parent stop/);
      expect(parent.addEventListener).toHaveBeenCalledTimes(1);
      expect(parent.removeEventListener.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(listeners.size).toBe(0);

      const timeoutOnly = createLinkedSignal(null, 10);
      expect(timeoutOnly.aborted).toBe(false);
      vi.advanceTimersByTime(10);
      expect(timeoutOnly.aborted).toBe(true);
      expect(() => checkCancelled(timeoutOnly)).toThrow(/Timeout/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("shared/utils/lru-cache.js", () => {
  it("evicts the least-recently-used entry and reports stats", () => {
    expect(LRUCacheDefault).toBe(LRUCache);

    const onEvict = vi.fn();
    const cache = new LRUCache({ maxSize: 2, onEvict });

    expect(cache.getStats()).toMatchObject({ hits: 0, misses: 0, evictions: 0, sets: 0, hitRate: 0 });

    cache.set("a", 1).set("b", 2);
    expect(cache.size).toBe(2);
    expect(cache.keys()).toEqual(["a", "b"]);

    // Touch "a" so "b" becomes LRU.
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);

    expect(onEvict).toHaveBeenCalledTimes(1);
    expect(onEvict).toHaveBeenCalledWith("b", 2);

    expect(cache.has("b")).toBe(false);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.keys()).toEqual(["a", "c"]);
    expect(cache.values()).toEqual([1, 3]);

    const stats = cache.getStats();
    expect(stats).toMatchObject({ hits: 1, misses: 1, evictions: 1, sets: 3, size: 2, maxSize: 2 });
    expect(stats.hitRate).toBeCloseTo(0.5);
  });

  it("has() does not refresh LRU order", () => {
    const cache = new LRUCache({ maxSize: 2 });
    cache.set("a", 1).set("b", 2);

    expect(cache.has("a")).toBe(true);
    cache.set("c", 3);

    // If has() refreshed LRU, it would evict "b" instead.
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("supports TTL expiry and manual pruning", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const cache = new LRUCache({ ttlMs: 10, maxSize: 10 });

      cache.set("a", 1);
      vi.setSystemTime(5);
      expect(cache.get("a")).toBe(1);

      vi.setSystemTime(20);
      expect(cache.get("a")).toBeUndefined();

      cache.set("b", 2);
      vi.setSystemTime(40);
      expect(cache.prune()).toBe(1);
      expect(cache.size).toBe(0);

      const noTtl = new LRUCache({ ttlMs: 0 });
      expect(noTtl.prune()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("supports setMany/getMany and stats reset", () => {
    const cache = new LRUCache({ maxSize: 3 });
    cache.setMany([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);

    expect(cache.getMany(["a", "missing", "c"])).toEqual(
      new Map([
        ["a", 1],
        ["c", 3],
      ])
    );

    const stats = cache.getStats();
    expect(stats.sets).toBe(3);
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);

    cache.resetStats();
    expect(cache.getStats()).toMatchObject({ hits: 0, misses: 0, evictions: 0, sets: 0 });

    expect(cache.delete("b")).toBe(true);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("swallows onEvict errors and normalizes maxSize", () => {
    const onEvict = vi.fn(() => {
      throw new Error("boom");
    });
    const cache = new LRUCache({ maxSize: -1, onEvict });

    cache.set("a", 1);
    expect(() => cache.set("b", 2)).not.toThrow();
    expect(cache.size).toBe(1);
    expect(onEvict).toHaveBeenCalledTimes(1);
  });

  it("createAutoPruningCache runs prune on an interval and stops", () => {
    vi.useFakeTimers();
    try {
      const { cache, stop } = createAutoPruningCache({ ttlMs: 1, pruneIntervalMs: 10 });
      const pruneSpy = vi.spyOn(cache, "prune");

      vi.advanceTimersByTime(25);
      expect(pruneSpy).toHaveBeenCalled();

      stop();
      pruneSpy.mockClear();
      vi.advanceTimersByTime(25);
      expect(pruneSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("shared/utils/token-cache.js", () => {
  afterEach(() => {
    clearTokenCache();
  });

  it("caches short strings and tracks hits/misses", () => {
    clearTokenCache();

    expect(getTokenCacheStats()).toMatchObject({ size: 0, hits: 0, misses: 0, hitRate: 0 });

    expect(estimateTokensCached("abcd")).toBe(1);
    expect(estimateTokensCached("abcd")).toBe(1);

    const stats = getTokenCacheStats();
    expect(stats.size).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5);
  });

  it("uses a TokenCounter when available and falls back safely", () => {
    clearTokenCache();

    const counter = {
      count: vi.fn((text) => (text.includes("A") ? 111 : 222)),
    };

    const longA = "A".repeat(120);
    const longB = "B".repeat(120);

    expect(estimateTokensCached(longA, counter)).toBe(111);
    expect(estimateTokensCached(longB, counter)).toBe(222);
    expect(estimateTokensCached(longA, counter)).toBe(111);
    expect(estimateTokensCached(longB, counter)).toBe(222);
    expect(counter.count).toHaveBeenCalledTimes(2);

    const throwsCounter = { count: () => {
      throw new Error("nope");
    } };
    expect(estimateTokensCached("abcd", throwsCounter)).toBe(1);

    const invalidCounter = { count: () => -1 };
    expect(estimateTokensCached("abcd2", invalidCounter)).toBeGreaterThanOrEqual(1);
  });

  it("evicts the oldest entry when exceeding MAX_CACHE_SIZE", () => {
    clearTokenCache();

    const counter = { count: () => 1 };

    const { maxSize } = getTokenCacheStats();
    for (let i = 0; i < maxSize; i++) {
      estimateTokensCached(`k${i}`, counter);
    }

    expect(getTokenCacheStats().size).toBe(maxSize);

    // Adding one more forces eviction of the first inserted key.
    estimateTokensCached(`k${maxSize}`, counter);
    expect(getTokenCacheStats().size).toBe(maxSize);

    const before = getTokenCacheStats().misses;
    estimateTokensCached("k0", counter);
    expect(getTokenCacheStats().misses).toBe(before + 1);
  });
});

describe("shared/utils/value-utils.js", () => {
  it("toNumber returns finite numbers and null for invalid", () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber("3.5")).toBe(3.5);
    expect(toNumber("")).toBe(0);
    expect(toNumber("nope")).toBeNull();
    expect(toNumber(Infinity)).toBeNull();
  });

  it("toBoolean supports flexible parsing", () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean(0)).toBe(false);
    expect(toBoolean(" YES ")).toBe(true);
    expect(toBoolean("off")).toBe(false);
    expect(toBoolean("maybe")).toBe(false);
    expect(toBoolean({})).toBe(false);
  });

  it("normalizeKey lowercases and strips to alphanumeric words", () => {
    expect(normalizeKey(" Hello, WORLD!! ")).toBe("hello world");
    expect(normalizeKey("a__b--c")).toBe("a b c");
    expect(normalizeKey(null)).toBe("");
    expect(normalizeKey(undefined)).toBe("");
  });

  it("toNonNegativeInt/toPositiveInt handle numeric and parseInt-style strings", () => {
    expect(toNonNegativeInt(5, 0)).toBe(5);
    expect(toNonNegativeInt(-2, 7)).toBe(7);
    expect(toNonNegativeInt("10px", 0)).toBe(10);
    expect(toNonNegativeInt("-1", 0)).toBe(0);
    expect(toNonNegativeInt("", 9)).toBe(9);

    expect(toPositiveInt(10, 1)).toBe(10);
    expect(toPositiveInt(0, 2)).toBe(2);
    expect(toPositiveInt("0", 2)).toBe(2);
  });

  it("isCjkChar detects common CJK and punctuation ranges", () => {
    expect(isCjkChar("中".charCodeAt(0))).toBe(true);
    expect(isCjkChar("。".charCodeAt(0))).toBe(true);
    expect(isCjkChar("a".charCodeAt(0))).toBe(false);
  });

  it("estimateTokenCount/estimateTokens/estimateTokenCountFast behave predictably", () => {
    expect(estimateTokenCount("abcd")).toBe(1); // latin: 4 chars / 4
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokenCount("a中")).toBe(2); // 0.25 + 1.4 => ceil(1.65)
    expect(estimateTokenCount("!!!!")).toBe(2); // punctuation: 4 / 2
    expect(estimateTokenCount("abcd", { latinCharsPerToken: 2 })).toBe(2);
    expect(estimateTokenCountFast("abcd")).toBe(2); // length / 2
    expect(estimateTokenCountFast(null)).toBe(0);
  });

  it("deepClone clones complex structures and preserves cycles", () => {
    const sharedKey = { k: 1 };
    const input = {
      n: 1,
      date: new Date("2020-01-01T00:00:00.000Z"),
      re: /ab/gi,
      buf: new Uint8Array([1, 2, 3]),
      arr: [{ x: 1 }, sharedKey],
      map: new Map([
        [sharedKey, { v: 2 }],
        ["s", 3],
      ]),
      set: new Set([sharedKey, 4]),
    };
    input.self = input;

    const cloned = deepClone(input);

    expect(cloned).not.toBe(input);
    expect(cloned.self).toBe(cloned);
    expect(cloned.arr).not.toBe(input.arr);
    expect(cloned.arr[0]).not.toBe(input.arr[0]);
    expect(cloned.arr[0]).toEqual({ x: 1 });

    expect(cloned.date).not.toBe(input.date);
    expect(cloned.date.getTime()).toBe(input.date.getTime());

    expect(cloned.re).not.toBe(input.re);
    expect(cloned.re.source).toBe(input.re.source);
    expect(cloned.re.flags).toBe(input.re.flags);

    expect(cloned.buf).not.toBe(input.buf);
    expect([...cloned.buf]).toEqual([1, 2, 3]);

    expect(cloned.map).toBeInstanceOf(Map);
    expect(cloned.set).toBeInstanceOf(Set);
    expect(cloned.map.size).toBe(2);
    expect(cloned.set.has(4)).toBe(true);

    const mapObjectKey = [...cloned.map.keys()].find((k) => k && typeof k === "object" && "k" in k);
    const setObjectKey = [...cloned.set.values()].find((v) => v && typeof v === "object" && v.k === 1);
    expect(mapObjectKey).toEqual({ k: 1 });
    expect(setObjectKey).toEqual({ k: 1 });
    expect(setObjectKey).toBe(mapObjectKey);

    const mapValue = [...cloned.map.values()].find((v) => v && typeof v === "object" && v.v === 2);
    expect(mapValue).toEqual({ v: 2 });
  });

  it("sanitizeForJson handles circulars, maps, sets, and unsafe keys", () => {
    const cyclic = { a: 1 };
    cyclic.self = cyclic;
    expect(sanitizeForJson(cyclic)).toEqual({ a: 1, self: "[Circular]" });

    expect(sanitizeForJson([1, undefined])).toEqual([1, null]);
    expect(sanitizeForJson(10n)).toBe("10");
    expect(sanitizeForJson(new WeakMap())).toBeUndefined();

    const mapStringKeys = new Map([
      ["a", 1],
      ["skip", undefined],
    ]);
    expect(sanitizeForJson(mapStringKeys)).toEqual({ a: 1 });

    const mapMixedKeys = new Map([
      [{ x: 1 }, 2],
      [3, 4],
    ]);
    expect(sanitizeForJson(mapMixedKeys)).toEqual([[{ x: 1 }, 2], [3, 4]]);

    const set = new Set([1, undefined]);
    expect(sanitizeForJson(set)).toEqual([1, null]);

    const dangerous = Object.create(null);
    dangerous.ok = 1;
    dangerous.__proto__ = { polluted: true };
    dangerous.constructor = { polluted: true };
    dangerous.prototype = { polluted: true };
    dangerous.fn = () => {};

    expect(sanitizeForJson(dangerous)).toEqual({ ok: 1 });
  });
});
