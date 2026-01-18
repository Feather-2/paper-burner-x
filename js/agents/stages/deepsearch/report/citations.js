/**
 * DeepSearch citations helpers.
 *
 * Supports `{{cite:<evidenceId>}}` markers in Markdown, building a citation list from the
 * evidence ledger + sources, and rewriting markers into numbered `[n]` citations.
 */
import { toNonEmptyString } from "../../../shared/utils/value-utils.js";

/**
 * @typedef {Object} EvidenceRow
 * @property {string} evidenceId
 * @property {string} [sourceId]
 * @property {string} [chunkId]
 * @property {string} [quote]
 * @property {number} [lineStart]
 * @property {number} [lineEnd]
 * @property {{page?: number, section?: string}} [locator]
 */

/**
 * @typedef {Object} SourceRow
 * @property {string} sourceId
 * @property {string} [title]
 * @property {string} [uri]
 */

const CITE_REGEX = /\{\{\s*cite\s*:\s*([A-Za-z0-9._:-]+)\s*\}\}/g;

/**
 * Formats a quote for citation display.
 * Truncates long quotes and replaces table data with a placeholder.
 * @param {string|null|undefined} quote - The quote text to format
 * @param {{maxLen?: number}} [options] - Formatting options
 * @returns {string} Formatted quote string
 */
export function formatQuoteForCitation(quote, { maxLen = 200 } = {}) {
  if (!quote) return "";
  const src = typeof quote === "string" ? quote : String(quote);
  if (/^\|.*\|$/m.test(src)) return "[表格数据]";
  const normalized = src.replace(/\s+/g, " ").trim();
  const limit = Number.isFinite(maxLen) ? maxLen : 200;
  if (normalized.length > limit) {
    const headLen = Math.max(0, limit - 3);
    return normalized.slice(0, headLen) + "...";
  }
  return normalized;
}

/**
 * Extracts unique evidence IDs referenced via `{{cite:<evidenceId>}}` in Markdown.
 * @param {string} markdown
 * @returns {string[]}
 */
export function extractEvidenceIdsFromMarkdownCitations(markdown) {
  const src = typeof markdown === "string" ? markdown : "";
  const evidenceIdsInOrder = [];
  const firstSeen = new Set();

  for (const m of src.matchAll(/\{\{\s*cite\s*:\s*([A-Za-z0-9._:-]+)\s*\}\}/g)) {
    const eid = toNonEmptyString(m[1]);
    if (!eid || firstSeen.has(eid)) continue;
    firstSeen.add(eid);
    evidenceIdsInOrder.push(eid);
  }

  return evidenceIdsInOrder;
}

/**
 * Builds lookup maps for evidence rows and source rows.
 * @param {EvidenceRow[]} evidenceLedger
 * @param {SourceRow[]} sources
 * @returns {{evidenceById: Map<string, EvidenceRow>, sourceById: Map<string, SourceRow>}}
 */
export function buildEvidenceIndex(evidenceLedger, sources) {
  const evidenceRows = Array.isArray(evidenceLedger) ? evidenceLedger : [];
  const sourceRows = Array.isArray(sources) ? sources : [];

  const evidenceById = new Map();
  for (const e of evidenceRows) {
    const eid = toNonEmptyString(e?.evidenceId);
    if (!eid || evidenceById.has(eid)) continue;
    evidenceById.set(eid, e);
  }

  const sourceById = new Map();
  for (const s of sourceRows) {
    const sid = toNonEmptyString(s?.sourceId);
    if (!sid || sourceById.has(sid)) continue;
    sourceById.set(sid, s);
  }

  return { evidenceById, sourceById };
}

/**
 * 构建标准引用格式 [sourceId:L{start}-L{end}]
 * @param {string} sourceId
 * @param {number|null} lineStart
 * @param {number|null} lineEnd
 * @returns {string}
 */
export function formatRef(sourceId, lineStart, lineEnd) {
  if (!sourceId) return "";
  if (Number.isFinite(lineStart) && Number.isFinite(lineEnd) && lineStart !== lineEnd) {
    return `[${sourceId}:L${lineStart}-L${lineEnd}]`;
  }
  if (Number.isFinite(lineStart)) {
    return `[${sourceId}:L${lineStart}]`;
  }
  return `[${sourceId}]`;
}

/**
 * @typedef {Object} CitationEntry
 * @property {number} citationId
 * @property {string} evidenceId
 * @property {string} [sourceId]
 * @property {string} [sourceTitle]
 * @property {string} [sourceUri]
 * @property {{page?: number, section?: string}} [locator]
 * @property {string} [quote]
 * @property {string} [chunkId]
 * @property {string} [ref]
 * @property {number} [lineStart]
 * @property {number} [lineEnd]
 */

/**
 * Builds an ordered citation list from evidence IDs (deduplicated), enriching with source metadata where available.
 * @param {string[]} evidenceIdsInOrder
 * @param {EvidenceRow[]} evidenceLedger
 * @param {SourceRow[]} sources
 * @returns {CitationEntry[]}
 */
export function buildCitationsFromEvidenceIds(evidenceIdsInOrder, evidenceLedger, sources) {
  const { evidenceById, sourceById } = buildEvidenceIndex(evidenceLedger, sources);
  const seen = new Set();
  const citations = [];
  for (const rawId of evidenceIdsInOrder) {
    const eid = toNonEmptyString(rawId);
    if (!eid || seen.has(eid)) continue;
    const row = evidenceById.get(eid);
    if (!row) continue;
    seen.add(eid);
    const n = citations.length + 1;
    const sourceId = toNonEmptyString(row?.sourceId);
    const src = sourceId ? sourceById.get(String(sourceId)) : null;
    const lineStart = Number.isFinite(row?.lineStart) ? row.lineStart : null;
    const lineEnd = Number.isFinite(row?.lineEnd) ? row.lineEnd : null;
    const ref = formatRef(sourceId, lineStart, lineEnd);
    citations.push({
      citationId: n,
      evidenceId: String(eid),
      sourceId: sourceId ? String(sourceId) : undefined,
      ...(toNonEmptyString(src?.title) ? { sourceTitle: String(src.title) } : {}),
      ...(toNonEmptyString(src?.uri) ? { sourceUri: String(src.uri) } : {}),
      ...(row?.locator ? { locator: row.locator } : {}),
      ...(toNonEmptyString(row?.quote) ? { quote: String(row.quote) } : {}),
      ...(toNonEmptyString(row?.chunkId) ? { chunkId: String(row.chunkId) } : {}),
      ...(lineStart !== null ? { lineStart } : {}),
      ...(lineEnd !== null ? { lineEnd } : {}),
      ...(ref ? { ref } : {}),
    });
  }
  return citations;
}

/**
 * Rewrites `{{cite:<evidenceId>}}` markers into precise reference format and appends a `## 参考文献` section.
 *
 * 引用格式规范 v1.0:
 * - 有行号范围: [sourceId:L{start}-L{end}]
 * - 仅起始行: [sourceId:L{start}]
 * - 无行号: [sourceId]
 *
 * @param {string} markdown
 * @param {EvidenceRow[]} evidenceLedger
 * @param {SourceRow[]} sources
 * @returns {{markdown: string, citations: CitationEntry[]}}
 */
export function finalizeCitationsInMarkdown(markdown, evidenceLedger, sources) {
  const src = typeof markdown === "string" ? markdown : "";
  const evidenceIdsInOrder = extractEvidenceIdsFromMarkdownCitations(src);

  const citations = buildCitationsFromEvidenceIds(evidenceIdsInOrder, evidenceLedger, Array.isArray(sources) ? sources : []);
  // 构建 evidenceId -> ref 映射（优先使用精确引用格式）
  const refByEvidenceId = new Map(citations.map((c) => [c.evidenceId, c.ref || `[${c.citationId}]`]));

  const replaced = src.replace(CITE_REGEX, (_full, evidenceId) => {
    const eid = toNonEmptyString(evidenceId);
    return eid ? (refByEvidenceId.get(String(eid)) || "") : "";
  });

  const md = replaced.trimEnd().length ? replaced.trimEnd() + "\n" : replaced;
  if (!citations.length) return { markdown: md, citations };

  if (/\n##\s+(References|参考文献)\s*\n/i.test(md)) return { markdown: md, citations };

  const lines = [md.trimEnd(), "", "## 参考文献", ""];
  for (const c of citations) {
    const label =
      toNonEmptyString(c?.sourceTitle) || toNonEmptyString(c?.sourceUri) || toNonEmptyString(c?.sourceId) || "source_unknown";
    const quote = formatQuoteForCitation(c?.quote);
    // 使用精确引用格式作为标识
    const refLabel = c.ref || `[${c.citationId}]`;
    lines.push(`- ${refLabel} ${label}${quote ? ` — "${quote}"` : ""}`);
  }
  lines.push("");
  return { markdown: lines.join("\n"), citations };
}
