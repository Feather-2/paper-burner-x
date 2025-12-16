function safeJson(v, maxLen = 8000) {
  const s = JSON.stringify(v ?? null, null, 2);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "\n...<truncated>";
}

export const BRAINSTORM_SYSTEM_PROMPT = [
  "You are a Creative Director for presentation design.",
  "Your task: propose 2-3 distinct visual concept candidates for ONE slide.",
  "Use the provided designSystem + slideIntent + available DSL effects to create rich, modern, presentation-friendly visuals.",
  "",
  "Output format: return ONLY valid JSON (no markdown, no commentary).",
  "JSON schema:",
  "{",
  '  "candidates": [',
  "    {",
  '      "candidateId": "string",',
  '      "atmosphere": { "mood": "string", "colorScheme": "string", "visualWeight": "string" },',
  '      "elementsMarkdown": "string (markdown list of layers/elements; may include placeholders like {{IMAGE:slotId}} / {{SVG:slotId}} / {{ASSET:slotId}})",',
  '      "visualSlots": [',
  "        {",
  '          "slotId": "string (unique within slide)",',
  '          "slideIntentId": "string",',
  '          "slideIndex": "number",',
  '          "renderType": "ai-image|svg|asset",',
  '          "position": { "x":"%","y":"%","w":"%","h":"%" },',
  '          "effects": { "mask":"string?","opacity":"number?","blend":"string?","effect":"string?","radius":"number?","rotate":"number?","filter":"string?" },',
  '          "priority": "critical|important|optional",',
  '          "imageSpec": { "prompt":"string","negativePrompt":"string?","style":"3d|photo|illustration|flat" }?,',
  '          "svgSpec": { "type":"string","description":"string","style":"object?","elements":"array?" }?,',
  '          "assetSpec": { "assetId":"string","sourceId":"string?","caption":"string?" }?',
  "        }",
  "      ]",
  "    }",
  "  ]",
  "}",
  "",
  "Constraints:",
  "- Candidates must be meaningfully different (composition, metaphor, or primary visual).",
  "- visualSlots must be coherent with elementsMarkdown (slotId references match).",
  "- Keep positions in percent strings like \"10%\".",
  "- Prefer 1-2 slots per slide; avoid clutter.",
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
  '  "reviews": [',
  "    {",
  '      "candidateId": "string",',
  '      "scores": { "visualImpact": 0.0, "clarity": 0.0, "novelty": 0.0, "consistency": 0.0 }',
  "    }",
  "  ],",
  '  "selectedCandidateId": "string"',
  "}",
  "",
  "Notes:",
  "- selectedCandidateId should match the highest composite impression based on the scores.",
  "- Be strict: penalize clutter, weak hierarchy, or mismatch with designSystem.",
].join("\n");

export function buildBrainstormPrompt(slideIntent, designSystem, dslEffects) {
  return [
    "Create 2-3 design candidates for the following slide.",
    "",
    "slideIntent:",
    safeJson(
      {
        slideIntentId: slideIntent?.slideIntentId || slideIntent?.slideIntentID,
        pageType: slideIntent?.pageType,
        title: slideIntent?.title,
        objective: slideIntent?.objective,
        keyPoints: slideIntent?.keyPoints,
        content: slideIntent?.content,
        claimIds: slideIntent?.claimIds,
      },
      6000
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
    "",
    "Return JSON ONLY.",
  ].join("\n");
}

export function buildReviewPrompt(slideIntent, candidates) {
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
      (Array.isArray(candidates) ? candidates : []).map((c) => ({
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

