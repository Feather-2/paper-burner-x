import { isPlainObject, safeInt, safeNumber, toNonEmptyString } from "../../../shared/utils/value-utils.js";
import { ensureTokenUsage, normalizeBudgetConfig } from "../utils/state-utils.js";
import { normalizeTokenUsage } from "../model/usage.js";
import {
  addTodo as addTodoLogic,
  setAwaitUserFeedback as setAwaitUserFeedbackLogic,
  setTaskImpossible as setTaskImpossibleLogic,
  addTimeline as addTimelineLogic,
  saveWriteSnapshot as saveWriteSnapshotLogic,
  reopenGaps as reopenGapsLogic,
  addNewGaps as addNewGapsLogic,
} from "../state-logic.js";

export const stateMethods = {
  addTokenUsage(usage) {
    const delta = normalizeTokenUsage(usage);
    if (!delta) return this?.L2?.tokenUsage || { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };
    const estimatedCostUSDDeltaRaw = safeNumber(usage?.estimatedCostUSD ?? usage?.costUSD);
    const estimatedCostUSDDelta = estimatedCostUSDDeltaRaw !== null ? Math.max(0, estimatedCostUSDDeltaRaw) : null;

    if (!isPlainObject(this.L2)) this.L2 = {};
    if (typeof this.L2.awaitUserFeedback !== "boolean") this.L2.awaitUserFeedback = false;
    if (typeof this.L2.taskImpossible !== "boolean") this.L2.taskImpossible = false;
    if (!toNonEmptyString(this.L2.reason)) this.L2.reason = "";
    if (!isPlainObject(this.L2.tokenUsage)) this.L2.tokenUsage = { input: 0, output: 0, total: 0, estimatedCostUSD: 0 };

    const cur = this.L2.tokenUsage;
    cur.input = (safeInt(cur.input) ?? 0) + delta.input;
    cur.output = (safeInt(cur.output) ?? 0) + delta.output;
    cur.total = (safeInt(cur.total) ?? 0) + delta.total;
    const curCost = safeNumber(cur.estimatedCostUSD) ?? 0;
    cur.estimatedCostUSD = estimatedCostUSDDelta !== null ? curCost + estimatedCostUSDDelta : curCost;
    return cur;
  },

  getBudgetConfig() {
    return normalizeBudgetConfig(this?.userConfig?.budget);
  },

  addTodo(params = {}) {
    return addTodoLogic(this, params);
  },

  setAwaitUserFeedback(value, reason) {
    return setAwaitUserFeedbackLogic(this, value, reason);
  },

  setTaskImpossible(reason) {
    return setTaskImpossibleLogic(this, reason);
  },

  addTimeline({ name, status = "info", payload } = {}) {
    return addTimelineLogic(this, { name, status, payload });
  },

  saveWriteSnapshot({ timestamp } = {}) {
    return saveWriteSnapshotLogic(this, { timestamp });
  },

  reopenGaps(gapIds, { reason, timestamp } = {}, emit = null) {
    return reopenGapsLogic(this, gapIds, { reason, timestamp }, emit);
  },

  addNewGaps(newGaps, { timestamp } = {}, emit = null) {
    return addNewGapsLogic(this, newGaps, { timestamp }, emit);
  },

  _ensureTokenUsage() {
    if (!isPlainObject(this.L2)) this.L2 = {};
    this.L2.tokenUsage = ensureTokenUsage(this.L2.tokenUsage);
    return this.L2.tokenUsage;
  },
};
