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
 * @param {{maxClaims?:number,maxQuoteLen?:number,minScore?:number}=} options
 * @returns {{claims:Array<{claimId:string,text:string,importance:string,evidenceIds:string[]}>,evidences:Array<{evidenceId:string,chunkId:string,sourceId:string,locator:{charStart:number,charEnd:number},quote:string}>}}
 */
export function claimsFromChunks(retrievedChunks, options = {}) {
  if (!Array.isArray(retrievedChunks)) throw new TypeError("claimsFromChunks(retrievedChunks): retrievedChunks must be an array");
  if (!isPlainObject(options)) throw new TypeError("claimsFromChunks(retrievedChunks, options): options must be an object");

  const maxQuoteLen = Number.isFinite(options.maxQuoteLen) ? Math.max(40, Math.floor(options.maxQuoteLen)) : 220;
  const maxClaims = Number.isFinite(options.maxClaims) ? Math.max(0, Math.floor(options.maxClaims)) : retrievedChunks.length;
  // 最低相关性分数阈值 - 默认 0（不过滤），因为 BM25 分数可能很低但仍然有效
  const minScore = typeof options.minScore === "number" && Number.isFinite(options.minScore) ? options.minScore : 0;

  const mapped = retrievedChunks.map((r, idx) => {
    const chunkId = String(r?.chunkId || `chunk_${idx + 1}`);
    const sourceId = String(r?.sourceId || "source_unknown");
    const charStart = safeInt(r?.locator?.charStart);
    const charEnd = safeInt(r?.locator?.charEnd);
    const text = typeof r?.text === "string" ? r.text : "";
    const score = typeof r?.score === "number" && Number.isFinite(r.score) ? r.score : null;
    return { chunkId, sourceId, locator: { charStart, charEnd }, text, score };
  });

  const withValidLocator = mapped.filter(
    (r) => typeof r.locator.charStart === "number" && typeof r.locator.charEnd === "number" && r.locator.charStart < r.locator.charEnd && r.text
  );

  // 只在 minScore > 0 时过滤低质量结果
  const rows = minScore > 0 ? withValidLocator.filter((r) => r.score === null || r.score >= minScore) : withValidLocator;

  // 调试日志
  if (retrievedChunks.length > 0 && rows.length === 0) {
    console.warn("[claimsFromChunks] All chunks filtered out:", {
      input: retrievedChunks.length,
      afterMap: mapped.length,
      afterLocatorFilter: withValidLocator.length,
      afterScoreFilter: rows.length,
      minScore,
      sampleLocators: mapped.slice(0, 3).map((r) => ({ charStart: r.locator.charStart, charEnd: r.locator.charEnd, hasText: !!r.text })),
      sampleScores: mapped.slice(0, 3).map((r) => r.score),
    });
  }

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

