import { isPlainObject, toNonEmptyString } from "../../shared/utils/value-utils.js";

// TP6: Assemble ContentPackage v0.1 (TextPrep mode) + validate Hard Gates (H1-H4).

/**
 * Minimal runtime context shape used by this module.
 * (Kept local to avoid relying on optional type-only imports.)
 * @typedef {object} RunContext
 * @property {string=} runId
 * @property {string=} mode
 * @property {any=} constraints
 */

/**
 * ContentPackage v0.1 as emitted by TextPrep / DeepSearch stages.
 * @typedef {object} ContentPackage
 * @property {string} schemaVersion
 * @property {string} runId
 * @property {"textprep" | "deepsearch"} mode
 * @property {string} createdAt
 * @property {any} constraints
 * @property {Array<any>=} sources
 * @property {Array<any>=} assets
 * @property {string} summary
 * @property {Array<any>} outlineCandidates
 * @property {Array<any>} slideIntents
 * @property {Array<any>} claims
 * @property {Array<any>} evidenceLedger
 * @property {any=} report
 * @property {Array<any>} dataTables
 * @property {Array<any>} openQuestions
 * @property {{ textprep: { sourceChars: number, chunkCount: any, claimCount: number, evidenceCount: number }, deepsearch?: any }} metrics
 * @property {any=} scanSummary
 * @property {Array<any>=} gaps
 * @property {Array<any>=} todos
 * @property {any=} condensedMemory
 * @property {{ total: number, completed: number, cancelled: number }=} todoCompletionStats
 * @property {string=} completionReason
 */

/** @private Converts a value to string, preserving whitespace (null/undefined become empty string). */
function toStringPreserveWhitespace(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  return String(v);
}

/** @private Collapses consecutive whitespace to single space and trims. */
function collapseWhitespace(s) {
  return String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * Derives a summary from claims or source text.
 * Prioritizes top claims' text; falls back to truncated source text.
 * @param {string} sourceTextNormalized - Normalized source text for fallback.
 * @param {Array<{text?: string}>} claims - Array of claim objects with text property.
 * @returns {string} Derived summary (max ~280 chars if from source text).
 */
export function deriveSummary(sourceTextNormalized, claims) {
  const c = Array.isArray(claims) ? claims : [];
  const top = c
    .map((x) => toNonEmptyString(x?.text))
    .filter(Boolean)
    .slice(0, 3);
  if (top.length) return top.join("；");
  return collapseWhitespace(sourceTextNormalized || "").slice(0, 280);
}

/** @private Indexes an array by a specified id key into a Map. */
function indexById(arr, idKey) {
  const map = new Map();
  for (const it of Array.isArray(arr) ? arr : []) {
    const id = toNonEmptyString(it?.[idKey]);
    if (!id) continue;
    if (!map.has(id)) map.set(id, it);
  }
  return map;
}

/** @private Validates ContentPackage against Hard Gates (H1-H5). Throws on violation. */
function assertHardGates({ sources, claims, evidenceLedger, slideIntents, dataTables, report, mode }) {
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

  // H5 (DeepSearch only): report exists and citations resolvable
  if (mode === "deepsearch") {
    if (!isPlainObject(report)) throw new Error("Hard gate H5 failed: report is required for mode=deepsearch");
    if (!toNonEmptyString(report?.markdown)) throw new Error("Hard gate H5 failed: report.markdown must be non-empty");
    if (!Array.isArray(report?.sections)) throw new Error("Hard gate H5 failed: report.sections must be an array");
    if (!Array.isArray(report?.citations)) throw new Error("Hard gate H5 failed: report.citations must be an array");
    for (const c of report.citations) {
      const eid = toNonEmptyString(c?.evidenceId);
      if (!eid) throw new Error("Hard gate H5 failed: report.citations[].evidenceId is required");
      if (!evidenceById.has(String(eid))) throw new Error(`Hard gate H5 failed: report.citations references unknown evidenceId: ${String(eid)}`);
    }
  }
}

/** @private Converts sources array to SourceRef array for ContentPackage (strips internal fields). */
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
 * @param {RunContext|object} runContext
 * @param {Array<any>} sources may include internal `sourceTextNormalized` for hard-gate validation
 * @param {Array<any>} slideIntents
 * @param {Array<any>} claims
 * @param {Array<any>} evidenceLedger
 * @param {Array<any>=} dataTables
 * @returns {ContentPackage} ContentPackage v0.1
 */
export function buildContentPackage(runContext, sources, slideIntents, claims, evidenceLedger, dataTables = []) {
  if (!isPlainObject(runContext)) throw new TypeError("buildContentPackage(runContext,...): runContext must be an object");

  const extra = arguments.length >= 7 && isPlainObject(arguments[6]) ? arguments[6] : {};
  const modeRaw = String(extra.mode || runContext.mode || "textprep");
  const mode = modeRaw === "deepsearch" ? "deepsearch" : "textprep";

  const srcRefs = toSourceRefs(sources);
  const primarySourceText = (() => {
    const s0 = (Array.isArray(sources) ? sources : []).find((s) => s?.sourceId === "user_text") || (Array.isArray(sources) ? sources[0] : null);
    return String(s0?.sourceTextNormalized || "");
  })();

  const openQuestions = Array.isArray(extra.openQuestions) ? extra.openQuestions : [];
  const outlineCandidates = Array.isArray(extra.outlineCandidates) ? extra.outlineCandidates : [];
  const scanSummary = isPlainObject(extra.scanSummary) ? extra.scanSummary : null;
  const gaps = Array.isArray(extra.gaps) ? extra.gaps : [];
  const todos = Array.isArray(extra.todos) ? extra.todos : [];
  const completionReason = toNonEmptyString(extra.completionReason);
  const todoStats = (() => {
    const fallback = { total: todos.length, completed: 0, cancelled: 0, open: 0 };
    if (isPlainObject(extra.todoCompletionStats)) {
      const total = Number.isFinite(extra.todoCompletionStats.total) ? extra.todoCompletionStats.total : fallback.total;
      const completed = Number.isFinite(extra.todoCompletionStats.completed) ? extra.todoCompletionStats.completed : 0;
      const cancelled = Number.isFinite(extra.todoCompletionStats.cancelled) ? extra.todoCompletionStats.cancelled : 0;
      return { total, completed, cancelled, open: Math.max(0, total - completed - cancelled) };
    }
    const statusOf = (todo) => {
      const raw = String(todo?.status || "open").toLowerCase();
      if (raw === "completed") return "completed";
      if (raw === "cancelled") return "cancelled";
      return "open";
    };
    const completed = todos.filter((t) => statusOf(t) === "completed").length;
    const cancelled = todos.filter((t) => statusOf(t) === "cancelled").length;
    return { total: todos.length, completed, cancelled, open: Math.max(0, todos.length - completed - cancelled) };
  })();
  const condensedMemory = extra.condensedMemory !== undefined ? extra.condensedMemory : null;
  const report = isPlainObject(extra.report) ? extra.report : null;

  const derivedSummary =
    toNonEmptyString(extra.summary) ||
    (mode === "deepsearch" ? toNonEmptyString(scanSummary?.summaryText) : undefined) ||
    deriveSummary(primarySourceText, claims);

  /** @type {ContentPackage} */
  const pkg = {
    schemaVersion: "0.1",
    runId: String(runContext.runId || "run_unknown"),
    mode,
    createdAt: new Date().toISOString(),
    constraints: isPlainObject(runContext.constraints) ? runContext.constraints : {},
    ...(srcRefs.length ? { sources: srcRefs } : {}),
    ...(Array.isArray(extra.assets) && extra.assets.length ? { assets: extra.assets } : {}),
    summary: derivedSummary,
    outlineCandidates,
    slideIntents: Array.isArray(slideIntents) ? slideIntents : [],
    claims: Array.isArray(claims) ? claims : [],
    evidenceLedger: Array.isArray(evidenceLedger) ? evidenceLedger : [],
    ...(report ? { report } : {}),
    dataTables: Array.isArray(dataTables) ? dataTables : [],
    openQuestions,
    metrics: {
      textprep: {
        sourceChars: primarySourceText.length,
        chunkCount: undefined, // filled by the stage (optional)
        claimCount: Array.isArray(claims) ? claims.length : 0,
        evidenceCount: Array.isArray(evidenceLedger) ? evidenceLedger.length : 0,
      },
    },
  };

  if (mode === "deepsearch") {
    pkg.scanSummary = scanSummary;
    pkg.gaps = gaps;
    pkg.todos = todos;
    pkg.condensedMemory = condensedMemory;
    pkg.metrics.deepsearch = {
      sourceCount: Array.isArray(srcRefs) ? srcRefs.length : 0,
      todoCount: todoStats.total,
      openTodoCount: todoStats.open,
      completedTodoCount: todoStats.completed,
      cancelledTodoCount: todoStats.cancelled,
      gapCount: gaps.length,
    };
    pkg.todoCompletionStats = { total: todoStats.total, completed: todoStats.completed, cancelled: todoStats.cancelled };
    if (completionReason) pkg.completionReason = completionReason;
  }

  assertHardGates({
    sources,
    claims: pkg.claims,
    evidenceLedger: pkg.evidenceLedger,
    slideIntents: pkg.slideIntents,
    dataTables: pkg.dataTables,
    report: pkg.report,
    mode,
  });
  return pkg;
}
