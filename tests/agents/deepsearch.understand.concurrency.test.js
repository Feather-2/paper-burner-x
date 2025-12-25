const test = require("node:test");
const assert = require("node:assert/strict");

function extractChunk0Text(prompt) {
  const text = String(prompt || "");
  const start = text.indexOf("### Chunk 0\n");
  if (start < 0) return "";
  const after = text.slice(start + "### Chunk 0\n".length);
  const next = after.indexOf("\n### Chunk ");
  return (next >= 0 ? after.slice(0, next) : after).trimEnd();
}

test("DeepSearch S5: understand per-todo LLM calls are concurrency-limited", async () => {
  const { DeepSearchState } = await import("../../js/agents/stages/deepsearch/state.js");
  const { runDeepSearchUnderstandStage } = await import("../../js/agents/stages/deepsearch/understand.js");

  const todoCount = 25;
  const lines = Array.from({ length: todoCount }, (_, i) => `Todo ${i + 1}: Alpha ${i + 1} is valid.`);
  const sourceText = lines.join("\n");

  const todos = Array.from({ length: todoCount }, (_, i) => ({
    todoId: `todo_${i + 1}`,
    status: "open",
    text: `Question ${i + 1}`,
    queryHints: [`Alpha_${i + 1}`],
  }));

  const retrievedChunks = todos.map((t, i) => {
    const quote = lines[i];
    const charStart = sourceText.indexOf(quote);
    const charEnd = charStart + quote.length;
    return {
      chunkId: `ch_${i + 1}`,
      sourceId: "s1",
      locator: { charStart, charEnd },
      text: quote,
      score: 1.0,
      todoId: t.todoId,
      matchedTodoIds: [t.todoId],
    };
  });

  let active = 0;
  let maxActive = 0;
  let perTodoCalls = 0;
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  let reachedLimit = false;
  let resolveReached;
  const reached = new Promise((resolve) => {
    resolveReached = resolve;
  });

  const modelRouter = {
    async call(messages, _opts) {
      const sys = String(messages?.[0]?.content || "");

      // per-todo extractor (generateClaimsWithLLM)
      if (sys.includes("你是一个严谨的研究助手")) {
        perTodoCalls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (!reachedLimit && active >= 10) {
          reachedLimit = true;
          resolveReached();
        }
        await gate;
        const chunk0 = extractChunk0Text(messages?.[1]?.content);
        active -= 1;
        return {
          content: JSON.stringify({
            claims: [{ text: "LLM claim", importance: "core", quote: chunk0, chunkIndex: 0 }],
          }),
        };
      }

      // claim edits (tryLLMClaimEdits)
      if (sys.includes("资深主编") || sys.includes("Lead Agent")) {
        return { content: JSON.stringify({ claims: [] }) };
      }

      throw new Error(`Unexpected model call: ${sys.slice(0, 60)}`);
    },
  };

  const state = new DeepSearchState({
    runId: "run_concurrency",
    taskGoal: "Test concurrency limit",
    userConfig: { reflect: { enabled: false } },
    L0: { sources: [{ sourceId: "s1", kind: "user_text", title: "Doc", sourceTextNormalized: sourceText }] },
    todos,
    L2: { retrievedChunks },
  });

  const runPromise = runDeepSearchUnderstandStage({ runId: "run_concurrency" }, { state }, { modelRouter });
  await reached;
  releaseGate();
  const out = await runPromise;

  assert.equal(perTodoCalls, todoCount);
  assert.ok(maxActive <= 10, `maxActive=${maxActive} should be <= 10`);
  assert.ok(out.claims.length >= 1);
  assert.ok(out.evidenceLedger.length >= 1);
  assert.ok(out.claims.every((c) => Array.isArray(c.todoIds) && c.todoIds.length >= 1));
  assert.ok(out.evidenceLedger.every((e) => Array.isArray(e.todoIds) && e.todoIds.length >= 1));
});
