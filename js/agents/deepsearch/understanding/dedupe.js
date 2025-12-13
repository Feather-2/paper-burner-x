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

    kept[dupIndex] = { ...winner, text: collapseWhitespace(winner.text), evidenceIds: mergedEvidenceIds };
  }

  return kept;
}

