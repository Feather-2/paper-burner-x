function safeJson(v, maxLen = 8000) {
  const s = JSON.stringify(v ?? null, null, 2);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "\n...<truncated>";
}

export const BRAINSTORM_SYSTEM_PROMPT = [
  "You are a Visual Planner for presentation design.",
  "Your task: for EACH slide, decide what visual elements are needed and where to place them.",
  "",
  "IMPORTANT: When availableAssets are provided, PREFER reusing existing assets over generating new images.",
  "",
  "Output format: return ONLY valid JSON.",
  "JSON schema:",
  "{",
  '  "slideResults": [',
  "    {",
  '      "slideIntentId": "string",',
  '      "slideIndex": number,',
  '      "visualSlots": [',
  "        {",
  '          "slotId": "string (unique, e.g. hero_img, bg_pattern, main_illustration)",',
  '          "renderType": "ai-image | svg | asset",',
  '          "position": { "x": "10%", "y": "20%", "w": "40%", "h": "50%" },',
  '          "purpose": "string (what is this visual for, e.g. 产品展示, 装饰背景, 数据图表)",',
  '          "prompt": "string (for ai-image: generation prompt)",',
  '          "style": "photo | illustration | 3d | flat (for ai-image)",',
  '          "svgDescription": "string (for svg: what to draw, be specific)",',
  '          "svgType": "diagram | icon | pattern | chart (for svg)",',
  '          "assetId": "string (for asset: which asset to reuse)",',
  '          "effects": { "opacity": "0-1", "radius": "8px", "blend": "multiply", "filter": "blur(4px)" }',
  "        }",
  "      ]",
  "    }",
  "  ]",
  "}",
  "",
  "Position guidelines (use percentages, be flexible):",
  "- Full background: x=0%, y=0%, w=100%, h=100%",
  "- Left half: x=2%, y=15%, w=45%, h=70%",
  "- Right half: x=53%, y=15%, w=45%, h=70%",
  "- Small icon: w=8%-15%, h=8%-15%",
  "- Hero image: w=50%-80%, centered or offset",
  "- Adjust based on text layout and visual balance",
  "",
  "Constraints:",
  "- Process ALL slides, return one entry per slide.",
  "- Each slide can have 0-3 visualSlots (don't clutter).",
  "- For text-heavy slides (agenda, summary), fewer or no visuals is fine.",
  "- Reuse availableAssets when content matches.",
  "- Keep it simple: just plan what visuals go where.",
  "- Use effects.radius for rounded corners on images.",
].join("\n");

export const BRAINSTORM_REVIEW_PROMPT = [
  "You are an Art Director reviewing presentation slide visual concepts.",
  "Score each candidate from 0.0 to 1.0 (higher is better) across:",
  "- visualImpact: immediate visual punch",
  "- clarity: communicates the slide intent clearly",
  "- novelty: freshness without being distracting",
  "- consistency: aligns with the given designSystem style",
  "",
  "Output format: return ONLY valid JSON (no markdown, no commentary).",
  "JSON schema:",
  "{",
  '  "slideReviews": [',
  "    {",
  '      "slideIntentId": "string",',
  '      "slideIndex": "number",',
  '      "reviews": [',
  "        {",
  '          "candidateId": "string",',
  '          "scores": { "visualImpact": 0.0, "clarity": 0.0, "novelty": 0.0, "consistency": 0.0 }',
  "        }",
  "      ],",
  '      "selectedCandidateId": "string"',
  "    }",
  "  ]",
  "}",
  "",
  "Notes:",
  "- Process ALL slides in the batch, return one entry per slide in slideReviews.",
  "- selectedCandidateId should match the highest composite impression based on the scores for that slide.",
  "- Be strict: penalize clutter, weak hierarchy, or mismatch with designSystem.",
].join("\n");

export function buildBrainstormPrompt(slideIntentsOrSingle, designSystem, dslEffects, styleSpec, availableAssets) {
  const slideIntents = Array.isArray(slideIntentsOrSingle) ? slideIntentsOrSingle : [slideIntentsOrSingle];

  const parts = [
    `Plan visual elements for ${slideIntents.length} slide(s).`,
    "",
    "slideIntents:",
    safeJson(
      slideIntents.map((si, idx) => ({
        slideIntentId: si?.slideIntentId || si?.slideIntentID,
        slideIndex: si?.slideIndex ?? idx,
        pageType: si?.pageType,
        title: si?.title,
        objective: si?.objective,
        keyPoints: si?.keyPoints,
      })),
      8000
    ),
  ];

  // 设计规范（简化）
  if (designSystem?.designTokens) {
    parts.push(
      "",
      "designTokens (colors/fonts to use):",
      safeJson({ colors: designSystem.designTokens.colors, fonts: designSystem.designTokens.fonts }, 2000)
    );
  }

  // 可用资源
  const assets = Array.isArray(availableAssets) ? availableAssets : [];
  if (assets.length > 0) {
    const assetSummaries = assets.slice(0, 15).map((a) => ({
      assetId: a?.assetId,
      description: a?.understanding?.description || "",
      category: a?.understanding?.category || "image",
      suggestedUse: a?.understanding?.suggestedUse || [],
    }));
    parts.push(
      "",
      `availableAssets (${assets.length} images to reuse):`,
      safeJson(assetSummaries, 3000)
    );
  }

  // 风格参考（简化）
  if (styleSpec?.colorTone || styleSpec?.designTraits?.colorTone) {
    parts.push(
      "",
      "styleHint:",
      safeJson({ colorTone: styleSpec?.colorTone || styleSpec?.designTraits?.colorTone }, 500)
    );
  }

  parts.push("", "Return JSON ONLY.");
  return parts.join("\n");
}

export function buildReviewPrompt(slideIntentsOrSingle, candidatesOrBatch, designSystem) {
  // Support both single slideIntent and array of slideIntents
  // candidatesOrBatch: either Array<candidate> for single slide, or Array<{slideIntentId, slideIndex, candidates}> for batch
  const isBatch = Array.isArray(slideIntentsOrSingle) && slideIntentsOrSingle.length > 1;

  if (isBatch) {
    // Batch mode: candidatesOrBatch is Array<{slideIntentId, slideIndex, candidates}>
    const batchData = Array.isArray(candidatesOrBatch) ? candidatesOrBatch : [];
    return [
      `Review the candidates for ${batchData.length} slides and provide scores for each.`,
      "",
      "slideData:",
      safeJson(
        batchData.map((item) => ({
          slideIntentId: item?.slideIntentId,
          slideIndex: item?.slideIndex,
          pageType: item?.pageType,
          title: item?.title,
          objective: item?.objective,
          candidates: (Array.isArray(item?.candidates) ? item.candidates : []).map((c) => ({
            candidateId: c?.candidateId,
            atmosphere: c?.atmosphere,
            elementsMarkdown: c?.elementsMarkdown,
            visualSlots: c?.visualSlots,
          })),
        })),
        16000
      ),
      "",
      "designSystem:",
      safeJson(
        {
          theme: designSystem?.theme,
          designTokens: designSystem?.designTokens,
        },
        3000
      ),
      "",
      "Return JSON ONLY.",
    ].join("\n");
  }

  // Single slide mode (backward compatible)
  const slideIntent = Array.isArray(slideIntentsOrSingle) ? slideIntentsOrSingle[0] : slideIntentsOrSingle;
  const candidates = Array.isArray(candidatesOrBatch) ? candidatesOrBatch : [];
  return [
    "Review the candidates for the given slide and provide scores.",
    "",
    "slideIntent:",
    safeJson(
      {
        slideIntentId: slideIntent?.slideIntentId || slideIntent?.slideIntentID,
        pageType: slideIntent?.pageType,
        title: slideIntent?.title,
        objective: slideIntent?.objective,
      },
      2500
    ),
    "",
    "candidates:",
    safeJson(
      candidates.map((c) => ({
        candidateId: c?.candidateId,
        atmosphere: c?.atmosphere,
        elementsMarkdown: c?.elementsMarkdown,
        visualSlots: c?.visualSlots,
      })),
      8000
    ),
    "",
    "Return JSON ONLY.",
  ].join("\n");
}

export const __test = { safeJson };
