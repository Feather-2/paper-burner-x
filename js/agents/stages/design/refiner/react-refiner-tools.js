/**
 * ReactRefiner 工具适配层（Generation 阶段）
 *
 * 所有工具返回统一格式：{success: boolean, data?: any, error?: string}
 */

import {
  isPlainObject,
  toNonEmptyString,
  parseSections as _parseSections,
  clearParseCache,
  joinSections as _joinSections,
  extractElements as _extractElements,
} from "../shared/design-utils.js";

/**
 * @typedef {{ success: boolean, data?: any, error?: string }} ToolResult
 */

/**
 * @typedef {(toolName: string, params: any) => Promise<ToolResult>} ToolExecutor
 */

/**
 * @typedef {object} ToolContext
 * @property {{ deckHtmlDsl?: string, slidesMeta?: any[] }} [deckPackage]
 * @property {any} [contentPackage]
 * @property {{ signal?: AbortSignal, emit?: Function }} [stageApi]
 */

/**
 * @typedef {object} ToolExecutorOptions
 * @property {(params: { slideIndex: number, scale?: number }) => Promise<ToolResult>} [screenshotRenderer]
 */

/**
 * @typedef {object} ExtractedElement
 * @property {string} elementId
 * @property {string} tag
 * @property {string|undefined} [id]
 * @property {string|undefined} [class]
 * @property {Record<string, string>} attrs
 * @property {string|undefined} [textPreview]
 */

/** @type {any} */
const process = /** @type {any} */ (globalThis).process;

/**
 * Parses deckHtmlDsl into an array of <section> HTML strings.
 *
 * @param {string} deckHtmlDsl
 * @returns {string[]}
 */
export function parseSections(deckHtmlDsl) {
  return _parseSections(deckHtmlDsl);
}

/**
 * Joins an array of <section> HTML strings back into a single DSL string.
 *
 * @param {string[]} sections
 * @returns {string}
 */
export function joinSections(sections) {
  return _joinSections(sections);
}

/**
 * Extract element metadata from a section HTML string based on `data-el` attributes.
 *
 * @param {string} sectionHtml
 * @returns {ExtractedElement[]}
 */
export function extractElements(sectionHtml) {
  return /** @type {ExtractedElement[]} */ (_extractElements(sectionHtml));
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

function isDangerousUrl(value) {
  const raw = String(value ?? "").replace(/\u0000/g, "").trim();
  if (!raw) return false;
  const s = raw.toLowerCase();
  if (s.startsWith("javascript:") || s.startsWith("vbscript:")) return true;
  if (s.startsWith("data:") && !s.startsWith("data:image/")) return true;
  return false;
}

function isDangerousStyle(value) {
  const raw = String(value ?? "");
  if (!raw) return false;
  const s = raw.toLowerCase();
  if (s.includes("expression(")) return true;
  if (s.includes("javascript:")) return true;
  // url(javascript:...) variants
  if (s.includes("url(") && s.includes("javascript:")) return true;
  return false;
}

function sanitizeElementTree(root) {
  if (!root || typeof root !== "object") return;
  const dangerousTags = new Set(["script", "iframe", "object", "embed", "link", "meta", "base"]);

  const stack = [root];
  while (stack.length) {
    const el = stack.pop();
    if (!el || el.nodeType !== 1) continue;

    const tag = typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";
    if (dangerousTags.has(tag)) {
      try {
        el.remove?.();
      } catch {
        // ignore
      }
      continue;
    }

    const attrs = el.attributes ? Array.from(el.attributes) : [];
    for (const attr of attrs) {
      const name = String(attr?.name || "");
      if (!name) continue;
      const lower = name.toLowerCase();
      if (lower.startsWith("on")) {
        el.removeAttribute?.(name);
        continue;
      }
      if (
        (lower === "href" ||
          lower === "src" ||
          lower === "xlink:href" ||
          lower === "formaction" ||
          lower === "action" ||
          lower === "srcset") &&
        isDangerousUrl(attr.value)
      ) {
        el.removeAttribute?.(name);
        continue;
      }
      if (lower === "style" && isDangerousStyle(attr.value)) {
        el.removeAttribute?.(name);
      }
    }

    const children = el.children ? Array.from(el.children) : [];
    for (const child of children) stack.push(child);
  }
}

let _domPurifyPromise = null;
let _domPurify = null;

async function getDomPurify() {
  const globalPurifier = /** @type {any} */ (globalThis).DOMPurify;
  if (globalPurifier && typeof globalPurifier.sanitize === "function") {
    _domPurify = globalPurifier;
    return _domPurify;
  }

  // DOMPurify is primarily needed for browser rendering safety.
  // In Node.js, prefer our element-tree sanitizer (linkedom) unless a global
  // DOMPurify has been explicitly provided (handled above).
  if (!isBrowserEnv()) return null;

  if (_domPurify && typeof _domPurify.sanitize === "function") return _domPurify;
  if (_domPurifyPromise) return _domPurifyPromise;

  _domPurifyPromise = (async () => {
    try {
      const mod = await import("dompurify");
      const maybeFactory = /** @type {any} */ (mod).default || mod;
      if (maybeFactory && typeof maybeFactory.sanitize === "function") return maybeFactory;

      if (typeof maybeFactory === "function") {
        return maybeFactory(window);
      }
    } catch {
      // ignore (DOMPurify import unavailable)
    }

    return null;
  })()
    .then((purifier) => {
      _domPurify = purifier;
      _domPurifyPromise = null;
      return purifier;
    })
    .catch(() => {
      _domPurifyPromise = null;
      return null;
    });

  return _domPurifyPromise;
}

async function sanitizeHtmlFragment(html) {
  const input = typeof html === "string" ? html : String(html ?? "");
  if (!input.trim()) return "";

  // Prefer DOMPurify (bundled dependency or CDN global).
  // Keep the lightweight tree sanitizer only as a last-resort fallback.
  const purifier = await getDomPurify();
  if (purifier && typeof purifier.sanitize === "function") {
    return purifier.sanitize(input, { RETURN_DOM_FRAGMENT: false, USE_PROFILES: { html: true } });
  }

  const WRAP_ID = "__pb_sanitize_wrap__";
  const wrapped = `<div id="${WRAP_ID}">${input}</div>`;

  if (isBrowserEnv() && typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(wrapped, "text/html");
    const wrap = doc.getElementById(WRAP_ID);
    if (!wrap) return "";
    sanitizeElementTree(wrap);
    return wrap.innerHTML;
  }

  const mod = await import("linkedom");
  const { document } = mod.parseHTML(wrapped);
  const wrap = document.getElementById(WRAP_ID);
  if (!wrap) return "";
  sanitizeElementTree(wrap);
  return wrap.innerHTML;
}

async function setInnerHTMLSanitized(el, html) {
  if (!el) return;
  const sanitized = await sanitizeHtmlFragment(html);
  el.innerHTML = sanitized;
}

const TOOL_OPTIONS = Symbol("reactRefinerToolOptions");

const SCREENSHOT_CONCURRENCY = (() => {
  // Priority: localStorage > env > default
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("ppt_screenshotConcurrency") : null;
    const n = raw ? parseInt(raw, 10) : 0;
    if (n > 0) return n;
  } catch { }
  const env = typeof process !== "undefined" ? process.env : {};
  const n = parseInt(env.SCREENSHOT_CONCURRENCY || env.DESIGN_SCREENSHOT_CONCURRENCY, 10);
  return n > 0 ? n : 3;
})();

function clampPositiveInt(v, fallback) {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : safeIntLike(v);
  if (n === null || n <= 0) return fallback;
  return n;
}

async function parseSectionDom(sectionHtml) {
  const html = typeof sectionHtml === "string" ? sectionHtml : "";
  if (!html) return { section: null, serialize: () => "" };

  if (isBrowserEnv()) {
    const doc = typeof DOMParser !== "undefined" ? new DOMParser().parseFromString(html.trim(), "text/html") : null;
    const section = doc ? doc.querySelector("section") : null;
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
  const win = /** @type {any} */ (window);
  if (typeof win.PPTGeneratorExportImage === "object" && win.PPTGeneratorExportImage) return win.PPTGeneratorExportImage;
  const globals = /** @type {any} */ (globalThis);
  if (typeof globals.PPTGeneratorExportImage === "object" && globals.PPTGeneratorExportImage) return globals.PPTGeneratorExportImage;
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
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "width: 960px; height: 540px; overflow: hidden;";
      await setInnerHTMLSanitized(wrapper, sectionHtml);
      container.appendChild(wrapper);

      const target = wrapper;
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
      } catch { }
    }
  } catch (err) {
    return { success: false, error: `screenshot failed: ${err.message}` };
  }
}

// 3b. screenshotAll() - 批量截图所有幻灯片
async function screenshotAll(context, params) {
  try {
    const deckHtmlDsl = typeof context?.deckPackage?.deckHtmlDsl === "string" ? context.deckPackage.deckHtmlDsl : "";
    const sections = parseSections(deckHtmlDsl);
    if (!sections.length) return { success: false, error: "screenshotAll: deckHtmlDsl contains no <section> slides" };

    const scale = Number.isFinite(params?.scale) ? params.scale : 1; // 缩略图用较小 scale
    const concurrency = Math.min(sections.length, clampPositiveInt(params?.concurrency, SCREENSHOT_CONCURRENCY));
    const results = new Array(sections.length);

    let nextIndex = 0;
    const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (true) {
        const i = nextIndex++;
        if (i >= sections.length) break;
        try {
          const result = await screenshot(context, { slideIndex: i, scale });
          results[i] = {
            slideIndex: i,
            base64: result.success ? result.data?.base64 : null,
            error: result.success ? null : result.error,
            mock: result.data?.mock || false,
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e || "Unknown error");
          results[i] = { slideIndex: i, base64: null, error: `screenshotAll: ${msg}`, mock: true };
        }
      }
    });
    await Promise.all(workers);

    // Optional: stitch screenshots into a small set of overview grids (token saver).
    let overview = null;
    if (params?.stitch) {
      try {
        const { createDeckOverview } = await import("../runtime/screenshot-stitcher.js");
        overview = await createDeckOverview(
          results.map((r) => (r && typeof r.base64 === "string" ? r.base64 : null)),
          isPlainObject(params?.stitchOptions) ? params.stitchOptions : {}
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e || "Unknown error");
        overview = { error: `stitch failed: ${msg}` };
      }
    }

    return {
      success: true,
      data: {
        slideCount: sections.length,
        screenshots: results,
        ...(overview ? { overview } : {}),
        note: "Use these thumbnails to assess visual quality, style consistency, and identify issues.",
      },
    };
  } catch (err) {
    return { success: false, error: `screenshotAll failed: ${err.message}` };
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
      const next = (m ? m[0] : rawHtml).trim();
      updatedSection = (await sanitizeHtmlFragment(next)).trim() || next;
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
        await setInnerHTMLSanitized(section, rawHtml);
      }

      updatedSection = serialize();
    }

    sections[v.slideIndex] = updatedSection;
    const nextDeckHtmlDsl = joinSections(sections);
    if (!context.deckPackage) context.deckPackage = {};
    context.deckPackage.deckHtmlDsl = nextDeckHtmlDsl;
    clearParseCache();

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
      if (html !== null) await setInnerHTMLSanitized(el, html);
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
    clearParseCache();

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
  screenshotAll,
  editSlide,
  editElement,
};

/** @type {Record<string, { params: string[], description: string }>} */
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
  screenshotAll: {
    params: [],
    description: "Capture all slides as thumbnails. Use this first to assess overall visual quality and style consistency.",
  },
  editSlide: {
    params: ["slideIndex", "changes"],
    description: "Edit a slide <section> (replace html or update attributes like background/title/layout/type).",
  },
  editElement: {
    params: ["slideIndex", "elementId", "changes"],
    description: "Edit elements in a slide matching data-el=\"elementId\" (text/style/html/attrs and data-* changes). Use for SVG fixes, image repositioning, style adjustments.",
  },
};

/**
 * Create a tool-call executor for the ReactRefiner agent.
 *
 * @param {ToolContext} context
 * @param {ToolExecutorOptions} [options={}]
 * @returns {ToolExecutor}
 */
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
