import { checkCancelled, extractJsonCandidate } from "./state.js";
import { getModelCaller } from "./model.js";
import { finalizeCitationsInMarkdown } from "./citations.js";
import { isPlainObject, toNonEmptyString } from "../../shared/value-utils.js";
import { clampInt, mapConcurrent, normalizeStringArray, resolveMaxParallelSections } from "./write-utils.js";

function clampProgress(progress) {
  if (typeof progress !== "number" || !Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function deriveTodoIdFromGapId(gapId) {
  if (!gapId) return "";
  const raw = String(gapId);
  const m = raw.match(/^gap_(\d+)$/);
  if (m) return `todo_${m[1]}`;
  return `todo_${raw}`;
}

function deriveGapIdFromTodoId(todoId) {
  if (!todoId) return "";
  const raw = String(todoId);
  const m = raw.match(/^todo_(\d+)$/);
  if (m) return `gap_${m[1]}`;
  if (raw.startsWith("todo_")) return raw.slice(5);
  return "";
}

function normalizeTodoAndGapRows(input) {
  const rows = Array.isArray(input) ? input : [];
  const todoRows = [];
  const gapRows = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (toNonEmptyString(row.todoId)) todoRows.push(row);
    if (toNonEmptyString(row.gapId)) gapRows.push(row);
  }
  return { todoRows, gapRows };
}

function resolveTodoStatusFromGapStatus(gapStatus) {
  const s = String(gapStatus || "").toLowerCase();
  if (s === "filled") return "completed";
  if (s === "blocked") return "cancelled";
  if (!s || s === "open" || s === "searching" || s === "understanding") return "open";
  return "open";
}

function createTodoFromGap(gap) {
  const gapId = toNonEmptyString(gap?.gapId);
  const todoId = deriveTodoIdFromGapId(gapId);
  const text = toNonEmptyString(gap?.question) || (gapId ? `Gap: ${gapId}` : "Research task");
  const status = resolveTodoStatusFromGapStatus(gap?.status);
  return {
    todoId: todoId || `todo_${Date.now().toString(36)}`,
    text,
    priority: gap?.priority,
    status,
    relatedGapId: gapId || undefined,
  };
}

function buildTodoLookups(todoRows, gapRows) {
  const todoById = new Map();
  const gapById = new Map();
  const todoIdByGapId = new Map();

  for (const g of Array.isArray(gapRows) ? gapRows : []) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid || gapById.has(gid)) continue;
    gapById.set(gid, g);
  }

  for (const t of Array.isArray(todoRows) ? todoRows : []) {
    const tid = toNonEmptyString(t?.todoId);
    if (!tid || todoById.has(tid)) continue;
    todoById.set(tid, t);
    const gapId = toNonEmptyString(t?.relatedGapId) || toNonEmptyString(t?.gapId);
    if (gapId && !todoIdByGapId.has(gapId)) todoIdByGapId.set(gapId, tid);
  }

  for (const g of gapById.values()) {
    const gid = toNonEmptyString(g?.gapId);
    if (!gid || todoIdByGapId.has(gid)) continue;
    const fallback = createTodoFromGap(g);
    if (!todoById.has(fallback.todoId)) todoById.set(fallback.todoId, fallback);
    todoIdByGapId.set(gid, fallback.todoId);
  }

  return { todoById, gapById, todoIdByGapId };
}

function resolveTodoIdsForClaim(claim, todoIdByGapId) {
  let todoIds = normalizeStringArray(claim?.todoIds);
  if (!todoIds.length) {
    const gapIds = normalizeStringArray(claim?.gapIds);
    if (gapIds.length) {
      todoIds = gapIds
        .map((gid) => todoIdByGapId.get(gid) || deriveTodoIdFromGapId(gid))
        .map((id) => String(id || "").trim())
        .filter(Boolean);
    }
  }
  return todoIds;
}

function summarizeTodoCompletion(todos) {
  const rows = Array.isArray(todos) ? todos : [];
  let completed = 0;
  let cancelled = 0;
  for (const t of rows) {
    const status = toNonEmptyString(t?.status) || "open";
    if (status === "completed") completed += 1;
    if (status === "cancelled") cancelled += 1;
  }
  return { total: rows.length, completed, cancelled };
}

export function generatePlaceholderReport({ taskGoal, todos, completionReason } = {}) {
  const title = toNonEmptyString(taskGoal) || "Research Report";
  const reason = toNonEmptyString(completionReason) || "All todos completed.";
  const stats = summarizeTodoCompletion(todos);
  const lines = [
    `# ${title}`,
    "",
    "_Report generation skipped because all todos are complete._",
    "",
    `Reason: ${reason}`,
    "",
    `Todo completion: total ${stats.total}, completed ${stats.completed}, cancelled ${stats.cancelled}.`,
    "",
  ];
  const draftMarkdown = lines.join("\n");
  return {
    title,
    draftMarkdown,
    markdown: draftMarkdown,
    sections: [],
    citations: [],
    isPlaceholder: true,
    completionReason: reason,
    todoCompletionStats: stats,
  };
}

export function emitWriteProgress(emit, { current, total, step, msg, detail }) {
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
    { status: "progress", throttle: false }
  );
}

export function finalizeReportKeepingCitations(report, evidenceLedger, sources) {
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

/**
 * Generate a Markdown report from claims + evidence.
 * @param {Array<object>} claims
 * @param {Array<object>} evidenceLedger
 * @param {Array<object>} todos
 * @param {Array<object>} sources
 * @param {string} taskGoal
 * @returns {{markdown:string,sections:Array<object>,citations:Array<object>}}
 */
export function generateReport(claims, evidenceLedger, todos, sources, taskGoal) {
  const claimRows = Array.isArray(claims) ? claims : [];
  const evidenceRows = Array.isArray(evidenceLedger) ? evidenceLedger : [];
  const { todoRows, gapRows } = normalizeTodoAndGapRows(todos);
  const sourceRows = Array.isArray(sources) ? sources : [];

  const { todoById, gapById, todoIdByGapId } = buildTodoLookups(todoRows, gapRows);

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

  const claimsByTodoId = new Map();
  const uncategorized = [];
  const referencedUnknownTodoIds = new Set();

  for (const c of claimRows) {
    if (!c) continue;
    const todoIds = resolveTodoIdsForClaim(c, todoIdByGapId);
    if (!todoIds.length) {
      uncategorized.push(c);
      continue;
    }
    for (const tid of todoIds) {
      if (!claimsByTodoId.has(tid)) claimsByTodoId.set(tid, []);
      claimsByTodoId.get(tid).push(c);
      if (!todoById.has(tid)) referencedUnknownTodoIds.add(tid);
    }
  }

  const sectionTodoIds = [];
  for (const t of todoRows) {
    const tid = toNonEmptyString(t?.todoId);
    if (!tid) continue;
    if (claimsByTodoId.has(tid)) sectionTodoIds.push(tid);
  }
  for (const tid of referencedUnknownTodoIds) sectionTodoIds.push(tid);

  const sections = [];
  let secNo = 0;

  for (const tid of sectionTodoIds) {
    secNo += 1;
    const t = todoById.get(tid);
    const relatedGapId =
      toNonEmptyString(t?.relatedGapId) || toNonEmptyString(t?.gapId) || (!t ? deriveGapIdFromTodoId(tid) : "");
    const g = relatedGapId ? gapById.get(relatedGapId) : null;
    const title =
      toNonEmptyString(t?.text) || toNonEmptyString(g?.question) || (relatedGapId ? `Gap: ${String(relatedGapId)}` : `Todo: ${String(tid)}`);
    const rows = claimsByTodoId.get(tid) || [];
    const claimIds = rows.map((x) => toNonEmptyString(x?.claimId)).filter(Boolean);
    const completionStatus =
      toNonEmptyString(t?.status) || (g ? resolveTodoStatusFromGapStatus(g?.status) : null) || undefined;
    sections.push({
      sectionId: `sec_${secNo}`,
      todoId: String(tid),
      todoIds: [String(tid)],
      ...(relatedGapId ? { gapId: String(relatedGapId) } : {}),
      title,
      claimIds,
      ...(completionStatus ? { completionStatus } : {}),
    });
  }

  if (uncategorized.length) {
    secNo += 1;
    const claimIds = uncategorized.map((x) => toNonEmptyString(x?.claimId)).filter(Boolean);
    sections.push({ sectionId: `sec_${secNo}`, todoId: null, todoIds: [], gapId: null, title: "Other Findings", claimIds });
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
      s.todoId === null
        ? uncategorized
        : (claimsByTodoId.get(String(s.todoId)) || []).filter((c) => sClaimIds.has(String(c?.claimId || "")));

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
    .map((c) => ({ claimId: c?.claimId, text: c?.text, todoIds: c?.todoIds, gapIds: c?.gapIds, evidenceIds: c?.evidenceIds }));

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
    todoIds: c?.todoIds,
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
    todoIds: c?.todoIds,
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
    sections.push({
      sectionId,
      title: sectionTitle,
      level,
      ...(targetWords ? { targetWords } : {}),
      ...(outline ? { outline } : {}),
      claimIds: plannedClaimIds,
    });
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

export async function generateReportSingleWithLLM(state, { claims, evidenceLedger, todos, gaps, sources, config }, stageApi) {
  const callModel = getModelCaller(stageApi, { usage: "writer", state });
  if (!callModel) return null;

  const todoInput = Array.isArray(todos) && todos.length ? todos : gaps;
  const skeleton = generateReport(claims, evidenceLedger, todoInput, sources, String(state?.taskGoal || ""));
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
  const markdown = toNonEmptyString(parsed?.markdown) || toNonEmptyString(result?.content) || skeleton.draftMarkdown || skeleton.markdown;
  const titled = toNonEmptyString(parsed?.title) || toNonEmptyString(state?.userConfig?.title) || toNonEmptyString(state?.L1?.scanSummary?.title) || "";
  const hasTitle = typeof markdown === "string" && markdown.trimStart().startsWith("#");
  const prefix = titled && !hasTitle ? `# ${titled}\n\n` : "";
  const draftMarkdown = prefix + markdown;
  const finalized = finalizeCitationsInMarkdown(draftMarkdown, evidenceLedger, sources);

  return { draftMarkdown, markdown: finalized.markdown, sections: skeleton.sections, citations: finalized.citations };
}

export async function generateReportTocBasedWithLLM(state, { claims, evidenceLedger, todos, gaps, sources, config }, stageApi, emit) {
  const callModel = getModelCaller(stageApi, { usage: "writer", state });
  if (!callModel) return null;

  const claimRows = Array.isArray(claims) ? claims : [];
  const allClaimIds = claimRows.map((c) => toNonEmptyString(c?.claimId)).filter(Boolean);
  const todoInput = Array.isArray(todos) && todos.length ? todos : gaps;
  const { todoRows, gapRows } = normalizeTodoAndGapRows(todoInput);
  const { todoById, todoIdByGapId } = buildTodoLookups(todoRows, gapRows);
  const skeleton = generateReport(claims, evidenceLedger, todoInput, sources, String(state?.taskGoal || ""));
  const claimTodoIdsById = new Map();
  for (const c of claimRows) {
    const cid = toNonEmptyString(c?.claimId);
    if (!cid) continue;
    const resolved = resolveTodoIdsForClaim(c, todoIdByGapId);
    if (resolved.length) claimTodoIdsById.set(cid, resolved);
  }
  const sectionHints = (Array.isArray(skeleton.sections) ? skeleton.sections : []).map((s) => ({
    sectionId: s.sectionId,
    title: s.title,
    claimIds: s.claimIds,
    todoId: s.todoId ?? null,
    todoIds: Array.isArray(s.todoIds) ? s.todoIds : s.todoId ? [s.todoId] : [],
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
  const tocSectionsRaw = tocPlan.sections.length
    ? tocPlan.sections
    : allocateSectionTargets(
        sectionHints.map((s) => ({ ...s, level: 1 })),
        config.targetWords
      );
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

    emit?.("deepsearch.write.section.started", { ...detailBase, sectionIndex: i, sectionCount: tocSections.length }, { throttle: false });
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
    emit?.("deepsearch.write.section.completed", { ...doneDetail, sectionIndex: i, sectionCount: tocSections.length }, { throttle: false });
    emitWriteProgress(emit, {
      current: 1 + completedCount,
      total: totalSteps,
      step: "report_section",
      msg: `已完成章节 ${i + 1}/${tocSections.length}`,
      detail: doneDetail,
    });

    const sectionTodoIds = Array.from(
      new Set(mergedClaimIds.flatMap((cid) => claimTodoIdsById.get(String(cid)) || []).filter(Boolean))
    );
    const sectionTodoId = sectionTodoIds.length === 1 ? sectionTodoIds[0] : null;
    const relatedGapId = sectionTodoId ? toNonEmptyString(todoById.get(sectionTodoId)?.relatedGapId) : null;
    const completionStatus = sectionTodoId ? toNonEmptyString(todoById.get(sectionTodoId)?.status) : null;

    return {
      sectionId: String(plan.sectionId || `sec_${i + 1}`),
      ...(sectionTodoId ? { todoId: sectionTodoId } : {}),
      ...(sectionTodoIds.length ? { todoIds: sectionTodoIds } : {}),
      ...(relatedGapId ? { gapId: relatedGapId } : {}),
      title: sectionTitle,
      claimIds: mergedClaimIds,
      content,
      ...(completionStatus ? { completionStatus } : {}),
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
