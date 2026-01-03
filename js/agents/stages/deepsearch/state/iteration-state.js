import { isPlainObject, safeInt, toNonEmptyString } from "../../../shared/utils/value-utils.js";

export class IterationState {
  constructor(root) {
    this._root = root;
  }

  get iteration() {
    return safeInt(this._root?.iteration) ?? 0;
  }

  set iteration(value) {
    if (this._root) this._root.iteration = safeInt(value) ?? 0;
  }

  get phase() {
    return toNonEmptyString(this._root?.L2?.phase) || "";
  }

  set phase(value) {
    if (!this._root) return;
    if (!isPlainObject(this._root.L2)) this._root.L2 = {};
    this._root.L2.phase = toNonEmptyString(value) || "";
  }

  get gaps() {
    if (!this._root) return [];
    if (!isPlainObject(this._root.L1)) this._root.L1 = {};
    if (!Array.isArray(this._root.L1.gaps)) this._root.L1.gaps = [];
    return this._root.L1.gaps;
  }

  set gaps(value) {
    if (!this._root) return;
    if (!isPlainObject(this._root.L1)) this._root.L1 = {};
    this._root.L1.gaps = Array.isArray(value) ? value : [];
  }

  get chunks() {
    if (!this._root) return [];
    if (!isPlainObject(this._root.L2)) this._root.L2 = {};
    if (!Array.isArray(this._root.L2.retrievedChunks)) this._root.L2.retrievedChunks = [];
    return this._root.L2.retrievedChunks;
  }

  set chunks(value) {
    if (!this._root) return;
    if (!isPlainObject(this._root.L2)) this._root.L2 = {};
    this._root.L2.retrievedChunks = Array.isArray(value) ? value : [];
  }
}
