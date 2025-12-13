// TP5: Extract atomic claims and align to evidence locators (charStart/charEnd on sourceTextNormalized).
//
// Hard constraints:
// - claims[].evidenceIds.length >= 1
// - evidence.quote must be locatable within sourceTextNormalized via locator

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function toStringPreserveWhitespace(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  return String(v);
}

function collapseWhitespace(s) {
  return String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function pickEvidenceSpan(chunkText, { maxLen = 220 } = {}) {
  const t = String(chunkText || "");
  if (!t.length) return null;

  let start = 0;
  while (start < t.length && /\s/.test(t[start])) start++;
  if (start >= t.length) return null;

  let end = Math.min(t.length, start + maxLen);

  // Try to end at a sentence boundary within the window.
  const window = t.slice(start, end);
  const m = window.match(/[。！？.!?](?=\s|$)/);
  if (m && typeof m.index === "number" && m.index >= 40) end = start + m.index + 1;

  if (end <= start) return null;
  return { relStart: start, relEnd: end };
}

function desiredClaimCount(slideIntents, { maxPerSlide = 2 } = {}) {
  const slides = Array.isArray(slideIntents) ? slideIntents : [];
  const contentSlides = slides.filter((s) => {
    const t = String(s?.pageType || "");
    return t && t !== "cover" && t !== "agenda" && t !== "appendix";
  });
  const base = Math.max(1, contentSlides.length * maxPerSlide);
  return base;
}

function assertQuoteLocatable(sourceTextNormalized, locator, quote) {
  const text = String(sourceTextNormalized || "");
  const charStart = safeInt(locator?.charStart);
  const charEnd = safeInt(locator?.charEnd);
  if (charStart === null || charEnd === null) throw new Error("Hard gate failed: evidence.locator must include charStart/charEnd");
  if (!(charStart < charEnd)) throw new Error("Hard gate failed: evidence.locator.charStart must be < charEnd");
  if (charStart < 0 || charEnd > text.length) throw new Error("Hard gate failed: evidence.locator out of bounds");
  const slice = text.slice(charStart, charEnd);
  if (!slice.includes(String(quote || ""))) throw new Error("Hard gate failed: evidence.quote not locatable within sourceTextNormalized slice");
}

/**
 * @param {Array<{chunkId:string,text:string,locator:{charStart:number,charEnd:number,lineStart?:number,lineEnd?:number}}>} chunks
 * @param {Array<{slideIntentId:string,pageType:string,title:string}>} slideIntents
 * @param {{sourceId?:string,sourceTextNormalized?:string,maxClaims?:number,maxQuoteLen?:number}=} options
 * @returns {{claims: Array, evidenceLedger: Array}}
 */
export function extractClaims(chunks, slideIntents, options = {}) {
  if (!Array.isArray(chunks)) throw new TypeError("extractClaims(chunks): chunks must be an array");
  if (!Array.isArray(slideIntents)) throw new TypeError("extractClaims(chunks, slideIntents): slideIntents must be an array");
  if (!isPlainObject(options)) throw new TypeError("extractClaims(..., options): options must be an object");

  const sourceId = toNonEmptyString(options.sourceId) || "user_text";
  // Important: do NOT trim sourceTextNormalized; locators are defined against it.
  const sourceTextNormalized = toStringPreserveWhitespace(options.sourceTextNormalized);

  const maxClaims =
    typeof options.maxClaims === "number" && Number.isFinite(options.maxClaims) && options.maxClaims > 0
      ? Math.floor(options.maxClaims)
      : Math.min(Math.max(1, desiredClaimCount(slideIntents, { maxPerSlide: 2 })), chunks.length || 0, 24);

  const claims = [];
  const evidenceLedger = [];

  let n = 0;
  for (const chunk of chunks) {
    if (n >= maxClaims) break;
    if (!chunk || typeof chunk.text !== "string") continue;
    const baseStart = safeInt(chunk?.locator?.charStart);
    const baseEnd = safeInt(chunk?.locator?.charEnd);
    if (baseStart === null || baseEnd === null || !(baseStart < baseEnd)) continue;

    const span = pickEvidenceSpan(chunk.text, { maxLen: options.maxQuoteLen || 220 });
    if (!span) continue;

    const charStart = baseStart + span.relStart;
    const charEnd = baseStart + span.relEnd;
    if (!(charStart < charEnd)) continue;

    // Prefer quoting from the sourceTextNormalized for hard-gate stability.
    const quote = sourceTextNormalized.length ? sourceTextNormalized.slice(charStart, charEnd) : chunk.text.slice(span.relStart, span.relEnd);
    if (!quote) continue;

    const locator = { charStart, charEnd };
    if (safeInt(chunk?.locator?.lineStart) !== null) locator.lineStart = chunk.locator.lineStart;
    if (safeInt(chunk?.locator?.lineEnd) !== null) locator.lineEnd = chunk.locator.lineEnd;

    if (sourceTextNormalized.length) assertQuoteLocatable(sourceTextNormalized, locator, quote);

    n++;
    const evidenceId = `e${n}`;
    const claimId = `c${n}`;

    evidenceLedger.push({ evidenceId, sourceId, locator, quote });
    claims.push({
      claimId,
      text: collapseWhitespace(quote),
      evidenceIds: [evidenceId],
      ...(n === 1 ? { importance: "core" } : { importance: "support" }),
    });
  }

  // Ensure at least one claim/evidence even for short texts.
  if (claims.length === 0 && sourceTextNormalized.length) {
    const charStart = 0;
    const charEnd = Math.min(sourceTextNormalized.length, 200);
    const quote = sourceTextNormalized.slice(charStart, charEnd);
    const locator = { charStart, charEnd };
    evidenceLedger.push({ evidenceId: "e1", sourceId, locator, quote });
    claims.push({ claimId: "c1", text: collapseWhitespace(quote), evidenceIds: ["e1"], importance: "core" });
  }

  // Hard constraint H1 in-scope for TP5.
  for (const c of claims) {
    if (!c || !Array.isArray(c.evidenceIds) || c.evidenceIds.length < 1) {
      throw new Error("Hard gate failed: claims[].evidenceIds.length must be >= 1");
    }
  }

  return { claims, evidenceLedger };
}
