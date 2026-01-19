import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

it("executeTool: returns success:false when tool handler throws", async () => {
  const { tools, executeTool } = await import("../../../js/agents/stages/deepsearch/tools/index.js");

  const name = "__test_throw__";
  tools[name] = {
    handler: async () => {
      throw new Error("boom");
    },
  };

  try {
    const result = await executeTool(name, { a: 1 }, { runId: "run_execute_tool_throw" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
    expect(result.errorName).toBe("Error");
    expect(result.stack).toEqual(expect.stringContaining("Error: boom"));
  } finally {
    delete tools[name];
  }
});

it("executeTool: passes through {success:false} results from handler", async () => {
  const { tools, executeTool } = await import("../../../js/agents/stages/deepsearch/tools/index.js");

  const name = "__test_failure_result__";
  const expected = { success: false, error: "explicit failure" };
  tools[name] = {
    handler: async () => expected,
  };

  try {
    const result = await executeTool(name, { b: 2 }, { runId: "run_execute_tool_failure_result" });
    expect(result).toEqual(expected);
  } finally {
    delete tools[name];
  }
});
