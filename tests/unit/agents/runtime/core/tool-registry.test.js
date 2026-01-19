import { describe, it, expect, vi } from "vitest";

import { ToolRegistry } from '../../../../../js/agents/runtime/core/tool-registry.js';

describe("runtime/core/tool-registry", () => {
  it("validates hook registration inputs", () => {
    const registry = new ToolRegistry();

    expect(() => registry.useHook("nope", () => {})).toThrow(/Invalid hook phase/i);
    // @ts-expect-error: invalid hook type
    expect(() => registry.useHook("before", null)).toThrow(/Hook must be a function/i);
  });

  it("guards tool registration boundaries", () => {
    const registry = new ToolRegistry();

    expect(() => registry.registerTools(null)).not.toThrow();
    expect(() => registry.registerTools("nope")).toThrow(/tools must be an object, array, or map/i);
    expect(() => registry.registerTool("", () => {})).toThrow(/name must be a non-empty string/i);
    // @ts-expect-error: invalid tool function
    expect(() => registry.registerTool("demo", null)).toThrow(/fn must be a function/i);

    const map = new Map([[123, () => {}]]);
    expect(() => registry.registerTools(map)).toThrow(/name must be a non-empty string/i);
  });

  it("uses context executors and normalizes executor results", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });
    const executor = vi.fn(async () => "from-executor");
    const context = { toolExecutor: executor };

    const result = await registry.callTool("ping", { n: 1 }, context);

    expect(result).toMatchObject({ ok: true, success: true, data: "from-executor" });
    expect(executor).toHaveBeenCalledWith("ping", { n: 1 }, context);
    expect(toolFn).not.toHaveBeenCalled();
  });

  it("uses executor containers with execute()", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });
    const execute = vi.fn(async () => "from-container");
    const context = { toolExecutor: { execute } };

    const result = await registry.callTool("ping", { n: 1 }, context);

    expect(result).toMatchObject({ ok: true, data: "from-container" });
    expect(execute).toHaveBeenCalledWith("ping", { n: 1 }, context);
    expect(toolFn).not.toHaveBeenCalled();
  });

  it("returns unknown tool errors when lookup fails", async () => {
    const registry = new ToolRegistry();

    const result = await registry.callTool("missing", { n: 1 }, {});

    expect(result).toEqual({ ok: false, error: "Unknown tool: missing" });
  });

  it("runs quota-block after hooks, supports override, and logs hook failures", async () => {
    const logger = { warn: vi.fn() };
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn }, logger });

    const overrideHook = vi.fn(async () => ({ ok: true, data: "override" }));
    const failingHook = vi.fn(async () => {
      throw new Error("after-fail");
    });

    registry.useHook("after", overrideHook);
    registry.useHook("after", failingHook);

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "hard_limit" })),
      getToolStats: vi.fn(() => ({ limit: 1, used: 1 })),
    };

    const result = await registry.callTool(
      "ping",
      { n: 1 },
      {
        toolQuotaConfig: { mode: "block" },
        toolQuotaManager: quotaManager,
      }
    );

    expect(toolFn).not.toHaveBeenCalled();
    expect(overrideHook).toHaveBeenCalledTimes(1);
    expect(failingHook).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, data: "override" });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("[tool-registry] AfterHook failed for ping: after-fail"));
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

  it("registers tools from array objects and exposes lookups", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry();

    registry.registerTools([{ name: "ping", fn: toolFn }]);

    expect(registry.hasTool("ping")).toBe(true);
    expect(registry.hasTool("missing")).toBe(false);
    expect(registry.getToolNames()).toEqual(["ping"]);
    expect(registry.getTool("ping")).toBe(toolFn);
    expect(registry.getTool("missing")).toBeUndefined();

    const result = await registry.callTool("ping", {}, {});
    expect(result).toMatchObject({ ok: true, data: "pong" });
  });

  it("resolves traceContext from stageApi and records span metadata", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });
    const span = { setAttribute: vi.fn(), setStatus: vi.fn() };
    const traceContext = {
      startSpan: vi.fn(),
      endSpan: vi.fn(),
      withSpan: vi.fn(async (name, fn, options) => fn(span, options)),
    };

    const result = await registry.callTool("ping", { n: 1 }, { stageApi: { traceContext } });

    expect(result).toMatchObject({ ok: true, data: "pong" });
    expect(traceContext.withSpan).toHaveBeenCalledWith("tool.ping", expect.any(Function), { attributes: { tool: "ping" } });
    expect(span.setAttribute).toHaveBeenCalledWith("tool.name", "ping");
    expect(span.setStatus).not.toHaveBeenCalled();
  });

  it("resolves traceContext from container and marks span errors", async () => {
    const registry = new ToolRegistry();
    const span = { setAttribute: vi.fn(), setStatus: vi.fn() };
    const traceContext = {
      startSpan: vi.fn(),
      endSpan: vi.fn(),
      withSpan: vi.fn(async (name, fn, options) => fn(span, options)),
    };
    const container = {
      get: vi.fn(() => traceContext),
    };

    const result = await registry.callTool("missing", { n: 1 }, { container });

    expect(result).toEqual({ ok: false, error: "Unknown tool: missing" });
    expect(container.get).toHaveBeenCalledWith("traceContext");
    expect(traceContext.withSpan).toHaveBeenCalledWith("tool.missing", expect.any(Function), { attributes: { tool: "missing" } });
    expect(span.setStatus).toHaveBeenCalledWith("error", "Unknown tool: missing");
  });

  it("treats enforce as block mode for quotas", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "limit" })),
      getToolStats: vi.fn(),
    };

    const result = await registry.callTool("ping", { n: 1 }, { toolQuotaManager: quotaManager, toolQuotaConfig: { mode: "enforce" } });

    expect(result).toMatchObject({ ok: false, error: "limit" });
    expect(toolFn).not.toHaveBeenCalled();
  });

  it("treats warnOnly as warn mode and records calls", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });

    const quotaManager = {
      tryCall: vi.fn(() => ({ allowed: false, reason: "over" })),
      recordCall: vi.fn(),
      getToolStats: vi.fn(() => ({ limit: 1, used: 2 })),
    };

    const result = await registry.callTool("ping", { n: 1 }, { toolQuotaManager: quotaManager, toolQuotaConfig: { warnOnly: true } });

    expect(result).toMatchObject({ ok: true, data: "pong", quota: { allowed: false, reason: "over" } });
    expect(toolFn).toHaveBeenCalledTimes(1);
    expect(quotaManager.recordCall).toHaveBeenCalledWith("ping");
  });

  it("allows before hooks to override params", async () => {
    const toolFn = vi.fn(async ({ value }) => value);
    const registry = new ToolRegistry({ tools: { ping: toolFn } });

    registry.useHook("before", async ({ params }) => ({ params: { ...params, value: "updated" } }));

    const result = await registry.callTool("ping", { value: "original" }, {});

    expect(result).toMatchObject({ ok: true, data: "updated" });
    expect(toolFn).toHaveBeenCalledWith({ value: "updated" }, {});
  });

  it("allows before hooks to skip execution", async () => {
    const toolFn = vi.fn(async () => "pong");
    const registry = new ToolRegistry({ tools: { ping: toolFn } });
    const afterHook = vi.fn();

    registry.useHook("before", async () => ({ skip: true, value: { ok: true, data: "skipped" } }));
    registry.useHook("after", afterHook);

    const result = await registry.callTool("ping", { n: 1 }, {});

    expect(result).toMatchObject({ ok: true, data: "skipped" });
    expect(toolFn).not.toHaveBeenCalled();
    expect(afterHook).not.toHaveBeenCalled();
  });

  it("PolicyManager deny path blocks execution", async () => {
    const toolFn = vi.fn(async () => "ok");
    const registry = new ToolRegistry({ tools: { readFile: toolFn } });

    const policyManager = {
      check: vi.fn(async () => ({ effect: "deny", reason: "nope", ruleId: "rule-1" })),
    };
    registry.usePolicyManager(policyManager);

    const result = await registry.callTool("readFile", { path: "/tmp/demo.txt" }, {});

    expect(result).toMatchObject({ ok: false, error: "nope" });
    expect(toolFn).not.toHaveBeenCalled();
  });

  it("PolicyManager check failures fail open", async () => {
    const logger = { warn: vi.fn() };
    const toolFn = vi.fn(async () => "ok");
    const registry = new ToolRegistry({ tools: { readFile: toolFn }, logger });

    const policyManager = {
      check: vi.fn(async () => {
        throw new Error("policy-failed");
      }),
    };
    registry.usePolicyManager(policyManager);

    const result = await registry.callTool("readFile", { path: "/tmp/demo.txt" }, {});

    expect(result).toMatchObject({ ok: true, data: "ok" });
    expect(toolFn).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("[tool-registry] PolicyManager.check failed: policy-failed"));
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
