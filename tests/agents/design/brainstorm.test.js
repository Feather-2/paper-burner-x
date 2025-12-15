const test = require("node:test");
const assert = require("node:assert/strict");

test("Brainstorm: createIdea creates valid idea object", async () => {
  const { __test } = await import("../../../js/agents/stages/design/brainstorm.js");
  const { createIdea } = __test;

  const idea = createIdea({
    ideaId: "test_1",
    slideIntentId: "s1",
    conceptType: "metaphor",
    description: "Test idea",
    novelty: 0.7,
    relevance: 0.8,
    risk: 0.2,
    exportFriendly: 0.9,
  });

  assert.equal(idea.ideaId, "test_1");
  assert.equal(idea.slideIntentId, "s1");
  assert.equal(idea.conceptType, "metaphor");
  assert.equal(idea.description, "Test idea");
  assert.equal(idea.scores.novelty, 0.7);
  assert.equal(idea.scores.relevance, 0.8);
  assert.equal(idea.scores.risk, 0.2);
  assert.equal(idea.scores.exportFriendly, 0.9);
  assert.equal(idea.selected, false);
  assert.ok(idea.createdAt);
});

test("Brainstorm: createIdea normalizes out-of-range scores", async () => {
  const { __test } = await import("../../../js/agents/stages/design/brainstorm.js");
  const { createIdea } = __test;

  const idea = createIdea({
    novelty: 1.5,      // > 1 clamps to 1
    relevance: -0.5,   // < 0 clamps to 0
    risk: 2.0,         // > 1 clamps to 1
    exportFriendly: -1, // < 0 clamps to 0
  });

  assert.equal(idea.scores.novelty, 1);
  assert.equal(idea.scores.relevance, 0);
  assert.equal(idea.scores.risk, 1);
  assert.equal(idea.scores.exportFriendly, 0);
});

test("Brainstorm: createIdea defaults invalid conceptType to metaphor", async () => {
  const { __test } = await import("../../../js/agents/stages/design/brainstorm.js");
  const { createIdea } = __test;

  const idea = createIdea({ conceptType: "invalid_type" });
  assert.equal(idea.conceptType, "metaphor");
});

test("Brainstorm: compositeScore calculates correctly", async () => {
  const { __test } = await import("../../../js/agents/stages/design/brainstorm.js");
  const { compositeScore, createIdea } = __test;

  const highScore = createIdea({ novelty: 1, relevance: 1, risk: 0, exportFriendly: 1 });
  const lowScore = createIdea({ novelty: 0, relevance: 0, risk: 1, exportFriendly: 0 });

  const high = compositeScore(highScore);
  const low = compositeScore(lowScore);

  assert.ok(high > low);
  assert.ok(high > 0.8);
  assert.ok(low < 0.2);
});

test("Brainstorm: generateDefaultIdeas creates ideas for cover page", async () => {
  const { __test } = await import("../../../js/agents/stages/design/brainstorm.js");
  const { generateDefaultIdeas } = __test;

  const slideIntent = {
    slideIntentId: "cover_1",
    pageType: "cover",
    title: "Test Presentation",
  };

  const ideas = generateDefaultIdeas(slideIntent, {});
  assert.ok(ideas.length >= 2);
  assert.ok(ideas.every((i) => i.slideIntentId === "cover_1"));
});

test("Brainstorm: generateDefaultIdeas creates ideas for agenda page", async () => {
  const { __test } = await import("../../../js/agents/stages/design/brainstorm.js");
  const { generateDefaultIdeas } = __test;

  const slideIntent = {
    slideIntentId: "agenda_1",
    pageType: "agenda",
    keyPoints: ["Point 1", "Point 2", "Point 3"],
  };

  const ideas = generateDefaultIdeas(slideIntent, {});
  assert.ok(ideas.length >= 2);
  assert.ok(ideas.some((i) => i.conceptType === "icon_set"));
});

test("Brainstorm: rankIdeas returns top N ideas sorted by score", async () => {
  const { __test } = await import("../../../js/agents/stages/design/brainstorm.js");
  const { rankIdeas, createIdea, compositeScore } = __test;

  const ideas = [
    createIdea({ ideaId: "low", novelty: 0.2, relevance: 0.2, risk: 0.8, exportFriendly: 0.2 }),
    createIdea({ ideaId: "high", novelty: 0.9, relevance: 0.9, risk: 0.1, exportFriendly: 0.9 }),
    createIdea({ ideaId: "mid", novelty: 0.5, relevance: 0.5, risk: 0.5, exportFriendly: 0.5 }),
  ];

  const top2 = rankIdeas(ideas, 2);
  assert.equal(top2.length, 2);
  assert.equal(top2[0].ideaId, "high");
  assert.equal(top2[1].ideaId, "mid");
});

test("Brainstorm: selectIdeasForSlides marks selected ideas", async () => {
  const { __test } = await import("../../../js/agents/stages/design/brainstorm.js");
  const { selectIdeasForSlides, createIdea } = __test;

  const ideas = [
    createIdea({ ideaId: "s1_a", slideIntentId: "s1", novelty: 0.9, relevance: 0.9 }),
    createIdea({ ideaId: "s1_b", slideIntentId: "s1", novelty: 0.5, relevance: 0.5 }),
    createIdea({ ideaId: "s1_c", slideIntentId: "s1", novelty: 0.2, relevance: 0.2 }),
    createIdea({ ideaId: "s2_a", slideIntentId: "s2", novelty: 0.8, relevance: 0.8 }),
  ];

  const selected = selectIdeasForSlides(ideas, 2);
  assert.equal(selected.length, 3); // 2 from s1 + 1 from s2
  assert.ok(selected.every((i) => i.selected === true));
  assert.ok(selected.some((i) => i.ideaId === "s1_a"));
  assert.ok(selected.some((i) => i.ideaId === "s2_a"));
});

test("Brainstorm: brainstorm function returns ideaPool and imageSlots", async () => {
  const { brainstorm } = await import("../../../js/agents/stages/design/brainstorm.js");

  const contentPackage = {
    slideIntents: [
      { slideIntentId: "s1", pageType: "cover", title: "Test" },
      { slideIntentId: "s2", pageType: "agenda" },
      { slideIntentId: "s3", pageType: "comparison" },
    ],
  };

  const designSystem = { designTokens: { colors: {} } };
  const constraints = { imagePolicy: "balanced" };

  const events = [];
  const emit = (name, data) => events.push({ name, data });

  const result = await brainstorm(contentPackage, designSystem, constraints, { emit });

  assert.ok(Array.isArray(result.ideaPool));
  assert.ok(Array.isArray(result.selectedIdeas));
  assert.ok(Array.isArray(result.imageSlots));
  assert.ok(result.ideaPool.length > 0);
  assert.ok(result.selectedIdeas.length > 0);
  assert.ok(events.some((e) => e.name === "design.brainstorm.started"));
  assert.ok(events.some((e) => e.name === "design.brainstorm.completed"));
});

test("Brainstorm: IdeaPool class manages ideas", async () => {
  const { IdeaPool, __test } = await import("../../../js/agents/stages/design/brainstorm.js");
  const { createIdea } = __test;

  const pool = new IdeaPool();
  pool.add(createIdea({ ideaId: "a", slideIntentId: "s1", conceptType: "metaphor" }));
  pool.add(createIdea({ ideaId: "b", slideIntentId: "s1", conceptType: "icon_set" }));
  pool.add(createIdea({ ideaId: "c", slideIntentId: "s2", conceptType: "metaphor", selected: true }));

  assert.equal(pool.getBySlide("s1").length, 2);
  assert.equal(pool.getBySlide("s2").length, 1);
  assert.equal(pool.getByConceptType("metaphor").length, 2);
  assert.equal(pool.getSelected().length, 0); // selected is set by createIdea to false by default

  // Test JSON serialization
  const json = pool.toJSON();
  const restored = IdeaPool.fromJSON(json);
  assert.equal(restored.ideas.length, 3);
});
