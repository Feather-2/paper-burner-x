/**
 * SoftBacktrackManager - D-Mail coordinator (PhoneWave).
 *
 * Responsibilities:
 * - Track D-Mail usage to avoid infinite loops
 * - Mark message history as superseded (soft backtrack)
 * - Insert correction messages
 * - Optionally propagate superseded markers into L3 snapshots
 */

/**
 * @typedef {import("../runtime/core/message-manager.js").MessageManager} MessageManager
 * @typedef {import("../runtime/memory/l3-storage.js").L3Storage} L3Storage
 *
 * @typedef {{ warn?: (...args: any[]) => void, info?: (...args: any[]) => void, error?: (...args: any[]) => void, debug?: (...args: any[]) => void }} LoggerLike
 *
 * @typedef {"minor"|"major"|"critical"} DMailSeverity
 *
 * @typedef {object} DMailSupersedeRange
 * @property {number|null} from
 * @property {number|null} to
 *
 * @typedef {object} DMailSignal
 * @property {string} correction
 * @property {DMailSupersedeRange|null} supersedeRange
 * @property {DMailSeverity} severity
 * @property {number} timestamp
 *
 * @typedef {object} SoftBacktrackManagerOptions
 * @property {MessageManager} messageManager
 * @property {L3Storage} [l3Storage]
 * @property {number} [maxDMails=5]
 * @property {LoggerLike} [logger]
 *
 * @typedef {object} ProcessDMailResult
 * @property {boolean} success
 * @property {number} [markedCount]
 * @property {string} [reason]
 */

/**
 * @param {DMailSignal} dmailSignal
 * @returns {{ from: number | null, to: number | null }}
 */
function resolveSupersedeRange(dmailSignal) {
    const range = dmailSignal && typeof dmailSignal === "object" ? dmailSignal.supersedeRange : null;
    const fromRaw = typeof range?.from === "number" && Number.isFinite(range.from) ? range.from : null;
    const toRaw = typeof range?.to === "number" && Number.isFinite(range.to) ? range.to : null;
    if (fromRaw === null && toRaw === null) return { from: null, to: null };
    const from = fromRaw ?? toRaw;
    const to = toRaw ?? from;
    return { from, to };
}

/**
 * @param {number} from
 * @param {number} to
 * @param {number} length
 * @returns {{ start: number, end: number } | null}
 */
function clampRange(from, to, length) {
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    if (length <= 0) return null;
    let start = Math.min(from, to);
    let end = Math.max(from, to);
    if (end < 0 || start >= length) return null;
    if (start < 0) start = 0;
    if (end >= length) end = length - 1;
    return { start, end };
}

export class SoftBacktrackManager {
    /**
     * @param {SoftBacktrackManagerOptions} options
     */
    constructor(options = {}) {
        const o = options && typeof options === "object" ? options : {};
        if (!o.messageManager) {
            throw new Error("SoftBacktrackManager requires { messageManager }");
        }

        /** @type {MessageManager} */
        this.messageManager = o.messageManager;
        /** @type {L3Storage | null} */
        this.l3Storage = o.l3Storage || null;
        /** @type {number} */
        this.maxDMails = typeof o.maxDMails === "number" && Number.isFinite(o.maxDMails) ? o.maxDMails : 5;
        /** @type {LoggerLike} */
        this._logger = o.logger || console;
        /** @type {number} */
        this._dmailCount = 0;
        /** @type {DMailSignal[]} */
        this._dmailHistory = [];
    }

    /** @returns {number} */
    get dmailCount() {
        return this._dmailCount;
    }

    /** @returns {number} */
    get remaining() {
        return Math.max(0, this.maxDMails - this._dmailCount);
    }

    /** @returns {boolean} */
    canSendDMail() {
        return this._dmailCount < this.maxDMails;
    }

    /**
     * Process a D-Mail signal into soft backtrack actions.
     * @param {DMailSignal} dmailSignal
     * @returns {Promise<ProcessDMailResult>}
     */
    async processDMailSignal(dmailSignal) {
        if (!this.canSendDMail()) {
            return { success: false, reason: "limit_reached" };
        }

        const correction = typeof dmailSignal?.correction === "string"
            ? dmailSignal.correction
            : String(dmailSignal?.correction ?? "");
        if (!correction.trim()) {
            return { success: false, reason: "invalid_correction" };
        }

        const { from, to } = resolveSupersedeRange(dmailSignal);
        let markedCount = 0;

        try {
            if (from !== null && to !== null) {
                markedCount = this.messageManager.markAsSuperseded(from, to, correction);
            } else {
                markedCount = this.messageManager.markAsSuperseded(Number.NaN, Number.NaN, correction);
            }
            this.messageManager.insertCorrectionMessage(dmailSignal);

            if (this.l3Storage && typeof this.l3Storage.markSnapshotsSuperseded === "function") {
                if (typeof this.l3Storage.init === "function") {
                    await this.l3Storage.init();
                }
                const timeline = typeof this.l3Storage.getTimeline === "function"
                    ? this.l3Storage.getTimeline({ includeSuperseded: true })
                    : [];
                const range = from !== null && to !== null ? clampRange(from, to, timeline.length) : null;
                const ids = range
                    ? timeline.slice(range.start, range.end + 1).map((e) => e?.id).filter((id) => typeof id === "string")
                    : [];
                if (ids.length > 0) {
                    await this.l3Storage.markSnapshotsSuperseded(Array.from(new Set(ids)), correction);
                } else {
                    await this.l3Storage.markSnapshotsSuperseded([], correction);
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (this._logger && typeof this._logger.error === "function") {
                this._logger.error("D-Mail processing failed", { error: msg });
            }
            return { success: false, reason: msg };
        }

        this._dmailCount += 1;
        this._dmailHistory.push(dmailSignal);
        return { success: true, markedCount };
    }

    /**
     * Return all D-Mail signals sent so far.
     * @returns {DMailSignal[]}
     */
    getDMailHistory() {
        return this._dmailHistory.slice();
    }

    /** @returns {void} */
    reset() {
        this._dmailCount = 0;
        this._dmailHistory = [];
    }
}

export default SoftBacktrackManager;
