import { isPlainObject, toNonEmptyString } from "../../../shared/index.js";
import { LRUCache } from "../../../shared/index.js";

/**
 * Design Stage - Shared Utilities
 *
 * Consolidates common utility functions used across generators, refiners, and runtime.
 */

// Re-export from value-utils for backward compatibility
export { isPlainObject, toNonEmptyString };

/**
 * Safely clamps a number between min and max.
 * @param {unknown} v - Value to clamp.
 * @param {number} min - Minimum bound.
 * @param {number} max - Maximum bound.
 * @param {number} [fallback=min] - Fallback value if v is not finite.
 * @returns {number} Clamped value or fallback.
 */
export function clamp(v, min, max, fallback = min) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

/**
 * Returns current timestamp in milliseconds.
 * @returns {number} Current Unix timestamp in ms.
 */
export function nowMs() {
    return Date.now();
}

/**
 * Safely parses a number, returning fallback if invalid.
 * @param {unknown} n - Value to parse.
 * @param {number | null} [fallback=null] - Value to return if n is not a finite number.
 * @returns {number | null} The number if finite, otherwise fallback.
 */
export function safeNumber(n, fallback = null) {
    return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/**
 * Safely parses an integer, returning null if invalid.
 * @param {unknown} n - Value to parse.
 * @returns {number | null} Floored integer if n is finite, otherwise null.
 */
export function safeInt(n) {
    return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

/**
 * Parses deckHtmlDsl into an array of <section> HTML strings.
 */
const PARSE_SECTIONS_CACHE_LIMIT = 32;
const parseSectionsCache = new LRUCache({ maxSize: PARSE_SECTIONS_CACHE_LIMIT });

function normalizeCacheScope(scope) {
    if (typeof scope !== "string") return "global";
    const trimmed = scope.trim();
    return trimmed || "global";
}

function composeParseSectionsCacheKey(html, options = {}) {
    const scope = normalizeCacheScope(options.cacheScope ?? options.scope);
    const customCacheKey = typeof options.cacheKey === "string" ? options.cacheKey : "";
    const rawKey = customCacheKey || html;
    return `${scope}::${rawKey}`;
}

/**
 * Clears the internal parseSections cache.
 *
 * Useful when callers mutate parsed section arrays and/or when the deck is
 * frequently regenerated (to avoid holding old deck strings in memory).
 * @returns {void}
 */
export function clearParseCache(scope = null) {
    const normalizedScope = typeof scope === "string" ? normalizeCacheScope(scope) : null;
    if (!normalizedScope) {
        parseSectionsCache.clear();
        return;
    }

    const entries = /** @type {{ _map?: Map<any, any>, _cache?: Map<any, any> }} */ (parseSectionsCache)._map
      || /** @type {{ _map?: Map<any, any>, _cache?: Map<any, any> }} */ (parseSectionsCache)._cache;
    if (!(entries instanceof Map)) {
        parseSectionsCache.clear();
        return;
    }

    const prefix = `${normalizedScope}::`;
    for (const key of entries.keys()) {
        if (String(key).startsWith(prefix)) {
            entries.delete(key);
        }
    }
}

/**
 * Parses deckHtmlDsl into an array of <section> HTML strings.
 * Results are cached (LRU, max 32 entries) and shallow-copied on return.
 * @param {string} deckHtmlDsl - Full deck DSL HTML string.
 * @param {{ cacheScope?: string, scope?: string, cacheKey?: string }=} options
 * @returns {string[]} Array of section HTML strings.
 */
export function parseSections(deckHtmlDsl, options = {}) {
    const html = typeof deckHtmlDsl === "string" ? deckHtmlDsl : "";
    if (!html) return [];

    const cacheKey = composeParseSectionsCacheKey(html, options);
    const cached = parseSectionsCache.get(cacheKey);
    if (cached) return cached.slice();

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

    // Store the parsed array in cache, but always return a shallow copy so
    // callers can freely mutate their returned array (e.g., edit workflows)
    // without corrupting cache entries.
    parseSectionsCache.set(cacheKey, sections);

    return sections.slice();
}

/**
 * Joins an array of <section> HTML strings back into a single DSL string.
 * @param {string[]} sections - Array of section HTML strings.
 * @returns {string} Combined DSL string.
 */
export function joinSections(sections) {
    const parts = Array.isArray(sections) ? sections : [];
    return parts
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter(Boolean)
        .join("\n\n");
}

/** @type {Set<string>} Keys that must never be written to attrs to prevent prototype pollution. */
const FORBIDDEN_ATTR_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const TEXT_PREVIEW_LIMIT = 160;

/**
 * @typedef {Object} ExtractedElement
 * @property {string} elementId - The data-el value.
 * @property {string} tag - Lowercased tag name.
 * @property {string} [id] - Element id attribute.
 * @property {string} [class] - Element class attribute.
 * @property {Record<string, string>} attrs - All parsed attributes (null-prototype).
 * @property {string} [textPreview] - Text content preview (max 160 chars).
 */

/**
 * Extracts element metadata from a section HTML string based on data-el attributes.
 * @param {string} sectionHtml - HTML string of a section.
 * @returns {ExtractedElement[]} Array of extracted element metadata.
 */
export function extractElements(sectionHtml) {
    const html = typeof sectionHtml === "string" ? sectionHtml : "";
    if (!html) return [];

    /** @type {ExtractedElement[]} */
    const out = [];
    const elRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)\bdata-el="([^"]+)"([^>]*)>/g;
    let m;
    while ((m = elRe.exec(html)) !== null) {
        const tag = String(m[1] || "").toLowerCase();
        const dataEl = String(m[3] || "");
        const attrsText = `${m[2] || ""} data-el="${dataEl}" ${m[4] || ""}`.trim();

        /** @type {Record<string, string>} */
        const attrs = Object.create(null);
        const attrRe = /([:@a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
        let am;
        while ((am = attrRe.exec(attrsText)) !== null) {
            const key = am[1];
            if (!FORBIDDEN_ATTR_KEYS.has(key)) {
                attrs[key] = am[2];
            }
        }

        let textPreview = "";
        const start = m.index + m[0].length;
        const rest = html.slice(start);
        const closeRe = new RegExp(`</${tag}\\s*>`, "i");
        const closeIdx = rest.search(closeRe);
        if (closeIdx >= 0) {
            const inner = rest.slice(0, closeIdx);
            if (inner && !inner.includes("<")) {
                textPreview = inner.trim().slice(0, TEXT_PREVIEW_LIMIT);
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

/**
 * Escapes HTML special characters.
 * @param {unknown} s - Value to escape (converted to string).
 * @returns {string} Escaped HTML string.
 */
export function escapeHtml(s) {
    return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

/**
 * @typedef {Object} RgbColor
 * @property {number} r - Red component (0-255).
 * @property {number} g - Green component (0-255).
 * @property {number} b - Blue component (0-255).
 */

/**
 * Converts hex color to RGB object.
 * @param {string} hex - Hex color string (e.g. "#fff" or "#ffffff").
 * @returns {RgbColor | null} RGB object or null if invalid.
 */
export function hexToRgb(hex) {
    const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    const fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}
