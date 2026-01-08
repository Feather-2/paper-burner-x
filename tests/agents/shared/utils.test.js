import { describe, it, expect, vi, afterEach } from "vitest";

import { createLogger, logEvent, trackToolCall, useLogger } from "../../../js/agents/shared/utils/logger.js";
import {
  cryptoRandomHex,
  cryptoRandomUuid,
  makeSecureId,
  makeSecureTimestampedId,
} from "../../../js/agents/shared/utils/secure-id.js";
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
} from "../../../js/agents/shared/utils/value-utils.js";

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
    expect(emitted[0].name).toBe("shared.log.info");
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
    expect(mapObjectKey).toBeTruthy();
    expect(setObjectKey).toBeTruthy();
    expect(setObjectKey).toBe(mapObjectKey);

    const mapValue = [...cloned.map.values()].find((v) => v && typeof v === "object" && v.v === 2);
    expect(mapValue).toBeTruthy();
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

