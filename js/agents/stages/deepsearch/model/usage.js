/**
 * DeepSearch token-usage helpers.
 *
 * Normalizes model provider usage payloads into a consistent `{input, output, total}` shape.
 */
import { isPlainObject, safeInt } from "../../../shared/index.js";

/**
 * @typedef {object} NormalizedTokenUsage
 * @property {number} input
 * @property {number} output
 * @property {number} total
 */

/**
 * Normalize token usage from various provider formats
 * @param {any} usage - Raw usage object from model provider
 * @returns {NormalizedTokenUsage|null}
 */
export function normalizeTokenUsage(usage) {
  if (!isPlainObject(usage)) return null;

  const promptTokens = safeInt(
    usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens ?? usage.input ?? usage.prompt ?? usage.promptTokensUsed
  );
  const completionTokens = safeInt(
    usage.completion_tokens ??
      usage.completionTokens ??
      usage.output_tokens ??
      usage.outputTokens ??
      usage.output ??
      usage.completion ??
      usage.completionTokensUsed
  );
  const totalTokens = safeInt(usage.total_tokens ?? usage.totalTokens ?? usage.total);

  const hasAny = promptTokens !== null || completionTokens !== null || totalTokens !== null;
  if (!hasAny) return null;

  const input = Math.max(0, promptTokens ?? 0);
  const output = Math.max(0, completionTokens ?? 0);
  const total = Math.max(0, totalTokens ?? input + output);
  return { input, output, total };
}

export const __test = {
  isPlainObject,
  safeInt,
};
