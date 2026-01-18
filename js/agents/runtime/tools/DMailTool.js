/**
 * DMail tool - Steins;Gate D-Mail (PhoneWave).
 *
 * Soft backtrack: marks a range of turns as superseded without deleting history.
 */

/**
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
 * @typedef {object} DMailToolArgs
 * @property {string} correction - Correction message to send to the past self.
 * @property {number} [supersede_from] - Starting turn to mark as superseded.
 * @property {number} [supersede_to] - Ending turn to mark as superseded (inclusive).
 * @property {DMailSeverity} [severity] - Error severity (defaults to "minor").
 *
 * @typedef {object} DMailToolOptions
 * @property {() => number} [now] - Optional timestamp provider (ms since epoch).
 */

const SEVERITY_VALUES = new Set(["minor", "major", "critical"]);

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isValidTurn(value) {
    return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/**
 * Create DMail tool handler.
 * @param {DMailToolOptions} [options]
 * @returns {Function}
 */
export function createDMailTool(options = {}) {
    const now = typeof options.now === "function" ? options.now : Date.now;

    /**
     * DMail tool implementation.
     * @param {DMailToolArgs} args
     * @param {object} context
     * @param {{ info?: (...args: any[]) => void, warn?: (...args: any[]) => void }} [context.logger]
     * @param {(event: string, payload: any) => void} [context.emit]
     * @returns {Promise<{ ok: boolean, dmail?: DMailSignal, error?: string }>}
     */
    return async function dmailHandler(args, context) {
        const { correction, supersede_from, supersede_to, severity } = args || {};
        const logger = context?.logger;
        const emit = context?.emit;

        if (typeof correction !== "string" || correction.trim().length === 0) {
            return { ok: false, error: "correction is required and must be a non-empty string." };
        }

        if (supersede_from !== undefined && !isValidTurn(supersede_from)) {
            return { ok: false, error: "supersede_from must be a non-negative integer." };
        }

        if (supersede_to !== undefined && !isValidTurn(supersede_to)) {
            return { ok: false, error: "supersede_to must be a non-negative integer." };
        }

        if (supersede_from !== undefined && supersede_to !== undefined && supersede_from > supersede_to) {
            return { ok: false, error: "supersede_from must be less than or equal to supersede_to." };
        }

        let resolvedSeverity = severity;
        if (resolvedSeverity === undefined || resolvedSeverity === null || resolvedSeverity === "") {
            resolvedSeverity = "minor";
        }

        if (typeof resolvedSeverity !== "string" || !SEVERITY_VALUES.has(resolvedSeverity)) {
            return { ok: false, error: `Invalid severity: ${severity}. Use minor, major, or critical.` };
        }

        /** @type {DMailSupersedeRange|null} */
        const supersedeRange = (supersede_from !== undefined || supersede_to !== undefined)
            ? { from: supersede_from ?? null, to: supersede_to ?? null }
            : null;

        const dmail = {
            correction,
            supersedeRange,
            severity: resolvedSeverity,
            timestamp: now(),
        };

        if (logger && typeof logger.info === "function") {
            logger.info("DMail sent (soft backtrack)", dmail);
        }

        if (typeof emit === "function") {
            emit("agent:dmailSent", dmail);
        }

        return { ok: true, dmail };
    };
}

/**
 * DMail tool definition (JSON Schema).
 */
export const DMAIL_TOOL_DEFINITION = {
    name: "DMail",
    description: "Send a correction to your past self using a soft backtrack mechanism. It does not delete history; it only marks turns as superseded/ignored.",
    parameters: {
        type: "object",
        properties: {
            correction: {
                type: "string",
                description: "Correction content telling your past self what went wrong.",
            },
            supersede_from: {
                type: "number",
                description: "Optional: turn index to start marking as superseded.",
            },
            supersede_to: {
                type: "number",
                description: "Optional: turn index to stop marking as superseded (inclusive).",
            },
            severity: {
                type: "string",
                enum: ["minor", "major", "critical"],
                default: "minor",
                description: "Severity of the mistake: minor, major, or critical.",
            },
        },
        required: ["correction"],
    },
};
