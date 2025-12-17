import { extractEvidenceIdsFromMarkdownCitations } from "./citations.js";
import { isPlainObject, toNonEmptyString } from "../../shared/value-utils.js";

function clampInt(n, min, max) {
  const v = typeof n === "string" && n.trim().length ? Number(n) : n;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const x = Math.floor(v);
  return Math.max(min, Math.min(max, x));
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

function extractTitleFromMarkdown(markdown) {
  const s = typeof markdown === "string" ? markdown : "";
  const m = s.match(/^\s*#\s+(.+?)\s*$/m);
  return toNonEmptyString(m?.[1]);
}

function removeReferencesSection(markdown) {
  const s = typeof markdown === "string" ? markdown : "";
  const idx = s.search(/\n##\s+References\s*\n/i);
  if (idx < 0) return s;
  return s.slice(0, idx).trimEnd();
}

function normalizeReportSections(report) {
  const sections = [];
  const raw = Array.isArray(report?.sections) ? report.sections : [];
  for (const s of raw) {
    if (!isPlainObject(s)) continue;
    const sectionId = toNonEmptyString(s.sectionId);
    const title = toNonEmptyString(s.title);
    const gapId = toNonEmptyString(s.gapId) || null;
    const claimIds = normalizeStringArray(s.claimIds);
    const content = toNonEmptyString(s.content) || toNonEmptyString(s.markdown) || "";
    if (!sectionId && !title && !content) continue;
    sections.push({
      sectionId: sectionId || `sec_${sections.length + 1}`,
      title: title || `Section ${sections.length + 1}`,
      gapId,
      claimIds,
      content,
    });
  }
  return sections;
}

function parseEvidenceIdsFromNumberedCitations(content, reportCitations) {
  const s = typeof content === "string" ? content : "";
  const citedNos = new Set();
  const re = /\[(\d{1,5})\]/g;
  let m;
  while ((m = re.exec(s))) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0) citedNos.add(n);
  }
  if (!citedNos.size) return [];

  const byNo = new Map();
  for (const c of Array.isArray(reportCitations) ? reportCitations : []) {
    const cid = typeof c?.citationId === "number" && Number.isFinite(c.citationId) ? c.citationId : null;
    const eid = toNonEmptyString(c?.evidenceId);
    if (!cid || !eid) continue;
    if (!byNo.has(cid)) byNo.set(cid, String(eid));
  }

  const out = [];
  for (const n of citedNos) {
    const eid = byNo.get(n);
    if (eid) out.push(eid);
  }
  return out;
}

function citationSubsetForContent(content, reportCitations) {
  const evidenceIds = extractEvidenceIdsFromMarkdownCitations(String(content || ""));
  const resolvedEvidenceIds = evidenceIds.length ? evidenceIds : parseEvidenceIdsFromNumberedCitations(content, reportCitations);
  if (!resolvedEvidenceIds.length) return [];

  const need = new Set(resolvedEvidenceIds.map((x) => String(x)));
  const out = [];
  for (const c of Array.isArray(reportCitations) ? reportCitations : []) {
    const eid = toNonEmptyString(c?.evidenceId);
    if (!eid) continue;
    if (need.has(String(eid))) out.push(c);
  }
  return out;
}

function groupConsecutiveByWeights(items, groupCount) {
  const rows = Array.isArray(items) ? items : [];
  if (groupCount <= 0) return [];
  if (!rows.length) return [];
  if (groupCount >= rows.length) return rows.map((x) => [x]);

  const weights = rows.map((s) => Math.max(1, countWordsApprox(s.content || "") || 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const target = total / groupCount;

  const groups = [];
  let current = [];
  let currentWeight = 0;
  let remainingGroups = groupCount;

  for (let i = 0; i < rows.length; i++) {
    const remainingItems = rows.length - i;
    const item = rows[i];
    const w = weights[i];

    const mustCut = current.length > 0 && remainingItems <= remainingGroups - 1;
    const shouldCut =
      current.length > 0 &&
      currentWeight >= target &&
      remainingItems >= remainingGroups &&
      !mustCut;

    if (shouldCut || mustCut) {
      groups.push(current);
      remainingGroups -= 1;
      current = [];
      currentWeight = 0;
    }

    current.push(item);
    currentWeight += w;
  }
  if (current.length) groups.push(current);

  while (groups.length < groupCount) groups.push([rows[rows.length - 1]]);
  while (groups.length > groupCount && groups.length >= 2) {
    const last = groups.pop();
    groups[groups.length - 1].push(...last);
  }
  return groups;
}

function splitMarkdownIntoParts(markdown, partCount) {
  const src = String(markdown || "").trim();
  if (partCount <= 1) return [src];
  if (!src) return Array.from({ length: partCount }, () => "");

  const lines = src.split(/\r?\n/);
  const units = [];
  let paragraph = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join("\n").trim();
    if (text) units.push(text);
    paragraph = [];
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) {
      flushParagraph();
      continue;
    }
    if (/^\s*[-*+]\s+/.test(trimmed)) {
      flushParagraph();
      units.push(trimmed.trim());
      continue;
    }
    paragraph.push(trimmed);
  }
  flushParagraph();

  const minUnits = units.length;
  if (minUnits < partCount) {
    const sentences = src.split(/(?<=[.!?。！？])\s+/).map((x) => x.trim()).filter(Boolean);
    if (sentences.length >= partCount) {
      units.length = 0;
      units.push(...sentences);
    }
  }

  if (units.length < partCount) {
    const rough = Array.from({ length: partCount }, () => "");
    const chunkSize = Math.max(1, Math.ceil(src.length / partCount));
    for (let i = 0; i < partCount; i++) rough[i] = src.slice(i * chunkSize, (i + 1) * chunkSize).trim();
    return rough;
  }

  const weights = units.map((u) => Math.max(1, countWordsApprox(u) || 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const target = total / partCount;

  const parts = [];
  let current = [];
  let currentWeight = 0;
  let remainingParts = partCount;

  for (let i = 0; i < units.length; i++) {
    const remainingUnits = units.length - i;
    const w = weights[i];
    const unit = units[i];

    const mustCut = current.length > 0 && remainingUnits <= remainingParts - 1;
    const shouldCut = current.length > 0 && currentWeight >= target && remainingUnits >= remainingParts && !mustCut;

    if (shouldCut || mustCut) {
      parts.push(current.join("\n\n").trim());
      remainingParts -= 1;
      current = [];
      currentWeight = 0;
    }

    current.push(unit);
    currentWeight += w;
  }
  if (current.length) parts.push(current.join("\n\n").trim());

  while (parts.length < partCount) parts.push("");
  while (parts.length > partCount && parts.length >= 2) {
    const last = parts.pop();
    parts[parts.length - 1] = `${parts[parts.length - 1]}\n\n${last}`.trim();
  }

  return parts;
}

function splitClaimIdsEvenly(claimIds, partCount) {
  const ids = normalizeStringArray(claimIds);
  if (partCount <= 1) return [ids];
  if (!ids.length) return Array.from({ length: partCount }, () => []);
  const out = Array.from({ length: partCount }, () => []);
  for (let i = 0; i < ids.length; i++) out[i % partCount].push(ids[i]);
  return out;
}

function mergeSectionsToSegment(sections) {
  const rows = Array.isArray(sections) ? sections : [];
  const sectionIds = [];
  const claimIds = [];
  const gapIds = [];
  const titles = [];
  const contents = [];

  for (const s of rows) {
    if (!s) continue;
    sectionIds.push(String(s.sectionId));
    if (toNonEmptyString(s.gapId)) gapIds.push(String(s.gapId));
    claimIds.push(...normalizeStringArray(s.claimIds));
    if (toNonEmptyString(s.title)) titles.push(String(s.title));
    const content = String(s.content || "").trim();
    if (content) contents.push(content);
  }

  const uniqueGapIds = Array.from(new Set(gapIds));
  const title = titles.length === 1 ? titles[0] : titles.length ? `${titles[0]} + ${titles.length - 1} more` : "Content";
  const content = contents.join("\n\n---\n\n").trim();

  return {
    sectionIds,
    title,
    gapId: uniqueGapIds.length === 1 ? uniqueGapIds[0] : null,
    gapIds: uniqueGapIds,
    claimIds: normalizeStringArray(claimIds),
    content,
  };
}

function allocatePartCountsByWeight(sections, desiredTotalParts) {
  const rows = Array.isArray(sections) ? sections : [];
  const n = rows.length;
  if (!n) return [];
  if (desiredTotalParts <= n) return Array.from({ length: n }, () => 1);

  const weights = rows.map((s) => Math.max(1, countWordsApprox(s.content || "") || 1));
  const parts = Array.from({ length: n }, () => 1);
  let remaining = desiredTotalParts - n;

  while (remaining > 0) {
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < n; i++) {
      const score = weights[i] / parts[i];
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    parts[best] += 1;
    remaining -= 1;
  }
  return parts;
}

function buildCoreSlides({ title, sectionTitles, idPrefix }) {
  const t = toNonEmptyString(title) || "Presentation";
  const agendaPoints = sectionTitles.slice(0, 10);

  return [
    { slideIntentId: `${idPrefix}cover`, pageType: "cover", title: t, objective: "Set the context" },
    {
      slideIntentId: `${idPrefix}agenda`,
      pageType: "agenda",
      title: "Agenda",
      objective: "Outline the flow",
      keyPoints: agendaPoints.length ? agendaPoints : ["Background", "Findings", "Implications"],
    },
    {
      slideIntentId: `${idPrefix}overview`,
      pageType: "overview",
      title: "Key Findings",
      objective: "Summarize the core findings",
      keyPoints: agendaPoints.length ? agendaPoints.slice(0, 6) : undefined,
    },
    {
      slideIntentId: `${idPrefix}summary`,
      pageType: "summary",
      title: "Summary",
      objective: "Wrap up with takeaways",
      keyPoints: agendaPoints.length ? agendaPoints.slice(Math.max(0, agendaPoints.length - 6)) : undefined,
    },
  ];
}

function ensureUniqueIds(slides) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < (Array.isArray(slides) ? slides : []).length; i++) {
    const s = slides[i];
    if (!s) continue;
    let id = toNonEmptyString(s.slideIntentId);
    if (!id || seen.has(id)) id = `s_${i + 1}`;
    seen.add(id);
    out.push({ ...s, slideIntentId: id });
  }
  return out;
}

function buildContentSlideIntents(segments, reportCitations, { idPrefix, keepClaimIds, keepContentString }) {
  const used = new Set([`${idPrefix}cover`, `${idPrefix}agenda`, `${idPrefix}overview`, `${idPrefix}summary`]);
  const makeId = (n) => {
    let k = n;
    while (true) {
      const id = `${idPrefix}${k}`;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
      k += 1;
    }
  };

  const out = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const content = String(seg?.content || "");
    const citations = citationSubsetForContent(content, reportCitations);
    const slide = {
      slideIntentId: makeId(i + 1),
      pageType: "content",
      title: String(seg?.title || `Slide ${i + 1}`),
      sectionIds: Array.isArray(seg?.sectionIds) ? seg.sectionIds.slice() : [],
      ...(toNonEmptyString(seg?.gapId) ? { gapId: String(seg.gapId) } : {}),
      ...(Array.isArray(seg?.gapIds) && seg.gapIds.length ? { gapIds: seg.gapIds.slice() } : {}),
      ...(keepContentString ? { content } : {}),
      ...(keepClaimIds && Array.isArray(seg?.claimIds) ? { claimIds: seg.claimIds.slice() } : {}),
      ...(citations.length ? { citations } : {}),
    };
    out.push(slide);
  }
  return out;
}

function buildSegmentsFromReportSections(sections, desiredContentSlides) {
  const rows = Array.isArray(sections) ? sections : [];
  const desired = Math.max(0, Math.floor(desiredContentSlides));
  if (desired <= 0) return [];
  if (!rows.length) return [];

  if (desired === rows.length) return rows.map((s) => mergeSectionsToSegment([s]));

  if (desired < rows.length) {
    const grouped = groupConsecutiveByWeights(rows, desired);
    return grouped.map((g) => mergeSectionsToSegment(g));
  }

  const partsBySection = allocatePartCountsByWeight(rows, desired);
  const segments = [];
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i];
    const parts = partsBySection[i] || 1;
    if (parts <= 1) {
      segments.push(mergeSectionsToSegment([s]));
      continue;
    }

    const contentParts = splitMarkdownIntoParts(s.content, parts);
    const claimParts = splitClaimIdsEvenly(s.claimIds, parts);
    for (let p = 0; p < parts; p++) {
      const title = `${s.title} (Part ${p + 1})`;
      segments.push({
        sectionIds: [String(s.sectionId)],
        title,
        gapId: s.gapId,
        gapIds: s.gapId ? [String(s.gapId)] : [],
        claimIds: claimParts[p] || [],
        content: contentParts[p] || "",
      });
    }
  }

  if (segments.length > desired) return segments.slice(0, desired);
  if (segments.length < desired) {
    const missing = desired - segments.length;
    const last = rows[rows.length - 1];
    for (let i = 0; i < missing; i++) {
      segments.push({
        sectionIds: [String(last.sectionId)],
        title: `${last.title} (Part ${partsBySection[rows.length - 1] + i + 1})`,
        gapId: last.gapId,
        gapIds: last.gapId ? [String(last.gapId)] : [],
        claimIds: [],
        content: "",
      });
    }
  }
  return segments;
}

function resolveTargetSlides(options) {
  const targetSlides = clampInt(options?.targetSlides, 1, 200) ?? null;
  return targetSlides;
}

/**
 * @param {object} report
 * @param {object} [options]
 * @param {number=} options.targetSlides target total slide count (including core)
 * @param {boolean=} options.includeCore include agenda/overview/summary core pages (cover always generated)
 * @param {string=} options.idPrefix slideIntentId prefix, default "s_"
 * @param {boolean=} options.keepClaimIds keep claimIds on content slides (default true)
 * @param {boolean=} options.keepContentString keep content as string (default true)
 * @returns {Array<object>} SlideIntent[]
 */
export function deriveSlideIntentsFromReport(report, options = {}) {
  const idPrefix = toNonEmptyString(options?.idPrefix) || "s_";
  const includeCore = options?.includeCore !== undefined ? Boolean(options.includeCore) : true;
  const keepClaimIds = options?.keepClaimIds !== undefined ? Boolean(options.keepClaimIds) : true;
  const keepContentString = options?.keepContentString !== undefined ? Boolean(options.keepContentString) : true;
  const targetSlides = resolveTargetSlides(options);

  const reportObj = isPlainObject(report) ? report : {};
  const title = toNonEmptyString(reportObj.title) || extractTitleFromMarkdown(reportObj.draftMarkdown) || extractTitleFromMarkdown(reportObj.markdown) || "Research Report";

  const reportCitations = Array.isArray(reportObj.citations) ? reportObj.citations : [];

  let sections = normalizeReportSections(reportObj);
  if (!sections.length) {
    const md = removeReferencesSection(toNonEmptyString(reportObj.draftMarkdown) || toNonEmptyString(reportObj.markdown) || "");
    if (md) {
      sections = [
        {
          sectionId: "sec_1",
          title: "Content",
          gapId: null,
          claimIds: [],
          content: md,
        },
      ];
    }
  }

  const sectionTitles = sections.map((s) => String(s.title || "")).filter(Boolean);

  const fullCore = buildCoreSlides({ title, sectionTitles, idPrefix });
  const hasSections = sections.length > 0;

  const corePriority = [fullCore[0], fullCore[1], fullCore[2], fullCore[3]];

  const coreSlides = (() => {
    if (!includeCore) return [corePriority[0]];
    if (!targetSlides) return corePriority.slice();

    const maxCore = (() => {
      if (!hasSections) return Math.min(corePriority.length, targetSlides);
      if (targetSlides <= 1) return 1;
      return Math.min(corePriority.length, targetSlides - 1);
    })();
    return corePriority.slice(0, Math.max(1, maxCore));
  })();

  const desiredTotal = targetSlides || null;
  const desiredContentSlides = (() => {
    if (!desiredTotal) return Math.max(0, sections.length);
    return Math.max(0, desiredTotal - coreSlides.length);
  })();

  const segments = buildSegmentsFromReportSections(sections, desiredContentSlides);
  const contentSlides = buildContentSlideIntents(segments, reportCitations, { idPrefix, keepClaimIds, keepContentString });

  const combined = [...coreSlides, ...contentSlides];

  if (!targetSlides) return ensureUniqueIds(combined);

  if (combined.length === targetSlides) return ensureUniqueIds(combined);

  if (combined.length < targetSlides) {
    const missing = targetSlides - combined.length;
    const padding = [];
    for (let i = 0; i < missing; i++) {
      padding.push({
        slideIntentId: `${idPrefix}pad_${i + 1}`,
        pageType: "appendix",
        title: `Appendix ${i + 1}`,
        ...(keepContentString ? { content: "" } : {}),
        ...(keepClaimIds ? { claimIds: [] } : {}),
      });
    }
    return ensureUniqueIds([...combined, ...padding]);
  }

  // Too many slides: trim content slides first, then core (never remove cover).
  const over = combined.length - targetSlides;
  if (over <= 0) return ensureUniqueIds(combined);

  const kept = combined.slice();
  let toRemove = over;

  for (let i = kept.length - 1; i >= 0 && toRemove > 0; i--) {
    if (kept[i]?.pageType === "content") {
      kept.splice(i, 1);
      toRemove -= 1;
    }
  }
  for (let i = kept.length - 1; i >= 1 && toRemove > 0; i--) {
    kept.splice(i, 1);
    toRemove -= 1;
  }
  return ensureUniqueIds(kept.slice(0, targetSlides));
}
