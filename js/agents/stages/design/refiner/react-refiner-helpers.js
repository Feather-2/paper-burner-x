import { isPlainObject, toNonEmptyString, parseSections as _parseSections } from "../shared/design-utils.js";

/**
 * @typedef {{ toDataURL?: (type: string) => string }} CanvasLike
 * @typedef {{ _captureToCanvas?: (target: Element, options: Record<string, unknown>) => Promise<CanvasLike | null> }} PptGeneratorExportImageLike
 */

/** @type {{ env?: Record<string, string | undefined> } | undefined} */
const process = /** @type {Record<string, unknown>} */ (globalThis).process;

export function safeIntLike(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    const n = Number(s);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return null;
}

export function isBrowserEnv() {
  return typeof window !== "undefined" && !!window?.document?.createElement;
}

export function escapeAttrSelectorValue(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function isDangerousUrl(value) {
  const raw = String(value ?? "").replace(/\u0000/g, "").trim();
  if (!raw) return false;
  const s = raw.toLowerCase();
  if (s.startsWith("javascript:") || s.startsWith("vbscript:")) return true;
  if (s.startsWith("data:") && !s.startsWith("data:image/")) return true;
  return false;
}

export function isDangerousStyle(value) {
  const raw = String(value ?? "");
  if (!raw) return false;
  const s = raw.toLowerCase();
  if (s.includes("expression(")) return true;
  if (s.includes("javascript:")) return true;
  // url(javascript:...) variants
  if (s.includes("url(") && s.includes("javascript:")) return true;
  return false;
}

export function sanitizeElementTree(root) {
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

export async function getDomPurify() {
  const globalPurifier = /** @type {{ sanitize?: (input: string, config?: Record<string, unknown>) => string } | undefined} */ (
    /** @type {Record<string, unknown>} */ (globalThis).DOMPurify
  );
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
      const maybeFactory = /** @type {Record<string, unknown>} */ (mod).default || mod;
      const maybePurifier = /** @type {{ sanitize?: unknown }} */ (maybeFactory);
      if (maybePurifier && typeof maybePurifier.sanitize === "function") return maybeFactory;

      if (typeof maybeFactory === "function") {
        return /** @type {(win: unknown) => unknown} */ (maybeFactory)(window);
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

export async function sanitizeHtmlFragment(html) {
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

  // Node.js fallback: linkedom is a Node-only dependency.
  // Build tools should externalize this import for browser bundles.
  // @ts-ignore - dynamic import for Node.js only
  const mod = await import(/* webpackIgnore: true */ "linkedom");
  const { document } = mod.parseHTML(wrapped);
  const wrap = document.getElementById(WRAP_ID);
  if (!wrap) return "";
  sanitizeElementTree(wrap);
  return wrap.innerHTML;
}

export async function setInnerHTMLSanitized(el, html) {
  if (!el) return;
  const sanitized = await sanitizeHtmlFragment(html);
  el.innerHTML = sanitized;
}

export const SCREENSHOT_CONCURRENCY = (() => {
  // Priority: localStorage > env > default
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("ppt_screenshotConcurrency") : null;
    const n = raw ? parseInt(raw, 10) : 0;
    if (n > 0) return n;
  } catch {
    /* intentional: env probe */
  }
  const env = /** @type {Record<string, string | undefined>} */ (process?.env || {});
  const n = parseInt(env.SCREENSHOT_CONCURRENCY || env.DESIGN_SCREENSHOT_CONCURRENCY, 10);
  return n > 0 ? n : 3;
})();

export function clampPositiveInt(v, fallback) {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : safeIntLike(v);
  if (n === null || n <= 0) return fallback;
  return n;
}

export async function parseSectionDom(sectionHtml) {
  const html = typeof sectionHtml === "string" ? sectionHtml : "";
  if (!html) return { section: null, serialize: () => "" };

  if (isBrowserEnv()) {
    const doc = typeof DOMParser !== "undefined" ? new DOMParser().parseFromString(html.trim(), "text/html") : null;
    const section = doc ? doc.querySelector("section") : null;
    return { section, serialize: () => (section ? section.outerHTML : html.trim()) };
  }

  // Node.js fallback: linkedom is a Node-only dependency.
  // Build tools should externalize this import for browser bundles.
  // @ts-ignore - dynamic import for Node.js only
  const mod = await import(/* webpackIgnore: true */ "linkedom");
  const { document } = mod.parseHTML(html.trim());
  const section = document.querySelector("section");
  return { section, serialize: () => (section ? section.outerHTML : html.trim()) };
}

export function buildSlideIndexError(slideIndex, slideCount) {
  return `Invalid slideIndex: ${String(slideIndex)} (expected 0..${Math.max(0, slideCount - 1)})`;
}

export function getSlideCounts(context) {
  const deckHtmlDsl = typeof context?.deckPackage?.deckHtmlDsl === "string" ? context.deckPackage.deckHtmlDsl : "";
  const sections = _parseSections(deckHtmlDsl);
  const slideIntents = Array.isArray(context?.contentPackage?.slideIntents) ? context.contentPackage.slideIntents : [];
  const slidesMeta = Array.isArray(context?.deckPackage?.slidesMeta) ? context.deckPackage.slidesMeta : [];
  return { sections, sectionCount: sections.length, intentCount: slideIntents.length, metaCount: slidesMeta.length };
}

export function validateSlideIndex(context, rawSlideIndex) {
  const slideIndex = safeIntLike(rawSlideIndex);
  const { sectionCount, intentCount, metaCount } = getSlideCounts(context);
  const maxCount = Math.max(sectionCount, intentCount, metaCount);
  if (slideIndex === null) return { ok: false, error: "slideIndex must be an integer" };
  if (maxCount <= 0) return { ok: false, error: "No slides available" };
  if (slideIndex < 0 || slideIndex >= maxCount) return { ok: false, error: buildSlideIndexError(slideIndex, maxCount) };
  return { ok: true, slideIndex, maxCount };
}

export const TRANSPARENT_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7W7WQAAAAASUVORK5CYII=";

/**
 * @returns {PptGeneratorExportImageLike | null}
 */
export function pickPptExportImage() {
  if (!isBrowserEnv()) return null;
  const win = /** @type {{ PPTGeneratorExportImage?: unknown }} */ (window);
  if (typeof win.PPTGeneratorExportImage === "object" && win.PPTGeneratorExportImage) {
    return /** @type {PptGeneratorExportImageLike} */ (win.PPTGeneratorExportImage);
  }
  const globals = /** @type {{ PPTGeneratorExportImage?: unknown }} */ (globalThis);
  if (typeof globals.PPTGeneratorExportImage === "object" && globals.PPTGeneratorExportImage) {
    return /** @type {PptGeneratorExportImageLike} */ (globals.PPTGeneratorExportImage);
  }
  return null;
}

/**
 * Whitelist for safe attribute prefixes/names.
 * Blocks on* event handlers, dangerous URL attributes, and style injection.
 */
export const SAFE_ATTR_PREFIXES = ["data-", "aria-"];
export const SAFE_ATTR_NAMES = new Set(["class", "id", "title", "lang", "dir", "tabindex", "role", "hidden", "slot", "part"]);
export const URL_ATTR_NAMES = new Set(["href", "src", "xlink:href", "formaction", "action", "srcset", "poster", "background"]);

export function isAttrAllowed(attrName, attrValue) {
  const lower = attrName.toLowerCase();
  // Block all on* event handlers
  if (lower.startsWith("on")) return false;
  // Whitelist safe prefixes
  for (const prefix of SAFE_ATTR_PREFIXES) {
    if (lower.startsWith(prefix)) return true;
  }
  // Whitelist safe names
  if (SAFE_ATTR_NAMES.has(lower)) return true;
  // URL attributes: allow only if value is safe
  if (URL_ATTR_NAMES.has(lower)) {
    return !isDangerousUrl(attrValue);
  }
  // style: allow only if value is safe
  if (lower === "style") {
    return !isDangerousStyle(attrValue);
  }
  // Block unknown attributes by default for security
  return false;
}

export function applyAttrChanges(el, attrs) {
  if (!el || !isPlainObject(attrs)) return;
  for (const [k, v] of Object.entries(attrs)) {
    const key = toNonEmptyString(k);
    if (!key) continue;
    if (v === null || v === undefined) {
      el.removeAttribute(key);
    } else {
      const strValue = String(v);
      if (!isAttrAllowed(key, strValue)) continue; // Skip disallowed attributes
      el.setAttribute(key, strValue);
    }
  }
}
