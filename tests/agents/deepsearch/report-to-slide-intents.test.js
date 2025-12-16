const test = require("node:test");
const assert = require("node:assert/strict");

function pickTypes(intents) {
  return (Array.isArray(intents) ? intents : []).map((s) => s?.pageType);
}

function byType(intents, pageType) {
  return (Array.isArray(intents) ? intents : []).find((s) => s?.pageType === pageType) || null;
}

function contentSlides(intents) {
  return (Array.isArray(intents) ? intents : []).filter((s) => s?.pageType === "content");
}

test("deriveSlideIntentsFromReport: basic conversion + per-slide citations", async () => {
  const { deriveSlideIntentsFromReport } = await import("../../../js/agents/stages/deepsearch/report-to-slide-intents.js");

  const report = {
    title: "My Report",
    sections: [
      { sectionId: "sec_1", title: "Background", gapId: "g1", claimIds: ["c1"], content: "- Finding A {{cite:e1}}\n- Finding B" },
      { sectionId: "sec_2", title: "Method", gapId: "g2", claimIds: ["c2"], content: "- Method detail (no cites)" },
    ],
    citations: [
      { citationId: 1, evidenceId: "e1", sourceId: "s1", sourceTitle: "Source 1", quote: "Alpha" },
      { citationId: 2, evidenceId: "e2", sourceId: "s1", sourceTitle: "Source 1", quote: "Beta" },
    ],
  };

  const out = deriveSlideIntentsFromReport(report);
  assert.ok(Array.isArray(out) && out.length >= 4);

  assert.deepEqual(new Set(pickTypes(out)), new Set(["cover", "agenda", "overview", "summary", "content"]));

  const cover = byType(out, "cover");
  assert.equal(cover.title, "My Report");
  assert.equal(typeof cover.slideIntentId, "string");

  const contents = contentSlides(out);
  assert.equal(contents.length, 2);
  assert.equal(contents[0].title, "Background");
  assert.equal(contents[0].gapId, "g1");
  assert.deepEqual(contents[0].sectionIds, ["sec_1"]);
  assert.deepEqual(contents[0].claimIds, ["c1"]);
  assert.equal(typeof contents[0].content, "string");
  assert.ok(contents[0].content.includes("{{cite:e1}}"));
  assert.ok(Array.isArray(contents[0].citations) && contents[0].citations.length === 1);
  assert.equal(contents[0].citations[0].evidenceId, "e1");

  assert.equal(contents[1].title, "Method");
  assert.equal(contents[1].gapId, "g2");
  assert.deepEqual(contents[1].sectionIds, ["sec_2"]);
  assert.deepEqual(contents[1].claimIds, ["c2"]);
  assert.equal(typeof contents[1].content, "string");
  assert.equal("citations" in contents[1], false);
});

test("deriveSlideIntentsFromReport: targetSlides merges sections to fit", async () => {
  const { deriveSlideIntentsFromReport } = await import("../../../js/agents/stages/deepsearch/report-to-slide-intents.js");

  const report = {
    title: "Merge Test",
    sections: [
      { sectionId: "sec_1", title: "S1", claimIds: ["c1"], content: "- A" },
      { sectionId: "sec_2", title: "S2", claimIds: ["c2"], content: "- B" },
      { sectionId: "sec_3", title: "S3", claimIds: ["c3"], content: "- C" },
      { sectionId: "sec_4", title: "S4", claimIds: ["c4"], content: "- D" },
      { sectionId: "sec_5", title: "S5", claimIds: ["c5"], content: "- E" },
    ],
  };

  const out = deriveSlideIntentsFromReport(report, { targetSlides: 6, includeCore: true });
  assert.equal(out.length, 6);

  const contents = contentSlides(out);
  assert.equal(contents.length, 2);
  assert.ok(contents[0].sectionIds.length >= 2);
  assert.ok(contents[1].sectionIds.length >= 2);
  assert.ok(contents[0].content.includes("---") || contents[1].content.includes("---"), "merged content uses section separator");

  const allSectionIds = contents.flatMap((s) => s.sectionIds);
  assert.deepEqual(new Set(allSectionIds), new Set(["sec_1", "sec_2", "sec_3", "sec_4", "sec_5"]));
});

test("deriveSlideIntentsFromReport: targetSlides splits sections to expand", async () => {
  const { deriveSlideIntentsFromReport } = await import("../../../js/agents/stages/deepsearch/report-to-slide-intents.js");

  const report = {
    title: "Split Test",
    sections: [
      {
        sectionId: "sec_1",
        title: "Big",
        claimIds: ["c1", "c2", "c3", "c4"],
        content: ["- One {{cite:e1}}", "- Two", "- Three", "- Four"].join("\n"),
      },
      {
        sectionId: "sec_2",
        title: "Small",
        claimIds: ["c5"],
        content: "Sentence A. Sentence B. Sentence C. Sentence D.",
      },
    ],
    citations: [{ citationId: 1, evidenceId: "e1" }],
  };

  const out = deriveSlideIntentsFromReport(report, { targetSlides: 9, includeCore: true });
  assert.equal(out.length, 9);

  const contents = contentSlides(out);
  assert.equal(contents.length, 5);
  assert.ok(contents.some((s) => String(s.title).includes("(Part ")));

  const sec1Parts = contents.filter((s) => Array.isArray(s.sectionIds) && s.sectionIds.includes("sec_1"));
  assert.ok(sec1Parts.length >= 2);

  const flattenedClaims = contents.flatMap((s) => (Array.isArray(s.claimIds) ? s.claimIds : []));
  assert.ok(flattenedClaims.includes("c1"));
  assert.ok(flattenedClaims.includes("c5"));

  const citeSlides = contents.filter((s) => Array.isArray(s.citations) && s.citations.length);
  assert.ok(citeSlides.length >= 1);
  assert.ok(citeSlides.every((s) => s.citations.some((c) => c.evidenceId === "e1")));
});

test("deriveSlideIntentsFromReport: handles empty sections via markdown fallback + numbered citations mapping", async () => {
  const { deriveSlideIntentsFromReport } = await import("../../../js/agents/stages/deepsearch/report-to-slide-intents.js");

  const report = {
    title: "No Sections",
    markdown: "# No Sections\n\nA point [1]\n\n## References\n\n- [1] Ref\n",
    citations: [{ citationId: 1, evidenceId: "e1" }],
    sections: [],
  };

  const out = deriveSlideIntentsFromReport(report, { targetSlides: 5, includeCore: true });
  assert.equal(out.length, 5);

  const contents = contentSlides(out);
  assert.equal(contents.length, 1);
  assert.ok(typeof contents[0].content === "string" && contents[0].content.includes("A point"));
  assert.ok(Array.isArray(contents[0].citations) && contents[0].citations.length === 1);
  assert.equal(contents[0].citations[0].evidenceId, "e1");
});

test("deriveSlideIntentsFromReport: keepClaimIds/keepContentString options trim payload", async () => {
  const { deriveSlideIntentsFromReport } = await import("../../../js/agents/stages/deepsearch/report-to-slide-intents.js");

  const report = {
    title: "Trim",
    sections: [{ sectionId: "sec_1", title: "S1", claimIds: ["c1"], content: "- A" }],
  };

  const out = deriveSlideIntentsFromReport(report, { includeCore: false, keepClaimIds: false, keepContentString: false });
  assert.equal(out.length, 2);
  assert.equal(out[0].pageType, "cover");
  assert.equal(out[1].pageType, "content");
  assert.equal("claimIds" in out[1], false);
  assert.equal("content" in out[1], false);
});

