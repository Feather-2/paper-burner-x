import { finalizeCitationsInMarkdown } from "./write.js";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function toNonEmptyString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function normalizeStringArray(v) {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  return raw.map((x) => String(x || "").trim()).filter(Boolean);
}

function safeInt(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : null;
}

function countWordsApprox(text) {
  if (typeof text !== "string" || !text.length) return 0;
  const latin = text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || [];
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || [];
  return latin.length + cjk.length;
}

function extractTitleFromMarkdown(markdown) {
  const s = typeof markdown === "string" ? markdown : "";
  const m = s.match(/^\s*#\s+(.+?)\s*$/m);
  return toNonEmptyString(m?.[1]);
}

function parseSectionsFromMarkdown(markdown) {
  const src = typeof markdown === "string" ? markdown : "";
  const lines = src.split(/\r?\n/);
  const sections = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    const content = current.lines.join("\n").trim();
    sections.push({ title: current.title, content });
    current = null;
  };

  for (const line of lines) {
    const m = line.match(/^\s*##\s+(.+?)\s*$/);
    if (m) {
      const heading = toNonEmptyString(m[1]);
      const isReferences = heading && heading.toLowerCase() === "references";
      flush();
      if (isReferences) break;
      current = { title: heading || "Section", lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  flush();
  return sections;
}

function normalizeReportForPatching(report) {
  const base = isPlainObject(report) ? report : {};
  const draftMarkdown = typeof base.draftMarkdown === "string" ? base.draftMarkdown : typeof base.markdown === "string" ? base.markdown : "";
  const inferredTitle = extractTitleFromMarkdown(draftMarkdown) || toNonEmptyString(base.title) || "Research Report";

  let sections = Array.isArray(base.sections) ? base.sections.map((s) => (isPlainObject(s) ? { ...s } : null)).filter(Boolean) : [];
  const parsed = parseSectionsFromMarkdown(draftMarkdown);

  if (!sections.length && parsed.length) {
    sections = parsed.map((s, i) => ({ sectionId: `sec_${i + 1}`, title: s.title, claimIds: [], content: s.content }));
  } else if (sections.length) {
    const parsedByTitle = new Map(parsed.map((p) => [String(p.title || "").trim().toLowerCase(), p]));
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (typeof s.content === "string") continue;
      const key = String(s.title || "").trim().toLowerCase();
      const p = key ? parsedByTitle.get(key) : null;
      s.content = typeof p?.content === "string" ? p.content : typeof parsed[i]?.content === "string" ? parsed[i].content : "";
    }
  }

  const seen = new Set();
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const id = toNonEmptyString(s.sectionId) || `sec_${i + 1}`;
    let finalId = id;
    let k = 2;
    while (seen.has(finalId)) {
      finalId = `${id}_${k}`;
      k += 1;
    }
    seen.add(finalId);
    s.sectionId = finalId;
    s.title = toNonEmptyString(s.title) || `Section ${i + 1}`;
    s.claimIds = normalizeStringArray(s.claimIds);
    s.content = typeof s.content === "string" ? s.content : "";
  }

  const strategy = toNonEmptyString(base.strategy) || "single";
  return { ...base, title: inferredTitle, draftMarkdown, sections, strategy };
}

function renderDraftMarkdown({ title, sections, strategy }) {
  const md = [];
  const reportTitle = toNonEmptyString(title) || "Research Report";
  md.push(`# ${reportTitle}`);
  md.push("");

  const rows = Array.isArray(sections) ? sections : [];
  if (strategy === "toc-based" && rows.length) {
    md.push("## Table of Contents");
    md.push("");
    for (let i = 0; i < rows.length; i++) md.push(`${i + 1}. ${rows[i].title}`);
    md.push("");
    md.push("---");
    md.push("");
  }

  for (const s of rows) {
    md.push(`## ${s.title}`);
    md.push("");
    const content = typeof s.content === "string" ? s.content.trim() : "";
    if (content) md.push(content);
    md.push("");
  }

  return md.join("\n").trimEnd() + "\n";
}

function applyReplaceAll(text, find, replace) {
  if (!find) return text;
  return String(text || "").split(find).join(String(replace ?? ""));
}

function validateEvidenceIds(patchPlan, evidenceLedger) {
  const ledger = Array.isArray(evidenceLedger) ? evidenceLedger : [];
  const evidenceIds = new Set(ledger.map((e) => toNonEmptyString(e?.evidenceId)).filter(Boolean));

  for (const step of Array.isArray(patchPlan) ? patchPlan : []) {
    if (!isPlainObject(step)) continue;
    const used = step.usedEvidenceIds;
    if (!Array.isArray(used)) continue;
    for (const eid of used) {
      const id = toNonEmptyString(eid);
      if (!id) throw new TypeError("patchPlan.usedEvidenceIds must contain non-empty strings");
      if (!evidenceIds.has(id)) throw new Error(`Unknown evidenceId in patchPlan.usedEvidenceIds: ${id}`);
    }
  }
}

function getSectionIndex(sections, sectionId) {
  const id = toNonEmptyString(sectionId);
  if (!id) return -1;
  return (Array.isArray(sections) ? sections : []).findIndex((s) => String(s?.sectionId || "") === id);
}

function uniqueSectionId(existingIds, proposed) {
  const base = toNonEmptyString(proposed) || "sec_new";
  if (!existingIds.has(base)) return base;
  let i = 2;
  while (existingIds.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

export function applyPatchPlan(report, patchPlan, evidenceLedger, sources) {
  validateEvidenceIds(patchPlan, evidenceLedger);
  const normalized = normalizeReportForPatching(report);
  const steps = Array.isArray(patchPlan) ? patchPlan : [];

  for (const step of steps) {
    if (!isPlainObject(step)) continue;
    const op = String(step.op || "");

    if (op === "editTitle") {
      const newTitle = toNonEmptyString(step.newTitle);
      if (!newTitle) throw new TypeError("editTitle requires newTitle");
      normalized.title = newTitle;
      continue;
    }

    if (op === "replaceSection") {
      const idx = getSectionIndex(normalized.sections, step.sectionId);
      if (idx < 0) throw new Error(`replaceSection: unknown sectionId ${String(step.sectionId || "")}`);
      if (typeof step.newContent !== "string") throw new TypeError("replaceSection requires newContent");
      normalized.sections[idx].content = step.newContent;
      continue;
    }

    if (op === "insertSection") {
      const newTitle = toNonEmptyString(step.newTitle);
      if (!newTitle) throw new TypeError("insertSection requires newTitle");
      if (typeof step.newContent !== "string") throw new TypeError("insertSection requires newContent");

      const existingIds = new Set(normalized.sections.map((s) => String(s.sectionId)));
      const newId = uniqueSectionId(existingIds, step.sectionId);
      const insert = { sectionId: newId, title: newTitle, claimIds: [], content: step.newContent };

      const afterIdx = step.afterSectionId ? getSectionIndex(normalized.sections, step.afterSectionId) : -1;
      if (afterIdx >= 0) normalized.sections.splice(afterIdx + 1, 0, insert);
      else normalized.sections.push(insert);
      continue;
    }

    if (op === "deleteSection") {
      const idx = getSectionIndex(normalized.sections, step.sectionId);
      if (idx < 0) throw new Error(`deleteSection: unknown sectionId ${String(step.sectionId || "")}`);
      normalized.sections.splice(idx, 1);
      continue;
    }

    if (op === "styleUnify") {
      const find = toNonEmptyString(step.find);
      if (!find) throw new TypeError("styleUnify requires non-empty find");
      const replace = typeof step.replace === "string" ? step.replace : "";
      const scope = toNonEmptyString(step.scope) || "global";

      if (scope === "global") {
        normalized.title = applyReplaceAll(normalized.title, find, replace);
        for (const s of normalized.sections) s.content = applyReplaceAll(s.content, find, replace);
      } else {
        const targetId = toNonEmptyString(step.sectionId);
        if (targetId) {
          const idx = getSectionIndex(normalized.sections, targetId);
          if (idx < 0) throw new Error(`styleUnify: unknown sectionId ${targetId}`);
          normalized.sections[idx].content = applyReplaceAll(normalized.sections[idx].content, find, replace);
        } else {
          for (const s of normalized.sections) s.content = applyReplaceAll(s.content, find, replace);
        }
      }
      continue;
    }
  }

  const draftMarkdown = renderDraftMarkdown({ title: normalized.title, sections: normalized.sections, strategy: normalized.strategy });
  normalized.draftMarkdown = draftMarkdown;

  const finalized = finalizeCitationsInMarkdown(draftMarkdown, evidenceLedger, Array.isArray(sources) ? sources : Array.isArray(normalized.sources) ? normalized.sources : []);
  normalized.markdown = finalized.markdown;
  normalized.citations = finalized.citations;

  normalized.actualWords = countWordsApprox(normalized.markdown);
  normalized.targetWords = safeInt(normalized.targetWords) ?? safeInt(normalized?.globalStats?.targetWords) ?? normalized.targetWords;

  return normalized;
}

export const __test = { normalizeReportForPatching, renderDraftMarkdown, parseSectionsFromMarkdown, extractTitleFromMarkdown, countWordsApprox };

