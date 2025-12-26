/**
 * DeepSearch budget helpers.
 *
 * Tracks warning/exceeded state in `state.L2.budgetState` and emits budget-related events.
 */
import { isPlainObject, safeInt, safeNumber } from "../../../shared/utils/value-utils.js";

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

/**
 * Emits budget warning/exceeded events based on the latest aggregated usage.
 * @param {{emit?:Function,state?:object,budget?:object,totalTokens?:number,totalCostUSD?:number}=} params
 * @returns {{warningReasons:string[], exceededReasons:string[]}}
 */
export function emitBudgetEvents({ emit, state, budget, totalTokens, totalCostUSD } = {}) {
  const budgetState = ensureBudgetState(state);
  if (!budgetState) return { warningReasons: [], exceededReasons: [] };

  const maxTokens = safeInt(budget?.maxTokens);
  const maxCostUSD = safeNumber(budget?.maxCostUSD);
  const warnAt = safeNumber(budget?.warnAt) ?? 0.8;

  const tokens = safeInt(totalTokens) ?? 0;
  const costUSD = safeNumber(totalCostUSD) ?? 0;

  const ratioTokens = maxTokens !== null && maxTokens > 0 ? tokens / maxTokens : null;
  const ratioCost = maxCostUSD !== null && maxCostUSD > 0 ? costUSD / maxCostUSD : null;

  const warningReasons = [];
  if (ratioTokens !== null && ratioTokens >= warnAt && !budgetState.warnedTokens) {
    budgetState.warnedTokens = true;
    warningReasons.push("tokens");
  }
  if (ratioCost !== null && ratioCost >= warnAt && !budgetState.warnedCost) {
    budgetState.warnedCost = true;
    warningReasons.push("cost");
  }

  if (warningReasons.length) {
    emit?.("deepsearch.budget.warning", {
      reasons: warningReasons,
      budget: { maxTokens: maxTokens ?? null, maxCostUSD: maxCostUSD ?? null, warnAt, action: budget?.action ?? "warn" },
      total: { tokens, estimatedCostUSD: costUSD },
      ratios: { tokens: ratioTokens, cost: ratioCost },
    });
  }

  const exceededReasons = [];
  if (maxTokens !== null && tokens > maxTokens && !budgetState.exceededTokens) {
    budgetState.exceededTokens = true;
    exceededReasons.push("tokens");
  }
  if (maxCostUSD !== null && costUSD > maxCostUSD && !budgetState.exceededCost) {
    budgetState.exceededCost = true;
    exceededReasons.push("cost");
  }

  if (exceededReasons.length) {
    emit?.("deepsearch.budget.exceeded", {
      reasons: exceededReasons,
      budget: { maxTokens: maxTokens ?? null, maxCostUSD: maxCostUSD ?? null, warnAt, action: budget?.action ?? "warn" },
      total: { tokens, estimatedCostUSD: costUSD },
      ratios: { tokens: ratioTokens, cost: ratioCost },
    });
  }

  return { warningReasons, exceededReasons };
}

export const __test = {
  isPlainObject,
  safeInt,
  safeNumber,
};
