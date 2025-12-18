import { getDesignModelCaller } from "./model.js";
import { robustParseJson } from "../../shared/robust-json.js";

/**
 * Simple concurrency limiter (pLimit-style).
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

function toNonEmptyString(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return s.length ? s : "";
}

function safeNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeEmit(emit, name, status, payload) {
  if (typeof emit !== "function") return;
  emit(name, { actor: "design", status, payload });
}

function escapeAttr(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseTagAttributes(tag) {
  const attrs = {};
  const re = /\b([a-zA-Z0-9_:-]+)\s*=\s*(["'])(.*?)\2/g;
  let m;
  while ((m = re.exec(tag))) attrs[m[1]] = m[3];
  return attrs;
}

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

// System prompt for batch SVG generation
const SVG_BATCH_SYSTEM_PROMPT = `You are an SVG artist for presentation slides. Generate creative, visually appealing SVG graphics.

OUTPUT FORMAT:
Return a JSON array: [{"slotId": "...", "svg": "<svg>...</svg>"}, ...]

STYLE CONSISTENCY:
- All SVGs in this batch should share a cohesive visual language
- Use the provided color palette consistently
- Maintain similar stroke widths, corner radii, and shadow styles
- Keep designs modern, clean, and professional

AVAILABLE TECHNIQUES:
- Gradients: <linearGradient>, <radialGradient> for depth
- Filters: blur, drop-shadow, glow via <filter>
- Shapes: rect, circle, ellipse, path, polygon, line
- Text: <text> with font-family, font-size (min 12px for readability)
- Groups: <g> for organizing, with opacity/transform
- Blend modes and semi-transparency for layering

DESIGN GUIDELINES:
- Use rounded corners (rx/ry) for modern look
- Add subtle shadows or glows for depth
- Create visual interest with layered shapes
- Keep sufficient contrast for readability
- Ensure the design matches its purpose (icon, diagram, illustration, etc.)`;

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

async function generateBatchWithLLM(batchSlots, designSystem, slideHtmlMap, options = {}) {
  const { modelRouter, aiApiService, signal } = options;
  const colors = pickColors(designSystem);

  const modelCaller = getDesignModelCaller({ modelRouter, aiApiService, signal }, { usage: "designer", timeoutMs: 60_000 });

  if (typeof modelCaller !== "function") {
    // No model available, return fallbacks
    return batchSlots.map((slot) => {
      const slotId = toNonEmptyString(slot?.slotId);
      const size = sizeFromPosition(slot?.position) || { width: 600, height: 400 };
      const label = toNonEmptyString(slot?.svgSpec?.description) || slotId || "Visual";
      return {
        slotId,
        svgContent: makeFallbackSvg({ width: size.width, height: size.height, colors, label }),
        width: size.width,
        height: size.height,
        source: "fallback",
      };
    });
  }

  const prompt = buildBatchPrompt(batchSlots, designSystem, slideHtmlMap);
  const messages = [
    { role: "system", content: SVG_BATCH_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];

  const slotIds = batchSlots.map(s => s?.slotId).filter(Boolean);
  console.log("[svg-generator] generateBatchWithLLM started", { slotIds, promptLength: prompt.length });

  // Retry up to 2 times (skip retry for config errors)
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) break;

    try {
      console.log("[svg-generator] LLM call attempt", { attempt: attempt + 1, slotIds });
      const resp = await modelCaller(messages, { temperature: 0.5, maxTokens: 6000, signal, timeoutMs: 90_000 });
      const rawContent = resp?.content || "";
      console.log("[svg-generator] LLM response received", {
        contentLength: rawContent.length,
        preview: rawContent.slice(0, 500)
      });

      const parsed = extractJsonFromResponse(rawContent);
      console.log("[svg-generator] JSON parse result", {
        isArray: Array.isArray(parsed),
        itemCount: Array.isArray(parsed) ? parsed.length : 0,
        parseResult: parsed === null ? "null" : typeof parsed
      });

      if (Array.isArray(parsed)) {
        const resultById = new Map();
        for (const item of parsed) {
          const slotId = toNonEmptyString(item?.slotId);
          let svgContent = toNonEmptyString(item?.svg) || extractSvgFromText(item?.svg);
          if (slotId && svgContent) {
            resultById.set(slotId, svgContent);
            console.log("[svg-generator] SVG extracted", { slotId, svgLength: svgContent.length });
          } else {
            console.warn("[svg-generator] Failed to extract SVG", { slotId, hasSvg: !!item?.svg, svgPreview: String(item?.svg || "").slice(0, 200) });
          }
        }

        console.log("[svg-generator] Batch complete", { requested: slotIds, extracted: [...resultById.keys()] });
        return batchSlots.map((slot) => {
          const slotId = toNonEmptyString(slot?.slotId);
          const size = sizeFromPosition(slot?.position) || { width: 600, height: 400 };
          const svgContent = resultById.get(slotId);
          const label = toNonEmptyString(slot?.svgSpec?.description) || slotId || "Visual";

          if (svgContent) {
            return { slotId, svgContent, width: size.width, height: size.height, source: "llm" };
          }
          return {
            slotId,
            svgContent: makeFallbackSvg({ width: size.width, height: size.height, colors, label }),
            width: size.width,
            height: size.height,
            source: "fallback",
          };
        });
      }
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[svg-generator] Batch LLM attempt failed:", { attempt: attempt + 1, error: msg });

      // Don't retry for config/auth errors - fail fast
      if (msg.includes("No available model config") || msg.includes("not available") || msg.includes("401") || msg.includes("403")) {
        console.warn("[svg-generator] Config/auth error detected, skipping retry");
        break;
      }
      if (attempt < 1) continue; // retry once for transient errors
    }
  }

  const errorMsg = lastErr ? (lastErr instanceof Error ? lastErr.message : String(lastErr)) : null;
  if (errorMsg) {
    console.warn("[svg-generator] Batch LLM generation failed after retries:", errorMsg);
  }

  // Fallback for entire batch
  return batchSlots.map((slot) => {
    const slotId = toNonEmptyString(slot?.slotId);
    const size = sizeFromPosition(slot?.position) || { width: 600, height: 400 };
    const label = toNonEmptyString(slot?.svgSpec?.description) || slotId || "Visual";
    return {
      slotId,
      svgContent: makeFallbackSvg({ width: size.width, height: size.height, colors, label }),
      width: size.width,
      height: size.height,
      source: "fallback",
      ...(errorMsg ? { error: errorMsg } : {}),
    };
  });
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
    if (slots.length === 0) return [];

    const htmlMap = slideHtmlBySlotId instanceof Map ? slideHtmlBySlotId : new Map();
    const effectiveConcurrency = Math.max(1, Math.min(6, concurrency || this.concurrency || 3));

    safeEmit(emit, "design.svg.generate.started", "started", { slots: slots.length, concurrency: effectiveConcurrency });

    const batches = chunkArray(slots, this.batchSize);
    const allResults = new Array(batches.length);

    // Process batches in parallel with concurrency limit
    const limiter = createLimiter(effectiveConcurrency);
    await Promise.all(batches.map((batch, batchIndex) => limiter(async () => {
      if (signal?.aborted) {
        allResults[batchIndex] = batch.map((slot) => ({
          slotId: toNonEmptyString(slot?.slotId),
          svgContent: "",
          width: 0,
          height: 0,
          source: "skipped",
        }));
        return;
      }

      const results = await generateBatchWithLLM(batch, designSystem, htmlMap, { modelRouter, aiApiService, signal });
      allResults[batchIndex] = results;

      safeEmit(emit, "design.svg.batch.completed", "completed", {
        batchIndex,
        batchCount: batches.length,
        generated: results.filter((s) => s.source === "llm").length,
        fallback: results.filter((s) => s.source === "fallback").length,
      });
    })));

    const flatResults = allResults.flat();

    // Collect unique errors
    const errors = [...new Set(flatResults.filter((s) => s.error).map((s) => s.error))];

    safeEmit(emit, "design.svg.generate.completed", "completed", {
      slots: flatResults.length,
      llmGenerated: flatResults.filter((s) => s.source === "llm").length,
      fallback: flatResults.filter((s) => s.source === "fallback").length,
      ...(errors.length ? { errors } : {}),
    });

    return flatResults;
  }
}

/**
 * Replace `<div data-el="image-placeholder" ... data-render-type="svg">` with `<div data-el="svg">...</div>`.
 */
export function fillSvgPlaceholders(html, filledSlots) {
  const input = typeof html === "string" ? html : "";
  const slots = Array.isArray(filledSlots) ? filledSlots : [];
  if (!input || slots.length === 0) return { html: input, filledSlotIds: [], skippedSlotIds: [] };

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

  const replaceOne = (match, tag, innerHtml, selfClosing) => {
    const attrs = parseTagAttributes(tag);
    const slotId = toNonEmptyString(attrs["data-slot-id"]) || toNonEmptyString(attrs.id);
    if (!slotId || !bySlotId.has(slotId)) return match;

    const rt = normalizeRenderType(attrs["data-render-type"]);
    if (rt && rt !== "svg") return match;

    const { svgContent, width, height } = bySlotId.get(slotId);
    filledSlotIds.push(slotId);

    const next = { ...attrs };
    next["data-el"] = "svg";
    next["data-status"] = "filled";
    next["data-render-type"] = "svg";
    delete next["data-fallback"];
    delete next["data-aspect-ratio"];
    if (Number.isFinite(width)) next["data-width"] = String(width);
    if (Number.isFinite(height)) next["data-height"] = String(height);

    const attrPairs = Object.entries(next).map(([k, v]) => `${k}="${escapeAttr(v)}"`);
    const body = selfClosing ? "" : innerHtml;
    return `<div ${attrPairs.join(" ")}>${svgContent || body}</div>`;
  };

  const placeholderRe = /(<div\b[^>]*\bdata-el=(["'])image-placeholder\2[^>]*>)([\s\S]*?)<\/div>/gi;
  const out1 = input.replace(placeholderRe, (match, openTag, _q, inner) => {
    return replaceOne(match, openTag, inner, false);
  });

  const selfClosingRe = /(<div\b[^>]*\bdata-el=(["'])image-placeholder\2[^>]*\/>)/gi;
  const out2 = out1.replace(selfClosingRe, (match, tag) => {
    return replaceOne(match, tag, "", true);
  });

  return { html: out2, filledSlotIds: [...new Set(filledSlotIds)], skippedSlotIds: [...new Set(skippedSlotIds)] };
}
