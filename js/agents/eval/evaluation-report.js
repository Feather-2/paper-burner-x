const SCHEMA_VERSION = "0.1";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * @typedef {object} EvaluationReport
 * @property {string} schemaVersion
 * @property {string} runId
 * @property {{pass:boolean,failed:string[],details?:object}} hardGates
 * @property {{score:number,breakdown?:object}=} scenarioScore
 * @property {object=} metrics
 * @property {string=} notes
 */

/**
 * @param {string} runId
 * @param {{pass:boolean,failed?:string[],details?:object}} hardGates
 * @param {{score:number,breakdown?:object}=} scenarioScore
 * @param {object=} metrics
 * @param {{notes?:string}=} options
 * @returns {EvaluationReport}
 */
export function generateEvaluationReport(runId, hardGates, scenarioScore, metrics, options = {}) {
  if (!runId || typeof runId !== "string") throw new Error("generateEvaluationReport(runId,...): runId must be a string");
  if (!isPlainObject(hardGates) || typeof hardGates.pass !== "boolean") {
    throw new Error("generateEvaluationReport(runId, hardGates,...): hardGates.pass is required");
  }

  const report = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    hardGates: {
      pass: !!hardGates.pass,
      failed: Array.isArray(hardGates.failed) ? hardGates.failed.map((s) => String(s)) : [],
      ...(isPlainObject(hardGates.details) ? { details: hardGates.details } : {}),
    },
    ...(scenarioScore && typeof scenarioScore === "object" ? { scenarioScore } : {}),
    ...(metrics && typeof metrics === "object" ? { metrics } : {}),
    ...(options?.notes ? { notes: String(options.notes) } : {}),
  };

  return report;
}

export const EvaluationReportConstants = {
  SCHEMA_VERSION,
};

