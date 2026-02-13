/**
 * @file Resource quota enforcement for sandbox environments.
 * Prevents runaway Agent code from exhausting browser resources.
 */

/**
 * @typedef {object} QuotaConfig
 * @property {number} [maxMemoryMB=50] - Max memory usage in MB
 * @property {number} [maxNetworkRequests=100] - Max HTTP requests
 * @property {number} [maxFileWrites=500] - Max file write operations
 * @property {number} [maxFileReadsMB=100] - Max total file reads in MB
 */

/**
 * @typedef {object} QuotaStats
 * @property {number} memoryMB - Current memory usage estimate
 * @property {number} networkRequests - Network requests made
 * @property {number} fileWrites - File writes performed
 * @property {number} fileReadsMB - Total file reads in MB
 */

export class QuotaEnforcer {
  /**
   * @param {QuotaConfig} config
   */
  constructor(config = {}) {
    this.limits = {
      maxMemoryMB: config.maxMemoryMB ?? 50,
      maxNetworkRequests: config.maxNetworkRequests ?? 100,
      maxFileWrites: config.maxFileWrites ?? 500,
      maxFileReadsMB: config.maxFileReadsMB ?? 100,
    };

    this.stats = {
      memoryMB: 0,
      networkRequests: 0,
      fileWrites: 0,
      fileReadsMB: 0,
    };
  }

  /**
   * @param {number} bytes
   * @throws {Error} if quota exceeded
   */
  trackMemory(bytes) {
    this.stats.memoryMB += bytes / (1024 * 1024);
    if (this.stats.memoryMB > this.limits.maxMemoryMB) {
      throw new Error(`Memory quota exceeded: ${this.stats.memoryMB.toFixed(1)}MB > ${this.limits.maxMemoryMB}MB`);
    }
  }

  /**
   * @throws {Error} if quota exceeded
   */
  trackNetworkRequest() {
    this.stats.networkRequests++;
    if (this.stats.networkRequests > this.limits.maxNetworkRequests) {
      throw new Error(`Network quota exceeded: ${this.stats.networkRequests} > ${this.limits.maxNetworkRequests}`);
    }
  }

  /**
   * @throws {Error} if quota exceeded
   */
  trackFileWrite() {
    this.stats.fileWrites++;
    if (this.stats.fileWrites > this.limits.maxFileWrites) {
      throw new Error(`File write quota exceeded: ${this.stats.fileWrites} > ${this.limits.maxFileWrites}`);
    }
  }

  /**
   * @param {number} bytes
   * @throws {Error} if quota exceeded
   */
  trackFileRead(bytes) {
    this.stats.fileReadsMB += bytes / (1024 * 1024);
    if (this.stats.fileReadsMB > this.limits.maxFileReadsMB) {
      throw new Error(`File read quota exceeded: ${this.stats.fileReadsMB.toFixed(1)}MB > ${this.limits.maxFileReadsMB}MB`);
    }
  }

  /** @returns {QuotaStats} */
  getStats() {
    return { ...this.stats };
  }

  reset() {
    this.stats = { memoryMB: 0, networkRequests: 0, fileWrites: 0, fileReadsMB: 0 };
  }
}
