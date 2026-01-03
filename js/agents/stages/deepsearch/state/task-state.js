import { toNonEmptyString } from "../../../shared/utils/value-utils.js";

export class TaskState {
  constructor(root) {
    this._root = root;
  }

  get taskGoal() {
    const memGoal = this._root?._memoryStore?.L0?.taskGoal;
    if (memGoal) return memGoal;
    return this._root?._localTaskGoal || "";
  }

  set taskGoal(value) {
    const normalized = toNonEmptyString(value) || "";
    const memoryStore = this._root?._memoryStore;
    if (memoryStore) {
      if (typeof memoryStore.setTaskGoal === "function") {
        memoryStore.setTaskGoal(normalized);
      } else if (memoryStore.L0 && typeof memoryStore.L0 === "object") {
        memoryStore.L0.taskGoal = normalized;
      }
    }
    if (this._root) this._root._localTaskGoal = normalized;
  }

  get awaitUserFeedback() {
    const mem = this._root?._memoryStore;
    if (mem && typeof mem.awaitUserFeedback === "boolean") return mem.awaitUserFeedback;
    return this._root?.L2?.awaitUserFeedback || false;
  }

  set awaitUserFeedback(value) {
    const boolValue = Boolean(value);
    if (this._root?._memoryStore) this._root._memoryStore.awaitUserFeedback = boolValue;
    if (this._root?.L2) this._root.L2.awaitUserFeedback = boolValue;
  }

  get taskImpossible() {
    const mem = this._root?._memoryStore;
    if (mem && typeof mem.taskImpossible === "boolean") return mem.taskImpossible;
    return this._root?.L2?.taskImpossible || false;
  }

  set taskImpossible(value) {
    const boolValue = Boolean(value);
    if (this._root?._memoryStore) this._root._memoryStore.taskImpossible = boolValue;
    if (this._root?.L2) this._root.L2.taskImpossible = boolValue;
  }
}
