/**
 * Operation Planner - Intent → Operation[]
 * 目标：将结构化 Intent 转为可回放的编辑操作（对齐 docs/EDITOR_ARCHITECTURE.md）
 */
(function initOperationPlanner(global) {
  function now() {
    return Date.now();
  }

  function genId(prefix = "op") {
    return `${prefix}_${now()}_${Math.random().toString(16).slice(2, 8)}`;
  }

  function deepCopy(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function getSlides(document) {
    if (!document) return [];
    if (typeof document.getSlides === "function") return document.getSlides() || [];
    if (Array.isArray(document.slides)) return document.slides;
    if (Array.isArray(document)) return document;
    return [];
  }

  function getSlide(document, index) {
    if (!document) return null;
    if (typeof document.getSlide === "function") return document.getSlide(index);
    const slides = getSlides(document);
    return slides[index] || null;
  }

  function getSlideCount(document) {
    if (!document) return 0;
    if (typeof document.getSlideCount === "function") return document.getSlideCount();
    return getSlides(document).length;
  }

  function clampIndex(i, maxExclusive) {
    if (!Number.isFinite(i)) return null;
    const n = Math.floor(i);
    if (n < 0 || n >= maxExclusive) return null;
    return n;
  }

  function parseNum(v) {
    if (v === undefined || v === null) return null;
    const n = typeof v === "number" ? v : Number.parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  }

  function pickTitleElement(slide) {
    const elements = Array.isArray(slide?.elements) ? slide.elements : [];
    const texts = elements.filter((e) => e && e.type === "text");
    if (texts.length === 0) return null;

    const score = (e) => {
      const font = parseNum(e.fontSize) ?? parseNum(e.font) ?? 0;
      const y = parseNum(e.y) ?? 0;
      // font 越大越像标题，y 越小越靠上
      return font * 1000 - y;
    };

    let best = texts[0];
    let bestScore = score(best);
    for (let i = 1; i < texts.length; i++) {
      const s = score(texts[i]);
      if (s > bestScore) {
        best = texts[i];
        bestScore = s;
      }
    }
    return best || null;
  }

  function resolveElement(slide, selector) {
    const elements = Array.isArray(slide?.elements) ? slide.elements : [];
    if (!selector) return null;

    // #id
    const m = String(selector).match(/^#([\w-]+)$/);
    if (m) {
      const id = m[1];
      return elements.find((e) => e?.id === id) || null;
    }

    const key = String(selector).toLowerCase();
    if (key === "title" || key === "标题") return pickTitleElement(slide);

    // fallback：第一个 text
    return elements.find((e) => e?.type === "text") || null;
  }

  function makeDefaultSlide(document) {
    const id =
      (document && typeof document._generateId === "function" && document._generateId()) ||
      `slide_${now()}_${Math.random().toString(16).slice(2, 8)}`;
    return { id, type: "freeform", background: "#ffffff", elements: [] };
  }

  function makeTextElement(document, opts) {
    if (document && typeof document.createTextElement === "function") return document.createTextElement(opts || {});

    const id =
      (document && typeof document._generateId === "function" && document._generateId()) ||
      `el_${now()}_${Math.random().toString(16).slice(2, 8)}`;
    return {
      id,
      type: "text",
      x: opts?.x ?? "5%",
      y: opts?.y ?? "8%",
      w: opts?.w ?? "90%",
      h: opts?.h ?? "auto",
      z: opts?.z ?? 1,
      content: opts?.content ?? "",
      font: opts?.font ?? 32,
      color: opts?.color ?? "#111827",
      bold: opts?.bold ?? true,
      align: opts?.align ?? "left",
    };
  }

  function opBase(type) {
    return { id: genId("op"), type, timestamp: now(), changes: [] };
  }

  function wrapBatch(ops, description) {
    return {
      id: genId("batch"),
      type: "batch",
      timestamp: now(),
      description: description || "",
      changes: [],
      operations: ops,
    };
  }

  /**
   * planOperations(intent, document)
   * @returns {Array} Operation[]
   */
  function planOperations(intent, document) {
    const slidesCount = getSlideCount(document);
    const t = intent && typeof intent === "object" ? intent : { type: "" };
    const target = t.target && typeof t.target === "object" ? t.target : {};

    switch (t.type) {
      case "INSERT_SLIDE": {
        const position = target.position === "before" ? "before" : "after";
        const ref = clampIndex(target.slideIndex, Math.max(1, slidesCount));
        const insertIndex = ref === null ? slidesCount : position === "before" ? ref : ref + 1;
        const slide = makeDefaultSlide(document);
        const op = {
          ...opBase("slide.add"),
          slideId: slide.id,
          index: insertIndex,
          slide: deepCopy(slide),
        };
        return [op];
      }

      case "DELETE_SLIDE": {
        const idx = clampIndex(target.slideIndex, slidesCount);
        if (idx === null) return [];
        if (slidesCount <= 1) return [];
        const slide = getSlide(document, idx);
        if (!slide) return [];
        const op = {
          ...opBase("slide.delete"),
          slideId: slide.id,
          index: idx,
          slide: deepCopy(slide),
        };
        return [op];
      }

      case "MODIFY_ELEMENT": {
        const idx = clampIndex(target.slideIndex, slidesCount);
        if (idx === null) return [];
        const slide = getSlide(document, idx);
        if (!slide) return [];

        const element = resolveElement(slide, target.elementSelector || "title");
        if (!element) return [];

        // 当前仅实现“改文字内容”，后续可扩展为多字段/多元素
        const newContent = typeof t.content === "string" ? t.content : null;
        if (newContent === null) return [];

        const changes = [{ path: "content", oldValue: element.content, newValue: newContent }];
        return [
          {
            ...opBase("element.update"),
            slideId: slide.id,
            slideIndex: idx,
            elementId: element.id,
            changes,
          },
        ];
      }

      case "REDO_SLIDE": {
        const idx = clampIndex(target.slideIndex, slidesCount);
        if (idx === null) return [];
        const slide = getSlide(document, idx);
        if (!slide) return [];
        const oldValue = slide._redo || null;
        const newValue = { requestedAt: now(), mode: "slide" };
        return [
          {
            ...opBase("slide.update"),
            slideId: slide.id,
            slideIndex: idx,
            changes: [{ path: "_redo", oldValue, newValue }],
          },
        ];
      }

      case "REDO_RANGE": {
        const r = Array.isArray(target.slideRange) ? target.slideRange : null;
        if (!r || r.length !== 2) return [];
        const start = clampIndex(r[0], slidesCount);
        const end = clampIndex(r[1], slidesCount);
        if (start === null || end === null) return [];

        const ops = [];
        for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
          const slide = getSlide(document, i);
          if (!slide) continue;
          const oldValue = slide._redo || null;
          const newValue = { requestedAt: now(), mode: "range" };
          ops.push({
            ...opBase("slide.update"),
            slideId: slide.id,
            slideIndex: i,
            changes: [{ path: "_redo", oldValue, newValue }],
          });
        }
        if (ops.length <= 1) return ops;
        return [wrapBatch(ops, "重做范围")];
      }

      case "RESEARCH_MORE": {
        const insertIndex = slidesCount;
        const slide = makeDefaultSlide(document);
        const topic = typeof t.content === "string" ? t.content.trim() : "";
        slide.elements = [
          makeTextElement(document, {
            content: topic ? `TODO：补充关于「${topic}」的内容` : "TODO：补充内容",
            x: "5%",
            y: "8%",
            w: "90%",
            h: "auto",
            font: 28,
            bold: true,
          }),
        ];

        const op = {
          ...opBase("slide.add"),
          slideId: slide.id,
          index: insertIndex,
          slide: deepCopy(slide),
        };
        return [op];
      }

      case "ADD_FILE": {
        // 交由 UI 触发文件选择：这里用一个 placeholder 元素占位
        const idx = clampIndex(target.slideIndex ?? 0, slidesCount);
        if (idx === null) return [];
        const slide = getSlide(document, idx);
        if (!slide) return [];

        const element =
          (document && typeof document._generateId === "function" && {
            id: document._generateId(),
            type: "image",
            x: "10%",
            y: "20%",
            w: "80%",
            h: "60%",
            z: 10,
            src: "",
            alt: "待添加文件",
            _filePlaceholder: true,
          }) || {
            id: `el_${now()}_${Math.random().toString(16).slice(2, 8)}`,
            type: "image",
            x: "10%",
            y: "20%",
            w: "80%",
            h: "60%",
            z: 10,
            src: "",
            alt: "待添加文件",
            _filePlaceholder: true,
          };

        const index = Array.isArray(slide.elements) ? slide.elements.length : 0;
        return [
          {
            ...opBase("element.add"),
            slideId: slide.id,
            slideIndex: idx,
            elementId: element.id,
            element: deepCopy(element),
            index,
          },
        ];
      }

      default:
        return [];
    }
  }

  global.OperationPlanner = { planOperations };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { planOperations, _internal: { pickTitleElement, resolveElement, wrapBatch } };
  }
})(typeof window !== "undefined" ? window : globalThis);
