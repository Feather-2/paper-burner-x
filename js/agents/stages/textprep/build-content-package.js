// TP6: Assemble ContentPackage v0.1 (TextPrep mode) + validate Hard Gates (H1-H4).

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function toStringPreserveWhitespace(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  return String(v);
}

function collapseWhitespace(s) {
  return String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function deriveSummary(sourceTextNormalized, claims) {
  const c = Array.isArray(claims) ? claims : [];
  const top = c
    .map((x) => toNonEmptyString(x?.text))
    .filter(Boolean)
    .slice(0, 3);
  if (top.length) return top.join("；");
  return collapseWhitespace(sourceTextNormalized || "").slice(0, 280);
}

function indexById(arr, idKey) {
  const map = new Map();
  for (const it of Array.isArray(arr) ? arr : []) {
    const id = toNonEmptyString(it?.[idKey]);
    if (!id) continue;
    if (!map.has(id)) map.set(id, it);
  }
  return map;
}

function assertHardGates({ sources, claims, evidenceLedger, slideIntents, dataTables }) {
  // Build sourceTextNormalized lookup for H3 validation.
  const sourceTextById = new Map();
  for (const s of Array.isArray(sources) ? sources : []) {
    const sid = toNonEmptyString(s?.sourceId);
    if (!sid) continue;
    // Do not trim: evidence locators are defined against sourceTextNormalized.
    const t = toStringPreserveWhitespace(s?.sourceTextNormalized);
    if (typeof t === "string") sourceTextById.set(sid, t);
  }

  const evidenceById = indexById(evidenceLedger, "evidenceId");
  const claimById = indexById(claims, "claimId");
  const tableById = indexById(dataTables, "tableId");

  // H1 + evidence references exist
  for (const c of Array.isArray(claims) ? claims : []) {
    if (!c || !Array.isArray(c.evidenceIds) || c.evidenceIds.length < 1) {
      throw new Error("Hard gate H1 failed: claims[].evidenceIds.length must be >= 1");
    }
    for (const eid of c.evidenceIds) {
      if (!evidenceById.has(String(eid))) throw new Error(`Hard gate H4 failed: Unresolvable evidenceId reference: ${String(eid)}`);
    }
  }

  // H2 + H3 for evidence items
  for (const e of Array.isArray(evidenceLedger) ? evidenceLedger : []) {
    const locator = e?.locator;
    const charStart = locator?.charStart;
    const charEnd = locator?.charEnd;
    if (!(typeof charStart === "number" && typeof charEnd === "number")) {
      throw new Error("Hard gate H2 failed: evidenceLedger[].locator must include charStart/charEnd");
    }
    if (!(charStart < charEnd)) {
      throw new Error("Hard gate H2 failed: evidenceLedger[].locator.charStart must be < charEnd");
    }

    const quote = String(e?.quote || "");
    if (!quote) throw new Error("Hard gate H3 failed: evidence.quote must be non-empty");
    const sourceId = toNonEmptyString(e?.sourceId);
    if (!sourceId) throw new Error("Hard gate H4 failed: evidence.sourceId is required");
    const sourceText = sourceTextById.get(sourceId);
    if (sourceText) {
      if (charStart < 0 || charEnd > sourceText.length) throw new Error("Hard gate H2 failed: evidence locator out of bounds");
      const slice = sourceText.slice(charStart, charEnd);
      if (!slice.includes(quote)) {
        throw new Error("Hard gate H3 failed: evidence.quote not locatable within sourceTextNormalized slice");
      }
    }
  }

  // H4: slideIntents claimIds/dataTableIds resolvable
  for (const s of Array.isArray(slideIntents) ? slideIntents : []) {
    if (!s) continue;
    if (Array.isArray(s.claimIds)) {
      for (const id of s.claimIds) {
        if (!claimById.has(String(id))) throw new Error(`Hard gate H4 failed: Unresolvable claimId reference in slideIntents: ${String(id)}`);
      }
    }
    if (Array.isArray(s.dataTableIds)) {
      for (const id of s.dataTableIds) {
        if (!tableById.has(String(id))) throw new Error(`Hard gate H4 failed: Unresolvable dataTableId reference in slideIntents: ${String(id)}`);
      }
    }
  }

  // H4: dataTables sourceEvidenceIds (if present) resolvable
  for (const t of Array.isArray(dataTables) ? dataTables : []) {
    if (!t) continue;
    if (Array.isArray(t.sourceEvidenceIds)) {
      for (const id of t.sourceEvidenceIds) {
        if (!evidenceById.has(String(id))) throw new Error(`Hard gate H4 failed: Unresolvable sourceEvidenceId reference in dataTables: ${String(id)}`);
      }
    }
  }
}

function toSourceRefs(sources) {
  const out = [];
  for (const s of Array.isArray(sources) ? sources : []) {
    if (!s || !toNonEmptyString(s.sourceId) || !toNonEmptyString(s.kind)) continue;
    const sourceRef = {
      sourceId: String(s.sourceId),
      kind: String(s.kind),
      ...(toNonEmptyString(s.title) ? { title: String(s.title) } : {}),
      ...(toNonEmptyString(s.uri) ? { uri: String(s.uri) } : {}),
      ...(toNonEmptyString(s.textHash) ? { textHash: String(s.textHash) } : {}),
      ...(isPlainObject(s.normalization) ? { normalization: s.normalization } : {}),
    };
    out.push(sourceRef);
  }
  return out;
}

/**
 * @param {import("../../runtime/run-context.js").RunContext|object} runContext
 * @param {Array<object>} sources may include internal `sourceTextNormalized` for hard-gate validation
 * @param {Array<object>} slideIntents
 * @param {Array<object>} claims
 * @param {Array<object>} evidenceLedger
 * @param {Array<object>=} dataTables
 * @returns {object} ContentPackage v0.1
 */
export function buildContentPackage(runContext, sources, slideIntents, claims, evidenceLedger, dataTables = []) {
  if (!isPlainObject(runContext)) throw new TypeError("buildContentPackage(runContext,...): runContext must be an object");

  const srcRefs = toSourceRefs(sources);
  const primarySourceText = (() => {
    const s0 = (Array.isArray(sources) ? sources : []).find((s) => s?.sourceId === "user_text") || (Array.isArray(sources) ? sources[0] : null);
    return String(s0?.sourceTextNormalized || "");
  })();

  const pkg = {
    schemaVersion: "0.1",
    runId: String(runContext.runId || "run_unknown"),
    mode: "textprep",
    createdAt: new Date().toISOString(),
    constraints: isPlainObject(runContext.constraints) ? runContext.constraints : {},
    ...(srcRefs.length ? { sources: srcRefs } : {}),
    summary: deriveSummary(primarySourceText, claims),
    outlineCandidates: [],
    slideIntents: Array.isArray(slideIntents) ? slideIntents : [],
    claims: Array.isArray(claims) ? claims : [],
    evidenceLedger: Array.isArray(evidenceLedger) ? evidenceLedger : [],
    dataTables: Array.isArray(dataTables) ? dataTables : [],
    openQuestions: [],
    metrics: {
      textprep: {
        sourceChars: primarySourceText.length,
        chunkCount: undefined, // filled by the stage (optional)
        claimCount: Array.isArray(claims) ? claims.length : 0,
        evidenceCount: Array.isArray(evidenceLedger) ? evidenceLedger.length : 0,
      },
    },
  };

  assertHardGates({ sources, claims: pkg.claims, evidenceLedger: pkg.evidenceLedger, slideIntents: pkg.slideIntents, dataTables: pkg.dataTables });
  return pkg;
}
