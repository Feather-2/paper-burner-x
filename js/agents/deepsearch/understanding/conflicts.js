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
  "do",
  "does",
  "did",
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

const NEGATIONS = new Set(["not", "no", "never", "none", "cannot", "can't", "doesn't", "isn't", "aren't", "won't", "without", "fails"]);

function stemToken(tok) {
  const t = String(tok || "");
  if (t.length <= 3) return t;
  if (t.endsWith("ies") && t.length > 4) return `${t.slice(0, -3)}y`;
  if (t.endsWith("ing") && t.length > 6) return t.slice(0, -3);
  if (t.endsWith("ed") && t.length > 5) return t.slice(0, -2);
  if (t.endsWith("es") && t.length > 5) return t.slice(0, -2);
  if (t.endsWith("s") && t.length > 4) return t.slice(0, -1);
  return t;
}

function tokenizeTopic(s) {
  const out = [];
  for (const tok of normalizeForCompare(s).split(" ")) {
    if (!tok) continue;
    if (STOPWORDS.has(tok)) continue;
    if (NEGATIONS.has(tok)) continue;
    out.push(stemToken(tok));
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

function topicSimilarity(aText, bText) {
  const a = tokenizeTopic(aText);
  const b = tokenizeTopic(bText);
  return setJaccard(a, b);
}

function polarity(text) {
  const t = normalizeForCompare(text);
  if (!t) return 0;
  const toks = t.split(" ").filter(Boolean);

  let neg = 0;
  for (const tok of toks) if (NEGATIONS.has(tok)) neg++;
  if (neg) return -1;

  const posHints = ["increase", "improve", "higher", "more", "grow", "growth", "faster", "better", "effective"];
  const negHints = ["decrease", "decline", "lower", "less", "worse", "slower", "ineffective", "reduce"];
  for (const h of posHints) if (t.includes(h)) return 1;
  for (const h of negHints) if (t.includes(h)) return -1;

  return 0;
}

function firstNumber(text) {
  const m = String(text || "").match(/(-?\d+(?:\.\d+)?)(%?)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return { value: n, isPercent: m[2] === "%" };
}

/**
 * Detect conflicting claims (same topic, contradictory conclusions).
 *
 * @param {Array<{claimId:string,text:string}>} claims
 * @param {{topicThreshold?:number,numericThreshold?:number}=} config
 * @returns {{conflicts:Array<{claimId1:string,claimId2:string,reason:string}>,openQuestions:Array<{question:string,relatedClaimIds:string[]}>}}
 */
export function detectConflicts(claims, config = {}) {
  if (!Array.isArray(claims)) throw new TypeError("detectConflicts(claims): claims must be an array");
  if (!isPlainObject(config)) throw new TypeError("detectConflicts(claims, config): config must be an object");

  const topicThreshold = typeof config.topicThreshold === "number" && Number.isFinite(config.topicThreshold) ? Math.min(0.95, Math.max(0.2, config.topicThreshold)) : 0.6;
  const numericThreshold =
    typeof config.numericThreshold === "number" && Number.isFinite(config.numericThreshold) ? Math.min(0.98, Math.max(topicThreshold, config.numericThreshold)) : 0.78;

  const conflicts = [];
  const openQuestions = [];

  for (let i = 0; i < claims.length; i++) {
    const a = claims[i];
    if (!a || typeof a.text !== "string" || !a.claimId) continue;
    for (let j = i + 1; j < claims.length; j++) {
      const b = claims[j];
      if (!b || typeof b.text !== "string" || !b.claimId) continue;

      const sim = topicSimilarity(a.text, b.text);
      if (sim < topicThreshold) continue;

      const pa = polarity(a.text);
      const pb = polarity(b.text);
      const aNum = firstNumber(a.text);
      const bNum = firstNumber(b.text);

      let reason = null;
      if (pa !== 0 && pb !== 0 && pa !== pb) reason = "Opposite polarity on a similar topic";
      if (!reason && ((pa < 0 && pb >= 0) || (pb < 0 && pa >= 0)) && sim >= 0.72) reason = "Negation-based contradiction on a similar topic";
      if (!reason && aNum && bNum && sim >= numericThreshold) {
        const aV = aNum.value;
        const bV = bNum.value;
        const diff = Math.abs(aV - bV);
        const rel = diff / Math.max(1e-9, Math.abs(aV), Math.abs(bV));
        if (diff >= 1 && rel >= 0.05) reason = "Different numeric value on a similar topic";
      }

      if (!reason) continue;

      conflicts.push({ claimId1: String(a.claimId), claimId2: String(b.claimId), reason });
      openQuestions.push({
        question: `Resolve contradiction between claims ${String(a.claimId)} and ${String(b.claimId)}.`,
        relatedClaimIds: [String(a.claimId), String(b.claimId)],
      });
    }
  }

  return { conflicts, openQuestions };
}
