function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function collapseWhitespace(s) {
  return String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function clampText(s, maxLen) {
  const t = collapseWhitespace(s);
  if (!t) return "";
  return t.length <= maxLen ? t : t.slice(0, maxLen).trim();
}

function evidenceKey(e) {
  const sourceId = toNonEmptyString(e?.sourceId) || "source_unknown";
  const start = typeof e?.locator?.charStart === "number" ? e.locator.charStart : 0;
  const end = typeof e?.locator?.charEnd === "number" ? e.locator.charEnd : 0;
  return `${sourceId}:${start}:${end}`;
}

function retrievedKey(r) {
  const sourceId = toNonEmptyString(r?.sourceId) || "source_unknown";
  const start = typeof r?.locator?.charStart === "number" ? r.locator.charStart : 0;
  const end = typeof r?.locator?.charEnd === "number" ? r.locator.charEnd : 0;
  return `${sourceId}:${start}:${end}`;
}

function buildEvidenceReferences(evidenceLedger) {
  const locatorKeys = new Set();
  const chunkIds = new Set();
  for (const e of safeArray(evidenceLedger)) {
    locatorKeys.add(evidenceKey(e));
    const cid = toNonEmptyString(e?.chunkId);
    if (cid) chunkIds.add(cid);
  }
  return { locatorKeys, chunkIds };
}

function groupEvidencesIntoSections(evidences, { maxPerSection = 3, maxGapChars = 800 } = {}) {
  const sorted = safeArray(evidences)
    .filter((e) => e && typeof e === "object")
    .slice()
    .sort((a, b) => (a?.locator?.charStart || 0) - (b?.locator?.charStart || 0));

  const sections = [];
  let cur = null;

  for (const e of sorted) {
    const s = typeof e?.locator?.charStart === "number" ? e.locator.charStart : 0;
    const en = typeof e?.locator?.charEnd === "number" ? e.locator.charEnd : s;

    if (!cur) {
      cur = { evidences: [e], charStart: s, charEnd: en };
      continue;
    }

    const gap = Math.max(0, s - (cur.charEnd || 0));
    if (cur.evidences.length >= maxPerSection || gap > maxGapChars) {
      sections.push(cur);
      cur = { evidences: [e], charStart: s, charEnd: en };
      continue;
    }

    cur.evidences.push(e);
    cur.charEnd = Math.max(cur.charEnd || 0, en);
  }

  if (cur) sections.push(cur);
  return sections;
}

function claimsByEvidenceId(claims) {
  const map = new Map(); // evidenceId -> claim[]
  for (const c of safeArray(claims)) {
    const evIds = safeArray(c?.evidenceIds).map(toNonEmptyString).filter(Boolean);
    for (const id of evIds) {
      const arr = map.get(id) || [];
      arr.push(c);
      map.set(id, arr);
    }
  }
  return map;
}

function deriveSectionSummary({ evidences, claimIndex, maxLen = 240 } = {}) {
  const claimTexts = [];
  for (const e of safeArray(evidences)) {
    const evId = toNonEmptyString(e?.evidenceId);
    if (!evId) continue;
    for (const c of safeArray(claimIndex?.get(evId))) {
      const t = collapseWhitespace(c?.text);
      if (t) claimTexts.push(t);
    }
  }

  const uniqueClaims = [...new Set(claimTexts)].slice(0, 3);
  if (uniqueClaims.length) return clampText(uniqueClaims.join("；"), maxLen);

  const quoteTexts = safeArray(evidences)
    .map((e) => clampText(e?.quote, 120))
    .filter(Boolean)
    .slice(0, 2);
  return clampText(quoteTexts.join(" / "), maxLen);
}

function deriveDocumentSummary({ sections, maxLen = 360 } = {}) {
  const parts = safeArray(sections)
    .map((s) => clampText(s?.summary, 200))
    .filter(Boolean)
    .slice(0, 4);
  return clampText(parts.join(" "), maxLen);
}

function buildCondensedMemory(state) {
  const runId = toNonEmptyString(state?.runId) || "run_unknown";
  const sources = safeArray(state?.L0?.sources);
  const claims = safeArray(state?.L1?.claims);
  const evidenceLedger = safeArray(state?.L1?.evidenceLedger);
  const scanSummary = state?.L1?.scanSummary || null;

  const claimIndex = claimsByEvidenceId(claims);

  const evidencesBySource = new Map();
  for (const e of evidenceLedger) {
    const sourceId = toNonEmptyString(e?.sourceId) || "source_unknown";
    const arr = evidencesBySource.get(sourceId) || [];
    arr.push(e);
    evidencesBySource.set(sourceId, arr);
  }

  const documents = [];
  for (const s of sources) {
    const sourceId = toNonEmptyString(s?.sourceId) || "source_unknown";
    const title = toNonEmptyString(s?.title) || sourceId;
    const evidences = evidencesBySource.get(sourceId) || [];
    const buckets = groupEvidencesIntoSections(evidences);

    const sections = buckets.map((b, i) => {
      const sectionId = `sec_${sourceId}_${i + 1}`;
      const evidenceIds = b.evidences.map((e) => toNonEmptyString(e?.evidenceId)).filter(Boolean);
      const claimIds = [];
      for (const evId of evidenceIds) {
        for (const c of safeArray(claimIndex.get(evId))) {
          const id = toNonEmptyString(c?.claimId);
          if (id) claimIds.push(id);
        }
      }
      return {
        sectionId,
        range: { charStart: b.charStart, charEnd: b.charEnd },
        evidenceIds,
        claimIds: [...new Set(claimIds)],
        summary: deriveSectionSummary({ evidences: b.evidences, claimIndex }),
      };
    });

    const docSummary = deriveDocumentSummary({ sections });

    documents.push({
      sourceId,
      title,
      sectionCount: sections.length,
      evidenceCount: evidences.length,
      summary: docSummary,
      sections,
    });
  }

  const keyClaims = claims
    .map((c) => ({ claimId: toNonEmptyString(c?.claimId), text: clampText(c?.text, 220), evidenceIds: safeArray(c?.evidenceIds).map(toNonEmptyString).filter(Boolean) }))
    .filter((c) => c.claimId && c.text)
    .slice(0, 10);

  const overallSummary =
    clampText(
      documents
        .map((d) => d.summary)
        .filter(Boolean)
        .join(" "),
      520
    ) ||
    clampText(scanSummary?.summaryText, 520) ||
    clampText(keyClaims.map((c) => c.text).join("；"), 520);

  return {
    schemaVersion: "0.1",
    runId,
    generatedAt: new Date().toISOString(),
    summary: overallSummary,
    overallSummary,
    documents,
    keyClaims,
    stats: {
      documentCount: documents.length,
      claimCount: claims.length,
      evidenceCount: evidenceLedger.length,
    },
  };
}

function pickL1Preserved(L1) {
  const l1 = isPlainObject(L1) ? L1 : {};
  return {
    claims: safeArray(l1.claims),
    evidenceLedger: safeArray(l1.evidenceLedger),
    dataTables: safeArray(l1.dataTables),
    slideIntents: safeArray(l1.slideIntents),
    conflicts: safeArray(l1.conflicts),
    condensed_summary: toNonEmptyString(l1.condensed_summary) || toNonEmptyString(l1.condensedSummary),
  };
}

/**
 * S7 Condense & Cache: drop L2 temporary memory, preserve L1 products, build condensedMemory.
 * Mutates the provided DeepSearchState-like object.
 * @param {object} state DeepSearchState
 * @returns {{condensedMemory:object,l1Preserved:object,l2Cleared:object}}
 */
export function condenseDeepSearchState(state) {
  if (!state || typeof state !== "object") throw new TypeError("condenseDeepSearchState(state): state must be an object");
  if (!isPlainObject(state.L1)) state.L1 = {};
  if (!isPlainObject(state.L2)) state.L2 = {};

  const l1Preserved = pickL1Preserved(state.L1);

  const evidenceLedger = safeArray(state?.L1?.evidenceLedger);
  const referenced = buildEvidenceReferences(evidenceLedger);

  const beforeChunks = safeArray(state?.L2?.retrievedChunks);
  const kept = beforeChunks.filter((c) => {
    const cid = toNonEmptyString(c?.chunkId);
    if (cid && referenced.chunkIds.has(cid)) return true;
    return referenced.locatorKeys.has(retrievedKey(c));
  });

  const beforeConsumed = beforeChunks.filter((c) => c && typeof c === "object" && c.consumed).length;
  const keptConsumed = kept.filter((c) => c && typeof c === "object" && c.consumed).length;

  const l2Cleared = {
    retrievedChunks: {
      before: beforeChunks.length,
      after: kept.length,
      removed: Math.max(0, beforeChunks.length - kept.length),
      removedConsumed: Math.max(0, beforeConsumed - keptConsumed),
    },
    scratchpadCleared: Object.keys(isPlainObject(state.L2.scratchpad) ? state.L2.scratchpad : {}).length > 0,
    logsCleared: safeArray(state.L2.logs).length > 0,
    removedFields: [],
  };

  state.L2.retrievedChunks = kept;
  state.L2.scratchpad = {};
  state.L2.logs = [];

  for (const k of ["failedRetrievalLogs", "failedRetrievals", "embeddings", "oneTimeEmbeddings", "retrievalFailures"]) {
    if (k in state.L2) {
      delete state.L2[k];
      l2Cleared.removedFields.push(k);
    }
  }

  const condensedMemory = buildCondensedMemory(state);
  state.L1.condensedMemory = condensedMemory;

  return { condensedMemory, l1Preserved, l2Cleared };
}
