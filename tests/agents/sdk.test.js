import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";

test("SDK: AgentBuilder builds an agent and runs capabilities with hooks", async () => {
  const { AgentBuilder } = await import("../../js/agents/sdk/AgentBuilder.js");

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
  assert.equal(out.success, true);
  assert.equal(out.data.echo, "HELLO");
  assert.equal(out.data.after, true);
});

test("SDK: AgentBuilder lazily imports module-backed capabilities", async () => {
  const { AgentBuilder } = await import("../../js/agents/sdk/AgentBuilder.js");

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

    const builder = new AgentBuilder({ actor: "test" });
    builder.useCapability("Lazy", {
      definition: { name: "Lazy", description: "lazy", lazy: true },
      module: pathToFileURL(modPath).href,
    });

    const agent = builder.build();
    const out = await agent.toolExecutor("Lazy", { value: 123 }, { state: {}, signal: null });
    assert.equal(out.success, true);
    assert.equal(out.data.ok, true);
    assert.equal(out.data.value, 123);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("SDK: registering subagents adds the Task tool automatically", async () => {
  const { AgentBuilder } = await import("../../js/agents/sdk/AgentBuilder.js");

  const builder = new AgentBuilder({ actor: "test" });
  builder.useSubagent("Explore", () => ({ run: async () => ({ ok: true }) }), "desc");

  const agent = builder.build();
  assert.equal(agent.capabilities.has("Task"), true);
});

test("SDK: AgentInstance.dispose unsubscribes + rejects further use", async () => {
  const { AgentBuilder } = await import("../../js/agents/sdk/AgentBuilder.js");

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
  assert.equal(cfgHandlerCalls, 1);
  assert.equal(manualHandlerCalls, 1);

  // Ensure loop exists so loop cleanup can be validated.
  await agent.run({ tool: "Echo", args: { text: "hi" } }, { state: {}, signal: null });
  assert.ok(agent._loop);

  await agent.dispose();
  agent.eventBus.emitSync("sdk.dispose.test", { ok: true });

  assert.equal(cfgHandlerCalls, 1);
  assert.equal(manualHandlerCalls, 1);
  assert.equal(agent._loop, null);

  // Returned unsubscribe should be safe to call after dispose.
  unsubscribe();

  assert.throws(() => agent.run({ tool: "Echo", args: { text: "hi" } }, { state: {}, signal: null }), /disposed/i);
  assert.throws(() => agent.on("x", () => {}), /disposed/i);
  assert.throws(() => agent.getCapabilityDefinitions(), /disposed/i);
  assert.throws(() => agent.toolExecutor, /disposed/i);
});
