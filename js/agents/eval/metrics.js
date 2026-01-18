/**
 * Metrics utilities for agent evaluation.
 *
 * @module eval/metrics
 */

/**
 * @typedef {import('./types.js').Trial} Trial
 * @typedef {import('./types.js').TaskResult} TaskResult
 * @typedef {import('./types.js').AggregatedMetrics} AggregatedMetrics
 */

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, Number(n)));
}

function mean(values) {
  const xs = Array.isArray(values) ? values.filter((v) => Number.isFinite(v)) : [];
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * 计算 pass@k - k 次中至少一次成功的概率
 *
 * This implementation treats trials as IID samples and uses empirical passRate
 * as an estimate of per-trial success probability.
 *
 * @param {Trial[]} trials
 * @param {number} k
 * @returns {number}
 */
export function passAtK(trials, k) {
  const list = Array.isArray(trials) ? trials : [];
  const n = list.length;
  if (n === 0) return 0;
  const kk = Number.isFinite(k) ? Math.max(0, Math.floor(k)) : 0;
  if (kk <= 0) return 0;

  const passRate = list.filter((t) => t?.passed === true).length / n;
  return clamp01(1 - Math.pow(1 - passRate, kk));
}

/**
 * 计算 pass^k - k 次全部成功的概率
 *
 * This implementation treats trials as IID samples and uses empirical passRate
 * as an estimate of per-trial success probability.
 *
 * @param {Trial[]} trials
 * @param {number} k
 * @returns {number}
 */
export function passExpK(trials, k) {
  const list = Array.isArray(trials) ? trials : [];
  const n = list.length;
  if (n === 0) return 0;
  const kk = Number.isFinite(k) ? Math.max(0, Math.floor(k)) : 0;
  if (kk <= 0) return 0;

  const passRate = list.filter((t) => t?.passed === true).length / n;
  return clamp01(Math.pow(passRate, kk));
}

/**
 * 聚合评估结果
 * @param {TaskResult[]} taskResults
 * @returns {AggregatedMetrics}
 */
export function aggregateResults(taskResults) {
  const tasks = Array.isArray(taskResults) ? taskResults : [];

  const allTrials = tasks.flatMap((t) => (Array.isArray(t?.trials) ? t.trials : []));
  const totalTasks = tasks.length;
  const passedTasks = tasks.filter((t) => Array.isArray(t?.trials) && t.trials.some((tr) => tr?.passed)).length;

  const avgPassRate = mean(tasks.map((t) => t?.passRate));
  const avgScore = mean(allTrials.map((tr) => tr?.score));
  const avgLatencyMs = mean(allTrials.map((tr) => tr?.latencyMs));

  return {
    totalTasks,
    passedTasks,
    avgPassRate,
    avgScore,
    avgLatencyMs,
  };
}

