/**
 * Block Manifest Schema (aligned with A2A AgentManifest).
 */
export const BlockManifestSchema = {
  // Basic metadata
  name: "string",
  version: "string",
  description: "string",

  // Capabilities
  capabilities: ["string"],

  // Input/Output contracts
  input: "JSONSchema",
  output: "JSONSchema",

  // Assembly hints
  whenToUse: "string",
  dependsOn: ["string"],
  incompatibleWith: ["string"],

  // Cost estimation
  estimatedCost: "low|medium|high",
  estimatedTokens: "number",

  // Execution config
  timeoutMs: "number",
  retryable: "boolean",
};

const COST_LEVELS = new Set(["low", "medium", "high"]);

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => isNonEmptyString(item));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates a BlockManifest.
 * @param {object} manifest
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateBlockManifest(manifest) {
  const errors = [];

  if (!isPlainObject(manifest)) {
    return { ok: false, errors: ["manifest must be an object"] };
  }

  if (!isNonEmptyString(manifest.name)) errors.push("name must be a non-empty string");
  if (!isNonEmptyString(manifest.version)) errors.push("version must be a non-empty string");
  if (!isNonEmptyString(manifest.description)) errors.push("description must be a non-empty string");

  if (!isStringArray(manifest.capabilities)) errors.push("capabilities must be an array of strings");

  if (!isPlainObject(manifest.input)) errors.push("input must be an object");
  if (!isPlainObject(manifest.output)) errors.push("output must be an object");

  if (!isNonEmptyString(manifest.whenToUse)) errors.push("whenToUse must be a non-empty string");
  if (!isStringArray(manifest.dependsOn)) errors.push("dependsOn must be an array of strings");
  if (!isStringArray(manifest.incompatibleWith)) errors.push("incompatibleWith must be an array of strings");

  if (typeof manifest.estimatedCost !== "string" || !COST_LEVELS.has(manifest.estimatedCost)) {
    errors.push("estimatedCost must be one of low, medium, high");
  }

  if (!isFiniteNumber(manifest.estimatedTokens)) errors.push("estimatedTokens must be a number");
  if (!isFiniteNumber(manifest.timeoutMs)) errors.push("timeoutMs must be a number");
  if (typeof manifest.retryable !== "boolean") errors.push("retryable must be a boolean");

  return { ok: errors.length === 0, errors };
}

export const RetrieveBlockManifest = {
  name: "retrieve",
  version: "1.0.0",
  description: "Retrieve relevant evidence chunks from sources.",
  capabilities: ["search", "rerank", "filter"],
  input: {
    type: "object",
    properties: {
      state: { type: "object", description: "DeepSearchState with sources and gaps" },
      gaps: { type: "array", description: "Knowledge gaps to fill" },
      sources: { type: "array", description: "Sources to search" },
    },
    required: ["state"],
  },
  output: {
    type: "object",
    properties: {
      retrievedChunks: { type: "array" },
      hitCount: { type: "number" },
    },
  },
  whenToUse: "Use when you need evidence or citations from documents.",
  dependsOn: ["scan"],
  incompatibleWith: [],
  estimatedCost: "medium",
  estimatedTokens: 5000,
  timeoutMs: 30000,
  retryable: true,
};

export const ScanBlockManifest = {
  name: "scan",
  version: "1.0.0",
  description: "Scan sources to locate candidate segments and gaps.",
  capabilities: ["scan", "segment", "classify"],
  input: {
    type: "object",
    properties: {
      sources: { type: "array", description: "Sources to scan" },
      taskGoal: { type: "string", description: "Task goal or question to guide scanning" },
      userConfig: { type: "object", description: "User configuration for scan heuristics" },
      hints: { type: "array", description: "Optional hints for scanning" },
    },
    required: ["sources"],
  },
  output: {
    type: "object",
    properties: {
      segments: { type: "array" },
      gapHints: { type: "array" },
    },
  },
  whenToUse: "Use before retrieval to identify relevant areas in sources.",
  dependsOn: [],
  incompatibleWith: [],
  estimatedCost: "low",
  estimatedTokens: 2000,
  timeoutMs: 15000,
  retryable: true,
};

export const GapsBlockManifest = {
  name: "gaps",
  version: "1.0.0",
  description: "Analyze sources to identify knowledge gaps for targeted retrieval.",
  capabilities: ["gap_detection", "priority_ranking", "clustering"],
  input: {
    type: "object",
    properties: {
      state: { type: "object", description: "DeepSearchState with L0 sources" },
      scanSummary: { type: "object", description: "Summary from scan stage" },
    },
    required: ["state"],
  },
  output: {
    type: "object",
    properties: {
      gaps: { type: "array", description: "Detected knowledge gaps" },
      gapTree: { type: "object", description: "Hierarchical gap structure" },
    },
  },
  whenToUse: "Use after scan to identify what information is missing.",
  dependsOn: ["scan"],
  incompatibleWith: [],
  estimatedCost: "medium",
  estimatedTokens: 4000,
  timeoutMs: 30000,
  retryable: true,
};

export const UnderstandBlockManifest = {
  name: "understand",
  version: "1.0.0",
  description: "Analyze retrieved chunks to extract claims and evidence.",
  capabilities: ["extract_claims", "dedupe", "conflict_detection"],
  input: {
    type: "object",
    properties: {
      state: { type: "object", description: "DeepSearchState with L2 retrievedChunks" },
      gaps: { type: "array", description: "Gaps to fill with evidence" },
    },
    required: ["state"],
  },
  output: {
    type: "object",
    properties: {
      claims: { type: "array", description: "Extracted claims" },
      evidenceLedger: { type: "array", description: "Evidence entries" },
      filledGapIds: { type: "array", description: "Gaps that were filled" },
    },
  },
  whenToUse: "Use after retrieval to synthesize evidence into claims.",
  dependsOn: ["retrieve"],
  incompatibleWith: [],
  estimatedCost: "medium",
  estimatedTokens: 8000,
  timeoutMs: 60000,
  retryable: true,
};

export const WriteBlockManifest = {
  name: "write",
  version: "1.0.0",
  description: "Generate final report from claims and evidence.",
  capabilities: ["report_generation", "toc_based", "react_writer"],
  input: {
    type: "object",
    properties: {
      state: { type: "object", description: "DeepSearchState with L1 claims/evidence" },
      reportConfig: { type: "object", description: "Report configuration (tone, audience, length)" },
    },
    required: ["state"],
  },
  output: {
    type: "object",
    properties: {
      report: {
        type: "object",
        description: "Generated report object (markdown + metadata)",
        properties: {
          markdown: { type: "string" },
          title: { type: "string" },
        },
      },
      title: { type: "string", description: "Report title" },
      wordCount: { type: "number" },
    },
  },
  whenToUse: "Use when all evidence is gathered and ready to produce final output.",
  dependsOn: ["understand"],
  incompatibleWith: [],
  estimatedCost: "high",
  estimatedTokens: 15000,
  timeoutMs: 120000,
  retryable: true,
};

export const CondenseBlockManifest = {
  name: "condense",
  version: "1.0.0",
  description: "Compress state by clearing L2 and building condensed memory.",
  capabilities: ["compress", "artifact_persist", "memory_optimize"],
  input: {
    type: "object",
    properties: {
      state: { type: "object", description: "DeepSearchState to condense" },
    },
    required: ["state"],
  },
  output: {
    type: "object",
    properties: {
      condensedMemory: { type: "object", description: "Compressed memory" },
      l2Cleared: { type: "object", description: "Cleared L2 stats" },
    },
  },
  whenToUse: "Use after iteration to compress context and persist artifacts.",
  dependsOn: ["understand"],
  incompatibleWith: [],
  estimatedCost: "low",
  estimatedTokens: 1000,
  timeoutMs: 10000,
  retryable: false,
};

/**
 * All DeepSearch block manifests
 */
export const DeepSearchBlockManifests = [
  ScanBlockManifest,
  GapsBlockManifest,
  RetrieveBlockManifest,
  UnderstandBlockManifest,
  WriteBlockManifest,
  CondenseBlockManifest,
];
