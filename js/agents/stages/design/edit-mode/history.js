import { isPlainObject } from "../../../shared/utils/value-utils.js";

/**
 * Edit history manager with undo/redo + transaction batching.
 */
export class EditHistoryManager {
  constructor(maxHistory = 50, options = {}) {
    const limit = Number.isFinite(maxHistory) && maxHistory > 0 ? Math.floor(maxHistory) : 50;
    this.history = [];
    this.redoStack = [];
    this.maxHistory = limit;
    this.transaction = null;
    this.onUndo = typeof options.onUndo === "function" ? options.onUndo : null;
    this.onRedo = typeof options.onRedo === "function" ? options.onRedo : null;
  }

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

  beginTransaction() {
    if (this.transaction) return false;
    this.transaction = { operations: [] };
    return true;
  }

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

  rollback() {
    if (!this.transaction) return false;
    const ops = this.transaction.operations.slice().reverse();
    for (const op of ops) this._executeUndo(op);
    this.transaction = null;
    return true;
  }

  undo() {
    if (this.history.length === 0) return null;
    const entry = this.history.pop();
    this.redoStack.push(entry);
    for (const op of entry.operations.slice().reverse()) this._executeUndo(op);
    return entry;
  }

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
