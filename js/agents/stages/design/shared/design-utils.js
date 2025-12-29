/**
 * Design Stage - Shared Utilities
 *
 * Consolidates common utility functions used across generators, refiners, and runtime.
 */

/**
 * Checks if a value is a plain object.
 */
export function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Normalizes a value to a non-empty string.
 */
export function toNonEmptyString(v) {
    if (v === undefined || v === null) return "";
    const s = String(v).trim();
    return s.length ? s : "";
}

/**
 * Safely clamps a number between min and max.
 */
export function clamp(v, min, max, fallback = min) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

/**
 * Returns current timestamp in milliseconds.
 */
export function nowMs() {
    return Date.now();
}

/**
 * Safely parses a number, returning fallback if invalid.
 * @param {*} n - value to parse
 * @param {*} [fallback=null] - value to return if n is not a finite number
 */
export function safeNumber(n, fallback = null) {
    return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

/**
 * Safely parses an integer, returning null if invalid.
 */
export function safeInt(n) {
    return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

/**
 * Parses deckHtmlDsl into an array of <section> HTML strings.
 */
const PARSE_SECTIONS_CACHE_LIMIT = 32;
const parseSectionsCache = new Map();

/**
 * Clears the internal parseSections cache.
 *
 * Useful when callers mutate parsed section arrays and/or when the deck is
 * frequently regenerated (to avoid holding old deck strings in memory).
 */
export function clearParseCache() {
    parseSectionsCache.clear();
}

export function parseSections(deckHtmlDsl) {
    const html = typeof deckHtmlDsl === "string" ? deckHtmlDsl : "";
    if (!html) return [];

    const cached = parseSectionsCache.get(html);
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
    parseSectionsCache.set(html, sections);
    if (parseSectionsCache.size > PARSE_SECTIONS_CACHE_LIMIT) {
        // Best-effort FIFO eviction to avoid unbounded growth.
        const firstKey = parseSectionsCache.keys().next().value;
        if (firstKey !== undefined) parseSectionsCache.delete(firstKey);
    }

    return sections.slice();
}

/**
 * Joins an array of <section> HTML strings back into a single DSL string.
 */
export function joinSections(sections) {
    const parts = Array.isArray(sections) ? sections : [];
    return parts
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter(Boolean)
        .join("\n\n");
}

/**
 * Extracts element metadata from a section HTML string based on data-el attributes.
 */
export function extractElements(sectionHtml) {
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

/**
 * Escapes HTML special characters.
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
 * Converts hex color to RGB object or array.
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
