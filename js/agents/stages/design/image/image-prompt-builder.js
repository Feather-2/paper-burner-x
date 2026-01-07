/**
 * @typedef {object} ImageSlot
 * @property {string} [promptHint]
 * @property {string} [style]
 * @property {string} [purpose]
 * @property {string} [aspectRatio]
 * @property {Array<string|number>} [claimIds]
 */

/**
 * @typedef {object} DesignTokens
 * @property {{primary?: string, accent?: string, bg?: string}} [colors]
 */

/**
 * @typedef {object} DesignSystem
 * @property {string} [theme]
 * @property {string} [imageStyle]
 * @property {DesignTokens} [designTokens]
 */

/**
 * @typedef {object} ContentClaim
 * @property {string|number} [claimId]
 * @property {string} [text]
 */

/**
 * @typedef {object} ContentPackage
 * @property {ContentClaim[]} [claims]
 */

function fallbackImageStyleFromDesignSystem(designSystem = {}) {
  const theme = String(designSystem?.theme || "").toLowerCase();
  const colors = designSystem?.designTokens?.colors || {};
  const primary = colors.primary || colors.accent || undefined;
  const bg = colors.bg || undefined;

  const parts = ["Clean modern presentation style."];
  if (theme) parts.push(`Theme: ${theme}.`);
  if (primary) parts.push(`Use accents inspired by primary color (${primary}).`);
  if (bg) parts.push(`Background should harmonize with (${bg}).`);
  parts.push("High contrast shapes; simple composition; no clutter.");

  return parts.join(" ");
}

function extractKeywordsFromClaims(claimTexts, { max = 10 } = {}) {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "over",
    "under",
    "your",
    "you",
    "our",
    "their",
    "they",
    "them",
    "are",
    "is",
    "was",
    "were",
    "be",
    "been",
    "being",
    "a",
    "an",
    "to",
    "of",
    "in",
    "on",
    "at",
    "by",
    "as",
    "or",
    "not",
    "no",
    "it",
    "its",
  ]);

  const freq = new Map();
  const add = (token) => {
    const t = String(token || "").trim().toLowerCase();
    if (!t) return;
    if (stop.has(t)) return;
    if (t.length < 3) return;
    freq.set(t, (freq.get(t) || 0) + 1);
  };

  for (const raw of claimTexts || []) {
    const text = String(raw || "")
      .replace(/^claim\s*\d+\s*:\s*/i, "")
      .replace(/^[^:]{0,40}:\s*/, "")
      .trim();
    if (!text) continue;

    const wordTokens = text.match(/[A-Za-z0-9][A-Za-z0-9-]{2,}/g) || [];
    for (const tok of wordTokens) add(tok);

    const cjkTokens = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
    for (const tok of cjkTokens) add(tok);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

function purposeHint(purpose) {
  switch (purpose) {
    case "hero":
      return "High-impact hero image for a cover slide; bold focal point; lots of negative space for overlaid slide text.";
    case "illustration":
      return "Conceptual illustration that supports the slide message; clear and readable at a glance.";
    case "icon":
      return "Single simple icon; minimal detail; centered; crisp edges.";
    case "background":
      return "Subtle abstract background; low contrast; not distracting; supports overlaid content.";
    case "chart_fallback":
      return "Visual metaphor for data/comparison/process; avoid literal charts, axes, labels, or numbers.";
    default:
      return "Presentation-friendly illustration.";
  }
}

/**
 * Build an image-generation prompt for a single slot.
 *
 * @param {ImageSlot} [imageSlot={}] - Slot metadata (purpose, style, claimIds, etc.).
 * @param {DesignSystem} [designSystem={}] - Design system tokens used to infer style hints.
 * @param {ContentPackage} [contentPackage={}] - Content package used to extract claim keywords.
 * @returns {string} Prompt text (always ends with a newline).
 */
export function buildPrompt(imageSlot = {}, designSystem = {}, contentPackage = {}) {
  const promptHint = String(imageSlot?.promptHint || "").trim() || "A presentation slide illustration.";
  const style = String(imageSlot?.style || "").trim() || "flat";
  const purpose = String(imageSlot?.purpose || "illustration").trim();
  const aspectRatio = String(imageSlot?.aspectRatio || "16:9").trim();

  const designStyle = String(designSystem?.imageStyle || "").trim() || fallbackImageStyleFromDesignSystem(designSystem);

  const claimIds = Array.isArray(imageSlot?.claimIds) ? imageSlot.claimIds.map((c) => String(c)).filter(Boolean) : [];
  const claims = Array.isArray(contentPackage?.claims) ? contentPackage.claims : [];
  const claimTexts = claimIds.length ? claims.filter((c) => claimIds.includes(String(c?.claimId))).map((c) => c?.text).filter(Boolean) : [];
  const keywords = extractKeywordsFromClaims(claimTexts, { max: 10 });

  const lines = [
    `Create a ${style} illustration for a presentation slide.`,
    `Topic: ${promptHint}`,
    `Purpose: ${purpose}. ${purposeHint(purpose)}`,
    `Aspect ratio: ${aspectRatio}`,
    `Style guidelines: ${designStyle}`,
    keywords.length ? `Key concepts: ${keywords.join(", ")}` : null,
    "Do not include any text in the image.",
    "No logos, watermarks, captions, or UI chrome.",
  ].filter(Boolean);

  return lines.join("\n").trim() + "\n";
}
