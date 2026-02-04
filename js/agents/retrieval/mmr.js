/** @type {number} Default lambda for MMR diversity (0.7 = relevance-heavy) */
export const DEFAULT_MMR_LAMBDA = 0.7;

/** @type {number} Default max tokens for similarity computation */
export const DEFAULT_MMR_MAX_TOKENS = 200;

let _mmrSegmenter = null;

function getMmrSegmenter() {
  if (_mmrSegmenter !== null) return _mmrSegmenter;
  try {
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      _mmrSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
      return _mmrSegmenter;
    }
  } catch {
    // ignore
  }
  _mmrSegmenter = undefined;
  return _mmrSegmenter;
}

function mmrWordRegex() {
  try {
    // eslint-disable-next-line no-new
    new RegExp("\\p{L}", "u");
    return /[\p{L}\p{N}]+/gu;
  } catch {
    return /[A-Za-z0-9]+|[\u4e00-\u9fff]+|[\u3040-\u30ff]+|[\uac00-\ud7af]+/g;
  }
}

const MMR_WORD_RE = mmrWordRegex();

function tokenizeForSimilarity(text, { maxTokens = 200 } = {}) {
  const s = String(text || "").toLowerCase();
  if (!s) return [];

  const max = Number.isFinite(maxTokens) ? Math.max(10, Math.floor(maxTokens)) : 200;
  const seg = getMmrSegmenter();
  const out = [];
  const seen = new Set();

  const push = (t) => {
    if (!t) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  if (seg && typeof seg.segment === "function") {
    for (const part of seg.segment(s)) {
      if (out.length >= max) break;
      if (part && part.isWordLike === false) continue;
      const t = String(part?.segment || "").trim().toLowerCase();
      if (!t) continue;
      push(t);
    }
    return out;
  }

  const tokens = s.match(MMR_WORD_RE) || [];
  for (const t of tokens) {
    if (out.length >= max) break;
    push(t);
  }
  return out;
}

function jaccardSimilarity(aTokens, bTokens) {
  const a = Array.isArray(aTokens) ? aTokens : [];
  const b = Array.isArray(bTokens) ? bTokens : [];
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0 || b.length === 0) return 0;

  const setA = new Set(a);
  let inter = 0;
  for (const t of b) {
    if (setA.has(t)) inter += 1;
  }
  const union = setA.size + new Set(b).size - inter;
  return union > 0 ? inter / union : 0;
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * @typedef {object} MmrSelectOptions
 * @property {number} [topK]
 * @property {number} [lambda]
 * @property {any[]} [seed]
 * @property {number} [maxTokens]
 */

/**
 * @param {any[]} candidates
 * @param {MmrSelectOptions} [options]
 */
export function mmrSelect(candidates, { topK, lambda = DEFAULT_MMR_LAMBDA, seed = [], maxTokens = DEFAULT_MMR_MAX_TOKENS } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const k = Number.isFinite(topK) ? Math.max(0, Math.floor(topK)) : list.length;
  if (k <= 0) return [];
  if (list.length <= 1) return list.slice(0, k);

  const l = clamp01(lambda === undefined ? DEFAULT_MMR_LAMBDA : lambda);

  const selected = [];
  const selectedIds = new Set();

  for (const item of Array.isArray(seed) ? seed : []) {
    if (!item) continue;
    const id = String(item.chunkId || "");
    if (!id || selectedIds.has(id)) continue;
    selected.push(item);
    selectedIds.add(id);
    if (selected.length >= k) return selected.slice(0, k);
  }

  const byId = new Map();
  for (const c of list) {
    if (!c) continue;
    const id = String(c.chunkId || "");
    if (!id) continue;
    if (!byId.has(id)) byId.set(id, c);
  }

  const tokenCache = new Map(); // chunkId -> tokens[]
  const getTokens = (row) => {
    const id = String(row?.chunkId || "");
    if (!id) return [];
    if (tokenCache.has(id)) return tokenCache.get(id);
    const toks = tokenizeForSimilarity(row?.text || "", { maxTokens });
    tokenCache.set(id, toks);
    return toks;
  };

  const remaining = () => Array.from(byId.values()).filter((c) => !selectedIds.has(String(c.chunkId)));

  while (selected.length < k) {
    const pool = remaining();
    if (pool.length === 0) break;

    if (selected.length === 0) {
      pool.sort((a, b) => (b.score || 0) - (a.score || 0));
      const best = pool[0];
      selected.push(best);
      selectedIds.add(String(best.chunkId));
      continue;
    }

    let best = null;
    let bestScore = -Infinity;
    for (const cand of pool) {
      const rel = typeof cand.score === "number" && Number.isFinite(cand.score) ? cand.score : 0;
      const candTokens = getTokens(cand);
      let maxSim = 0;
      for (const sel of selected) {
        const sim = jaccardSimilarity(candTokens, getTokens(sel));
        if (sim > maxSim) maxSim = sim;
      }
      const mmr = l * rel - (1 - l) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        best = cand;
      }
    }
    if (!best) break;
    selected.push(best);
    selectedIds.add(String(best.chunkId));
  }

  return selected.slice(0, k);
}

export default {
  DEFAULT_MMR_LAMBDA,
  DEFAULT_MMR_MAX_TOKENS,
  mmrSelect,
};

