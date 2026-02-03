/**
 * AdaptiveZoneManager - 自适应区域管理器
 *
 * 实现"远模糊、近精确"的上下文分区策略：
 * - Archive (0-20%): 重度压缩，仅保留结论
 * - Condensed (20-50%): 中度压缩，thinking → 决策点
 * - Working (50-80%): 轻度压缩，保留 thinking
 * - Active (80-100%): 无压缩，完整保留
 *
 * 区域边界根据消息密度动态调整。
 *
 * @module runtime/compression/adaptive-zone-manager
 */

/**
 * @typedef {Object} ZoneBoundaries
 * @property {number} archive - Archive 区结束点 (0-1)
 * @property {number} condensed - Condensed 区结束点 (0-1)
 * @property {number} working - Working 区结束点 (0-1)
 */

/**
 * @typedef {'archive'|'condensed'|'working'|'active'} ZoneName
 */

/**
 * @typedef {Object} ZoneConfig
 * @property {ZoneName} name
 * @property {number} start - 区域起始填充率
 * @property {number} end - 区域结束填充率
 * @property {string} compressionLevel - 压缩级别描述
 * @property {boolean} preserveThinking - 是否保留 thinking
 * @property {boolean} summarizeThinking - 是否摘要 thinking
 */

/**
 * @typedef {Object} AdaptiveZoneManagerOptions
 * @property {ZoneBoundaries} [defaultBoundaries]
 * @property {number} [densityWeight] - 密度调整权重 (0-1)
 */

const DEFAULT_BOUNDARIES = Object.freeze({
  archive: 0.2,
  condensed: 0.5,
  working: 0.8,
});

export class AdaptiveZoneManager {
  /** @type {ZoneBoundaries} */
  _defaultBoundaries;
  /** @type {ZoneBoundaries} */
  _currentBoundaries;
  /** @type {number} */
  _densityWeight;
  /** @type {{ archive: number, condensed: number, working: number, active: number }} */
  _zoneDensities;

  /**
   * @param {AdaptiveZoneManagerOptions} [options]
   */
  constructor({
    defaultBoundaries = DEFAULT_BOUNDARIES,
    densityWeight = 0.3,
  } = {}) {
    this._defaultBoundaries = { ...DEFAULT_BOUNDARIES, ...defaultBoundaries };
    this._currentBoundaries = { ...this._defaultBoundaries };
    this._densityWeight = Math.min(1, Math.max(0, densityWeight));

    // 区域内消息密度（tokens/message）
    this._zoneDensities = {
      archive: 0,
      condensed: 0,
      working: 0,
      active: 0,
    };
  }

  /**
   * 获取当前区域边界
   * @returns {ZoneBoundaries}
   */
  getBoundaries() {
    return { ...this._currentBoundaries };
  }

  /**
   * 根据填充率确定所在区域
   * @param {number} fillRatio - 0-1
   * @returns {ZoneName}
   */
  getZone(fillRatio) {
    const b = this._currentBoundaries;
    if (fillRatio < b.archive) return "archive";
    if (fillRatio < b.condensed) return "condensed";
    if (fillRatio < b.working) return "working";
    return "active";
  }

  /**
   * 获取区域配置
   * @param {ZoneName} zone
   * @returns {ZoneConfig}
   */
  getZoneConfig(zone) {
    const b = this._currentBoundaries;

    /** @type {Record<ZoneName, ZoneConfig>} */
    const configs = {
      archive: {
        name: "archive",
        start: 0,
        end: b.archive,
        compressionLevel: "heavy",
        preserveThinking: false,
        summarizeThinking: false, // 完全丢弃 thinking，仅保留结论
      },
      condensed: {
        name: "condensed",
        start: b.archive,
        end: b.condensed,
        compressionLevel: "medium",
        preserveThinking: false,
        summarizeThinking: true, // thinking → 决策摘要
      },
      working: {
        name: "working",
        start: b.condensed,
        end: b.working,
        compressionLevel: "light",
        preserveThinking: true, // 保留 thinking
        summarizeThinking: false,
      },
      active: {
        name: "active",
        start: b.working,
        end: 1.0,
        compressionLevel: "none",
        preserveThinking: true,
        summarizeThinking: false,
      },
    };

    return configs[zone] || configs.active;
  }

  /**
   * 更新区域密度信息
   * @param {ZoneName} zone
   * @param {number} avgTokensPerMessage
   */
  updateDensity(zone, avgTokensPerMessage) {
    if (zone in this._zoneDensities) {
      // 指数移动平均
      const alpha = 0.3;
      const prev = this._zoneDensities[zone];
      this._zoneDensities[zone] = prev > 0
        ? prev * (1 - alpha) + avgTokensPerMessage * alpha
        : avgTokensPerMessage;

      this._adjustBoundaries();
    }
  }

  /**
   * 根据密度动态调整边界
   * @private
   */
  _adjustBoundaries() {
    const densities = this._zoneDensities;
    const totalDensity = Object.values(densities).reduce((a, b) => a + b, 0);

    if (totalDensity <= 0) return;

    // 密度高的区域应该缩小（因为消息更长，占更多 tokens）
    const avgDensity = totalDensity / 4;

    // 计算调整因子
    const archiveAdjust = densities.archive > 0
      ? (avgDensity / densities.archive - 1) * this._densityWeight
      : 0;
    const condensedAdjust = densities.condensed > 0
      ? (avgDensity / densities.condensed - 1) * this._densityWeight
      : 0;

    // 应用调整，但限制在合理范围内
    const newArchive = Math.min(0.3, Math.max(0.1,
      this._defaultBoundaries.archive * (1 + archiveAdjust * 0.2)
    ));
    const newCondensed = Math.min(0.6, Math.max(0.3,
      this._defaultBoundaries.condensed * (1 + condensedAdjust * 0.2)
    ));
    const newWorking = Math.min(0.85, Math.max(0.6,
      this._defaultBoundaries.working
    ));

    // 确保边界递增
    this._currentBoundaries = {
      archive: newArchive,
      condensed: Math.max(newArchive + 0.1, newCondensed),
      working: Math.max(newCondensed + 0.1, newWorking),
    };
  }

  /**
   * 获取消息应该使用的压缩策略
   * @param {number} messageIndex - 消息索引（0-based，0 最旧）
   * @param {number} totalMessages - 总消息数
   * @param {number} fillRatio - 当前填充率
   * @returns {{ zone: ZoneName, config: ZoneConfig, messageRatio: number }}
   */
  getCompressionStrategy(messageIndex, totalMessages, fillRatio) {
    if (totalMessages <= 0) {
      const zone = "active";
      return { zone, config: this.getZoneConfig(zone), messageRatio: 1 };
    }

    // 消息位置比例（0 = 最旧，1 = 最新）
    const messageRatio = messageIndex / totalMessages;

    // 将消息位置映射到填充率空间
    // 假设消息均匀分布在 0 到 fillRatio 之间
    const estimatedFillPosition = messageRatio * fillRatio;

    const zone = this.getZone(estimatedFillPosition);
    const config = this.getZoneConfig(zone);

    return { zone, config, messageRatio };
  }

  /**
   * 批量计算所有消息的压缩策略
   * @param {Array} messages
   * @param {number} fillRatio
   * @returns {Array<{ index: number, zone: ZoneName, config: ZoneConfig }>}
   */
  computeStrategies(messages, fillRatio) {
    const total = messages.length;
    return messages.map((_, index) => {
      const { zone, config } = this.getCompressionStrategy(index, total, fillRatio);
      return { index, zone, config };
    });
  }

  /**
   * 获取区域统计
   * @param {Array} messages
   * @param {number} fillRatio
   * @returns {{ archive: number, condensed: number, working: number, active: number }}
   */
  getZoneStats(messages, fillRatio) {
    const stats = { archive: 0, condensed: 0, working: 0, active: 0 };
    const strategies = this.computeStrategies(messages, fillRatio);

    for (const { zone } of strategies) {
      stats[zone]++;
    }

    return stats;
  }

  /**
   * 重置为默认边界
   */
  reset() {
    this._currentBoundaries = { ...this._defaultBoundaries };
    this._zoneDensities = { archive: 0, condensed: 0, working: 0, active: 0 };
  }
}

export default AdaptiveZoneManager;
