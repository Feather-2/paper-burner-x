import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createRequire } from 'node:module';

import '../../js/ppt/editor/intent/intent-parser.js';
import '../../js/ppt/editor/intent/operation-planner.js';
import '../../js/ppt/dsl/serialize.js';

if (typeof globalThis.require !== 'function') {
  globalThis.require = createRequire(import.meta.url);
}

const parseIntent = (...args) => globalThis.IntentParser.parseIntent(...args);
const planOperations = (...args) => globalThis.OperationPlanner.planOperations(...args);
const documentToHtml = (...args) => globalThis.PPTDSLSerialize.documentToHtml(...args);
const htmlToDocument = (...args) => globalThis.PPTDSLSerialize.htmlToDocument(...args);

async function setupBrowserGlobals() {
  globalThis.window = globalThis;
  await import("../../js/ppt/editor/event-emitter.js");
  await import("../../js/ppt/editor/document.js");
  await import("../../js/ppt/core/slide-parser.js");
}

test("IntentParser: regex intents", async () => {
  const i1 = await parseIntent("在第2页后新增一页");
  assert.equal(i1.type, "INSERT_SLIDE");
  assert.equal(i1.target.slideIndex, 1);
  assert.equal(i1.target.position, "after");

  const i1b = await parseIntent("在第2页前新增一页");
  assert.equal(i1b.type, "INSERT_SLIDE");
  assert.equal(i1b.target.slideIndex, 1);
  assert.equal(i1b.target.position, "before");

  const i2 = await parseIntent("删除第3页");
  assert.equal(i2.type, "DELETE_SLIDE");
  assert.equal(i2.target.slideIndex, 2);

  const i3 = await parseIntent("修改第1页的标题为 Hello World");
  assert.equal(i3.type, "MODIFY_ELEMENT");
  assert.equal(i3.target.slideIndex, 0);
  assert.equal(i3.target.elementSelector, "title");
  assert.equal(i3.content, "Hello World");

  const i4 = await parseIntent("重做第2-4页");
  assert.equal(i4.type, "REDO_RANGE");
  assert.deepEqual(i4.target.slideRange, [1, 3]);

  const i5 = await parseIntent("重做第5页");
  assert.equal(i5.type, "REDO_SLIDE");
  assert.equal(i5.target.slideIndex, 4);

  const i5b = await parseIntent("不喜欢第2页，重做一下");
  assert.equal(i5b.type, "REDO_SLIDE");
  assert.equal(i5b.target.slideIndex, 1);

  const i6 = await parseIntent("补充关于人工智能的内容");
  assert.equal(i6.type, "RESEARCH_MORE");
  assert.equal(i6.content, "人工智能");

  const i6b = await parseIntent("再找找人工智能资料");
  assert.equal(i6b.type, "RESEARCH_MORE");
  assert.equal(i6b.content, "人工智能");

  const i7 = await parseIntent("新加入文件");
  assert.equal(i7.type, "ADD_FILE");
});

test("IntentParser: chinese numerals", async () => {
  const i = await parseIntent("删除第十页");
  assert.equal(i.type, "DELETE_SLIDE");
  assert.equal(i.target.slideIndex, 9);

  const i2 = await parseIntent("删除第十一页");
  assert.equal(i2.type, "DELETE_SLIDE");
  assert.equal(i2.target.slideIndex, 10);
});

test("IntentParser: LLM fallback + unknown fallback", async () => {
  // regex 不命中 → llm.parseIntent
  const i1 = await parseIntent("请把第2页的标题改得更有冲击力", {
    llm: {
      parseIntent: async () => ({ type: "MODIFY_ELEMENT", target: { slideIndex: 1, elementSelector: "title" }, content: "更有冲击力的标题" }),
    },
  });
  assert.equal(i1.type, "MODIFY_ELEMENT");
  assert.equal(i1.target.slideIndex, 1);
  assert.equal(i1.content, "更有冲击力的标题");

  // regex 不命中 → llm.chat(JSON)
  const i2 = await parseIntent("把第1页标题改得更短一些", {
    llm: {
      chat: async () =>
        JSON.stringify({ type: "MODIFY_ELEMENT", target: { slideIndex: 0, elementSelector: "title" }, content: "短标题" }),
    },
  });
  assert.equal(i2.type, "MODIFY_ELEMENT");
  assert.equal(i2.content, "短标题");

  // llm.chat 返回非 JSON → 返回 fallback
  const i3 = await parseIntent("这是一条完全无法识别的指令", { llm: { chat: async () => "not json" } });
  assert.equal(i3.type, "RESEARCH_MORE");
  assert.equal(i3.constraints.fallback, true);
});

test("OperationPlanner: slide/element ops + batch", async () => {
  await setupBrowserGlobals();

  const SlideDocument = window.SlideDocument;
  const doc = new SlideDocument();

  doc.load([
    {
      id: "s1",
      type: "freeform",
      background: "#fff",
      elements: [
        { id: "t1", type: "text", x: "5%", y: "5%", w: "90%", h: "auto", z: 1, content: "Old Title", font: 40 },
        { id: "t2", type: "text", x: "5%", y: "40%", w: "90%", h: "auto", z: 2, content: "Body", font: 18 },
      ],
    },
    { id: "s2", type: "freeform", background: "#fff", elements: [] },
    { id: "s3", type: "freeform", background: "#fff", elements: [] },
    { id: "s4", type: "freeform", background: "#fff", elements: [] },
  ]);

  {
    const intent = { type: "INSERT_SLIDE", target: { slideIndex: 0 } };
    const ops = planOperations(intent, doc);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].type, "slide.add");
    assert.equal(ops[0].index, 1);
    assert.ok(ops[0].slide && ops[0].slide.id);
  }

  {
    const intent = { type: "INSERT_SLIDE", target: { slideIndex: 1, position: "before" } };
    const ops = planOperations(intent, doc);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].type, "slide.add");
    assert.equal(ops[0].index, 1);
  }

  {
    const intent = { type: "DELETE_SLIDE", target: { slideIndex: 1 } };
    const ops = planOperations(intent, doc);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].type, "slide.delete");
    assert.equal(ops[0].index, 1);
    assert.equal(ops[0].slide.id, "s2");
  }

  {
    const intent = { type: "MODIFY_ELEMENT", target: { slideIndex: 0, elementSelector: "title" }, content: "New Title" };
    const ops = planOperations(intent, doc);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].type, "element.update");
    assert.equal(ops[0].slideIndex, 0);
    assert.equal(ops[0].elementId, "t1");
    assert.deepEqual(ops[0].changes, [{ path: "content", oldValue: "Old Title", newValue: "New Title" }]);
  }

  {
    // #id 选择器
    const intent = { type: "MODIFY_ELEMENT", target: { slideIndex: 0, elementSelector: "#t2" }, content: "Body2" };
    const ops = planOperations(intent, doc);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].elementId, "t2");
  }

  {
    // 未提供 content → noop
    const intent = { type: "MODIFY_ELEMENT", target: { slideIndex: 0, elementSelector: "title" } };
    const ops = planOperations(intent, doc);
    assert.deepEqual(ops, []);
  }

  {
    // 单页 redo（覆盖 REDO_SLIDE 分支）
    const intent = { type: "REDO_SLIDE", target: { slideIndex: 2 } };
    const ops = planOperations(intent, doc);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].type, "slide.update");
    assert.equal(ops[0].slideIndex, 2);
  }

  {
    const intent = { type: "REDO_RANGE", target: { slideRange: [1, 3] } };
    const ops = planOperations(intent, doc);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].type, "batch");
    assert.equal(ops[0].operations.length, 3);
    assert.ok(ops[0].operations.every((x) => x.type === "slide.update"));
  }

  {
    const intent = { type: "RESEARCH_MORE", target: {}, content: "市场规模" };
    const ops = planOperations(intent, doc);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].type, "slide.add");
    assert.ok(ops[0].slide.elements?.[0]?.content?.includes("市场规模"));
  }

  {
    const intent = { type: "ADD_FILE", target: { slideIndex: 0 }, content: "文件" };
    const ops = planOperations(intent, doc);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].type, "element.add");
    assert.equal(ops[0].slideIndex, 0);
    assert.equal(ops[0].element._filePlaceholder, true);
  }

  {
    // 触发 insert slide 的 clampIndex=null 分支（越界 index）
    const intent = { type: "INSERT_SLIDE", target: { slideIndex: 999 } };
    const ops = planOperations(intent, doc);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].index, doc.getSlideCount());
  }

  {
    // 触发 delete slide：slidesCount<=1 分支
    const doc2 = new SlideDocument();
    doc2.load([{ id: "only", type: "freeform", background: "#fff", elements: [] }]);
    const ops = planOperations({ type: "DELETE_SLIDE", target: { slideIndex: 0 } }, doc2);
    assert.deepEqual(ops, []);
  }

  {
    // 触发 ADD_FILE 的 fallback element id 分支（无 _generateId）
    const plainDoc = {
      slides: [{ id: "p1", type: "freeform", background: "#fff", elements: [] }],
    };
    const ops = planOperations({ type: "ADD_FILE", target: { slideIndex: 0 } }, plainDoc);
    assert.equal(ops.length, 1);
    assert.ok(String(ops[0].element.id).startsWith("el_"));
  }

  {
    // 触发 getSlides(Array) 分支
    const plainSlides = [{ id: "a1", type: "freeform", background: "#fff", elements: [] }];
    const ops = planOperations({ type: "INSERT_SLIDE", target: { slideIndex: 0 } }, plainSlides);
    assert.equal(ops.length, 1);
    assert.equal(ops[0].type, "slide.add");
  }
});

test("SlideDocument.applyOperations: updates document + PPTGenerator.slides + history", async () => {
  await setupBrowserGlobals();

  const SlideDocument = window.SlideDocument;
  const doc = new SlideDocument();
  doc.load([{ id: "s1", type: "freeform", background: "#fff", elements: [{ id: "t1", type: "text", content: "A", x: "5%", y: "5%", w: "90%", h: "auto", z: 1 }] }]);

  // 模拟 PPTGenerator 数据源
  window.PPTGenerator = { slides: doc.toJSON() };

  const pushed = [];
  const history = { push: (op) => pushed.push(op) };

  const ops = [
    { id: "op1", type: "element.update", slideIndex: 0, elementId: "t1", timestamp: Date.now(), changes: [{ path: "content", oldValue: "A", newValue: "B" }] },
  ];

  const applied = doc.applyOperations(ops, { history });
  assert.equal(applied.length > 0, true);
  assert.equal(doc.getElementById("t1").content, "B");
  assert.equal(window.PPTGenerator.slides[0].elements[0].content, "B");
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].type, "element.update");
});

test("Serialize: documentToHtml/htmlToDocument roundtrip keeps IDs", async () => {
  await setupBrowserGlobals();

  // 静音 SlideParser 的 debug log，避免污染测试输出
  const origLog = console.log;
  console.log = () => {};
  try {
    const SlideDocument = window.SlideDocument;
    const doc = new SlideDocument();
    doc.load([
      {
        id: "slide-keep-id",
        type: "freeform",
        background: "#ffffff",
        elements: [
          { id: "title-id", type: "text", x: "5%", y: "8%", w: "90%", h: "auto", z: 1, content: "<b>Title</b>", font: 32, color: "#111" },
          {
            id: "group-id",
            type: "group",
            x: "10%",
            y: "20%",
            w: "80%",
            h: "60%",
            z: 2,
            children: [{ id: "child-id", type: "text", x: "0%", y: "0%", w: "100%", h: "auto", z: 1, content: "Child", font: 16 }],
          },
        ],
      },
    ]);

    const html = documentToHtml(doc);
    assert.ok(html.includes('id="slide-keep-id"'));
    assert.ok(html.includes('id="title-id"'));
    assert.ok(html.includes('id="group-id"'));
    assert.ok(html.includes('id="child-id"'));

    const doc2 = htmlToDocument(html);
    const slides = typeof doc2.getSlides === "function" ? doc2.getSlides() : doc2.slides;
    assert.equal(slides[0].id, "slide-keep-id");
    assert.equal(slides[0].elements[0].id, "title-id");

    const html2 = documentToHtml(doc2);
    assert.ok(html2.includes('id="slide-keep-id"'));
    assert.ok(html2.includes('id="title-id"'));
  } finally {
    console.log = origLog;
  }
});

test("Serialize: covers element types + incremental + parser fallback paths", async () => {
  await setupBrowserGlobals();

  const origLog = console.log;
  console.log = () => {};
  try {
    const SlideDocument = window.SlideDocument;
    const doc = new SlideDocument();

    doc.load([
      {
        id: "slide:1",
        type: "freeform",
        backgroundGradient: "linear-gradient(90deg, #000, #fff)",
        elements: [
          { id: "u1", type: "unknown", x: 10, y: 20, w: 30, h: 40, z: 1 },
          { id: "shape1", type: "shape", x: "10%", y: "10%", w: "20%", h: "20%", z: 2, shape: "rect", fill: "#f00", stroke: "#000", strokeWidth: 2, radius: 8 },
          { id: "img1", type: "image", x: "30%", y: "10%", w: "20%", h: "20%", z: 3, src: "https://example.com/a.png", alt: "A", fit: "cover", radius: 4 },
          { id: "icon1", type: "icon", x: "50%", y: "10%", w: "10%", h: "10%", z: 4, icon: "carbon:star", size: 24, color: "#333" },
          { id: "line1", type: "line", x: "0%", y: "0%", w: "0%", h: "0%", z: 5, x1: "10%", y1: "10%", x2: "90%", y2: "10%", stroke: "#ccc", strokeWidth: 2, dash: "5,5" },
          { id: "chart1", type: "chart", x: "10%", y: "40%", w: "40%", h: "30%", z: 6, chartType: "bar", chartData: "A:1,B:2", colors: "#f00,#0f0", title: "T" },
          { id: "f1", type: "formula", x: "55%", y: "40%", w: "35%", h: "20%", z: 7, latex: "E=mc^2", font: 24, color: "#111", align: "center", displayMode: true },
          { id: "svg1", type: "svg", x: "10%", y: "75%", w: "20%", h: "20%", z: 8, content: "<svg><circle cx=\"5\" cy=\"5\" r=\"5\"></circle></svg>", bgColor: "#fff", radius: 2 },
          { id: "tbl1", type: "table", x: "35%", y: "75%", w: "25%", h: "20%", z: 9, data: [["H1", "H2"], ["A", "B"]], style: "grid" },
          { id: "list1", type: "list", x: "62%", y: "75%", w: "28%", h: "20%", z: 10, items: ["a", "b"], bullet: "dot", gap: 6 },
          { id: "card1", type: "card", x: "70%", y: "10%", w: "25%", h: "25%", z: 11, layout: "horizontal", fill: "#fff", radius: 12, padding: 16, shadow: true, title: "Card", subtitle: "Sub" },
          {
            id: "g1",
            type: "group",
            x: "5%",
            y: "5%",
            w: "10%",
            h: "10%",
            z: 12,
            children: [{ id: "g1c1", type: "text", x: "0%", y: "0%", w: "100%", h: "auto", z: 1, content: "G", font: 12, bold: true }],
          },
        ],
      },
      {
        id: "slide-2",
        type: "freeform",
        backgroundImage: "asset://bg",
        elements: [{ id: "t2", type: "text", x: "5%", y: "5%", w: "90%", h: "auto", z: 1, content: "S2", font: 20 }],
      },
    ]);

    const html1 = documentToHtml(doc);
    assert.ok(html1.includes('section data-type="freeform"'));
    assert.ok(html1.includes('data-gradient="linear-gradient'));
    assert.ok(html1.includes('data-bg-image="asset://bg"'));
    assert.ok(html1.includes('data-el="table"'));
    assert.ok(html1.includes('data-el="list"'));
    assert.ok(html1.includes('data-el="card"'));
    assert.ok(html1.includes('data-el="group"'));
    assert.ok(html1.includes('id="u1"'));
    assert.ok(html1.includes('data-x="10%"')); // number → %

    // 只改第二页背景，走增量替换 + cssEscape fallback（slide:1 含特殊字符）
    doc.updateSlide(1, { background: "#eeeeee", backgroundImage: null });
    const html2 = documentToHtml(doc, { baseHtml: html1, onlySlideIndexes: [1] });
    assert.ok(html2.includes('id="slide-2"'));
    assert.ok(html2.includes('data-bg="#eeeeee"'));

    // htmlToDocument：hasDom=true 分支（提供全局 document）
    const { document: domDoc, window: domWin } = parseHTML("<html><body></body></html>");
    const prevDoc = global.document;
    const prevWin = global.window;
    global.document = domDoc;
    global.window = domWin;
    try {
      const docFromDom = htmlToDocument(html2);
      assert.equal(typeof docFromDom.getSlideCount === "function", true);
      assert.equal(docFromDom.getSlideCount(), 2);
    } finally {
      global.document = prevDoc;
      global.window = prevWin;
    }

    // htmlToDocument：SlideParser 不存在 → 抛错
    const prevParser = global.SlideParser;
    const prevDocCtor = global.SlideDocument;
    delete global.SlideParser;
    delete global.SlideDocument;
    try {
      assert.throws(() => htmlToDocument(html2), /SlideParser 未加载/);
    } finally {
      global.SlideParser = prevParser;
      global.SlideDocument = prevDocCtor;
    }
  } finally {
    console.log = origLog;
  }
});
