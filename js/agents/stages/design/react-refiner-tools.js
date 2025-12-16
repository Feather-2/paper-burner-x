/**
 * ReactRefiner 工具适配层（Generation 阶段）
 *
 * 所有工具返回统一格式：{success: boolean, data?: any, error?: string}
 */

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function safeIntLike(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return null;
}

function isBrowserEnv() {
  return typeof window !== "undefined" && !!window?.document?.createElement;
}

function escapeAttrSelectorValue(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const TOOL_OPTIONS = Symbol("reactRefinerToolOptions");

// 解析 deckHtmlDsl 中的 <section> 元素
function parseSections(deckHtmlDsl) {
  const html = typeof deckHtmlDsl === "string" ? deckHtmlDsl : "";
  if (!html) return [];

  const lower = html.toLowerCase();
  const sections = [];
  let cursor = 0;

  while (cursor < html.length) {
    const start = lower.indexOf("<section", cursor);
    if (start < 0) break;
    const endTag = lower.indexOf("</section>", start);
    if (endTag < 0) break;
    const end = endTag + "</section>".length;
    const sectionHtml = html.slice(start, end).trim();
    if (sectionHtml) sections.push(sectionHtml);
    cursor = end;
  }

  return sections;
}

// 将修改后的 sections 重新拼接
function joinSections(sections) {
  const parts = Array.isArray(sections) ? sections : [];
  return parts
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

// 从 HTML 中提取元素信息（基于 data-el）
function extractElements(sectionHtml) {
  const html = typeof sectionHtml === "string" ? sectionHtml : "";
  if (!html) return [];

  const out = [];
  const elRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)\bdata-el="([^"]+)"([^>]*)>/g;
  let m;
  while ((m = elRe.exec(html)) !== null) {
    const tag = String(m[1] || "").toLowerCase();
    const dataEl = String(m[3] || "");
    const attrsText = `${m[2] || ""} data-el="${dataEl}" ${m[4] || ""}`.trim();

    const attrs = {};
    const attrRe = /([:@a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
    let am;
    while ((am = attrRe.exec(attrsText)) !== null) {
      attrs[am[1]] = am[2];
    }

    let textPreview = "";
    const start = m.index + m[0].length;
    const rest = html.slice(start);
    const closeRe = new RegExp(`</${tag}\\s*>`, "i");
    const closeIdx = rest.search(closeRe);
    if (closeIdx >= 0) {
      const inner = rest.slice(0, closeIdx);
      if (inner && !inner.includes("<")) {
        textPreview = inner.trim().slice(0, 160);
      }
    }

    out.push({
      elementId: dataEl,
      tag,
      id: attrs.id,
      class: attrs.class,
      attrs,
      ...(textPreview ? { textPreview } : {}),
    });
  }

  return out;
}

async function parseSectionDom(sectionHtml) {
  const html = typeof sectionHtml === "string" ? sectionHtml : "";
  if (!html) return { section: null, serialize: () => "" };

  if (isBrowserEnv()) {
    const container = document.createElement("div");
    container.innerHTML = html.trim();
    const section = container.querySelector("section");
    return { section, serialize: () => (section ? section.outerHTML : html.trim()) };
  }

  const mod = await import("linkedom");
  const { document } = mod.parseHTML(html.trim());
  const section = document.querySelector("section");
  return { section, serialize: () => (section ? section.outerHTML : html.trim()) };
}

function buildSlideIndexError(slideIndex, slideCount) {
  return `Invalid slideIndex: ${String(slideIndex)} (expected 0..${Math.max(0, slideCount - 1)})`;
}

function getSlideCounts(context) {
  const deckHtmlDsl = typeof context?.deckPackage?.deckHtmlDsl === "string" ? context.deckPackage.deckHtmlDsl : "";
  const sections = parseSections(deckHtmlDsl);
  const slideIntents = Array.isArray(context?.contentPackage?.slideIntents) ? context.contentPackage.slideIntents : [];
  const slidesMeta = Array.isArray(context?.deckPackage?.slidesMeta) ? context.deckPackage.slidesMeta : [];
  return { sections, sectionCount: sections.length, intentCount: slideIntents.length, metaCount: slidesMeta.length };
}

function validateSlideIndex(context, rawSlideIndex) {
  const slideIndex = safeIntLike(rawSlideIndex);
  const { sectionCount, intentCount, metaCount } = getSlideCounts(context);
  const maxCount = Math.max(sectionCount, intentCount, metaCount);
  if (slideIndex === null) return { ok: false, error: "slideIndex must be an integer" };
  if (maxCount <= 0) return { ok: false, error: "No slides available" };
  if (slideIndex < 0 || slideIndex >= maxCount) return { ok: false, error: buildSlideIndexError(slideIndex, maxCount) };
  return { ok: true, slideIndex, maxCount };
}

// 1. getSlideContent(slideIndex) - 获取幻灯片 HTML
async function getSlideContent(context, params) {
  try {
    const v = validateSlideIndex(context, params?.slideIndex);
    if (!v.ok) return { success: false, error: `getSlideContent: ${v.error}` };

    const { sections, sectionCount } = getSlideCounts(context);
    if (sectionCount <= 0) return { success: false, error: "getSlideContent: deckHtmlDsl contains no <section> slides" };
    if (v.slideIndex >= sectionCount) return { success: false, error: `getSlideContent: ${buildSlideIndexError(v.slideIndex, sectionCount)}` };

    const html = sections[v.slideIndex] || "";
    const elements = extractElements(html);

    return {
      success: true,
      data: {
        slideIndex: v.slideIndex,
        html,
        elementCount: elements.length,
        elements,
      },
    };
  } catch (err) {
    return { success: false, error: `getSlideContent failed: ${err.message}` };
  }
}

// 2. getSlideContext(slideIndex) - 获取设计上下文
async function getSlideContext(context, params) {
  try {
    const v = validateSlideIndex(context, params?.slideIndex);
    if (!v.ok) return { success: false, error: `getSlideContext: ${v.error}` };

    const slideIntents = Array.isArray(context?.contentPackage?.slideIntents) ? context.contentPackage.slideIntents : [];
    const claimsAll = Array.isArray(context?.contentPackage?.claims) ? context.contentPackage.claims : [];
    const slidesMeta = Array.isArray(context?.deckPackage?.slidesMeta) ? context.deckPackage.slidesMeta : [];
    const imageSlotsAll = Array.isArray(context?.deckPackage?.imageSlots) ? context.deckPackage.imageSlots : [];

    const slideIntent = slideIntents[v.slideIndex] || null;
    const slideMeta = slidesMeta[v.slideIndex] || null;

    const claimIds = Array.isArray(slideIntent?.claimIds) ? slideIntent.claimIds.map((x) => String(x)) : [];
    const claimSet = new Set(claimIds);
    const claims = claimSet.size ? claimsAll.filter((c) => claimSet.has(String(c?.claimId))) : [];

    const imageSlots = imageSlotsAll.filter((s) => Number.isFinite(s?.slideIndex) && s.slideIndex === v.slideIndex);

    return {
      success: true,
      data: {
        slideIndex: v.slideIndex,
        slideIntent,
        slideMeta,
        claims,
        imageSlots,
      },
    };
  } catch (err) {
    return { success: false, error: `getSlideContext failed: ${err.message}` };
  }
}

const TRANSPARENT_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7W7WQAAAAASUVORK5CYII=";

function pickPptExportImage() {
  if (!isBrowserEnv()) return null;
  if (typeof window.PPTGeneratorExportImage === "object" && window.PPTGeneratorExportImage) return window.PPTGeneratorExportImage;
  if (typeof globalThis.PPTGeneratorExportImage === "object" && globalThis.PPTGeneratorExportImage) return globalThis.PPTGeneratorExportImage;
  return null;
}

// 3. screenshot(slideIndex) - 截图（base64）
async function screenshot(context, params) {
  try {
    const v = validateSlideIndex(context, params?.slideIndex);
    if (!v.ok) return { success: false, error: `screenshot: ${v.error}` };

    const { sections, sectionCount } = getSlideCounts(context);
    if (sectionCount <= 0) return { success: false, error: "screenshot: deckHtmlDsl contains no <section> slides" };
    if (v.slideIndex >= sectionCount) return { success: false, error: `screenshot: ${buildSlideIndexError(v.slideIndex, sectionCount)}` };

    const sectionHtml = sections[v.slideIndex] || "";
    const renderer = context?.[TOOL_OPTIONS]?.screenshotRenderer;
    if (typeof renderer === "function") {
      const res = await renderer({ slideIndex: v.slideIndex, sectionHtml, deckPackage: context.deckPackage, contentPackage: context.contentPackage });
      if (typeof res === "string") {
        const dataUrl = res.startsWith("data:image/") ? res : `data:image/png;base64,${res}`;
        return { success: true, data: { slideIndex: v.slideIndex, base64: dataUrl } };
      }
      if (res && typeof res === "object") {
        if (typeof res.toDataURL === "function") {
          return { success: true, data: { slideIndex: v.slideIndex, base64: res.toDataURL("image/png") } };
        }
        const dataUrl = toNonEmptyString(res.dataUrl) || toNonEmptyString(res.base64);
        if (dataUrl) {
          const out = dataUrl.startsWith("data:image/") ? dataUrl : `data:image/png;base64,${dataUrl}`;
          return { success: true, data: { slideIndex: v.slideIndex, base64: out, ...(isPlainObject(res.meta) ? { meta: res.meta } : {}) } };
        }
      }
    }

    if (!isBrowserEnv()) {
      return { success: true, data: { slideIndex: v.slideIndex, base64: TRANSPARENT_PNG_DATA_URL, mock: true, note: "screenshot not available in Node.js" } };
    }

    const exportImage = pickPptExportImage();
    if (!exportImage || typeof exportImage._captureToCanvas !== "function") {
      return { success: false, error: "screenshot: PPTGeneratorExportImage._captureToCanvas not available (provide screenshotRenderer or run in PPT editor)" };
    }

    const container = document.createElement("div");
    container.style.cssText = "position: fixed; left: -9999px; top: 0; width: 960px; height: 540px; z-index: -9999;";
    document.body.appendChild(container);

    try {
      container.innerHTML = `<div style="width: 960px; height: 540px; overflow: hidden;">${sectionHtml}</div>`;
      const target = container.firstChild;
      if (!target) return { success: false, error: "screenshot: failed to mount slide HTML" };

      const scale = Number.isFinite(params?.scale) ? params.scale : 2;
      const canvas = await exportImage._captureToCanvas(target, {
        scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        logging: false,
        foreignObjectRendering: false,
        removeContainer: true,
      });

      const base64 = canvas?.toDataURL ? canvas.toDataURL("image/png") : "";
      if (!base64) return { success: false, error: "screenshot: capture returned empty canvas" };

      return { success: true, data: { slideIndex: v.slideIndex, base64 } };
    } finally {
      try {
        document.body.removeChild(container);
      } catch {}
    }
  } catch (err) {
    return { success: false, error: `screenshot failed: ${err.message}` };
  }
}

function applyAttrChanges(el, attrs) {
  if (!el || !isPlainObject(attrs)) return;
  for (const [k, v] of Object.entries(attrs)) {
    const key = toNonEmptyString(k);
    if (!key) continue;
    if (v === null || v === undefined) el.removeAttribute(key);
    else el.setAttribute(key, String(v));
  }
}

// 4. editSlide(slideIndex, changes) - 编辑幻灯片
async function editSlide(context, params) {
  try {
    const v = validateSlideIndex(context, params?.slideIndex);
    if (!v.ok) return { success: false, error: `editSlide: ${v.error}` };

    const changes = isPlainObject(params?.changes) ? params.changes : null;
    if (!changes) return { success: false, error: "editSlide: changes must be an object" };

    const deckHtmlDsl = typeof context?.deckPackage?.deckHtmlDsl === "string" ? context.deckPackage.deckHtmlDsl : "";
    const sections = parseSections(deckHtmlDsl);
    if (!sections.length) return { success: false, error: "editSlide: deckHtmlDsl contains no <section> slides" };
    if (v.slideIndex >= sections.length) return { success: false, error: `editSlide: ${buildSlideIndexError(v.slideIndex, sections.length)}` };

    const rawHtml = toNonEmptyString(changes.html);
    const replaceWithSection = rawHtml && /<section\b/i.test(rawHtml) && /<\/section>/i.test(rawHtml);

    let updatedSection = sections[v.slideIndex];
    if (replaceWithSection) {
      const m = rawHtml.match(/<section\b[\s\S]*<\/section>/i);
      updatedSection = (m ? m[0] : rawHtml).trim();
    } else {
      const { section, serialize } = await parseSectionDom(updatedSection);
      if (!section) return { success: false, error: "editSlide: failed to parse target <section>" };

      const bg = toNonEmptyString(changes.background);
      if (bg) section.setAttribute("data-bg", bg);

      const title = toNonEmptyString(changes.title);
      if (title) section.setAttribute("data-title", title);

      const layout = toNonEmptyString(changes.layout);
      if (layout) section.setAttribute("data-layout", layout);

      const type = toNonEmptyString(changes.type);
      if (type) section.setAttribute("data-type", type);

      applyAttrChanges(section, changes.attrs);

      if (rawHtml && !replaceWithSection) {
        section.innerHTML = rawHtml;
      }

      updatedSection = serialize();
    }

    sections[v.slideIndex] = updatedSection;
    const nextDeckHtmlDsl = joinSections(sections);
    if (!context.deckPackage) context.deckPackage = {};
    context.deckPackage.deckHtmlDsl = nextDeckHtmlDsl;

    return {
      success: true,
      data: {
        slideIndex: v.slideIndex,
        updatedSectionHtml: updatedSection,
        deckPackage: { ...(context.deckPackage || {}), deckHtmlDsl: nextDeckHtmlDsl },
      },
    };
  } catch (err) {
    return { success: false, error: `editSlide failed: ${err.message}` };
  }
}

// 5. editElement(slideIndex, elementId, changes) - 编辑元素
async function editElement(context, params) {
  try {
    const v = validateSlideIndex(context, params?.slideIndex);
    if (!v.ok) return { success: false, error: `editElement: ${v.error}` };

    const elementId = toNonEmptyString(params?.elementId);
    if (!elementId) return { success: false, error: "editElement: elementId is required" };

    const changes = isPlainObject(params?.changes) ? params.changes : null;
    if (!changes) return { success: false, error: "editElement: changes must be an object" };

    const deckHtmlDsl = typeof context?.deckPackage?.deckHtmlDsl === "string" ? context.deckPackage.deckHtmlDsl : "";
    const sections = parseSections(deckHtmlDsl);
    if (!sections.length) return { success: false, error: "editElement: deckHtmlDsl contains no <section> slides" };
    if (v.slideIndex >= sections.length) return { success: false, error: `editElement: ${buildSlideIndexError(v.slideIndex, sections.length)}` };

    const sectionHtml = sections[v.slideIndex];
    const { section, serialize } = await parseSectionDom(sectionHtml);
    if (!section) return { success: false, error: "editElement: failed to parse target <section>" };

    const selector = `[data-el="${escapeAttrSelectorValue(elementId)}"]`;
    const nodes = section.querySelectorAll(selector);
    if (!nodes || nodes.length === 0) {
      const existing = [...new Set(extractElements(sectionHtml).map((e) => e.elementId))].slice(0, 24);
      const hint = existing.length ? ` Available data-el: ${existing.join(", ")}` : "";
      return { success: false, error: `editElement: element not found for data-el="${elementId}".${hint}` };
    }

    const text = changes.text !== undefined ? String(changes.text) : null;
    const style = changes.style !== undefined ? String(changes.style) : null;
    const html = changes.html !== undefined ? String(changes.html) : null;

    for (const el of nodes) {
      if (text !== null) el.textContent = text;
      if (html !== null) el.innerHTML = html;
      if (style !== null) el.setAttribute("style", style);
      applyAttrChanges(el, changes.attrs);

      // Best-effort: map known shorthand keys to data-* attributes.
      for (const [k, v0] of Object.entries(changes)) {
        if (k === "text" || k === "style" || k === "html" || k === "attrs") continue;
        const vStr = v0 === null || v0 === undefined ? null : String(v0);
        const dataKey = k.startsWith("data-") ? k : `data-${k}`;
        if (vStr === null) el.removeAttribute(dataKey);
        else el.setAttribute(dataKey, vStr);
      }
    }

    const updatedSectionHtml = serialize();
    sections[v.slideIndex] = updatedSectionHtml;
    const nextDeckHtmlDsl = joinSections(sections);
    if (!context.deckPackage) context.deckPackage = {};
    context.deckPackage.deckHtmlDsl = nextDeckHtmlDsl;

    return {
      success: true,
      data: {
        slideIndex: v.slideIndex,
        elementId,
        matchCount: nodes.length,
        updatedSectionHtml,
        deckPackage: { ...(context.deckPackage || {}), deckHtmlDsl: nextDeckHtmlDsl },
      },
    };
  } catch (err) {
    return { success: false, error: `editElement failed: ${err.message}` };
  }
}

const TOOL_HANDLERS = {
  getSlideContent,
  getSlideContext,
  screenshot,
  editSlide,
  editElement,
};

export const TOOL_SCHEMAS = {
  getSlideContent: {
    params: ["slideIndex"],
    description: "Get slide <section> HTML and extracted elements by slideIndex (0-based).",
  },
  getSlideContext: {
    params: ["slideIndex"],
    description: "Get slideIntent, slideMeta, claims, imageSlots for a slide (0-based).",
  },
  screenshot: {
    params: ["slideIndex"],
    description: "Capture slide screenshot as base64 data URL (browser) or return a mock in Node.js.",
  },
  editSlide: {
    params: ["slideIndex", "changes"],
    description: "Edit a slide <section> (replace html or update attributes like background/title/layout/type).",
  },
  editElement: {
    params: ["slideIndex", "elementId", "changes"],
    description: "Edit elements in a slide matching data-el=\"elementId\" (text/style/html/attrs and data-* changes).",
  },
};

export function createToolExecutor(context, options = {}) {
  if (!isPlainObject(context)) {
    throw new TypeError("createToolExecutor(context): context must be an object");
  }
  if (!context.deckPackage || typeof context.deckPackage !== "object") context.deckPackage = {};
  if (!context.contentPackage || typeof context.contentPackage !== "object") context.contentPackage = {};
  if (!isPlainObject(options)) options = {};

  context[TOOL_OPTIONS] = {
    screenshotRenderer: typeof options.screenshotRenderer === "function" ? options.screenshotRenderer : null,
  };

  return async function executeToolCall(toolName, params) {
    const name = toNonEmptyString(toolName);
    if (!name) return { success: false, error: "Tool name is required" };

    const handler = TOOL_HANDLERS[name];
    if (!handler) return { success: false, error: `Unknown tool: ${name}` };

    try {
      return await handler(context, params || {});
    } catch (err) {
      return { success: false, error: `Tool execution failed: ${err.message}` };
    }
  };
}

export { parseSections, joinSections, extractElements };
