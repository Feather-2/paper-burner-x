import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/shared/index.js", async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
  };
});

import {
  BaseProvider,
  MODEL_TAGS,
  assertChatMessages,
  assertChatResponse,
  assertModelEntry,
  assertProvider,
  assertUsageConfig,
  normalizeModelTags,
} from "../../../../js/agents/llm/provider.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MODEL_TAGS", () => {
  it("exposes a frozen set of known tags", () => {
    expect(MODEL_TAGS).toEqual(["text", "vision", "reasoning", "long-context", "fast", "cheap"]);
    expect(new Set(MODEL_TAGS).size).toBe(MODEL_TAGS.length);
    expect(Object.isFrozen(MODEL_TAGS)).toBe(true);
  });
});

describe("normalizeModelTags", () => {
  it("returns empty array for non-array and empty inputs", () => {
    expect(normalizeModelTags(undefined)).toEqual([]);
    expect(normalizeModelTags(null)).toEqual([]);
    expect(normalizeModelTags({})).toEqual([]);
    expect(normalizeModelTags([])).toEqual([]);
  });

  it("trims, stringifies, and de-dupes tags while preserving order", () => {
    const result = normalizeModelTags([" text ", "text", 0, "0", "vision", "", "   ", null, undefined, "vision"]);
    expect(result).toEqual(["text", "0", "vision"]);
  });

  it("handles large tag lists and long strings", () => {
    const longTag = "x".repeat(100_000);
    const list = Array.from({ length: 1000 }, (_, i) => `tag-${i}`);
    const result = normalizeModelTags([longTag, longTag, ...list]);

    expect(result[0]).toBe(longTag);
    expect(result.slice(1)).toEqual(list);
    expect(result.length).toBe(list.length + 1);
  });

  it("is stateless across concurrent and rapid calls", async () => {
    const inputA = ["text", "vision", "text"];
    const inputB = ["cheap", "fast", "cheap"];

    const [a, b] = await Promise.all([
      Promise.resolve().then(() => normalizeModelTags(inputA)),
      Promise.resolve().then(() => normalizeModelTags(inputB)),
    ]);

    expect(a).toEqual(["text", "vision"]);
    expect(b).toEqual(["cheap", "fast"]);

    for (let i = 0; i < 5; i += 1) {
      expect(normalizeModelTags(inputA)).toEqual(["text", "vision"]);
    }
  });
});

describe("assertModelEntry", () => {
  it("accepts valid entries including numeric ids and max limits", () => {
    expect(() =>
      assertModelEntry({
        id: 0,
        provider: 1,
        tags: ["text", "", "custom-tag"],
        limits: { maxTokens: Number.MAX_SAFE_INTEGER, rateLimit: 1 },
      })
    ).not.toThrow();
  });

  it("rejects non-object entries and missing required fields", () => {
    expect(() => assertModelEntry(null)).toThrow(/ModelEntry must be an object/i);
    expect(() => assertModelEntry(undefined)).toThrow(/ModelEntry must be an object/i);
    expect(() => assertModelEntry([])).toThrow(/ModelEntry must be an object/i);
    expect(() => assertModelEntry({})).toThrow(/ModelEntry\.id must be a non-empty string/i);
    expect(() => assertModelEntry({ id: "  ", provider: "p", tags: [] })).toThrow(
      /ModelEntry\.id must be a non-empty string/i
    );
    expect(() => assertModelEntry({ id: "m", provider: "  ", tags: [] })).toThrow(
      /ModelEntry\.provider must be a non-empty string/i
    );
    expect(() => assertModelEntry({ id: "m", provider: "p" })).toThrow(/ModelEntry\.tags must be an array/i);
  });

  it("rejects invalid tags and limits shapes or values", () => {
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: {} })).toThrow(
      /ModelEntry\.tags must be an array/i
    );
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: "text" })).toThrow(
      /ModelEntry\.tags must be an array/i
    );
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: [], limits: null })).toThrow(
      /ModelEntry\.limits must be an object/i
    );
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: [], limits: "nope" })).toThrow(
      /ModelEntry\.limits must be an object/i
    );
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: [], limits: { maxTokens: 0 } })).toThrow(
      /maxTokens/i
    );
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: [], limits: { maxTokens: -1 } })).toThrow(
      /maxTokens/i
    );
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: [], limits: { maxTokens: "10" } })).toThrow(
      /maxTokens/i
    );
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: [], limits: { rateLimit: 0 } })).toThrow(
      /rateLimit/i
    );
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: [], limits: { rateLimit: -1 } })).toThrow(
      /rateLimit/i
    );
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: [], limits: { rateLimit: "5" } })).toThrow(
      /rateLimit/i
    );
  });

  it("is stateless across concurrent validations", async () => {
    const entries = [
      { id: "m1", provider: "p1", tags: [] },
      { id: "m2", provider: "p2", tags: ["vision"], limits: { maxTokens: 1 } },
    ];

    await expect(
      Promise.all(entries.map((entry) => Promise.resolve().then(() => assertModelEntry(entry))))
    ).resolves.toEqual([undefined, undefined]);
  });
});

describe("assertUsageConfig", () => {
  it("accepts empty configs and stringifiable entries", () => {
    expect(() => assertUsageConfig({})).not.toThrow();
    expect(() =>
      assertUsageConfig({
        worker: ["m1", 0, Number.MAX_SAFE_INTEGER],
        "0": ["m2"],
      })
    ).not.toThrow();
  });

  it("rejects invalid shapes and entries", () => {
    expect(() => assertUsageConfig(null)).toThrow(/UsageConfig must be an object/i);
    expect(() => assertUsageConfig(undefined)).toThrow(/UsageConfig must be an object/i);
    expect(() => assertUsageConfig([])).toThrow(/UsageConfig must be an object/i);
    expect(() => assertUsageConfig("config")).toThrow(/UsageConfig must be an object/i);
    expect(() => assertUsageConfig({ "   ": ["m1"] })).toThrow(/keys must be non-empty/i);
    expect(() => assertUsageConfig({ worker: {} })).toThrow(/must be an array/i);
    expect(() => assertUsageConfig({ worker: "m1" })).toThrow(/must be an array/i);
    expect(() => assertUsageConfig({ worker: ["", "m1"] })).toThrow(/entries must be non-empty strings/i);
    expect(() => assertUsageConfig({ worker: [null] })).toThrow(/entries must be non-empty strings/i);
  });

  it("is stateless across rapid consecutive checks", () => {
    const config = { worker: ["m1"] };
    for (let i = 0; i < 5; i += 1) {
      expect(() => assertUsageConfig(config)).not.toThrow();
    }
  });
});

describe("assertChatMessages", () => {
  it("accepts empty arrays, string content, and object content arrays", () => {
    const deepPart = { type: "input_text", payload: { nested: { deep: { value: [1, 2, 3] } } } };
    const largeText = "x".repeat(100_000);

    expect(() =>
      assertChatMessages([
        { role: "user", content: "hi" },
        { role: "assistant", content: [deepPart] },
        { role: 0, content: largeText },
      ])
    ).not.toThrow();

    expect(() => assertChatMessages([])).not.toThrow();
  });

  it("rejects invalid message shapes and content types", () => {
    expect(() => assertChatMessages(null)).toThrow(/messages must be an array/i);
    expect(() => assertChatMessages({})).toThrow(/messages must be an array/i);
    expect(() => assertChatMessages([null])).toThrow(/entries must be objects/i);
    expect(() => assertChatMessages([{}])).toThrow(/role must be a non-empty string/i);
    expect(() => assertChatMessages([{ role: "", content: "x" }])).toThrow(/role must be a non-empty string/i);
    expect(() => assertChatMessages([{ role: "  ", content: "x" }])).toThrow(/role must be a non-empty string/i);
    expect(() => assertChatMessages([{ role: "user", content: {} }])).toThrow(
      /content must be a string or an array of objects/i
    );
    expect(() => assertChatMessages([{ role: "user", content: 123 }])).toThrow(
      /content must be a string or an array of objects/i
    );
    expect(() => assertChatMessages([{ role: "user", content: [{}, "bad"] }])).toThrow(
      /content must be a string or an array of objects/i
    );
  });

  it("handles concurrent validations without shared state", async () => {
    const a = [{ role: "user", content: "a" }];
    const b = [{ role: "assistant", content: [{ text: "ok" }] }];

    await expect(
      Promise.all([
        Promise.resolve().then(() => assertChatMessages(a)),
        Promise.resolve().then(() => assertChatMessages(b)),
      ])
    ).resolves.toEqual([undefined, undefined]);
  });
});

describe("assertChatResponse", () => {
  it("accepts string content including empty and large values", () => {
    const large = "x".repeat(100_000);
    expect(() => assertChatResponse({ content: "" })).not.toThrow();
    expect(() => assertChatResponse({ content: large, extra: {} })).not.toThrow();
  });

  it("rejects invalid responses", () => {
    expect(() => assertChatResponse(null)).toThrow(/response must be an object/i);
    expect(() => assertChatResponse([])).toThrow(/response must be an object/i);
    expect(() => assertChatResponse({})).toThrow(/content must be a string/i);
    expect(() => assertChatResponse({ content: 123 })).toThrow(/content must be a string/i);
    expect(() => assertChatResponse({ content: undefined })).toThrow(/content must be a string/i);
  });
});

describe("assertProvider", () => {
  it("accepts providers with chat() and stringifiable ids", () => {
    expect(() => assertProvider({ id: 0, chat: async () => ({ content: "ok" }) })).not.toThrow();
  });

  it("rejects missing chat() or invalid ids", () => {
    expect(() => assertProvider(null)).toThrow(/must implement chat/i);
    expect(() => assertProvider({ id: "p" })).toThrow(/must implement chat/i);
    expect(() => assertProvider({ id: "p", chat: "nope" })).toThrow(/must implement chat/i);
    expect(() => assertProvider({ id: "", chat: async () => ({ content: "ok" }) })).toThrow(
      /id must be a non-empty string/i
    );
    expect(() => assertProvider({ id: "  ", chat: async () => ({ content: "ok" }) })).toThrow(
      /id must be a non-empty string/i
    );
  });

  it("is stateless across concurrent validations", async () => {
    const providers = [
      { id: "p1", chat: async () => ({ content: "ok1" }) },
      { id: "p2", chat: async () => ({ content: "ok2" }) },
    ];

    await expect(
      Promise.all(providers.map((provider) => Promise.resolve().then(() => assertProvider(provider))))
    ).resolves.toEqual([undefined, undefined]);
  });
});

describe("BaseProvider", () => {
  it("defaults id/name and capabilities", () => {
    const p = new BaseProvider();
    expect(p.id).toBe("provider_unknown");
    expect(p.name).toBe("provider_unknown");
    expect(p.capabilities).toEqual(["chat"]);
  });

  it("trims id and falls back to id when name is empty", () => {
    const p = new BaseProvider({ id: "  foo  ", name: "   " });
    expect(p.id).toBe("foo");
    expect(p.name).toBe("foo");

    const p2 = new BaseProvider({ id: "bar", name: " Baz " });
    expect(p2.id).toBe("bar");
    expect(p2.name).toBe("Baz");
  });

  it("call() forwards to chat() for concurrent calls", async () => {
    class P extends BaseProvider {
      async chat(input) {
        return { content: String(input?.value ?? "") };
      }
    }

    const p = new P({ id: "p1" });
    const spy = vi.spyOn(p, "chat");
    const inputs = [{ value: "a" }, { value: "b" }, { value: "" }];

    const results = await Promise.all(inputs.map((input) => p.call(input)));

    expect(results).toEqual([{ content: "a" }, { content: "b" }, { content: "" }]);
    expect(spy).toHaveBeenCalledTimes(inputs.length);
    expect(spy.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(inputs));
  });

  it("chat() throws when not implemented", async () => {
    const p = new BaseProvider({ id: "p1" });
    await expect(p.chat({ model: "m1", messages: [] })).rejects.toThrow(/not implemented/i);
  });
});
