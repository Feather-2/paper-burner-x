import { describe, it, expect, beforeEach, afterEach } from "vitest";

it("fill_visual: normalizes visualSlots -> visualSlotsForRender", async () => {
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

  expect(calledWith, "Expected _renderVisuals to be called").toBeTruthy();
  expect(calledWith[0]).toEqual(visualSlots);
});

it("fill_visual: prefers visualSlotsForRender when provided", async () => {
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

  expect(calledWith, "Expected _renderVisuals to be called").toBeTruthy();
  expect(calledWith[0]).toEqual(visualSlotsForRender);
});

it("fix_slide: enriches missing currentHtml/designSystem from agentLoop.state", async () => {
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

  expect(result.fixedHtml).toBe(stateDeckHtml);
});

it("fix_slide: uses enriched values in LLM prompt when available", async () => {
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

  expect(result.fixedHtml).toBe("<section>fixed</section>");
  expect(seenUserPrompt.includes(stateDeckHtml)).toBeTruthy();
  expect(seenUserPrompt.includes('"brand":"acme"')).toBeTruthy();
});

it("fix_slide: respects explicit currentHtml/designSystem over state", async () => {
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

  expect(seenUserPrompt.includes(currentHtml)).toBeTruthy();
  expect(seenUserPrompt.includes('"brand":"params"')).toBeTruthy();
  expect(!seenUserPrompt.includes('"brand":"state"')).toBeTruthy();
});

it("other design tools: basic handler contract sanity", async () => {
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

  expect(Array.isArray(getToolDefinitions())).toBeTruthy();

  const parsed = await handlers.parse_outline({ contentPackage: { slideIntents: [{ slideIntentId: "s1" }] } });
  expect(parsed.slideIntents.length).toBe(1);

  const extracted = await handlers.extract_style(
    { contentPackage: { runId: "r1" }, constraints: { tone: "business" }, userConfig: { theme: "dark" } },
    { aiApiService: null }
  );
  expect(extracted.designSystem?.ok).toBeTruthy();

  const spawned = await handlers.spawn_slide_agent({}, { aiApiService: null });
  expect(spawned.generated).toEqual([]);

  const screenshots = await handlers.take_screenshot();
  expect(screenshots.screenshots).toEqual([]);

  const emitted = [];
  const chatReply = await handlers.chat_ask({ message: "hello" }, { emit: (n, r) => emitted.push({ n, r }) });
  expect(chatReply.actionName).toBe("chat_reply");
  expect(emitted.some(evt => evt.n === "design.chat.ask")).toBeTruthy();

  const chatWithAction = await handlers.chat_ask(
    { message: "confirm", actionName: "confirm_action" },
    { emit: () => {}, eventBus: {}, signal: null }
  );
  expect(chatWithAction.actionName).toBe("confirm_action");
  expect(chatWithAction.payload?.ok).toBeTruthy();
});

