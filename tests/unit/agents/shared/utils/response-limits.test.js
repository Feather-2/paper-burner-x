import { describe, it, expect, vi, beforeEach } from "vitest";
import { TextDecoder, TextEncoder } from "util";

const {
  checkCancelledMock,
  toNonEmptyStringMock,
  defaultCheckCancelled,
  defaultToNonEmptyString,
} = vi.hoisted(() => {
  const defaultToNonEmptyString = (value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  };

  const defaultCheckCancelled = (signal) => {
    if (!signal?.aborted) return;
    const reason = signal.reason;
    let message = "Run cancelled";
    if (typeof reason === "string" && reason.trim()) {
      message = reason;
    } else if (
      reason &&
      typeof reason === "object" &&
      typeof reason.message === "string" &&
      reason.message.trim()
    ) {
      message = reason.message;
    }
    const err = new Error(message);
    err.name = "AbortError";
    err.cause = reason;
    throw err;
  };

  const checkCancelledMock = vi.fn(defaultCheckCancelled);
  const toNonEmptyStringMock = vi.fn(defaultToNonEmptyString);

  return {
    checkCancelledMock,
    toNonEmptyStringMock,
    defaultCheckCancelled,
    defaultToNonEmptyString,
  };
});

vi.mock("../../../../../js/agents/shared/utils/cancellation.js", () => ({
  checkCancelled: (signal) => checkCancelledMock(signal),
}));

vi.mock("../../../../../js/agents/shared/utils/value-utils.js", () => ({
  toNonEmptyString: (value) => toNonEmptyStringMock(value),
}));

import {
  normalizeMaxBytes,
  createResponseTooLargeError,
  readTextWithLimit,
  readJsonWithLimit,
} from "../../../../../js/agents/shared/utils/response-limits.js";

if (!globalThis.TextDecoder) globalThis.TextDecoder = TextDecoder;
if (!globalThis.TextEncoder) globalThis.TextEncoder = TextEncoder;

const encoder = new TextEncoder();

const makeStreamResponse = (chunks, { headers, cancelError } = {}) => {
  let index = 0;
  const encodedChunks = chunks.map((chunk) => {
    if (typeof chunk === "string") return encoder.encode(chunk);
    return chunk;
  });

  const reader = {
    read: vi.fn(async () => {
      if (index >= encodedChunks.length) return { done: true, value: undefined };
      const value = encodedChunks[index];
      index += 1;
      return { done: false, value };
    }),
    cancel: vi.fn(async () => {
      if (cancelError) throw cancelError;
    }),
  };

  const response = {
    headers,
    body: {
      getReader: () => reader,
    },
  };

  return { response, reader };
};

beforeEach(() => {
  checkCancelledMock.mockReset();
  toNonEmptyStringMock.mockReset();
  checkCancelledMock.mockImplementation(defaultCheckCancelled);
  toNonEmptyStringMock.mockImplementation(defaultToNonEmptyString);
});

describe("normalizeMaxBytes", () => {
  it("returns Infinity for Infinity input", () => {
    expect(normalizeMaxBytes(Infinity, 1000)).toBe(Infinity);
  });

  it("returns MAX_SAFE_INTEGER for large positive integers", () => {
    expect(normalizeMaxBytes(Number.MAX_SAFE_INTEGER, 10)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("floors numeric strings", () => {
    expect(normalizeMaxBytes("12.9", 7)).toBe(12);
  });

  it.each([
    null,
    undefined,
    "",
    "   ",
    [],
    {},
    0,
    -1,
    NaN,
    "Infinity",
  ])("returns fallback for %p", (value) => {
    expect(normalizeMaxBytes(value, 7)).toBe(7);
  });
});

describe("createResponseTooLargeError", () => {
  it("sets metadata and default code", () => {
    const err = createResponseTooLargeError("Response body", 100, 200);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ResponseTooLargeError");
    expect(err.code).toBe("ERESPONSE_TOO_LARGE");
    expect(err.maxBytes).toBe(100);
    expect(err.observedBytes).toBe(200);
    expect(err.message).toContain("Response body");
    expect(err.message).toContain("200");
    expect(err.message).toContain("100");
    expect(toNonEmptyStringMock).toHaveBeenCalledWith("Response body");
  });

  it("falls back to the default label for blank context", () => {
    const err = createResponseTooLargeError("   ", 5, 9);
    expect(err.message).toContain("Response body");
  });

  it("uses a custom label and custom code", () => {
    toNonEmptyStringMock.mockImplementationOnce(() => "Custom Label");
    const err = createResponseTooLargeError("ignored", 1, 2, "CUSTOM_CODE");
    expect(err.message).toContain("Custom Label");
    expect(err.code).toBe("CUSTOM_CODE");
  });
});

describe("readTextWithLimit", () => {
  it.each([null, undefined, {}, []])("returns null for empty response %p", async (response) => {
    const result = await readTextWithLimit(response);
    expect(result).toBe(null);
  });

  it("returns empty string from response.text()", async () => {
    const response = { text: vi.fn().mockResolvedValue("") };
    const result = await readTextWithLimit(response);
    expect(result).toBe("");
    expect(response.text).toHaveBeenCalledTimes(1);
  });

  it("reads text with string maxBytes when under the limit", async () => {
    const response = { text: vi.fn().mockResolvedValue("hello") };
    const result = await readTextWithLimit(response, { maxBytes: "10" });
    expect(result).toBe("hello");
  });

  it("throws ResponseTooLargeError when text length exceeds limit", async () => {
    const response = { text: vi.fn().mockResolvedValue("hello") };
    await expect(
      readTextWithLimit(response, { maxBytes: 3, context: "Text body", code: "CUSTOM" })
    ).rejects.toMatchObject({
      name: "ResponseTooLargeError",
      code: "CUSTOM",
      maxBytes: 3,
      observedBytes: 5,
    });
  });

  it("checks content-length header before reading", async () => {
    const response = {
      headers: { get: vi.fn(() => "10") },
      text: vi.fn().mockResolvedValue("hello"),
    };
    await expect(readTextWithLimit(response, { maxBytes: 5 })).rejects.toMatchObject({
      name: "ResponseTooLargeError",
      maxBytes: 5,
      observedBytes: 10,
    });
    expect(response.text).not.toHaveBeenCalled();
  });

  it("ignores invalid content-length headers", async () => {
    const response = {
      headers: { get: vi.fn(() => "   ") },
      text: vi.fn().mockResolvedValue("ok"),
    };
    const result = await readTextWithLimit(response, { maxBytes: 5 });
    expect(result).toBe("ok");
  });

  it("handles headers.get throwing", async () => {
    const response = {
      headers: { get: vi.fn(() => { throw new Error("header fail"); }) },
      text: vi.fn().mockResolvedValue("ok"),
    };
    const result = await readTextWithLimit(response, { maxBytes: 5 });
    expect(result).toBe("ok");
  });

  it("streams and decodes chunks", async () => {
    const { response } = makeStreamResponse(["hello ", "world"]);
    const result = await readTextWithLimit(response, { maxBytes: 20 });
    expect(result).toBe("hello world");
  });

  it("skips falsy chunks in a stream", async () => {
    const { response } = makeStreamResponse([null, "ok"]);
    const result = await readTextWithLimit(response, { maxBytes: 10 });
    expect(result).toBe("ok");
  });

  it("cancels the stream when size exceeds limit", async () => {
    const { response, reader } = makeStreamResponse(["hello"]);
    await expect(readTextWithLimit(response, { maxBytes: 4, context: "Stream body" })).rejects.toMatchObject({
      name: "ResponseTooLargeError",
      maxBytes: 4,
      observedBytes: 5,
    });
    expect(reader.cancel).toHaveBeenCalledTimes(1);
  });

  it("ignores cancel errors while enforcing the limit", async () => {
    const { response, reader } = makeStreamResponse(["hello"], { cancelError: new Error("cancel fail") });
    await expect(readTextWithLimit(response, { maxBytes: 4 })).rejects.toMatchObject({
      name: "ResponseTooLargeError",
      maxBytes: 4,
      observedBytes: 5,
    });
    expect(reader.cancel).toHaveBeenCalledTimes(1);
  });

  it("aborts when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("Stop");
    const response = { text: vi.fn().mockResolvedValue("ok") };
    await expect(readTextWithLimit(response, { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(response.text).not.toHaveBeenCalled();
  });

  it("treats non-positive maxBytes as Infinity", async () => {
    const longText = "x".repeat(1000);
    const response = { text: vi.fn().mockResolvedValue(longText) };
    const result = await readTextWithLimit(response, { maxBytes: 0 });
    expect(result).toHaveLength(1000);
  });

  it("handles large text payloads", async () => {
    const longText = "x".repeat(100000);
    const response = { text: vi.fn().mockResolvedValue(longText) };
    const result = await readTextWithLimit(response, { maxBytes: Infinity });
    expect(result).toHaveLength(100000);
  });

  it("supports concurrent reads", async () => {
    const responseA = { text: vi.fn().mockResolvedValue("alpha") };
    const responseB = { text: vi.fn().mockResolvedValue("beta") };
    const [a, b] = await Promise.all([
      readTextWithLimit(responseA, { maxBytes: 10 }),
      readTextWithLimit(responseB, { maxBytes: 10 }),
    ]);
    expect(a).toBe("alpha");
    expect(b).toBe("beta");
  });

  it("supports rapid successive reads", async () => {
    const response = { text: vi.fn().mockResolvedValue("ping") };
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await readTextWithLimit(response));
    }
    expect(results).toEqual(["ping", "ping", "ping"]);
    expect(response.text).toHaveBeenCalledTimes(3);
  });
});

describe("readJsonWithLimit", () => {
  it("parses JSON objects", async () => {
    const response = { text: vi.fn().mockResolvedValue('{"key":"value"}') };
    const result = await readJsonWithLimit(response);
    expect(result).toEqual({ key: "value" });
  });

  it("parses JSON arrays", async () => {
    const response = { text: vi.fn().mockResolvedValue("[]") };
    const result = await readJsonWithLimit(response);
    expect(result).toEqual([]);
  });

  it.each([null, undefined, {}])("throws for empty response %p", async (response) => {
    await expect(readJsonWithLimit(response)).rejects.toThrow("JSON response body is empty");
  });

  it("throws for invalid JSON payloads", async () => {
    const response = { text: vi.fn().mockResolvedValue("") };
    await expect(readJsonWithLimit(response)).rejects.toThrow();
  });

  it("throws when JSON is not an object or array", async () => {
    const response = { text: vi.fn().mockResolvedValue("null") };
    await expect(readJsonWithLimit(response)).rejects.toThrow(
      "JSON response body must be a JSON object or array"
    );
  });

  it("enforces maxBytes limits", async () => {
    const response = { text: vi.fn().mockResolvedValue('{"a":1}') };
    await expect(readJsonWithLimit(response, { maxBytes: 3 })).rejects.toMatchObject({
      name: "ResponseTooLargeError",
      maxBytes: 3,
    });
  });

  it("fails validation when validate returns false", async () => {
    const response = { text: vi.fn().mockResolvedValue("{}") };
    await expect(
      readJsonWithLimit(response, { validate: Array.isArray })
    ).rejects.toThrow("JSON response body failed validation");
  });

  it("fails validation when validate throws", async () => {
    const response = { text: vi.fn().mockResolvedValue("{}") };
    await expect(
      readJsonWithLimit(response, { validate: () => { throw new Error("bad"); } })
    ).rejects.toThrow("JSON response body failed validation");
  });

  it("uses the default label for blank context", async () => {
    const response = { text: vi.fn().mockResolvedValue("null") };
    await expect(
      readJsonWithLimit(response, { context: "   " })
    ).rejects.toThrow("JSON response body must be a JSON object or array");
  });

  it("handles deeply nested JSON", async () => {
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 50; i += 1) {
      cursor.child = { index: i };
      cursor = cursor.child;
    }
    const response = { text: vi.fn().mockResolvedValue(JSON.stringify(deep)) };
    const result = await readJsonWithLimit(response);
    let current = result;
    for (let i = 0; i < 50; i += 1) {
      expect(current).toHaveProperty("child");
      current = current.child;
    }
  });

  it("supports concurrent reads", async () => {
    const responseA = { text: vi.fn().mockResolvedValue('{"a":1}') };
    const responseB = { text: vi.fn().mockResolvedValue("[1,2,3]") };
    const [a, b] = await Promise.all([readJsonWithLimit(responseA), readJsonWithLimit(responseB)]);
    expect(a).toEqual({ a: 1 });
    expect(b).toEqual([1, 2, 3]);
  });

  it("supports rapid successive reads", async () => {
    const response = { text: vi.fn().mockResolvedValue('{"ok":true}') };
    const results = [];
    for (let i = 0; i < 3; i += 1) {
      results.push(await readJsonWithLimit(response));
    }
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(response.text).toHaveBeenCalledTimes(3);
  });
});
