function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function normalizeTitle(title) {
  return String(title || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMdHeadingMarkers(line) {
  // "# Title ###" -> "Title"
  return line.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim();
}

function looksLikeCapsHeading(line) {
  const t = line.trim();
  if (!t) return false;
  if (t.length < 4 || t.length > 80) return false;
  if (t.includes("```")) return false;
  if (/[a-z]/.test(t)) return false;
  const letters = (t.match(/[A-Z]/g) || []).length;
  if (letters < 3) return false;
  const words = t.split(/\s+/g);
  if (words.length > 10) return false;
  // Exclude lines that are mostly punctuation.
  const alphaNum = (t.match(/[A-Z0-9]/g) || []).length;
  return alphaNum / t.length >= 0.6;
}

function parseNumberedHeading(line) {
  // "1.2.3 Title" / "1) Title"
  const m = line.match(/^(\d+(?:\.\d+){0,5})[)\.]?\s+(.+?)\s*$/);
  if (!m) return null;
  const numbering = m[1];
  const title = m[2];
  if (!title || title.length < 3) return null;
  if (title.length > 160) return null;
  // Avoid matching years/decimals in prose (e.g., "2025.12 is ...").
  if (numbering.length > 10 && numbering.includes(".")) return null;
  const level = Math.min(6, numbering.split(".").length);
  return { level, title: normalizeTitle(title) };
}

function iterLinesWithOffsets(text) {
  const out = [];
  let i = 0;
  while (i <= text.length) {
    const lineStart = i;
    let lineEnd = text.indexOf("\n", i);
    if (lineEnd === -1) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);
    out.push({ line, lineStart, lineEnd });
    i = lineEnd + 1;
    if (lineEnd === text.length) break;
  }
  return out;
}

function computeSectionEnds(tocNodes, textLen) {
  for (let i = 0; i < tocNodes.length; i++) {
    const node = tocNodes[i];
    let end = textLen;
    for (let j = i + 1; j < tocNodes.length; j++) {
      if (tocNodes[j].level <= node.level) {
        end = tocNodes[j].locator.charStart;
        break;
      }
    }
    node.locator.charEnd = Math.max(node.locator.charStart, end);
  }
}

function buildFallbackSections(text) {
  const sections = [];
  const n = text.length;
  if (n === 0) return sections;
  const target = 5000;
  let start = 0;
  let i = 0;
  while (start < n) {
    const end = Math.min(n, start + target);
    sections.push({
      sectionId: `section_${++i}`,
      title: `Section ${i}`,
      level: 1,
      locator: { charStart: start, charEnd: end },
    });
    start = end;
  }
  return sections;
}

/**
 * Extract a flat TOC list from normalized text.
 * Heuristics:
 * - Markdown headings (#..######)
 * - Numbered headings ("1.", "1.2", "1) ...")
 * - Short ALL-CAPS headings ("INTRODUCTION")
 *
 * @param {string} normalizedText
 * @param {object=} options
 * @returns {{tocNodes:Array<{tocNodeId:string,title:string,level:number,locator:{charStart:number,charEnd:number}}>,fallbackSections:any[]}}
 */
export function buildToc(normalizedText, options = {}) {
  if (typeof normalizedText !== "string") throw new TypeError("buildToc(normalizedText): normalizedText must be a string");
  if (!isPlainObject(options)) throw new TypeError("buildToc(normalizedText, options): options must be an object");

  const text = normalizedText;
  const lines = iterLinesWithOffsets(text);
  const tocNodes = [];
  let inCodeFence = false;

  for (const { line, lineStart, lineEnd } of lines) {
    const raw = line;
    const t = raw.trim();
    if (!t) continue;

    if (/^\s*```/.test(raw)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    let level = 0;
    let title = "";

    const md = raw.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (md) {
      level = md[1].length;
      title = normalizeTitle(stripMdHeadingMarkers(raw));
    } else {
      const numbered = parseNumberedHeading(raw.trim());
      if (numbered) {
        level = numbered.level;
        title = numbered.title;
      } else if (looksLikeCapsHeading(raw)) {
        level = 1;
        title = normalizeTitle(raw);
      }
    }

    if (!level || !title) continue;
    if (title.length > 200) continue;

    tocNodes.push({
      tocNodeId: `toc_${tocNodes.length + 1}`,
      title,
      level,
      locator: { charStart: lineStart, charEnd: lineEnd },
    });
  }

  computeSectionEnds(tocNodes, text.length);

  const fallbackSections = tocNodes.length === 0 ? buildFallbackSections(text) : [];
  return { tocNodes, fallbackSections };
}

