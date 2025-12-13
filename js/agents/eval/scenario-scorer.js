const DIMENSIONS = ["Faithfulness", "Provenance", "Narrative", "Visual", "Editability", "Efficiency"];

// Weights are percentages from docs/agents/evaluation-spec.md (v0.1).
const SCENARIO_WEIGHTS = {
  business: { Faithfulness: 25, Provenance: 10, Narrative: 25, Visual: 25, Editability: 10, Efficiency: 5 },
  academic: { Faithfulness: 20, Provenance: 30, Narrative: 20, Visual: 10, Editability: 15, Efficiency: 5 },
  tech: { Faithfulness: 30, Provenance: 15, Narrative: 20, Visual: 10, Editability: 20, Efficiency: 5 },
  report: { Faithfulness: 25, Provenance: 10, Narrative: 25, Visual: 10, Editability: 15, Efficiency: 15 },
  training: { Faithfulness: 25, Provenance: 10, Narrative: 30, Visual: 15, Editability: 15, Efficiency: 5 },
};

function normalizeScenario(scenario) {
  const s = String(scenario || "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s === "biz" || s === "commercial" || s === "deck") return "business";
  if (s === "research") return "academic";
  if (s === "technical") return "tech";
  if (s === "review" || s === "retro" || s === "postmortem") return "report";
  if (s === "teach" || s === "course") return "training";
  return SCENARIO_WEIGHTS[s] ? s : null;
}

function toScore0to100(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    // Accept both 0..1, 1..5 and 0..100.
    if (v >= 0 && v <= 1) return v * 100;
    if (v >= 1 && v <= 5) return ((v - 1) / 4) * 100;
    if (v >= 0 && v <= 100) return v;
    return Math.max(0, Math.min(100, v));
  }
  const n = Number.parseFloat(String(v));
  return Number.isFinite(n) ? toScore0to100(n) : null;
}

function pickDimensionScore(metrics, dim) {
  if (!metrics || typeof metrics !== "object") return null;
  // Prefer metrics.dimensions.* but allow flatter shapes.
  const v =
    metrics?.dimensions?.[dim] ??
    metrics?.dimensions?.[dim.toLowerCase()] ??
    metrics?.[dim] ??
    metrics?.[dim.toLowerCase()];
  return toScore0to100(v);
}

/**
 * @param {string} scenario business/academic/tech/report/training
 * @param {object} metrics should contain dimension scores (0..100, 1..5 or 0..1)
 * @returns {{score:number, breakdown: {scenario:string, weights:object, dimensions:Array, missing:Array<string>}}}
 */
export function computeScenarioScore(scenario, metrics) {
  const normalized = normalizeScenario(scenario);
  if (!normalized) {
    return {
      score: 0,
      breakdown: { scenario: String(scenario || ""), weights: null, dimensions: [], missing: [...DIMENSIONS] },
    };
  }

  const weights = SCENARIO_WEIGHTS[normalized];
  const dimensions = [];
  const missing = [];
  let weightedSum = 0;
  let totalW = 0;

  for (const dim of DIMENSIONS) {
    const w = weights[dim] || 0;
    const s = pickDimensionScore(metrics, dim);
    if (s === null) missing.push(dim);

    const score = s ?? 0;
    const contrib = (w * score) / 100;
    dimensions.push({ dimension: dim, weight: w, score, contribution: contrib });
    weightedSum += contrib;
    totalW += w;
  }

  const finalScore = totalW > 0 ? weightedSum / (totalW / 100) : 0;
  return {
    score: Math.round(finalScore * 100) / 100,
    breakdown: { scenario: normalized, weights: { ...weights }, dimensions, missing },
  };
}

export const ScenarioScorerConstants = {
  DIMENSIONS,
  SCENARIO_WEIGHTS,
};

