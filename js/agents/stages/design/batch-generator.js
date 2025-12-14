import { buildSlideHtml } from "./dsl-builder.js";

function nowMs() {
  return Date.now();
}

function safeEmit(emit, name, status, payload) {
  if (typeof emit !== "function") return;
  emit(name, { actor: "design", status, payload });
}

function chunkIndexes(len, size) {
  const out = [];
  const n = Math.max(0, Number(len) || 0);
  const chunkSize = Math.max(1, Number(size) || 1);
  for (let i = 0; i < n; i += chunkSize) {
    const slideIndexes = [];
    for (let j = i; j < Math.min(n, i + chunkSize); j++) slideIndexes.push(j);
    out.push(slideIndexes);
  }
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

function normalizeDslRules(dslRules) {
  if (typeof dslRules === "string") return dslRules.trim();
  if (dslRules === undefined || dslRules === null) return "";
  return String(dslRules).trim();
}

function makePrompt(batch, designSystem, contentPackage, imageSlotsForBatch = [], dslRules = "") {
  const tokens = designSystem?.designTokens || designSystem || {};
  const slots = Array.isArray(imageSlotsForBatch) ? imageSlotsForBatch : [];
  const rulesText = normalizeDslRules(dslRules);

  // Build style reference section if available
  const styleRef = designSystem?.styleReference?.extracted;
  const styleRefLines = styleRef && (styleRef.colorTone || styleRef.mood || styleRef.layoutStyle || styleRef.typography || styleRef.effects)
    ? [
        "",
        "Style reference (user-provided, follow these guidelines):",
        ...(styleRef.colorTone ? [`- Color tone: ${styleRef.colorTone}`] : []),
        ...(styleRef.mood ? [`- Mood: ${styleRef.mood}`] : []),
        ...(styleRef.layoutStyle ? [`- Layout style: ${styleRef.layoutStyle}`] : []),
        ...(styleRef.typography ? [`- Typography: ${styleRef.typography}`] : []),
        ...(styleRef.effects ? [`- Visual effects: ${styleRef.effects}`] : []),
        ...(designSystem?.styleReference?.userNotes ? [`- User notes: ${designSystem.styleReference.userNotes}`] : []),
        "",
      ]
    : [];

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
    ...(slots.length
      ? [
          "Image slots (placeholders):",
          "- For each slot listed below, add EXACTLY ONE placeholder element into the correct slide HTML.",
          "- Do NOT inline base64, do NOT create real <img> tags for these slots.",
          "- Use the stable slotId as both id and data-slot-id.",
          "- Placeholder HTML (attributes required; you may add x/y/w/h positioning as needed):",
          '<div data-el="image-placeholder" id="img_s0_hero" data-slot-id="img_s0_hero" data-status="pending" data-aspect-ratio="16:9" data-fallback="gradient"></div>',
          "",
          "Slots for this batch:",
          JSON.stringify(
            slots.map((s) => ({
              slotId: s.slotId,
              slideIntentId: s.slideIntentId,
              slideIndex: s.slideIndex,
              purpose: s.purpose,
              aspectRatio: s.aspectRatio,
              priority: s.priority,
            }))
          ),
          "",
        ]
      : []),
    "",
    "Design tokens (use these colors/typography):",
    JSON.stringify(tokens),
    ...styleRefLines,
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
    ...(rulesText ? ["", "DSL rules (follow strictly):", rulesText] : []),
  ].join("\n");
}

/**
 * Generate a single slide HTML DSL.
 *
 * @param {object} slideIntent
 * @param {object} designSystem
 * @param {string} dslRules
 * @param {{aiApiService?:object,contentPackage?:object,signal?:AbortSignal,slideNo?:number,imageSlotsForSlide?:Array<object>}=} options
 * @returns {Promise<{slideIntentId:string,slideHtml:string,source:"llm"|"fallback"}>}
 */
export async function generateSingleSlide(slideIntent, designSystem, dslRules, options = {}) {
  const si = slideIntent || {};
  const slideIntentId = String(si.slideIntentId || si.slideIntentID || "");
  const contentPackage = options.contentPackage || {};
  const imageSlotsForSlide = Array.isArray(options.imageSlotsForSlide) ? options.imageSlotsForSlide : [];
  const slideNo = Number.isFinite(options.slideNo) ? options.slideNo : 1;

  if (options.signal?.aborted) throw new Error(typeof options.signal.reason === "string" ? options.signal.reason : "Run cancelled");

  const aiApiService = options.aiApiService;
  if (aiApiService && typeof aiApiService.chat === "function") {
    const prompt = makePrompt([si], designSystem, contentPackage, imageSlotsForSlide, dslRules);
    const resp = await aiApiService.chat({
      messages: [
        { role: "system", content: "You are a precise PPT DSL generator." },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 2500,
    });

    const parsed = JSON.parse(resp?.content || "null");
    const candidate = Array.isArray(parsed)
      ? parsed.find((x) => x?.slideIntentId === slideIntentId) || parsed[0]
      : parsed && typeof parsed === "object"
        ? parsed
        : null;

    let slideHtml = typeof candidate?.slideHtml === "string" ? candidate.slideHtml : "";
    slideHtml = ensureSectionAttr(slideHtml, "data-layout", layoutFromPageType(si.pageType));
    if (!looksLikeSlideHtml(slideHtml)) throw new Error("Invalid slideHtml returned by model");
    return { slideIntentId, slideHtml, source: "llm" };
  }

  const slideHtml = buildSlideHtml(si, designSystem, contentPackage, {
    safeMode: true,
    slideNo,
    imageSlotsForSlide,
  });
  return { slideIntentId, slideHtml, source: "fallback" };
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
  const imageSlots = Array.isArray(options.imageSlots) ? options.imageSlots : [];
  const dslRules = normalizeDslRules(options.dslRules);

  /** @type {Array<{slideIntentId:string,slideHtml:string,source:"llm"|"fallback"}>} */
  const out = new Array(intents.length);
  const batches = chunkIndexes(intents.length, batchSize);

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");

    const slideIndexes = batches[batchIndex];
    safeEmit(emit, "design.batch.started", "started", { batchIndex, slideIndexes });

    const tBatch = nowMs();
    await Promise.all(
      slideIndexes.map(async (slideIndex) => {
        const slideIntent = intents[slideIndex];
        const imageSlotsForSlide = imageSlots.filter((s) => s.slideIndex === slideIndex);

        const t0 = nowMs();
        safeEmit(emit, "design.slide.started", "started", { slideIndex, slideIntent });

        let lastErr = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");

          if (aiApiService && typeof aiApiService.chat === "function") {
            safeEmit(emit, "design.slide.progress", "progress", {
              slideIndex,
              step: "llm",
              msg: `Attempt ${attempt + 1}`,
            });

            try {
              const res = await generateSingleSlide(slideIntent, designSystem, dslRules, {
                aiApiService,
                contentPackage,
                signal,
                slideNo: slideIndex + 1,
                imageSlotsForSlide,
              });
              out[slideIndex] = res;
              const duration = nowMs() - t0;
              safeEmit(emit, "design.slide.completed", "completed", { slideIndex, html: res.slideHtml, duration });
              return;
            } catch (e) {
              lastErr = e;
              if (attempt < 1) safeEmit(emit, "design.slide.retrying", "retrying", { slideIndex, attempt: attempt + 1 });
            }
          } else {
            safeEmit(emit, "design.slide.progress", "progress", { slideIndex, step: "fallback", msg: "No AI service" });
            const res = await generateSingleSlide(slideIntent, designSystem, dslRules, {
              contentPackage,
              signal,
              slideNo: slideIndex + 1,
              imageSlotsForSlide,
            });
            out[slideIndex] = res;
            const duration = nowMs() - t0;
            safeEmit(emit, "design.slide.completed", "completed", { slideIndex, html: res.slideHtml, duration });
            return;
          }
        }

        const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr || "Unknown error");
        safeEmit(emit, "design.slide.failed", "failed", { slideIndex, error: errMsg });
        safeEmit(emit, "design.slide.progress", "progress", { slideIndex, step: "fallback", msg: "Falling back to templates" });

        const res = await generateSingleSlide(slideIntent, designSystem, dslRules, {
          contentPackage,
          signal,
          slideNo: slideIndex + 1,
          imageSlotsForSlide,
        });
        out[slideIndex] = res;
        const duration = nowMs() - t0;
        safeEmit(emit, "design.slide.completed", "completed", { slideIndex, html: res.slideHtml, duration });
      })
    );

    safeEmit(emit, "design.batch.completed", "completed", { batchIndex, slideIndexes, duration: nowMs() - tBatch });
  }

  return out;
}
