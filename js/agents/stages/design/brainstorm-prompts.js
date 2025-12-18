function safeJson(v, maxLen = 8000) {
  const s = JSON.stringify(v ?? null, null, 2);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "\n...<truncated>";
}

export const BRAINSTORM_SYSTEM_PROMPT = [
  "You are a Creative Director for presentation design.",
  "Your task: propose 2-3 distinct visual concept candidates for EACH slide in the batch.",
  "Use the provided designSystem + slideIntents + available DSL effects to create rich, modern, presentation-friendly visuals.",
  "",
  "IMPORTANT: When availableAssets are provided, PREFER reusing existing assets (renderType: 'asset') over generating new images.",
  "Match assets by their description/topics/category to the slide content. This saves generation cost and ensures visual consistency.",
  "",
  "Output format: return ONLY valid JSON (no markdown, no commentary).",
  "JSON schema:",
  "{",
  '  "slideResults": [',
  "    {",
  '      "slideIntentId": "string",',
  '      "slideIndex": "number",',
  '      "candidates": [',
  "        {",
  '          "candidateId": "string",',
  '          "atmosphere": { "mood": "string", "colorScheme": "string", "visualWeight": "string" },',
  '          "elementsMarkdown": "string (markdown list of layers/elements; may include placeholders like {{IMAGE:slotId}} / {{SVG:slotId}} / {{ASSET:slotId}})",',
  '          "visualSlots": [',
  "            {",
  '              "slotId": "string (unique within slide)",',
  '              "slideIntentId": "string",',
  '              "slideIndex": "number",',
  '              "renderType": "ai-image|svg|asset",',
  '              "position": { "x":"%","y":"%","w":"%","h":"%" },',
  '              "effects": { "mask":"string?","opacity":"number?","blend":"string?","effect":"string?","radius":"number?","rotate":"number?","filter":"string?" },',
  '              "priority": "critical|important|optional",',
  '              "imageSpec": { "prompt":"string","negativePrompt":"string?","style":"3d|photo|illustration|flat" }?,',
  '              "svgSpec": { "type":"string","description":"string","style":"object?","elements":"array?" }?,',
  '              "assetSpec": { "assetId":"string","sourceId":"string?","caption":"string?" }?',
  "            }",
  "          ]",
  "        }",
  "      ]",
  "    }",
  "  ]",
  "}",
  "",
  "Constraints:",
  "- Process ALL slides in the batch, return one entry per slide in slideResults.",
  "- Candidates must be meaningfully different (composition, metaphor, or primary visual).",
  "- visualSlots must be coherent with elementsMarkdown (slotId references match).",
  "- Keep positions in percent strings like \"10%\".",
  "- Prefer 1-2 slots per slide; avoid clutter.",
  "- When an availableAsset matches the slide topic/content, use renderType:'asset' with assetSpec.assetId.",
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
  // Support both single slideIntent and array of slideIntents
  const slideIntents = Array.isArray(slideIntentsOrSingle) ? slideIntentsOrSingle : [slideIntentsOrSingle];
  const isBatch = slideIntents.length > 1;

  const parts = [
    isBatch
      ? `Create 2-3 design candidates for EACH of the following ${slideIntents.length} slides.`
      : "Create 2-3 design candidates for the following slide.",
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
        content: si?.content,
        claimIds: si?.claimIds,
      })),
      12000
    ),
    "",
    "designSystem:",
    safeJson(
      {
        theme: designSystem?.theme,
        designTokens: designSystem?.designTokens,
        styleReference: designSystem?.styleReference,
        visualPreference: designSystem?.visualPreference,
        imageStyle: designSystem?.imageStyle,
      },
      6000
    ),
    "",
    "dslEffects (available building blocks):",
    safeJson(dslEffects, 4000),
  ];

  // 添加可用 assets 列表
  const assets = Array.isArray(availableAssets) ? availableAssets : [];
  if (assets.length > 0) {
    const assetSummaries = assets.slice(0, 20).map((a) => ({
      assetId: a?.assetId,
      category: a?.understanding?.category || a?.type || "image",
      description: a?.understanding?.description || "",
      topics: a?.understanding?.topics || [],
      suggestedUse: a?.understanding?.suggestedUse || [],
      visualStyle: a?.understanding?.visualStyle || "",
      docId: a?.docId,
    }));
    parts.push(
      "",
      `availableAssets (${assets.length} images from source documents; use renderType:'asset' + assetSpec.assetId to reuse):`,
      safeJson(assetSummaries, 4000)
    );
  }

  if (styleSpec) {
    parts.push(
      "",
      "styleSpec (extracted from reference PPT; use as inspiration, not a hard constraint):",
      safeJson(
        {
          colorTone: styleSpec?.designTraits?.colorTone,
          dominantColors: styleSpec?.designTraits?.dominantColors,
          fontScheme: styleSpec?.fontScheme,
        },
        2000
      )
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
