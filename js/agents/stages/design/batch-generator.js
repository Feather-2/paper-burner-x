import { getDesignModelCaller, isNonRetryableError } from "./model.js";
import { robustParseJson } from "../../shared/robust-json.js";
import { VisualDataStatus } from "./constants.js";

/**
 * Simple concurrency limiter (pLimit-style).
 * @param {number} concurrency Max concurrent tasks
 * @returns {<T>(fn: () => Promise<T>) => Promise<T>}
 */
function createLimiter(concurrency) {
  const queue = [];
  let running = 0;

  const run = async () => {
    if (running >= concurrency || queue.length === 0) return;
    running++;
    const { fn, resolve, reject } = queue.shift();
    try {
      resolve(await fn());
    } catch (e) {
      reject(e);
    } finally {
      running--;
      run();
    }
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    run();
  });
}

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
  let markdown = "";

  if (typeof content === "string") {
    markdown = content.trim();
  } else if (content && typeof content === "object") {
    markdown = typeof content?.markdown === "string" ? content.markdown.trim() : "";
  }

  // Limit content length to prevent text overflow in slides
  // Keep first 800 chars max - LLM should summarize, not copy verbatim
  if (markdown.length > 800) {
    markdown = markdown.slice(0, 800) + "\n...(content truncated, summarize key points only)";
  }

  return { content: content || null, contentMarkdown: markdown };
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
        "data-status": VisualDataStatus.PENDING,
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

function buildStyleDescription(designSystem) {
  const styleRef = designSystem?.styleReference?.extracted;
  const colors = designSystem?.designTokens?.colors || designSystem?.colors || {};
  const userNotes = designSystem?.styleReference?.userNotes || "";

  const parts = [];

  // Color palette
  const palette = styleRef?.palette || [];
  const primaryColors = [colors.primary, colors.accent, colors.bg, colors.text].filter(Boolean);
  const allColors = [...new Set([...palette, ...primaryColors])].slice(0, 6);
  if (allColors.length) {
    parts.push(`Color palette: ${allColors.join(", ")}`);
  }

  // Style attributes from reference images
  if (styleRef?.colorTone) parts.push(`Color tone: ${styleRef.colorTone}`);
  if (styleRef?.mood) parts.push(`Mood: ${styleRef.mood}`);
  if (styleRef?.layoutStyle) parts.push(`Layout: ${styleRef.layoutStyle}`);
  if (styleRef?.typography) parts.push(`Typography: ${styleRef.typography}`);
  if (styleRef?.effects) parts.push(`Effects: ${styleRef.effects}`);
  if (userNotes) parts.push(`User notes: ${userNotes}`);

  // Fallback if no style info
  if (!parts.length) {
    const bg = colors.bg || "#ffffff";
    const isDark = bg.toLowerCase().startsWith("#0") || bg.toLowerCase().startsWith("#1");
    parts.push(`Theme: ${isDark ? "dark" : "light"}, modern business style`);
    parts.push(`Primary: ${colors.primary || "#0ea5e9"}, Accent: ${colors.accent || "#22c55e"}`);
  }

  return parts.join("\n");
}

function buildPlaceholderUrl(width, height, bgColor, textColor, text) {
  const w = Math.round(width) || 800;
  const h = Math.round(height) || 600;
  const bg = (bgColor || "#1a1a2e").replace("#", "");
  const fg = (textColor || "#666666").replace("#", "");
  const label = encodeURIComponent(String(text || "Image").slice(0, 30));
  return `https://placehold.co/${w}x${h}/${bg}/${fg}?text=${label}`;
}

function makePrompt(batch, designSystem, contentPackage, imageSlotsForBatch = [], dslRules = "", selectedIdeas = []) {
  const slots = Array.isArray(imageSlotsForBatch) ? imageSlotsForBatch : [];
  const rulesText = normalizeDslRules(dslRules);
  const selected = normalizeSelectedIdeas(selectedIdeas);
  const styleDesc = buildStyleDescription(designSystem);
  const colors = designSystem?.designTokens?.colors || designSystem?.colors || {};
  const primaryColor = colors.primary || "#0ea5e9";
  const accentColor = colors.accent || "#22c55e";
  const bgColor = colors.bg || "#ffffff";

  const promptParts = [];

  // 1. DSL specification (full reference from md file)
  if (rulesText) {
    promptParts.push(rulesText, "");
  }

  // 2. Design style with actual colors
  promptParts.push(
    "=== DESIGN STYLE ===",
    styleDesc,
    `Colors: primary=${primaryColor}, accent=${accentColor}, bg=${bgColor}`,
    "",
  );

  // 3. Output format requirements
  promptParts.push(
    "=== OUTPUT FORMAT ===",
    "Return JSON array: [{\"slideIntentId\":string, \"slideHtml\":string}, ...]",
    "",
    "CONTENT RULES:",
    "- Summarize, don't copy verbatim. Title ≤30 chars, bullets ≤60 chars each",
    "- Use 3-5 bullet points max per slide",
    "- Generate inline SVG for decorative visuals (icons, diagrams, abstract shapes)",
    ""
  );

  // 4. Image placeholder guide (for photos to be replaced later)
  const placeholderBg = bgColor.replace("#", "");
  const placeholderFg = (colors.muted || "#666666").replace("#", "");
  promptParts.push(
    "=== IMAGE PLACEHOLDERS ===",
    "For photos/complex images (to be replaced later), use placeholder:",
    `<div data-el="image" data-x="60%" data-y="20%" data-w="35%" data-h="50%"`,
    `     data-slot-id="img_s{slideIndex}_{purpose}" data-purpose="{description}" data-placeholder="true"`,
    `     data-src="https://placehold.co/800x600/${placeholderBg}/${placeholderFg}?text={Label}">`,
    `</div>`,
    "",
    "Use image placeholders for: photos, realistic images, product shots, people",
    "Use inline SVG for: icons, diagrams, charts, abstract decorations, geometric patterns",
    ""
  );

  // 5. Image slots if any (brief)
  if (slots.length) {
    const slotInfo = slots.map((s) => ({
      id: s.slotId,
      slide: s.slideIntentId,
      purpose: s.purpose,
      pos: selected.bySlotId.get(String(s.slotId || ""))?.position,
    }));
    promptParts.push(
      "Requested image slots (use as placeholders):",
      JSON.stringify(slotInfo),
      ""
    );
  }

  // 6. Content to generate (minimal, focused)
  promptParts.push(
    "=== SLIDES TO GENERATE ===",
    JSON.stringify(
      batch.map((s, idx) => {
        const normalized = normalizeSlideIntentContentForPrompt(s);
        const brainstormData = selected.bySlideIntentId.get(s.slideIntentId);
        const result = {
          slideIntentId: s.slideIntentId,
          slideIndex: idx,
          pageType: s.pageType,
          title: s.title,
          keyPoints: (s.keyPoints || []).slice(0, 5),
          objective: s.objective ? String(s.objective).slice(0, 100) : undefined,
          content: normalized.content,
          contentMarkdown: normalized.contentMarkdown || "",
        };
        // Include brainstorm data if available (from selectedIdeas)
        if (brainstormData) {
          result.brainstorm = {
            atmosphere: brainstormData.atmosphere,
            elementsMarkdown: brainstormData.elementsMarkdown,
            visualSlots: brainstormData.visualSlots,
          };
        }
        return result;
      }),
      null,
      0
    ),
    "",
    "Generate visually rich slides with inline SVG decorations where appropriate.",
    "Generate now."
  );

  return promptParts.join("\n");
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
    const systemPrompt = `You are a PPT slide generator. Output JSON: [{"slideIntentId":string,"slideHtml":string}]
Follow the DSL spec and examples in the prompt. Summarize content - never copy verbatim.`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];

    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (options.signal?.aborted) throw new Error(typeof options.signal.reason === "string" ? options.signal.reason : "Run cancelled");
      try {
	        const resp = await modelCaller(messages, { temperature: 0.2, maxTokens: 8000, signal: options.signal, timeoutMs: 180_000 });

	        const jsonStr = extractJsonCandidate(resp?.content);
	        const parsed = robustParseJson(jsonStr);
	        if (parsed === null) throw new Error("Failed to parse slide DSL JSON");
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

        // Don't retry for config/auth errors - fail fast
        if (isNonRetryableError(e)) {
          console.warn("[design.batch] Non-retryable error detected, skipping retry");
          break;
        }
        if (attempt < 1) safeEmit(emit, "design.slide.retrying", "retrying", { slideIndex, attempt: attempt + 1 });
      }
    }

    const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr || "Unknown error");
    const errStack = lastErr instanceof Error ? lastErr.stack : undefined;
    console.warn("[design.batch] generateSingleSlide falling back after retries", { slideIntentId, error: errMsg });
    safeEmit(emit, "design.slide.failed", "failed", {
      slideIndex,
      error: { message: errMsg, stack: errStack }
    });
  }

  // Minimal fallback - just title and key points, no complex template
  const title = String(si.title || "Slide").slice(0, 40);
  const keyPoints = Array.isArray(si.keyPoints) ? si.keyPoints.slice(0, 4) : [];
  const colors = designSystem?.designTokens?.colors || designSystem?.colors || {};
  const bg = colors.bg || "#ffffff";
  const textColor = colors.text || "#0f172a";
  const mutedColor = colors.muted || "#64748b";

  const escTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const bodyHtml = keyPoints.length
    ? keyPoints.map(p => `• ${String(p || "").slice(0, 60).replace(/</g, "&lt;")}`).join("<br>")
    : "(内容生成失败，请重试)";

  const fallbackHtml = `<section data-type="freeform" data-layout="content" data-bg="${bg}" data-title="${escTitle}">
  <div data-el="text" data-x="8%" data-y="10%" data-w="84%" data-h="auto" data-font="36" data-color="${textColor}" data-bold="true">${escTitle}</div>
  <div data-el="text" data-x="8%" data-y="24%" data-w="84%" data-h="auto" data-font="16" data-color="${mutedColor}" data-line-height="1.8">${bodyHtml}</div>
</section>`;

  return { slideIntentId, slideHtml: applyVisualSlotHintsToSlideHtml(fallbackHtml, imageSlotsForSlide, slotHintsBySlotId), source: "fallback" };
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

  const batchSize = Math.max(1, Number(options.batchSize) || 4);
  const batchConcurrency = Math.max(1, Number(options.batchConcurrency) || 2);
  const aiApiService = options.aiApiService;
  const modelRouter = options.modelRouter;
  const emit = typeof options.emit === "function" ? options.emit : null;
  const signal = options.signal;
  const imageSlots = Array.isArray(options.imageSlots) ? options.imageSlots : [];
  const dslRules = normalizeDslRules(options.dslRules);
  const selectedIdeas = Array.isArray(options.selectedIdeas) ? options.selectedIdeas : [];
  const selected = normalizeSelectedIdeas(selectedIdeas);
  const modelCaller = typeof options.modelCaller === "function"
    ? options.modelCaller
    : getDesignModelCaller({ modelRouter, aiApiService, signal }, { usage: "designer", timeoutMs: 30_000 });

  /** @type {Array<{slideIntentId:string,slideHtml:string,source:"llm"|"fallback"}>} */
  const out = new Array(intents.length);
  const batchList = chunkIndexes(intents.length, batchSize);

  // Process batches with concurrency limit
  const limiter = createLimiter(batchConcurrency);
  await Promise.all(batchList.map((slideIndexes, batchIndex) => limiter(async () => {
    if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");

    safeEmit(emit, "design.batch.started", "started", { batchIndex, slideIndexes });

    const tBatch = nowMs();
    await Promise.all(
      slideIndexes.map(async (slideIndex) => {
        const slideIntent = intents[slideIndex];
        const imageSlotsForSlide = imageSlots.filter((s) => s.slideIndex === slideIndex);

        const t0 = nowMs();
        safeEmit(emit, "design.slide.started", "started", {
          slideIndex,
          slideIntent: {
            id: slideIntent?.slideIntentId || slideIntent?.slideIntentID,
            title: slideIntent?.title,
            pageType: slideIntent?.pageType,
            objective: slideIntent?.objective,
            keyPoints: slideIntent?.keyPoints,
            claimIds: slideIntent?.claimIds,
            dataTableIds: slideIntent?.dataTableIds,
          }
        });

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
          const errStack = e instanceof Error ? e.stack : undefined;
          safeEmit(emit, "design.slide.failed", "failed", {
            slideIndex,
            error: { message: errMsg, stack: errStack }
          });
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
  })));

  return out;
}
