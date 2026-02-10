/**
 * CostAggregator formatting helpers.
 */

/** @param {unknown} value @returns {number} */
function toNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** @param {number} value @returns {string} */
function trimFixed(value) {
  return value
    .toFixed(1)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1');
}

/**
 * Human-readable token count formatter.
 * @param {number} n
 * @returns {string}
 */
export function formatTokenCount(n) {
  const value = toNonNegativeNumber(n);
  if (value < 1000) return String(Math.round(value));

  const units = ['K', 'M', 'B', 'T'];
  let scaled = value;
  let unitIdx = -1;
  while (scaled >= 1000 && unitIdx < units.length - 1) {
    scaled /= 1000;
    unitIdx += 1;
  }

  let rounded = Number(scaled.toFixed(1));
  if (rounded >= 1000 && unitIdx < units.length - 1) {
    rounded /= 1000;
    unitIdx += 1;
  }
  return `${trimFixed(rounded)}${units[unitIdx]}`;
}

/**
 * Human-readable latency formatter.
 * @param {number} ms
 * @returns {string}
 */
export function formatLatency(ms) {
  const value = toNonNegativeNumber(ms);
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60000) return `${trimFixed(value / 1000)}s`;

  const totalSeconds = Math.round(value / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

/**
 * Format getTotalCost() payload into a single-line summary.
 * @param {{ agents?: number, calls?: number, totalTokens?: number, totalLatencyMs?: number } | null | undefined} totalCost
 * @returns {string}
 */
export function formatCostSummary(totalCost) {
  const agents = Math.round(toNonNegativeNumber(totalCost?.agents));
  const calls = Math.round(toNonNegativeNumber(totalCost?.calls));
  const tokens = formatTokenCount(toNonNegativeNumber(totalCost?.totalTokens));
  const latency = formatLatency(toNonNegativeNumber(totalCost?.totalLatencyMs));
  return `${agents} ${agents === 1 ? 'agent' : 'agents'} | ${calls} ${calls === 1 ? 'call' : 'calls'} | ${tokens} tokens | ${latency}`;
}

/**
 * Format getBreakdown() payload for table rendering.
 * @param {Array<{ agentId?: string, calls?: number, promptTokens?: number, completionTokens?: number, totalTokens?: number, totalLatencyMs?: number, models?: Array<{ model?: string, calls?: number, totalTokens?: number }> }>} breakdown
 * @returns {Array<{ agentId: string, calls: string, promptTokens: string, completionTokens: string, totalTokens: string, latency: string, models: Array<{ model: string, calls: string, totalTokens: string }> }>}
 */
export function formatBreakdownTable(breakdown) {
  if (!Array.isArray(breakdown)) return [];

  return breakdown.map((item) => ({
    agentId: typeof item?.agentId === 'string' && item.agentId.trim() ? item.agentId.trim() : 'unknown',
    calls: formatTokenCount(toNonNegativeNumber(item?.calls)),
    promptTokens: formatTokenCount(toNonNegativeNumber(item?.promptTokens)),
    completionTokens: formatTokenCount(toNonNegativeNumber(item?.completionTokens)),
    totalTokens: formatTokenCount(toNonNegativeNumber(item?.totalTokens)),
    latency: formatLatency(toNonNegativeNumber(item?.totalLatencyMs)),
    models: Array.isArray(item?.models)
      ? item.models.map((model) => ({
          model: typeof model?.model === 'string' && model.model.trim() ? model.model.trim() : 'unknown',
          calls: formatTokenCount(toNonNegativeNumber(model?.calls)),
          totalTokens: formatTokenCount(toNonNegativeNumber(model?.totalTokens)),
        }))
      : [],
  }));
}

/**
 * Format getAgentCost() payload into a report object.
 * @param {string} agentId
 * @param {{ calls?: number, promptTokens?: number, completionTokens?: number, totalTokens?: number, totalLatencyMs?: number } | null} agentCost
 * @returns {{ agentId: string, hasData: boolean, calls: string, promptTokens: string, completionTokens: string, totalTokens: string, latency: string, summary: string }}
 */
export function formatAgentReport(agentId, agentCost) {
  const id = typeof agentId === 'string' && agentId.trim() ? agentId.trim() : 'unknown';
  const calls = formatTokenCount(toNonNegativeNumber(agentCost?.calls));
  const promptTokens = formatTokenCount(toNonNegativeNumber(agentCost?.promptTokens));
  const completionTokens = formatTokenCount(toNonNegativeNumber(agentCost?.completionTokens));
  const totalTokens = formatTokenCount(toNonNegativeNumber(agentCost?.totalTokens));
  const latency = formatLatency(toNonNegativeNumber(agentCost?.totalLatencyMs));
  const hasData = Boolean(agentCost);

  return {
    agentId: id,
    hasData,
    calls,
    promptTokens,
    completionTokens,
    totalTokens,
    latency,
    summary: hasData
      ? `${id} | ${calls} calls | ${totalTokens} tokens | ${latency}`
      : `${id} | no usage data`,
  };
}

/**
 * Rough USD estimate from total token count.
 * Uses 50/50 input-output split when only total tokens are known.
 * @param {number} totalTokens
 * @param {{ inputPer1M?: number, outputPer1M?: number }} [modelPricing]
 * @returns {{ estimatedUsd: number, formatted: string }}
 */
export function calculateCostEstimate(totalTokens, modelPricing = {}) {
  const tokens = toNonNegativeNumber(totalTokens);
  const inputPer1M = toNonNegativeNumber(modelPricing.inputPer1M) || 3;
  const outputPer1M = toNonNegativeNumber(modelPricing.outputPer1M) || 15;

  const inputTokens = tokens / 2;
  const outputTokens = tokens - inputTokens;
  const estimatedUsd = Number(((inputTokens / 1_000_000) * inputPer1M + (outputTokens / 1_000_000) * outputPer1M).toFixed(6));
  const digits = estimatedUsd > 0 && estimatedUsd < 0.01 ? 4 : 2;
  return { estimatedUsd, formatted: `$${estimatedUsd.toFixed(digits)}` };
}
