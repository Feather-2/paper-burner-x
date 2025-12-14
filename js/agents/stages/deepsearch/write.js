import { DeepSearchState, checkCancelled, extractJsonCandidate, makeStageEmitter } from "./state.js";
import { getModelCaller } from "./model.js";
import { buildReportSkeleton, runReviewerAgent, validateReviewerOutput } from "./review.js";
import { applyPatchPlan } from "./report-diff.js";
import { finalizeCitationsInMarkdown } from "./citations.js";

export { finalizeCitationsInMarkdown };

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

const REPORT_LENGTH_PRESETS = Object.freeze({
  brief: { minWords: 800, maxWords: 2000, targetWords: 1200 },
  standard: { minWords: 2000, maxWords: 5000, targetWords: 3500 },
  detailed: { minWords: 5000, maxWords: 10000, targetWords: 8000 },
  comprehensive: { minWords: 10000, maxWords: 20000, targetWords: 15000 },
});

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function safeFiniteNumber(v) {
  const n = typeof v === "string" && v.trim().length ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n;
}

function normalizeStringArray(v) {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  return Array.from(new Set(raw.map((x) => String(x || "").trim()).filter(Boolean)));
}

function countWordsApprox(text) {
  if (typeof text !== "string" || !text.length) return 0;
  const latin = text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || [];
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || [];
  return latin.length + cjk.length;
}

function clampInt(n, min, max) {
  const v = safeFiniteNumber(n);
  if (v === null) return null;
  const x = Math.floor(v);
  return Math.max(min, Math.min(max, x));
}

function resolveMaxParallelSections(userConfig, sectionCount) {
  const configured = clampInt(userConfig?.write?.maxParallelSections, 1, 16);
  const defaultValue = 3; // default within 2-4
  const chosen = configured ?? defaultValue;
  const bounded = Math.max(1, Math.min(16, chosen));
  const cap = typeof sectionCount === "number" && Number.isFinite(sectionCount) ? Math.max(1, Math.floor(sectionCount)) : 1;
  return Math.min(bounded, cap);
}

function resolveReviewerConfig(userConfig) {
  const cfg = isPlainObject(userConfig?.write) ? userConfig.write : {};
  const enableReviewer = Boolean(cfg.enableReviewer);
  const maxReviewRounds = clampInt(cfg.maxReviewRounds, 1, 10) ?? 1;
  return { enableReviewer, maxReviewRounds };
}

function extractTitleFromMarkdown(markdown) {
  const s = typeof markdown === "string" ? markdown : "";
  const m = s.match(/^\s*#\s+(.+?)\s*$/m);
  return toNonEmptyString(m?.[1]);
}

function finalizeReportKeepingCitations(report, evidenceLedger, sources) {
  const draft = typeof report?.draftMarkdown === "string" ? report.draftMarkdown : typeof report?.markdown === "string" ? report.markdown : "";
  const finalized = finalizeCitationsInMarkdown(draft, evidenceLedger, sources);
  const existingCitations = Array.isArray(report?.citations) ? report.citations : [];
  return {
    ...(isPlainObject(report) ? report : {}),
    draftMarkdown: draft,
    markdown: finalized.markdown,
    citations: finalized.citations.length ? finalized.citations : existingCitations,
  };
}

async function mapConcurrent(items, concurrency, worker) {
  const rows = Array.isArray(items) ? items : [];
  const n = rows.length;
  const max = typeof concurrency === "number" && Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  const limit = Math.min(max, n || 1);
  const results = new Array(n);
  let nextIndex = 0;

  const runWorker = async (workerIndex) => {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= n) return;
      results[i] = await worker(rows[i], i, workerIndex);
    }
  };

  await Promise.all(Array.from({ length: limit }, (_, wi) => runWorker(wi)));
  return results;
}

function resolveReportLengthConfig(userConfig) {
  const lengthRaw = toNonEmptyString(userConfig?.reportLength)?.toLowerCase();
  const preset = lengthRaw && REPORT_LENGTH_PRESETS[lengthRaw] ? lengthRaw : null;

  const targetFromUser = clampInt(userConfig?.reportTargetWords, 200, 50000);
  if (targetFromUser !== null) {
    const bounded = Math.max(REPORT_LENGTH_PRESETS.brief.minWords, Math.min(REPORT_LENGTH_PRESETS.comprehensive.maxWords, targetFromUser));
    const inferred =
      bounded >= REPORT_LENGTH_PRESETS.comprehensive.minWords
        ? "comprehensive"
        : bounded >= REPORT_LENGTH_PRESETS.detailed.minWords
          ? "detailed"
          : bounded >= REPORT_LENGTH_PRESETS.standard.minWords
            ? "standard"
            : "brief";
    const inferredPreset = REPORT_LENGTH_PRESETS[inferred];
    return {
      reportLength: preset || inferred,
      targetWords: bounded,
      minWords: inferredPreset.minWords,
      maxWords: inferredPreset.maxWords,
      strategy: bounded >= REPORT_LENGTH_PRESETS.detailed.minWords ? "toc-based" : "single",
    };
  }

  const chosen = preset || "standard";
  const cfg = REPORT_LENGTH_PRESETS[chosen] || REPORT_LENGTH_PRESETS.standard;
  return {
    reportLength: chosen,
    targetWords: cfg.targetWords,
    minWords: cfg.minWords,
    maxWords: cfg.maxWords,
    strategy: chosen === "detailed" || chosen === "comprehensive" ? "toc-based" : "single",
  };
}

function clampProgress(progress) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function normalizeGapIds(v) {
  return normalizeStringArray(v);
}

function normalizeEvidenceIds(v) {
  return normalizeStringArray(v);
}

function computeFeedbackToResearch(state, { minResolvedEvidencePerClaim = 1 } = {}) {
  const gaps = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const evidenceLedger = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];

  const evidenceById = new Map();
  for (const e of evidenceLedger) {
    const eid = toNonEmptyString(e?.evidenceId);
    if (!eid) continue;
    evidenceById.set(String(eid), e);
  }

  const claimCountByGapId = new Map();
  for (const c of claims) {
    const gapIds = normalizeGapIds(c?.gapIds);
    for (const gid of gapIds) claimCountByGapId.set(gid, (claimCountByGapId.get(gid) || 0) + 1);
  }

  const reopenGaps = [];
  const missingGapIds = [];
  for (const g of gaps) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid) continue;
    const count = claimCountByGapId.get(String(gid)) || 0;
    if (count < 1) missingGapIds.push(String(gid));
  }

  const newGaps = [];
  const insufficientEvidenceClaims = [];

  const minEvidence = Number.isFinite(minResolvedEvidencePerClaim) ? Math.max(0, Math.floor(minResolvedEvidencePerClaim)) : 1;
  for (const c of claims) {
    const claimId = toNonEmptyString(c?.claimId) || "";
    const evidenceIds = normalizeEvidenceIds(c?.evidenceIds);
    const resolved = evidenceIds.filter((eid) => evidenceById.has(String(eid)));
    if (resolved.length >= minEvidence) continue;

    if (claimId) insufficientEvidenceClaims.push(claimId);
    const gapIds = normalizeGapIds(c?.gapIds);
    if (gapIds.length) {
      for (const gid of gapIds) reopenGaps.push(String(gid));
    } else {
      const text = toNonEmptyString(c?.text);
      if (text) newGaps.push({ question: `Find evidence to support: ${String(text).slice(0, 140)}`, priority: "high" });
    }
  }

  for (const gid of missingGapIds) reopenGaps.push(String(gid));

  const normalizedReopen = Array.from(new Set(reopenGaps.map((x) => String(x || "").trim()).filter(Boolean)));
  const normalizedNew = [];
  const newKey = new Set();
  for (const g of Array.isArray(newGaps) ? newGaps : []) {
    const q = toNonEmptyString(g?.question);
    if (!q) continue;
    const key = q.toLowerCase();
    if (newKey.has(key)) continue;
    newKey.add(key);
    const priority = toNonEmptyString(g?.priority);
    normalizedNew.push({ question: String(q), ...(priority ? { priority: String(priority) } : {}) });
  }

  const needsMoreResearch = normalizedReopen.length > 0 || normalizedNew.length > 0 || (gaps.length > 0 && claims.length === 0);
  const parts = [];
  if (missingGapIds.length) parts.push(`missingClaimsForGaps=${missingGapIds.length}`);
  if (insufficientEvidenceClaims.length) parts.push(`insufficientEvidenceClaims=${insufficientEvidenceClaims.length}`);
  if (gaps.length > 0 && claims.length === 0) parts.push("noClaims");
  const reason = parts.length ? parts.join("; ") : undefined;

  return {
    needsMoreResearch,
    reopenGaps: normalizedReopen,
    newGaps: normalizedNew,
    ...(reason ? { reason } : {}),
  };
}

function emitWriteProgress(emit, { current, total, step, msg, detail }) {
  emit?.(
    "deepsearch.write.progress",
    {
      phase: "write",
      step: String(step || "write"),
      current,
      total: Math.max(1, total),
      progress: clampProgress(total > 0 ? current / total : 1),
      msg: String(msg || ""),
      ...(detail && typeof detail === "object" && !Array.isArray(detail) ? { detail } : {}),
    },
    { status: "progress" }
  );
}

function ensureState(_runContext, input) {
  if (input instanceof DeepSearchState) return input;
  if (input?.state instanceof DeepSearchState) return input.state;
  if (isPlainObject(input?.state)) return DeepSearchState.fromJSON(input.state);
  throw new TypeError("DeepSearch write: input.state is required");
}

/**
 * Generate a Markdown report from claims + evidence.
 * @param {Array<object>} claims
 * @param {Array<object>} evidenceLedger
 * @param {Array<object>} gaps
 * @param {Array<object>} sources
 * @param {string} taskGoal
 * @returns {{markdown:string,sections:Array<object>,citations:Array<object>}}
 */
export function generateReport(claims, evidenceLedger, gaps, sources, taskGoal) {
  const claimRows = Array.isArray(claims) ? claims : [];
  const evidenceRows = Array.isArray(evidenceLedger) ? evidenceLedger : [];
  const gapRows = Array.isArray(gaps) ? gaps : [];
  const sourceRows = Array.isArray(sources) ? sources : [];

  const gapById = new Map();
  for (const g of gapRows) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid || gapById.has(gid)) continue;
    gapById.set(gid, g);
  }

  const sourceById = new Map();
  for (const s of sourceRows) {
    const sid = toNonEmptyString(s?.sourceId);
    if (!sid || sourceById.has(sid)) continue;
    sourceById.set(sid, s);
  }

  const evidenceById = new Map();
  for (const e of evidenceRows) {
    const eid = toNonEmptyString(e?.evidenceId);
    if (!eid || evidenceById.has(eid)) continue;
    evidenceById.set(eid, e);
  }

  const claimsByGapId = new Map();
  const uncategorized = [];
  const referencedUnknownGapIds = new Set();

  for (const c of claimRows) {
    if (!c) continue;
    const gidList = normalizeStringArray(c?.gapIds);
    if (!gidList.length) {
      uncategorized.push(c);
      continue;
    }
    for (const gid of gidList) {
      if (!claimsByGapId.has(gid)) claimsByGapId.set(gid, []);
      claimsByGapId.get(gid).push(c);
      if (!gapById.has(gid)) referencedUnknownGapIds.add(gid);
    }
  }

  const sectionGapIds = [];
  for (const g of gapRows) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid) continue;
    if (claimsByGapId.has(gid)) sectionGapIds.push(gid);
  }
  for (const gid of referencedUnknownGapIds) sectionGapIds.push(gid);

  const sections = [];
  let secNo = 0;

  for (const gid of sectionGapIds) {
    secNo += 1;
    const g = gapById.get(gid);
    const title = toNonEmptyString(g?.question) || `Gap: ${String(gid)}`;
    const rows = claimsByGapId.get(gid) || [];
    const claimIds = rows.map((x) => toNonEmptyString(x?.claimId)).filter(Boolean);
    sections.push({ sectionId: `sec_${secNo}`, gapId: String(gid), title, claimIds });
  }

  if (uncategorized.length) {
    secNo += 1;
    const claimIds = uncategorized.map((x) => toNonEmptyString(x?.claimId)).filter(Boolean);
    sections.push({ sectionId: `sec_${secNo}`, gapId: null, title: "Other Findings", claimIds });
  }

  const cite = (evidenceId) => {
    const eid = toNonEmptyString(evidenceId);
    if (!eid) return null;
    if (!evidenceById.has(eid)) return null;
    return `{{cite:${eid}}}`;
  };

  const md = [];
  const title = toNonEmptyString(taskGoal) || "Research Report";
  md.push(`# ${title}`);
  md.push("");

  if (!claimRows.length) {
    md.push("_No claims were produced._");
    const draftMarkdown = md.join("\n");
    return { draftMarkdown, markdown: draftMarkdown, sections, citations: [] };
  }

  for (const s of sections) {
    const sectionLines = [];
    md.push(`## ${String(s.title || "Findings")}`);
    md.push("");
    const sClaimIds = new Set(Array.isArray(s.claimIds) ? s.claimIds : []);

    const rows =
      s.gapId === null
        ? uncategorized
        : (claimsByGapId.get(String(s.gapId)) || []).filter((c) => sClaimIds.has(String(c?.claimId || "")));

    for (const c of rows) {
      const text = toNonEmptyString(c?.text) || "";
      const evidenceIds = normalizeStringArray(c?.evidenceIds);
      const markers = [];
      for (const eid of evidenceIds) {
        const m = cite(eid);
        if (m) markers.push(String(m));
      }
      const line = `- ${text}${markers.length ? " " + markers.join("") : ""}`;
      sectionLines.push(line);
      md.push(line);
    }
    md.push("");
    s.content = sectionLines.join("\n");
  }

  const draftMarkdown = md.join("\n");
  const finalized = finalizeCitationsInMarkdown(draftMarkdown, evidenceLedger, sources);
  return { draftMarkdown, markdown: finalized.markdown, sections, citations: finalized.citations };
}

function buildReportTocPrompt({ taskGoal, targetWords, reportLength, sectionHints, claimRows }) {
  const claimPreview = (Array.isArray(claimRows) ? claimRows : [])
    .slice(0, 32)
    .map((c) => ({ claimId: c?.claimId, text: c?.text, gapIds: c?.gapIds, evidenceIds: c?.evidenceIds }));

  return [
    {
      role: "system",
      content:
        "You are a research report table-of-contents planner. Return ONLY JSON: " +
        "{title:string,sections:[{sectionId,title,level,targetWords,claimIds,outline}]} " +
        "where claimIds are chosen from the provided claims. Keep level <= 2. Do not invent facts.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          taskGoal: String(taskGoal || ""),
          reportLength: String(reportLength || ""),
          targetWords,
          sectionHints: Array.isArray(sectionHints) ? sectionHints : [],
          claims: claimPreview,
        },
        null,
        2
      ),
    },
  ];
}

function buildSingleReportPrompt({ taskGoal, targetWords, minWords, maxWords, reportLength, sections, claims, evidenceLedger, sources }) {
  const claimPreview = (Array.isArray(claims) ? claims : []).slice(0, 48).map((c) => ({
    claimId: c?.claimId,
    text: c?.text,
    gapIds: c?.gapIds,
    evidenceIds: c?.evidenceIds,
  }));

  const evidencePreview = (Array.isArray(evidenceLedger) ? evidenceLedger : []).slice(0, 64).map((e) => ({
    evidenceId: e?.evidenceId,
    sourceId: e?.sourceId,
    quote: toNonEmptyString(e?.quote) ? String(e.quote).slice(0, 240) : undefined,
    locator: e?.locator,
  }));

  const sourcePreview = (Array.isArray(sources) ? sources : []).slice(0, 32).map((s) => ({
    sourceId: s?.sourceId,
    title: s?.title,
    uri: s?.uri,
  }));

  return [
    {
      role: "system",
      content:
        "You are a research report writer. Write Markdown. Use citations as {{cite:EVIDENCE_ID}} strictly from evidenceLedger. " +
        "Return ONLY JSON: {title:string,markdown:string}. Do not invent facts.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          taskGoal: String(taskGoal || ""),
          reportLength: String(reportLength || ""),
          targetWords,
          wordRange: { minWords, maxWords },
          sections: Array.isArray(sections) ? sections : [],
          claims: claimPreview,
          evidenceLedger: evidencePreview,
          sources: sourcePreview,
        },
        null,
        2
      ),
    },
  ];
}

function buildSectionPrompt({ taskGoal, sectionPlan, sectionIndex, sectionCount, previousTitles, claims, evidenceLedger, sources }) {
  const claimPreview = (Array.isArray(claims) ? claims : []).slice(0, 40).map((c) => ({
    claimId: c?.claimId,
    text: c?.text,
    evidenceIds: c?.evidenceIds,
  }));
  const evidencePreview = (Array.isArray(evidenceLedger) ? evidenceLedger : []).slice(0, 64).map((e) => ({
    evidenceId: e?.evidenceId,
    sourceId: e?.sourceId,
    quote: toNonEmptyString(e?.quote) ? String(e.quote).slice(0, 240) : undefined,
    locator: e?.locator,
  }));
  const sourcePreview = (Array.isArray(sources) ? sources : []).slice(0, 32).map((s) => ({
    sourceId: s?.sourceId,
    title: s?.title,
    uri: s?.uri,
  }));

  return [
    {
      role: "system",
      content:
        "You are a research report chapter writer. Return ONLY JSON: {title:string,content:string,claimIds:string[]} " +
        "in Markdown. Use citations as {{cite:EVIDENCE_ID}} strictly from evidenceLedger. Do not invent facts.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          taskGoal: String(taskGoal || ""),
          sectionIndex,
          sectionCount,
          sectionPlan,
          previousSectionTitles: Array.isArray(previousTitles) ? previousTitles : [],
          claims: claimPreview,
          evidenceLedger: evidencePreview,
          sources: sourcePreview,
        },
        null,
        2
      ),
    },
  ];
}

function normalizeTocPlan(raw, claimIds) {
  const known = new Set(Array.isArray(claimIds) ? claimIds : []);
  const title = toNonEmptyString(raw?.title) || "Research Report";
  const rawSections = Array.isArray(raw?.sections) ? raw.sections : [];

  const sections = [];
  let idx = 0;
  for (const s of rawSections) {
    if (!isPlainObject(s)) continue;
    idx += 1;
    const sectionId = toNonEmptyString(s?.sectionId) || `sec_${idx}`;
    const sectionTitle = toNonEmptyString(s?.title) || `Section ${idx}`;
    const level = clampInt(s?.level, 1, 2) || 1;
    const targetWords = clampInt(s?.targetWords, 200, 50000) || null;
    const outline = Array.isArray(s?.outline) ? s.outline.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12) : undefined;
    const plannedClaimIds = normalizeStringArray(s?.claimIds).filter((id) => known.has(id));
    sections.push({ sectionId, title: sectionTitle, level, ...(targetWords ? { targetWords } : {}), ...(outline ? { outline } : {}), claimIds: plannedClaimIds });
  }

  return { title, sections };
}

function allocateSectionTargets(sections, targetWords) {
  const rows = Array.isArray(sections) ? sections : [];
  if (!rows.length) return [];

  const totalGiven = rows.reduce((acc, s) => acc + (typeof s.targetWords === "number" ? s.targetWords : 0), 0);
  if (totalGiven > 0) {
    const scale = targetWords / totalGiven;
    return rows.map((s) => ({
      ...s,
      targetWords: Math.max(200, Math.floor((typeof s.targetWords === "number" ? s.targetWords : 0) * scale)),
    }));
  }

  const base = Math.floor(targetWords / rows.length);
  let remainder = targetWords - base * rows.length;
  return rows.map((s) => {
    const bump = remainder > 0 ? 1 : 0;
    remainder -= bump;
    return { ...s, targetWords: Math.max(200, base + bump) };
  });
}

async function generateReportSingleWithLLM(state, { claims, evidenceLedger, gaps, sources, config }, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "writer", state });
  if (!callModel) return null;

  const skeleton = generateReport(claims, evidenceLedger, gaps, sources, String(state?.taskGoal || ""));
  const messages = buildSingleReportPrompt({
    taskGoal: String(state?.taskGoal || ""),
    targetWords: config.targetWords,
    minWords: config.minWords,
    maxWords: config.maxWords,
    reportLength: config.reportLength,
    sections: skeleton.sections,
    claims,
    evidenceLedger,
    sources,
  });

  checkCancelled(stageApi);
  const result = await callModel(messages, { model: "auto", temperature: 0.2, maxTokens: 2500 });
  const candidate = extractJsonCandidate(result?.content);
  let parsed = null;
  if (candidate) {
    try {
      parsed = JSON.parse(candidate);
    } catch {
      parsed = null;
    }
  }
  const markdown = toNonEmptyString(parsed?.markdown) || toNonEmptyString(result?.content) || skeleton.markdown;
  const titled = toNonEmptyString(parsed?.title) || toNonEmptyString(state?.userConfig?.title) || toNonEmptyString(state?.L1?.scanSummary?.title) || "";
  const hasTitle = typeof markdown === "string" && markdown.trimStart().startsWith("#");
  const prefix = titled && !hasTitle ? `# ${titled}\n\n` : "";
  const draftMarkdown = prefix + markdown;
  const finalized = finalizeCitationsInMarkdown(draftMarkdown, evidenceLedger, sources);

  return { draftMarkdown, markdown: finalized.markdown, sections: skeleton.sections, citations: finalized.citations };
}

async function generateReportTocBasedWithLLM(state, { claims, evidenceLedger, gaps, sources, config }, stageApi, emit) {
  const callModel = getModelCaller(stageApi, { usage: "writer", state });
  if (!callModel) return null;

  const claimRows = Array.isArray(claims) ? claims : [];
  const allClaimIds = claimRows.map((c) => toNonEmptyString(c?.claimId)).filter(Boolean);
  const skeleton = generateReport(claims, evidenceLedger, gaps, sources, String(state?.taskGoal || ""));
  const sectionHints = (Array.isArray(skeleton.sections) ? skeleton.sections : []).map((s) => ({
    sectionId: s.sectionId,
    title: s.title,
    claimIds: s.claimIds,
  }));

  emitWriteProgress(emit, { current: 0, total: 2 + Math.max(1, sectionHints.length), step: "report_toc", msg: "正在规划报告目录" });

  const tocMessages = buildReportTocPrompt({
    taskGoal: String(state?.taskGoal || ""),
    targetWords: config.targetWords,
    reportLength: config.reportLength,
    sectionHints,
    claimRows,
  });

  checkCancelled(stageApi);
  const tocResult = await callModel(tocMessages, { model: "auto", temperature: 0.2, maxTokens: 1200 });
  const tocCandidate = extractJsonCandidate(tocResult?.content);
  let tocParsed = null;
  if (tocCandidate) {
    try {
      tocParsed = JSON.parse(tocCandidate);
    } catch {
      tocParsed = null;
    }
  }
  const tocPlan = normalizeTocPlan(tocParsed, allClaimIds);
  const tocSectionsRaw = tocPlan.sections.length ? tocPlan.sections : allocateSectionTargets(sectionHints.map((s) => ({ ...s, level: 1 })), config.targetWords);
  const tocSections = allocateSectionTargets(tocSectionsRaw, config.targetWords);

  const seenClaims = new Set();
  const leftovers = new Set(allClaimIds);
  for (const s of tocSections) {
    const unique = [];
    for (const cid of Array.isArray(s.claimIds) ? s.claimIds : []) {
      if (seenClaims.has(cid)) continue;
      seenClaims.add(cid);
      leftovers.delete(cid);
      unique.push(cid);
    }
    s.claimIds = unique;
  }
  const leftoverList = Array.from(leftovers);
  if (leftoverList.length) {
    const last = tocSections[tocSections.length - 1];
    last.claimIds = Array.from(new Set([...(Array.isArray(last.claimIds) ? last.claimIds : []), ...leftoverList]));
  }

  const reportTitle =
    toNonEmptyString(tocPlan.title) || toNonEmptyString(state?.userConfig?.title) || toNonEmptyString(state?.L1?.scanSummary?.title) || "Research Report";

  const totalSteps = 2 + Math.max(1, tocSections.length);
  const maxParallelSections = resolveMaxParallelSections(state?.userConfig, tocSections.length);
  let completedCount = 0;

  emit?.("deepsearch.write.toc.planned", {
    runId: state.runId,
    iteration: state.iteration,
    sectionCount: tocSections.length,
    maxParallel: maxParallelSections,
    sections: tocSections.map((s) => ({
      sectionId: s.sectionId,
      title: s.title,
      targetWords: s.targetWords,
      claimIds: s.claimIds,
    })),
  });

  const sectionsOut = await mapConcurrent(tocSections, maxParallelSections, async (plan, i, workerIndex) => {
    const detailBase = {
      sectionId: String(plan?.sectionId || `sec_${i + 1}`),
      sectionTitle: toNonEmptyString(plan?.title) || `Section ${i + 1}`,
      workerIndex,
      claimCount: (plan?.claimIds || []).length,
      targetWords: plan?.targetWords,
    };

    emit?.("deepsearch.write.section.started", { ...detailBase, sectionIndex: i, sectionCount: tocSections.length });
    emitWriteProgress(emit, {
      current: 1 + completedCount,
      total: totalSteps,
      step: "report_section",
      msg: `正在生成章节 ${i + 1}/${tocSections.length}`,
      detail: { ...detailBase, sectionStatus: "started" },
    });

    const relevantClaims = claimRows.filter((c) => plan.claimIds.includes(String(c?.claimId || "")));
    const relevantEvidenceIds = new Set(relevantClaims.flatMap((c) => normalizeStringArray(c?.evidenceIds)));
    const relevantEvidence = (Array.isArray(evidenceLedger) ? evidenceLedger : []).filter((e) => relevantEvidenceIds.has(String(e?.evidenceId || "")));

    const previousTitles = tocSections.slice(0, i).map((s) => toNonEmptyString(s?.title)).filter(Boolean);
    const sectionMessages = buildSectionPrompt({
      taskGoal: String(state?.taskGoal || ""),
      sectionPlan: plan,
      sectionIndex: i,
      sectionCount: tocSections.length,
      previousTitles,
      claims: relevantClaims,
      evidenceLedger: relevantEvidence,
      sources,
    });

    checkCancelled(stageApi);
    const sectionResult = await callModel(sectionMessages, { model: "auto", temperature: 0.2, maxTokens: 2000 });
    const sectionCandidate = extractJsonCandidate(sectionResult?.content);
    let sectionParsed = null;
    if (sectionCandidate) {
      try {
        sectionParsed = JSON.parse(sectionCandidate);
      } catch {
        sectionParsed = null;
      }
    }

    const sectionTitle = toNonEmptyString(sectionParsed?.title) || toNonEmptyString(plan.title) || `Section ${i + 1}`;
    const content = toNonEmptyString(sectionParsed?.content) || "";
    const usedClaimIds = normalizeStringArray(sectionParsed?.claimIds).filter((id) => plan.claimIds.includes(id));
    const mergedClaimIds = usedClaimIds.length ? usedClaimIds : plan.claimIds;

    completedCount += 1;
    const doneDetail = { ...detailBase, sectionTitle, claimCount: mergedClaimIds.length, sectionStatus: "completed" };
    emit?.("deepsearch.write.section.completed", { ...doneDetail, sectionIndex: i, sectionCount: tocSections.length });
    emitWriteProgress(emit, {
      current: 1 + completedCount,
      total: totalSteps,
      step: "report_section",
      msg: `已完成章节 ${i + 1}/${tocSections.length}`,
      detail: doneDetail,
    });

    return {
      sectionId: String(plan.sectionId || `sec_${i + 1}`),
      gapId: null,
      title: sectionTitle,
      claimIds: mergedClaimIds,
      content,
    };
  });

  emitWriteProgress(emit, { current: 1 + tocSections.length, total: totalSteps, step: "report_assemble", msg: "正在组装报告" });

  const md = [];
  md.push(`# ${reportTitle}`);
  md.push("");
  md.push("## Table of Contents");
  md.push("");
  for (let i = 0; i < sectionsOut.length; i++) md.push(`${i + 1}. ${sectionsOut[i].title}`);
  md.push("");
  md.push("---");
  md.push("");
  for (const s of sectionsOut) {
    md.push(`## ${s.title}`);
    md.push("");
    if (toNonEmptyString(s.content)) md.push(String(s.content).trim());
    md.push("");
  }

  const draftMarkdown = md.join("\n");
  const finalized = finalizeCitationsInMarkdown(draftMarkdown, evidenceLedger, sources);
  return { draftMarkdown, markdown: finalized.markdown, sections: sectionsOut, citations: finalized.citations };
}

function ensureCoreSlides({ title, claimIds }) {
  const ids = Array.isArray(claimIds) ? claimIds : [];
  return [
    { slideIntentId: "s_cover", pageType: "cover", title: title || "Presentation", objective: "Set the context", claimIds: [] },
    { slideIntentId: "s_agenda", pageType: "agenda", title: "Agenda", objective: "Outline the flow", keyPoints: ["Background", "Findings", "Implications"], claimIds: [] },
    { slideIntentId: "s_overview", pageType: "overview", title: "Key Findings", objective: "Summarize the core findings", claimIds: ids.slice(0, 5) },
    { slideIntentId: "s_summary", pageType: "summary", title: "Summary", objective: "Wrap up with takeaways", claimIds: ids.slice(Math.max(0, ids.length - 5)) },
  ];
}

function normalizeSlideIntent(v, i) {
  if (!isPlainObject(v)) return null;
  const pageType = toNonEmptyString(v?.pageType) || "overview";
  const slideIntentId = toNonEmptyString(v?.slideIntentId) || `s_${i + 1}`;
  const title = toNonEmptyString(v?.title) || "";
  const objective = toNonEmptyString(v?.objective) || undefined;
  const keyPoints = Array.isArray(v?.keyPoints) ? v.keyPoints.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 8) : undefined;
  const claimIds = Array.isArray(v?.claimIds) ? v.claimIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
  return { slideIntentId, pageType, title, ...(objective ? { objective } : {}), ...(keyPoints ? { keyPoints } : {}), claimIds };
}

function ensureCoreSlidesMerged(slideIntents, { title, claimIds }) {
  const out = (Array.isArray(slideIntents) ? slideIntents : []).map(normalizeSlideIntent).filter(Boolean);
  const core = ensureCoreSlides({ title, claimIds });

  const has = new Set(out.map((s) => s.pageType).filter(Boolean));
  if (!has.has("cover")) out.unshift(core.find((s) => s.pageType === "cover"));
  if (!has.has("agenda")) out.splice(1, 0, core.find((s) => s.pageType === "agenda"));
  if (!has.has("overview")) out.splice(2, 0, core.find((s) => s.pageType === "overview"));
  if (!has.has("summary")) out.push(core.find((s) => s.pageType === "summary"));

  const seen = new Set();
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    let id = toNonEmptyString(s?.slideIntentId);
    if (!id || seen.has(id)) id = `s_${i + 1}`;
    seen.add(id);
    out[i] = { ...s, slideIntentId: id };
  }
  return out.filter(Boolean);
}

async function tryLLMSlidePlan(state, { title, claimIds, claims }, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "writer", state });
  if (!callModel) return null;

  const messages = [
    {
      role: "system",
      content:
        "You are a PPT slide planner. Return ONLY JSON: {slideIntents:[{slideIntentId,pageType,title,objective,keyPoints,claimIds}],outlineCandidates:[{outlineId,title,bullets}]}. " +
        "pageType examples: cover, agenda, overview, comparison, process, summary, appendix. Do not invent facts.",
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          taskGoal: String(state?.taskGoal || ""),
          title: String(title || ""),
          claimIds: Array.isArray(claimIds) ? claimIds : [],
          claims: (Array.isArray(claims) ? claims : []).slice(0, 24).map((c) => ({ claimId: c?.claimId, text: c?.text, importance: c?.importance, gapIds: c?.gapIds })),
        },
        null,
        2
      ),
    },
  ];

  try {
    const result = await callModel(messages, { model: "auto", temperature: 0.2, maxTokens: 1000 });
    const candidate = extractJsonCandidate(result?.content);
    if (!candidate) return null;
    const parsed = JSON.parse(candidate);
    if (!isPlainObject(parsed) || !Array.isArray(parsed.slideIntents)) return null;
    return {
      slideIntents: parsed.slideIntents,
      outlineCandidates: Array.isArray(parsed.outlineCandidates) ? parsed.outlineCandidates : null,
    };
  } catch {
    return null;
  }
}

/**
 * S6 PPT Writing: produce slideIntents[] from claims (placeholder).
 * @param {object} runContext
 * @param {DeepSearchState|{state:DeepSearchState|object}} input
 * @param {{emit?:Function,eventBus?:object,signal?:AbortSignal,checkCancelled?:Function}=} stageApi
 */
export async function runDeepSearchWriteStage(runContext, input, stageApi = {}) {
  const emit = makeStageEmitter(stageApi, "deepsearch");
  const state = ensureState(runContext, input);

  checkCancelled(stageApi);
  const claims = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const claimIds = claims.map((c) => toNonEmptyString(c?.claimId)).filter(Boolean);
  const title = toNonEmptyString(state?.userConfig?.title) || toNonEmptyString(state?.L1?.scanSummary?.title) || "";

  emitWriteProgress(emit, {
    current: 1,
    total: 4,
    step: "plan_slides",
    msg: "正在规划幻灯片",
    detail: { claimCount: claimIds.length, title: title || undefined },
  });

  const llm = await tryLLMSlidePlan(state, { title, claimIds, claims }, stageApi);

  emitWriteProgress(emit, {
    current: 2,
    total: 4,
    step: "finalize_slides",
    msg: llm?.slideIntents ? "正在确定幻灯片意图 (AI)" : "正在确定幻灯片意图 (启发式)",
    detail: { usedLLM: Boolean(llm?.slideIntents) },
  });

  const slideIntents = llm?.slideIntents ? ensureCoreSlidesMerged(llm.slideIntents, { title, claimIds }) : ensureCoreSlides({ title, claimIds });
  const outlineCandidates =
    llm?.outlineCandidates && Array.isArray(llm.outlineCandidates) && llm.outlineCandidates.length
      ? llm.outlineCandidates
      : [
          {
            outlineId: "o_1",
            title: "Default Outline",
            bullets: ["Background", "Evidence-backed findings", "Implications & recommendations"],
          },
        ];

  state.L1.slideIntents = slideIntents;
  state.L1.outlineCandidates = outlineCandidates;

  emitWriteProgress(emit, {
    current: 3,
    total: 4,
    step: "generate_report",
    msg: "正在生成报告",
    detail: { slideCount: slideIntents.length, outlineCount: outlineCandidates.length },
  });

  const reportConfig = resolveReportLengthConfig(state?.userConfig);
  const claimsForReport = Array.isArray(state?.L1?.claims) ? state.L1.claims : [];
  const evidenceForReport = Array.isArray(state?.L1?.evidenceLedger) ? state.L1.evidenceLedger : [];
  const gapsForReport = Array.isArray(state?.L1?.gaps) ? state.L1.gaps : [];
  const sourcesForReport = Array.isArray(state?.L0?.sources) ? state.L0.sources : [];

  let report = null;
  let reportStrategy = "single";
  if (reportConfig.strategy === "toc-based") {
    report = await generateReportTocBasedWithLLM(
      state,
      { claims: claimsForReport, evidenceLedger: evidenceForReport, gaps: gapsForReport, sources: sourcesForReport, config: reportConfig },
      stageApi,
      emit
    );
    if (report) reportStrategy = "toc-based";
  }
  if (!report) {
    report =
      (await generateReportSingleWithLLM(
        state,
        { claims: claimsForReport, evidenceLedger: evidenceForReport, gaps: gapsForReport, sources: sourcesForReport, config: reportConfig },
        stageApi
      )) || generateReport(claimsForReport, evidenceForReport, gapsForReport, sourcesForReport, String(state?.taskGoal || ""));
  }

  report = {
    ...(isPlainObject(report) ? report : {}),
    title: extractTitleFromMarkdown(report?.draftMarkdown || report?.markdown) || toNonEmptyString(report?.title) || "Research Report",
    targetWords: reportConfig.targetWords,
    strategy: reportStrategy,
  };

  report = finalizeReportKeepingCitations(report, evidenceForReport, sourcesForReport);

  const reviewerConfig = resolveReviewerConfig(state?.userConfig);
  let reviewFeedback = { reviewed: false, rounds: 0, finalScore: 1, appliedPatches: 0 };

  if (reviewerConfig.enableReviewer) {
    let current = report;
    let rounds = 0;
    let appliedPatches = 0;
    let finalScore = 1;

    for (let round = 1; round <= reviewerConfig.maxReviewRounds; round++) {
      rounds = round;
      const reportSkeleton = buildReportSkeleton(current, { targetWords: reportConfig.targetWords });
      const constraints = {
        tone: toNonEmptyString(state?.userConfig?.write?.tone) || toNonEmptyString(state?.userConfig?.tone) || "neutral",
        audience: toNonEmptyString(state?.userConfig?.write?.audience) || toNonEmptyString(state?.userConfig?.audience) || "general",
        reportLength: String(reportConfig.reportLength || ""),
      };

      emit?.("deepsearch.write.review.started", {
        round,
        maxRounds: reviewerConfig.maxReviewRounds,
        sectionCount: reportSkeleton.sections.length,
        citationCount: reportSkeleton.globalStats.citationCount,
      });

      checkCancelled(stageApi);
      const reviewerOverride = stageApi?.reviewer && typeof stageApi.reviewer.review === "function" ? stageApi.reviewer.review : null;
      const raw = reviewerOverride
        ? await reviewerOverride({ reportSkeleton, constraints, report: current, state })
        : await runReviewerAgent(runContext, { reportSkeleton, constraints, state }, stageApi);

      const out = validateReviewerOutput(raw);

      emit?.("deepsearch.write.review.completed", { round, overallScore: out.overallScore, issueCount: out.issues.length, patchCount: out.patchPlan.length });

      finalScore = out.overallScore;
      if (!out.patchPlan.length) break;

      current = applyPatchPlan(current, out.patchPlan, evidenceForReport, sourcesForReport);
      appliedPatches += out.patchPlan.length;
      emit?.("deepsearch.write.patch.applied", { round, patchCount: out.patchPlan.length, appliedPatches });
    }

    report = current;
    reviewFeedback = { reviewed: true, rounds, finalScore, appliedPatches };
  }

  report.reviewFeedback = reviewFeedback;
  report.actualWords = countWordsApprox(report?.markdown);
  state.L1.report = report;

  const feedbackToResearch = computeFeedbackToResearch(state, { minResolvedEvidencePerClaim: 1 });

  emitWriteProgress(emit, {
    current: 4,
    total: 4,
    step: "finalize",
    msg: "正在完成写作输出",
    detail: { citationCount: Array.isArray(report?.citations) ? report.citations.length : 0, sectionCount: Array.isArray(report?.sections) ? report.sections.length : 0 },
  });

  state.addTimeline({ name: "deepsearch.write", status: "completed", payload: { slideCount: slideIntents.length, citationCount: report.citations.length } });

  emit?.("deepsearch.write.completed", { slideCount: slideIntents.length, claimCount: claimIds.length });
  return { state, slideIntents, outlineCandidates, report, feedbackToResearch };
}

export const __test = {
  computeFeedbackToResearch,
  resolveReportLengthConfig,
  countWordsApprox,
  resolveMaxParallelSections,
};
