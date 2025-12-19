import { isPlainObject, toNonEmptyString } from "../../shared/value-utils.js";
import { normalizeReportLength, ReportLength } from "../../runtime/constants.js";

export const REPORT_LENGTH_PRESETS = Object.freeze({
  brief: { minWords: 800, maxWords: 2000, targetWords: 1200 },
  standard: { minWords: 2000, maxWords: 5000, targetWords: 3500 },
  detailed: { minWords: 5000, maxWords: 10000, targetWords: 8000 },
  comprehensive: { minWords: 10000, maxWords: 20000, targetWords: 15000 },
});

export function safeFiniteNumber(v) {
  const n = typeof v === "string" && v.trim().length ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return n;
}

export function normalizeStringArray(v) {
  const raw = Array.isArray(v) ? v : v ? [v] : [];
  return Array.from(new Set(raw.map((x) => String(x || "").trim()).filter(Boolean)));
}

export function countWordsApprox(text) {
  if (typeof text !== "string" || !text.length) return 0;
  const latin = text.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || [];
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/g) || [];
  return latin.length + cjk.length;
}

export function clampInt(n, min, max) {
  const v = safeFiniteNumber(n);
  if (v === null) return null;
  const x = Math.floor(v);
  return Math.max(min, Math.min(max, x));
}

export function resolveMaxParallelSections(userConfig, sectionCount) {
  const configured = clampInt(userConfig?.write?.maxParallelSections, 1, 16);
  const defaultValue = 3; // default within 2-4
  const chosen = configured ?? defaultValue;
  const bounded = Math.max(1, Math.min(16, chosen));
  const cap = typeof sectionCount === "number" && Number.isFinite(sectionCount) ? Math.max(1, Math.floor(sectionCount)) : 1;
  return Math.min(bounded, cap);
}

export function resolveReviewerConfig(userConfig) {
  const cfg = isPlainObject(userConfig?.write) ? userConfig.write : {};
  const enableReviewer = Boolean(cfg.enableReviewer);
  const maxReviewRounds = clampInt(cfg.maxReviewRounds, 1, 10) ?? 1;
  return { enableReviewer, maxReviewRounds };
}

export function extractTitleFromMarkdown(markdown) {
  const s = typeof markdown === "string" ? markdown : "";
  const m = s.match(/^\s*#\s+(.+?)\s*$/m);
  return toNonEmptyString(m?.[1]);
}

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

