import { beforeEach, describe, expect, it, vi } from "vitest";

const registerDeepSearchSubagentsMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));

vi.mock("../../../../../../../js/agents/sdk/SubagentRegistry.js", () => ({
  globalSubagentRegistry: {
    getFactory: vi.fn(() => null),
    getAvailableTypes: vi.fn(() => []),
  },
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/subagents.js", () => ({
  registerDeepSearchSubagents: registerDeepSearchSubagentsMock,
}));

vi.mock("../../../../../../../js/agents/stages/deepsearch/source-manager.js", () => ({
  default: class SourceManagerMock {
    syncSources() {}
  },
}));

vi.mock("../../../../../../../js/agents/shared/index.js", () => ({
  createLogger: vi.fn(() => loggerMock),
  DisposableBase: class DisposableBase {
    _registerDisposable() {}
    async dispose() {}
  },
  makeSecureTimestampedId: vi.fn(() => "task_1"),
  toPositiveInt: vi.fn((value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }),
}));

const MODULE_PATH = "../../../../../../../js/agents/stages/deepsearch/tools/task/handler.js";

async function loadModule() {
  return await import(MODULE_PATH);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("task handler subagent registration retry", () => {
  it("retries registration after initial failure instead of permanently disabling retries", async () => {
    registerDeepSearchSubagentsMock
      .mockImplementationOnce(() => {
        throw new Error("first failure");
      })
      .mockImplementation(() => {});

    const { handler } = await loadModule();
    const context = { state: { L0: { sources: [] } }, emit: vi.fn(), stageApi: {}, sharedContext: {} };

    await handler({ subagent_type: "invalid", prompt: "x" }, context);
    await handler({ subagent_type: "invalid", prompt: "x" }, context);
    await handler({ subagent_type: "invalid", prompt: "x" }, context);

    expect(registerDeepSearchSubagentsMock).toHaveBeenCalledTimes(2);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "subagents registration failed",
      expect.objectContaining({ error: "first failure" }),
    );
  });
});

