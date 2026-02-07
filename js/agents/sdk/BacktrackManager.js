import { deepClone } from "../shared/utils/value-utils.js";

/**
 * GenericBacktrackManager - 通用回溯管理 (春秋蝉)
 * 
 * 职责：
 * - 跟踪回溯次数，防止无限循环
 * - 协调 Cicada 存档进行状态恢复
 * - 提供标准的回溯触发信号
 */

export class BacktrackManager {
    constructor(options = {}) {
        this.compressor = options.compressor || null;
        this.maxBacktracks = options.maxBacktracks ?? 3;
        this._backtrackCount = 0;
        this._logger = options.logger || console;
    }

    get backtrackCount() {
        return this._backtrackCount;
    }

    get remaining() {
        return Math.max(0, this.maxBacktracks - this._backtrackCount);
    }

    canBacktrack() {
        return !!this.compressor && this._backtrackCount < this.maxBacktracks;
    }

    /**
     * 准备回溯数据
     * @param {string} [checkpointId] - 目标快照 ID，如果不提供则回滚到上一个
     * @returns {Promise<{success: boolean, state?: any, checkpointId?: string, reason?: string, error?: string}>}
     */
    async prepareBacktrack(checkpointId) {
        if (!this.canBacktrack()) {
            return { success: false, reason: this._backtrackCount >= this.maxBacktracks ? "limit_reached" : "no_memory_system" };
        }

        let targetId = checkpointId;

        // 如果没有指定 ID，尝试通过 listArchives 找到上一个快照
        if (!targetId && this.compressor) {
            const archives = await this.compressor.listArchives({ limit: 2 });
            // archives 通常按时间倒序排列
            // 索引 0 是当前的运行点快照，索引 1 才是真正的“过去”
            if (archives.length >= 2) {
                targetId = archives[1].id;
            } else {
                // 如果只有一个存档，说明还没有产生过历史记录
                return { success: false, reason: "no_previous_checkpoint" };
            }
        }

        if (!targetId) {
            return { success: false, reason: "no_checkpoint_found" };
        }

        try {
            const snapshot = await this.compressor.restore(targetId);
            if (!snapshot) return { success: false, reason: "snapshot_not_found" };

            this._backtrackCount++;
            this._logger.info(`春秋蝉: 执行回溯 [${this._backtrackCount}/${this.maxBacktracks}] -> ${targetId}`);

            return {
                success: true,
                // 使用 deepClone 彻底断开与 Snapshot 存档的引用，防止代理循环修改回溯后的状态时污染存档
                state: deepClone(snapshot.context || snapshot),
                checkpointId: targetId
            };
        } catch (err) {
            this._logger.error("回溯失败:", err);
            return { success: false, reason: "restore_error", error: err.message };
        }
    }

    reset() {
        this._backtrackCount = 0;
    }
}

export default BacktrackManager;
