/**
 * DeepSearch budget helpers.
 *
 * Tracks warning/exceeded state in `state.L2.budgetState` and emits budget-related events.
 */
import { isPlainObject, safeInt, safeNumber } from "../../../shared/index.js";

/** Default threshold (0..1) at which a budget warning is emitted. */
const DEFAULT_WARN_AT = 0.8;
const EVENT_BUDGET_WARNING = "deepsearch:budgetWarning";
const EVENT_BUDGET_EXCEEDED = "deepsearch:budgetExceeded";
const LEGACY_EVENT_BUDGET_WARNING = "deepsearch.budget.warning";
const LEGACY_EVENT_BUDGET_EXCEEDED = "deepsearch.budget.exceeded";

/**
 * @typedef {object} BudgetState
 * @property {boolean} warnedTokens - Whether a token warning has been emitted
 * @property {boolean} warnedCost - Whether a cost warning has been emitted
 * @property {boolean} exceededTokens - Whether token exceeded has been emitted
 * @property {boolean} exceededCost - Whether cost exceeded has been emitted
 */

/**
 * @typedef {object} BudgetConfig
 * @property {number} [maxTokens] - Maximum allowed tokens (>=0)
 * @property {number} [maxCostUSD] - Maximum allowed cost in USD (>=0)
 * @property {number} [warnAt] - Warning threshold ratio (0..1)
 * @property {string} [action] - Action to take on budget events
 */

/**
 * @typedef {(event: string, payload: object) => void} EmitFn
 */

/**
 * @typedef {object} DeepSearchState
 * @property {object} [L2] - Level 2 state container
 * @property {BudgetState} [L2.budgetState] - Budget tracking state
 */

/**
 * Ensures `state.L2.budgetState` exists and is properly initialized.
 * @param {DeepSearchState | null | undefined} state - The DeepSearch state object
 * @returns {BudgetState | null} The initialized budget state, or null if state is invalid
 */
export function ensureBudgetState(state) {
  if (!state || typeof state !== "object") return null;
  if (!isPlainObject(state.L2)) state.L2 = {};
  if (!isPlainObject(state.L2.budgetState)) {
    state.L2.budgetState = {
      warnedTokens: false,
      warnedCost: false,
      exceededTokens: false,
      exceededCost: false,
    };
  }
  return state.L2.budgetState;
}

function normalizeBudgetLimits(budget) {
  const rawMaxTokens = safeInt(budget?.maxTokens);
  const rawMaxCostUSD = safeNumber(budget?.maxCostUSD);
  const rawWarnAt = safeNumber(budget?.warnAt);

  const maxTokens = rawMaxTokens !== null && rawMaxTokens >= 0 ? rawMaxTokens : null;
  const maxCostUSD = rawMaxCostUSD !== null && rawMaxCostUSD >= 0 ? rawMaxCostUSD : null;
  const warnAt = rawWarnAt !== null ? Math.max(0, Math.min(1, rawWarnAt)) : DEFAULT_WARN_AT;
  const action = budget?.action ?? "warn";

  return { maxTokens, maxCostUSD, warnAt, action };
}

function normalizeBudgetTotals(totalTokens, totalCostUSD) {
  const tokens = safeInt(totalTokens) ?? 0;
  const costUSD = safeNumber(totalCostUSD) ?? 0;
  return { tokens, costUSD };
}

function computeBudgetRatios(maxTokens, maxCostUSD, tokens, costUSD) {
  const ratioTokens = maxTokens !== null && maxTokens > 0 ? tokens / maxTokens : null;
  const ratioCost = maxCostUSD !== null && maxCostUSD > 0 ? costUSD / maxCostUSD : null;
  return { ratioTokens, ratioCost };
}

function collectWarningReasons(budgetState, ratioTokens, ratioCost, warnAt) {
  const warningReasons = [];
  if (ratioTokens !== null && ratioTokens >= warnAt && !budgetState.warnedTokens) {
    budgetState.warnedTokens = true;
    warningReasons.push("tokens");
  }
  if (ratioCost !== null && ratioCost >= warnAt && !budgetState.warnedCost) {
    budgetState.warnedCost = true;
    warningReasons.push("cost");
  }
  return warningReasons;
}

function collectExceededReasons(budgetState, maxTokens, maxCostUSD, tokens, costUSD) {
  const exceededReasons = [];
  if (maxTokens !== null && tokens > maxTokens && !budgetState.exceededTokens) {
    budgetState.exceededTokens = true;
    exceededReasons.push("tokens");
  }
  if (maxCostUSD !== null && costUSD > maxCostUSD && !budgetState.exceededCost) {
    budgetState.exceededCost = true;
    exceededReasons.push("cost");
  }
  return exceededReasons;
}

function buildBudgetPayload({ maxTokens, maxCostUSD, warnAt, action, tokens, costUSD, ratioTokens, ratioCost }) {
  return {
    budget: { maxTokens: maxTokens ?? null, maxCostUSD: maxCostUSD ?? null, warnAt, action },
    total: { tokens, estimatedCostUSD: costUSD },
    ratios: { tokens: ratioTokens, cost: ratioCost },
  };
}

function emitBudgetEvent(emit, primaryEvent, legacyEvent, payload) {
  if (typeof emit !== "function") return;
  emit(primaryEvent, payload);
  emit(legacyEvent, payload);
}

/**
 * @typedef {object} EmitBudgetEventsParams
 * @property {EmitFn} [emit] - Event emitter function
 * @property {DeepSearchState} [state] - DeepSearch state object
 * @property {BudgetConfig} [budget] - Budget configuration
 * @property {number} [totalTokens] - Total tokens used so far
 * @property {number} [totalCostUSD] - Total cost in USD so far
 */

/**
 * @typedef {object} EmitBudgetEventsResult
 * @property {string[]} warningReasons - Reasons for warning events emitted
 * @property {string[]} exceededReasons - Reasons for exceeded events emitted
 */

/**
 * Emits budget warning/exceeded events based on the latest aggregated usage.
 * @param {EmitBudgetEventsParams} [params] - Parameters for budget event emission
 * @returns {EmitBudgetEventsResult} Warning and exceeded reasons
 */
export function emitBudgetEvents({ emit, state, budget, totalTokens, totalCostUSD } = {}) {
  const budgetState = ensureBudgetState(state);
  if (!budgetState) return { warningReasons: [], exceededReasons: [] };

  const { maxTokens, maxCostUSD, warnAt, action } = normalizeBudgetLimits(budget);
  const { tokens, costUSD } = normalizeBudgetTotals(totalTokens, totalCostUSD);
  const { ratioTokens, ratioCost } = computeBudgetRatios(maxTokens, maxCostUSD, tokens, costUSD);
  const payloadBase = buildBudgetPayload({ maxTokens, maxCostUSD, warnAt, action, tokens, costUSD, ratioTokens, ratioCost });

  const warningReasons = collectWarningReasons(budgetState, ratioTokens, ratioCost, warnAt);
  if (warningReasons.length) {
    emitBudgetEvent(emit, EVENT_BUDGET_WARNING, LEGACY_EVENT_BUDGET_WARNING, {
      reasons: warningReasons,
      ...payloadBase,
    });
  }

  const exceededReasons = collectExceededReasons(budgetState, maxTokens, maxCostUSD, tokens, costUSD);
  if (exceededReasons.length) {
    emitBudgetEvent(emit, EVENT_BUDGET_EXCEEDED, LEGACY_EVENT_BUDGET_EXCEEDED, {
      reasons: exceededReasons,
      ...payloadBase,
    });
  }

  return { warningReasons, exceededReasons };
}

export const __test = {
  isPlainObject,
  safeInt,
  safeNumber,
};
