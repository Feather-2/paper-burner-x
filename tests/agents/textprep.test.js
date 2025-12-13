const test = require("node:test");
const assert = require("node:assert/strict");

test("TextPrep TP1: normalizeText newline/NBSP + sha256 stability", async () => {
  const { normalizeText } = await import("../../js/agents/stages/textprep/normalize.js");

  const a = normalizeText("A\r\nB\rC\u00A0D\n");
  const b = normalizeText("A\nB\nC D\n");

  assert.equal(a.normalized, "A\nB\nC D\n");
  assert.equal(b.normalized, "A\nB\nC D\n");
  assert.equal(a.textHash, b.textHash);

  assert.equal(a.textHash.startsWith("sha256:"), true);
  assert.ok(a.normalization && a.normalization.profile === "v0");
  assert.ok(a.normalization.ops.includes("newline_to_lf"));
  assert.ok(a.normalization.ops.includes("nbsp_to_space"));

  // Known SHA-256 test vector.
  const v = normalizeText("abc");
  assert.equal(v.textHash, "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  // No-op path is stable too.
  const c = normalizeText("plain\ntext");
  assert.equal(c.normalized, "plain\ntext");
  assert.deepEqual(c.normalization.ops, []);
});

test("TextPrep TP2: chunkText overlap/locator boundaries + line numbers", async () => {
  const { chunkText } = await import("../../js/agents/stages/textprep/chunk.js");

  {
    const chunks = chunkText("0123456789", { chunkSize: 4, overlap: 1, includeLineNumbers: false });
    assert.equal(chunks.length, 3);

    assert.deepEqual(
      chunks.map((c) => [c.locator.charStart, c.locator.charEnd, c.text]),
      [
        [0, 4, "0123"],
        [3, 7, "3456"],
        [6, 10, "6789"],
      ]
    );
    assert.equal(chunks[0].locator.charEnd, chunks[1].locator.charStart + 1); // overlap=1
  }

  {
    const text = "a\nb\nc\nd";
    const chunks = chunkText(text, { chunkSize: 4, overlap: 0, includeLineNumbers: true });
    assert.equal(chunks.length, 2);
    assert.deepEqual(chunks[0], { chunkId: "chunk_1", text: "a\nb\n", locator: { charStart: 0, charEnd: 4, lineStart: 1, lineEnd: 2 } });
    assert.deepEqual(chunks[1], { chunkId: "chunk_2", text: "c\nd", locator: { charStart: 4, charEnd: 7, lineStart: 3, lineEnd: 4 } });
  }

  {
    assert.throws(() => chunkText("hello", { chunkSize: 4, overlap: 4 }), /overlap must be < chunkSize/);
  }

  {
    assert.deepEqual(chunkText("", { chunkSize: 4, overlap: 0 }), []);
  }
});

test("TextPrep TP4: planSlides parses LLM JSON and ensures core slides", async () => {
  const { planSlides } = await import("../../js/agents/stages/textprep/slideplan.js");
  const { chunkText } = await import("../../js/agents/stages/textprep/chunk.js");

  const chunks = chunkText("My Topic\nShort summary.\nBody paragraph.\n", { chunkSize: 20, overlap: 0 });
  const calls = [];
  const aiApiService = {
    chat: async (opts) => {
      calls.push(opts);
      return {
        content: JSON.stringify([
          { pageType: "overview", title: "Overview" },
          { pageType: "comparison", title: "Compare", keyPoints: ["A vs B"] },
          { pageType: "not_a_real_type", title: "Bad Type" },
        ]),
      };
    },
  };

  const intents = await planSlides(chunks, { __services: { aiApiService }, pageCount: 6 });
  assert.equal(calls.length, 1);

  assert.ok(intents.length >= 4);
  assert.ok(intents.some((s) => s.pageType === "cover"));
  assert.ok(intents.some((s) => s.pageType === "agenda"));
  assert.ok(intents.some((s) => s.pageType === "overview"));
  assert.ok(intents.some((s) => s.pageType === "summary"));

  // Allowed pageType only.
  for (const s of intents) assert.match(s.pageType, /^(cover|agenda|overview|comparison|process|summary|appendix)$/);
});

test("TextPrep TP4: planSlides falls back when LLM output invalid", async () => {
  const { planSlides } = await import("../../js/agents/stages/textprep/slideplan.js");
  const { chunkText } = await import("../../js/agents/stages/textprep/chunk.js");

  const chunks = chunkText("Topic\nBody.\n", { chunkSize: 20, overlap: 0 });
  const aiApiService = { chat: async () => ({ content: "not json" }) };
  const intents = await planSlides(chunks, { __services: { aiApiService }, pageCount: 5 });
  assert.ok(intents.length >= 4);
  assert.ok(intents.some((s) => s.pageType === "cover"));
  assert.ok(intents.some((s) => s.pageType === "summary"));
});

test("TextPrep TP5: extractClaims enforces evidence linkage + quote locatable", async () => {
  const { normalizeText } = await import("../../js/agents/stages/textprep/normalize.js");
  const { chunkText } = await import("../../js/agents/stages/textprep/chunk.js");
  const { extractClaims } = await import("../../js/agents/stages/textprep/claims.js");

  const raw = "Alpha is first.\nBeta is second.\nGamma is third.\n";
  const norm = normalizeText(raw);
  const chunks = chunkText(norm.normalized, { chunkSize: 20, overlap: 0, includeLineNumbers: true });
  const slideIntents = [
    { slideIntentId: "s_cover", pageType: "cover", title: "Cover" },
    { slideIntentId: "s_overview", pageType: "overview", title: "Overview" },
    { slideIntentId: "s_summary", pageType: "summary", title: "Summary" },
  ];

  const { claims, evidenceLedger } = extractClaims(chunks, slideIntents, { sourceId: "user_text", sourceTextNormalized: norm.normalized, maxQuoteLen: 60 });
  assert.ok(claims.length >= 1);
  assert.ok(evidenceLedger.length >= 1);

  const evidenceById = new Map(evidenceLedger.map((e) => [e.evidenceId, e]));
  for (const c of claims) {
    assert.ok(Array.isArray(c.evidenceIds) && c.evidenceIds.length >= 1);
    for (const eid of c.evidenceIds) assert.ok(evidenceById.has(eid));
  }

  for (const e of evidenceLedger) {
    assert.equal(e.sourceId, "user_text");
    assert.ok(typeof e.locator?.charStart === "number" && typeof e.locator?.charEnd === "number");
    assert.ok(e.locator.charStart < e.locator.charEnd);
    const slice = norm.normalized.slice(e.locator.charStart, e.locator.charEnd);
    assert.ok(slice.includes(e.quote));
  }
});

test("TextPrep TP6: buildContentPackage validates hard gates (H1-H4)", async () => {
  const { buildContentPackage } = await import("../../js/agents/stages/textprep/build-content-package.js");

  const runContext = { runId: "run_test", constraints: { pageCount: 5 } };
  const sources = [
    {
      sourceId: "user_text",
      kind: "user_text",
      title: "User Input",
      textHash: "sha256:deadbeef",
      sourceTextNormalized: "Alpha beta gamma delta",
    },
  ];
  const slideIntents = [{ slideIntentId: "s1", pageType: "overview", title: "Overview", claimIds: ["c1"] }];
  const claims = [{ claimId: "c1", text: "Alpha beta", evidenceIds: ["e1"] }];
  const evidenceLedger = [{ evidenceId: "e1", sourceId: "user_text", locator: { charStart: 0, charEnd: 10 }, quote: "Alpha beta" }];

  const pkg = buildContentPackage(runContext, sources, slideIntents, claims, evidenceLedger, []);
  assert.equal(pkg.schemaVersion, "0.1");
  assert.equal(pkg.mode, "textprep");
  assert.equal(pkg.runId, "run_test");
  assert.ok(Array.isArray(pkg.sources) && pkg.sources.length === 1);
  assert.equal(pkg.sources[0].sourceId, "user_text");
  assert.equal(pkg.sources[0].kind, "user_text");
  assert.equal(pkg.sources[0].textHash, "sha256:deadbeef");
  assert.ok(typeof pkg.summary === "string" && pkg.summary.length > 0);

  assert.throws(
    () =>
      buildContentPackage(
        runContext,
        sources,
        [{ slideIntentId: "s1", pageType: "overview", title: "Overview", claimIds: ["c404"] }],
        claims,
        evidenceLedger,
        []
      ),
    /Unresolvable claimId reference/
  );
});

test("TextPrep E2E: TextPrepStage produces a valid ContentPackage and emits progress", async () => {
  const { RunContext } = await import("../../js/agents/runtime/run-context.js");
  const { TextPrepStage } = await import("../../js/agents/stages/textprep/index.js");
  const { normalizeText } = await import("../../js/agents/stages/textprep/normalize.js");

  const makeText = (n) => {
    const para = "This is a paragraph about a topic. It contains several sentences for claim extraction.\n";
    let out = "";
    while (out.length < n) out += para;
    return out.slice(0, n);
  };

  const stage = new TextPrepStage({ defaultChunkOptions: { chunkSize: 800, overlap: 120, includeLineNumbers: true } });

  const events = [];
  const emit = (name, record) => events.push({ name, record });

  const aiApiService = {
    chat: async ({ messages }) => {
      const sys = messages?.[0]?.content || "";
      if (String(sys).includes("slide planner")) {
        return { content: JSON.stringify([{ pageType: "overview", title: "Overview" }]) };
      }
      if (String(sys).includes("claim-to-slide aligner")) {
        return {
          content: JSON.stringify([
            { slideIntentId: "s_overview", claimIds: ["c1", "c404"] }, // c404 should be filtered out
            { slideIntentId: "s_summary", claimIds: ["c1"] },
          ]),
        };
      }
      return { content: "[]" };
    },
  };

  for (const size of [2000, 10000]) {
    const ctx = new RunContext({ mode: "textprep", constraints: { pageCount: 7 } });
    const raw = makeText(size);
    const pkg = await stage.run(raw, { runContext: ctx, aiApiService, emit });
    const normalized = normalizeText(raw).normalized;

    assert.equal(pkg.schemaVersion, "0.1");
    assert.equal(pkg.mode, "textprep");
    assert.equal(pkg.runId, ctx.runId);
    assert.ok(Array.isArray(pkg.sources) && pkg.sources.length === 1);
    assert.ok(typeof pkg.sources[0].textHash === "string" && pkg.sources[0].textHash.startsWith("sha256:"));

    assert.ok(typeof pkg.summary === "string" && pkg.summary.length > 0);
    assert.ok(Array.isArray(pkg.slideIntents) && pkg.slideIntents.length >= 4);
    assert.ok(Array.isArray(pkg.claims) && pkg.claims.length >= 1);
    assert.ok(Array.isArray(pkg.evidenceLedger) && pkg.evidenceLedger.length >= 1);

    // Reference integrity: claimIds/evidenceIds resolvable, evidence quote locatable.
    const evidenceById = new Map(pkg.evidenceLedger.map((e) => [e.evidenceId, e]));
    for (const c of pkg.claims) {
      assert.ok(c.evidenceIds.length >= 1);
      for (const eid of c.evidenceIds) assert.ok(evidenceById.has(eid));
    }
    // Evidence slice contains quote.
    for (const e of pkg.evidenceLedger) {
      assert.ok(typeof e.quote === "string" && e.quote.length > 0);
      assert.ok(e.locator.charStart < e.locator.charEnd);
      const slice = normalized.slice(e.locator.charStart, e.locator.charEnd);
      assert.ok(slice.includes(e.quote));
    }

    // Events are emitted for each step.
    assert.ok(events.some((ev) => ev.name === "textprep.normalize.completed"));
    assert.ok(events.some((ev) => ev.name === "textprep.chunk.completed"));
    assert.ok(events.some((ev) => ev.name === "textprep.slideplan.completed"));
    assert.ok(events.some((ev) => ev.name === "textprep.claims.completed"));
    assert.ok(events.some((ev) => ev.name === "textprep.align.completed"));
  }
});

test("TextPrep Stage: cancellation via AbortSignal stops execution", async () => {
  const { TextPrepStage } = await import("../../js/agents/stages/textprep/index.js");

  const stage = new TextPrepStage();
  const ac = new AbortController();
  ac.abort("stop");

  await assert.rejects(() => stage.execute({ runId: "run_test", constraints: {} }, "Hello", { signal: ac.signal }), /stop|cancel/i);
});
