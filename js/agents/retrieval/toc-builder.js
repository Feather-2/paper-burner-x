import { isPlainObject } from "../shared/utils/value-utils.js";

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

function buildFallbackSectionsByLength(n) {
  const sections = [];
  const len = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (len === 0) return sections;
  const target = 5000;
  let start = 0;
  let i = 0;
  while (start < len) {
    const end = Math.min(len, start + target);
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

function toPositiveInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function sleep0() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function abortError(message) {
  const err = new Error(message || "Aborted");
  err.name = "AbortError";
  return err;
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
  const tocNodes = [];
  let inCodeFence = false;

  let lineStart = 0;

  for (let i = 0; i <= text.length; i++) {
    const isEnd = i === text.length;
    const ch = isEnd ? "\n" : text[i];
    if (ch !== "\n") continue;

    const lineEnd = i;
    const raw = text.slice(lineStart, lineEnd);
    const charStart = lineStart;
    lineStart = i + 1;

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
      locator: { charStart, charEnd: lineEnd },
    });
  }

  computeSectionEnds(tocNodes, text.length);

  const fallbackSections = tocNodes.length === 0 ? buildFallbackSections(text) : [];
  return { tocNodes, fallbackSections };
}

/**
 * Async TOC builder that yields periodically to keep the main thread responsive.
 *
 * @param {string} normalizedText
 * @param {{signal?:AbortSignal,yieldEveryLines?:number}=} options
 * @returns {Promise<{tocNodes:Array,fallbackSections:any[]}>}
 */
export async function buildTocAsync(normalizedText, options = {}) {
  if (typeof normalizedText !== "string") throw new TypeError("buildTocAsync(normalizedText): normalizedText must be a string");
  if (!isPlainObject(options)) throw new TypeError("buildTocAsync(normalizedText, options): options must be an object");

  const text = normalizedText;
  const tocNodes = [];
  const signal = options.signal;
  const yieldEveryLines = toPositiveInt(options.yieldEveryLines, 800);

  let inCodeFence = false;
  let lineStart = 0;
  let lineIndex = 0;

  for (let i = 0; i <= text.length; i++) {
    const isEnd = i === text.length;
    const ch = isEnd ? "\n" : text[i];
    if (ch !== "\n") continue;

    if (signal?.aborted) throw new Error("buildTocAsync: aborted");
    if (yieldEveryLines > 0 && lineIndex > 0 && lineIndex % yieldEveryLines === 0) await sleep0();

    const lineEnd = i;
    const raw = text.slice(lineStart, lineEnd);
    lineStart = i + 1;
    lineIndex += 1;

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
      locator: { charStart: lineStart - (raw.length + 1), charEnd: lineEnd },
    });
  }

  computeSectionEnds(tocNodes, text.length);
  const fallbackSections = tocNodes.length === 0 ? buildFallbackSections(text) : [];
  return { tocNodes, fallbackSections };
}

/**
 * Streaming TOC builder that consumes an (async) iterator of text chunks.
 * Chunk shape:
 * - Preferred: { text: string, locator: { charStart:number, charEnd:number } }
 * - Also supported: { text: string, offset:number, size:number }
 *
 * @param {AsyncIterable<{text:string,locator?:any,offset?:number,size?:number}>|Iterable<any>} chunkIterator
 * @param {{signal?:AbortSignal,yieldEveryChunks?:number}=} options
 * @returns {Promise<{tocNodes:Array,fallbackSections:any[]}>}
 */
export async function buildTocStreaming(chunkIterator, options = {}) {
  if (!chunkIterator) throw new TypeError("buildTocStreaming(chunkIterator): chunkIterator is required");
  if (!isPlainObject(options)) throw new TypeError("buildTocStreaming(chunkIterator, options): options must be an object");

  const signal = options.signal;
  const yieldEveryChunks = toPositiveInt(options.yieldEveryChunks, 0);

  const tocNodes = [];
  const seenStarts = new Set();
  let inCodeFence = false;

  // How many absolute characters we have already scanned (to skip overlaps).
  let processedUntil = 0;
  let totalLen = 0;

  // Pending partial line carried across chunk boundaries (no trailing "\n").
  let carry = "";
  let carryStartAbs = 0;

  let chunkIndex = 0;

  const processLine = (raw, charStart, charEnd) => {
    const t = raw.trim();
    if (!t) return;

    if (/^\s*```/.test(raw)) {
      inCodeFence = !inCodeFence;
      return;
    }
    if (inCodeFence) return;

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

    if (!level || !title) return;
    if (title.length > 200) return;

    const key = `${charStart}`;
    if (seenStarts.has(key)) return;
    seenStarts.add(key);

    tocNodes.push({
      tocNodeId: `toc_${tocNodes.length + 1}`,
      title,
      level,
      locator: { charStart, charEnd },
    });
  };

  for await (const chunk of chunkIterator) {
    if (signal?.aborted) throw abortError("buildTocStreaming: aborted");

    chunkIndex += 1;
    if (yieldEveryChunks > 0 && chunkIndex % yieldEveryChunks === 0) await sleep0();

    const text = typeof chunk?.text === "string" ? chunk.text : "";
    if (!text) {
      const endAbs = Number.isFinite(chunk?.locator?.charEnd) ? chunk.locator.charEnd : Number.isFinite(chunk?.offset) ? chunk.offset + (chunk.size || 0) : 0;
      totalLen = Math.max(totalLen, endAbs);
      continue;
    }

    const rawStart = Number.isFinite(chunk?.locator?.charStart)
      ? chunk.locator.charStart
      : Number.isFinite(chunk?.offset)
        ? chunk.offset
        : processedUntil;
    const rawEnd = Number.isFinite(chunk?.locator?.charEnd)
      ? chunk.locator.charEnd
      : Number.isFinite(chunk?.offset)
        ? rawStart + text.length
        : rawStart + text.length;

    totalLen = Math.max(totalLen, rawEnd);

    // Skip overlaps we have already scanned.
    let startAbs = rawStart;
    let segment = text;
    if (startAbs < processedUntil) {
      const skip = processedUntil - startAbs;
      if (skip >= segment.length) continue;
      segment = segment.slice(skip);
      startAbs += skip;
    } else if (startAbs > processedUntil) {
      // Gap/discontinuity: reset carry to avoid corrupting line offsets.
      carry = "";
      carryStartAbs = startAbs;
      processedUntil = startAbs;
    }

    // Ensure carry is contiguous with the new segment.
    if (!carry) {
      carryStartAbs = startAbs;
    } else if (carryStartAbs + carry.length !== startAbs) {
      carry = "";
      carryStartAbs = startAbs;
    }

    // Scan for "\n" and process full lines.
    let i = 0;
    while (true) {
      if (signal?.aborted) throw abortError("buildTocStreaming: aborted");
      const nl = segment.indexOf("\n", i);
      if (nl === -1) break;

      const linePart = segment.slice(i, nl);
      const lineEndAbs = startAbs + nl;

      if (carry) {
        processLine(carry + linePart, carryStartAbs, lineEndAbs);
        carry = "";
      } else {
        processLine(linePart, startAbs + i, lineEndAbs);
      }

      i = nl + 1;
      if (!carry) carryStartAbs = startAbs + i;
    }

    const tail = segment.slice(i);
    if (tail) {
      if (carry) carry = carry + tail;
      else {
        carry = tail;
        carryStartAbs = startAbs + i;
      }
    } else if (!carry) {
      carryStartAbs = startAbs + segment.length;
    }

    processedUntil = startAbs + segment.length;
  }

  if (signal?.aborted) throw abortError("buildTocStreaming: aborted");

  // Flush final line (no trailing "\n" needed).
  if (carry) processLine(carry, carryStartAbs, carryStartAbs + carry.length);

  computeSectionEnds(tocNodes, totalLen);
  const fallbackSections = tocNodes.length === 0 ? buildFallbackSectionsByLength(totalLen) : [];
  return { tocNodes, fallbackSections };
}
