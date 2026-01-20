import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';

let parseIntent, planOperations, documentToHtml, htmlToDocument;

beforeEach(async () => {
  const intentParser = await import("../../../js/ppt/editor/intent/intent-parser.js");
  parseIntent = intentParser.parseIntent;
  const operationPlanner = await import("../../../js/ppt/editor/intent/operation-planner.js");
  planOperations = operationPlanner.planOperations;
  const serialize = await import("../../../js/ppt/dsl/serialize.js");
  documentToHtml = serialize.documentToHtml;
  htmlToDocument = serialize.htmlToDocument;
});

async function setupBrowserGlobals() {
  globalThis.window = globalThis;
  await import("../../../js/ppt/editor/event-emitter.js");
  await import("../../../js/ppt/editor/document.js");
  await import("../../../js/ppt/core/slide-parser.js");
}

test("IntentParser: regex intents", async () => {
  const i1 = await parseIntent("在第2页后新增一页");
  expect(i1.type).toBe("INSERT_SLIDE");
  expect(i1.target.slideIndex).toBe(1);
  expect(i1.target.position).toBe("after");

  const i1b = await parseIntent("在第2页前新增一页");
  expect(i1b.type).toBe("INSERT_SLIDE");
  expect(i1b.target.slideIndex).toBe(1);
  expect(i1b.target.position).toBe("before");

  const i2 = await parseIntent("删除第3页");
  expect(i2.type).toBe("DELETE_SLIDE");
  expect(i2.target.slideIndex).toBe(2);

  const i3 = await parseIntent("修改第1页的标题为 Hello World");
  expect(i3.type).toBe("MODIFY_ELEMENT");
  expect(i3.target.slideIndex).toBe(0);
  expect(i3.target.elementSelector).toBe("title");
  expect(i3.content).toBe("Hello World");

  const i4 = await parseIntent("重做第2-4页");
  expect(i4.type).toBe("REDO_RANGE");
  expect(i4.target.slideRange).toEqual([1, 3]);

  const i5 = await parseIntent("重做第5页");
  expect(i5.type).toBe("REDO_SLIDE");
  expect(i5.target.slideIndex).toBe(4);

  const i5b = await parseIntent("不喜欢第2页，重做一下");
  expect(i5b.type).toBe("REDO_SLIDE");
  expect(i5b.target.slideIndex).toBe(1);

  const i6 = await parseIntent("补充关于人工智能的内容");
  expect(i6.type).toBe("RESEARCH_MORE");
  expect(i6.content).toBe("人工智能");

  const i6b = await parseIntent("再找找人工智能资料");
  expect(i6b.type).toBe("RESEARCH_MORE");
  expect(i6b.content).toBe("人工智能");

  const i7 = await parseIntent("新加入文件");
  expect(i7.type).toBe("ADD_FILE");
});

test("IntentParser: chinese numerals", async () => {
  const i = await parseIntent("删除第十页");
  expect(i.type).toBe("DELETE_SLIDE");
  expect(i.target.slideIndex).toBe(9);

  const i2 = await parseIntent("删除第十一页");
  expect(i2.type).toBe("DELETE_SLIDE");
  expect(i2.target.slideIndex).toBe(10);
});

test("IntentParser: LLM fallback + unknown fallback", async () => {
  // regex 不命中 → llm.parseIntent
  const i1 = await parseIntent("请把第2页的标题改得更有冲击力", {
    llm: {
      parseIntent: async () => ({ type: "MODIFY_ELEMENT", target: { slideIndex: 1, elementSelector: "title" }, content: "更有冲击力的标题" }),
    },
  });
  expect(i1.type).toBe("MODIFY_ELEMENT");
  expect(i1.target.slideIndex).toBe(1);
  expect(i1.content).toBe("更有冲击力的标题");

  // regex 不命中 → llm.chat(JSON)
  const i2 = await parseIntent("把第1页标题改得更短一些", {
    llm: {
      chat: async () =>
        JSON.stringify({ type: "MODIFY_ELEMENT", target: { slideIndex: 0, elementSelector: "title" }, content: "短标题" }),
    },
  });
  expect(i2.type).toBe("MODIFY_ELEMENT");
  expect(i2.content).toBe("短标题");

  // llm.chat 返回非 JSON → 返回 fallback
  const i3 = await parseIntent("这是一条完全无法识别的指令", { llm: { chat: async () => "not json" } });
  expect(i3.type).toBe("RESEARCH_MORE");
  expect(i3.constraints.fallback).toBe(true);
});

test("OperationPlanner: slide/element ops + batch", async () => {
  await setupBrowserGlobals();

  const SlideDocument = globalThis.SlideDocument;
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
    expect(ops.length).toBe(1);
    expect(ops[0].type).toBe("slide.add");
    expect(ops[0].index).toBe(1);
    expect(ops[0].slide && ops[0].slide.id).toBeTruthy();
  }

  {
    const intent = { type: "INSERT_SLIDE", target: { slideIndex: 1, position: "before" } };
    const ops = planOperations(intent, doc);
    expect(ops.length).toBe(1);
    expect(ops[0].type).toBe("slide.add");
    expect(ops[0].index).toBe(1);
  }

  {
    const intent = { type: "DELETE_SLIDE", target: { slideIndex: 1 } };
    const ops = planOperations(intent, doc);
    expect(ops.length).toBe(1);
    expect(ops[0].type).toBe("slide.delete");
    expect(ops[0].index).toBe(1);
    expect(ops[0].slide.id).toBe("s2");
  }

  {
    const intent = { type: "MODIFY_ELEMENT", target: { slideIndex: 0, elementSelector: "title" }, content: "New Title" };
    const ops = planOperations(intent, doc);
    expect(ops.length).toBe(1);
    expect(ops[0].type).toBe("element.update");
    expect(ops[0].slideIndex).toBe(0);
    expect(ops[0].elementId).toBe("t1");
    expect(ops[0].changes).toEqual([{ path: "content", oldValue: "Old Title", newValue: "New Title" }]);
  }

  {
    // #id 选择器
    const intent = { type: "MODIFY_ELEMENT", target: { slideIndex: 0, elementSelector: "#t2" }, content: "Body2" };
    const ops = planOperations(intent, doc);
    expect(ops.length).toBe(1);
    expect(ops[0].elementId).toBe("t2");
  }

  {
    // 未提供 content → noop
    const intent = { type: "MODIFY_ELEMENT", target: { slideIndex: 0, elementSelector: "title" } };
    const ops = planOperations(intent, doc);
    expect(ops).toEqual([]);
  }

  {
    // 单页 redo（覆盖 REDO_SLIDE 分支）
    const intent = { type: "REDO_SLIDE", target: { slideIndex: 2 } };
    const ops = planOperations(intent, doc);
    expect(ops.length).toBe(1);
    expect(ops[0].type).toBe("slide.update");
    expect(ops[0].slideIndex).toBe(2);
  }

  {
    const intent = { type: "REDO_RANGE", target: { slideRange: [1, 3] } };
    const ops = planOperations(intent, doc);
    expect(ops.length).toBe(1);
    expect(ops[0].type).toBe("batch");
    expect(ops[0].operations.length).toBe(3);
    expect(ops[0].operations.every((x) => x.type === "slide.update")).toBeTruthy();
  }

  {
    const intent = { type: "RESEARCH_MORE", target: {}, content: "市场规模" };
    const ops = planOperations(intent, doc);
    expect(ops.length).toBe(1);
    expect(ops[0].type).toBe("slide.add");
    expect(ops[0].slide.elements?.[0]?.content?.includes("市场规模")).toBeTruthy();
  }

  {
    const intent = { type: "ADD_FILE", target: { slideIndex: 0 }, content: "文件" };
    const ops = planOperations(intent, doc);
    expect(ops.length).toBe(1);
    expect(ops[0].type).toBe("element.add");
    expect(ops[0].slideIndex).toBe(0);
    expect(ops[0].element._filePlaceholder).toBe(true);
  }

  {
    // 触发 insert slide 的 clampIndex=null 分支（越界 index）
    const intent = { type: "INSERT_SLIDE", target: { slideIndex: 999 } };
    const ops = planOperations(intent, doc);
    expect(ops.length).toBe(1);
    expect(ops[0].index).toBe(doc.getSlideCount());
  }

  {
    // 触发 delete slide：slidesCount<=1 分支
    const doc2 = new SlideDocument();
    doc2.load([{ id: "only", type: "freeform", background: "#fff", elements: [] }]);
    const ops = planOperations({ type: "DELETE_SLIDE", target: { slideIndex: 0 } }, doc2);
    expect(ops).toEqual([]);
  }

  {
    // 触发 ADD_FILE 的 fallback element id 分支（无 _generateId）
    const plainDoc = {
      slides: [{ id: "p1", type: "freeform", background: "#fff", elements: [] }],
    };
    const ops = planOperations({ type: "ADD_FILE", target: { slideIndex: 0 } }, plainDoc);
    expect(ops.length).toBe(1);
    expect(String(ops[0].element.id).startsWith("el_")).toBeTruthy();
  }

  {
    // 触发 getSlides(Array) 分支
    const plainSlides = [{ id: "a1", type: "freeform", background: "#fff", elements: [] }];
    const ops = planOperations({ type: "INSERT_SLIDE", target: { slideIndex: 0 } }, plainSlides);
    expect(ops.length).toBe(1);
    expect(ops[0].type).toBe("slide.add");
  }
});

test("SlideDocument.applyOperations: updates document + PPTGenerator.slides + history", async () => {
  await setupBrowserGlobals();

  const SlideDocument = globalThis.SlideDocument;
  const doc = new SlideDocument();
  doc.load([{ id: "s1", type: "freeform", background: "#fff", elements: [{ id: "t1", type: "text", content: "A", x: "5%", y: "5%", w: "90%", h: "auto", z: 1 }] }]);

  // 模拟 PPTGenerator 数据源
  globalThis.PPTGenerator = { slides: doc.toJSON() };

  const pushed = [];
  const history = { push: (op) => pushed.push(op) };

  const ops = [
    { id: "op1", type: "element.update", slideIndex: 0, elementId: "t1", timestamp: Date.now(), changes: [{ path: "content", oldValue: "A", newValue: "B" }] },
  ];

  const applied = doc.applyOperations(ops, { history });
  expect(applied.length > 0).toBe(true);
  expect(doc.getElementById("t1").content).toBe("B");
  expect(globalThis.PPTGenerator.slides[0].elements[0].content).toBe("B");
  expect(pushed.length).toBe(1);
  expect(pushed[0].type).toBe("element.update");
});

test("Serialize: documentToHtml/htmlToDocument roundtrip keeps IDs", async () => {
  await setupBrowserGlobals();

  // 静音 SlideParser 的 debug log，避免污染测试输出
  const origLog = console.log;
  console.log = () => {};
  try {
    const SlideDocument = globalThis.SlideDocument;
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
    expect(html.includes('id="slide-keep-id"')).toBeTruthy();
    expect(html.includes('id="title-id"')).toBeTruthy();
    expect(html.includes('id="group-id"')).toBeTruthy();
    expect(html.includes('id="child-id"')).toBeTruthy();

    const doc2 = htmlToDocument(html);
    const slides = typeof doc2.getSlides === "function" ? doc2.getSlides() : doc2.slides;
    expect(slides[0].id).toBe("slide-keep-id");
    expect(slides[0].elements[0].id).toBe("title-id");

    const html2 = documentToHtml(doc2);
    expect(html2.includes('id="slide-keep-id"')).toBeTruthy();
    expect(html2.includes('id="title-id"')).toBeTruthy();
  } finally {
    console.log = origLog;
  }
});

test.skip("Serialize: covers element types + incremental + parser fallback paths", async () => {
  await setupBrowserGlobals();

  const { parseHTML } = await import("linkedom");

  const origLog = console.log;
  console.log = () => {};
  try {
    const SlideDocument = globalThis.SlideDocument;
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
    expect(html1.includes('section data-type="freeform"')).toBeTruthy();
    expect(html1.includes('data-gradient="linear-gradient')).toBeTruthy();
    expect(html1.includes('data-bg-image="asset://bg"')).toBeTruthy();
    expect(html1.includes('data-el="table"')).toBeTruthy();
    expect(html1.includes('data-el="list"')).toBeTruthy();
    expect(html1.includes('data-el="card"')).toBeTruthy();
    expect(html1.includes('data-el="group"')).toBeTruthy();
    expect(html1.includes('id="u1"')).toBeTruthy();
    expect(html1.includes('data-x="10%"')).toBeTruthy(); // number → %

    // 只改第二页背景，走增量替换 + cssEscape fallback（slide:1 含特殊字符）
    doc.updateSlide(1, { background: "#eeeeee", backgroundImage: null });
    const html2 = documentToHtml(doc, { baseHtml: html1, onlySlideIndexes: [1] });
    expect(html2.includes('id="slide-2"')).toBeTruthy();
    expect(html2.includes('data-bg="#eeeeee"')).toBeTruthy();

    // htmlToDocument：hasDom=true 分支（提供全局 document）
    const { document: domDoc, window: domWin } = parseHTML("<html><body></body></html>");
    const prevDoc = globalThis.document;
    const prevWin = globalThis.window;
    globalThis.document = domDoc;
    globalThis.window = domWin;
    try {
      const docFromDom = htmlToDocument(html2);
      expect(typeof docFromDom.getSlideCount === "function").toBe(true);
      expect(docFromDom.getSlideCount()).toBe(2);
    } finally {
      globalThis.document = prevDoc;
      globalThis.window = prevWin;
    }

    // htmlToDocument：getSlideParser(require) 分支 + SlideDocument 不存在分支
    const prevParser = globalThis.SlideParser;
    const prevDocCtor = globalThis.SlideDocument;
    delete globalThis.SlideParser;
    delete globalThis.SlideDocument;
    try {
      const out = htmlToDocument(html2);
      expect(out && Array.isArray(out.slides)).toBeTruthy();
      expect(out.slides[0].id).toBe("slide:1");
    } finally {
      globalThis.SlideParser = prevParser;
      globalThis.SlideDocument = prevDocCtor;
    }
  } finally {
    console.log = origLog;
  }
});
