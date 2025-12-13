function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function collapseWhitespace(s) {
  return String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function pickEvidenceSpan(text, { maxLen = 220 } = {}) {
  const t = String(text || "");
  if (!t.length) return null;

  let start = 0;
  while (start < t.length && /\s/.test(t[start])) start++;
  if (start >= t.length) return null;

  let end = Math.min(t.length, start + maxLen);

  const window = t.slice(start, end);
  const m = window.match(/[。！？.!?](?=\s|$)/);
  if (m && typeof m.index === "number" && m.index >= 40) end = start + m.index + 1;

  if (end <= start) return null;
  return { relStart: start, relEnd: end };
}

function importanceFromRank(rank) {
  if (rank <= 0) return "support";
  if (rank === 1) return "core";
  return "support";
}

/**
 * Extract minimal claim units from RetrievedChunk[] (S5 seed extractor).
 *
 * @param {Array<{chunkId:string,sourceId:string,locator:{charStart:number,charEnd:number},text:string,score?:number}>} retrievedChunks
 * @param {{maxClaims?:number,maxQuoteLen?:number}=} options
 * @returns {{claims:Array<{claimId:string,text:string,importance:string,evidenceIds:string[]}>,evidences:Array<{evidenceId:string,chunkId:string,sourceId:string,locator:{charStart:number,charEnd:number},quote:string}>}}
 */
export function claimsFromChunks(retrievedChunks, options = {}) {
  if (!Array.isArray(retrievedChunks)) throw new TypeError("claimsFromChunks(retrievedChunks): retrievedChunks must be an array");
  if (!isPlainObject(options)) throw new TypeError("claimsFromChunks(retrievedChunks, options): options must be an object");

  const maxQuoteLen = Number.isFinite(options.maxQuoteLen) ? Math.max(40, Math.floor(options.maxQuoteLen)) : 220;
  const maxClaims = Number.isFinite(options.maxClaims) ? Math.max(0, Math.floor(options.maxClaims)) : retrievedChunks.length;

  const rows = retrievedChunks
    .map((r, idx) => {
      const chunkId = String(r?.chunkId || `chunk_${idx + 1}`);
      const sourceId = String(r?.sourceId || "source_unknown");
      const charStart = safeInt(r?.locator?.charStart);
      const charEnd = safeInt(r?.locator?.charEnd);
      const text = typeof r?.text === "string" ? r.text : "";
      const score = typeof r?.score === "number" && Number.isFinite(r.score) ? r.score : null;
      return { chunkId, sourceId, locator: { charStart, charEnd }, text, score };
    })
    .filter((r) => typeof r.locator.charStart === "number" && typeof r.locator.charEnd === "number" && r.locator.charStart < r.locator.charEnd && r.text);

  const ranked = rows.slice().sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const coreChunkId = ranked.length ? ranked[0].chunkId : null;

  const claims = [];
  const evidences = [];

  for (const r of rows) {
    if (claims.length >= maxClaims) break;
    const span = pickEvidenceSpan(r.text, { maxLen: maxQuoteLen });
    if (!span) continue;

    const quote = r.text.slice(span.relStart, span.relEnd);
    const text = collapseWhitespace(quote);
    if (!text) continue;

    const evidenceId = `e_${evidences.length + 1}`;
    const claimId = `c_${claims.length + 1}`;

    evidences.push({
      evidenceId,
      chunkId: r.chunkId,
      sourceId: r.sourceId,
      locator: { charStart: r.locator.charStart, charEnd: r.locator.charEnd },
      quote,
    });

    const isCore = coreChunkId && r.chunkId === coreChunkId;
    claims.push({
      claimId,
      text,
      importance: importanceFromRank(isCore ? 1 : 0),
      evidenceIds: [evidenceId],
    });
  }

  return { claims, evidences };
}

