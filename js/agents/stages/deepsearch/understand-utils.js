import { DeepSearchState } from "./state.js";
import { isPlainObject, toNonEmptyString, safeInt } from "../../shared/value-utils.js";

export function collapseWhitespace(s) {
  return String(s || "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function truncate(s, maxLen = 220) {
  const t = collapseWhitespace(s);
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen);
}

export function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

export function normalizeImportance(v) {
  const s = toNonEmptyString(v);
  if (s === "core" || s === "support") return s;
  return null;
}

export function safeChunkIndex(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function formatChunksForLLM(chunks) {
  return safeArray(chunks)
    .map((c, i) => {
      const text = typeof c?.text === "string" ? c.text : "";
      return `### Chunk ${i}\n${text}`;
    })
    .join("\n\n");
}

export function locateQuoteInSourceSlice(sourceText, baseLocator, quote) {
  const baseStart = safeInt(baseLocator?.charStart);
  const baseEnd = safeInt(baseLocator?.charEnd);
  if (baseStart === null || baseEnd === null) return null;
  if (!(baseStart < baseEnd)) return null;
  if (baseStart < 0 || baseEnd > sourceText.length) return null;
  if (typeof quote !== "string" || !quote) return null;

  const window = sourceText.slice(baseStart, baseEnd);
  const idx = window.indexOf(quote);
  if (idx < 0) return null;

  const charStart = baseStart + idx;
  const charEnd = charStart + quote.length;
  if (!(charStart < charEnd) || charEnd > baseEnd) return null;
  if (sourceText.slice(charStart, charEnd) !== quote) return null;
  return { charStart, charEnd };
}

export function normalizeUnderstandClaimEditsCacheKeyInputs(taskGoal, claims, evidenceById) {
  const rows = Array.isArray(claims) ? claims : [];
  const draftClaims = rows.map((c) => ({
    text: truncate(c?.text || "", 320),
    importance: truncate(c?.importance || "", 24),
  }));

  const evidenceQuotes = [];
  for (const c of rows) {
    const ids = Array.isArray(c?.evidenceIds) ? c.evidenceIds : [];
    for (const eid of ids) {
      const row = evidenceById?.get ? evidenceById.get(String(eid)) : null;
      const q = row && typeof row.quote === "string" ? row.quote : "";
      const t = q ? truncate(q, 220) : "";
      if (t) evidenceQuotes.push(t);
    }
  }
  evidenceQuotes.sort();

  return {
    taskGoal: truncate(taskGoal || ""),
    draftClaims,
    evidenceQuotes,
  };
}

export function normalizeGapIds(v) {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  return Array.from(new Set(raw.map((x) => String(x || "").trim()).filter(Boolean)));
}

export function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch understand: input.state is required");
}

export function indexSourceTextById(sources) {
  const m = new Map();
  for (const s of Array.isArray(sources) ? sources : []) {
    const id = toNonEmptyString(s?.sourceId);
    if (!id) continue;
    if (typeof s?.sourceTextNormalized === "string") m.set(id, s.sourceTextNormalized);
  }
  return m;
}

export function clampProgress(progress) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

export function pickEvidenceSpan(text, { maxLen = 220 } = {}) {
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

export function quoteFromSourceLocator(sourceTextNormalized, locator, { maxQuoteLen = 220 } = {}) {
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

/**
 * 验证单条 evidence 是否合规
 * @returns {{ valid: boolean, issues: string[] }}
 */
export function validateSingleEvidence(e, { sources, sourceTextById }) {
  const issues = [];
  if (!e) {
    issues.push("evidence is null/undefined");
    return { valid: false, issues };
  }

  // chunkId is an optional trace field; validation is grounded on sourceId + locator + quote only.

  // H4: sourceId 必须存在且可解析
  const sourceId = toNonEmptyString(e?.sourceId);
  if (!sourceId) {
    issues.push("H4: sourceId missing");
  } else if (!Array.isArray(sources) || !sources.some((s) => toNonEmptyString(s?.sourceId) === sourceId)) {
    issues.push(`H4: sourceId "${sourceId}" not found in sources`);
  }

  // H2: locator 必须合法
  const locator = e?.locator;
  const charStart = safeInt(locator?.charStart);
  const charEnd = safeInt(locator?.charEnd);
  if (charStart === null || charEnd === null) {
    issues.push("H2: locator missing charStart/charEnd");
  } else if (!(charStart < charEnd)) {
    issues.push(`H2: charStart (${charStart}) >= charEnd (${charEnd})`);
  }

  // H3: quote 必须非空
  const quote = String(e?.quote || "");
  if (!quote) {
    issues.push("H3: quote is empty");
  }

  // H2 + H3: quote 必须精确匹配 sourceText 切片
  if (sourceId && charStart !== null && charEnd !== null && quote) {
    const sourceText = sourceTextById.get(sourceId);
    if (typeof sourceText !== "string") {
      issues.push(`H4: sourceTextNormalized missing for sourceId "${sourceId}"`);
    } else if (charStart < 0 || charEnd > sourceText.length) {
      issues.push(`H2: locator out of bounds (${charStart}-${charEnd}, text length ${sourceText.length})`);
    } else {
      const slice = sourceText.slice(charStart, charEnd);
      // Degraded mode (default) allows quotes that are a substring of the located slice.
      // Strict mode uses `assertHardGates()` which enforces exact equality.
      if (slice !== quote && !slice.includes(quote)) {
        issues.push(`H3: quote mismatch (expected "${slice.slice(0, 50)}...", got "${quote.slice(0, 50)}...")`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/**
 * [已废弃] 硬门验证 - 保留用于严格模式或测试
 * @deprecated 请使用 validateEvidenceWithDegradation 进行软降级验证
 */
export function assertHardGates({ sources, sourceTextById, claims, evidenceLedger }) {
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

