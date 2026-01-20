import { toNonEmptyString } from "../../../../shared/index.js";
import SourceManager from "../../source-manager.js";

/**
 * @typedef {object} WriteReportL0State
 * @property {Array<object|string>=} sources
 *
 * @typedef {object} WriteReportState
 * @property {WriteReportL0State=} L0
 */

/**
 * Handle get-source action for citation checks.
 * @param {object} args
 * @param {object} context
 * @param {WriteReportState} state
 * @returns {object}
 */
export function handleGetSource(args, context, state) {
  const manager = context?.sourceManager instanceof SourceManager
    ? context.sourceManager
    : new SourceManager(state?.L0?.sources || []);
  manager.syncSources(state?.L0?.sources);

  const sourceId = toNonEmptyString(args.sourceId);
  if (!sourceId) {
    const sources = manager.listSources();
    return {
      success: true,
      action: "get-source",
      available: sources.map((s) => ({ sourceId: s.sourceId, name: s.name, length: s.size })),
      hint: "请指定 sourceId 查看原文",
    };
  }

  const info = manager.getSourceInfo(sourceId);
  if (!info) {
    return { success: false, error: `Source not found: ${sourceId}` };
  }

  const rawMaxLength = Number(args.maxLength);
  const rawStart = Number(args.start);
  const maxLength = Number.isFinite(rawMaxLength) && rawMaxLength > 0
    ? Math.min(rawMaxLength, 10000)
    : 5000;
  const start = Number.isFinite(rawStart) && rawStart >= 0 ? rawStart : 0;
  const text = info.text.slice(start, start + maxLength);

  return {
    success: true,
    action: "get-source",
    sourceId: info.sourceId,
    name: info.name,
    content: text,
    totalLength: info.text.length,
    truncated: info.text.length > start + maxLength,
  };
}

/**
 * Sync citations from generated report output.
 * @param {object} report
 * @param {Array<any>} citations
 * @returns {Array<any>}
 */
export function syncReportCitations(report, citations) {
  const normalized = Array.isArray(citations) ? citations : [];
  report.citations = normalized;
  return normalized;
}

export default {
  handleGetSource,
  syncReportCitations,
};
