const test = require("node:test");
const assert = require("node:assert/strict");

test("DeepSearch S4: toc-builder extracts multi-level headings + boundaries", async () => {
  const { buildToc } = await import("../../js/agents/retrieval/toc-builder.js");

  const text = [
    "# Alpha",
    "",
    "Intro paragraph.",
    "## Beta",
    "Beta content line 1.",
    "### Beta Detail",
    "detail",
    "## Gamma",
    "Gamma content.",
    "# Delta",
    "delta content",
    "1. Numbered One",
    "1.2 Numbered Two",
    "ALL CAPS HEADING",
    "tail",
    "",
  ].join("\n");

  const { tocNodes, fallbackSections } = buildToc(text);
  assert.equal(fallbackSections.length, 0);
  assert.ok(tocNodes.length >= 7);

  const alpha = tocNodes[0];
  const beta = tocNodes.find((n) => n.title === "Beta");
  const betaDetail = tocNodes.find((n) => n.title === "Beta Detail");
  const gamma = tocNodes.find((n) => n.title === "Gamma");
  const delta = tocNodes.find((n) => n.title === "Delta");
  const numberedOne = tocNodes.find((n) => n.title === "Numbered One");
  const numberedTwo = tocNodes.find((n) => n.title === "Numbered Two");
  const caps = tocNodes.find((n) => n.title === "ALL CAPS HEADING");

  assert.equal(alpha.level, 1);
  assert.equal(beta.level, 2);
  assert.equal(betaDetail.level, 3);
  assert.equal(gamma.level, 2);
  assert.equal(delta.level, 1);
  assert.equal(numberedOne.level, 1);
  assert.equal(numberedTwo.level, 2);
  assert.equal(caps.level, 1);

  const alphaStart = text.indexOf("# Alpha");
  const deltaStart = text.indexOf("# Delta");
  assert.equal(alpha.locator.charStart, alphaStart);
  assert.equal(alpha.locator.charEnd, deltaStart); // next level<=1 heading is Delta

  const gammaStart = text.indexOf("## Gamma");
  assert.equal(beta.locator.charEnd, text.indexOf("## Gamma")); // next level<=2 is Gamma
  assert.equal(betaDetail.locator.charEnd, gammaStart); // next level<=3 is Gamma (level 2)

  assert.equal(delta.locator.charEnd > delta.locator.charStart, true);
});

test("DeepSearch S4: toc-builder ignores code-fence headings + has fallbackSections", async () => {
  const { buildToc } = await import("../../js/agents/retrieval/toc-builder.js");

  const fenced = ["```", "# Not A Heading", "```", "", "Just text.", ""].join("\n");
  const a = buildToc(fenced);
  assert.equal(a.tocNodes.length, 0);
  assert.ok(a.fallbackSections.length >= 1);

  const b = buildToc("no headings here\nstill none\n");
  assert.equal(b.tocNodes.length, 0);
  assert.ok(b.fallbackSections.length >= 1);
});

test("DeepSearch S4: scope selection and chunk filtering", async () => {
  const { buildToc } = await import("../../js/agents/retrieval/toc-builder.js");
  const { selectScope, chunksInScope } = await import("../../js/agents/retrieval/scope.js");
  const { chunkText } = await import("../../js/agents/stages/textprep/chunk.js");

  const text = ["# A", "aaa aaa", "## B", "bbb bbb", "## C", "ccc ccc", "# D", "ddd ddd", ""].join("\n");
  const { tocNodes } = buildToc(text);
  assert.ok(tocNodes.length >= 4);

  const bNode = tocNodes.find((n) => n.title === "B");
  const scope = selectScope(tocNodes, bNode.tocNodeId);
  assert.equal(scope.charStart, text.indexOf("## B"));
  assert.equal(scope.charEnd, text.indexOf("## C"));

  const chunks = chunkText(text, { chunkSize: 10, overlap: 0 });
  const inScope = chunksInScope(chunks, scope);
  assert.ok(inScope.length >= 1);
  for (const c of inScope) {
    assert.equal(c.locator.charEnd > scope.charStart, true);
    assert.equal(c.locator.charStart < scope.charEnd, true);
  }
});

test("DeepSearch S4: bm25 ranks relevant chunks + filters stopwords", async () => {
  const { buildIndex, search } = await import("../../js/agents/retrieval/bm25.js");

  const chunks = [
    { chunkId: "c1", text: "apple banana banana" },
    { chunkId: "c2", text: "banana carrot" },
    { chunkId: "c3", text: "durian eggfruit" },
  ];
  const idx = buildIndex(chunks);
  const r1 = search(idx, "banana", 3);
  assert.equal(r1[0].chunkId, "c1");
  assert.ok(r1[0].score > r1[1].score);

  const r2 = search(idx, "the and of", 3);
  assert.deepEqual(r2, []);
});

test("DeepSearch S4: grep supports literal + regex matching", async () => {
  const { grepChunks } = await import("../../js/agents/retrieval/grep.js");

  const chunks = [
    { chunkId: "c1", text: "Hello world\nHELLO again\n" },
    { chunkId: "c2", text: "nothing here\n" },
  ];

  const lit = grepChunks(chunks, "hello", { caseSensitive: false });
  assert.equal(lit.length, 1);
  assert.equal(lit[0].chunkId, "c1");
  assert.equal(lit[0].matchCount >= 2, true);

  const re = grepChunks(chunks, /h.llo/gi, { regex: true });
  assert.equal(re.length, 1);
  assert.equal(re[0].chunkId, "c1");
  assert.equal(re[0].matchCount >= 2, true);
});

test("DeepSearch S4: readAround expands hit windows and preserves order", async () => {
  const { readAround } = await import("../../js/agents/retrieval/readaround.js");

  const all = [
    { chunkId: "c1" },
    { chunkId: "c2" },
    { chunkId: "c3" },
    { chunkId: "c4" },
    { chunkId: "c5" },
  ];

  assert.deepEqual(
    readAround(all, ["c3"], 1).map((c) => c.chunkId),
    ["c2", "c3", "c4"]
  );

  assert.deepEqual(
    readAround(all, ["c2", "c4"], 1).map((c) => c.chunkId),
    ["c1", "c2", "c3", "c4", "c5"]
  );
});

test("DeepSearch S4: retrieval-router full pipeline (scope -> search -> readAround)", async () => {
  const { buildToc } = await import("../../js/agents/retrieval/toc-builder.js");
  const { retrieve } = await import("../../js/agents/retrieval/retrieval-router.js");
  const { chunkText } = await import("../../js/agents/stages/textprep/chunk.js");

  const text = [
    "# Intro",
    "This section mentions zebras once.",
    "",
    "## Methods",
    "We use BM25 ranking for search. BM25 is term-based.",
    "",
    "## Results",
    "Grep search can find literal terms quickly.",
    "",
    "# Appendix",
    "Extra details.",
    "",
  ].join("\n");

  const toc = buildToc(text).tocNodes;
  const methodsId = toc.find((n) => n.title === "Methods").tocNodeId;

  const chunks = chunkText(text, { chunkSize: 80, overlap: 0 });
  const sourceIndex = { sourceId: "doc_1", fullText: text, toc, chunks };

  const retrieved = retrieve(sourceIndex, [{ gapId: "g1", query: "BM25 ranking", targetSectionId: methodsId }], { topK: 3, windowSize: 1 });
  assert.ok(retrieved.length >= 1);
  assert.ok(retrieved.every((c) => c.sourceId === "doc_1"));
  assert.ok(retrieved.some((c) => c.relevance === "hit" && typeof c.score === "number"));
  assert.ok(retrieved.some((c) => c.relevance === "context"));

  // Ensure all returned chunks fall within the chosen section window (after readAround expansion, they may cross by 1 chunk).
  const methodsNode = toc.find((n) => n.tocNodeId === methodsId);
  const methodsStart = methodsNode.locator.charStart;
  const methodsEnd = methodsNode.locator.charEnd;
  const expandedMax = 1;
  const docStart = Math.max(0, methodsStart - expandedMax * 80);
  const docEnd = Math.min(text.length, methodsEnd + expandedMax * 80);
  for (const c of retrieved) {
    assert.equal(c.locator.charStart < docEnd, true);
    assert.equal(c.locator.charEnd > docStart, true);
  }
});

test("DeepSearch S4: performance baseline 10k lines <500ms", async () => {
  const { retrieve } = await import("../../js/agents/retrieval/retrieval-router.js");
  const { chunkText } = await import("../../js/agents/stages/textprep/chunk.js");

  const lines = [];
  lines.push("# Big Doc");
  lines.push("## Section");
  for (let i = 0; i < 10000; i++) lines.push(`Line ${i}: alpha beta gamma delta epsilon`);
  const text = lines.join("\n") + "\n";

  const chunks = chunkText(text, { chunkSize: 2000, overlap: 0 });
  const sourceIndex = { sourceId: "big", fullText: text, chunks, toc: [] }; // toc built on-demand

  const t0 = process.hrtime.bigint();
  const out = retrieve(sourceIndex, [{ query: "gamma delta" }], { topK: 5, windowSize: 1 });
  const t1 = process.hrtime.bigint();
  const ms = Number(t1 - t0) / 1e6;

  assert.ok(out.length > 0);
  assert.ok(ms < 500, `expected <500ms, got ${ms.toFixed(1)}ms`);
});

