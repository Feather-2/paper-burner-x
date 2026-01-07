import { isPlainObject } from "../../../shared/utils/value-utils.js";

/**
 * @typedef {object} EditOperation
 * @property {(() => any)=} undo
 * @property {(() => any)=} redo
 */

/**
 * @typedef {object} EditHistoryEntry
 * @property {EditOperation[]} operations
 * @property {number} timestamp
 */

/**
 * @typedef {object} EditHistoryOptions
 * @property {(op: EditOperation) => any} [onUndo]
 * @property {(op: EditOperation) => any} [onRedo]
 */

/**
 * Edit history manager with undo/redo + transaction batching.
 */
export class EditHistoryManager {
  /**
   * @param {number} [maxHistory=50]
   * @param {EditHistoryOptions} [options]
   */
  constructor(maxHistory = 50, options = {}) {
    const limit = Number.isFinite(maxHistory) && maxHistory > 0 ? Math.floor(maxHistory) : 50;
    this.history = [];
    this.redoStack = [];
    this.maxHistory = limit;
    this.transaction = null;
    this.onUndo = typeof options.onUndo === "function" ? options.onUndo : null;
    this.onRedo = typeof options.onRedo === "function" ? options.onRedo : null;
  }

  /**
   * @param {EditOperation} operation
   * @returns {boolean}
   */
  push(operation) {
    if (!isPlainObject(operation)) return false;
    if (this.transaction) {
      this.transaction.operations.push(operation);
      return true;
    }

    this.history.push({ operations: [operation], timestamp: Date.now() });
    this.redoStack = [];
    this._trimHistory();
    return true;
  }

  /**
   * @returns {boolean}
   */
  beginTransaction() {
    if (this.transaction) return false;
    this.transaction = { operations: [] };
    return true;
  }

  /**
   * @returns {boolean}
   */
  commit() {
    if (!this.transaction) return false;
    if (this.transaction.operations.length > 0) {
      this.history.push({
        operations: this.transaction.operations,
        timestamp: Date.now(),
      });
      this.redoStack = [];
      this._trimHistory();
    }
    this.transaction = null;
    return true;
  }

  /**
   * @returns {boolean}
   */
  rollback() {
    if (!this.transaction) return false;
    const ops = this.transaction.operations.slice().reverse();
    for (const op of ops) this._executeUndo(op);
    this.transaction = null;
    return true;
  }

  /**
   * @returns {EditHistoryEntry | null}
   */
  undo() {
    if (this.history.length === 0) return null;
    const entry = this.history.pop();
    this.redoStack.push(entry);
    for (const op of entry.operations.slice().reverse()) this._executeUndo(op);
    return entry;
  }

  /**
   * @returns {EditHistoryEntry | null}
   */
  redo() {
    if (this.redoStack.length === 0) return null;
    const entry = this.redoStack.pop();
    this.history.push(entry);
    for (const op of entry.operations) this._executeRedo(op);
    return entry;
  }

  _executeUndo(operation) {
    if (typeof operation.undo === "function") return operation.undo();
    if (this.onUndo) return this.onUndo(operation);
    return undefined;
  }

  _executeRedo(operation) {
    if (typeof operation.redo === "function") return operation.redo();
    if (this.onRedo) return this.onRedo(operation);
    return undefined;
  }

  _trimHistory() {
    while (this.history.length > this.maxHistory) this.history.shift();
  }
}
