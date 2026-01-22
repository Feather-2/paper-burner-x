/**
 * Document ↔ HTML DSL 序列化
 * - documentToHtml(document): SlideDocument → HTML DSL
 * - htmlToDocument(html): HTML DSL → SlideDocument（复用 SlideParser）
 *
 * 设计目标：
 * - roundtrip ID 稳定：slide.id / element.id → HTML id → parse 回来不变
 * - 增量序列化：基于 baseHtml 只替换变更 section
 */
(function initPptDslSerialize(global) {
  function deepCopy(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function ensureDom() {
    if (typeof document !== "undefined" && document && typeof document.createElement === "function") {
      return { document, window: typeof window !== "undefined" ? window : global };
    }
    // Node.js: 使用 linkedom
    // eslint-disable-next-line global-require
    const { parseHTML } = require("linkedom");
    const { document: doc, window: win } = parseHTML("<html><body></body></html>");
    return { document: doc, window: win };
  }

  function coerceCoord(v) {
    if (v === undefined || v === null) return undefined;
    if (typeof v === "number") return `${v}%`;
    const s = String(v).trim();
    if (!s) return undefined;
    return s;
  }

  function setAttr(attrs, k, v) {
    if (v === undefined || v === null) return;
    const s = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
    if (s === "") return;
    attrs[k] = s;
  }

	  function escapeAttr(v) {
	    return String(v)
	      .replace(/&/g, "&amp;")
	      .replace(/"/g, "&quot;")
	      .replace(/</g, "&lt;")
	      .replace(/>/g, "&gt;");
	  }

	  function escapeHtml(str) {
	    if (str == null) return "";
	    return String(str)
	      .replace(/&/g, "&amp;")
	      .replace(/</g, "&lt;")
	      .replace(/>/g, "&gt;")
	      .replace(/"/g, "&quot;")
	      .replace(/'/g, "&#39;");
	  }

	  function decodeHtmlEntities(str) {
	    if (str == null) return "";
	    const { document: domDoc } = ensureDom();
	    const textarea = domDoc.createElement("textarea");
	    textarea.innerHTML = String(str);
	    return textarea.value;
	  }

	  function attrsToString(attrs) {
	    return Object.entries(attrs)
	      .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
	      .join("");
	  }

  function cssEscapeIdent(id) {
    const s = String(id);
    if (global.CSS && typeof global.CSS.escape === "function") return global.CSS.escape(s);
    // 简易 fallback：足够用于 querySelector('#id') 的常见情况
    return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  }

  function elementToHtml(el) {
    if (!el || typeof el !== "object") return "";

    const attrs = { "data-el": el.type || "unknown" };
    setAttr(attrs, "id", el.id);

    // 通用定位属性（与 SlideParser 对齐：优先读 style，其次 data-*）
    setAttr(attrs, "data-x", coerceCoord(el.x));
    setAttr(attrs, "data-y", coerceCoord(el.y));
    setAttr(attrs, "data-w", coerceCoord(el.w));
    setAttr(attrs, "data-h", coerceCoord(el.h));
    setAttr(attrs, "data-z", el.z);
    setAttr(attrs, "data-rotate", el.rotate ?? el.rotation);
    setAttr(attrs, "data-opacity", el.opacity);
    setAttr(attrs, "data-blend", el.blend);
    setAttr(attrs, "data-filter", el.filter);
    setAttr(attrs, "data-mask", el.mask);
    setAttr(attrs, "data-outline", el.outline);
    setAttr(attrs, "data-effect", el.effect);

    switch (el.type) {
	      case "text": {
	        setAttr(attrs, "data-font", el.fontSize ?? el.font);
	        setAttr(attrs, "data-color", el.color);
	        setAttr(attrs, "data-bold", el.bold);
        setAttr(attrs, "data-italic", el.italic);
        setAttr(attrs, "data-align", el.align);
        setAttr(attrs, "data-valign", el.valign);
	        setAttr(attrs, "data-line-height", el.lineHeight);
	        setAttr(attrs, "data-font-family", el.fontFamily);
	        const content = el.content ?? "";
	        return `<div${attrsToString(attrs)}>${escapeHtml(content)}</div>`;
	      }

      case "shape": {
        setAttr(attrs, "data-shape", el.shape ?? el.shapeType);
        setAttr(attrs, "data-fill", el.fill);
        setAttr(attrs, "data-stroke", el.stroke);
        setAttr(attrs, "data-stroke-width", el.strokeWidth);
        setAttr(attrs, "data-radius", el.radius ?? el.borderRadius);
        setAttr(attrs, "data-gradient", el.gradient);
        setAttr(attrs, "data-shadow", el.shadow);
        return `<div${attrsToString(attrs)}></div>`;
      }

      case "image": {
        setAttr(attrs, "data-src", el.src ?? el.assetId ?? "");
        setAttr(attrs, "data-alt", el.alt ?? "图片");
        setAttr(attrs, "data-fit", el.fit ?? el.objectFit);
        setAttr(attrs, "data-radius", el.radius);
        setAttr(attrs, "data-border", el.border);
        setAttr(attrs, "data-file-placeholder", el._filePlaceholder);
        return `<div${attrsToString(attrs)}></div>`;
      }

      case "icon": {
        setAttr(attrs, "data-icon", el.icon);
        setAttr(attrs, "data-size", el.size);
        setAttr(attrs, "data-color", el.color);
        return `<div${attrsToString(attrs)}></div>`;
      }

      case "line": {
        setAttr(attrs, "data-x1", coerceCoord(el.x1));
        setAttr(attrs, "data-y1", coerceCoord(el.y1));
        setAttr(attrs, "data-x2", coerceCoord(el.x2));
        setAttr(attrs, "data-y2", coerceCoord(el.y2));
        setAttr(attrs, "data-stroke", el.stroke);
        setAttr(attrs, "data-stroke-width", el.strokeWidth);
        setAttr(attrs, "data-dash", el.dash);
        return `<div${attrsToString(attrs)}></div>`;
      }

	      case "chart": {
	        setAttr(attrs, "data-chart-type", el.chartType);
	        setAttr(attrs, "data-chart-data", el.chartData);
	        setAttr(attrs, "data-colors", el.colors);
	        const title = el.title ?? "";
	        return `<div${attrsToString(attrs)}>${escapeHtml(title)}</div>`;
	      }

	      case "formula": {
	        setAttr(attrs, "data-latex", el.latex);
	        setAttr(attrs, "data-font", el.font);
	        setAttr(attrs, "data-color", el.color);
	        setAttr(attrs, "data-align", el.align);
	        setAttr(attrs, "data-display-mode", el.displayMode);
	        const latex = el.latex ?? "";
	        return `<div${attrsToString(attrs)}>${escapeHtml(latex)}</div>`;
	      }

      case "svg": {
        setAttr(attrs, "data-svg", el.content ? "inline" : undefined);
        setAttr(attrs, "data-bg-color", el.bgColor);
        setAttr(attrs, "data-radius", el.radius);
        setAttr(attrs, "data-preserve-aspect-ratio", el.preserveAspectRatio);
        const content = el.content ?? "";
        return `<div${attrsToString(attrs)}>${content}</div>`;
      }

      case "table": {
        const data = el.data !== undefined ? JSON.stringify(el.data) : undefined;
        setAttr(attrs, "data-data", data);
        setAttr(attrs, "data-style", el.style);
        setAttr(attrs, "data-theme", el.theme);
        return `<div${attrsToString(attrs)}></div>`;
      }

      case "list": {
        const items = el.items !== undefined ? JSON.stringify(el.items) : undefined;
        setAttr(attrs, "data-items", items);
        setAttr(attrs, "data-bullet", el.bullet);
        setAttr(attrs, "data-gap", el.gap);
        return `<div${attrsToString(attrs)}></div>`;
      }

      case "card": {
        setAttr(attrs, "data-layout", el.layout);
        setAttr(attrs, "data-fill", el.fill);
        setAttr(attrs, "data-radius", el.radius);
        setAttr(attrs, "data-padding", el.padding);
        setAttr(attrs, "data-shadow", el.shadow);
        setAttr(attrs, "data-icon", el.icon);
        setAttr(attrs, "data-icon-size", el.iconSize);
        setAttr(attrs, "data-icon-color", el.iconColor);
        setAttr(attrs, "data-icon-bg", el.iconBg);
        setAttr(attrs, "data-title", el.title);
        setAttr(attrs, "data-title-size", el.titleSize);
        setAttr(attrs, "data-title-color", el.titleColor);
        setAttr(attrs, "data-title-bold", el.titleBold);
        setAttr(attrs, "data-subtitle", el.subtitle);
        setAttr(attrs, "data-subtitle-size", el.subtitleSize);
        setAttr(attrs, "data-subtitle-color", el.subtitleColor);
        setAttr(attrs, "data-stroke", el.stroke);
        setAttr(attrs, "data-stroke-width", el.strokeWidth);
        return `<div${attrsToString(attrs)}></div>`;
      }

      case "group": {
        const children = Array.isArray(el.children) ? el.children : [];
        const inner = children.map((c) => elementToHtml(c)).join("\n    ");
        return `<div${attrsToString(attrs)}>\n    ${inner}\n</div>`;
      }

      default:
        return `<div${attrsToString(attrs)}></div>`;
    }
  }

  function slideToHtml(slide) {
    if (!slide || typeof slide !== "object") return "";
    const attrs = { "data-type": slide.type || "freeform" };
    setAttr(attrs, "id", slide.id);

    if (slide.backgroundGradient) setAttr(attrs, "data-gradient", slide.backgroundGradient);
    else if (slide.backgroundImage) setAttr(attrs, "data-bg-image", slide.backgroundImage);
    else setAttr(attrs, "data-bg", slide.background ?? "#ffffff");

    const elements = Array.isArray(slide.elements) ? slide.elements : [];
    const body = elements.map((el) => elementToHtml(el)).join("\n  ");
    return `<section${attrsToString(attrs)}>\n  ${body}\n</section>`;
  }

  function resolveSlidesForSerialize(doc, options) {
    const slides =
      (doc && typeof doc.getSlides === "function" && doc.getSlides()) ||
      (doc && Array.isArray(doc.slides) && doc.slides) ||
      (Array.isArray(doc) ? doc : []);

    if (!options) return { slides, indexes: slides.map((_, i) => i) };

    if (Array.isArray(options.onlySlideIndexes)) {
      const set = new Set(options.onlySlideIndexes.map((i) => Number(i)).filter((n) => Number.isFinite(n)));
      const indexes = [...set].sort((a, b) => a - b).filter((i) => i >= 0 && i < slides.length);
      return { slides, indexes };
    }

    if (Array.isArray(options.onlySlideIds)) {
      const idSet = new Set(options.onlySlideIds.map(String));
      const indexes = [];
      for (let i = 0; i < slides.length; i++) if (idSet.has(String(slides[i]?.id))) indexes.push(i);
      return { slides, indexes };
    }

    return { slides, indexes: slides.map((_, i) => i) };
  }

  /**
   * documentToHtml(document, options?)
   * options:
   * - baseHtml: string（用于增量替换）
   * - onlySlideIds / onlySlideIndexes: 仅序列化指定 slides
   */
  function documentToHtml(doc, options = {}) {
    const { slides, indexes } = resolveSlidesForSerialize(doc, options);
    const sections = indexes.map((i) => slideToHtml(slides[i])).filter(Boolean);

    // 增量替换：用新 section 替换 baseHtml 中同 id 的 section
    if (typeof options.baseHtml === "string") {
      const { document: domDoc } = ensureDom();
      const container = domDoc.createElement("div");
      container.innerHTML = options.baseHtml;

      for (const i of indexes) {
        const slide = slides[i];
        if (!slide?.id) continue;
        const existing = container.querySelector(`section#${cssEscapeIdent(slide.id)}`);
        const freshContainer = domDoc.createElement("div");
        freshContainer.innerHTML = slideToHtml(slide);
        const freshSection = freshContainer.querySelector("section");

        if (existing && freshSection) existing.replaceWith(freshSection);
        else if (freshSection) container.appendChild(freshSection);
      }

      return container.innerHTML;
    }

    return sections.join("\n\n");
  }

  function getSlideParser() {
    const candidate = typeof globalThis !== "undefined" ? globalThis.SlideParser : global.SlideParser;
    if (candidate && typeof candidate.parse === "function") return candidate;
    return null;
  }

  function normalizeParsedSlides(slides) {
    const normalizeElements = (elements) => {
      if (!Array.isArray(elements)) return;
      for (const el of elements) {
        if (!el || typeof el !== "object") continue;
        if (el.type === "text" && typeof el.content === "string") {
          el.content = escapeHtml(decodeHtmlEntities(el.content));
        }
        if (el.type === "group" && Array.isArray(el.children)) normalizeElements(el.children);
      }
    };

    if (!Array.isArray(slides)) return slides;
    for (const slide of slides) {
      if (!slide || typeof slide !== "object") continue;
      normalizeElements(slide.elements);
    }
    return slides;
  }

  async function loadSlideParser() {
    const existing = getSlideParser();
    if (existing) return existing;

    try {
      if (typeof require === "function") {
        // eslint-disable-next-line global-require
        const m = require("../core/slide-parser.js");
        const SlideParserMod = m?.SlideParser ?? m?.default?.SlideParser ?? m?.default;
        if (SlideParserMod && typeof SlideParserMod.parse === "function") {
          globalThis.SlideParser = SlideParserMod;
          global.SlideParser = SlideParserMod;
          return SlideParserMod;
        }
      }
    } catch {
      // ignore
    }

    try {
      await import("../core/slide-parser.js");
      return getSlideParser();
    } catch {
      // ignore
    }

    return null;
  }

  /**
   * htmlToDocument(html)
   * - 复用 SlideParser.parse
   * - 默认返回 SlideDocument（若可用），否则返回 { slides }
   */
  function htmlToDocument(html) {
    const parser = getSlideParser();
    if (!parser) throw new Error("SlideParser 未加载");

    const input = String(html || "");

    // SlideParser.parse 依赖全局 document；Node 环境下临时注入
    const hasDom = typeof document !== "undefined" && document && typeof document.createElement === "function";
    if (!hasDom) {
      const { document: domDoc, window: domWin } = ensureDom();
      const prevDoc = global.document;
      const prevWin = global.window;
      try {
        global.window = domWin;
        global.document = domDoc;
        const slides = normalizeParsedSlides(deepCopy(parser.parse(input)));
        const SlideDocumentCtor = (typeof globalThis !== "undefined" && globalThis.SlideDocument) || global.SlideDocument;
        if (SlideDocumentCtor) {
          const d = new SlideDocumentCtor();
          d.load(slides);
          return d;
        }
        return { slides };
      } finally {
        global.document = prevDoc;
        global.window = prevWin;
      }
    }

    const slides = normalizeParsedSlides(deepCopy(parser.parse(input)));
    const SlideDocumentCtor = (typeof globalThis !== "undefined" && globalThis.SlideDocument) || global.SlideDocument;
    if (SlideDocumentCtor) {
      const d = new SlideDocumentCtor();
      d.load(slides);
      return d;
    }
    return { slides };
  }

  global.PPTDSLSerialize = { documentToHtml, htmlToDocument, loadSlideParser };
  if (typeof globalThis !== "undefined") globalThis.PPTDSLSerialize = global.PPTDSLSerialize;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { documentToHtml, htmlToDocument, loadSlideParser, _internal: { elementToHtml, slideToHtml } };
  }
})(typeof window !== "undefined" ? window : globalThis);

// Best-effort preload for tests/Node environments.
try {
  await globalThis?.PPTDSLSerialize?.loadSlideParser?.();
} catch {
  // ignore
}
