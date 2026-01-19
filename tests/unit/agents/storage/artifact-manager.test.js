import { describe, it, expect, vi, afterEach } from "vitest";

const uniqueId = (prefix = "id") => `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("artifact-manager", () => {
  it("canonicalArtifactType() applies aliases and trims", async () => {
    const { canonicalArtifactType } = await import("../../../js/agents/storage/artifact-manager.js");

    expect(canonicalArtifactType(" deepsearch_state ")).toBe("deepsearch_state.json");
    expect(canonicalArtifactType("condensed_memory")).toBe("condensed_memory.json");
    expect(canonicalArtifactType("plan.json")).toBe("plan.json");
    expect(canonicalArtifactType("")).toBe("");
  });

  it("isSupportedArtifactType() returns true/false for supported types", async () => {
    const { isSupportedArtifactType } = await import("../../../js/agents/storage/artifact-manager.js");

    expect(isSupportedArtifactType("plan.json")).toBe(true);
    expect(isSupportedArtifactType("deepsearch_state")).toBe(true); // alias
    expect(isSupportedArtifactType("not-a-type.json")).toBe(false);
    expect(isSupportedArtifactType("")).toBe(false);
  });

  it("generateArtifactId() validates input and auto-increments per runId+type", async () => {
    const { generateArtifactId } = await import("../../../js/agents/storage/artifact-manager.js");

    expect(() => generateArtifactId(null, "plan.json")).toThrow(/runId must be a string/i);
    expect(() => generateArtifactId("r1", "unsupported.type")).toThrow(/unsupported artifact type/i);

    const runId = uniqueId("run");
    const a1 = generateArtifactId(runId, "plan.json");
    const a2 = generateArtifactId(runId, "plan.json");
    expect(a1).toMatch(new RegExp(`^art_${runId}_plan\\.json_001$`));
    expect(a2).toMatch(new RegExp(`^art_${runId}_plan\\.json_002$`));

    const explicit = generateArtifactId(runId, "plan.json", 9);
    expect(explicit).toMatch(new RegExp(`^art_${runId}_plan\\.json_009$`));
  });

  it("createManifest() creates a valid empty manifest", async () => {
    const { createManifest } = await import("../../../js/agents/storage/artifact-manager.js");

    expect(() => createManifest()).toThrow(/runId must be a string/i);
    const runId = uniqueId("run");
    const m = createManifest(runId);
    expect(m).toEqual({
      schemaVersion: "0.1",
      runId,
      createdAt: expect.any(String),
      artifacts: [],
    });
  });

  it("addArtifactToManifest() is idempotent by artifactId and validates required fields", async () => {
    const { createManifest, addArtifactToManifest } = await import("../../../js/agents/storage/artifact-manager.js");

    const runId = uniqueId("run");
    const m = createManifest(runId);

    expect(() => addArtifactToManifest(null, {})).toThrow(/manifest must be an object/i);
    expect(() => addArtifactToManifest(m, null)).toThrow(/artifact must be an object/i);

    expect(() =>
      addArtifactToManifest(m, { artifactId: "a1", type: "plan.json" /* missing storageKey */ }),
    ).toThrow(/storageKey must be a string/i);

    expect(() => addArtifactToManifest(m, { artifactId: "a1", type: "nope.json", storageKey: "x" })).toThrow(
      /unsupported artifact type/i,
    );

    addArtifactToManifest(m, { artifactId: "a1", type: "deepsearch_state", storageKey: "runs/x/deepsearch_state.json" });
    addArtifactToManifest(m, { artifactId: "a1", type: "deepsearch_state", storageKey: "runs/x/deepsearch_state.json" });

    expect(m.artifacts).toHaveLength(1);
    expect(m.artifacts[0]).toEqual({
      artifactId: "a1",
      type: "deepsearch_state.json",
      storageKey: "runs/x/deepsearch_state.json",
    });
  });

  it("serializeArtifactPayload() handles json/jsonl/binary payloads", async () => {
    const { serializeArtifactPayload } = await import("../../../js/agents/storage/artifact-manager.js");

    // JSON
    expect(serializeArtifactPayload("plan.json", undefined)).toBe("null");
    expect(serializeArtifactPayload("plan.json", { a: 1 }, { pretty: true })).toContain('\n  "a": 1\n');

    // JSONL
    expect(serializeArtifactPayload("events.jsonl", [{ a: 1 }, { b: 2 }])).toBe('{"a":1}\n{"b":2}\n');
    expect(serializeArtifactPayload("events.jsonl", { a: 1 })).toBe('{"a":1}\n');
    expect(serializeArtifactPayload("events.jsonl", "raw\n")).toBe("raw\n");
    expect(serializeArtifactPayload("events.jsonl", 123)).toBe("123");

    // Binary / fallback
    const ab = new ArrayBuffer(3);
    const bin = serializeArtifactPayload("vfs_payload.bin", ab);
    expect(bin).toBeInstanceOf(Uint8Array);
    expect(bin.byteLength).toBe(3);
    expect(serializeArtifactPayload("vfs_payload.bin", 123)).toBe("123");
  });

  it("deserializeArtifactPayload() parses json strings and leaves other payloads as-is", async () => {
    const { deserializeArtifactPayload } = await import("../../../js/agents/storage/artifact-manager.js");

    expect(deserializeArtifactPayload("plan.json", '{"ok":true}')).toEqual({ ok: true });
    expect(deserializeArtifactPayload("events.jsonl", '{"ok":true}\n')).toBe('{"ok":true}\n');
    expect(deserializeArtifactPayload("vfs_payload.bin", new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("computeSha256() returns a 64-char hex digest (webcrypto) and can fall back to node:crypto", async () => {
    const { computeSha256 } = await import("../../../js/agents/storage/artifact-manager.js");

    const payload = { a: 1, b: { c: 2 } };
    const sha1 = await computeSha256(payload);
    expect(sha1).toMatch(/^[a-f0-9]{64}$/);

    // Force the Node fallback path by removing crypto.subtle.
    vi.stubGlobal("crypto", {});
    const sha2 = await computeSha256(payload);
    expect(sha2).toBe(sha1);
  });

  it("computeSha256() handles ArrayBuffer views, Blob, and non-object primitives (dataToArrayBuffer branches)", async () => {
    const { computeSha256 } = await import("../../../js/agents/storage/artifact-manager.js");

    expect(await computeSha256(new Uint8Array([1, 2, 3]))).toMatch(/^[a-f0-9]{64}$/);
    expect(await computeSha256(new Blob(["hello"]))).toMatch(/^[a-f0-9]{64}$/);
    expect(await computeSha256(123)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("computeSha256() returns undefined when neither webcrypto nor node:crypto are available", async () => {
    vi.resetModules();
    vi.doMock("node:crypto", () => {
      throw new Error("no crypto");
    });

    const { computeSha256 } = await import("../../../js/agents/storage/artifact-manager.js");

    vi.stubGlobal("crypto", {});
    const sha = await computeSha256("hello");
    expect(sha).toBeUndefined();

    vi.doUnmock("node:crypto");
  });
});
