import { KEY_PAGE_TYPES, normalizePageType } from "../stages/textprep/constants.js";
import { SlideElementType, normalizeSlideElementType } from "../../ppt/slide-constants.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function getSlideParser() {
  const sp = globalThis?.SlideParser;
  if (!sp || typeof sp.parse !== "function") {
    throw new Error("SlideParser.parse is not available (expected globalThis.SlideParser)");
  }
  return sp;
}

function flattenElements(elements) {
  const out = [];
  const stack = [...safeArray(elements)];
  while (stack.length) {
    const el = stack.shift();
    if (!el || typeof el !== "object") continue;
    out.push(el);
    if (Array.isArray(el.children)) stack.unshift(...el.children);
  }
  return out;
}

function isEditableElement(el) {
  // Conservative: raster images are treated as non-editable; other schema elements are considered editable.
  const raw = String(el?.type || "").trim();
  if (!raw) return false;
  const t = normalizeSlideElementType(raw);
  if (!t) return true;
  if (t === SlideElementType.IMAGE || t === SlideElementType.BAKED_ELEMENT) return false;
  return true;
}

function computeSlideEditabilityRatio(slide) {
  const els = flattenElements(slide?.elements);
  const total = els.length;
  const editable = els.filter(isEditableElement).length;
  return {
    editable,
    total,
    ratio: total > 0 ? editable / total : 0,
  };
}

function findSourceTextById(contentPackage) {
  // Best-effort: evaluation stage may not have L0 full text in the ContentPackage.
  const map = new Map();

  const fromMap = contentPackage?.__sourceTextById || contentPackage?.sourceTextById;
  if (fromMap && typeof fromMap === "object") {
    for (const [k, v] of Object.entries(fromMap)) {
      if (typeof v === "string") map.set(String(k), v);
    }
  }

  for (const s of safeArray(contentPackage?.sources)) {
    const sid = toNonEmptyString(s?.sourceId);
    const text = typeof s?.sourceTextNormalized === "string" ? s.sourceTextNormalized : null;
    if (sid && text !== null) map.set(sid, text);
  }

  // TextPrep internal convention (not in public spec): some flows may attach it.
  const primaryText = typeof contentPackage?.sourceTextNormalized === "string" ? contentPackage.sourceTextNormalized : null;
  if (primaryText !== null && !map.has("user_text")) map.set("user_text", primaryText);

  return map;
}

function checkG7ClaimsHaveEvidence(contentPackage) {
  const claims = safeArray(contentPackage?.claims);
  const bad = claims.filter((c) => !Array.isArray(c?.evidenceIds) || c.evidenceIds.length < 1).map((c) => c?.claimId).filter(Boolean);
  return { pass: bad.length === 0, badClaimIds: bad, claimsCount: claims.length };
}

function checkG8G9EvidenceTraceability(contentPackage) {
  const evidences = safeArray(contentPackage?.evidenceLedger);
  const sourceTextById = findSourceTextById(contentPackage);

  const invalidLocator = [];
  const quoteMismatch = [];
  const checkedQuotes = [];
  let skippedQuoteCheck = 0;

  for (const e of evidences) {
    const evidenceId = toNonEmptyString(e?.evidenceId) || "(missing_evidenceId)";
    const locator = e?.locator;
    const charStart = locator?.charStart;
    const charEnd = locator?.charEnd;
    const sourceId = toNonEmptyString(e?.sourceId);
    const quote = typeof e?.quote === "string" ? e.quote : "";

    const locatorOk = typeof charStart === "number" && typeof charEnd === "number" && Number.isFinite(charStart) && Number.isFinite(charEnd) && charStart < charEnd;
    if (!locatorOk) {
      invalidLocator.push({ evidenceId, reason: "invalid_char_range" });
      continue;
    }

    // If we can "read back", enforce bounds as well.
    const srcText = sourceId ? sourceTextById.get(sourceId) : null;
    if (typeof srcText === "string" && srcText.length) {
      if (charStart < 0 || charEnd > srcText.length) {
        invalidLocator.push({ evidenceId, reason: "out_of_bounds", charStart, charEnd, sourceLen: srcText.length, sourceId });
        continue;
      }
      const slice = srcText.slice(charStart, charEnd);
      const ok = quote ? slice.includes(quote) : false;
      checkedQuotes.push({ evidenceId, ok });
      if (!ok) quoteMismatch.push({ evidenceId, sourceId, charStart, charEnd, quote });
    } else {
      skippedQuoteCheck++;
      // Without source text, we can only validate presence.
      if (!quote) quoteMismatch.push({ evidenceId, reason: "missing_quote" });
    }
  }

  return {
    g8Pass: invalidLocator.length === 0,
    g9Pass: quoteMismatch.length === 0,
    details: {
      evidenceCount: evidences.length,
      invalidLocator,
      quoteMismatch,
      checkedQuotes,
      skippedQuoteCheck,
      hasSourceTextForAny: Array.from(sourceTextById.values()).some((t) => typeof t === "string" && t.length > 0),
    },
  };
}

function summarizeLint(lintResult) {
  const counts = isPlainObject(lintResult?.counts) ? lintResult.counts : isPlainObject(lintResult?.summary) ? lintResult.summary : {};
  const minFont = Number(counts?.min_font ?? counts?.minFontViolations ?? 0) || 0;
  const overflow = Number(counts?.overflow ?? counts?.overflowViolations ?? 0) || 0;
  const overflowX = Number(counts?.overflow_x ?? 0) || 0;
  const overflowY = Number(counts?.overflow_y ?? 0) || 0;
  const contrast = Number(counts?.contrast ?? counts?.contrastViolations ?? 0) || 0;

  return {
    minFontViolations: minFont,
    overflowViolations: overflow || overflowX + overflowY,
    overflowX,
    overflowY,
    contrastViolations: contrast,
  };
}

function summarizeExport(exportResult) {
  const formats = isPlainObject(exportResult?.formats) ? exportResult.formats : isPlainObject(exportResult) ? exportResult : {};
  const pptx = !!formats?.pptx?.success;
  const pdf = !!formats?.pdf?.success;
  const images = !!formats?.images?.success;
  return { pptx, pdf, images };
}

/**
 * Hard Gates checker (G1-G10).
 *
 * @param {object} contentPackage ContentPackage v0.1
 * @param {object} deckPackage DeckPackage (deckHtmlDsl, slidesMeta...)
 * @param {object} exportResult ExportResult (formats.pptx/pdf/images)
 * @param {object} lintResult lint report (counts per code)
 * @param {{parsedSlides?:Array, editabilityThreshold?:number}=} context
 * @returns {{pass:boolean, failed:string[], details:object}}
 */
export function checkHardGates(contentPackage, deckPackage, exportResult, lintResult, context = {}) {
  const details = {};
  const failed = [];

  // G1: SlideParser.parse(deckHtmlDsl) success.
  let parsedSlides = Array.isArray(context?.parsedSlides) ? context.parsedSlides : null;
  let parseOk = false;
  let parseError = null;
  if (!parsedSlides) {
    try {
      const sp = getSlideParser();
      parsedSlides = sp.parse(deckPackage?.deckHtmlDsl);
      parseOk = true;
    } catch (e) {
      parseOk = false;
      parseError = String(e?.message || e);
      parsedSlides = null;
    }
  } else {
    parseOk = true;
  }
  details.G1 = { pass: parseOk, slidesCount: Array.isArray(parsedSlides) ? parsedSlides.length : 0, error: parseError || undefined };
  if (!parseOk) failed.push("G1_parse_failed");

  // G2-G3: Export success.
  const exp = summarizeExport(exportResult);
  details.G2 = { pass: exp.pptx, formats: exp };
  if (!exp.pptx) failed.push("G2_pptx_export_failed");

  details.G3 = { pass: exp.pdf || exp.images, formats: exp };
  if (!(exp.pdf || exp.images)) failed.push("G3_pdf_or_images_export_failed");

  // G4-G6: Layout lint.
  const lint = summarizeLint(lintResult);
  details.G4 = { pass: lint.minFontViolations === 0, minFontViolations: lint.minFontViolations };
  if (lint.minFontViolations !== 0) failed.push("G4_min_font_violations");

  details.G5 = { pass: lint.overflowViolations === 0, overflowViolations: lint.overflowViolations, overflowX: lint.overflowX, overflowY: lint.overflowY };
  if (lint.overflowViolations !== 0) failed.push("G5_overflow_violations");

  details.G6 = { pass: lint.contrastViolations === 0, contrastViolations: lint.contrastViolations };
  if (lint.contrastViolations !== 0) failed.push("G6_contrast_violations");

  // G7-G9: Provenance traceability.
  const g7 = checkG7ClaimsHaveEvidence(contentPackage);
  details.G7 = g7;
  if (!g7.pass) failed.push("G7_claims_missing_evidence");

  const g89 = checkG8G9EvidenceTraceability(contentPackage);
  details.G8 = { pass: g89.g8Pass, ...g89.details };
  details.G9 = { pass: g89.g9Pass, ...g89.details };
  if (!g89.g8Pass) failed.push("G8_locator_invalid");
  if (!g89.g9Pass) failed.push("G9_quote_mismatch");

  // G10: Editability on key slides.
  const threshold =
    typeof context?.editabilityThreshold === "number" && Number.isFinite(context.editabilityThreshold) ? context.editabilityThreshold : 0.6;
  const slidesMeta = safeArray(deckPackage?.slidesMeta);
  const keySlideNos = slidesMeta
    .filter((m) => KEY_PAGE_TYPES.has(normalizePageType(m?.pageType)))
    .map((m) => Number(m?.slideNo))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!parseOk || !Array.isArray(parsedSlides)) {
    details.G10 = { pass: false, threshold, skipped: true, reason: "parse_failed" };
    // Do not cascade-fail: if parse failed, G1 is the primary gate.
  } else if (keySlideNos.length === 0) {
    details.G10 = { pass: true, threshold, keySlides: [], note: "no_key_slides_identified" };
  } else {
    const keySlides = [];
    let g10Pass = true;
    for (const slideNo of keySlideNos) {
      const slide = parsedSlides[slideNo - 1];
      const ratio = computeSlideEditabilityRatio(slide);
      const pageType = slidesMeta.find((m) => Number(m?.slideNo) === slideNo)?.pageType;
      const pass = ratio.ratio >= threshold;
      if (!pass) g10Pass = false;
      keySlides.push({ slideNo, pageType, ...ratio, pass });
    }
    details.G10 = { pass: g10Pass, threshold, keySlides };
    if (!g10Pass) failed.push("G10_editability_below_threshold");
  }

  return { pass: failed.length === 0, failed, details };
}

export { KEY_PAGE_TYPES };
