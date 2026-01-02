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

