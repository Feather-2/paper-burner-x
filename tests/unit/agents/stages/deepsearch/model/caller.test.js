import { describe, it, expect, vi, beforeEach } from "vitest";

const { extractServicesMock, injectSystemHintMock } = vi.hoisted(() => ({
  extractServicesMock: vi.fn(),
  injectSystemHintMock: vi.fn(),
}));

vi.mock("../../../../../../js/agents/stages/deepsearch/utils/stage-api.js", () => ({
  extractServices: extractServicesMock,
}));

vi.mock("../../../../../../js/agents/shared/index.js", () => ({
  injectSystemHint: injectSystemHintMock,
}));

import { buildBaseCaller } from "../../../../../../js/agents/stages/deepsearch/model/caller.js";

beforeEach(() => {
  extractServicesMock.mockReset();
  injectSystemHintMock.mockReset();
  injectSystemHintMock.mockImplementation((messages, system) => ({ messages, system }));
});

describe("buildBaseCaller", () => {
  it("returns null when no backend is available", () => {
    extractServicesMock.mockReturnValue({});
    expect(buildBaseCaller(undefined)).toBeNull();
    expect(extractServicesMock).toHaveBeenCalledWith(undefined);

    extractServicesMock.mockReturnValue({ modelRouter: { call: null }, aiApiService: { chat: null } });
    expect(buildBaseCaller(null)).toBeNull();
    expect(injectSystemHintMock).not.toHaveBeenCalled();
  });

  it("supports legacy routerCall(messages, opts) with provided signal and whitespace system hint", async () => {
    const defaultSignal = new AbortController().signal;
    const providedSignal = new AbortController().signal;
    const calls = [];

    function legacyRouterCall(messages, opts) {
      calls.push({ messages, opts });
      return "legacy-ok";
    }

    extractServicesMock.mockReturnValue({
      signal: defaultSignal,
      modelRouter: { call: legacyRouterCall },
    });

    const stageApi = { runtimeHints: { system: "   " } };
    const caller = buildBaseCaller(stageApi);

    const result = await caller([], { signal: providedSignal, temperature: 0.25, maxTokens: 0 });

    expect(result).toBe("legacy-ok");
    expect(calls).toHaveLength(1);
    expect(calls[0].messages).toEqual({ messages: [], system: "   " });
    expect(calls[0].opts).toEqual({
      usage: "worker",
      signal: providedSignal,
      temperature: 0.25,
      maxTokens: 0,
    });
    expect(injectSystemHintMock).toHaveBeenCalledWith([], "   ");
  });

  it("supports new routerCall(opts) signature and forwards boundary values", async () => {
    const defaultSignal = new AbortController().signal;
    const calls = [];

    function routerCall(opts) {
      calls.push(opts);
      return { ok: true };
    }

    extractServicesMock.mockReturnValue({
      signal: defaultSignal,
      modelRouter: { call: routerCall },
    });

    const stageApi = { runtimeHints: { system: "" } };
    const caller = buildBaseCaller(stageApi, { usage: "" });

    const messages = { role: "user", content: "" };
    const options = {
      temperature: 0,
      maxTokens: -1,
      seed: Number.MAX_SAFE_INTEGER,
      topP: "0.5",
      model: "",
      metadata: {},
    };

    await caller(messages, options);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      usage: "",
      signal: defaultSignal,
      messages: { messages, system: "" },
      temperature: 0,
      maxTokens: -1,
      seed: Number.MAX_SAFE_INTEGER,
      topP: "0.5",
      model: "",
      metadata: {},
    });
    expect(injectSystemHintMock).toHaveBeenCalledWith(messages, "");
  });

  it("falls back to aiApiService.chat and handles null opts with large payloads", async () => {
    const defaultSignal = new AbortController().signal;
    const calls = [];

    function chat(opts) {
      calls.push(opts);
      return opts;
    }

    extractServicesMock.mockReturnValue({
      signal: defaultSignal,
      aiApiService: { chat },
    });

    const stageApi = { runtimeHints: { system: "SYSTEM" } };
    const caller = buildBaseCaller(stageApi, { usage: "worker" });

    const hugeString = "x".repeat(20000);
    const longString = "y".repeat(10000);
    const deepNested = { level1: { level2: { level3: { items: [{ text: "deep" }] } } } };
    const messages = [{ role: "user", content: hugeString }];

    await caller(messages, null);
    await caller(messages, { fileContent: hugeString, note: longString, payload: deepNested });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      usage: "worker",
      signal: defaultSignal,
      messages: { messages, system: "SYSTEM" },
    });
    expect(calls[1].payload).toBe(deepNested);
    expect(calls[1].fileContent).toBe(hugeString);
    expect(calls[1].note).toBe(longString);
    expect(injectSystemHintMock).toHaveBeenCalledTimes(2);
  });

  it("handles concurrent and rapid successive calls with empty option objects", async () => {
    const defaultSignal = new AbortController().signal;
    const calls = [];

    function routerCall(opts) {
      calls.push(opts);
      return Promise.resolve({ ok: true });
    }

    extractServicesMock.mockReturnValue({
      signal: defaultSignal,
      modelRouter: { call: routerCall },
    });

    const stageApi = { runtimeHints: { system: "HINT" } };
    const caller = buildBaseCaller(stageApi);

    const messagesA = [{ role: "user", content: "A" }];
    const messagesB = [{ role: "user", content: "B" }];
    const messagesC = [{ role: "user", content: "C" }];
    const messagesD = [{ role: "user", content: "D" }];

    await Promise.all([caller(messagesA, {}), caller(messagesB, {})]);
    await caller(messagesC, {});
    await caller(messagesD, {});

    expect(calls).toHaveLength(4);
    expect(injectSystemHintMock).toHaveBeenCalledTimes(4);
    expect(calls.map((call) => call.messages)).toEqual(
      expect.arrayContaining([
        { messages: messagesA, system: "HINT" },
        { messages: messagesB, system: "HINT" },
        { messages: messagesC, system: "HINT" },
        { messages: messagesD, system: "HINT" },
      ])
    );
  });
});
