import { describe, it, expect, beforeEach, afterEach } from "vitest";

import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";

it("SDK: AgentBuilder builds an agent and runs capabilities with hooks", async () => {
  const { AgentBuilder } = await import("../../../js/agents/sdk/AgentBuilder.js");

  const builder = new AgentBuilder({ actor: "test" });
  builder.useHook("before", async ({ tool, params }) => {
    if (tool !== "Echo") return;
    return { params: { ...params, text: String(params.text || "").toUpperCase() } };
  });
  builder.useHook("after", async ({ tool, result }) => {
    if (tool !== "Echo") return undefined;
    return { ...result, after: true };
  });
  builder.useCapability("Echo", async (args) => ({ echo: args.text }));

  const agent = builder.build();
  const out = await agent.toolExecutor("Echo", { text: "hello" }, { state: {}, signal: null });
  expect(out.success).toBe(true);
  expect(out.data.echo).toBe("HELLO");
  expect(out.data.after).toBe(true);
});

it("SDK: AgentBuilder lazily imports module-backed capabilities", async () => {
  const { AgentBuilder } = await import("../../../js/agents/sdk/AgentBuilder.js");

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "paperburner-sdk-"));
  try {
    const modPath = path.join(tmp, "lazy-capability.mjs");
    await fs.writeFile(
      modPath,
      [
        "export async function handler(args) {",
        "  return { ok: true, value: args.value };",
        "}",
        "export default { handler };",
        "",
      ].join("\n"),
      "utf8"
    );

    const builder = new AgentBuilder({ 
      actor: "test",
      capabilityModuleAllowlist: [pathToFileURL(modPath).href]
    });
    builder.useCapability("Lazy", {
      definition: { name: "Lazy", description: "lazy", lazy: true },
      module: pathToFileURL(modPath).href,
    });

    const agent = builder.build();
    const out = await agent.toolExecutor("Lazy", { value: 123 }, { state: {}, signal: null });
    expect(out.success).toBe(true);
    expect(out.data.ok).toBe(true);
    expect(out.data.value).toBe(123);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

it("SDK: registering subagents adds the Task tool automatically", async () => {
  const { AgentBuilder } = await import("../../../js/agents/sdk/AgentBuilder.js");

  const builder = new AgentBuilder({ actor: "test" });
  builder.useSubagent("Explore", () => ({ run: async () => ({ ok: true }) }), "desc");

  const agent = builder.build();
  expect(agent.capabilities.has("Task")).toBe(true);
});

it("SDK: AgentInstance.dispose unsubscribes + rejects further use", async () => {
  const { AgentBuilder } = await import("../../../js/agents/sdk/AgentBuilder.js");
  const { DefaultAgentLoop } = await import("../../../js/agents/sdk/DefaultAgentLoop.js");

  let cfgHandlerCalls = 0;
  let manualHandlerCalls = 0;

  const builder = new AgentBuilder({ actor: "test" });
  builder.useCapability("Echo", async (args) => ({ echo: String(args.text || "") }));
  builder.onEvent("sdk.dispose.test", () => {
    cfgHandlerCalls += 1;
  });

  const agent = builder.build();
  const unsubscribe = agent.on("sdk.dispose.test", () => {
    manualHandlerCalls += 1;
  });

  agent.eventBus.emitSync("sdk.dispose.test", { ok: true });
  expect(cfgHandlerCalls).toBe(1);
  expect(manualHandlerCalls).toBe(1);

  // Ensure loop exists so loop cleanup can be validated.
  await agent.run({ tool: "Echo", args: { text: "hi" } }, { state: {}, signal: null });
  expect(agent._loop).toBeInstanceOf(DefaultAgentLoop);

  await agent.dispose();
  agent.eventBus.emitSync("sdk.dispose.test", { ok: true });

  expect(cfgHandlerCalls).toBe(1);
  expect(manualHandlerCalls).toBe(1);
  expect(agent._loop).toBe(null);

  // Returned unsubscribe should be safe to call after dispose.
  unsubscribe();

  expect(() => agent.run({ tool: "Echo", args: { text: "hi" } }, { state: {}, signal: null })).toThrow(/disposed/i);
  expect(() => agent.on("x", () => {}), /disposed/i);
  expect(() => agent.getCapabilityDefinitions()).toThrow(/disposed/i);
  expect(() => agent.toolExecutor, /disposed/i).toThrow();
});
