/**
 * Vision screenshot -> Layout JSON
 *
 * analyzeImage(imageData, context):
 * - imageData: data URL / base64 string / URL (passed through to vision provider)
 * - context: { modelRouter?, visionApi?, intentHint?, signal? }
 *
 * Returns Layout JSON (bounds as numbers 0..100).
 */

const ALLOWED_INTENTS = new Set(["layout_reference", "content_extract", "style_reference", "modify_element"]);
const ALLOWED_TYPES = new Set(["text", "image", "shape", "table", "chart"]);

function asString(v) {
  return v === undefined || v === null ? "" : String(v);
}

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function normalizeBounds(bounds) {
  const b = bounds && typeof bounds === "object" ? bounds : {};
  const x = clamp(b.x, 0, 100);
  const y = clamp(b.y, 0, 100);
  const w = clamp(b.w, 0, 100);
  const h = clamp(b.h, 0, 100);
  return { x, y, w, h };
}

function parseJsonFromModelText(text) {
  const s = asString(text).trim();
  if (!s) return null;

  // Prefer fenced ```json blocks.
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch {
      // fall through
    }
  }

  // Try parse as-is.
  try {
    return JSON.parse(s);
  } catch {
    // fall through
  }

  // Last resort: find first {...} block.
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeStyleDescription(sd) {
  if (!sd || typeof sd !== "object") return undefined;
  const result = {};
  const fields = ["colorTone", "mood", "layoutStyle", "typography", "effects"];
  for (const f of fields) {
    const v = asString(sd[f]).trim();
    if (v) result[f] = v;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeLayoutJson(input, { intentHint } = {}) {
  const obj = input && typeof input === "object" ? input : {};
  const rawIntent = asString(obj.intent || intentHint || "layout_reference").trim();
  const intent = ALLOWED_INTENTS.has(rawIntent) ? rawIntent : "layout_reference";

  const analysis = asString(obj.analysis || obj.reasoning || "").trim();
  const extractedPalette = Array.isArray(obj.extractedPalette) ? obj.extractedPalette.map((c) => asString(c).trim()).filter(Boolean) : undefined;

  const suggestedLayoutRaw = asString(obj.suggestedLayout || "").trim();
  const suggestedLayout = ["cover", "content", "comparison"].includes(suggestedLayoutRaw) ? suggestedLayoutRaw : undefined;

  // Parse styleDescription for style_reference intent
  const styleDescription = normalizeStyleDescription(obj.styleDescription);

  const elementsIn = Array.isArray(obj.elements) ? obj.elements : [];
  const elements = elementsIn
    .map((el) => {
      const e = el && typeof el === "object" ? el : {};
      const type = asString(e.type).trim();
      if (!ALLOWED_TYPES.has(type)) return null;
      const bounds = normalizeBounds(e.bounds);

      const content = e.content !== undefined ? asString(e.content) : undefined;
	      const styleIn = e.style && typeof e.style === "object" ? e.style : undefined;
	      const style = styleIn
	        ? {
	            fontSize: styleIn.fontSize !== undefined ? Math.max(8, Math.min(200, Number(styleIn.fontSize) || 16)) : undefined,
	            color: styleIn.color !== undefined ? asString(styleIn.color) : undefined,
	            fontWeight: styleIn.fontWeight !== undefined ? asString(styleIn.fontWeight) : undefined,
	          }
	        : undefined;

      return { type, bounds, ...(content !== undefined ? { content } : {}), ...(style ? { style } : {}) };
    })
    .filter(Boolean);

  return {
    intent,
    analysis,
    elements,
    ...(extractedPalette && extractedPalette.length ? { extractedPalette } : {}),
    ...(suggestedLayout ? { suggestedLayout } : {}),
    ...(styleDescription ? { styleDescription } : {}),
  };
}

function resolveVisionCaller(context) {
  const modelRouter = context?.modelRouter;
  const visionApi = context?.visionApi;

  if (modelRouter?.call) {
    return (prompt, images) => modelRouter.call(prompt, { usage: "vision", images, signal: context?.signal });
  }
  if (visionApi?.describe) {
    return (prompt, images) => visionApi.describe(images[0], prompt, { signal: context?.signal });
  }
  return null;
}

function buildPrompt({ intentHint } = {}) {
  const hint = asString(intentHint).trim();
  const intentLine = hint && ALLOWED_INTENTS.has(hint) ? `Intent hint: ${hint}\n` : "";

  // Extended schema for style_reference intent
  const styleDescriptionSchema = hint === "style_reference"
    ? '  "styleDescription"?: {\n' +
      '    "colorTone": string,      // e.g. "深蓝渐变到紫色，科技感强"\n' +
      '    "mood": string,           // e.g. "专业、简洁、现代"\n' +
      '    "layoutStyle": string,    // e.g. "大留白、左图右文为主"\n' +
      '    "typography": string,     // e.g. "无衬线粗体标题，细体正文"\n' +
      '    "effects": string         // e.g. "微妙渐变、圆角卡片、轻阴影"\n' +
      "  },\n"
    : "";

  const styleDescriptionRule = hint === "style_reference"
    ? "- For style_reference intent, provide detailed styleDescription fields in Chinese\n" +
      "- colorTone: describe the color scheme and mood it creates\n" +
      "- mood: describe the overall feeling (professional, playful, elegant, etc.)\n" +
      "- layoutStyle: describe layout patterns (whitespace, alignment, grid usage)\n" +
      "- typography: describe font choices and text styling\n" +
      "- effects: describe visual effects (gradients, shadows, rounded corners, etc.)\n"
    : "";

  return (
    "You are given a screenshot of a single presentation slide.\n" +
    intentLine +
    "Task: convert the screenshot to a strict JSON object describing layout.\n" +
    "Return ONLY valid JSON, no commentary.\n" +
    "Schema:\n" +
    "{\n" +
    '  "intent": "layout_reference" | "content_extract" | "style_reference" | "modify_element",\n' +
    '  "analysis": string,\n' +
    '  "elements": [\n' +
    "    {\n" +
    '      "type": "text" | "image" | "shape" | "table" | "chart",\n' +
    '      "bounds": { "x": number, "y": number, "w": number, "h": number },\n' +
    '      "content"?: string,\n' +
    '      "style"?: { "fontSize"?: number, "color"?: string, "fontWeight"?: string }\n' +
    "    }\n" +
    "  ],\n" +
    '  "extractedPalette"?: string[],\n' +
    '  "suggestedLayout"?: "cover" | "content" | "comparison",\n' +
    styleDescriptionSchema +
    "}\n" +
    "Rules:\n" +
    "- bounds are percentages 0..100 relative to slide canvas\n" +
    "- color strings should be HEX like #RRGGBB when possible\n" +
    styleDescriptionRule
  );
}

async function analyzeImage(imageData, context = {}) {
  const img = imageData;
  if (!img) throw new Error("analyzeImage: imageData required");

  const callVision = resolveVisionCaller(context);
  if (!callVision) {
    return normalizeLayoutJson(
      {
        intent: context?.intentHint || "layout_reference",
        analysis: "No vision provider configured; returning minimal fallback layout.",
        elements: [{ type: "text", bounds: { x: 8, y: 8, w: 84, h: 12 }, content: "Untitled", style: { fontSize: 44, color: "#0f172a", fontWeight: "700" } }],
      },
      { intentHint: context?.intentHint }
    );
  }

  const prompt = buildPrompt({ intentHint: context?.intentHint });
  const result = await callVision(prompt, [img]);
  const text = result && typeof result === "object" && "content" in result ? result.content : result;

  const parsed = parseJsonFromModelText(text);
  if (!parsed) throw new Error("analyzeImage: failed to parse vision response as JSON");

  return normalizeLayoutJson(parsed, { intentHint: context?.intentHint });
}

export const _internal = {
  parseJsonFromModelText,
  normalizeLayoutJson,
  normalizeBounds,
};

export { analyzeImage };

export default {
  analyzeImage,
  _internal,
};
