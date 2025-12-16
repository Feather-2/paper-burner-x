import { buildSlideHtml } from "./dsl-builder.js";
import { getDesignModelCaller } from "./model.js";

function nowMs() {
  return Date.now();
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function extractJsonCandidate(text) {
  let s = String(text || "").trim();
  if (!s) return null;

  // Remove markdown code block markers (```json, ```, etc.)
  s = s.replace(/^```(?:json)?[\s\n]*/i, "").replace(/[\s\n]*```$/i, "");
  s = s.trim();

  // Remove leading "json" if AI prepended it
  if (s.toLowerCase().startsWith("json")) {
    s = s.slice(4).trim();
  }

  // Try to find JSON array
  const firstBracket = s.indexOf("[");
  const lastBracket = s.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) return s.slice(firstBracket, lastBracket + 1);

  // Try to find JSON object
  const firstBrace = s.indexOf("{");
  const lastBrace = s.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) return s.slice(firstBrace, lastBrace + 1);

  return s;
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

// Try to fix common issues with AI-generated slideHtml
function tryFixSlideHtml(html, slideIntent) {
  if (typeof html !== "string" || !html.trim()) return null;
  let s = html.trim();

  // If no <section>, wrap content in a section
  if (!/<section\b/i.test(s)) {
    const title = String(slideIntent?.title || "Slide").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = `<section data-type="freeform" data-bg="#ffffff" data-title="${title}">${s}</section>`;
  }

  // Ensure data-type="freeform"
  if (!/<section\b[^>]*data-type=/i.test(s)) {
    s = s.replace(/<section\b/i, '<section data-type="freeform"');
  }

  // If no data-el elements, try to convert common elements
  if (!/\bdata-el=/i.test(s)) {
    // Convert <div> or <p> to data-el="text"
    s = s.replace(/<(div|p)\b([^>]*)>/gi, '<div data-el="text"$2>');
    // Convert <h1>-<h6> to data-el="text" with bold
    s = s.replace(/<h[1-6]\b([^>]*)>/gi, '<div data-el="text" data-bold="true"$1>');
    s = s.replace(/<\/h[1-6]>/gi, '</div>');
  }

  // Still invalid? Return null to trigger fallback
  if (!looksLikeSlideHtml(s)) return null;
  return s;
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

function normalizeSlideIntentContentForPrompt(slideIntent) {
  const content = slideIntent?.content;
  if (typeof content === "string") {
    const s = content.trim();
    return { content: s || null, contentMarkdown: s || "" };
  }
  if (content && typeof content === "object") {
    const markdown = typeof content?.markdown === "string" ? content.markdown.trim() : "";
    return { content, contentMarkdown: markdown };
  }
  return { content: null, contentMarkdown: "" };
}

function normalizeSelectedIdeas(selectedIdeas = []) {
  const list = Array.isArray(selectedIdeas) ? selectedIdeas : [];

  /** @type {Map<string, {slideIntentId:string,atmosphere?:any,elementsMarkdown?:string,visualSlots?:Array<object>}>} */
  const bySlideIntentId = new Map();
  /** @type {Map<string, {slotId:string,slideIntentId?:string,renderType?:string,position?:any,effects?:any}>} */
  const bySlotId = new Map();

  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const slideIntentId = toNonEmptyString(raw.slideIntentId || raw.slideIntentID);
    if (!slideIntentId) continue;

    const atmosphere = raw.atmosphere && typeof raw.atmosphere === "object" ? { ...raw.atmosphere } : undefined;
    const elementsMarkdown = typeof raw.elementsMarkdown === "string" ? raw.elementsMarkdown : "";
    const visualSlots = Array.isArray(raw.visualSlots) ? raw.visualSlots.filter((s) => s && typeof s === "object") : [];

    bySlideIntentId.set(slideIntentId, { slideIntentId, atmosphere, elementsMarkdown, visualSlots });

    for (const slot of visualSlots) {
      const slotId = toNonEmptyString(slot?.slotId);
      if (!slotId) continue;
      bySlotId.set(slotId, {
        slotId,
        slideIntentId: toNonEmptyString(slot?.slideIntentId) || slideIntentId,
        renderType: toNonEmptyString(slot?.renderType),
        position: slot?.position && typeof slot.position === "object" ? { ...slot.position } : undefined,
        effects: slot?.effects && typeof slot.effects === "object" ? { ...slot.effects } : undefined,
      });
    }
  }

  return { bySlideIntentId, bySlotId };
}

function parseTagAttributes(tag) {
  const attrs = {};
  const re = /\b([a-zA-Z0-9_:-]+)\s*=\s*(["'])(.*?)\2/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1]] = m[3];
  return attrs;
}

function escapeAttr(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildPatchedPlaceholder(tag, innerHtml, hint) {
  const attrs = parseTagAttributes(tag);
  const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
  if (!slotId) return null;

  const next = { ...attrs };
  if (hint?.renderType) next["data-render-type"] = hint.renderType;

  const position = hint?.position && typeof hint.position === "object" ? hint.position : null;
  if (position?.x) next["data-x"] = String(position.x);
  if (position?.y) next["data-y"] = String(position.y);
  if (position?.w) next["data-w"] = String(position.w);
  if (position?.h) next["data-h"] = String(position.h);

  const effects = hint?.effects && typeof hint.effects === "object" ? hint.effects : null;
  if (effects && Object.keys(effects).length) next["data-effects"] = JSON.stringify(effects);

  const attrPairs = Object.entries(next).map(([k, v]) => `${k}="${escapeAttr(v)}"`);
  return `<div ${attrPairs.join(" ")}>${innerHtml}</div>`;
}

function applyVisualSlotHintsToSlideHtml(slideHtml, imageSlotsForSlide = [], slotHintsBySlotId) {
  const html = typeof slideHtml === "string" ? slideHtml : "";
  const slots = Array.isArray(imageSlotsForSlide) ? imageSlotsForSlide : [];
  if (!html || !slots.length || !(slotHintsBySlotId instanceof Map) || slotHintsBySlotId.size === 0) return html;

  const needed = new Set(slots.map((s) => toNonEmptyString(s?.slotId)).filter(Boolean));
  if (needed.size === 0) return html;

  const slotById = new Map(slots.map((s) => [toNonEmptyString(s?.slotId), s]).filter((row) => row[0]));
  const seen = new Set();

  const placeholderRe = /<div\b[^>]*\bdata-el=(["'])image-placeholder\1[^>]*>([\s\S]*?)<\/div>/gi;
  const patched = html.replace(placeholderRe, (match, _q, inner) => {
    const tagMatch = match.match(/^<div\b[^>]*>/i);
    if (!tagMatch) return match;
    const attrs = parseTagAttributes(tagMatch[0]);
    const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
    if (!slotId || !needed.has(slotId)) return match;
    const hint = slotHintsBySlotId.get(slotId);
    if (!hint) return match;
    seen.add(slotId);
    return buildPatchedPlaceholder(tagMatch[0], inner, hint) || match;
  });

  const selfClosingRe = /<div\b[^>]*\bdata-el=(["'])image-placeholder\1[^>]*\/>/gi;
  const patched2 = patched.replace(selfClosingRe, (match) => {
    const attrs = parseTagAttributes(match);
    const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
    if (!slotId || !needed.has(slotId)) return match;
    const hint = slotHintsBySlotId.get(slotId);
    if (!hint) return match;
    seen.add(slotId);
    const tag = match.replace(/\/>$/i, ">");
    return buildPatchedPlaceholder(tag, "", hint) || match;
  });

  const missing = [...needed].filter((slotId) => !seen.has(slotId) && slotHintsBySlotId.has(slotId));
  if (missing.length === 0) return patched2;

  const insertTags = missing
    .map((slotId) => {
      const hint = slotHintsBySlotId.get(slotId);
      const baseSlot = slotById.get(slotId) || null;
      const attrs = {
        "data-el": "image-placeholder",
        id: slotId,
        "data-slot-id": slotId,
        "data-status": "pending",
        ...(toNonEmptyString(baseSlot?.aspectRatio) ? { "data-aspect-ratio": toNonEmptyString(baseSlot.aspectRatio) } : {}),
        "data-fallback": "gradient",
        ...(hint?.renderType ? { "data-render-type": hint.renderType } : {}),
        ...(hint?.position?.x ? { "data-x": String(hint.position.x) } : {}),
        ...(hint?.position?.y ? { "data-y": String(hint.position.y) } : {}),
        ...(hint?.position?.w ? { "data-w": String(hint.position.w) } : {}),
        ...(hint?.position?.h ? { "data-h": String(hint.position.h) } : {}),
        ...(hint?.effects && Object.keys(hint.effects).length ? { "data-effects": JSON.stringify(hint.effects) } : {}),
      };
      const attrPairs = Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`);
      return `<div ${attrPairs.join(" ")}></div>`;
    })
    .join("");

  if (/<\/section>\s*$/i.test(patched2)) return patched2.replace(/<\/section>\s*$/i, `${insertTags}</section>`);
  return patched2 + insertTags;
}

function makePrompt(batch, designSystem, contentPackage, imageSlotsForBatch = [], dslRules = "", selectedIdeas = []) {
  const tokens = designSystem?.designTokens || designSystem || {};
  const slots = Array.isArray(imageSlotsForBatch) ? imageSlotsForBatch : [];
  const rulesText = normalizeDslRules(dslRules);
  const selected = normalizeSelectedIdeas(selectedIdeas);

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
    "- Each slideIntent may include content as either a string (markdown) or an object with { markdown: string, ... }.",
    "- If content is an object, use content.markdown as the primary source text.",
    "",
    ...(slots.length
      ? [
          "Image slots (placeholders):",
          "- For each slot listed below, add EXACTLY ONE placeholder element into the correct slide HTML.",
          "- Do NOT inline base64, do NOT create real <img> tags for these slots.",
          "- Use the stable slotId as both id and data-slot-id.",
          "- Placeholder HTML (attributes required; use brainstorm position/effects when provided):",
          '<div data-el="image-placeholder" id="img_s0_hero" data-slot-id="img_s0_hero" data-status="pending" data-render-type="ai-image" data-aspect-ratio="16:9" data-fallback="gradient" data-x="10%" data-y="20%" data-w="30%" data-h="40%" data-effects=\'{\"blend\":\"multiply\",\"opacity\":0.8}\'></div>',
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
              renderType: selected.bySlotId.get(String(s.slotId || ""))?.renderType || s.renderType,
              position: selected.bySlotId.get(String(s.slotId || ""))?.position,
              effects: selected.bySlotId.get(String(s.slotId || ""))?.effects || s.effects,
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
      batch.map((s) => {
        const normalized = normalizeSlideIntentContentForPrompt(s);
        return {
          slideIntentId: s.slideIntentId,
          pageType: s.pageType,
          title: s.title,
          objective: s.objective,
          keyPoints: s.keyPoints,
          content: normalized.content,
          contentMarkdown: normalized.contentMarkdown,
          claimIds: s.claimIds,
          dataTableIds: s.dataTableIds,
          brainstorm: selected.bySlideIntentId.get(String(s.slideIntentId || "")) || null,
        };
      })
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
 * @param {{aiApiService?:object,modelRouter?:object,modelCaller?:Function,emit?:Function,signal?:AbortSignal,contentPackage?:object,slideNo?:number,slideIndex?:number,imageSlotsForSlide?:Array<object>,selectedIdeas?:Array<object>,slotHintsBySlotId?:Map<string, any>}=} options
 * @returns {Promise<{slideIntentId:string,slideHtml:string,source:"llm"|"fallback"}>}
 */
export async function generateSingleSlide(slideIntent, designSystem, dslRules, options = {}) {
  const si = slideIntent || {};
  const slideIntentId = String(si.slideIntentId || si.slideIntentID || "");
  const contentPackage = options.contentPackage || {};
  const imageSlotsForSlide = Array.isArray(options.imageSlotsForSlide) ? options.imageSlotsForSlide : [];
  const slideNo = Number.isFinite(options.slideNo) ? options.slideNo : 1;
  const slideIndex = Number.isFinite(options.slideIndex) ? options.slideIndex : Math.max(0, slideNo - 1);
  const selectedIdeas = Array.isArray(options.selectedIdeas) ? options.selectedIdeas : [];
  const slotHintsBySlotId = options.slotHintsBySlotId instanceof Map ? options.slotHintsBySlotId : null;
  const emit = typeof options.emit === "function" ? options.emit : null;

  if (options.signal?.aborted) throw new Error(typeof options.signal.reason === "string" ? options.signal.reason : "Run cancelled");

  const modelCaller =
    typeof options.modelCaller === "function"
      ? options.modelCaller
      : getDesignModelCaller(
          { modelRouter: options.modelRouter, aiApiService: options.aiApiService, signal: options.signal },
          { usage: "designer", timeoutMs: 30_000 }
        );

  if (typeof modelCaller === "function") {
    const prompt = makePrompt([si], designSystem, contentPackage, imageSlotsForSlide, dslRules, selectedIdeas);
    const messages = [
      { role: "system", content: "You are a precise PPT DSL generator." },
      { role: "user", content: prompt },
    ];

    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (options.signal?.aborted) throw new Error(typeof options.signal.reason === "string" ? options.signal.reason : "Run cancelled");
      try {
        const resp = await modelCaller(messages, { temperature: 0.2, maxTokens: 6000, signal: options.signal, timeoutMs: 30_000 });

        const jsonStr = extractJsonCandidate(resp?.content);
        const parsed = JSON.parse(jsonStr || "null");
        const candidate = Array.isArray(parsed)
          ? parsed.find((x) => x?.slideIntentId === slideIntentId) || parsed[0]
          : parsed && typeof parsed === "object"
            ? parsed
            : null;

        let slideHtml = typeof candidate?.slideHtml === "string" ? candidate.slideHtml : "";
        slideHtml = ensureSectionAttr(slideHtml, "data-layout", layoutFromPageType(si.pageType));
        slideHtml = applyVisualSlotHintsToSlideHtml(slideHtml, imageSlotsForSlide, slotHintsBySlotId);

        // Try to fix if validation fails
        if (!looksLikeSlideHtml(slideHtml)) {
          const fixed = tryFixSlideHtml(slideHtml, si);
          if (fixed) {
            slideHtml = ensureSectionAttr(fixed, "data-layout", layoutFromPageType(si.pageType));
            slideHtml = applyVisualSlotHintsToSlideHtml(slideHtml, imageSlotsForSlide, slotHintsBySlotId);
          } else {
            throw new Error("Invalid slideHtml returned by model");
          }
        }

        return { slideIntentId, slideHtml, source: "llm" };
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[design.batch] generateSingleSlide model call failed", { slideIntentId, attempt: attempt + 1, error: msg });
        if (attempt < 1) safeEmit(emit, "design.slide.retrying", "retrying", { slideIndex, attempt: attempt + 1 });
      }
    }

    const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr || "Unknown error");
    console.warn("[design.batch] generateSingleSlide falling back after retries", { slideIntentId, error: errMsg });
  }

  const slideHtml = buildSlideHtml(si, designSystem, contentPackage, {
    safeMode: true,
    slideNo,
    imageSlotsForSlide,
  });
  return { slideIntentId, slideHtml: applyVisualSlotHintsToSlideHtml(slideHtml, imageSlotsForSlide, slotHintsBySlotId), source: "fallback" };
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
  const modelRouter = options.modelRouter;
  const emit = typeof options.emit === "function" ? options.emit : null;
  const signal = options.signal;
  const imageSlots = Array.isArray(options.imageSlots) ? options.imageSlots : [];
  const dslRules = normalizeDslRules(options.dslRules);
  const selectedIdeas = Array.isArray(options.selectedIdeas) ? options.selectedIdeas : [];
  const selected = normalizeSelectedIdeas(selectedIdeas);
  const modelCaller = getDesignModelCaller({ modelRouter, aiApiService, signal }, { usage: "designer", timeoutMs: 30_000 });

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

        safeEmit(emit, "design.slide.progress", "progress", { slideIndex, step: "llm", msg: "Generating" });

        try {
          const res = await generateSingleSlide(slideIntent, designSystem, dslRules, {
            aiApiService,
            modelRouter,
            modelCaller,
            emit,
            contentPackage,
            signal,
            slideNo: slideIndex + 1,
            slideIndex,
            imageSlotsForSlide,
            selectedIdeas,
            slotHintsBySlotId: selected.bySlotId,
          });

          out[slideIndex] = res;
          const duration = nowMs() - t0;
          safeEmit(emit, "design.slide.completed", "completed", { slideIndex, html: res.slideHtml, duration, source: res.source });
          return;
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e || "Unknown error");
          safeEmit(emit, "design.slide.failed", "failed", { slideIndex, error: errMsg });
          safeEmit(emit, "design.slide.progress", "progress", { slideIndex, step: "fallback", msg: "Falling back to templates" });

          const res = await generateSingleSlide(slideIntent, designSystem, dslRules, {
            contentPackage,
            signal,
            slideNo: slideIndex + 1,
            imageSlotsForSlide,
            selectedIdeas,
            slotHintsBySlotId: selected.bySlotId,
          });
          out[slideIndex] = res;
          const duration = nowMs() - t0;
          safeEmit(emit, "design.slide.completed", "completed", { slideIndex, html: res.slideHtml, duration, source: res.source });
        }
      })
    );

    safeEmit(emit, "design.batch.completed", "completed", { batchIndex, slideIndexes, duration: nowMs() - tBatch });
  }

  return out;
}
