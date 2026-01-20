import { describe, it, expect, beforeEach, afterEach } from "vitest";

const test = require("node:test");
const assert = require("node:assert/strict");

it("TextPrep TP1: normalizeText newline/NBSP + sha256 stability", async () => {
  const { normalizeText } = await import("../../../js/agents/stages/textprep/normalize.js");

  const a = normalizeText("A\r\nB\rC\u00A0D\n");
  const b = normalizeText("A\nB\nC D\n");

  expect(a.normalized).toBe("A\nB\nC D\n");
  expect(b.normalized).toBe("A\nB\nC D\n");
  expect(a.textHash).toBe(b.textHash);

  expect(a.textHash.startsWith("sha256:")).toBe(true);
  expect(a).toHaveProperty("normalization.profile", "v0");
  expect(a.normalization.ops).toContain("newline_to_lf");
  expect(a.normalization.ops).toContain("nbsp_to_space");

  // Known SHA-256 test vector.
  const v = normalizeText("abc");
  expect(v.textHash).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");

  // No-op path is stable too.
  const c = normalizeText("plain\ntext");
  expect(c.normalized).toBe("plain\ntext");
  expect(c.normalization.ops).toEqual([]);
});

it("TextPrep TP2: chunkText overlap/locator boundaries + line numbers", async () => {
  const { chunkText } = await import("../../../js/agents/stages/textprep/chunk.js");

  {
    const chunks = chunkText("0123456789", { chunkSize: 4, overlap: 1, includeLineNumbers: false });
    expect(chunks.length).toBe(3);

    expect(chunks.map((c) => [c.locator.charStart, c.locator.charEnd, c.text])).toEqual([
      [0, 4, "0123"],
      [3, 7, "3456"],
      [6, 10, "6789"],
    ]);
    expect(chunks[0].locator.charEnd).toBe(chunks[1].locator.charStart + 1); // overlap=1
  }

  {
    const text = "a\nb\nc\nd";
    const chunks = chunkText(text, { chunkSize: 4, overlap: 0, includeLineNumbers: true });
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toEqual({ chunkId: "chunk_1", text: "a\nb\n", locator: { charStart: 0, charEnd: 4, lineStart: 1, lineEnd: 2 } });
    expect(chunks[1]).toEqual({ chunkId: "chunk_2", text: "c\nd", locator: { charStart: 4, charEnd: 7, lineStart: 3, lineEnd: 4 } });
  }

  {
    expect(() => chunkText("hello", { chunkSize: 4, overlap: 4 })).toThrow(/overlap must be < chunkSize/);
  }

  {
    expect(chunkText("", { chunkSize: 4, overlap: 0 })).toEqual([]);
  }
});

it("TextPrep TP4: planSlides parses LLM JSON and ensures core slides", async () => {
  const { planSlides } = await import("../../../js/agents/stages/textprep/slideplan.js");
  const { chunkText } = await import("../../../js/agents/stages/textprep/chunk.js");

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
  expect(calls.length).toBe(1);

  expect(intents).toHaveLength(6);
  expect(intents.map((s) => s.pageType)).toContain("cover");
  expect(intents.map((s) => s.pageType)).toContain("agenda");
  expect(intents.map((s) => s.pageType)).toContain("overview");
  expect(intents.map((s) => s.pageType)).toContain("summary");

  // Allowed pageType only.
  for (const s of intents) expect(s.pageType).toMatch(/^(cover|agenda|overview|comparison|process|summary|appendix)$/);
});

it("TextPrep TP4: planSlides falls back when LLM output invalid", async () => {
  const { planSlides } = await import("../../../js/agents/stages/textprep/slideplan.js");
  const { chunkText } = await import("../../../js/agents/stages/textprep/chunk.js");

  const chunks = chunkText("Topic\nBody.\n", { chunkSize: 20, overlap: 0 });
  const aiApiService = { chat: async () => ({ content: "not json" }) };
  const intents = await planSlides(chunks, { __services: { aiApiService }, pageCount: 5 });
  expect(intents).toHaveLength(5);
  expect(intents.map((s) => s.pageType)).toContain("cover");
  expect(intents.map((s) => s.pageType)).toContain("summary");
});

it("TextPrep TP5: extractClaims enforces evidence linkage + quote locatable", async () => {
  const { normalizeText } = await import("../../../js/agents/stages/textprep/normalize.js");
  const { chunkText } = await import("../../../js/agents/stages/textprep/chunk.js");
  const { extractClaims } = await import("../../../js/agents/stages/textprep/claims.js");

  const raw = "Alpha is first.\nBeta is second.\nGamma is third.\n";
  const norm = normalizeText(raw);
  const chunks = chunkText(norm.normalized, { chunkSize: 20, overlap: 0, includeLineNumbers: true });
  const slideIntents = [
    { slideIntentId: "s_cover", pageType: "cover", title: "Cover" },
    { slideIntentId: "s_overview", pageType: "overview", title: "Overview" },
    { slideIntentId: "s_summary", pageType: "summary", title: "Summary" },
  ];

  const { claims, evidenceLedger } = extractClaims(chunks, slideIntents, { sourceId: "user_text", sourceTextNormalized: norm.normalized, maxQuoteLen: 60 });
  expect(claims.length).toBeGreaterThan(0);
  expect(evidenceLedger.length).toBeGreaterThan(0);

  const evidenceById = new Map(evidenceLedger.map((e) => [e.evidenceId, e]));
  for (const c of claims) {
    expect(Array.isArray(c.evidenceIds)).toBe(true);
    expect(c.evidenceIds.length).toBeGreaterThan(0);
    for (const eid of c.evidenceIds) expect(evidenceById.has(eid)).toBe(true);
  }

  for (const e of evidenceLedger) {
    expect(e.sourceId).toBe("user_text");
    expect(typeof e.locator?.charStart).toBe("number");
    expect(typeof e.locator?.charEnd).toBe("number");
    expect(e.locator.charStart).toBeLessThan(e.locator.charEnd);
    const slice = norm.normalized.slice(e.locator.charStart, e.locator.charEnd);
    expect(slice).toContain(e.quote);
  }
});

it("TextPrep TP6: buildContentPackage validates hard gates (H1-H4)", async () => {
  const { buildContentPackage } = await import("../../../js/agents/stages/textprep/build-content-package.js");

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
  expect(pkg.schemaVersion).toBe("0.1");
  expect(pkg.mode).toBe("textprep");
  expect(pkg.runId).toBe("run_test");
  expect(pkg.sources).toHaveLength(1);
  expect(pkg.sources[0].sourceId).toBe("user_text");
  expect(pkg.sources[0].kind).toBe("user_text");
  expect(pkg.sources[0].textHash).toBe("sha256:deadbeef");
  expect(pkg.summary).toEqual(expect.any(String));
  expect(pkg.summary.length).toBeGreaterThan(0);

  expect(() =>
      buildContentPackage(
        runContext,
        sources,
        [{ slideIntentId: "s1", pageType: "overview", title: "Overview", claimIds: ["c404"] }],
        claims,
        evidenceLedger,
        []
      )
  ).toThrow(/Unresolvable claimId reference/);
});

// 以下测试引用了已删除的 run-context.js，已移除

it("TextPrep Stage: accepts Ingest output input", async () => {
  const { IngestStage } = await import("../../../js/agents/ingest/ingest-stage.js");
  const { TextPrepStage } = await import("../../../js/agents/stages/textprep/index.js");
  const { normalizeText } = await import("../../../js/agents/stages/textprep/normalize.js");

  const ingest = new IngestStage({ defaultChunkOptions: { chunkSize: 40, overlap: 0, includeLineNumbers: true } });
  const ingestOut = await ingest.execute(
    { runId: "run_ingest_textprep", constraints: {} },
    {
      rawTexts: [
        { text: "Alpha line one.\nBeta line two.\n", title: "Doc A" },
        { text: "Gamma line three.\nDelta line four.\n", title: "Doc B" },
      ],
    }
  );

  const stage = new TextPrepStage({ defaultChunkOptions: { chunkSize: 80, overlap: 0, includeLineNumbers: true } });
  const pkg = await stage.run(ingestOut, { runContext: { runId: "run_textprep_from_ingest", constraints: { pageCount: 4 } } });

  expect(pkg.mode).toBe("textprep");
  expect(pkg.slideIntents.length).toBeGreaterThanOrEqual(4);
  expect(pkg.claims.length).toBeGreaterThan(0);

  const merged = ingestOut.sources
    .map((s) => s.sourceTextNormalized || s.text || "")
    .filter(Boolean)
    .join("\n\n---\n\n");
  const normalizedMerged = normalizeText(merged).normalized;

  expect(pkg.metrics.textprep.sourceChars).toBe(normalizedMerged.length);
});

it("TextPrep Stage: cancellation via AbortSignal stops execution", async () => {
  const { TextPrepStage } = await import("../../../js/agents/stages/textprep/index.js");

  const stage = new TextPrepStage();
  const ac = new AbortController();
  ac.abort("stop");

  await expect(() => stage.execute({ runId: "run_test", constraints: {} }, "Hello", { signal: ac.signal })).rejects.toThrow(/stop|cancel/i);
});
