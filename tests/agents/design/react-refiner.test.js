const test = require("node:test");
const assert = require("node:assert/strict");

async function loadRefiner() {
  return import("../../../js/agents/stages/design/react-refiner.js");
}

test("ReactRefiner: validateStepSchema validates action steps", async () => {
  const { __test } = await loadRefiner();
  const { validateStepSchema } = __test;

  assert.deepStrictEqual(
    validateStepSchema({ thought: "t", action: { tool: "editSlide", params: { slideIndex: 0, changes: { title: "X" } } } }),
    { valid: true }
  );

  assert.equal(validateStepSchema(null).valid, false);
  assert.match(validateStepSchema(null).error, /Step must be a JSON object/);

  assert.match(validateStepSchema({}).error, /either 'action' or 'finish'/);
  assert.match(validateStepSchema({ action: {}, finish: {} }).error, /cannot have both/);

  assert.match(validateStepSchema({ action: { tool: "", params: {} } }).error, /must specify 'tool'/);
  assert.match(validateStepSchema({ action: { tool: "editSlide", params: null } }).error, /provide 'params' object/);
});

test("ReactRefiner: validateStepSchema validates finish steps and catches errors", async () => {
  const { __test } = await loadRefiner();
  const { validateStepSchema } = __test;

  assert.deepStrictEqual(validateStepSchema({ finish: { qualityScore: 7, remainingIssues: 3, refinements: [] } }), { valid: true });

  assert.match(validateStepSchema({ finish: { qualityScore: 0, remainingIssues: 0, refinements: [] } }).error, /qualityScore must be 1-10/);
  assert.match(validateStepSchema({ finish: { qualityScore: 11, remainingIssues: 0, refinements: [] } }).error, /qualityScore must be 1-10/);
  assert.match(validateStepSchema({ finish: { qualityScore: 7, remainingIssues: -1, refinements: [] } }).error, /remainingIssues must be >= 0/);
  assert.match(validateStepSchema({ finish: { qualityScore: 7, remainingIssues: 0, refinements: "nope" } }).error, /refinements array/);
});

test("ReactRefiner: validateFinishConditions enforces score/issues thresholds", async () => {
  const { __test } = await loadRefiner();
  const { validateFinishConditions } = __test;

  assert.deepStrictEqual(validateFinishConditions({ qualityScore: 7, remainingIssues: 3 }), { accepted: true });
  assert.match(validateFinishConditions({ qualityScore: 6, remainingIssues: 0 }).reason, /below minimum 7/);
  assert.match(validateFinishConditions({ qualityScore: 9, remainingIssues: 4 }).reason, /exceeds maximum 3/);
  assert.match(validateFinishConditions({ qualityScore: "x", remainingIssues: 0 }).reason, /Invalid finish data/);
});

test("ReactRefiner: getAvailableTools differs between generation and edit", async () => {
  const { __test } = await loadRefiner();
  const { getAvailableTools } = __test;

  const gen = getAvailableTools("generation");
  const edit = getAvailableTools("edit");

  assert.ok(Array.isArray(gen) && gen.length > 0);
  assert.ok(Array.isArray(edit) && edit.length > gen.length);
  assert.ok(gen.includes("editSlide"));
  assert.ok(!gen.includes("addSlide"));
  assert.ok(edit.includes("addSlide"));
  assert.ok(edit.includes("diff"));
});

test("ReactRefiner: runReactRefiner basic flow with mocked model and toolExecutor", async () => {
  const { runReactRefiner } = await loadRefiner();

  const initialDeck = {
    schemaVersion: "0.1",
    runId: "run_test",
    designSystem: { theme: "demo", designTokens: { colors: { bg: "#fff", text: "#111" }, typography: { fontFamily: "Inter" } } },
    slidesMeta: [{ slideNo: 1, title: "Old" }],
    imageSlots: [],
    deckHtmlDsl: `<section data-title="Old"><div data-el="t1">Old</div></section>`,
  };

  const events = [];
  const chatCalls = [];
  const responses = [
    { content: "NOT_JSON" },
    {
      content: "```json\n" + JSON.stringify({ thought: "try edit tools", action: { tool: "addSlide", params: { position: "end", content: { title: "X" } } } }) + "\n```",
    },
    {
      content:
        "```json\n" +
        JSON.stringify({ thought: "update title", action: { tool: "editSlide", params: { slideIndex: 0, changes: { title: "Updated" } } } }) +
        "\n```",
    },
    { content: "```json\n" + JSON.stringify({ thought: "finish?", finish: { qualityScore: 6, remainingIssues: 2, refinements: [] } }) + "\n```" },
    {
      content:
        "```json\n" +
        JSON.stringify({ thought: "done", finish: { qualityScore: 8, remainingIssues: 2, refinements: [{ issue: "contrast", fix: "tune colors" }] } }) +
        "\n```",
    },
  ];

  const stageApi = {
    aiApiService: {
      chat: async (opts) => {
        chatCalls.push(opts);
        const next = responses.shift();
        if (!next) throw new Error("Unexpected chat call");
        return next;
      },
    },
    emit: (name, record) => events.push({ name, record }),
  };

  const toolCalls = [];
  const toolExecutor = async (toolName, params) => {
    toolCalls.push({ toolName, params });
    if (toolName !== "editSlide") return { success: false, error: "Unexpected tool call" };
    return {
      success: true,
      data: {
        deckPackage: {
          ...initialDeck,
          deckHtmlDsl: `<section data-title="Updated"><div data-el="t1">Old</div></section>`,
        },
      },
    };
  };

  const onSteps = [];
  const res = await runReactRefiner(initialDeck, { contentPackage: { slideIntents: [{ slideIntentId: "s1" }] }, stageApi }, { toolExecutor, mode: "generation", hardLimit: 6, onStep: (s) => onSteps.push(s) });

  assert.equal(res.terminationReason, "quality_met");
  assert.equal(res.qualityScore, 8);
  assert.equal(res.toolCalls.length, 1);
  assert.equal(res.toolCalls[0].tool, "editSlide");
  assert.ok(res.finalDeck.deckHtmlDsl.includes('data-title="Updated"'));

  assert.equal(chatCalls.length, 5);
  assert.ok(chatCalls[1].messages.some((m) => String(m.content || "").includes("只返回严格 JSON")));

  assert.equal(onSteps.length, 4);
  assert.ok(events.some((e) => e.name === "design.refine.finish_accepted"));
});

