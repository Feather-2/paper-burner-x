/**
 * DesignCheckpoints - 管理设计黑板版本快照
 */

import { toNonEmptyString, isPlainObject } from "../../../shared/index.js";
import { deepClone } from "../../../shared/utils/value-utils.js";

function cloneValue(value) {
  if (value === null || value === undefined) return value;
  return deepClone(value);
}

function normalizeMaxVersions(value, fallback = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.floor(n));
}

/**
 * @param {any} snapshot
 * @returns {boolean}
 */
function isDesignStateSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) return false;
  return (
    Object.prototype.hasOwnProperty.call(snapshot, "summaries") ||
    Object.prototype.hasOwnProperty.call(snapshot, "signals") ||
    Object.prototype.hasOwnProperty.call(snapshot, "decisions") ||
    Object.prototype.hasOwnProperty.call(snapshot, "deck")
  );
}

export class DesignCheckpoints {
  /**
   * @param {{ designState?: any, maxVersions?: number }} [options]
   */
  constructor({ designState = null, maxVersions } = {}) {
    this._designState = designState || null;
    this._maxVersions = normalizeMaxVersions(maxVersions, 200);
    this._versions = [];
    this._currentVersion = null;
  }

  get versions() {
    return this._versions;
  }

  /**
   * @param {any} versions
   */
  set versions(versions) {
    this._versions = this._normalizeVersions(versions);
    this._trimToLimit();
  }

  /**
   * @param {any} designState
   */
  setDesignState(designState) {
    this._designState = designState || null;
  }

  /**
   * @param {any} designState
   * @param {any} [label]
   * @param {any} [snapshot]
   * @returns {{label: string, snapshot: any, timestamp: number}}
   */
  saveVersion(designState, label, snapshot) {
    const stateRef = designState || this._designState;
    const payload = snapshot === undefined ? cloneValue(stateRef?.toJSON?.()) : snapshot;
    const version = {
      label: toNonEmptyString(label) || `v${this._versions.length + 1}`,
      snapshot: payload,
      timestamp: Date.now(),
    };
    this._versions.push(version);
    this._trimToLimit();
    return version;
  }

  /**
   * @param {any} index
   * @returns {any|null}
   */
  getVersion(index) {
    if (typeof index === "number" && Number.isInteger(index)) {
      return this._versions[index] || null;
    }
    const label = toNonEmptyString(index);
    if (!label) return null;
    return this._versions.find((version) => version.label === label) || null;
  }

  /**
   * @returns {{label: string, timestamp: number}[]}
   */
  listVersions() {
    return this._versions.map((version) => ({ label: version.label, timestamp: version.timestamp }));
  }

  /**
   * @param {any} index
   * @param {any} [designState]
   * @returns {any|null}
   */
  restoreVersion(index, designState = null) {
    const version = this.getVersion(index);
    if (!version) return null;
    this._currentVersion = version.label;

    const snapshot = cloneValue(version.snapshot) ?? null;
    const targetState = designState || null;
    if (targetState && snapshot && isDesignStateSnapshot(snapshot) && typeof targetState.fromJSON === "function") {
      targetState.fromJSON(snapshot);
    }
    return snapshot;
  }

  /**
   * @returns {{ versions: any[] }}
   */
  toJSON() {
    return {
      versions: this._versions.map((version) => ({
        label: version.label,
        snapshot: cloneValue(version.snapshot),
        timestamp: version.timestamp,
      })),
    };
  }

  /**
   * @param {any} data
   * @returns {DesignCheckpoints}
   */
  fromJSON(data) {
    const source = Array.isArray(data) ? data : data?.versions;
    this._versions = this._normalizeVersions(source);
    this._trimToLimit();
    return this;
  }

  /**
   * @param {any} source
   * @returns {any[]}
   */
  _normalizeVersions(source) {
    return Array.isArray(source)
      ? source
          .map((version, index) => {
            const raw = isPlainObject(version) ? version : {};
            return {
              label: toNonEmptyString(raw.label) || `v${index + 1}`,
              snapshot: cloneValue(raw.snapshot),
              timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
            };
          })
          .filter(Boolean)
      : [];
  }

  _trimToLimit() {
    if (this._versions.length <= this._maxVersions) return;
    const extra = this._versions.length - this._maxVersions;
    this._versions.splice(0, extra);
    if (this._currentVersion && !this._versions.some((v) => v.label === this._currentVersion)) {
      this._currentVersion = this._versions.length ? this._versions[this._versions.length - 1].label : null;
    }
  }
}
