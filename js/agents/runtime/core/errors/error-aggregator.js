/**
 * Error Aggregator - 按指纹聚合错误统计
 *
 * @module runtime/errors/error-aggregator
 */

import { computeErrorFingerprint } from './error-fingerprint.js';
import { classifyError } from './error-taxonomy.js';

const ONE_HOUR_MS = 3600_000;
const MAX_FINGERPRINTS = 1000;

/**
 * @typedef {Object} AggregatedError
 * @property {string} fingerprint
 * @property {string} taxonomy
 * @property {boolean} retryable
 * @property {number} count
 * @property {number} firstSeen
 * @property {number} lastSeen
 * @property {number[]} timestamps - 最近 1h 内的时间戳
 * @property {Set<string>} affectedRuns
 * @property {{ name: string, message: string }} sample
 */

export class ErrorAggregator {
  constructor() {
    /** @type {Map<string, AggregatedError>} */
    this._entries = new Map();
  }

  /**
   * 记录一个错误
   * @param {Error | unknown} error
   * @param {{ runId?: string }} [context]
   * @returns {{ fingerprint: string, taxonomy: string, retryable: boolean, count: number }}
   */
  record(error, context = {}) {
    const err = error instanceof Error ? error : { name: 'Error', message: String(error) };
    const fingerprint = computeErrorFingerprint(err);
    const { taxonomy, retryable } = classifyError(err);
    const now = Date.now();

    let entry = this._entries.get(fingerprint);
    if (!entry) {
      // 容量控制：淘汰最旧的
      if (this._entries.size >= MAX_FINGERPRINTS) {
        let oldestKey = null;
        let oldestTime = Infinity;
        for (const [k, v] of this._entries) {
          if (v.lastSeen < oldestTime) {
            oldestTime = v.lastSeen;
            oldestKey = k;
          }
        }
        if (oldestKey) this._entries.delete(oldestKey);
      }

      entry = {
        fingerprint,
        taxonomy,
        retryable,
        count: 0,
        firstSeen: now,
        lastSeen: now,
        timestamps: [],
        affectedRuns: new Set(),
        sample: {
          name: err.name || 'Error',
          message: typeof err.message === 'string' ? err.message.slice(0, 500) : '',
        },
      };
      this._entries.set(fingerprint, entry);
    }

    entry.count++;
    entry.lastSeen = now;
    entry.timestamps.push(now);
    // 只保留最近 1h 的时间戳
    const cutoff = now - ONE_HOUR_MS;
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);

    if (context.runId) {
      entry.affectedRuns.add(context.runId);
    }

    return { fingerprint, taxonomy, retryable, count: entry.count };
  }

  /**
   * 获取所有聚合统计
   * @returns {Array<{ fingerprint: string, taxonomy: string, retryable: boolean, count: number, firstSeen: number, lastSeen: number, frequency1h: number, affectedRunCount: number, sample: { name: string, message: string } }>}
   */
  getStats() {
    const now = Date.now();
    const cutoff = now - ONE_HOUR_MS;
    const result = [];

    for (const entry of this._entries.values()) {
      const recentCount = entry.timestamps.filter(t => t > cutoff).length;
      result.push({
        fingerprint: entry.fingerprint,
        taxonomy: entry.taxonomy,
        retryable: entry.retryable,
        count: entry.count,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen,
        frequency1h: recentCount,
        affectedRunCount: entry.affectedRuns.size,
        sample: entry.sample,
      });
    }

    return result.sort((a, b) => b.count - a.count);
  }

  /**
   * 获取 top N 高频错误
   * @param {number} [n=10]
   */
  getTopErrors(n = 10) {
    return this.getStats().slice(0, n);
  }

  /** 清空 */
  reset() {
    this._entries.clear();
  }

  /** @returns {number} */
  get size() {
    return this._entries.size;
  }
}
