import { isPlainObject, toNonEmptyString } from "../../../shared/utils/value-utils.js";
import { normalizeReportLength, ReportLength } from "../../../runtime/index.js";

/**
 * @typedef {object} ReviewerConfig
 * @property {boolean} enableReviewer
 * @property {number} maxReviewRounds
 *
 * @typedef {"brief"|"standard"|"detailed"|"comprehensive"} ReportLengthPresetKey
 *
 * @typedef {object} ReportLengthConfig
 * @property {ReportLengthPresetKey|string} reportLength
 * @property {number} targetWords
 * @property {number} minWords
 * @property {number} maxWords
 * @property {"toc-based"|"single"} strategy
 */

export const REPORT_LENGTH_PRESETS = Object.freeze({
  brief: { minWords: 800, maxWords: 2000, targetWords: 1200 },
  standard: { minWords: 2000, maxWords: 5000, targetWords: 3500 },
  detailed: { minWords: 5000, maxWords: 10000, targetWords: 8000 },
  comprehensive: { minWords: 10000, maxWords: 20000, targetWords: 15000 },
});

/**
 * Coerce a value into a finite number.
 * @param {any} v
 * @returns {number|null}
 */
export function safeFiniteNumber(v) {
  const n = typeof v === "string" && v.trim().length ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n;
}

/**
 * Normalize input into a unique, trimmed string array.
 * @param {any} v
 * @returns {string[]}
 */
export function normalizeStringArray(v) {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  return Array.from(new Set(raw.map((x) => String(x || "").trim()).filter(Boolean)));
}

/**
 * Approximate word count for mixed CJK/Latin text.
 * @param {string} text
 * @returns {number}
 */
export function countWordsApprox(text) {
  if (typeof text !== "string" || !text.length) return 0;
  const latin = text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || [];
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || [];
  return latin.length + cjk.length;
}

/**
 * Clamp an input (if numeric) into an integer range.
 * @param {any} n
 * @param {number} min
 * @param {number} max
 * @returns {number|null}
 */
export function clampInt(n, min, max) {
  const v = safeFiniteNumber(n);
  if (v === null) return null;
  const x = Math.floor(v);
  return Math.max(min, Math.min(max, x));
}

/**
 * Resolve max parallel sections cap from user config and the section count.
 * @param {any} userConfig
 * @param {number} sectionCount
 * @returns {number}
 */
export function resolveMaxParallelSections(userConfig, sectionCount) {
  const configured = clampInt(userConfig?.write?.maxParallelSections, 1, 16);
  const defaultValue = 3; // default within 2-4
  const chosen = configured ?? defaultValue;
  const bounded = Math.max(1, Math.min(16, chosen));
  const cap = typeof sectionCount === "number" && Number.isFinite(sectionCount) ? Math.max(1, Math.floor(sectionCount)) : 1;
  return Math.min(bounded, cap);
}

/**
 * Resolve reviewer (self-review) settings from user config.
 * @param {any} userConfig
 * @returns {ReviewerConfig}
 */
export function resolveReviewerConfig(userConfig) {
  const cfg = isPlainObject(userConfig?.write) ? userConfig.write : {};
  const enableReviewer = Boolean(cfg.enableReviewer);
  const maxReviewRounds = clampInt(cfg.maxReviewRounds, 1, 10) ?? 1;
  return { enableReviewer, maxReviewRounds };
}

/**
 * Extract the first H1 title (`# ...`) from markdown.
 * @param {string} markdown
 * @returns {string|undefined}
 */
export function extractTitleFromMarkdown(markdown) {
  const s = typeof markdown === "string" ? markdown : "";
  const m = s.match(/^\s*#\s+(.+?)\s*$/m);
  return toNonEmptyString(m?.[1]);
}

/**
 * Resolve report length config, using presets or a user-provided word target.
 * @param {any} userConfig
 * @returns {ReportLengthConfig}
 */
export function resolveReportLengthConfig(userConfig) {
  const lengthRaw = normalizeReportLength(userConfig?.reportLength);
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

  const chosen = preset || ReportLength.STANDARD;
  const cfg = REPORT_LENGTH_PRESETS[chosen] || REPORT_LENGTH_PRESETS.standard;
  return {
    reportLength: chosen,
    targetWords: cfg.targetWords,
    minWords: cfg.minWords,
    maxWords: cfg.maxWords,
    strategy: chosen === "detailed" || chosen === "comprehensive" ? "toc-based" : "single",
  };
}

/**
 * Map items with bounded concurrency, preserving input order.
 * @template T,R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number, workerIndex: number) => Promise<R>} worker
 * @returns {Promise<R[]>}
 */
export async function mapConcurrent(items, concurrency, worker) {
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
