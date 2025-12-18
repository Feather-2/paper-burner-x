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

      // Helper to generate candidates for a slide
      const makeCandidates = (slideIntentId) => [
        {
          candidateId: `${slideIntentId}_a`,
          atmosphere: { mood: "Futuristic", colorScheme: "Dark + cyan", visualWeight: "Right-heavy" },
          elementsMarkdown: `- {{IMAGE:${slideIntentId}_hero}}\n- Title + cards`,
          visualSlots: [
            {
              slotId: `${slideIntentId}_hero`,
              renderType: "ai-image",
              position: { x: "10%", y: "10%", w: "80%", h: "45%" },
              imageSpec: { prompt: "High impact hero visual", style: "3d" },
              priority: "critical",
            },
          ],
        },
        {
          candidateId: `${slideIntentId}_b`,
          atmosphere: { mood: "Minimal", colorScheme: "Light + accent", visualWeight: "Left-heavy" },
          elementsMarkdown: `- {{SVG:${slideIntentId}_flow}}\n- Clean grid`,
          visualSlots: [
            {
              slotId: `${slideIntentId}_flow`,
              renderType: "svg",
              position: { x: "10%", y: "80%", w: "80%", h: "10%" },
              svgSpec: { type: "flowchart", description: "Three nodes connected by arrows" },
              priority: "important",
            },
          ],
        },
      ];

      // Helper to generate reviews for a slide
      const makeReviews = (slideIntentId) => ({
        reviews: [
          { candidateId: `${slideIntentId}_a`, scores: { visualImpact: 0.9, clarity: 0.7, novelty: 0.6, consistency: 0.8 } },
          { candidateId: `${slideIntentId}_b`, scores: { visualImpact: 0.6, clarity: 0.9, novelty: 0.7, consistency: 0.8 } },
        ],
        selectedCandidateId: slideIntentId === "s_overview" ? `${slideIntentId}_b` : `${slideIntentId}_a`,
      });

      if (system.includes("Creative Director")) {
        // Batch format: return slideResults for all slides in the batch
        const slideResults = [];
        if (user.includes('"slideIntentId": "s_cover"')) {
          slideResults.push({ slideIntentId: "s_cover", slideIndex: 0, candidates: makeCandidates("s_cover") });
        }
        if (user.includes('"slideIntentId": "s_overview"')) {
          slideResults.push({ slideIntentId: "s_overview", slideIndex: 1, candidates: makeCandidates("s_overview") });
        }
        return { content: JSON.stringify({ slideResults }) };
      }

      if (system.includes("Art Director")) {
        // Batch format: return slideReviews for all slides in the batch
        const slideReviews = [];
        if (user.includes('"slideIntentId": "s_cover"')) {
          slideReviews.push({ slideIntentId: "s_cover", slideIndex: 0, ...makeReviews("s_cover") });
        }
        if (user.includes('"slideIntentId": "s_overview"')) {
          slideReviews.push({ slideIntentId: "s_overview", slideIndex: 1, ...makeReviews("s_overview") });
        }
        return { content: JSON.stringify({ slideReviews }) };
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
    assert.ok(row.candidates.length >= 2 && row.candidates.length <= 3);
    assert.ok(row.selectedCandidate && row.selectedCandidate.selected === true);
    assert.ok(typeof row.selectedCandidate.composite === "number");
    assert.ok(typeof row.selectedCandidate.scores?.visualImpact === "number");
  }

  assert.ok(Array.isArray(res.imageSlots));
  assert.ok(res.imageSlots.some((s) => s.renderType === "ai-image"));
  assert.ok(res.imageSlots.some((s) => s.renderType === "svg"));
  assert.ok(res.imageSlots.every((s) => typeof s.slotId === "string" && s.slotId.length > 0));
  assert.ok(res.imageSlots.find((s) => s.slotId === "s_cover_hero")?.aspectRatio === "16:9");

  assert.ok(events.some((e) => e.name === "design.brainstorm.started"));
  assert.ok(events.some((e) => e.name === "design.brainstorm.llm.generated"));
  assert.ok(events.some((e) => e.name === "design.brainstorm.reviewed"));
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

  const genCounts = new Map();
  const reviewCounts = new Map();

  const aiApiService = {
    chat: async ({ messages }) => {
      const system = String(messages?.[0]?.content || "");
      const user = String(messages?.[1]?.content || "");

      // Helper to generate candidates for a slide
      const makeCandidates = (slideIntentId, isRegen = false) => [
        {
          candidateId: `${slideIntentId}_${isRegen ? "r1" : "a"}`,
          atmosphere: { mood: "Futuristic", colorScheme: "Dark + cyan", visualWeight: "Right-heavy" },
          elementsMarkdown: `- {{IMAGE:${slideIntentId}_hero}}\n- Title + cards`,
          visualSlots: [
            {
              slotId: `${slideIntentId}_hero`,
              renderType: "ai-image",
              position: { x: "10%", y: "10%", w: "80%", h: "45%" },
              imageSpec: { prompt: "High impact hero visual", style: "3d" },
              priority: "critical",
            },
          ],
        },
        {
          candidateId: `${slideIntentId}_${isRegen ? "r2" : "b"}`,
          atmosphere: { mood: "Minimal", colorScheme: "Light + accent", visualWeight: "Left-heavy" },
          elementsMarkdown: `- Clean grid`,
          visualSlots: [],
        },
      ];

      // Helper to generate reviews for a slide
      const makeReviews = (slideIntentId, isRegen = false) => ({
        reviews: [
          { candidateId: `${slideIntentId}_${isRegen ? "r1" : "a"}`, scores: { visualImpact: 0.9, clarity: 0.7, novelty: 0.6, consistency: 0.8 } },
          { candidateId: `${slideIntentId}_${isRegen ? "r2" : "b"}`, scores: { visualImpact: 0.6, clarity: 0.9, novelty: 0.7, consistency: 0.8 } },
        ],
        selectedCandidateId: `${slideIntentId}_${isRegen ? "r1" : "a"}`,
      });

      if (system.includes("Creative Director")) {
        // Batch format for main brainstorm
        const slideResults = [];
        const hasCover = user.includes('"slideIntentId": "s_cover"');
        const hasOverview = user.includes('"slideIntentId": "s_overview"');

        if (hasCover) {
          const n = (genCounts.get("s_cover") || 0) + 1;
          genCounts.set("s_cover", n);
          slideResults.push({ slideIntentId: "s_cover", slideIndex: 0, candidates: makeCandidates("s_cover", false) });
        }
        if (hasOverview) {
          const n = (genCounts.get("s_overview") || 0) + 1;
          genCounts.set("s_overview", n);
          const isRegen = n > 1;
          slideResults.push({ slideIntentId: "s_overview", slideIndex: 1, candidates: makeCandidates("s_overview", isRegen) });
        }
        return { content: JSON.stringify({ slideResults }) };
      }

      if (system.includes("Art Director")) {
        // Batch format for review
        const slideReviews = [];
        const hasCover = user.includes('"slideIntentId": "s_cover"');
        const hasOverview = user.includes('"slideIntentId": "s_overview"');

        if (hasCover) {
          const n = (reviewCounts.get("s_cover") || 0) + 1;
          reviewCounts.set("s_cover", n);
          slideReviews.push({ slideIntentId: "s_cover", slideIndex: 0, ...makeReviews("s_cover", false) });
        }
        if (hasOverview) {
          const n = (reviewCounts.get("s_overview") || 0) + 1;
          reviewCounts.set("s_overview", n);
          const isRegen = n > 1;
          slideReviews.push({ slideIntentId: "s_overview", slideIndex: 1, ...makeReviews("s_overview", isRegen) });
        }
        return { content: JSON.stringify({ slideReviews }) };
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

  const initial = await brainstorm(contentPackage, designSystem, { imagePolicy: "balanced" }, { emit, aiApiService });
  const baseCoverSelected = initial.candidatesBySlide.find((r) => r.slideIntentId === "s_cover")?.selectedCandidate?.candidateId;
  assert.equal(baseCoverSelected, "s_cover_a");

  const beforeCalls = [...genCounts.values()].reduce((a, b) => a + b, 0) + [...reviewCounts.values()].reduce((a, b) => a + b, 0);
  const regenRes = await brainstormRegenerate(
    "s_overview",
    { ...contentPackage, brainstormCandidates: { candidatesBySlide: initial.candidatesBySlide } },
    designSystem,
    { imagePolicy: "balanced" },
    { keepOthers: true, emit, aiApiService }
  );
  const afterCalls = [...genCounts.values()].reduce((a, b) => a + b, 0) + [...reviewCounts.values()].reduce((a, b) => a + b, 0);
  assert.equal(afterCalls - beforeCalls, 2, "regenerate should call aiApiService twice (generate+review) for one slide");

  assert.equal(regenRes.slideIntentId, "s_overview");
  assert.ok(Array.isArray(regenRes.candidates) && regenRes.candidates.length >= 2);
  assert.equal(regenRes.selectedCandidate?.candidateId, "s_overview_r1");
  assert.ok(Array.isArray(regenRes.visualSlots));
  assert.ok(Array.isArray(regenRes.imageSlots));
  assert.ok(regenRes.imageSlots.some((s) => s.slotId === "s_overview_hero"));

  const regenCandidatesEvt = events.filter((e) => e.name === "design.brainstorm.candidates").slice(-1)[0];
  assert.ok(regenCandidatesEvt);
  assert.equal(regenCandidatesEvt.record?.status, "data");
  const bySlide = regenCandidatesEvt.record?.payload?.candidatesBySlide;
  assert.equal(bySlide.length, 2);
  const coverRow = bySlide.find((r) => r.slideIntentId === "s_cover");
  assert.equal(coverRow?.selectedCandidate?.candidateId, "s_cover_a", "keepOthers=true should preserve other slides");

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
      const system = String(messages?.[0]?.content || "");
      const user = String(messages?.[1]?.content || "");
      const slideIntentId = user.includes('"slideIntentId": "s_cover"') ? "s_cover" : "s_overview";

      if (system.includes("Creative Director")) {
        return {
          content: JSON.stringify({
            candidates: [
              {
                candidateId: `${slideIntentId}_a`,
                atmosphere: { mood: "Modern", colorScheme: "Blue", visualWeight: "Balanced" },
                elementsMarkdown: `- {{IMAGE:${slideIntentId}_hero}}\n- Title`,
                visualSlots: [
                  {
                    slotId: `${slideIntentId}_hero`,
                    renderType: "ai-image",
                    position: { x: "10%", y: "10%", w: "80%", h: "45%" },
                    imageSpec: { prompt: "Hero visual", style: "flat" },
                    priority: "critical",
                  },
                ],
              },
              {
                candidateId: `${slideIntentId}_b`,
                atmosphere: { mood: "Minimal", colorScheme: "Light", visualWeight: "Left-heavy" },
                elementsMarkdown: `- Clean layout`,
                visualSlots: [],
              },
            ],
          }),
        };
      }

      if (system.includes("Art Director")) {
        const pick = `${slideIntentId}_a`;
        return {
          content: JSON.stringify({
            reviews: [
              { candidateId: `${slideIntentId}_a`, scores: { visualImpact: 0.9, clarity: 0.8, novelty: 0.7, consistency: 0.85 } },
              { candidateId: `${slideIntentId}_b`, scores: { visualImpact: 0.6, clarity: 0.9, novelty: 0.5, consistency: 0.8 } },
            ],
            selectedCandidateId: pick,
          }),
        };
      }

      throw new Error("Unexpected prompt");
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
  assert.ok(candidatesEvt.record?.payload?.totalIdeas >= 4, "totalIdeas should be at least 4 (2 slides * 2 candidates)");
  assert.ok(typeof candidatesEvt.record?.payload?.selectedCount === "number", "payload should have selectedCount as number");
  assert.equal(candidatesEvt.record?.payload?.selectedCount, 2, "selectedCount should match number of slides");
  assert.ok(Array.isArray(candidatesEvt.record?.payload?.candidatesBySlide), "payload should have candidatesBySlide array");
  assert.ok(Array.isArray(candidatesEvt.record?.payload?.selectedIdeas), "payload should have selectedIdeas array");
});
