import { getDesignModelCaller, isNonRetryableError } from "../model.js";
import { robustParseJson } from "../../../shared/index.js";
import { extractJsonCandidate } from "../../../shared/index.js";
import { createLogger } from "../../../shared/index.js";
import { buildSlideHtml } from "../dsl/dsl-builder.js";
import { resolveLayoutType } from "./layout-protocol.js";
import { loadPrompt } from "../../../prompts/prompt-loader.js";
import { safeEmit } from "../shared/safe-emit.js";
import { ResourceGuard } from "../../../runtime/index.js";
import {
  nowMs,
  chunkIndexes,
  looksLikeSlideHtml,
  sanitizeSlideHtml,
  extractSectionBlock,
  ensureSectionAttr,
  normalizeDslRules,
  normalizeSlideIntentContentForPrompt,
  normalizeSelectedIdeas,
  applyVisualSlotHintsToSlideHtml,
  buildStyleDescription,
} from "./batch-generator-helpers.js";

import { toNonEmptyString } from "../../../shared/index.js";
const logger = createLogger("stages/design/generators/batch-generator");

/**
 * @typedef {(name: string, event: { actor: string, status: string, payload: any }) => void} EmitFn
 */

// === Prompt Centralization: External system prompt loading ===
let _cachedSystemPrompt = null;
let _systemPromptLoadPromise = null;

/**
 * Load external system prompt for batch generation.
 * Falls back to a minimal inline prompt if loading fails.
 */
async function getSystemPrompt() {
  if (_cachedSystemPrompt !== null) return _cachedSystemPrompt;
  if (_systemPromptLoadPromise) return _systemPromptLoadPromise;

  _systemPromptLoadPromise = loadPrompt("design/batch-generator-system")
    .then(content => {
      _cachedSystemPrompt = content;
      return content;
    })
    .catch(err => {
      logger.warn("[batch-generator] Failed to load external prompt, using fallback:", { error: err?.message });
      _cachedSystemPrompt = FALLBACK_SYSTEM_PROMPT;
      return _cachedSystemPrompt;
    });

  return _systemPromptLoadPromise;
}

const FALLBACK_SYSTEM_PROMPT = `You are a PPT slide generator. Output JSON: [{"slideIntentId":string,"slideHtml":string}]
Follow the DSL spec and examples in the prompt. Summarize content - never copy verbatim.`;

async function repairSlideHtmlWithModel(modelCaller, slideIntent, slideHtml, options = {}) {
  if (typeof modelCaller !== "function") return null;
  if (options.signal?.aborted) return null;

  const rules = normalizeDslRules(options.dslRules);
  const layout = toNonEmptyString(options.layout) || "";
  const slideIntentId = toNonEmptyString(slideIntent?.slideIntentId || slideIntent?.slideIntentID) || "";
  const title = toNonEmptyString(slideIntent?.title) || "Slide";

  const systemPrompt = [
    "[DSL Repair]",
    "You are a PPT HTML DSL repair assistant.",
    "Fix the provided broken slideHtml to conform to the DSL spec.",
    "Return ONLY a single <section ...>...</section> block (no markdown fences, no JSON).",
    "Requirements:",
    '- Must include <section data-type="freeform" ...>',
    "- Must include at least one element with a data-el attribute (e.g. data-el=\"text\").",
    "- Preserve existing IDs/data-slot-id attributes where possible.",
  ].join("\n");

  const userPrompt = [
    `slideIntentId: ${slideIntentId}`,
    `title: ${title}`,
    `pageType: ${String(slideIntent?.pageType || "")}`,
    layout ? `expected data-layout: ${layout}` : "",
    rules ? `DSL rules:\n${rules}` : "",
    "Broken slideHtml:",
    String(slideHtml || ""),
    "",
    "Return repaired HTML now.",
  ].filter(Boolean).join("\n");

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const resp = await modelCaller(messages, { temperature: 0, maxTokens: 2500, signal: options.signal, timeoutMs: 120_000 });
  const rawText = typeof resp?.content === "string" ? resp.content : typeof resp?.text === "string" ? resp.text : String(resp || "");
  const candidate = extractSectionBlock(rawText);
  if (!candidate) return null;
  return looksLikeSlideHtml(candidate) ? candidate.trim() : null;
}

// 使用统一布局协议
const layoutFromPageType = resolveLayoutType;

function makePrompt(batch, designSystem, contentPackage, imageSlotsForBatch = [], dslRules = "", selectedIdeas = [], dslExamples = []) {
  const slots = Array.isArray(imageSlotsForBatch) ? imageSlotsForBatch : [];
  const rulesText = normalizeDslRules(dslRules);
  const selected = normalizeSelectedIdeas(selectedIdeas);
  const styleDesc = buildStyleDescription(designSystem);
  const colors = designSystem?.designTokens?.colors || designSystem?.colors || {};
  const primaryColor = colors.primary || "#0ea5e9";
  const accentColor = colors.accent || "#22c55e";
  const bgColor = colors.bg || "#ffffff";
  const examples = Array.isArray(dslExamples) ? dslExamples.filter(e => e && typeof e.slideHtml === "string" && e.slideHtml.trim()) : [];

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

  // 3b. Style Lock: Inject DSL examples from first batch (few-shot learning)
  if (examples.length > 0) {
    promptParts.push(
      "=== STYLE REFERENCE (MUST FOLLOW) ===",
      "The following slides have been generated and approved. Your output MUST match their visual style, element positioning patterns, color usage, and typography exactly.",
      ""
    );
    for (let i = 0; i < Math.min(examples.length, 3); i++) {
      const ex = examples[i];
      promptParts.push(`--- Example ${i + 1} (${ex.slideIntentId || 'slide'}) ---`);
      promptParts.push(ex.slideHtml.trim());
      promptParts.push("");
    }
    promptParts.push(
      "Replicate the above styling patterns: same data-* attribute conventions, same layout proportions, same color applications, same SVG styling.",
      ""
    );
  }

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
 * @param {{aiApiService?:object,modelRouter?:object,modelCaller?:Function,emit?:EmitFn,signal?:AbortSignal,contentPackage?:object,slideNo?:number,slideIndex?:number,imageSlotsForSlide?:Array<object>,selectedIdeas?:Array<object>,slotHintsBySlotId?:Map<string, any>,dslExamples?:any[]}=} options
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
    // Support dslExamples for style lock
    const dslExamples = Array.isArray(options.dslExamples) ? options.dslExamples : [];
    const prompt = makePrompt([si], designSystem, contentPackage, imageSlotsForSlide, dslRules, selectedIdeas, dslExamples);

    // Load external system prompt (with style lock suffix if applicable)
    const baseSystemPrompt = await getSystemPrompt();
    const styleLockSuffix = dslExamples.length > 0
      ? '\n\nCRITICAL: Match the exact visual style of the provided example slides.'
      : '';
    const systemPrompt = baseSystemPrompt + styleLockSuffix;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];

    let repairAttempted = false;
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (options.signal?.aborted) throw new Error(typeof options.signal.reason === "string" ? options.signal.reason : "Run cancelled");
      try {
        const resp = await modelCaller(messages, { temperature: 0.2, maxTokens: 8000, signal: options.signal, timeoutMs: 180_000 });

        const jsonStr = extractJsonCandidate(resp?.content, { prefer: "array" });
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
        slideHtml = sanitizeSlideHtml(slideHtml);

        // If validation fails, use LLM repair (reflection) once, then fallback.
        if (!looksLikeSlideHtml(slideHtml)) {
          if (!repairAttempted) {
            repairAttempted = true;
            const repaired = await repairSlideHtmlWithModel(modelCaller, si, slideHtml, {
              signal: options.signal,
              dslRules,
              layout: layoutFromPageType(si.pageType),
            });
            if (repaired) {
              slideHtml = ensureSectionAttr(repaired, "data-layout", layoutFromPageType(si.pageType));
              slideHtml = applyVisualSlotHintsToSlideHtml(slideHtml, imageSlotsForSlide, slotHintsBySlotId);
              slideHtml = sanitizeSlideHtml(slideHtml);
            }
          }
        }

        if (!looksLikeSlideHtml(slideHtml)) {
          throw new Error("Invalid slideHtml returned by model");
        }

        return { slideIntentId, slideHtml, source: "llm" };
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn("[design.batch] generateSingleSlide model call failed", { slideIntentId, attempt: attempt + 1, error: msg });

        // Don't retry for config/auth errors - fail fast
        if (isNonRetryableError(e)) {
          logger.warn("[design.batch] Non-retryable error detected, skipping retry");
          break;
        }
        if (attempt < 1) safeEmit(emit, "design:slide.retrying", "retrying", { slideIndex, attempt: attempt + 1 });
      }
    }

    const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr || "Unknown error");
    const errStack = lastErr instanceof Error ? lastErr.stack : undefined;
    logger.warn("[design.batch] generateSingleSlide falling back after retries", { slideIntentId, error: errMsg });
    safeEmit(emit, "design:slide.failed", "failed", {
      slideIndex,
      error: { message: errMsg, stack: errStack }
    });
  }

  // Use buildSlideHtml for fallback to include image placeholders
  const fallbackHtml = buildSlideHtml(si, designSystem, contentPackage, { safeMode: true, slideNo, imageSlotsForSlide });

  return { slideIntentId, slideHtml: applyVisualSlotHintsToSlideHtml(fallbackHtml, imageSlotsForSlide, slotHintsBySlotId), source: "fallback" };
}

/**
 * Generate slides in batches (max 4 per batch).
 *
 * Supported call forms:
 * - generateBatch(slideIntents, contentPackage, designSystem, options)
 * - generateBatch(slideIntents, contentPackage, options) where options.designSystem is provided
 *
 * @param {Array<object>} slideIntents - Array of slide intent objects with slideIntentId, title, pageType, content, etc.
 * @param {object} contentPackage - Content package containing claims, dataTables, and other content sources
 * @param {object} [designSystemOrOptions={}] - Design system object or options object (if designSystem is in options)
 * @param {object} [maybeOptions={}] - Options object when designSystem is passed as 3rd argument
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

  // Pre-index image slots by slideIndex (hot path: avoid O(slides * slots) filtering).
  const slotsBySlide = new Map();
  for (const slot of imageSlots) {
    const idx = slot?.slideIndex;
    if (typeof idx !== "number" || !Number.isFinite(idx)) continue;
    const existing = slotsBySlide.get(idx);
    if (existing) existing.push(slot);
    else slotsBySlide.set(idx, [slot]);
  }

  // === STYLE LOCK MECHANISM ===
  // First batch runs synchronously to establish the visual style.
  // Subsequent batches receive first batch DSL as examples (few-shot learning).
  /** @type {Array<{slideIntentId:string,slideHtml:string,source:string}>} */
  let dslExamples = [];

  // Helper: process a single batch
  const processBatch = async (slideIndexes, batchIndex, currentExamples) => {
    if (signal?.aborted) throw new Error(typeof signal.reason === "string" ? signal.reason : "Run cancelled");

    safeEmit(emit, "design:batch.started", "started", { batchIndex, slideIndexes, styleLock: batchIndex > 0 });

    const tBatch = nowMs();
    await Promise.all(
      slideIndexes.map(async (slideIndex) => {
        const slideIntent = intents[slideIndex];
        const imageSlotsForSlide = slotsBySlide.get(slideIndex) || [];

        const t0 = nowMs();
        safeEmit(emit, "design:slide.started", "started", {
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

        safeEmit(emit, "design:slide.progress", "progress", { slideIndex, step: "llm", msg: "Generating" });

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
            dslExamples: currentExamples, // Style Lock: inject examples
          });

          out[slideIndex] = res;
          const duration = nowMs() - t0;
          safeEmit(emit, "design:slide.completed", "completed", { slideIndex, html: res.slideHtml, duration, source: res.source });
          return;
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e || "Unknown error");
          safeEmit(emit, "design:slide.failed", "failed", {
            slideIndex,
            error: { message: errMsg }
          });
          safeEmit(emit, "design:slide.progress", "progress", { slideIndex, step: "fallback", msg: "Falling back to templates" });

          const res = await generateSingleSlide(slideIntent, designSystem, dslRules, {
            contentPackage,
            signal,
            slideNo: slideIndex + 1,
            imageSlotsForSlide,
            selectedIdeas,
            slotHintsBySlotId: selected.bySlotId,
            dslExamples: currentExamples,
          });
          out[slideIndex] = res;
          const duration = nowMs() - t0;
          safeEmit(emit, "design:slide.completed", "completed", { slideIndex, html: res.slideHtml, duration, source: res.source });
        }
      })
    );

    safeEmit(emit, "design:batch.completed", "completed", { batchIndex, slideIndexes, duration: nowMs() - tBatch });
  };

  // Step 1: Process first batch synchronously to lock the style
  if (batchList.length > 0) {
    await processBatch(batchList[0], 0, []);

    // Collect successful LLM results as style examples (max 3)
    dslExamples = batchList[0]
      .map(idx => out[idx])
      .filter(r => r && r.source === "llm" && r.slideHtml && r.slideHtml.trim())
      .slice(0, 3);

    if (dslExamples.length > 0) {
      safeEmit(emit, "design:styleLock.established", "progress", {
        exampleCount: dslExamples.length,
        exampleIds: dslExamples.map(e => e.slideIntentId),
      });
    }
  }

  // Step 2: Process remaining batches with style lock (examples from first batch)
  if (batchList.length > 1) {
    const guard = new ResourceGuard({
      maxConcurrent: Math.max(1, Number(batchConcurrency) || 1),
      maxTasksPerSecond: Number.POSITIVE_INFINITY,
      maxMemoryMB: Number.POSITIVE_INFINITY,
    });

    await Promise.all(
      batchList.slice(1).map((slideIndexes, idx) =>
        guard.run(
          () => processBatch(slideIndexes, idx + 1, dslExamples),
          { timeoutMs: Number.POSITIVE_INFINITY }
        )
      )
    );
  }

  return out;
}
