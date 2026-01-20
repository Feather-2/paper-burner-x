import { describe, it, expect, vi, beforeEach } from "vitest";

const shared = vi.hoisted(() => ({ actualIsPlainObject: undefined }));

vi.mock("../../../../js/agents/shared/index.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/shared/index.js");
  shared.actualIsPlainObject = actual.isPlainObject;
  return {
    ...actual,
    isPlainObject: vi.fn(actual.isPlainObject),
  };
});

import {
  SUPPORTED_ARTIFACT_TYPES,
  ARTIFACT_TYPE_ALIASES,
  canonicalArtifactType,
  isSupportedArtifactType,
  generateArtifactId,
  createManifest,
  addArtifactToManifest,
} from "../../../../js/agents/storage/artifact-manager.js";
import { isPlainObject } from "../../../../js/agents/shared/index.js";

const makeLongString = (length, char = "x") => char.repeat(length);

beforeEach(() => {
  isPlainObject.mockReset();
  if (shared.actualIsPlainObject) {
    isPlainObject.mockImplementation(shared.actualIsPlainObject);
  }
  vi.useRealTimers();
});

describe("SUPPORTED_ARTIFACT_TYPES", () => {
  it("lists known canonical types", () => {
    expect(Array.isArray(SUPPORTED_ARTIFACT_TYPES)).toBe(true);
    expect(SUPPORTED_ARTIFACT_TYPES.length).toBeGreaterThan(0);
    expect(SUPPORTED_ARTIFACT_TYPES).toContain("plan.json");
    expect(SUPPORTED_ARTIFACT_TYPES).toContain("events.jsonl");
    expect(SUPPORTED_ARTIFACT_TYPES).toContain("vfs_payload.bin");
  });

  it("does not include alias-only keys", () => {
    expect(SUPPORTED_ARTIFACT_TYPES).not.toContain("deepsearch_state");
    expect(SUPPORTED_ARTIFACT_TYPES).not.toContain("condensed_memory");
  });
});

describe("ARTIFACT_TYPE_ALIASES", () => {
  it("maps short aliases to canonical types", () => {
    expect(ARTIFACT_TYPE_ALIASES.deepsearch_state).toBe("deepsearch_state.json");
    expect(ARTIFACT_TYPE_ALIASES.condensed_memory).toBe("condensed_memory.json");
  });

  it("is a plain object map", () => {
    expect(typeof ARTIFACT_TYPE_ALIASES).toBe("object");
    expect(Array.isArray(ARTIFACT_TYPE_ALIASES)).toBe(false);
  });
});

describe("canonicalArtifactType", () => {
  it("trims input and applies aliases", () => {
    expect(canonicalArtifactType(" deepsearch_state ")).toBe("deepsearch_state.json");
    expect(canonicalArtifactType("condensed_memory")).toBe("condensed_memory.json");
    expect(canonicalArtifactType("plan.json")).toBe("plan.json");
  });

  it("handles empty and boundary values", () => {
    expect(canonicalArtifactType("")).toBe("");
    expect(canonicalArtifactType("   ")).toBe("");
    expect(canonicalArtifactType(null)).toBe("");
    expect(canonicalArtifactType(undefined)).toBe("");
    expect(canonicalArtifactType(0)).toBe("");
  });

  it("stringifies deep nested objects without throwing", () => {
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(canonicalArtifactType(deep)).toBe("[object Object]");
  });
});

describe("isSupportedArtifactType", () => {
  it("returns true for supported types and aliases", () => {
    expect(isSupportedArtifactType("plan.json")).toBe(true);
    expect(isSupportedArtifactType("deepsearch_state")).toBe(true);
    expect(isSupportedArtifactType("condensed_memory")).toBe(true);
  });

  it("returns false for empty, whitespace, and unsupported values", () => {
    expect(isSupportedArtifactType("")).toBe(false);
    expect(isSupportedArtifactType("   ")).toBe(false);
    expect(isSupportedArtifactType("not-a-type.json")).toBe(false);
    expect(isSupportedArtifactType(undefined)).toBe(false);
  });

  it("returns false for array and deep object inputs", () => {
    expect(isSupportedArtifactType([])).toBe(false);
    const deep = { a: { b: { c: { d: 1 } } } };
    expect(isSupportedArtifactType(deep)).toBe(false);
  });
});

describe("generateArtifactId", () => {
  it("throws for invalid runId and unsupported type", () => {
    const invalidRunIds = [null, undefined, "", 0, -1, {}, []];
    for (const runId of invalidRunIds) {
      expect(() => generateArtifactId(runId, "plan.json")).toThrow(/runId must be a string/i);
    }
    expect(() => generateArtifactId("run_bad_type", "not_supported")).toThrow(/unsupported artifact type/i);
  });

  it("auto-increments when seq is missing or invalid", () => {
    const runId = "run_seq_invalid";
    const id1 = generateArtifactId(runId, "plan.json", 0);
    const id2 = generateArtifactId(runId, "plan.json", -1);
    const id3 = generateArtifactId(runId, "plan.json", "3");
    expect(id1).toBe(`art_${runId}_plan.json_001`);
    expect(id2).toBe(`art_${runId}_plan.json_002`);
    expect(id3).toBe(`art_${runId}_plan.json_003`);
  });

  it("uses explicit seq values, including MAX_SAFE_INTEGER", () => {
    const runId = "run_seq_explicit";
    expect(generateArtifactId(runId, "plan.json", 9)).toBe(`art_${runId}_plan.json_009`);
    expect(generateArtifactId(runId, "plan.json", 3.9)).toBe(`art_${runId}_plan.json_003`);
    const maxId = generateArtifactId(runId, "plan.json", Number.MAX_SAFE_INTEGER);
    expect(maxId.endsWith(`_${Number.MAX_SAFE_INTEGER}`)).toBe(true);
  });

  it("returns unique ids for concurrent calls", async () => {
    const runId = "run_concurrent";
    const tasks = Array.from({ length: 5 }, () =>
      Promise.resolve().then(() => generateArtifactId(runId, "plan.json")),
    );
    const ids = await Promise.all(tasks);
    expect(new Set(ids).size).toBe(5);
    const expected = ["001", "002", "003", "004", "005"].map((n) => `art_${runId}_plan.json_${n}`);
    expect(ids).toEqual(expect.arrayContaining(expected));
  });

  it("increments rapidly for consecutive calls", () => {
    const runId = "run_rapid";
    const ids = [];
    for (let i = 0; i < 10; i += 1) {
      ids.push(generateArtifactId(runId, "plan.json"));
    }
    expect(ids[0]).toBe(`art_${runId}_plan.json_001`);
    expect(ids[ids.length - 1]).toBe(`art_${runId}_plan.json_010`);
  });
});

describe("createManifest", () => {
  it("throws for invalid runId values", () => {
    const invalidRunIds = [null, undefined, "", 0, -1, {}, []];
    for (const runId of invalidRunIds) {
      expect(() => createManifest(runId)).toThrow(/runId must be a string/i);
    }
  });

  it("creates a manifest with a deterministic timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    let manifest;
    try {
      manifest = createManifest("   ");
    } finally {
      vi.useRealTimers();
    }
    expect(manifest).toEqual({
      schemaVersion: "0.1",
      runId: "   ",
      createdAt: "2024-01-01T00:00:00.000Z",
      artifacts: [],
    });
  });
});

describe("addArtifactToManifest", () => {
  it("rejects non-object manifest and artifact inputs", () => {
    const manifest = { artifacts: [] };
    expect(() => addArtifactToManifest(null, {})).toThrow(/manifest must be an object/i);
    expect(() => addArtifactToManifest(undefined, {})).toThrow(/manifest must be an object/i);
    expect(() => addArtifactToManifest([], {})).toThrow(/manifest must be an object/i);
    expect(() => addArtifactToManifest(manifest, null)).toThrow(/artifact must be an object/i);
    expect(() => addArtifactToManifest(manifest, undefined)).toThrow(/artifact must be an object/i);
    expect(() => addArtifactToManifest(manifest, [])).toThrow(/artifact must be an object/i);
  });

  it("relies on isPlainObject for validation", () => {
    const manifest = { artifacts: [] };
    isPlainObject.mockImplementationOnce(() => true).mockImplementationOnce(() => false);
    expect(() =>
      addArtifactToManifest(manifest, { artifactId: "a1", type: "plan.json", storageKey: "k" }),
    ).toThrow(/artifact must be an object/i);
  });

  it("validates required fields and supported types", () => {
    const manifest = { artifacts: [] };
    expect(() => addArtifactToManifest(manifest, {})).toThrow(/unsupported artifact type/i);
    expect(() =>
      addArtifactToManifest(manifest, { artifactId: "", type: "plan.json", storageKey: "k" }),
    ).toThrow(/artifactId must be a string/i);
    expect(() =>
      addArtifactToManifest(manifest, { artifactId: "a", type: "plan.json", storageKey: "" }),
    ).toThrow(/storageKey must be a string/i);
    expect(() =>
      addArtifactToManifest(manifest, { artifactId: "a", type: "nope.json", storageKey: "k" }),
    ).toThrow(/unsupported artifact type/i);
  });

  it("adds artifacts with optional fields and resource boundaries", () => {
    const manifest = { artifacts: {} };
    const longKey = makeLongString(10000);
    const longId = makeLongString(1000, "a");
    const deepSummary = { a: { b: { c: { d: { e: 1 } } } } };

    const result = addArtifactToManifest(manifest, {
      artifactId: longId,
      type: "plan.json",
      storageKey: longKey,
      bytes: Number.MAX_SAFE_INTEGER,
      mime: 123,
      sha256: 456,
      summary: deepSummary,
    });

    expect(result).toBe(manifest);
    expect(Array.isArray(manifest.artifacts)).toBe(true);
    expect(manifest.artifacts[0]).toEqual({
      artifactId: longId,
      type: "plan.json",
      mime: "123",
      bytes: Number.MAX_SAFE_INTEGER,
      sha256: "456",
      storageKey: longKey,
      summary: "[object Object]",
    });

    addArtifactToManifest(manifest, {
      artifactId: "zero-bytes",
      type: "plan.json",
      storageKey: "k2",
      bytes: 0,
      summary: "",
    });

    addArtifactToManifest(manifest, {
      artifactId: "string-bytes",
      type: "plan.json",
      storageKey: "k3",
      bytes: "100",
    });

    expect(manifest.artifacts[1]).toEqual({
      artifactId: "zero-bytes",
      type: "plan.json",
      bytes: 0,
      storageKey: "k2",
    });
    expect(manifest.artifacts[2]).toEqual({
      artifactId: "string-bytes",
      type: "plan.json",
      storageKey: "k3",
    });
  });

  it("is idempotent by artifactId and canonicalizes alias types", () => {
    const manifest = { artifacts: [] };
    addArtifactToManifest(manifest, {
      artifactId: "a1",
      type: "deepsearch_state",
      storageKey: "runs/x/deepsearch_state.json",
    });
    addArtifactToManifest(manifest, {
      artifactId: "a1",
      type: "deepsearch_state",
      storageKey: "runs/x/deepsearch_state.json",
    });
    expect(manifest.artifacts).toHaveLength(1);
    expect(manifest.artifacts[0].type).toBe("deepsearch_state.json");
  });
});
