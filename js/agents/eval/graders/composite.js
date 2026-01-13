/**
 * Composite graders: combine results from other graders.
 *
 * @module eval/graders/composite
 */

/**
 * @typedef {import('../types.js').GraderConfig} GraderConfig
 * @typedef {import('../types.js').GraderResult} GraderResult
 */

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/**
 * all-pass - 所有必须通过
 *
 * Options:
 * - types: string[] (optional) subset to consider
 *
 * @type {{ type: 'all_pass', grade: (results: GraderResult[], config: GraderConfig) => GraderResult }}
 */
export const allPassGrader = {
  type: "all_pass",
  grade(results, config) {
    const options = (config && typeof config === "object" && config.options && typeof config.options === "object")
      ? config.options
      : {};
    const subset = asArray(options.types).map(String);
    const considered = subset.length > 0 ? results.filter((r) => subset.includes(r.graderType)) : results;

    const passed = considered.length > 0 ? considered.every((r) => r.passed) : true;
    const score = considered.length > 0 ? Math.min(...considered.map((r) => Number.isFinite(r.score) ? r.score : 0)) : 1;

    return {
      graderType: "all_pass",
      passed,
      score,
      reason: passed ? "All graders passed" : "At least one grader failed",
      issues: [],
    };
  },
};

/**
 * weighted - 加权平均
 *
 * Options:
 * - weights: Record<string, number> (optional; maps graderType -> weight)
 * - types: string[] (optional subset)
 *
 * @type {{ type: 'weighted', grade: (results: GraderResult[], config: GraderConfig) => GraderResult }}
 */
export const weightedGrader = {
  type: "weighted",
  grade(results, config) {
    const options = (config && typeof config === "object" && config.options && typeof config.options === "object")
      ? config.options
      : {};

    const subset = asArray(options.types).map(String);
    const considered = subset.length > 0 ? results.filter((r) => subset.includes(r.graderType)) : results;
    const weights = options.weights && typeof options.weights === "object" ? options.weights : {};

    let total = 0;
    let sum = 0;
    for (const r of considered) {
      const w = Number.isFinite(weights[r.graderType]) ? Number(weights[r.graderType]) : 1;
      const s = Number.isFinite(r.score) ? r.score : 0;
      sum += s * w;
      total += w;
    }

    const score = total > 0 ? sum / total : 0;
    const passed = considered.length > 0 ? considered.every((r) => r.passed) : true;

    return {
      graderType: "weighted",
      passed,
      score,
      reason: "Weighted aggregation",
      issues: [],
    };
  },
};

/**
 * threshold - 阈值通过
 *
 * Options:
 * - threshold: number (default 0.6)
 * - use: "avg" | "min" | "max" (default "avg")
 * - types: string[] (optional subset)
 *
 * @type {{ type: 'threshold', grade: (results: GraderResult[], config: GraderConfig) => GraderResult }}
 */
export const thresholdGrader = {
  type: "threshold",
  grade(results, config) {
    const options = (config && typeof config === "object" && config.options && typeof config.options === "object")
      ? config.options
      : {};

    const subset = asArray(options.types).map(String);
    const considered = subset.length > 0 ? results.filter((r) => subset.includes(r.graderType)) : results;

    const threshold = Number.isFinite(options.threshold) ? Math.max(0, Math.min(1, Number(options.threshold))) : 0.6;
    const use = options.use === "min" ? "min" : options.use === "max" ? "max" : "avg";

    const scores = considered.map((r) => (Number.isFinite(r.score) ? r.score : 0));
    const agg = scores.length === 0
      ? 0
      : use === "min"
        ? Math.min(...scores)
        : use === "max"
          ? Math.max(...scores)
          : scores.reduce((a, b) => a + b, 0) / scores.length;

    const passed = agg >= threshold;
    return {
      graderType: "threshold",
      passed,
      score: agg,
      reason: `Score ${agg.toFixed(2)} ${passed ? ">=" : "<"} threshold ${threshold}`,
      issues: [],
    };
  },
};

