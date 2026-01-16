import { describe, it, expect, beforeEach, afterEach } from "vitest";

const assert = require("node:assert/strict");

async function loadRefiner() {
  return import("../../../js/agents/stages/design/refiner/react-refiner.js");
}

it("ReactRefiner: validateStepSchema validates action steps", async () => {
  const { __test } = await loadRefiner();
  const { validateStepSchema } = __test;

  expect(validateStepSchema({ thought: "t", action: { tool: "editSlide", params: { slideIndex: 0, changes: { title: "X" } } } })).toEqual(
    { valid: true }
  );

  expect(validateStepSchema(null).valid).toBe(false);
  expect(validateStepSchema(null).error).toMatch(/Step must be a JSON object/);

  expect(validateStepSchema({}).error).toMatch(/either 'action' or 'finish'/);
  expect(validateStepSchema({ action: {}, finish: {} }).error).toMatch(/cannot have both/);

  expect(validateStepSchema({ action: { tool: "", params: {} } }).error).toMatch(/must specify 'tool'/);
  expect(validateStepSchema({ action: { tool: "editSlide", params: null } }).error).toMatch(/provide 'params' object/);
});

it("ReactRefiner: validateStepSchema validates finish steps and catches errors", async () => {
  const { __test } = await loadRefiner();
  const { validateStepSchema } = __test;

  expect(validateStepSchema({ finish: { qualityScore: 7, remainingIssues: 3, refinements: [] } })).toEqual({ valid: true });

  expect(validateStepSchema({ finish: { qualityScore: 0, remainingIssues: 0, refinements: [] } }).error).toMatch(/qualityScore must be 1-10/);
  expect(validateStepSchema({ finish: { qualityScore: 11, remainingIssues: 0, refinements: [] } }).error).toMatch(/qualityScore must be 1-10/);
  expect(validateStepSchema({ finish: { qualityScore: 7, remainingIssues: -1, refinements: [] } }).error).toMatch(/remainingIssues must be >= 0/);
  expect(validateStepSchema({ finish: { qualityScore: 7, remainingIssues: 0, refinements: "nope" } }).error).toMatch(/refinements array/);
});

it("ReactRefiner: validateFinishConditions accepts valid finish data (AI decides quality)", async () => {
  const { __test } = await loadRefiner();
  const { validateFinishConditions } = __test;

  // AI 自主决定质量，只要数据格式有效就接受
  expect(validateFinishConditions({ qualityScore: 7, remainingIssues: 3 })).toEqual({ accepted: true });
  expect(validateFinishConditions({ qualityScore: 6, remainingIssues: 0 })).toEqual({ accepted: true });
  expect(validateFinishConditions({ qualityScore: 9, remainingIssues: 4 })).toEqual({ accepted: true });
  // 无效数据仍然拒绝
  expect(validateFinishConditions({ qualityScore: "x", remainingIssues: 0 }).reason).toMatch(/Invalid finish data/);
});

it("ReactRefiner: getAvailableTools differs between generation and edit", async () => {
  const { __test } = await loadRefiner();
  const { getAvailableTools } = __test;

  const gen = getAvailableTools("generation");
  const edit = getAvailableTools("edit");

  expect(Array.isArray(gen ) && gen.length > 0).toBeTruthy();
  expect(Array.isArray(edit ) && edit.length > gen.length).toBeTruthy();
  expect(gen.includes("editSlide")).toBeTruthy();
  expect(!gen.includes("addSlide")).toBeTruthy();
  expect(edit.includes("addSlide")).toBeTruthy();
  expect(edit.includes("diff")).toBeTruthy();
});

it("ReactRefiner: runReactRefiner basic flow with mocked model and toolExecutor", async () => {
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
    // AI 自主决定完成，第一个有效 finish 就会被接受
    { content: "```json\n" + JSON.stringify({ thought: "done", finish: { qualityScore: 8, remainingIssues: 2, refinements: [{ issue: "contrast", fix: "tune colors" }] } }) + "\n```" },
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

  expect(res.terminationReason).toBe("quality_met");
  expect(res.qualityScore).toBe(8);
  expect(res.toolCalls.length).toBe(1);
  expect(res.toolCalls[0].tool).toBe("editSlide");
  expect(res.finalDeck.deckHtmlDsl.includes('data-title="Updated"')).toBeTruthy();

  // 4 responses: NOT_JSON, addSlide (fail), editSlide (success), finish
  expect(chatCalls.length).toBe(4);
  expect(chatCalls[1].messages.some(m => String(m.content || "").includes("只返回严格 JSON")));

  expect(onSteps.length).toBe(3);
  expect(events.some(e => e.name === "design.refine.finish_accepted")).toBeTruthy();
});

