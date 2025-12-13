const SCHEMA_VERSION = "0.1";

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function generateRunId(now = new Date(), rand = Math.random) {
  const yyyy = now.getFullYear();
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const HH = pad2(now.getHours());
  const MM = pad2(now.getMinutes());
  const SS = pad2(now.getSeconds());

  const suffix = Math.floor(rand() * 0xfffff)
    .toString(16)
    .padStart(5, "0");

  return `run_${yyyy}-${mm}-${dd}_${HH}-${MM}-${SS}_${suffix}`;
}

function toOptionalString(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function toOptionalInt(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

export function parseConstraints(input = {}) {
  const raw = input && typeof input === "object" ? input : {};

  const audience = toOptionalString(raw.audience);
  const tone = toOptionalString(raw.tone);
  const pageCount = toOptionalInt(raw.pageCount);
  const citationsPolicy = toOptionalString(raw.citationsPolicy);
  const qualityMode = toOptionalString(raw.qualityMode);

  return {
    ...(audience ? { audience } : {}),
    ...(tone ? { tone } : {}),
    ...(typeof pageCount === "number" ? { pageCount } : {}),
    ...(citationsPolicy ? { citationsPolicy } : {}),
    ...(qualityMode ? { qualityMode } : {}),
  };
}

export class RunContext {
  constructor({ runId, mode, scenario, constraints } = {}) {
    this.schemaVersion = SCHEMA_VERSION;
    this.runId = runId || generateRunId();
    this.mode = mode || "textprep";
    this.scenario = scenario;
    this.constraints = parseConstraints(constraints);
    this.startedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      schemaVersion: this.schemaVersion,
      runId: this.runId,
      mode: this.mode,
      ...(this.scenario ? { scenario: this.scenario } : {}),
      constraints: this.constraints,
      startedAt: this.startedAt,
    };
  }
}

