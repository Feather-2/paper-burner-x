import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";
import { claimsFromChunks } from "../../deepsearch/understanding/claims-from-chunks.js";
import { dedupeClaims } from "../../deepsearch/understanding/dedupe.js";
import { detectConflicts } from "../../deepsearch/understanding/conflicts.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function normalizeGapIds(v) {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  return Array.from(new Set(raw.map((x) => String(x || "").trim()).filter(Boolean)));
}

async function tryLLMClaimEdits(state, claims, evidenceLedger, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "analyst" });
  if (!callModel) return null;

  const evidenceById = new Map();
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    if (!e || !toNonEmptyString(e?.evidenceId)) continue;
    evidenceById.set(String(e.evidenceId), { quote: String(e.quote || ""), sourceId: String(e.sourceId || ""), gapIds: normalizeGapIds(e.gapIds) });
  }

  const messages = [
    {
      role: "system",
      content:
        "You are a DeepSearch claim extractor. Improve the provided draft claims for PPT use.\n" +
        "Return ONLY JSON: {claims:[{claimId,text,importance}]}. importance must be 'core' or 'support'.\n" +
        "Do not invent facts; only rephrase/summarize what's supported by the evidence quotes.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          taskGoal: String(state?.taskGoal || ""),
          draftClaims: (Array.isArray(claims) ? claims : []).map((c) => ({
            claimId: c?.claimId,
            text: c?.text,
            importance: c?.importance,
            evidence: (Array.isArray(c?.evidenceIds) ? c.evidenceIds : [])
              .map((eid) => {
                const row = evidenceById.get(String(eid));
                return row ? { evidenceId: String(eid), ...row } : { evidenceId: String(eid) };
              })
              .slice(0, 3),
          })),
        },
        null,
        2
      ),
    },
  ];

  try {
    const result = await callModel(messages, { model: "auto", temperature: 0.2, maxTokens: 900 });
    const candidate = extractJsonCandidate(result?.content);
    if (!candidate) return null;
    const parsed = JSON.parse(candidate);
    if (!isPlainObject(parsed) || !Array.isArray(parsed.claims)) return null;
    return parsed.claims;
  } catch {
    return null;
  }
}

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch understand: input.state is required");
}

function indexSourceTextById(sources) {
  const m = new Map();
  for (const s of Array.isArray(sources) ? sources : []) {
    const id = toNonEmptyString(s?.sourceId);
    if (!id) continue;
    if (typeof s?.sourceTextNormalized === "string") m.set(id, s.sourceTextNormalized);
  }
  return m;
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

function quoteFromSourceLocator(sourceTextNormalized, locator, { maxQuoteLen = 220 } = {}) {
  const text = String(sourceTextNormalized || "");
  const baseStart = safeInt(locator?.charStart);
  const baseEnd = safeInt(locator?.charEnd);
  if (baseStart === null || baseEnd === null) throw new Error("Hard gate H2 failed: evidence locator must include charStart/charEnd");
  if (!(baseStart < baseEnd)) throw new Error("Hard gate H2 failed: evidence locator must satisfy charStart < charEnd");
  if (baseStart < 0 || baseEnd > text.length) throw new Error("Hard gate H2 failed: evidence locator out of source bounds");

  const slice = text.slice(baseStart, baseEnd);
  const span = pickEvidenceSpan(slice, { maxLen: maxQuoteLen });
  if (!span) throw new Error("Hard gate H3 failed: unable to derive non-empty quote from locator slice");

  const charStart = baseStart + span.relStart;
  const charEnd = baseStart + span.relEnd;
  const quote = text.slice(charStart, charEnd);
  if (!quote) throw new Error("Hard gate H3 failed: evidence.quote must be non-empty");
  return { locator: { charStart, charEnd }, quote };
}

export function computeGapFill(gaps, { claims, evidenceLedger } = {}) {
  const gapList = Array.isArray(gaps) ? gaps : [];
  const filled = new Set();

  for (const c of Array.isArray(claims) ? claims : []) {
    for (const gid of normalizeGapIds(c?.gapIds)) filled.add(gid);
  }
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    for (const gid of normalizeGapIds(e?.gapIds)) filled.add(gid);
  }

  const filledGapIds = [];
  const remainingGaps = [];
  for (const g of gapList) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid) continue;
    if (filled.has(gid)) filledGapIds.push(gid);
    else remainingGaps.push(g);
  }
  return { filledGapIds, remainingGaps };
}

function assertHardGates({ sources, sourceTextById, claims, evidenceLedger, retrievedByChunkId }) {
  const evidenceById = new Map();
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    if (!e || !toNonEmptyString(e.evidenceId)) continue;
    evidenceById.set(String(e.evidenceId), e);
  }

  // H1 + evidence references resolvable (H4)
  for (const c of Array.isArray(claims) ? claims : []) {
    if (!c || !Array.isArray(c.evidenceIds) || c.evidenceIds.length < 1) {
      throw new Error("Hard gate H1 failed: claims[].evidenceIds.length must be >= 1");
    }
    for (const eid of c.evidenceIds) {
      if (!evidenceById.has(String(eid))) throw new Error(`Hard gate H4 failed: Unresolvable evidenceId reference: ${String(eid)}`);
    }
  }

  // H2 + H3 + H4 for evidence items
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    if (!e) continue;
    const evidenceId = toNonEmptyString(e?.evidenceId) || "(missing_evidenceId)";
    const sourceId = toNonEmptyString(e?.sourceId);
    if (!sourceId) throw new Error("Hard gate H4 failed: evidence.sourceId is required");
    if (!Array.isArray(sources) || !sources.some((s) => toNonEmptyString(s?.sourceId) === sourceId)) {
      throw new Error(`Hard gate H4 failed: Unresolvable sourceId reference for evidence ${String(evidenceId)}: ${String(sourceId)}`);
    }

    const chunkId = toNonEmptyString(e?.chunkId);
    if (!chunkId || !retrievedByChunkId.has(String(chunkId))) {
      throw new Error(`Hard gate H4 failed: Unresolvable chunkId reference for evidence ${String(evidenceId)}: ${String(chunkId || "")}`);
    }

    const locator = e?.locator;
    const charStart = safeInt(locator?.charStart);
    const charEnd = safeInt(locator?.charEnd);
    if (charStart === null || charEnd === null) throw new Error("Hard gate H2 failed: evidenceLedger[].locator must include charStart/charEnd");
    if (!(charStart < charEnd)) throw new Error("Hard gate H2 failed: evidenceLedger[].locator.charStart must be < charEnd");

    const quote = String(e?.quote || "");
    if (!quote) throw new Error("Hard gate H3 failed: evidence.quote must be non-empty");

    const sourceText = sourceTextById.get(sourceId);
    if (typeof sourceText !== "string") throw new Error(`Hard gate H4 failed: sourceTextNormalized missing for sourceId: ${String(sourceId)}`);
    if (charStart < 0 || charEnd > sourceText.length) throw new Error("Hard gate H2 failed: evidence locator out of bounds");
    const slice = sourceText.slice(charStart, charEnd);
    if (slice !== quote) throw new Error("Hard gate H3 failed: evidence.quote must exactly match sourceTextNormalized at locator");
  }
}

/**
 * S5 Understanding wrapper (placeholder): convert retrievedChunks to claims[] + evidenceLedger[].
 * @param {object} runContext
 * @param {DeepSearchState|{state:DeepSearchState|object}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function}=} stageApi
 */
export async function runDeepSearchUnderstandStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);

  checkCancelled(stageApi);
  const retrieved = Array.isArray(state?.L2?.retrievedChunks) ? state.L2.retrievedChunks : [];
  const sourceTextById = indexSourceTextById(state?.L0?.sources);

  const understandingConfig = isPlainObject(state?.userConfig?.understanding) ? state.userConfig.understanding : {};
  const maxQuoteLen = Number.isFinite(understandingConfig.maxQuoteLen) ? Math.max(60, Math.floor(understandingConfig.maxQuoteLen)) : 220;
  const dedupeThreshold =
    typeof understandingConfig.dedupeThreshold === "number" && Number.isFinite(understandingConfig.dedupeThreshold)
      ? understandingConfig.dedupeThreshold
      : 0.82;

  const { claims: seedClaims, evidences: seedEvidences } = claimsFromChunks(retrieved, { maxQuoteLen });
  const claims = dedupeClaims(seedClaims, { threshold: dedupeThreshold, mergeEvidence: true });

  const referencedEvidenceIds = new Set();
  for (const c of claims) for (const eid of Array.isArray(c?.evidenceIds) ? c.evidenceIds : []) referencedEvidenceIds.add(String(eid));

  const retrievedByChunkId = new Map();
  for (const r of retrieved) {
    const cid = toNonEmptyString(r?.chunkId);
    if (cid) retrievedByChunkId.set(cid, r);
  }

  const evidenceLedger = [];
  for (const e of Array.isArray(seedEvidences) ? seedEvidences : []) {
    if (!e || !referencedEvidenceIds.has(String(e.evidenceId))) continue;

    const sourceId = toNonEmptyString(e?.sourceId) || "source_unknown";
    const sourceText = sourceTextById.get(sourceId);
    if (typeof sourceText !== "string") {
      throw new Error(`Hard gate H4 failed: sourceTextNormalized missing for sourceId: ${String(sourceId)}`);
    }

    const derived = quoteFromSourceLocator(sourceText, e.locator, { maxQuoteLen });
    const retrievedRow = retrievedByChunkId.get(String(e.chunkId));
    const gapIds = normalizeGapIds(retrievedRow?.matchedGapIds || retrievedRow?.gapId);
    evidenceLedger.push({
      evidenceId: String(e.evidenceId),
      chunkId: String(e.chunkId),
      sourceId: String(sourceId),
      locator: derived.locator,
      quote: derived.quote,
      gapIds,
    });
  }

  const evidenceGapIdsById = new Map();
  for (const e of evidenceLedger) {
    const eid = toNonEmptyString(e?.evidenceId);
    if (!eid) continue;
    evidenceGapIdsById.set(eid, normalizeGapIds(e?.gapIds));
  }

  for (const c of claims) {
    const gapIds = [];
    for (const eid of Array.isArray(c?.evidenceIds) ? c.evidenceIds : []) {
      for (const gid of evidenceGapIdsById.get(String(eid)) || []) gapIds.push(gid);
    }
    c.gapIds = Array.from(new Set(gapIds));
  }

  const claimEdits = await tryLLMClaimEdits(state, claims, evidenceLedger, stageApi);
  if (Array.isArray(claimEdits) && claimEdits.length) {
    const claimById = new Map(claims.map((c) => [String(c?.claimId || ""), c]).filter(([id]) => id));
    for (const edit of claimEdits) {
      if (!isPlainObject(edit)) continue;
      const id = toNonEmptyString(edit?.claimId);
      if (!id) continue;
      const row = claimById.get(id);
      if (!row) continue;
      const text = toNonEmptyString(edit?.text);
      if (text) row.text = text;
      const importance = toNonEmptyString(edit?.importance);
      if (importance === "core" || importance === "support") row.importance = importance;
    }
  }

  const { conflicts, openQuestions: conflictQuestions } = detectConflicts(claims, {
    topicThreshold: typeof understandingConfig.conflictTopicThreshold === "number" ? understandingConfig.conflictTopicThreshold : 0.6,
    numericThreshold: typeof understandingConfig.conflictNumericThreshold === "number" ? understandingConfig.conflictNumericThreshold : 0.78,
  });

  const openQuestions = [];
  let qn = 0;
  for (const q of Array.isArray(conflictQuestions) ? conflictQuestions : []) {
    if (!q || typeof q.question !== "string") continue;
    qn++;
    openQuestions.push({
      questionId: `q_${qn}`,
      status: "open",
      question: q.question,
      text: q.question, // backward-compatible alias
      relatedClaimIds: Array.isArray(q.relatedClaimIds) ? q.relatedClaimIds.slice() : [],
    });
  }
  if (!claims.length) {
    qn++;
    openQuestions.push({
      questionId: `q_${qn}`,
      status: "open",
      question: "Insufficient retrieved evidence; consider adding sources or refining the taskGoal.",
      text: "Insufficient retrieved evidence; consider adding sources or refining the taskGoal.",
      relatedClaimIds: [],
    });
  }

  assertHardGates({
    sources: Array.isArray(state?.L0?.sources) ? state.L0.sources : [],
    sourceTextById,
    claims,
    evidenceLedger,
    retrievedByChunkId,
  });

  state.L1.claims = claims;
  state.L1.evidenceLedger = evidenceLedger;
  state.L1.conflicts = conflicts;
  state.L1.openQuestions = openQuestions;
  state.addTimeline({
    name: "deepsearch.understand",
    status: "completed",
    payload: { claimCount: claims.length, evidenceCount: evidenceLedger.length, conflictCount: conflicts.length, openQuestionCount: openQuestions.length },
  });

  emit?.("deepsearch.understand.completed", {
    claimCount: claims.length,
    evidenceCount: evidenceLedger.length,
    conflictCount: conflicts.length,
    openQuestionCount: openQuestions.length,
  });
  return { state, claims, evidenceLedger, conflicts, openQuestions };
}
