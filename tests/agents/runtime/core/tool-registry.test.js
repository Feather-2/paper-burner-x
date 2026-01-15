import { describe, it, expect, vi } from "vitest";

import { ToolRegistry } from "../../../../js/agents/runtime/core/tool-registry.js";

describe("runtime/core/tool-registry", () => {
  it("validates hook registration inputs", () => {
    const registry = new ToolRegistry();

    expect(() => registry.useHook("nope", () => {})).toThrow(/Invalid hook phase/i);
    // @ts-expect-error: invalid hook type
    expect(() => registry.useHook("before", null)).toThrow(/Hook must be a function/i);
  });

  it("bypasses quota checks when toolQuotaConfig disables quotas", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "should-not-run" })),
      getToolStats: vi.fn(() => ({ limit: 1, used: 999 })),
      recordCall: vi.fn(),
    };

    const result = await registry.callTool("ping", { n: 1 }, { toolQuotaManager: quotaManager, toolQuotaConfig: { enabled: false } });
    expect(result).toMatchObject({ ok: true, data: "pong" });
    expect(quotaManager.tryCall).not.toHaveBeenCalled();
    expect(quotaManager.recordCall).not.toHaveBeenCalled();
  });

  it("emits quota warnings via ctx.emit and tolerates recordCall failures (warn mode)", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "too_many_calls" })),
      getToolStats: vi.fn(() => ({ limit: 1, used: 2 })),
      recordCall: vi.fn(() => {
        throw new Error("record-failed");
      }),
    };

    const emit = vi.fn();
    const result = await registry.callTool(
      "ping",
      { n: 1 },
      {
        emit,
        toolQuotaManager: quotaManager,
        toolQuotaConfig: { mode: "warning" },
      }
    );

    expect(result).toMatchObject({ ok: true, data: "pong", quota: { allowed: false, reason: "too_many_calls" } });
    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(quotaManager.tryCall).toHaveBeenCalledWith("ping");
    expect(quotaManager.recordCall).toHaveBeenCalledWith("ping");

    expect(emit).toHaveBeenCalledWith("tool.quota.exceeded", {
      actor: "system",
      status: "exceeded",
      payload: { tool: "ping", reason: "too_many_calls", stats: { limit: 1, used: 2 } },
    });
  });

  it("resolves emit from stageApi.emit and stageApi.eventBus.emit", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "quota" })),
      getToolStats: vi.fn(() => ({ limit: 1, used: 99 })),
      recordCall: vi.fn(),
    };

    const stageEmit = vi.fn();
    await registry.callTool("ping", {}, { stageApi: { toolQuotaManager: quotaManager, emit: stageEmit } });
    expect(stageEmit).toHaveBeenCalledWith("tool.quota.exceeded", expect.any(Object));

    const stageBusEmit = vi.fn();
    await registry.callTool("ping", {}, { stageApi: { toolQuotaManager: quotaManager, eventBus: { emit: stageBusEmit } } });
    expect(stageBusEmit).toHaveBeenCalledWith("tool.quota.exceeded", expect.any(Object));
  });

  it("resolves quota manager from container.get and supports disabled/off aliases", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "should-not-run" })),
    };
    const container = {
      get: vi.fn(() => quotaManager),
    };

    const result = await registry.callTool("ping", {}, { container, toolQuotaConfig: { mode: "disabled" } });
    expect(result).toMatchObject({ ok: true, data: "pong" });
    expect(container.get).toHaveBeenCalledWith("toolQuotaManager");
    expect(quotaManager.tryCall).not.toHaveBeenCalled();
  });

  it("handles tool execution errors (including non-Error throws)", async () => {
    const registry = new ToolRegistry({
      tools: {
        boom: () => {
          // eslint-disable-next-line no-throw-literal
          throw "bad";
        },
      },
    });

    const result = await registry.callTool("boom", {}, {});
    expect(result).toEqual({ ok: false, error: "bad" });
  });

  it("PolicyManager allow-path passes request info (resource from path) and keeps execution", async () => {
    const toolFn = vi.fn(async () => "ok");
    const registry = new ToolRegistry({ tools: { readFile: toolFn } });

    const policyManager = {
      check: vi.fn(async () => ({ effect: "allow" })),
    };
    // Should be a no-op for invalid inputs.
    registry.usePolicyManager({ noCheck: true });
    registry.usePolicyManager(policyManager);

    const params = { path: "/tmp/demo.txt", query: "ignored" };
    const result = await registry.callTool("readFile", params, {});

    expect(result).toMatchObject({ ok: true, data: "ok" });
    expect(toolFn).toHaveBeenCalledWith(params, {});
    expect(policyManager.check).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "tool_call",
        tool: "readFile",
        resource: "/tmp/demo.txt",
        args: params,
      })
    );
  });
});

