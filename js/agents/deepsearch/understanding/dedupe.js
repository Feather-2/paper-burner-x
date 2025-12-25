function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function collapseWhitespace(s) {
  return String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function normalizeForCompare(s) {
  const t = collapseWhitespace(s).toLowerCase();
  return t.replaceAll(/[^\p{L}\p{N}%]+/gu, " ").trim();
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "to",
  "of",
  "in",
  "on",
  "for",
  "with",
  "as",
  "by",
  "at",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "that",
  "this",
  "these",
  "those",
]);

function tokenize(s) {
  const out = [];
  for (const tok of normalizeForCompare(s).split(" ")) {
    if (!tok) continue;
    if (STOPWORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

function setJaccard(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function ngrams(s, n = 3) {
  const t = normalizeForCompare(s).replaceAll(" ", "");
  if (t.length < n) return [];
  const out = [];
  for (let i = 0; i + n <= t.length; i++) out.push(t.slice(i, i + n));
  return out;
}

function similarity(aText, bText) {
  const aNorm = normalizeForCompare(aText);
  const bNorm = normalizeForCompare(bText);
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;
  if (aNorm.length >= 40 && bNorm.length >= 40) {
    if (aNorm.includes(bNorm) || bNorm.includes(aNorm)) return 0.98;
  }

  const tokSim = setJaccard(tokenize(aNorm), tokenize(bNorm));
  const ngSim = setJaccard(ngrams(aNorm, 3), ngrams(bNorm, 3));
  return Math.max(tokSim, ngSim);
}

function importanceRank(importance) {
  const t = String(importance || "")
    .trim()
    .toLowerCase();
  if (t === "core") return 2;
  if (t === "support") return 1;
  return 0;
}

function claimQualityScore(c) {
  const ev = Array.isArray(c?.evidenceIds) ? c.evidenceIds.length : 0;
  return importanceRank(c?.importance) * 10 + ev;
}

function normalizeGapIds(v) {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  return raw.map((x) => String(x || "").trim()).filter(Boolean);
}

/**
 * Deduplicate claims based on overlap/similarity. By default, merges evidenceIds for duplicates.
 *
 * @param {Array<{claimId:string,text:string,importance?:string,evidenceIds:string[]}>} claims
 * @param {{threshold?:number,mergeEvidence?:boolean}=} config
 * @returns {Array<{claimId:string,text:string,importance?:string,evidenceIds:string[]}>}
 */
export function dedupeClaims(claims, config = {}) {
  if (!Array.isArray(claims)) throw new TypeError("dedupeClaims(claims): claims must be an array");
  if (!isPlainObject(config)) throw new TypeError("dedupeClaims(claims, config): config must be an object");

  const threshold = typeof config.threshold === "number" && Number.isFinite(config.threshold) ? Math.min(0.999, Math.max(0.5, config.threshold)) : 0.82;
  const mergeEvidence = config.mergeEvidence !== false;

  /** @type {Array<any>} */
  const kept = [];

  for (const c of claims) {
    if (!c || typeof c.text !== "string") continue;
    if (!Array.isArray(c.evidenceIds) || c.evidenceIds.length < 1) continue;

    let dupIndex = -1;
    let bestSim = 0;
    for (let i = 0; i < kept.length; i++) {
      const sim = similarity(c.text, kept[i].text);
      if (sim >= threshold && sim > bestSim) {
        bestSim = sim;
        dupIndex = i;
      }
    }

    if (dupIndex === -1) {
      kept.push({ ...c, text: collapseWhitespace(c.text) });
      continue;
    }

    const existing = kept[dupIndex];
    const incomingBetter = claimQualityScore(c) > claimQualityScore(existing);
    const winner = incomingBetter ? c : existing;
    const loser = incomingBetter ? existing : c;

    const mergedEvidenceIds = mergeEvidence
      ? Array.from(new Set([...(Array.isArray(winner.evidenceIds) ? winner.evidenceIds : []), ...(Array.isArray(loser.evidenceIds) ? loser.evidenceIds : [])]))
      : Array.isArray(winner.evidenceIds)
        ? winner.evidenceIds.slice()
        : [];

    const mergedGapIds = Array.from(new Set([...normalizeGapIds(winner.gapIds), ...normalizeGapIds(loser.gapIds)]));
    kept[dupIndex] = { ...winner, text: collapseWhitespace(winner.text), evidenceIds: mergedEvidenceIds, ...(mergedGapIds.length ? { gapIds: mergedGapIds } : {}) };
  }

  return kept;
}

/**
 * AI-Native deduplication and synthesis.
 * Instead of simple threshold filtering, it uses the LLM to understand if two claims are semantically identical,
 * or if they should be synthesized into a more comprehensive one.
 *
 * @param {object} stageApi
 * @param {Array<any>} claims
 * @returns {Promise<Array<any>>}
 */
export async function dedupeClaimsAI(stageApi, claims) {
  if (!claims || claims.length < 2) return claims;

  // 1. Group suspects using cheap Jaccard first to reduce token usage
  // We use a lower threshold to capture more potential duplicates for AI to review
  const suspects = [];
  const processed = new Set();

  for (let i = 0; i < claims.length; i++) {
    if (processed.has(i)) continue;
    const cluster = [claims[i]];
    processed.add(i);

    for (let j = i + 1; j < claims.length; j++) {
      if (processed.has(j)) continue;
      // Lower threshold for "potential" overlap
      if (similarity(claims[i].text, claims[j].text) >= 0.6) {
        cluster.push(claims[j]);
        processed.add(j);
      }
    }
    suspects.push(cluster);
  }

  const results = [];
  for (const cluster of suspects) {
    if (cluster.length === 1) {
      results.push(cluster[0]);
      continue;
    }

    // 2. Let AI decide for each cluster
    try {
      const synthesized = await stageApi.runTool("synthesize_claims", {
        claims: cluster.map((c) => ({ id: c.claimId, text: c.text, importance: c.importance })),
      });

      if (synthesized && Array.isArray(synthesized.mergedClaims)) {
        // Map back evidence and gaps
        for (const mc of synthesized.mergedClaims) {
          const originalSources = cluster.filter((c) => mc.sourceIds.includes(c.claimId));
          const evidenceIds = Array.from(new Set(originalSources.flatMap((c) => c.evidenceIds || [])));
          const gapIds = Array.from(new Set(originalSources.flatMap((c) => normalizeGapIds(c.gapIds))));

          results.push({
            ...mc,
            claimId: mc.id || `ai-syn-${Math.random().toString(36).slice(2, 7)}`,
            evidenceIds,
            ...(gapIds.length ? { gapIds } : {}),
          });
        }
      } else {
        // Fallback to traditional dedupe for this cluster if AI fails
        results.push(...dedupeClaims(cluster, { threshold: 0.82 }));
      }
    } catch (e) {
      console.warn("AI Dedupe failed, falling back to algorithmic:", e);
      results.push(...dedupeClaims(cluster, { threshold: 0.82 }));
    }
  }

  return results;
}
