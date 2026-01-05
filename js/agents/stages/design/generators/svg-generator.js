import { getDesignModelCaller } from "../model.js";
import { robustParseJson } from "../../../shared/utils/robust-json.js";
import { createLogger } from "../../../shared/utils/logger.js";
import { loadPrompt } from "../../../prompts/prompt-loader.js";
import { VisualDataStatus } from "../constants.js";
import { ResourceGuard } from "../../../runtime/core/resource-guard.js";

// Optional circuit breaker - may not be available
let getCircuitBreaker = null;
try {
  const mod = await import("../../core/error-handler.js");
  getCircuitBreaker = mod.getCircuitBreaker;
} catch { }

import { toNonEmptyString, escapeHtml as escapeAttr } from "../shared/design-utils.js";
import { parseTagAttributes } from "../shared/html-parser.js";
import { classifyDesignError } from "../../../shared/utils/error-classifier.js";
import { safeEmit } from "../shared/safe-emit.js";

const logger = createLogger("stages/design/generators/svg-generator");

function safeNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Classify error for appropriate handling strategy.
 * @param {Error|string} err
 * @returns {{ level: string, code: string, canRetry: boolean }}
 */
function classifySvgError(err) {
  const classified = classifyDesignError(err);

  // Keep legacy codes for compatibility with downstream reports/tests.
  if (classified.kind === "auth" || classified.kind === "config") {
    return { level: "fatal", code: "CONFIG_OR_AUTH", canRetry: false };
  }
  if (classified.canRetry) {
    return { level: "retryable", code: "NETWORK", canRetry: true };
  }
  return { level: "degradable", code: "GENERATION_FAILED", canRetry: false };
}

// SVG generator circuit breaker registry
const svgBreakerRegistry = new Map();

/**
 * Get or create circuit breaker for SVG generation.
 * @param {string} name - Breaker name (default: "svg-generator")
 * @returns {object} Circuit breaker instance or fallback
 */
function getSvgCircuitBreaker(name = "svg-generator") {
  if (svgBreakerRegistry.has(name)) {
    return svgBreakerRegistry.get(name);
  }

  // Try to use project's CircuitBreaker if available
  if (typeof getCircuitBreaker === "function") {
    try {
      const coreBreaker = getCircuitBreaker(name, {
        threshold: 3, // 连续 3 次失败后熔断
        resetTimeMs: 60000, // 60s 后尝试恢复
        halfOpenRequests: 1,
      });

      // Adapter to a minimal interface used by this module.
      const breaker = {
        name,
        canExecute: () => (typeof coreBreaker?.canExecute === "function" ? coreBreaker.canExecute() : true),
        recordSuccess: () => {
          if (typeof coreBreaker?._onSuccess === "function") coreBreaker._onSuccess();
          else if (typeof coreBreaker?.reset === "function") coreBreaker.reset();
        },
        recordFailure: () => {
          if (typeof coreBreaker?._onFailure === "function") coreBreaker._onFailure();
        },
        getState: () => (typeof coreBreaker?.getState === "function" ? coreBreaker.getState() : undefined),
      };

      svgBreakerRegistry.set(name, breaker);
      return breaker;
    } catch (e) {
      logger.warn("[svg-generator] Failed to create circuit breaker:", { error: e?.message || String(e) });
    }
  }

  // Fallback: simple in-memory breaker
  const fallbackBreaker = {
    failures: 0,
    openUntil: 0,
    threshold: 3,
    resetTimeMs: 60000,
    canExecute() {
      if (Date.now() < this.openUntil) return false;
      return true;
    },
    recordSuccess() {
      this.failures = 0;
      this.openUntil = 0;
    },
    recordFailure() {
      this.failures++;
      if (this.failures >= this.threshold) {
        this.openUntil = Date.now() + this.resetTimeMs;
        logger.warn("[svg-generator] Circuit breaker opened, will reset in 60s");
      }
    },
  };
  svgBreakerRegistry.set(name, fallbackBreaker);
  return fallbackBreaker;
}

// escapeAttr is now imported from design-utils as escapeAttr

function normalizeRenderType(v) {
  const t = String(v || "").trim().toLowerCase();
  if (t === "svg") return "svg";
  if (t === "ai-image" || t === "ai_image" || t === "image") return "ai-image";
  if (t === "asset") return "asset";
  return "";
}

function parsePercent(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d+(\.\d+)?)%$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function sizeFromPosition(position) {
  const wPct = parsePercent(position?.w);
  const hPct = parsePercent(position?.h);
  if (wPct === null || hPct === null || hPct === 0) return null;
  const ratio = wPct / hPct;
  const height = 360;
  const width = Math.max(100, Math.round(height * ratio));
  return { width, height };
}

function pickColors(designSystem) {
  const tokens = designSystem?.designTokens || designSystem || {};
  const colors = tokens?.colors || {};
  const primary = toNonEmptyString(colors.primary) || "#0ea5e9";
  const secondary = toNonEmptyString(colors.secondary) || "#8b5cf6";
  const accent = toNonEmptyString(colors.accent) || "#22c55e";
  const text = toNonEmptyString(colors.text) || "#0f172a";
  const muted = toNonEmptyString(colors.textMuted) || toNonEmptyString(colors.muted) || "#64748b";
  const bg = toNonEmptyString(colors.surface) || toNonEmptyString(colors.background) || toNonEmptyString(colors.bg) || "#ffffff";
  return { primary, secondary, accent, text, muted, bg };
}

function buildStyleDescription(designSystem) {
  const styleRef = designSystem?.styleReference?.extracted;
  const colors = designSystem?.designTokens?.colors || designSystem?.colors || {};
  const userNotes = designSystem?.styleReference?.userNotes || "";

  const parts = [];
  const palette = styleRef?.palette || [];
  const primaryColors = [colors.primary, colors.accent, colors.secondary].filter(Boolean);
  const allColors = [...new Set([...palette, ...primaryColors])].slice(0, 6);
  if (allColors.length) parts.push(`Palette: ${allColors.join(", ")}`);
  if (styleRef?.colorTone) parts.push(`Tone: ${styleRef.colorTone}`);
  if (styleRef?.mood) parts.push(`Mood: ${styleRef.mood}`);
  if (styleRef?.layoutStyle) parts.push(`Layout: ${styleRef.layoutStyle}`);
  if (userNotes) parts.push(`Notes: ${userNotes}`);

  if (!parts.length) {
    const bg = colors.bg || "#ffffff";
    const isDark = bg.toLowerCase().startsWith("#0") || bg.toLowerCase().startsWith("#1");
    parts.push(`Theme: ${isDark ? "dark" : "light"}, modern business style`);
  }
  return parts.join("; ");
}

// 缓存的 SVG system prompt
let _svgSystemPrompt = null;

// Fallback prompt (minimal version)
const FALLBACK_SVG_PROMPT = `You are an SVG artist for presentation slides.
Output JSON array: [{"slotId": "...", "svg": "<svg>...</svg>"}]
Use provided colors, keep designs modern and clean.`;

/**
 * 异步获取 SVG system prompt
 */
async function getSvgSystemPrompt() {
  if (_svgSystemPrompt) return _svgSystemPrompt;
  try {
    _svgSystemPrompt = await loadPrompt("design/svg-generator");
    return _svgSystemPrompt;
  } catch (e) {
    logger.warn("[svg-generator] Failed to load svg-generator.md:", { error: e?.message });
    return FALLBACK_SVG_PROMPT;
  }
}

function buildBatchPrompt(batchSlots, designSystem, slideHtmlMap) {
  const colors = pickColors(designSystem);
  const styleDesc = buildStyleDescription(designSystem);

  const slotsInfo = batchSlots.map((slot) => {
    const slotId = toNonEmptyString(slot?.slotId);
    const size = sizeFromPosition(slot?.position) || { width: 600, height: 400 };
    const description = toNonEmptyString(slot?.svgSpec?.description) || toNonEmptyString(slot?.description) || "abstract visual";
    const type = toNonEmptyString(slot?.svgSpec?.type) || "illustration";
    const slideHtml = slideHtmlMap?.get(slotId) || "";
    const contextSnippet = slideHtml ? slideHtml.slice(0, 300) : "";

    return {
      slotId,
      width: safeNumber(slot?.width, size.width),
      height: safeNumber(slot?.height, size.height),
      description,
      type,
      context: contextSnippet || undefined,
    };
  });

  return `Generate ${slotsInfo.length} SVG graphics with consistent style.

STYLE: ${styleDesc}
COLORS: primary=${colors.primary}, secondary=${colors.secondary}, accent=${colors.accent}, text=${colors.text}, bg=${colors.bg}

SLOTS TO GENERATE:
${JSON.stringify(slotsInfo, null, 2)}

Be creative! Use gradients, shadows, geometric shapes, and visual effects. Return JSON array with slotId and svg for each.`;
}

function extractJsonFromResponse(text) {
  const s = String(text || "").trim();
  if (!s) return null;

  // Remove markdown code blocks
  let cleaned = s.replace(/^```(?:json)?[\s\n]*/i, "").replace(/[\s\n]*```$/i, "").trim();

  // Find JSON array
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    cleaned = cleaned.slice(firstBracket, lastBracket + 1);
  }

  return robustParseJson(cleaned);
}

function extractSvgFromText(text) {
  const s = String(text || "").trim();
  const svgMatch = s.match(/<svg[\s\S]*?<\/svg>/i);
  return svgMatch ? svgMatch[0] : null;
}

// Fallback: semi-transparent rounded gray + small label text
function makeFallbackSvg({ width, height, colors, label }) {
  const w = safeNumber(width, 400);
  const h = safeNumber(height, 300);
  const inner = [
    `<rect x="0" y="0" width="${w}" height="${h}" rx="12" fill="${escapeAttr(colors.muted)}" opacity="0.15"/>`,
    `<text x="${Math.round(w / 2)}" y="${Math.round(h / 2 + 5)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="13" fill="${escapeAttr(colors.muted)}" opacity="0.6">${escapeAttr(label)}</text>`,
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeAttr(label)}">${inner}</svg>`;
}

/**
 * Create a fallback result object for a slot.
 */
function makeFallbackResult(slot, colors, error = null) {
  const slotId = toNonEmptyString(slot?.slotId);
  const size = sizeFromPosition(slot?.position) || { width: 600, height: 400 };
  const label = toNonEmptyString(slot?.svgSpec?.description) || slotId || "Visual";
  return {
    slotId,
    svgContent: makeFallbackSvg({ width: size.width, height: size.height, colors, label }),
    width: size.width,
    height: size.height,
    source: "fallback",
    ...(error ? { error } : {}),
  };
}

async function generateBatchWithLLM(batchSlots, designSystem, slideHtmlMap, options = {}) {
  const { modelRouter, aiApiService, signal, emit } = options;
  const colors = pickColors(designSystem);
  const slotIds = batchSlots.map((s) => s?.slotId).filter(Boolean);
  const breaker = getSvgCircuitBreaker("svg-generator");

  const makeStructuredError = (err, extra = {}) => {
    const base = classifySvgError(err);
    const message = err instanceof Error ? err.message : String(err);
    return { ...base, message, ...extra };
  };

  const modelCaller = getDesignModelCaller({ modelRouter, aiApiService, signal }, { usage: "designer", timeoutMs: 60_000 });

  if (typeof modelCaller !== "function") {
    const error = makeStructuredError("No available model for SVG generation");
    safeEmit(emit, "design.svg.batch.failed", "failed", { slotIds, error });
    return { results: batchSlots.map((slot) => makeFallbackResult(slot, colors, error)), hasError: true };
  }

  if (!breaker.canExecute()) {
    const error = makeStructuredError("Circuit breaker is OPEN", { code: "CIRCUIT_OPEN", canRetry: true });
    safeEmit(emit, "design.svg.batch.failed", "failed", { slotIds, error, circuit: { name: "svg-generator" } });
    return { results: batchSlots.map((slot) => makeFallbackResult(slot, colors, error)), hasError: true };
  }

  const prompt = buildBatchPrompt(batchSlots, designSystem, slideHtmlMap);
  const svgSystemPrompt = await getSvgSystemPrompt();
  const messages = [
    { role: "system", content: svgSystemPrompt },
    { role: "user", content: prompt },
  ];

  console.log("[svg-generator] generateBatchWithLLM started", { slotIds, promptLength: prompt.length });

  // Retry up to 2 times based on classification
  let lastErr = null;
  let lastStructuredError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) break;

    try {
      console.log("[svg-generator] LLM call attempt", { attempt: attempt + 1, slotIds });
      const resp = await modelCaller(messages, { temperature: 0.5, maxTokens: 6000, signal, timeoutMs: 90_000 });
      const rawContent = resp?.content || "";
      console.log("[svg-generator] LLM response received", { contentLength: rawContent.length, preview: rawContent.slice(0, 500) });

      const parsed = extractJsonFromResponse(rawContent);
      console.log("[svg-generator] JSON parse result", {
        isArray: Array.isArray(parsed),
        itemCount: Array.isArray(parsed) ? parsed.length : 0,
        parseResult: parsed === null ? "null" : typeof parsed,
      });

      if (!Array.isArray(parsed)) {
        throw new Error("Invalid SVG batch response: expected a JSON array");
      }

      const resultById = new Map();
      for (const item of parsed) {
        const slotId = toNonEmptyString(item?.slotId);
        const svgContent = toNonEmptyString(item?.svg) || extractSvgFromText(item?.svg);
        if (slotId && svgContent) {
          resultById.set(slotId, svgContent);
          console.log("[svg-generator] SVG extracted", { slotId, svgLength: svgContent.length });
        } else {
          logger.warn("[svg-generator] Failed to extract SVG", {
            slotId,
            hasSvg: !!item?.svg,
            svgPreview: String(item?.svg || "").slice(0, 200),
          });
        }
      }

      console.log("[svg-generator] Batch complete", { requested: slotIds, extracted: [...resultById.keys()] });

      const results = batchSlots.map((slot) => {
        const slotId = toNonEmptyString(slot?.slotId);
        const size = sizeFromPosition(slot?.position) || { width: 600, height: 400 };
        const svgContent = resultById.get(slotId);
        if (svgContent) return { slotId, svgContent, width: size.width, height: size.height, source: "llm" };
        const err = makeStructuredError("Missing SVG for slot", { code: "MISSING_SVG", canRetry: false, slotId });
        return makeFallbackResult(slot, colors, err);
      });

      breaker.recordSuccess();
      return { results, hasError: results.some((r) => r?.error) };
    } catch (e) {
      lastErr = e;
      lastStructuredError = makeStructuredError(e);
      breaker.recordFailure();

      logger.warn("[svg-generator] Batch LLM attempt failed:", {
        attempt: attempt + 1,
        error: lastStructuredError.message,
        code: lastStructuredError.code,
        level: lastStructuredError.level,
      });

      safeEmit(emit, "design.svg.batch.failed", "failed", {
        slotIds,
        attempt: attempt + 1,
        error: lastStructuredError,
      });

      if (!lastStructuredError.canRetry) break;
      if (attempt < 1) continue;
    }
  }

  const error = lastStructuredError || (lastErr ? makeStructuredError(lastErr) : makeStructuredError("SVG batch generation failed"));
  logger.warn("[svg-generator] Batch LLM generation failed after retries:", { error: error?.message });

  return { results: batchSlots.map((slot) => makeFallbackResult(slot, colors, error)), hasError: true };
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

export class SVGGenerator {
  constructor({ batchSize = 1, concurrency } = {}) {
    this.batchSize = Math.max(1, Math.min(4, batchSize));
    this.concurrency = concurrency; // undefined = use default at generate time
  }

  async generate(svgSlots, designSystem, { emit, aiApiService, modelRouter, signal, slideHtmlBySlotId, concurrency } = {}) {
    const slots = Array.isArray(svgSlots) ? svgSlots : [];
    const htmlMap = slideHtmlBySlotId instanceof Map ? slideHtmlBySlotId : new Map();
    const effectiveConcurrency = Math.max(1, Math.min(6, concurrency || this.concurrency || 3));

    if (slots.length === 0) {
      const report = {
        schemaVersion: "0.1",
        planned: 0,
        completed: 0,
        llmGenerated: 0,
        fallback: 0,
        skipped: 0,
        concurrency: effectiveConcurrency,
        errors: [],
      };
      return { results: [], report };
    }

    const totalErrors = [];

    safeEmit(emit, "design.svg.generate.started", "started", { slots: slots.length, concurrency: effectiveConcurrency });

    const batches = chunkArray(slots, this.batchSize);
    const allResults = new Array(batches.length);

    // Process batches in parallel with concurrency limit
    const guard = new ResourceGuard({
      maxConcurrent: Math.max(1, safeNumber(effectiveConcurrency, 1)),
      maxTasksPerSecond: Number.POSITIVE_INFINITY,
      maxMemoryMB: Number.POSITIVE_INFINITY,
    });
    await Promise.all(
      batches.map((batch, batchIndex) =>
        guard.run(
          async () => {
            if (signal?.aborted) {
              const abortError = { level: "degradable", code: "ABORTED", canRetry: false, message: String(signal?.reason || "aborted") };
              const skipped = batch.map((slot) => {
                const slotId = toNonEmptyString(slot?.slotId);
                return { slotId, svgContent: "", width: 0, height: 0, source: "skipped", error: abortError };
              });
              allResults[batchIndex] = skipped;
              totalErrors.push(abortError);
              return;
            }

            const batchRes = await generateBatchWithLLM(batch, designSystem, htmlMap, { modelRouter, aiApiService, signal, emit });
            const results = Array.isArray(batchRes?.results) ? batchRes.results : [];
            allResults[batchIndex] = results;

            for (const r of results) {
              if (r?.error) totalErrors.push(r.error);
            }

            safeEmit(emit, "design.svg.batch.completed", "completed", {
              batchIndex,
              batchCount: batches.length,
              hasError: !!batchRes?.hasError,
              generated: results.filter((s) => s.source === "llm").length,
              fallback: results.filter((s) => s.source === "fallback").length,
              skipped: results.filter((s) => s.source === "skipped").length,
            });
          },
          { timeoutMs: Number.POSITIVE_INFINITY }
        )
      )
    );

    const flatResults = allResults.flat();
    const llmGenerated = flatResults.filter((s) => s.source === "llm").length;
    const fallback = flatResults.filter((s) => s.source === "fallback").length;
    const skipped = flatResults.filter((s) => s.source === "skipped").length;
    const fatalErrors = totalErrors.filter((e) => e && typeof e === "object" && e.level === "fatal");

    const report = {
      schemaVersion: "0.1",
      planned: slots.length,
      completed: flatResults.length,
      batches: batches.length,
      batchSize: this.batchSize,
      concurrency: effectiveConcurrency,
      llmGenerated,
      fallback,
      skipped,
      errors: totalErrors,
    };

    if (fatalErrors.length && llmGenerated === 0) {
      safeEmit(emit, "design.svg.generate.failed", "failed", {
        slots: flatResults.length,
        llmGenerated,
        fallback,
        skipped,
        errors: totalErrors,
        report,
      });
    } else {
      safeEmit(emit, "design.svg.generate.completed", "completed", {
        slots: flatResults.length,
        llmGenerated,
        fallback,
        skipped,
        errors: totalErrors,
        report,
      });
    }

    return { results: flatResults, report };
  }
}

/**
 * Replace `<div data-el="image-placeholder" ... data-render-type="svg">` with `<div data-el="svg">...</div>`.
 */
export function fillSvgPlaceholders(html, filledSlots) {
  const input = typeof html === "string" ? html : "";
  const slots = Array.isArray(filledSlots) ? filledSlots : [];
  if (!input || slots.length === 0) return { html: input, filledSlotIds: [], skippedSlotIds: [] };

  const isWs = (c) => c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f";
  const findTagEnd = (s, start) => {
    let quote = null;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === ">") return i;
    }
    return -1;
  };
  const findMatchingDivClose = (s, start) => {
    let depth = 1;
    let pos = start;
    while (pos < s.length) {
      const lt = s.indexOf("<", pos);
      if (lt === -1) return null;
      if (s.startsWith("<!--", lt)) {
        const end = s.indexOf("-->", lt + 4);
        pos = end === -1 ? s.length : end + 3;
        continue;
      }
      const next = s[lt + 1];
      if (next === "/" && s.slice(lt + 2, lt + 5).toLowerCase() === "div") {
        const tagEnd = findTagEnd(s, lt + 2);
        if (tagEnd === -1) return null;
        depth--;
        const closeStart = lt;
        const closeEnd = tagEnd + 1;
        pos = closeEnd;
        if (depth === 0) return { closeStart, closeEnd };
        continue;
      }
      if (s.slice(lt + 1, lt + 4).toLowerCase() === "div") {
        const tagEnd = findTagEnd(s, lt + 4);
        if (tagEnd === -1) return null;
        let k = tagEnd - 1;
        while (k > lt && isWs(s[k])) k--;
        const isSelfClosing = s[k] === "/";
        if (!isSelfClosing) depth++;
        pos = tagEnd + 1;
        continue;
      }
      pos = lt + 1;
    }
    return null;
  };
  const findImagePlaceholders = (s) => {
    const results = [];
    let pos = 0;
    while (pos < s.length) {
      const divStart = s.indexOf("<div", pos);
      if (divStart === -1) break;
      const tagEnd = findTagEnd(s, divStart + 4);
      if (tagEnd === -1) break;
      const openTag = s.slice(divStart, tagEnd + 1);
      const attrs = parseTagAttributes(openTag);
      if (String(attrs["data-el"] || "").toLowerCase() !== "image-placeholder") {
        pos = tagEnd + 1;
        continue;
      }

      let k = tagEnd - 1;
      while (k > divStart && isWs(s[k])) k--;
      const isSelfClosing = s[k] === "/";
      if (isSelfClosing) {
        const end = tagEnd + 1;
        results.push({ start: divStart, end, openTag, inner: "", isSelfClosing: true });
        pos = end;
        continue;
      }

      const close = findMatchingDivClose(s, tagEnd + 1);
      if (!close) {
        pos = tagEnd + 1;
        continue;
      }
      results.push({ start: divStart, end: close.closeEnd, openTag, inner: s.slice(tagEnd + 1, close.closeStart), isSelfClosing: false });
      pos = close.closeEnd;
    }
    return results;
  };

  const bySlotId = new Map();
  const skippedSlotIds = [];
  for (const s of slots) {
    const slotId = toNonEmptyString(s?.slotId);
    const svgContent = toNonEmptyString(s?.svgContent);
    if (!slotId) continue;
    if (!svgContent) {
      skippedSlotIds.push(slotId);
      continue;
    }
    bySlotId.set(slotId, { svgContent, width: s?.width, height: s?.height });
  }
  if (bySlotId.size === 0) return { html: input, filledSlotIds: [], skippedSlotIds: [...new Set(skippedSlotIds)] };

  const filledSlotIds = [];

  const buildReplacement = (tag, innerHtml, selfClosing) => {
    const attrs = parseTagAttributes(tag);
    const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
    if (!slotId || !bySlotId.has(slotId)) return null;

    const rt = normalizeRenderType(attrs["data-render-type"]);
    if (rt && rt !== "svg") return null;

    const { svgContent, width, height } = bySlotId.get(slotId);
    filledSlotIds.push(slotId);

    const next = { ...attrs };
    next["data-el"] = "svg";
    next["data-status"] = VisualDataStatus.FILLED;
    next["data-render-type"] = "svg";
    delete next["data-fallback"];
    delete next["data-aspect-ratio"];
    if (Number.isFinite(width)) next["data-width"] = String(width);
    if (Number.isFinite(height)) next["data-height"] = String(height);

    const attrPairs = Object.entries(next).map(([k, v]) => `${k}="${escapeAttr(v)}"`);
    const body = selfClosing ? "" : innerHtml;
    return { slotId, html: `<div ${attrPairs.join(" ")}>${svgContent || body}</div>` };
  };

  const placeholders = findImagePlaceholders(input);
  let out = input;
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const { start, end, openTag, inner, isSelfClosing } = placeholders[i];
    const built = buildReplacement(openTag, inner, isSelfClosing);
    if (!built) continue;
    out = out.slice(0, start) + built.html + out.slice(end);
  }

  return { html: out, filledSlotIds: [...new Set(filledSlotIds)], skippedSlotIds: [...new Set(skippedSlotIds)] };
}
