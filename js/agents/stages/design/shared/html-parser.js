/** @type {Set<string>} Keys that must never be written to attrs to prevent prototype pollution. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Check if a character is whitespace.
 * @param {string} c - Single character.
 * @returns {boolean}
 */
function isWs(c) {
  return c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f";
}

/**
 * Check if a character is valid in an attribute name.
 * @param {string} c - Single character.
 * @returns {boolean}
 */
function isNameChar(c) {
  const code = c.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    c === "-" ||
    c === "_" ||
    c === ":"
  );
}

/**
 * Scan and extract an attribute name starting at position i.
 * @param {string} tag - Full tag string.
 * @param {number} i - Start index.
 * @returns {{ name: string, end: number }} Lowercased name and new cursor position.
 */
function scanAttrName(tag, i) {
  const start = i;
  while (i < tag.length && isNameChar(tag[i])) i++;
  return { name: tag.slice(start, i).toLowerCase(), end: i };
}

/**
 * Scan and extract an attribute value starting at position i (after '=').
 * @param {string} tag - Full tag string.
 * @param {number} i - Start index (should point at quote or first value char).
 * @returns {{ value: string, end: number }} Value and new cursor position.
 */
function scanAttrValue(tag, i) {
  const quote = tag[i] === '"' || tag[i] === "'" ? tag[i] : null;
  if (quote) {
    i++;
    const start = i;
    while (i < tag.length && tag[i] !== quote) i++;
    const value = tag.slice(start, i);
    if (tag[i] === quote) i++;
    return { value, end: i };
  }
  const start = i;
  while (i < tag.length) {
    const c = tag[i];
    if (isWs(c) || c === ">" || c === "/") break;
    i++;
  }
  return { value: tag.slice(start, i), end: i };
}

/**
 * Parse a best-effort HTML start tag and return its attributes.
 *
 * Note: this is a lightweight parser intended for internal heuristics; it is
 * not a full HTML tokenizer.
 *
 * @param {string} tag - Tag source (e.g. `"<div class=\"x\" data-id=\"1\">"`).
 * @returns {Record<string, string>} Lowercased attribute-name map (null-prototype object).
 */
export function parseTagAttributes(tag) {
  /** @type {Record<string, string>} */
  const attrs = Object.create(null);
  if (!tag || typeof tag !== "string") return attrs;

  // Best-effort: start scanning after tag name ("<div ...>").
  let i = tag.indexOf(" ");
  if (i === -1) return attrs;

  while (i < tag.length) {
    while (i < tag.length && isWs(tag[i])) i++;
    const ch = tag[i];
    if (!ch || ch === ">" || ch === "/") break;

    const { name, end: nameEnd } = scanAttrName(tag, i);
    i = nameEnd;
    if (!name) {
      i++;
      continue;
    }

    while (i < tag.length && isWs(tag[i])) i++;
    if (tag[i] !== "=") {
      if (!FORBIDDEN_KEYS.has(name)) attrs[name] = "";
      continue;
    }

    i++; // skip "="
    while (i < tag.length && isWs(tag[i])) i++;
    if (i >= tag.length) {
      if (!FORBIDDEN_KEYS.has(name)) attrs[name] = "";
      break;
    }

    const { value, end: valueEnd } = scanAttrValue(tag, i);
    i = valueEnd;
    if (!FORBIDDEN_KEYS.has(name)) attrs[name] = value;
  }

  return attrs;
}
