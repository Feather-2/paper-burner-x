const test = require("node:test");
const assert = require("node:assert/strict");

function makeContentPackage({ slideCount = 2 } = {}) {
  const slideIntents = [
    { slideIntentId: "s_cover", pageType: "cover", title: "Demo Deck", objective: "A concise demo." },
    { slideIntentId: "s_overview", pageType: "overview", title: "Overview", keyPoints: ["Context and goals"], claimIds: ["c1"] },
  ].slice(0, slideCount);

  return {
    schemaVersion: "0.1",
    runId: "run_test",
    constraints: { pageCount: slideCount, tone: "business", audience: "tech" },
    summary: "Demo Deck\nShort summary for the deck.",
    slideIntents,
    claims: [{ claimId: "c1", text: "Claim 1: X improves Y.", evidenceIds: ["e1"] }],
    evidenceLedger: [{ evidenceId: "e1", sourceId: "user_text", locator: { charStart: 0, charEnd: 10 }, quote: "Alpha beta" }],
  };
}

test("Brainstorm v2: LLM generates candidates, review scores, and maps visualSlots to imageSlots", async () => {
  const { brainstorm } = await import("../../../js/agents/stages/design/brainstorm.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const aiApiService = {
    chat: async ({ messages }) => {
      const system = String(messages?.[0]?.content || "");
      const user = String(messages?.[1]?.content || "");

      // New simplified format: return slideResults with visualSlots directly
      if (system.includes("Visual Planner") || user.includes("Plan visual elements")) {
        const slideResults = [];
        if (user.includes('"slideIntentId": "s_cover"') || user.includes('"slideIntentId":"s_cover"')) {
          slideResults.push({
            slideIntentId: "s_cover",
            slideIndex: 0,
            visualSlots: [
              {
                slotId: "s_cover_hero",
                renderType: "ai-image",
                position: { x: "10%", y: "10%", w: "80%", h: "45%" },
                prompt: "High impact hero visual",
                style: "3d",
                priority: "critical",
              },
            ],
          });
        }
        if (user.includes('"slideIntentId": "s_overview"') || user.includes('"slideIntentId":"s_overview"')) {
          slideResults.push({
            slideIntentId: "s_overview",
            slideIndex: 1,
            visualSlots: [
              {
                slotId: "s_overview_flow",
                renderType: "svg",
                position: { x: "10%", y: "80%", w: "80%", h: "10%" },
                svgDescription: "Three nodes connected by arrows",
                svgType: "flowchart",
                priority: "important",
              },
            ],
          });
        }
        return { content: JSON.stringify({ slideResults }) };
      }

      throw new Error("Unexpected prompt");
    },
  };

  const contentPackage = makeContentPackage({ slideCount: 2 });
  const designSystem = {
    theme: "dark",
    designTokens: { colors: { bg: "#0f172a", text: "#f8fafc", primary: "#22d3ee" }, typography: { fontFamily: "Inter" } },
    visualPreference: { mode: "balanced" },
  };

  const res = await brainstorm(contentPackage, designSystem, { imagePolicy: "balanced" }, { emit, aiApiService });
  assert.ok(Array.isArray(res.candidatesBySlide) && res.candidatesBySlide.length === 2);

  for (const row of res.candidatesBySlide) {
    assert.ok(Array.isArray(row.candidates));
    // Simplified flow: 1 candidate per slide (no multi-candidate + review)
    assert.ok(row.candidates.length >= 1);
    assert.ok(row.selectedCandidate);
  }

  assert.ok(Array.isArray(res.imageSlots));
  assert.ok(res.imageSlots.some((s) => s.renderType === "ai-image"));
  assert.ok(res.imageSlots.some((s) => s.renderType === "svg"));
  assert.ok(res.imageSlots.every((s) => typeof s.slotId === "string" && s.slotId.length > 0));

  assert.ok(events.some((e) => e.name === "design.brainstorm.started"));
  assert.ok(events.some((e) => e.name === "design.brainstorm.llm.generated"));
  // Review stage is skipped in simplified flow
  const candidatesEvt = events.find((e) => e.name === "design.brainstorm.candidates");
  assert.ok(candidatesEvt, "should emit design.brainstorm.candidates");
  assert.ok(Array.isArray(candidatesEvt.record?.payload?.candidatesBySlide));
  assert.ok(Array.isArray(candidatesEvt.record?.payload?.selectedIdeas));
  assert.ok(events.some((e) => e.name === "design.brainstorm.completed"));
});

test("Brainstorm v2: no aiApiService falls back to rule-based brainstorm + ImagePlanner", async () => {
  const { brainstorm } = await import("../../../js/agents/stages/design/brainstorm.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const contentPackage = makeContentPackage({ slideCount: 2 });
  const designSystem = { designTokens: { colors: { bg: "#fff", text: "#111", primary: "#0ea5e9" }, typography: { fontFamily: "Inter" } } };

  const res = await brainstorm(contentPackage, designSystem, { imagePolicy: "balanced" }, { emit });

  assert.ok(Array.isArray(res.ideaPool));
  assert.ok(Array.isArray(res.selectedIdeas));
  assert.ok(Array.isArray(res.imageSlots));
  assert.ok(res.imageSlots.length >= 1);
  assert.ok(res.imageSlots.some((s) => String(s.slotId).startsWith("img_s0_")));

  assert.ok(Array.isArray(res.candidatesBySlide) && res.candidatesBySlide.length === 2);
  assert.equal(res.candidatesBySlide[0].candidates.length, 2);
  assert.equal(res.candidatesBySlide[0].selectedCandidate.selected, true);

  assert.ok(events.some((e) => e.name === "design.brainstorm.started"));
  assert.ok(events.some((e) => e.name === "design.brainstorm.candidates"));
  assert.ok(events.some((e) => e.name === "design.brainstorm.completed"));
  assert.ok(!events.some((e) => e.name === "design.brainstorm.llm.generated"));
  assert.ok(!events.some((e) => e.name === "design.brainstorm.reviewed"));
});

test("Brainstorm v2: brainstormRegenerate regenerates one slide and keepOthers controls emitted candidatesBySlide", async () => {
  const { brainstorm, brainstormRegenerate } = await import("../../../js/agents/stages/design/brainstorm.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  let genCallCount = 0;

  const aiApiService = {
    chat: async ({ messages }) => {
      const user = String(messages?.[1]?.content || "");
      genCallCount++;

      // New simplified format: return slideResults with visualSlots directly
      const slideResults = [];
      if (user.includes('"slideIntentId": "s_cover"') || user.includes('"slideIntentId":"s_cover"')) {
        slideResults.push({
          slideIntentId: "s_cover",
          slideIndex: 0,
          visualSlots: [{ slotId: "s_cover_hero", renderType: "ai-image", position: { x: "10%", y: "10%", w: "80%", h: "45%" }, priority: "critical" }],
        });
      }
      if (user.includes('"slideIntentId": "s_overview"') || user.includes('"slideIntentId":"s_overview"')) {
        slideResults.push({
          slideIntentId: "s_overview",
          slideIndex: 1,
          visualSlots: [{ slotId: "s_overview_visual", renderType: "svg", position: { x: "10%", y: "50%", w: "80%", h: "40%" }, priority: "important" }],
        });
      }
      return { content: JSON.stringify({ slideResults }) };
    },
  };

  const contentPackage = makeContentPackage({ slideCount: 2 });
  const designSystem = {
    theme: "dark",
    designTokens: { colors: { bg: "#0f172a", text: "#f8fafc", primary: "#22d3ee" }, typography: { fontFamily: "Inter" } },
    visualPreference: { mode: "balanced" },
  };

  const initial = await brainstorm(contentPackage, designSystem, { imagePolicy: "balanced" }, { emit, aiApiService });
  const initialCallCount = genCallCount;
  assert.ok(initial.candidatesBySlide.length === 2);

  const regenRes = await brainstormRegenerate(
    "s_overview",
    { ...contentPackage, brainstormCandidates: { candidatesBySlide: initial.candidatesBySlide } },
    designSystem,
    { imagePolicy: "balanced" },
    { keepOthers: true, emit, aiApiService }
  );
  // Simplified flow: only 1 call for regenerate (no separate review)
  assert.ok(genCallCount > initialCallCount, "regenerate should call aiApiService");

  assert.equal(regenRes.slideIntentId, "s_overview");
  assert.ok(Array.isArray(regenRes.candidates) && regenRes.candidates.length >= 1);
  assert.ok(regenRes.selectedCandidate);
  assert.ok(Array.isArray(regenRes.imageSlots));

  const regenCandidatesEvt = events.filter((e) => e.name === "design.brainstorm.candidates").slice(-1)[0];
  assert.ok(regenCandidatesEvt);
  const bySlide = regenCandidatesEvt.record?.payload?.candidatesBySlide;
  assert.equal(bySlide.length, 2);
  assert.ok(bySlide.find((r) => r.slideIntentId === "s_cover"), "keepOthers=true should preserve other slides");

  await brainstormRegenerate(
    "s_overview",
    { ...contentPackage, brainstormCandidates: { candidatesBySlide: initial.candidatesBySlide } },
    designSystem,
    { imagePolicy: "balanced" },
    { keepOthers: false, emit, aiApiService }
  );
  const keepNoneEvt = events.filter((e) => e.name === "design.brainstorm.candidates").slice(-1)[0];
  assert.equal(keepNoneEvt.record?.payload?.candidatesBySlide.length, 1);
  assert.equal(keepNoneEvt.record?.payload?.candidatesBySlide[0]?.slideIntentId, "s_overview");
});

test("Brainstorm v2: source=user candidatesBySlide skips LLM generation and returns selected candidates", async () => {
  const { brainstorm } = await import("../../../js/agents/stages/design/brainstorm.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  let calls = 0;
  const aiApiService = {
    chat: async () => {
      calls += 1;
      throw new Error("LLM should not be called when source=user candidates exist");
    },
  };

  const contentPackage = makeContentPackage({ slideCount: 2 });
  const designSystem = {
    theme: "dark",
    designTokens: { colors: { bg: "#0f172a", text: "#f8fafc", primary: "#22d3ee" }, typography: { fontFamily: "Inter" } },
    visualPreference: { mode: "balanced" },
  };

  const candidatesBySlide = [
    {
      slideIndex: 0,
      slideIntentId: "s_cover",
      candidates: [
        { candidateId: "s_cover_a", elementsMarkdown: "- A", visualSlots: [] },
        {
          candidateId: "s_cover_b",
          elementsMarkdown: "- B",
          visualSlots: [
            {
              slotId: "s_cover_hero",
              slideIntentId: "s_cover",
              slideIndex: 0,
              renderType: "ai-image",
              position: { x: "10%", y: "10%", w: "80%", h: "45%" },
              imageSpec: { prompt: "Hero", style: "flat" },
              priority: "critical",
            },
          ],
        },
      ],
      selectedCandidateId: "s_cover_b",
      selectedCandidate: { candidateId: "s_cover_b", elementsMarkdown: "- B", visualSlots: [] },
    },
    {
      slideIndex: 1,
      slideIntentId: "s_overview",
      candidates: [
        {
          candidateId: "s_overview_a",
          elementsMarkdown: "- A",
          visualSlots: [
            {
              slotId: "s_overview_flow",
              slideIntentId: "s_overview",
              slideIndex: 1,
              renderType: "svg",
              position: { x: "10%", y: "80%", w: "80%", h: "10%" },
              svgSpec: { type: "flowchart", description: "Flow" },
              priority: "important",
            },
          ],
        },
        { candidateId: "s_overview_b", elementsMarkdown: "- B", visualSlots: [] },
      ],
      selectedCandidateId: "s_overview_a",
      selectedCandidate: { candidateId: "s_overview_a", elementsMarkdown: "- A", visualSlots: [] },
    },
  ];

  const res = await brainstorm(
    { ...contentPackage, brainstormCandidates: { schemaVersion: "0.1", candidatesBySlide, selectedIdeas: [], updatedAt: Date.now(), source: "user" } },
    designSystem,
    { imagePolicy: "balanced" },
    { emit, aiApiService }
  );

  assert.equal(calls, 0);
  assert.ok(Array.isArray(res.candidatesBySlide) && res.candidatesBySlide.length === 2);
  assert.ok(Array.isArray(res.selectedCandidates) && res.selectedCandidates.length === 2);
  assert.ok(res.candidatesBySlide.every((r) => r.selectedCandidate?.selected === true));
  assert.ok(Array.isArray(res.imageSlots));
  assert.ok(res.imageSlots.some((s) => s.slotId === "s_cover_hero"));
  assert.ok(res.imageSlots.some((s) => s.slotId === "s_overview_flow"));

  assert.ok(events.some((e) => e.name === "design.brainstorm.candidates" && e.record?.payload?.source === "user"));
  assert.ok(!events.some((e) => e.name === "design.brainstorm.llm.generated"));
  assert.ok(!events.some((e) => e.name === "design.brainstorm.reviewed"));
});

test("Brainstorm v2: composite score calculation and mapping helpers", async () => {
  const { __test, mapVisualSlotsToImageSlots } = await import("../../../js/agents/stages/design/brainstorm.js");

  assert.ok(Math.abs(__test.computeCompositeScore({ visualImpact: 1, clarity: 1, novelty: 1, consistency: 1 }) - 1) < 1e-9);
  assert.equal(__test.computeCompositeScore({ visualImpact: 0, clarity: 0, novelty: 0, consistency: 0 }), 0);

  const slideIntents = [{ slideIntentId: "s1", title: "T1", claimIds: ["c1"] }];
  const mapped = mapVisualSlotsToImageSlots(
    [
      {
        slotId: "hero_1",
        slideIntentId: "s1",
        slideIndex: 0,
        renderType: "ai-image",
        position: { x: "10%", y: "10%", w: "25%", h: "25%" },
        imageSpec: { prompt: "P", style: "flat" },
        priority: "critical",
      },
    ],
    slideIntents
  );

  assert.equal(mapped.length, 1);
  assert.equal(mapped[0].slotId, "hero_1");
  assert.equal(mapped[0].aspectRatio, "1:1");
  assert.equal(mapped[0].priority, "critical");
  assert.ok(Array.isArray(mapped[0].claimIds) && mapped[0].claimIds[0] === "c1");

  const extracted = __test.extractJsonCandidate("```json\n{ \"ok\": true }\n```");
  assert.equal(JSON.parse(extracted).ok, true);
});

test("design.brainstorm.candidates event payload includes totalIdeas and selectedCount", async () => {
  const { brainstorm } = await import("../../../js/agents/stages/design/brainstorm.js");

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const aiApiService = {
    chat: async ({ messages }) => {
      const user = String(messages?.[1]?.content || "");

      // New simplified format: return slideResults with visualSlots directly
      const slideResults = [];
      if (user.includes('"slideIntentId": "s_cover"') || user.includes('"slideIntentId":"s_cover"')) {
        slideResults.push({
          slideIntentId: "s_cover",
          slideIndex: 0,
          visualSlots: [{ slotId: "s_cover_hero", renderType: "ai-image", position: { x: "10%", y: "10%", w: "80%", h: "45%" }, priority: "critical" }],
        });
      }
      if (user.includes('"slideIntentId": "s_overview"') || user.includes('"slideIntentId":"s_overview"')) {
        slideResults.push({
          slideIntentId: "s_overview",
          slideIndex: 1,
          visualSlots: [{ slotId: "s_overview_visual", renderType: "svg", position: { x: "10%", y: "50%", w: "80%", h: "40%" }, priority: "important" }],
        });
      }
      return { content: JSON.stringify({ slideResults }) };
    },
  };

  const contentPackage = makeContentPackage({ slideCount: 2 });
  const designSystem = {
    theme: "light",
    designTokens: { colors: { bg: "#ffffff", text: "#111111", primary: "#0ea5e9" }, typography: { fontFamily: "Inter" } },
    visualPreference: { mode: "balanced" },
  };

  await brainstorm(contentPackage, designSystem, { imagePolicy: "balanced" }, { emit, aiApiService });

  const candidatesEvt = events.find((e) => e.name === "design.brainstorm.candidates");
  assert.ok(candidatesEvt, "should emit design.brainstorm.candidates");
  assert.equal(candidatesEvt.record?.actor, "design");
  assert.equal(candidatesEvt.record?.status, "data");
  assert.ok(typeof candidatesEvt.record?.payload?.totalIdeas === "number", "payload should have totalIdeas as number");
  // Simplified flow: 1 candidate per slide
  assert.ok(candidatesEvt.record?.payload?.totalIdeas >= 2, "totalIdeas should be at least 2 (2 slides * 1 candidate)");
  assert.ok(typeof candidatesEvt.record?.payload?.selectedCount === "number", "payload should have selectedCount as number");
  assert.equal(candidatesEvt.record?.payload?.selectedCount, 2, "selectedCount should match number of slides");
  assert.ok(Array.isArray(candidatesEvt.record?.payload?.candidatesBySlide), "payload should have candidatesBySlide array");
  assert.ok(Array.isArray(candidatesEvt.record?.payload?.selectedIdeas), "payload should have selectedIdeas array");
});
