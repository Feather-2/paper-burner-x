import { extractJsonCandidate, checkCancelled } from "./state.js";
import { getModelCaller } from "./model.js";
import { isPlainObject, toNonEmptyString } from "../../shared/value-utils.js";

function normalizeStringArray(v) {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  return raw.map((x) => String(x || "").trim()).filter(Boolean);
}

function safeFiniteNumber(v) {
  const n = typeof v === "string" && v.trim().length ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n;
}

const ISSUE_SEVERITIES = new Set(["critical", "major", "minor"]);
const ISSUE_TYPES = new Set(["consistency", "citation", "structure", "style", "coverage"]);
const PATCH_OPS = new Set(["replaceSection", "editTitle", "insertSection", "deleteSection", "styleUnify"]);
const PATCH_SCOPES = new Set(["global", "section"]);

export function validateReviewerInput(input) {
  if (!isPlainObject(input)) throw new TypeError("Reviewer input must be an object");
  const reportSkeleton = input.reportSkeleton;
  const constraints = input.constraints;
  if (!isPlainObject(reportSkeleton)) throw new TypeError("Reviewer input.reportSkeleton must be an object");
  if (!isPlainObject(constraints)) throw new TypeError("Reviewer input.constraints must be an object");

  const title = toNonEmptyString(reportSkeleton.title);
  if (!title) throw new TypeError("Reviewer reportSkeleton.title must be a non-empty string");

  const sections = Array.isArray(reportSkeleton.sections) ? reportSkeleton.sections : null;
  if (!sections) throw new TypeError("Reviewer reportSkeleton.sections must be an array");

  for (const s of sections) {
    if (!isPlainObject(s)) throw new TypeError("Reviewer reportSkeleton.sections[] must be an object");
    if (!toNonEmptyString(s.sectionId)) throw new TypeError("Reviewer section.sectionId must be a non-empty string");
    if (!toNonEmptyString(s.title)) throw new TypeError("Reviewer section.title must be a non-empty string");

    if (!Array.isArray(s.claimIds)) throw new TypeError("Reviewer section.claimIds must be an array");
    for (const cid of s.claimIds) if (!toNonEmptyString(cid)) throw new TypeError("Reviewer section.claimIds[] must be non-empty strings");

    const wc = safeFiniteNumber(s.wordCount);
    if (wc === null || wc < 0) throw new TypeError("Reviewer section.wordCount must be a non-negative number");
    if (typeof s.opening !== "string") throw new TypeError("Reviewer section.opening must be a string");
    if (typeof s.closing !== "string") throw new TypeError("Reviewer section.closing must be a string");

    if (!Array.isArray(s.citationIdsUsed)) throw new TypeError("Reviewer section.citationIdsUsed must be an array");
    for (const x of s.citationIdsUsed) if (!toNonEmptyString(x)) throw new TypeError("Reviewer section.citationIdsUsed[] must be non-empty strings");
  }

  const globalStats = reportSkeleton.globalStats;
  if (!isPlainObject(globalStats)) throw new TypeError("Reviewer reportSkeleton.globalStats must be an object");
  for (const k of ["targetWords", "actualWords", "sectionCount", "citationCount"]) {
    const n = safeFiniteNumber(globalStats[k]);
    if (n === null || n < 0) throw new TypeError(`Reviewer reportSkeleton.globalStats.${k} must be a non-negative number`);
  }

  const tone = toNonEmptyString(constraints.tone);
  const audience = toNonEmptyString(constraints.audience);
  const reportLength = toNonEmptyString(constraints.reportLength);
  if (!tone) throw new TypeError("Reviewer constraints.tone must be a non-empty string");
  if (!audience) throw new TypeError("Reviewer constraints.audience must be a non-empty string");
  if (!reportLength) throw new TypeError("Reviewer constraints.reportLength must be a non-empty string");

  return { reportSkeleton, constraints };
}

export function validateReviewerOutput(output) {
  if (!isPlainObject(output)) throw new TypeError("Reviewer output must be an object");
  const overallScore = safeFiniteNumber(output.overallScore);
  if (overallScore === null || overallScore < 0 || overallScore > 1) throw new TypeError("Reviewer output.overallScore must be a number within [0,1]");

  const issues = Array.isArray(output.issues) ? output.issues : null;
  const patchPlan = Array.isArray(output.patchPlan) ? output.patchPlan : null;
  if (!issues) throw new TypeError("Reviewer output.issues must be an array");
  if (!patchPlan) throw new TypeError("Reviewer output.patchPlan must be an array");

  for (const issue of issues) {
    if (!isPlainObject(issue)) throw new TypeError("Reviewer output.issues[] must be an object");
    if (!toNonEmptyString(issue.id)) throw new TypeError("Reviewer issue.id must be a non-empty string");
    if (!ISSUE_SEVERITIES.has(String(issue.severity || ""))) throw new TypeError("Reviewer issue.severity must be critical|major|minor");
    if (!ISSUE_TYPES.has(String(issue.type || ""))) throw new TypeError("Reviewer issue.type must be consistency|citation|structure|style|coverage");
    if ("sectionId" in issue && issue.sectionId !== undefined && issue.sectionId !== null && !toNonEmptyString(issue.sectionId)) {
      throw new TypeError("Reviewer issue.sectionId must be a non-empty string when present");
    }
    if (!toNonEmptyString(issue.description)) throw new TypeError("Reviewer issue.description must be a non-empty string");
    if (!toNonEmptyString(issue.whyItMatters)) throw new TypeError("Reviewer issue.whyItMatters must be a non-empty string");
  }

  for (const op of patchPlan) {
    if (!isPlainObject(op)) throw new TypeError("Reviewer output.patchPlan[] must be an object");
    if (!PATCH_OPS.has(String(op.op || ""))) throw new TypeError("Reviewer patchPlan.op must be replaceSection|editTitle|insertSection|deleteSection|styleUnify");
    if (!toNonEmptyString(op.rationale)) throw new TypeError("Reviewer patchPlan.rationale must be a non-empty string");

    if ("sectionId" in op && op.sectionId !== undefined && op.sectionId !== null && !toNonEmptyString(op.sectionId)) {
      throw new TypeError("Reviewer patchPlan.sectionId must be a non-empty string when present");
    }
    if ("afterSectionId" in op && op.afterSectionId !== undefined && op.afterSectionId !== null && !toNonEmptyString(op.afterSectionId)) {
      throw new TypeError("Reviewer patchPlan.afterSectionId must be a non-empty string when present");
    }
    if ("newContent" in op && op.newContent !== undefined && op.newContent !== null && typeof op.newContent !== "string") {
      throw new TypeError("Reviewer patchPlan.newContent must be a string when present");
    }
    if ("newTitle" in op && op.newTitle !== undefined && op.newTitle !== null && typeof op.newTitle !== "string") {
      throw new TypeError("Reviewer patchPlan.newTitle must be a string when present");
    }
    if ("find" in op && op.find !== undefined && op.find !== null && typeof op.find !== "string") throw new TypeError("Reviewer patchPlan.find must be a string");
    if ("replace" in op && op.replace !== undefined && op.replace !== null && typeof op.replace !== "string") throw new TypeError("Reviewer patchPlan.replace must be a string");
    if ("scope" in op && op.scope !== undefined && op.scope !== null && !PATCH_SCOPES.has(String(op.scope || ""))) {
      throw new TypeError("Reviewer patchPlan.scope must be global|section when present");
    }
    if ("usedEvidenceIds" in op && op.usedEvidenceIds !== undefined && op.usedEvidenceIds !== null) {
      if (!Array.isArray(op.usedEvidenceIds)) throw new TypeError("Reviewer patchPlan.usedEvidenceIds must be an array when present");
      for (const eid of op.usedEvidenceIds) if (!toNonEmptyString(eid)) throw new TypeError("Reviewer patchPlan.usedEvidenceIds[] must be non-empty strings");
    }
  }

  return { overallScore, issues, patchPlan };
}

function extractCiteEvidenceIds(text) {
  const s = typeof text === "string" ? text : "";
  const re = /\{\{\s*cite\s*:\s*([A-Za-z0-9._:-]+)\s*\}\}/g;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(s))) {
    const id = toNonEmptyString(m[1]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function buildReportSkeleton(report, { targetWords } = {}) {
  const title = toNonEmptyString(report?.title) || toNonEmptyString(report?.reportTitle) || toNonEmptyString(report?.reportSkeleton?.title);
  const markdown = typeof report?.draftMarkdown === "string" ? report.draftMarkdown : typeof report?.markdown === "string" ? report.markdown : "";
  const sections = Array.isArray(report?.sections) ? report.sections : [];

  const normalizedSections = sections.map((s, i) => {
    const sectionId = toNonEmptyString(s?.sectionId) || `sec_${i + 1}`;
    const sectionTitle = toNonEmptyString(s?.title) || `Section ${i + 1}`;
    const claimIds = normalizeStringArray(s?.claimIds);
    const content = typeof s?.content === "string" ? s.content : "";
    const sourceText = content || markdown;
    const wc = typeof s?.wordCount === "number" && Number.isFinite(s.wordCount) ? s.wordCount : Math.max(0, (sourceText.match(/\S+/g) || []).length);
    const opening = String(sourceText || "").slice(0, 150);
    const closing = String(sourceText || "").slice(Math.max(0, String(sourceText || "").length - 150));
    const citationIdsUsed = extractCiteEvidenceIds(sourceText);
    return { sectionId, title: sectionTitle, claimIds, wordCount: wc, opening, closing, citationIdsUsed };
  });

  const fallbackTitle = toNonEmptyString(title) || (() => {
    const m = markdown.match(/^\s*#\s+(.+)\s*$/m);
    return toNonEmptyString(m?.[1]) || "Research Report";
  })();

  const allCites = new Set();
  for (const s of normalizedSections) for (const eid of s.citationIdsUsed) allCites.add(eid);

  const tWords = safeFiniteNumber(targetWords) ?? safeFiniteNumber(report?.targetWords) ?? 0;
  const actualWords = safeFiniteNumber(report?.actualWords) ?? Math.max(0, (markdown.match(/\S+/g) || []).length);

  return {
    title: fallbackTitle,
    sections: normalizedSections,
    globalStats: {
      targetWords: Math.max(0, tWords),
      actualWords: Math.max(0, actualWords),
      sectionCount: normalizedSections.length,
      citationCount: allCites.size,
    },
  };
}

function buildReviewPrompt({ reportSkeleton, constraints }) {
  return [
    {
      role: "system",
      content:
        "You are a report reviewer. You ONLY see a report skeleton. Return ONLY JSON matching: " +
        "{overallScore:number,issues:[{id,severity,type,sectionId?,description,whyItMatters}],patchPlan:[{op,sectionId?,afterSectionId?,newContent?,newTitle?,find?,replace?,scope?,usedEvidenceIds?,rationale}]} " +
        "where overallScore is within [0,1], and patchPlan ops are from: replaceSection, editTitle, insertSection, deleteSection, styleUnify. " +
        "Do not invent evidence IDs; if you reference usedEvidenceIds, they must be from skeleton.citationIdsUsed.",
    },
    { role: "user", content: JSON.stringify({ reportSkeleton, constraints }, null, 2) },
  ];
}

export async function runReviewerAgent(runContext, input, stageApi = {}) {
  const { reportSkeleton, constraints } = validateReviewerInput(input);
  const state = input?.state; // optional, for token usage

  const callModel = getModelCaller(stageApi, { usage: "reviewer", state });
  if (!callModel) {
    return { overallScore: 1, issues: [], patchPlan: [] };
  }

  const messages = buildReviewPrompt({ reportSkeleton, constraints });
  checkCancelled(stageApi);
  const result = await callModel(messages, { model: "auto", temperature: 0.2, maxTokens: 1200 });
  const candidate = extractJsonCandidate(result?.content);

  let parsed = null;
  if (candidate) {
    try {
      parsed = JSON.parse(candidate);
    } catch {
      parsed = null;
    }
  }

  const normalized = parsed && isPlainObject(parsed) ? parsed : { overallScore: 0, issues: [], patchPlan: [] };
  const out = validateReviewerOutput(normalized);
  return { overallScore: out.overallScore, issues: out.issues, patchPlan: out.patchPlan };
}

export const __test = { extractCiteEvidenceIds };
