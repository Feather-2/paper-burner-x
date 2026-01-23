import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRouter } from '../../../../js/agents/llm/model-router.js';
import { getGlobalTokenTracker } from '../../../../js/agents/plugins/telemetry/index.js';

import { createFakeTime, createMockProvider } from "../../../unit/agents/llm/vitest-utils.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("agents/llm/model-router token tracking", () => {
  it("records token usage (snake_case) and latencyMs via getGlobalTokenTracker().record()", async () => {
    const time = createFakeTime(0);
    const tracker = getGlobalTokenTracker();
    const recordSpy = vi.spyOn(tracker, "record");

    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [
          {
            content: "ok",
            delayMs: 50,
            usage: { prompt_tokens: 3, completion_tokens: 7 },
          },
        ],
      },
    });

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      time,
      strategy: "priority",
    });

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
    expect(out).toMatchObject({ model: "m1", provider: "mock", content: "ok", latencyMs: 50 });

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy.mock.calls[0][0]).toMatchObject({
      model: "m1",
      provider: "mock",
      usage: "worker",
      promptTokens: 3,
      completionTokens: 7,
      latencyMs: 50,
      success: true,
    });
  });

  it("swallows token tracker errors (record() throwing does not fail the call)", async () => {
    const time = createFakeTime(0);
    const tracker = getGlobalTokenTracker();
    const recordSpy = vi.spyOn(tracker, "record").mockImplementationOnce(() => {
      throw new Error("tracker boom");
    });

    const { provider } = createMockProvider({
      time,
      behaviors: {
        m1: [{ content: "ok", usage: { promptTokens: 1, completionTokens: 2 } }],
      },
    });

    const router = new ModelRouter({
      models: [{ id: "m1", provider: "mock", tags: ["text"], limits: {} }],
      usageConfig: { worker: ["m1"] },
      providers: { mock: provider },
      time,
      strategy: "priority",
    });

    const out = await router.call({ usage: "worker", messages: [{ role: "user", content: "hi" }] });
    expect(out.content).toBe("ok");
    expect(recordSpy).toHaveBeenCalled();
  });
});
