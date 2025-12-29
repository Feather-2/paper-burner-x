const test = require("node:test");
const assert = require("node:assert/strict");

test("executeTool: returns success:false when tool handler throws", async () => {
  const { tools, executeTool } = await import("../../../js/agents/stages/deepsearch/tools/index.js");

  const name = "__test_throw__";
  tools[name] = {
    handler: async () => {
      throw new Error("boom");
    },
  };

  try {
    const result = await executeTool(name, { a: 1 }, { runId: "run_execute_tool_throw" });
    assert.deepEqual(result, { success: false, error: "boom" });
  } finally {
    delete tools[name];
  }
});

test("executeTool: passes through {success:false} results from handler", async () => {
  const { tools, executeTool } = await import("../../../js/agents/stages/deepsearch/tools/index.js");

  const name = "__test_failure_result__";
  const expected = { success: false, error: "explicit failure" };
  tools[name] = {
    handler: async () => expected,
  };

  try {
    const result = await executeTool(name, { b: 2 }, { runId: "run_execute_tool_failure_result" });
    assert.deepEqual(result, expected);
  } finally {
    delete tools[name];
  }
});

