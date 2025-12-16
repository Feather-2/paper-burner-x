const test = require("node:test");
const assert = require("node:assert/strict");

async function loadGenTools() {
  return import("../../../js/agents/stages/design/react-refiner-tools.js");
}

async function loadEditTools() {
  return import("../../../js/agents/stages/design/react-refiner-tools-edit.js");
}

function makeContext({ slideCount = 2 } = {}) {
  const sections = Array.from({ length: slideCount }).map(
    (_, i) => `<section data-title="S${i + 1}"><div data-el="t${i + 1}">S${i + 1}</div></section>`
  );
  const slidesMeta = Array.from({ length: slideCount }).map((_, i) => ({ slideNo: i + 1, title: `S${i + 1}` }));
  const slideIntents = Array.from({ length: slideCount }).map((_, i) => ({ slideIntentId: `s${i + 1}`, title: `S${i + 1}` }));
  const imageSlots = Array.from({ length: slideCount }).map((_, i) => ({ slideIndex: i, slotId: `img${i}` }));

  return {
    deckPackage: { deckHtmlDsl: sections.join("\n\n"), slidesMeta, imageSlots },
    contentPackage: { slideIntents },
  };
}

test("ReactRefiner Edit Tools: addSlide supports before/after/end positions", async () => {
  const { createToolExecutor, parseSections } = await loadGenTools();
  const { createEditToolExecutor } = await loadEditTools();

  // before:0
  {
    const context = makeContext({ slideCount: 2 });
    const base = createToolExecutor(context);
    const exec = createEditToolExecutor(context, base);
    const res = await exec("addSlide", { position: "before:0", content: { title: "N0", pageType: "overview" } });
    assert.equal(res.success, true);
    const sections = parseSections(context.deckPackage.deckHtmlDsl);
    assert.equal(sections.length, 3);
    assert.ok(sections[0].includes('data-title="N0"'));
    assert.deepStrictEqual(context.deckPackage.imageSlots.map((s) => s.slideIndex), [1, 2]);
  }

  // after:0
  {
    const context = makeContext({ slideCount: 2 });
    const base = createToolExecutor(context);
    const exec = createEditToolExecutor(context, base);
    const res = await exec("addSlide", { position: "after:0", content: { title: "N1" } });
    assert.equal(res.success, true);
    const sections = parseSections(context.deckPackage.deckHtmlDsl);
    assert.equal(sections.length, 3);
    assert.ok(sections[1].includes('data-title="N1"'));
    assert.deepStrictEqual(context.deckPackage.imageSlots.map((s) => s.slideIndex), [0, 2]);
  }

  // end
  {
    const context = makeContext({ slideCount: 2 });
    const base = createToolExecutor(context);
    const exec = createEditToolExecutor(context, base);
    const res = await exec("addSlide", { position: "end", content: { title: "Nend" } });
    assert.equal(res.success, true);
    const sections = parseSections(context.deckPackage.deckHtmlDsl);
    assert.equal(sections.length, 3);
    assert.ok(sections[2].includes('data-title="Nend"'));
    assert.deepStrictEqual(context.deckPackage.imageSlots.map((s) => s.slideIndex), [0, 1]);
  }
});

test("ReactRefiner Edit Tools: deleteSlide normal and out-of-range", async () => {
  const { createToolExecutor, parseSections } = await loadGenTools();
  const { createEditToolExecutor } = await loadEditTools();

  const context = makeContext({ slideCount: 3 });
  context.deckPackage.imageSlots = [
    { slideIndex: 0, slotId: "img0" },
    { slideIndex: 1, slotId: "img1" },
    { slideIndex: 2, slotId: "img2" },
  ];

  const base = createToolExecutor(context);
  const exec = createEditToolExecutor(context, base);

  const res = await exec("deleteSlide", { slideIndex: 1 });
  assert.equal(res.success, true);
  assert.equal(parseSections(context.deckPackage.deckHtmlDsl).length, 2);
  assert.equal(context.deckPackage.slidesMeta.length, 2);
  assert.deepStrictEqual(
    context.deckPackage.slidesMeta.map((m) => m.slideNo),
    [1, 2]
  );
  assert.deepStrictEqual(context.deckPackage.imageSlots.map((s) => s.slotId), ["img0", "img2"]);
  assert.deepStrictEqual(context.deckPackage.imageSlots.map((s) => s.slideIndex), [0, 1]);

  const bad = await exec("deleteSlide", { slideIndex: 99 });
  assert.equal(bad.success, false);
  assert.match(bad.error, /Invalid slideIndex/);
});

test("ReactRefiner Edit Tools: reorderSlides normal and illegal order", async () => {
  const { createToolExecutor, parseSections } = await loadGenTools();
  const { createEditToolExecutor } = await loadEditTools();

  const context = makeContext({ slideCount: 2 });
  context.deckPackage.imageSlots = [
    { slideIndex: 0, slotId: "img0" },
    { slideIndex: 1, slotId: "img1" },
  ];
  const base = createToolExecutor(context);
  const exec = createEditToolExecutor(context, base);

  const ok = await exec("reorderSlides", { newOrder: [1, 0] });
  assert.equal(ok.success, true);
  const sections = parseSections(context.deckPackage.deckHtmlDsl);
  assert.ok(sections[0].includes(">S2<"));
  assert.ok(sections[1].includes(">S1<"));
  assert.deepStrictEqual(context.deckPackage.imageSlots.map((s) => s.slotId), ["img0", "img1"]);
  assert.deepStrictEqual(context.deckPackage.imageSlots.map((s) => s.slideIndex), [1, 0]);

  const badLen = await exec("reorderSlides", { newOrder: [0] });
  assert.equal(badLen.success, false);
  assert.match(badLen.error, /length must match slide count/);

  const badDup = await exec("reorderSlides", { newOrder: [0, 0] });
  assert.equal(badDup.success, false);
  assert.match(badDup.error, /duplicate/);
});

test("ReactRefiner Edit Tools: saveCheckpoint/revert roundtrip and diff compares versions", async () => {
  const { createToolExecutor } = await loadGenTools();
  const { createEditToolExecutor } = await loadEditTools();

  const context = makeContext({ slideCount: 2 });
  const originalDsl = context.deckPackage.deckHtmlDsl;

  const base = createToolExecutor(context);
  const exec = createEditToolExecutor(context, base);

  const ckpt = await exec("saveCheckpoint", { label: "v1" });
  assert.equal(ckpt.success, true);
  const checkpointId = ckpt.data.checkpointId;

  const added = await exec("addSlide", { position: "end", content: { title: "N" } });
  assert.equal(added.success, true);
  assert.notEqual(context.deckPackage.deckHtmlDsl, originalDsl);

  const d = await exec("diff", { from: checkpointId, to: "current" });
  assert.equal(d.success, true);
  assert.equal(d.data.summary.from, checkpointId);
  assert.equal(d.data.summary.to, "current");
  assert.equal(d.data.summary.deckHtmlDsl.changed, true);

  const rev = await exec("revert", { checkpointId });
  assert.equal(rev.success, true);
  assert.equal(context.deckPackage.deckHtmlDsl, originalDsl);
});

test("ReactRefiner Edit Tools: checkpoint FIFO keeps last 10", async () => {
  const { createToolExecutor } = await loadGenTools();
  const { createEditToolExecutor } = await loadEditTools();

  const context = makeContext({ slideCount: 1 });
  const base = createToolExecutor(context);
  const exec = createEditToolExecutor(context, base);

  const origNow = Date.now;
  const origRand = Math.random;
  try {
    let t = 1700000000000;
    Date.now = () => (t += 1);
    Math.random = () => 0.123456;

    for (let i = 1; i <= 12; i++) {
      const res = await exec("saveCheckpoint", { label: `L${i}` });
      assert.equal(res.success, true);
      assert.ok(context._checkpoints.length <= 10);
    }

    assert.equal(context._checkpoints.length, 10);
    assert.equal(context._checkpoints[0].label, "L3");
    assert.equal(context._checkpoints[context._checkpoints.length - 1].label, "L12");
  } finally {
    Date.now = origNow;
    Math.random = origRand;
  }
});

