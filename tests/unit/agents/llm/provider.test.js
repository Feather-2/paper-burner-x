import { describe, expect, it } from "vitest";

import {
  BaseProvider,
  MODEL_TAGS,
  assertChatMessages,
  assertChatResponse,
  assertModelEntry,
  assertProvider,
  assertUsageConfig,
  normalizeModelTags,
} from '../../../../js/agents/llm/provider.js';

describe("agents/llm/provider", () => {
  it("normalizeModelTags() de-dupes and drops empty values", () => {
    expect(MODEL_TAGS.length).toBeGreaterThan(0);
    expect(normalizeModelTags(["text", "text", " vision ", "", null, "  "])).toEqual(["text", "vision"]);
  });

  it("assertModelEntry() validates required fields and limits", () => {
    expect(() =>
      assertModelEntry({
        id: "m1",
        provider: "p1",
        tags: ["text", "custom-tag"],
        limits: { maxTokens: 4096, rateLimit: 10 },
      })
    ).not.toThrow();

    expect(() => assertModelEntry(null)).toThrow(/ModelEntry must be an object/i);
    expect(() => assertModelEntry({ id: "", provider: "p", tags: [] })).toThrow(/id must be a non-empty string/i);
    expect(() => assertModelEntry({ id: "m", provider: "", tags: [] })).toThrow(/provider must be a non-empty string/i);
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: "text" })).toThrow(/tags must be an array/i);
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: [], limits: "nope" })).toThrow(/limits must be an object/i);
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: [], limits: { maxTokens: 0 } })).toThrow(/maxTokens/i);
    expect(() => assertModelEntry({ id: "m", provider: "p", tags: [], limits: { rateLimit: -1 } })).toThrow(/rateLimit/i);
  });

  it("assertUsageConfig() validates shape and entries", () => {
    expect(() => assertUsageConfig({ worker: ["m1", "m2"] })).not.toThrow();
    expect(() => assertUsageConfig(null)).toThrow(/UsageConfig must be an object/i);
    expect(() => assertUsageConfig({ "   ": ["m1"] })).toThrow(/keys must be non-empty/i);
    expect(() => assertUsageConfig({ worker: "m1" })).toThrow(/must be an array/i);
    expect(() => assertUsageConfig({ worker: ["", "m1"] })).toThrow(/entries must be non-empty strings/i);
  });

  it("assertChatMessages() accepts string content or array-of-objects content", () => {
    expect(() =>
      assertChatMessages([
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ text: "ok" }] },
      ])
    ).not.toThrow();

    expect(() => assertChatMessages("nope")).toThrow(/messages must be an array/i);
    expect(() => assertChatMessages([null])).toThrow(/entries must be objects/i);
    expect(() => assertChatMessages([{ role: "", content: "x" }])).toThrow(/role must be a non-empty string/i);
    expect(() => assertChatMessages([{ role: "user", content: [{}, "bad"] }])).toThrow(/content must be a string or an array of objects/i);
  });

  it("assertChatResponse() requires a {content: string} object", () => {
    expect(() => assertChatResponse({ content: "ok" })).not.toThrow();
    expect(() => assertChatResponse(null)).toThrow(/response must be an object/i);
    expect(() => assertChatResponse({ content: 123 })).toThrow(/content must be a string/i);
  });

  it("assertProvider() requires {id, chat}", () => {
    expect(() => assertProvider({ id: "p", chat: async () => ({ content: "ok" }) })).not.toThrow();
    expect(() => assertProvider(null)).toThrow(/must implement chat/i);
    expect(() => assertProvider({ id: "", chat: async () => ({ content: "ok" }) })).toThrow(/id must be a non-empty string/i);
  });

  it("BaseProvider defaults and call() aliases chat()", async () => {
    class P extends BaseProvider {
      async chat(input) {
        return { content: String(input?.x || "") };
      }
    }

    const p = new P();
    expect(p.id).toBe("provider_unknown");
    expect(p.name).toBe("provider_unknown");
    expect(p.capabilities).toEqual(["chat"]);

    await expect(p.call({ x: "hi" })).resolves.toEqual({ content: "hi" });
  });

  it("BaseProvider.chat() throws when not implemented", async () => {
    const p = new BaseProvider({ id: "p1" });
    await expect(p.chat({ model: "m1", messages: [] })).rejects.toThrow(/not implemented/i);
  });
});
