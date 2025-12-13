import { buildSlideHtml } from "./dsl-builder.js";

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function looksLikeSlideHtml(html) {
  if (typeof html !== "string") return false;
  return /<section\b[^>]*\bdata-type="freeform"[^>]*>/i.test(html) && /\bdata-el=/i.test(html);
}

function ensureSectionAttr(slideHtml, name, value) {
  if (typeof slideHtml !== "string") return slideHtml;
  const m = slideHtml.match(/<section\b[^>]*>/i);
  if (!m) return slideHtml;
  const tag = m[0];
  if (new RegExp(`\\b${name}=`,"i").test(tag)) return slideHtml;
  const patched = tag.replace(/<section\b/i, `<section ${name}="${String(value).replace(/"/g, "&quot;")}"`);
  return slideHtml.replace(tag, patched);
}

function layoutFromPageType(pageType) {
  const t = String(pageType || "overview").toLowerCase();
  if (t === "cover") return "cover";
  if (t === "agenda") return "agenda";
  if (t === "comparison") return "two_column";
  if (t === "process" || t === "roadmap") return "process";
  if (t === "summary") return "summary";
  if (t === "appendix") return "appendix";
  return "content";
}

function makePrompt(batch, designSystem, contentPackage) {
  const tokens = designSystem?.designTokens || designSystem || {};
  return [
    "You generate PPT HTML DSL slides for SlideParser.parse().",
    "Return ONLY valid JSON (no markdown), an array with same order as input.",
    'Each item: {"slideIntentId":string,"slideHtml":string}.',
    "",
    "Hard requirements:",
    '- slideHtml MUST be a single <section data-type="freeform" ...> ... </section>.',
    '- Elements MUST use data-el attributes (text/shape/line/svg/image/card/icon).',
    "- All positions use percent for data-x/data-y/data-w/data-h (0-100%).",
    "- Enforce min font size >= 12.",
    "",
    "Design tokens (use these colors/typography):",
    JSON.stringify(tokens),
    "",
    "Content summary:",
    String(contentPackage?.summary || "").slice(0, 1200),
    "",
    "Slide intents:",
    JSON.stringify(
      batch.map((s) => ({
        slideIntentId: s.slideIntentId,
        pageType: s.pageType,
        title: s.title,
        objective: s.objective,
        keyPoints: s.keyPoints,
        claimIds: s.claimIds,
        dataTableIds: s.dataTableIds,
      }))
    ),
  ].join("\n");
}

/**
 * Generate slides in batches (max 4 per batch).
 *
 * Supported call forms:
 * - generateBatch(slideIntents, contentPackage, designSystem, options)
 * - generateBatch(slideIntents, contentPackage, options) where options.designSystem is provided
 *
 * @returns {Promise<Array<{slideIntentId:string,slideHtml:string,source:"llm"|"fallback"}>>}
 */
export async function generateBatch(slideIntents, contentPackage, designSystemOrOptions = {}, maybeOptions = {}) {
  const intents = Array.isArray(slideIntents) ? slideIntents : [];

  const hasFourthArg = arguments.length >= 4;
  const designSystem = hasFourthArg ? designSystemOrOptions : designSystemOrOptions?.designSystem;
  const options = hasFourthArg ? (maybeOptions || {}) : (designSystemOrOptions || {});

  const batchSize = Math.min(4, Math.max(1, Number(options.batchSize) || 4));
  const aiApiService = options.aiApiService;
  const emit = typeof options.emit === "function" ? options.emit : null;
  const signal = options.signal;

  const claims = Array.isArray(contentPackage?.claims) ? contentPackage.claims : [];
  const evidences = Array.isArray(contentPackage?.evidenceLedger) ? contentPackage.evidenceLedger : [];

  const out = [];
  const batches = chunk(intents, batchSize);
  let done = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");

    const batch = batches[batchIndex];
    const slideRange = [done + 1, done + batch.length];
    emit?.("design.batch.started", { batchIndex, slideRange, batchSize: batch.length, totalBatches: batches.length }, { status: "started" });

    /** @type {Array<{slideIntentId:string,slideHtml:string,source:"llm"|"fallback"}>} */
    let produced = [];

    if (aiApiService && typeof aiApiService.chat === "function") {
      try {
        const prompt = makePrompt(batch, designSystem, contentPackage);
        const resp = await aiApiService.chat({
          messages: [
            { role: "system", content: "You are a precise PPT DSL generator." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          maxTokens: 6000,
        });

        const parsed = JSON.parse(resp?.content || "null");
        if (Array.isArray(parsed)) {
          const byId = new Map(parsed.map((x) => [x?.slideIntentId, x?.slideHtml]));
          produced = batch.map((si) => {
            let slideHtml = byId.get(si.slideIntentId);
            if (typeof slideHtml === "string") {
              // Tests' stub LLM omits data-layout; make it deterministic here.
              slideHtml = ensureSectionAttr(slideHtml, "data-layout", layoutFromPageType(si.pageType));
            }
            return { slideIntentId: si.slideIntentId, slideHtml, source: "llm" };
          });

          if (produced.every((r) => looksLikeSlideHtml(r.slideHtml))) {
            // ok
          } else {
            produced = [];
          }
        }
      } catch {
        produced = [];
      }
    }

    if (produced.length === 0) {
      produced = batch.map((si, i) => ({
        slideIntentId: si.slideIntentId,
        slideHtml: buildSlideHtml(si, designSystem, claims, evidences, { safeMode: true, slideNo: done + i + 1 }),
        source: "fallback",
      }));
    }

    for (let i = 0; i < produced.length; i++) {
      out.push(produced[i]);
      done++;
      emit?.(
        "design.batch.progress",
        { batchIndex, doneSlides: done, totalSlides: intents.length, slideIntentId: produced[i].slideIntentId, source: produced[i].source },
        { status: "progress" }
      );
    }

    emit?.(
      "design.batch.ended",
      { batchIndex, slideRange, slidesGenerated: produced.length, source: produced[0]?.source || "fallback" },
      { status: "ended" }
    );
    // Alias for spec wording (started/completed).
    emit?.(
      "design.batch.completed",
      { batchIndex, slideRange, slidesGenerated: produced.length, source: produced[0]?.source || "fallback" },
      { status: "ended" }
    );
  }

  return out;
}
