const test = require("node:test");
const assert = require("node:assert/strict");

test("fill_visual: normalizes visualSlots -> visualSlotsForRender", async () => {
  const { createDesignToolHandlers } = await import("../../../js/agents/stages/design/design-tools.js");

  let calledWith = null;
  const agentLoop = {
    state: {},
    _renderVisuals: (...args) => {
      calledWith = args;
      return { deckHtmlDsl: "", pendingImages: [] };
    },
  };

  const handlers = createDesignToolHandlers(agentLoop);
  const visualSlots = [{ slotId: "slot_1" }];

  await handlers.fill_visual({ visualSlots }, {});

  assert.ok(calledWith, "Expected _renderVisuals to be called");
  assert.deepEqual(calledWith[0], visualSlots);
});

test("fill_visual: prefers visualSlotsForRender when provided", async () => {
  const { createDesignToolHandlers } = await import("../../../js/agents/stages/design/design-tools.js");

  let calledWith = null;
  const agentLoop = {
    state: {},
    _renderVisuals: (...args) => {
      calledWith = args;
      return { deckHtmlDsl: "", pendingImages: [] };
    },
  };

  const handlers = createDesignToolHandlers(agentLoop);
  const visualSlots = [{ slotId: "slot_schema" }];
  const visualSlotsForRender = [{ slotId: "slot_runtime" }];

  await handlers.fill_visual({ visualSlots, visualSlotsForRender }, {});

  assert.ok(calledWith, "Expected _renderVisuals to be called");
  assert.deepEqual(calledWith[0], visualSlotsForRender);
});

test("fix_slide: enriches missing currentHtml/designSystem from agentLoop.state", async () => {
  const { createDesignToolHandlers } = await import("../../../js/agents/stages/design/design-tools.js");

  const stateDeckHtml = '<section data-type="freeform">state</section>';
  const stateDesignSystem = { brand: "acme" };

  const agentLoop = {
    state: { deckHtmlDsl: stateDeckHtml, designSystem: stateDesignSystem },
  };

  const handlers = createDesignToolHandlers(agentLoop);

  const result = await handlers.fix_slide(
    { slideIndex: 0, issues: [{ kind: "overflow" }] },
    { aiApiService: null }
  );

  assert.equal(result.fixedHtml, stateDeckHtml);
});

test("fix_slide: uses enriched values in LLM prompt when available", async () => {
  const { createDesignToolHandlers } = await import("../../../js/agents/stages/design/design-tools.js");

  const stateDeckHtml = '<section data-type="freeform">state</section>';
  const stateDesignSystem = { brand: "acme" };

  let seenUserPrompt = "";
  const aiApiService = {
    chat: async ({ messages }) => {
      const user = messages.find((m) => m.role === "user");
      seenUserPrompt = user?.content || "";
      return { text: "<section>fixed</section>" };
    },
  };

  const agentLoop = {
    state: { deckHtmlDsl: stateDeckHtml, designSystem: stateDesignSystem },
  };

  const handlers = createDesignToolHandlers(agentLoop);
  const result = await handlers.fix_slide(
    { slideIndex: 0, issues: [{ kind: "overflow" }] },
    { aiApiService }
  );

  assert.equal(result.fixedHtml, "<section>fixed</section>");
  assert.ok(seenUserPrompt.includes(stateDeckHtml));
  assert.ok(seenUserPrompt.includes('"brand":"acme"'));
});

test("fix_slide: respects explicit currentHtml/designSystem over state", async () => {
  const { createDesignToolHandlers } = await import("../../../js/agents/stages/design/design-tools.js");

  const stateDeckHtml = '<section data-type="freeform">state</section>';
  const stateDesignSystem = { brand: "state" };

  const currentHtml = '<section data-type="freeform">params</section>';
  const designSystem = { brand: "params" };

  let seenUserPrompt = "";
  const aiApiService = {
    chat: async ({ messages }) => {
      const user = messages.find((m) => m.role === "user");
      seenUserPrompt = user?.content || "";
      return { text: "<section>fixed</section>" };
    },
  };

  const agentLoop = {
    state: { deckHtmlDsl: stateDeckHtml, designSystem: stateDesignSystem },
  };

  const handlers = createDesignToolHandlers(agentLoop);
  await handlers.fix_slide(
    { slideIndex: 0, currentHtml, issues: [{ kind: "overflow" }], designSystem },
    { aiApiService }
  );

  assert.ok(seenUserPrompt.includes(currentHtml));
  assert.ok(seenUserPrompt.includes('"brand":"params"'));
  assert.ok(!seenUserPrompt.includes('"brand":"state"'));
});

test("other design tools: basic handler contract sanity", async () => {
  const { createDesignToolHandlers, getToolDefinitions } = await import("../../../js/agents/stages/design/design-tools.js");

  const agentLoop = {
    state: {},
    batchSize: 2,
    batchConcurrency: 1,
    _initDesignSystem: async (contentPackage, context, constraints, userConfig) => ({
      contentPackage,
      context,
      constraints,
      userConfig,
      ok: true,
    }),
    waitForUserAction: async (actionName) => ({ actionName, ok: true }),
    _renderVisuals: async () => ({ deckHtmlDsl: "", pendingImages: [] }),
  };

  const handlers = createDesignToolHandlers(agentLoop);

  assert.ok(Array.isArray(getToolDefinitions()));

  const parsed = await handlers.parse_outline({ contentPackage: { slideIntents: [{ slideIntentId: "s1" }] } });
  assert.equal(parsed.slideIntents.length, 1);

  const extracted = await handlers.extract_style(
    { contentPackage: { runId: "r1" }, constraints: { tone: "business" }, userConfig: { theme: "dark" } },
    { aiApiService: null }
  );
  assert.ok(extracted.designSystem?.ok);

  const spawned = await handlers.spawn_slide_agent({}, { aiApiService: null });
  assert.deepEqual(spawned.generated, []);

  const screenshots = await handlers.take_screenshot();
  assert.deepEqual(screenshots.screenshots, []);

  const emitted = [];
  const chatReply = await handlers.chat_ask({ message: "hello" }, { emit: (n, r) => emitted.push({ n, r }) });
  assert.equal(chatReply.actionName, "chat_reply");
  assert.ok(emitted.some((evt) => evt.n === "design.chat.ask"));

  const chatWithAction = await handlers.chat_ask(
    { message: "confirm", actionName: "confirm_action" },
    { emit: () => {}, eventBus: {}, signal: null }
  );
  assert.equal(chatWithAction.actionName, "confirm_action");
  assert.ok(chatWithAction.payload?.ok);
});

