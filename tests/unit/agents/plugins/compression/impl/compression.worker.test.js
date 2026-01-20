import { describe, it, expect, vi, beforeEach } from "vitest";

let isPlainObjectMock;
let createRpcHandlerMock;
let capturedMethods;
let rpcHandlerSpy;
let handleCompress;

vi.mock("../../../../../../js/agents/shared/index.js", () => {
  isPlainObjectMock = vi.fn();
  return { isPlainObject: isPlainObjectMock };
});

vi.mock("../../../../../../js/agents/runtime/core/worker-rpc.js", () => {
  createRpcHandlerMock = vi.fn((methods) => {
    capturedMethods = methods;
    rpcHandlerSpy = vi.fn();
    return rpcHandlerSpy;
  });
  return { createRpcHandler: createRpcHandlerMock };
});

async function importWorkerModule() {
  await import("../../../../../../js/agents/plugins/compression/impl/compression.worker.js");
  handleCompress = capturedMethods?.compress;
}

beforeEach(async () => {
  vi.resetModules();
  capturedMethods = null;
  rpcHandlerSpy = null;
  handleCompress = null;
  globalThis.self = { postMessage: vi.fn() };
  await importWorkerModule();
  isPlainObjectMock.mockReset();
  isPlainObjectMock.mockImplementation((value) => value && typeof value === "object" && !Array.isArray(value));
});

describe("handleCompress", () => {
  it("throws when messages is not an array", () => {
    expect(() => handleCompress()).toThrow("messages must be an array");
    expect(() => handleCompress({ messages: null })).toThrow("messages must be an array");
    expect(() => handleCompress({ messages: {} })).toThrow("messages must be an array");
  });

  it("returns empty results for empty messages", () => {
    const result = handleCompress({ messages: [] });
    expect(result.messages).toEqual([]);
    expect(result.sessionSummary).toBeNull();
    expect(result.afterTokens).toBe(0);
    expect(result.stats).toEqual({
      totalMessages: 0,
      mergedMessages: 0,
      removedThinking: 0,
      keptMessages: 0,
      summarizedMessages: 0,
    });
  });

  it("summarizes all messages when keepLastTurns is negative", () => {
    const result = handleCompress({
      messages: [
        { role: "user", content: "First" },
        { role: "assistant", content: "Second" },
      ],
      options: { keepLastTurns: -1 },
    });

    expect(result.messages).toEqual([]);
    expect(result.sessionSummary).toBe("user: First\nassistant: Second");
    expect(result.stats.summarizedMessages).toBe(2);
    expect(result.stats.keptMessages).toBe(0);
  });

  it("merges, removes thinking, preserves anchors, and appends summary text", () => {
    const messages = [
      { role: "system", content: "You are helpful" },
      { role: "assistant", content: "Hello" },
      { role: "assistant", content: "World" },
      { role: "assistant", content: "analysis: ignore me" },
      { role: "user", content: "Question 1" },
      { role: "user", content: "Question 2", id: 1 },
      { role: "assistant", content: "Answer 1" },
      { role: "assistant", content: "Answer 2" },
      { role: "system", content: "[Context Summary] previous summary" },
      { role: "assistant", content: "Final" },
    ];

    const result = handleCompress({
      messages,
      options: { keepLastTurns: 2, sessionSummary: "Prev summary" },
    });

    expect(result.messages).toEqual([
      { role: "system", content: "You are helpful" },
      { role: "system", content: "[Context Summary] previous summary" },
      { role: "assistant", content: "Final" },
    ]);
    expect(result.sessionSummary).toBe(
      "Prev summary\nassistant: Hello World\nuser: Question 1\nuser: Question 2\nassistant: Answer 1 Answer 2",
    );
    expect(result.stats).toEqual({
      totalMessages: 10,
      mergedMessages: 2,
      removedThinking: 1,
      keptMessages: 3,
      summarizedMessages: 4,
    });
    expect(result.afterTokens).toBe(15);
  });

  it("creates title-only summaries with CJK and word limits when keepLastTurns is 0", () => {
    const result = handleCompress({
      messages: [
        { role: "user", content: "你好世界你好世界你好世界" },
        { role: "assistant", content: "this is a very long title with many words" },
      ],
      options: { keepLastTurns: 0, titleOnly: true, titleMaxWords: 3, titleMaxChars: 10 },
    });

    expect(result.messages).toEqual([]);
    expect(result.sessionSummary).toBe("user: 你好世界你好世界你好...\nassistant: this is a...");
  });

  it("ignores numeric strings in options and falls back to defaults", () => {
    const messages = [
      { role: "user", content: "msg1" },
      { role: "assistant", content: "msg2" },
      { role: "user", content: "msg3" },
      { role: "assistant", content: "msg4" },
      { role: "user", content: "msg5" },
      { role: "assistant", content: "msg6" },
      { role: "user", content: "msg7" },
    ];

    const result = handleCompress({
      messages,
      options: { keepLastTurns: "2", summaryLineChars: "3" },
    });

    expect(result.messages.length).toBe(6);
    expect(result.messages[0]).toEqual({ role: "assistant", content: "msg2" });
    expect(result.sessionSummary).toBe("user: msg1");
  });

  it("truncates long summary lines and skips empty or whitespace messages", () => {
    const result = handleCompress({
      messages: [
        { role: "user", content: "abcdef" },
        { role: "assistant", content: "   " },
        { role: "assistant", content: "" },
      ],
      options: { keepLastTurns: 0, summaryLineChars: 4 },
    });

    expect(result.messages).toEqual([]);
    expect(result.sessionSummary).toBe("user: ab...");
  });

  it("keeps all messages for MAX_SAFE_INTEGER and handles deep nested content", () => {
    const deep = {};
    let cursor = deep;
    for (let i = 0; i < 50; i += 1) {
      cursor.next = {};
      cursor = cursor.next;
    }
    const hugeText = "x".repeat(100000);

    const result = handleCompress({
      messages: [
        { role: "assistant", content: deep, extra: true },
        { role: "assistant", content: hugeText },
      ],
      options: { keepLastTurns: Number.MAX_SAFE_INTEGER },
    });

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].content).toBe("[object Object]");
    expect(result.messages[1].content).toBe(hugeText);
    const expectedTokens =
      Math.ceil(result.messages[0].content.length * 0.25) +
      Math.ceil(result.messages[1].content.length * 0.25);
    expect(result.afterTokens).toBe(expectedTokens);
  });

  it("estimates tokens with CJK weighting", () => {
    const result = handleCompress({
      messages: [
        { role: "assistant", content: "汉字", extra: true },
        { role: "assistant", content: "abc" },
      ],
    });

    expect(result.afterTokens).toBe(5);
  });

  it("supports concurrent calls without state bleed", async () => {
    const inputs = [
      { messages: ["hello"] },
      { messages: [{ role: "assistant", text: "from text" }] },
      { messages: [{ role: "assistant", content: 42 }] },
      { messages: [{ role: "assistant", content: "msg-3" }] },
    ];

    const results = await Promise.all(
      inputs.map((input) => Promise.resolve().then(() => handleCompress(input))),
    );

    expect(results).toHaveLength(4);
    expect(results[0].messages[0]).toEqual({ role: "assistant", content: "hello" });
    expect(results[1].messages[0].content).toBe("from text");
    expect(results[2].messages[0].content).toBe("42");
    expect(results[3].messages[0].content).toBe("msg-3");
  });
});

describe("self.onmessage", () => {
  it("routes rpc requests to the rpc handler", () => {
    const event = { data: { type: "rpc:request", id: "rpc1" } };
    globalThis.self.onmessage(event);

    expect(rpcHandlerSpy).toHaveBeenCalledTimes(1);
    expect(rpcHandlerSpy).toHaveBeenCalledWith(event);
    expect(globalThis.self.postMessage).not.toHaveBeenCalled();
  });

  it("rejects invalid message formats", () => {
    isPlainObjectMock.mockReturnValue(false);
    const event = { data: { id: "bad" } };
    globalThis.self.onmessage(event);

    expect(globalThis.self.postMessage).toHaveBeenCalledWith({
      id: "bad",
      ok: false,
      error: "Invalid message format",
    });
  });

  it("rejects non-array messages, including empty objects", () => {
    isPlainObjectMock.mockReturnValue(true);
    globalThis.self.onmessage({ data: {} });
    globalThis.self.onmessage({ data: { id: "nope", messages: {} } });

    expect(globalThis.self.postMessage).toHaveBeenNthCalledWith(1, {
      id: undefined,
      ok: false,
      error: "messages must be an array",
    });
    expect(globalThis.self.postMessage).toHaveBeenNthCalledWith(2, {
      id: "nope",
      ok: false,
      error: "messages must be an array",
    });
  });

  it("posts success responses for valid requests", () => {
    isPlainObjectMock.mockReturnValue(true);
    const event = {
      data: { id: "ok", messages: [{ role: "assistant", content: "Hi" }], options: {} },
    };
    globalThis.self.onmessage(event);

    expect(globalThis.self.postMessage).toHaveBeenCalledTimes(1);
    expect(globalThis.self.postMessage.mock.calls[0][0]).toMatchObject({
      id: "ok",
      ok: true,
      messages: [{ role: "assistant", content: "Hi" }],
      sessionSummary: null,
    });
    expect(globalThis.self.postMessage.mock.calls[0][0].stats.totalMessages).toBe(1);
    expect(globalThis.self.postMessage.mock.calls[0][0].afterTokens).toBe(1);
  });

  it("returns errors when handleCompress throws", () => {
    isPlainObjectMock.mockReturnValue(true);
    const options = {};
    Object.defineProperty(options, "sessionSummary", {
      get() {
        throw new Error("boom");
      },
    });
    globalThis.self.onmessage({ data: { id: "err", messages: [], options } });

    expect(globalThis.self.postMessage).toHaveBeenCalledWith({
      id: "err",
      ok: false,
      error: "boom",
    });
  });

  it("handles rapid consecutive calls", () => {
    isPlainObjectMock.mockReturnValue(true);
    for (let i = 0; i < 5; i += 1) {
      globalThis.self.onmessage({
        data: { id: `msg-${i}`, messages: [{ role: "assistant", content: `m${i}` }] },
      });
    }

    expect(globalThis.self.postMessage).toHaveBeenCalledTimes(5);
    const ids = globalThis.self.postMessage.mock.calls.map((call) => call[0].id);
    expect(ids).toEqual(["msg-0", "msg-1", "msg-2", "msg-3", "msg-4"]);
  });
});
