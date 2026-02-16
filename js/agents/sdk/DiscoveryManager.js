/**
 * DiscoveryManager - 发现与验证管理器 (共享黑板的逻辑层)
 * 
 * 职责:
 * 1. 维护 Gap (缺口) 和 Evidence (证据) 的语义状态。
 * 2. 识别不同 Source/Subagent 之间的冲突。
 * 3. 协调交叉验证任务。
 */

import { isPlainObject, toNonEmptyString } from "../shared/index.js";
import { makeSecureTimestampedId } from "../shared/index.js";

/**
 * @typedef {Record<string, any>} AnyRecord
 *
 * @typedef {AnyRecord & { debug?: (...args: any[]) => void, info?: (...args: any[]) => void, warn?: (...args: any[]) => void, error?: (...args: any[]) => void }} LoggerLike
 *
 * @typedef {(eventName: string, payload: any) => void} EmitFn
 *
 * @typedef {"open" | "partial" | "satisfied" | "contradicted" | "verifying" | "blocked"} DiscoveryStatusType
 *
 * @typedef {AnyRecord & { status?: DiscoveryStatusType, keywords?: string[], id?: string }} DiscoveryRecord
 *
 * @typedef {AnyRecord & { discoveryId?: string, sourceId?: string, snippet?: string, confidence?: number, query?: string, ts?: number }} EvidenceRecord
 *
 * @typedef {object} SharedContextLike
 * @property {(record: AnyRecord) => void} upsertSignal
 * @property {(id: string, value: AnyRecord) => void} store
 * @property {(key: string, id: string) => void} addToIndex
 * @property {(key: string) => string[]} search
 * @property {(id: string) => AnyRecord | null | undefined} getDetail
 * @property {(predicate: (signal: AnyRecord) => boolean) => AnyRecord[]} getSignals
 * @property {(tableName: string) => AnyRecord[]} getSyncTable
 *
 * @typedef {object} DiscoveryManagerOptions
 * @property {SharedContextLike | null} [sharedContext]
 * @property {string} [runId]
 * @property {LoggerLike} [logger]
 * @property {EmitFn} [emit]
 */

/** @type {Readonly<{ OPEN: DiscoveryStatusType, PARTIAL: DiscoveryStatusType, SATISFIED: DiscoveryStatusType, CONTRADICTED: DiscoveryStatusType, VERIFYING: DiscoveryStatusType, BLOCKED: DiscoveryStatusType }>} */
export const DiscoveryStatus = Object.freeze({
    OPEN: "open",           // 初始状态
    PARTIAL: "partial",     // 部分满足，需要更多细节
    SATISFIED: "satisfied", // 已满足
    CONTRADICTED: "contradicted", // 存在冲突
    VERIFYING: "verifying", // 正在验证中
    BLOCKED: "blocked",     // 无法完成
});

export class DiscoveryManager {
    /**
     * @param {DiscoveryManagerOptions} [options]
     */
    constructor(options = {}) {
        /** @type {SharedContextLike | null | undefined} */
        this.sharedContext = options.sharedContext;
        /** @type {string | undefined} */
        this.runId = options.runId;
        /** @type {LoggerLike} */
        this.logger = options.logger;
        /** @type {EmitFn | undefined} */
        this.emit = options.emit;
    }

    /**
     * 记录一项目标发现 (Gap 或 Claim)
     * @param {string} id
     * @param {DiscoveryRecord} data
     * @returns {void}
     */
    upsertDiscovery(id, data) {
        if (!this.sharedContext) return;

        this.sharedContext.upsertSignal({
            type: "discovery",
            id,
            status: data.status || DiscoveryStatus.OPEN,
            keywords: data.keywords || [],
            ...data,
            ts: Date.now()
        });
    }

    /**
     * 记录一条证据 (Evidence)
     * @param {string} discoveryId
     * @param {EvidenceRecord} evidence
     * @returns {string | undefined}
     */
    addEvidence(discoveryId, evidence) {
        if (!this.sharedContext) return;

        const evidenceId = makeSecureTimestampedId("ev");
        this.sharedContext.store(evidenceId, {
            discoveryId,
            ...evidence,
            ts: Date.now()
        });

        // 更新索引，方便查找
        this.sharedContext.addToIndex(`evidence:${discoveryId}`, evidenceId);

        // 检查冲突
        this._checkConflicts(discoveryId);

        return evidenceId;
    }

    /**
     * 获取某项发现的所有证据
     * @param {string} discoveryId
     * @returns {EvidenceRecord[]}
     */
    getEvidences(discoveryId) {
        if (!this.sharedContext) return [];
        const ids = this.sharedContext.search(`evidence:${discoveryId}`);
        return ids.map(id => this.sharedContext.getDetail(id)).filter(Boolean);
    }

    /**
     * 识别冲突 (解决模式 2-3)
     * @param {string} discoveryId
     * @returns {void}
     */
    _checkConflicts(discoveryId) {
        const evidences = this.getEvidences(discoveryId);
        if (evidences.length < 2) return;

        // 简单启发式冲突检测
        const sourceIds = new Set(evidences.map(e => e.sourceId).filter(Boolean));
        if (sourceIds.size > 1) {
            // TODO: implement actual conflict detection logic
            // 标记为存疑，提醒模型进行交叉验证
            // 具体判定仍由 evaluate-gaps skill 或模型逻辑决定
            // Placeholder: no-op until conflict semantics are defined
        }
    }

    /**
     * @param {string} id
     * @returns {DiscoveryRecord | null}
     */
    getDiscovery(id) {
        if (!this.sharedContext) return null;
        const signals = this.sharedContext.getSignals(s => s.payload?._syncKey === `discovery:${id}`);
        return signals[0]?.payload || null;
    }

    /**
     * 获取所有发现及其实时状态
     * @returns {DiscoveryRecord[]}
     */
    getAllDiscoveries() {
        if (!this.sharedContext) return [];
        return this.sharedContext.getSyncTable("discovery");
    }

    /**
     * 获取待验证的任务
     * @returns {DiscoveryRecord[]}
     */
    getConflictTasks() {
        return this.getAllDiscoveries().filter(d => d.status === DiscoveryStatus.CONTRADICTED);
    }

    /**
     * 评估缺口状态
     * @param {string} id
     * @param {DiscoveryRecord} data
     * @returns {void}
     */
    evaluateGap(id, data) {
        this.upsertDiscovery(id, data);
        if (this.emit) {
            this.emit("deepsearch:gapEvaluated", {
                payload: { gapId: id, ...data }
            });
        }
    }
}

export default DiscoveryManager;
