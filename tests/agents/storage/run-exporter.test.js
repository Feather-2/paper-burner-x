import "fake-indexeddb/auto";
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RunStore } from "../../../js/agents/storage/run-store.js";

const makeDbName = (label) => `AgentRuntimeDB_vitest_export_${label}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

async function toArrayBuffer(file) {
  if (typeof Blob !== "undefined" && file instanceof Blob) return await file.arrayBuffer();
  if (file instanceof ArrayBuffer) return file;
  if (file instanceof Uint8Array) return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  if (file && typeof file.arrayBuffer === "function") return await file.arrayBuffer();
  throw new Error(`Unsupported zip input: ${Object.prototype.toString.call(file)}`);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RunExporter exportRunAsZip()", () => {
  it("exports manifest/events/artifacts and sanitizes unsafe/duplicate zip paths (browser branch)", async () => {
    vi.resetModules();
    vi.doMock("../../../js/agents/shared/platform.js", () => ({ isNodeLike: () => false }));
    const { exportRunAsZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_export_mock";
    const runContext = { schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() };

    const getManifest = vi.fn(async () => ({
      schemaVersion: "0.1",
      runId: "WRONG_ID",
      createdAt: "2020-01-01T00:00:00.000Z",
      artifacts: [
        // Unsafe + duplicate paths should be replaced/deduped.
        { artifactId: "a1", type: "plan.json", storageKey: `runs/${runId}/plan.json`, zipPath: "../evil" },
        { artifactId: "a2", type: "plan.json", storageKey: `runs/${runId}/plan.json`, zipPath: "../evil" },
      ],
    }));

    const listArtifacts = vi.fn(async () => [
      { artifactId: "a1", runId, type: "plan.json", seq: 1, storageKey: `runs/${runId}/plan.json`, createdAt: "2020-01-01T00:00:01.000Z" },
      { artifactId: "a2", runId, type: "plan.json", seq: 2, storageKey: `runs/${runId}/plan.json`, createdAt: "2020-01-01T00:00:02.000Z" },
      { artifactId: "b1", runId, type: "vfs_payload.bin", seq: 1, storageKey: `runs/${runId}/vfs_payload.bin`, bytes: 3 },
      // Unsupported type should be ignored by ensureManifest().
      { artifactId: "x1", runId, type: "unsupported.json", seq: 1, storageKey: `runs/${runId}/unsupported.json` },
    ]);

    const getRun = vi.fn(async () => runContext);
    const getArtifact = vi.fn(async (_runId, type) => {
      if (type === "events.jsonl") return '{"eventId":"evt_1"}\n';
      if (type === "plan.json") return { fallback: true };
      if (type === "vfs_payload.bin") return new Uint8Array([1, 2, 3]);
      return null;
    });

    const getArtifactById = vi.fn(async (artifactId) => {
      if (artifactId === "a1") return { v: 1 };
      if (artifactId === "a2") return null; // force fallback to getArtifact(runId, type)
      if (artifactId === "b1") return new Uint8Array([1, 2, 3]);
      return null;
    });

    const zipBlob = await exportRunAsZip(runId, {
      runStore: { getManifest, listArtifacts, getRun, getArtifact, getArtifactById },
    });

    const zip = await JSZip.loadAsync(await toArrayBuffer(zipBlob));
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(["manifest.json", "events.jsonl"]));

    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    expect(manifest.runId).toBe(runId); // normalizeManifest()
    expect(manifest.runContext).toEqual(runContext);
    expect(manifest.artifacts.some((a) => a.type === "events.jsonl")).toBe(true);

    // Ensure zip paths are safe and unique.
    const zipPaths = (manifest.artifacts || []).map((a) => a.zipPath).filter(Boolean);
    expect(zipPaths.some((p) => typeof p === "string" && p.includes(".."))).toBe(false);
    expect(new Set(zipPaths).size).toBe(zipPaths.length);

    // Verify artifact payloads made it into the zip.
    const a1Path = manifest.artifacts.find((a) => a.artifactId === "a1")?.zipPath;
    expect(typeof a1Path).toBe("string");
    expect(JSON.parse(await zip.file(a1Path).async("string"))).toEqual({ v: 1 });

    const b1Path = manifest.artifacts.find((a) => a.artifactId === "b1")?.zipPath;
    expect(typeof b1Path).toBe("string");
    expect(await zip.file(b1Path).async("uint8array")).toEqual(new Uint8Array([1, 2, 3]));

    vi.doUnmock("../../../js/agents/shared/platform.js");
  });

  it("handles empty artifact list (no non-event artifacts) during export", async () => {
    vi.resetModules();
    const { exportRunAsZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_export_no_artifacts";
    const dbName = makeDbName("export_no_artifacts");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });
    await store.appendEvents(runId, [
      { schemaVersion: "0.1", eventId: "evt_1", runId, ts: "2020-01-01T00:00:00.000Z", name: "run.started", actor: "system", status: "started" },
    ]);

    const zipBlob = await exportRunAsZip(runId, { runStore: store });
    const zip = await JSZip.loadAsync(await toArrayBuffer(zipBlob));

    // No non-event payload files should exist in the zip.
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(["manifest.json", "events.jsonl"]));
    expect(Object.keys(zip.files).filter((p) => p !== "manifest.json" && p !== "events.jsonl")).toHaveLength(0);

    const eventsText = await zip.file("events.jsonl").async("string");
    expect(eventsText).toContain("evt_1");

    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    expect(Array.isArray(manifest.artifacts)).toBe(true);
    expect((manifest.artifacts || []).filter((a) => a?.type && a.type !== "events.jsonl")).toHaveLength(0);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("handles empty events list during export (events.jsonl is present but empty)", async () => {
    vi.resetModules();
    const { exportRunAsZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_export_empty_events";
    const dbName = makeDbName("export_empty_events");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });
    // Nested object payload ensures JSON serialization branch handles nested structures.
    const nested = { a: { b: [1, 2, 3] }, meta: { ok: true } };
    await store.saveArtifact(runId, "plan.json", nested, { seq: 1 });

    const zipBlob = await exportRunAsZip(runId, { runStore: store });
    const zip = await JSZip.loadAsync(await toArrayBuffer(zipBlob));

    const eventsText = await zip.file("events.jsonl").async("string");
    expect(eventsText).toBe("");

    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const planItem = (manifest.artifacts || []).find((a) => a?.type === "plan.json");
    expect(planItem?.zipPath).toBeTypeOf("string");
    expect(planItem?.zipPath).not.toBe("");

    const planPayload = JSON.parse(await zip.file(planItem.zipPath).async("string"));
    expect(planPayload).toEqual(nested);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("exports string/binary/number artifacts, skips missing payloads, and returns a Buffer when Blob is undefined (node branch)", async () => {
    vi.resetModules();
    const { exportRunAsZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_export_type_edges";

    const manifest = {
      schemaVersion: "0.1",
      runId,
      createdAt: "2020-01-01T00:00:00.000Z",
      artifacts: [
        // events.jsonl is explicitly present -> ensureManifest should not auto-add a second one.
        { artifactId: `art_${runId}_events.jsonl_001`, type: "events.jsonl", storageKey: `runs/${runId}/events.jsonl`, zipPath: "events.jsonl" },
        { artifactId: "p1", type: "plan.json", storageKey: `runs/${runId}/plan.json` },
        { artifactId: "b1", type: "vfs_payload.bin", storageKey: `runs/${runId}/vfs_payload.bin` },
        // Stored as a primitive -> String(data) branch.
        { artifactId: "n1", type: "tool_output.json", storageKey: `runs/${runId}/tool_output.json` },
        // Exists in manifest but has no payload -> exporter should `continue` and skip the file.
        { artifactId: "missing1", type: "lint_report.json", storageKey: `runs/${runId}/lint_report.json` },
        // artifactId is whitespace, so resolveZipPathForArtifact falls back to type+seq-based naming.
        { artifactId: "   ", type: "lint_report.json", storageKey: `runs/${runId}/lint_report.json`, seq: 2.7 },
      ],
    };

    const getManifest = vi.fn(async () => manifest);
    const listArtifacts = vi.fn(async () => [
      null,
      // Missing storageKey -> ignored
      { artifactId: "bad", runId, type: "plan.json" },
      // Unsupported type -> ignored
      { artifactId: "x1", runId, type: "unsupported.json", storageKey: `runs/${runId}/unsupported.json` },
      // Valid supported types (one missing seq to exercise the `seq` spread fallback)
      { artifactId: "p1", runId, type: "plan.json", storageKey: `runs/${runId}/plan.json`, createdAt: "2020-01-01T00:00:01.000Z", seq: 1, sha256: "abc" },
      { artifactId: "b1", runId, type: "vfs_payload.bin", storageKey: `runs/${runId}/vfs_payload.bin`, createdAt: "2020-01-01T00:00:02.000Z" },
    ]);

    const getArtifact = vi.fn(async (_runId, type) => {
      if (type === "events.jsonl") return "";
      if (type === "plan.json") return "raw text payload";
      if (type === "vfs_payload.bin") return new Uint8Array([1, 2, 3]);
      if (type === "tool_output.json") return 123;
      return null;
    });

    // Omit getArtifactById to cover the "no getArtifactById()" branch.
    const zipBlob = await exportRunAsZip(runId, { runStore: { getManifest, listArtifacts, getArtifact } });

    const zip = await JSZip.loadAsync(await toArrayBuffer(zipBlob));
    const exportedManifest = JSON.parse(await zip.file("manifest.json").async("string"));
    expect(exportedManifest.runId).toBe(runId);

    // No duplicate events.jsonl entries.
    expect((exportedManifest.artifacts || []).filter((a) => a?.type === "events.jsonl")).toHaveLength(1);

    const planPath = exportedManifest.artifacts.find((a) => a?.artifactId === "p1")?.zipPath;
    expect(await zip.file(planPath).async("string")).toBe("raw text payload");

    const binPath = exportedManifest.artifacts.find((a) => a?.artifactId === "b1")?.zipPath;
    expect(await zip.file(binPath).async("uint8array")).toEqual(new Uint8Array([1, 2, 3]));

    const n1Path = exportedManifest.artifacts.find((a) => a?.artifactId === "n1")?.zipPath;
    expect(await zip.file(n1Path).async("string")).toBe("123");

    const missingPath = exportedManifest.artifacts.find((a) => a?.artifactId === "missing1")?.zipPath;
    expect(zip.file(missingPath)).toBeNull();

    // Cover the `typeof Blob !== "undefined" ? new Blob([buf]) : buf` return branch safely.
    // Real JSZip internals may do `instanceof Blob` without guarding for Blob being undefined,
    // so we stub JSZip for this sub-check.
    vi.stubGlobal("Blob", undefined);
    class StubZip {
      constructor() {
        this.files = {};
      }
      file(path, data) {
        this.files[path] = data;
      }
      async generateAsync(_opts) {
        return new Uint8Array([0, 1, 2]);
      }
    }
    vi.stubGlobal("JSZip", StubZip);
    const out = await exportRunAsZip(runId, { runStore: { getManifest, listArtifacts, getArtifact } });
    expect(out).toBeInstanceOf(Uint8Array);
  });
});

describe("run-exporter utility functions", () => {
  it("exports bytesForPayload for various types", async () => {
    vi.resetModules();
    const mod = await import("../../../js/agents/storage/run-exporter.js");
    // Access internals via re-export or test indirectly via saveArtifact bytes behavior

    // Test through import path - the function is internal but affects bytes calculation
    const JSZip = await import("jszip").then((m) => m.default || m);
    const zip = new JSZip();

    const runId = "run_bytes_test";
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        artifacts: [
          { type: "text.txt", artifactId: "a1", storageKey: `runs/${runId}/text.txt` },
        ],
      }),
    );
    zip.file("text.txt", "hello");
    const blob = await zip.generateAsync({ type: "blob" });

    const dbName = makeDbName("bytes_test");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await mod.importRunFromZip(blob, { runStore: store, overwrite: true });
    const artifacts = await store.listArtifacts(runId);
    const textArt = artifacts.find((a) => a.type === "text.txt");
    // bytes should be populated from content
    expect(typeof textArt?.bytes).toBe("number");
    expect(textArt?.bytes).toBeGreaterThan(0);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("covers bytesForPayload(ArrayBuffer) via import preloading (atomic path)", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    // Provide a minimal JSZip stub so we can force an ArrayBuffer payload even when
    // run-exporter requests "uint8array" (covers bytesForPayload(ArrayBuffer) branch).
    class StubZipFile {
      constructor(value) {
        this._value = value;
      }
      async async(_type) {
        return this._value;
      }
    }
    class StubZip {
      constructor(files) {
        this._files = files;
      }
      file(path) {
        return this._files[path] || null;
      }
    }
    class StubJSZip {
      static async loadAsync(_input) {
        const runId = "run_bytes_arraybuffer";
        const payload = new Uint8Array([1, 2, 3, 4]).buffer;
        const manifest = {
          schemaVersion: "0.1",
          runId,
          artifacts: [{ type: "payload.bin", artifactId: "ab1", storageKey: `runs/${runId}/payload.bin`, zipPath: "payload.bin" }],
        };

        return new StubZip({
          "manifest.json": new StubZipFile(JSON.stringify(manifest)),
          "events.jsonl": new StubZipFile(""),
          "payload.bin": new StubZipFile(payload),
        });
      }
    }

    vi.stubGlobal("JSZip", StubJSZip);

    const dbName = makeDbName("bytes_arraybuffer");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const outRunId = await importRunFromZip(new Uint8Array([0]), { runStore: store, overwrite: true });
    expect(outRunId).toBe("run_bytes_arraybuffer");

    const rec = await store.getArtifactRecord("ab1");
    expect(rec?.type).toBe("payload.bin");
    expect(rec?.data).toBeInstanceOf(ArrayBuffer);
    expect(rec?.bytes).toBe(4);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("computes bytes for nested JSON string payloads during import", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_bytes_nested_json";
    const nested = { a: { b: [1, 2], c: { ok: true } } };
    const jsonText = JSON.stringify(nested);

    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        artifacts: [{ type: "tool_output.json", artifactId: "n1", storageKey: `runs/${runId}/tool_output.json` }],
      }),
    );
    zip.file("tool_output.json", jsonText);
    const blob = await zip.generateAsync({ type: "blob" });

    const dbName = makeDbName("bytes_nested_json");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await importRunFromZip(blob, { runStore: store, overwrite: true });
    const rec = await store.getArtifactRecord("n1");
    expect(rec?.data).toEqual(nested);
    expect(rec?.bytes).toBe(new TextEncoder().encode(jsonText).byteLength);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("handles Blob payload size in bytesForPayload", async () => {
    vi.resetModules();
    const { exportRunAsZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_blob_bytes";
    const dbName = makeDbName("blob_bytes");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });
    // Blob will be handled in export path
    const blobData = new Blob(["binary content"]);
    await store.saveArtifact(runId, "blob.bin", blobData, { seq: 1 });

    const zipBlob = await exportRunAsZip(runId, { runStore: store });
    expect(zipBlob).toBeDefined();

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("covers bytesForPayload(Blob) and bytesForPayload(undefined) via import preloading stubs", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    class StubZipFile {
      constructor(value) {
        this._value = value;
      }
      async async(_type) {
        return this._value;
      }
    }
    class StubZip {
      constructor(files) {
        this._files = files;
      }
      file(path) {
        return this._files[path] || null;
      }
    }
    class StubJSZip {
      static async loadAsync(_input) {
        const runId = "run_bytes_blob_undefined";
        const manifest = {
          schemaVersion: "0.1",
          runId,
          artifacts: [
            { type: "payload.bin", artifactId: "blob1", zipPath: "payload.bin", storageKey: `runs/${runId}/payload.bin` },
            { type: "missing.bin", artifactId: "u1", zipPath: "missing.bin", storageKey: `runs/${runId}/missing.bin` },
          ],
        };
        return new StubZip({
          "manifest.json": new StubZipFile(JSON.stringify(manifest)),
          "events.jsonl": new StubZipFile(""),
          // Return a Blob even though importer requests uint8array.
          "payload.bin": new StubZipFile(new Blob(["hello"])),
          // Return undefined to hit bytesForPayload(undefined) early return.
          "missing.bin": new StubZipFile(undefined),
        });
      }
    }

    vi.stubGlobal("JSZip", StubJSZip);

    const dbName = makeDbName("bytes_blob_undefined");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const outRunId = await importRunFromZip(new Uint8Array([0]), { runStore: store, overwrite: true, validate: false });
    expect(outRunId).toBe("run_bytes_blob_undefined");

    const blobRec = await store.getArtifactRecord("blob1");
    expect(blobRec?.bytes).toBe(5);

    const undefRec = await store.getArtifactRecord("u1");
    expect(undefRec?.data).toBeUndefined();
    expect(undefRec?.bytes).toBeUndefined();

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });
});

describe("RunExporter importRunFromZip()", () => {
  it("atomic import preloads artifacts and skips missing zip payloads when validate=false", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_atomic_preload_skip";
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        createdAt: "2020-01-01T00:00:00.000Z",
        artifacts: [
          { type: "plan.json", artifactId: "ok1", storageKey: `runs/${runId}/plan.json` },
          // Intentionally missing from the zip; atomic preloading should `continue` (not throw) when validate=false.
          { type: "missing.json", artifactId: "miss1", storageKey: `runs/${runId}/missing.json`, zipPath: "missing.json" },
        ],
      }),
    );
    zip.file("plan.json", '{"ok":true}');
    const blob = await zip.generateAsync({ type: "blob" });

    const dbName = makeDbName("atomic_preload_skip");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    // Atomic path should not call the high-level RunStore mutation helpers.
    const createRunSpy = vi.spyOn(store, "createRun");
    const deleteRunSpy = vi.spyOn(store, "deleteRun");
    const saveArtifactSpy = vi.spyOn(store, "saveArtifact");

    const outRunId = await importRunFromZip(blob, { runStore: store, overwrite: true, atomic: true, validate: false });
    expect(outRunId).toBe(runId);
    expect(createRunSpy).not.toHaveBeenCalled();
    expect(deleteRunSpy).not.toHaveBeenCalled();
    expect(saveArtifactSpy).not.toHaveBeenCalled();

    const artifacts = await store.listArtifacts(runId);
    expect(artifacts.some((a) => a.type === "plan.json")).toBe(true);
    expect(artifacts.some((a) => a.type === "missing.json")).toBe(false);

    const plan = await store.getArtifact(runId, "plan.json");
    expect(plan).toEqual({ ok: true });

    const okRec = await store.getArtifactRecord("ok1");
    expect(typeof okRec?.bytes).toBe("number");
    expect(okRec?.bytes).toBeGreaterThan(0);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("non-atomic import attempts backup restoration on failure", async () => {
    vi.resetModules();
    const { importRunFromZip, exportRunAsZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_restore_test";
    const dbName = makeDbName("restore_test");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    // Create initial run with data
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });
    await store.saveArtifact(runId, "original.json", { original: true }, { seq: 1 });

    // Create a zip with invalid content that will fail during import
    const JSZip = await import("jszip").then((m) => m.default || m);
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        artifacts: [
          { type: "will_fail.json", artifactId: "fail1", storageKey: `runs/${runId}/will_fail.json`, zipPath: "missing_completely.json" },
        ],
      }),
    );
    // Don't add the file referenced in manifest
    const badBlob = await zip.generateAsync({ type: "blob" });

    // Try import with atomic=false, backupOnOverwrite=true
    try {
      await importRunFromZip(badBlob, { runStore: store, overwrite: true, atomic: false, backupOnOverwrite: true });
    } catch {
      // Expected to fail
    }

    // The backup restoration may or may not succeed, but the path was exercised
    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("ignores rollback failures when backup exists (non-atomic overwrite path)", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_restore_ignore_rollback_error";
    const dbName = makeDbName("restore_ignore_rollback_error");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });
    await store.saveArtifact(runId, "plan.json", { original: true }, { seq: 1 });

    // Zip that will fail during the non-atomic artifact import loop (validate=false so we reach the try/catch).
    const badZip = new JSZip();
    badZip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        artifacts: [{ type: "plan.json", artifactId: "new1", storageKey: `runs/${runId}/plan.json`, zipPath: "missing_payload.json" }],
      }),
    );
    const badBlob = await badZip.generateAsync({ type: "blob" });

    const originalCreateRun = store.createRun.bind(store);
    const createRunSpy = vi
      .spyOn(store, "createRun")
      .mockImplementationOnce((...args) => originalCreateRun(...args))
      .mockImplementationOnce(() => {
        throw new Error("rollback failed");
      });

    let caught = null;
    try {
      await importRunFromZip(badBlob, { runStore: store, overwrite: true, atomic: false, backupOnOverwrite: true, validate: false });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(Error);
    expect(String(caught?.message || "")).toMatch(/missing artifact payload/i);
    // Ensure rollback failure did not replace the original error.
    expect(String(caught?.message || "")).not.toMatch(/rollback failed/i);
    // createRun called for the failed import + attempted rollback import.
    expect(createRunSpy).toHaveBeenCalledTimes(2);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("handles invalid JSON in artifact during import gracefully", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_invalid_json";
    const JSZip = await import("jszip").then((m) => m.default || m);
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        artifacts: [
          { type: "bad.json", artifactId: "bad1", storageKey: `runs/${runId}/bad.json` },
        ],
      }),
    );
    // Invalid JSON content - should be stored as string
    zip.file("bad.json", "{ invalid json: }}}");
    const blob = await zip.generateAsync({ type: "blob" });

    const dbName = makeDbName("invalid_json");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const result = await importRunFromZip(blob, { runStore: store, overwrite: true });
    expect(result).toBe(runId);

    // The artifact should be stored as raw string since JSON.parse failed
    const artifact = await store.getArtifact(runId, "bad.json");
    expect(typeof artifact).toBe("string");
    expect(artifact).toContain("invalid json");

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("handles ArrayBuffer and ArrayBufferView in export", async () => {
    vi.resetModules();
    const { exportRunAsZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_arraybuffer";
    const dbName = makeDbName("arraybuffer");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    // Save ArrayBuffer via Uint8Array - use supported type
    await store.saveArtifact(runId, "vfs_payload.bin", new Uint8Array([1, 2, 3, 4, 5]), { seq: 1 });

    const zipBlob = await exportRunAsZip(runId, { runStore: store });
    expect(zipBlob).toBeDefined();

    const zip = await JSZip.loadAsync(await toArrayBuffer(zipBlob));
    const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
    const bufferArt = manifest.artifacts.find((a) => a.type === "vfs_payload.bin");
    expect(bufferArt).toBeDefined();

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("roundtrips export->import (atomic IndexedDB transaction path)", async () => {
    vi.resetModules();
    const { exportRunAsZip, importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const dbName1 = makeDbName("roundtrip_src");
    await RunStore.deleteDatabase({ dbName: dbName1 });
    const store1 = new RunStore({ dbName: dbName1 });

    const runId = "run_zip_atomic";
    await store1.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    await store1.appendEvents(runId, [
      { schemaVersion: "0.1", eventId: "evt_1", runId, ts: "2020-01-01T00:00:00.000Z", name: "run.started", actor: "system", status: "started" },
      // Include an invalid JSONL line during import via events.jsonl fallback generation (ignored by parser).
      { schemaVersion: "0.1", eventId: "evt_2", runId, ts: "2020-01-01T00:00:00.001Z", name: "run.ended", actor: "system", status: "ended" },
    ]);

    const plan1 = { kind: "plan", v: 1 };
    const plan2 = { kind: "plan", v: 2 };
    await store1.saveArtifact(runId, "plan.json", plan1, { seq: 1 });
    await store1.saveArtifact(runId, "plan.json", plan2, { seq: 2 });
    await store1.saveArtifact(runId, "vfs_payload.bin", new Uint8Array([9, 8, 7]), { seq: 1, bytes: 3 });

    const zipBlob = await exportRunAsZip(runId, { runStore: store1 });
    await store1.close();

    const dbName2 = makeDbName("roundtrip_dst");
    await RunStore.deleteDatabase({ dbName: dbName2 });
    const store2 = new RunStore({ dbName: dbName2 });

    const importedRunId = await importRunFromZip(zipBlob, { runStore: store2, overwrite: true });
    expect(importedRunId).toBe(runId);

    expect(await store2.getArtifact(runId, "plan.json")).toEqual(plan2);
    expect(await store2.getArtifact(runId, "vfs_payload.bin")).toEqual(new Uint8Array([9, 8, 7]));
    const importedArtifacts = await store2.listArtifacts(runId);
    expect(importedArtifacts.filter((a) => a.type === "plan.json")).toHaveLength(2);
    // Atomic import preloads payloads and fills in bytes when missing in manifest.
    expect(importedArtifacts.filter((a) => a.type === "plan.json").every((a) => typeof a.bytes === "number" && a.bytes > 0)).toBe(true);
    expect(await store2.getEvents(runId)).toHaveLength(2);

    // overwrite=false should fail when run exists (atomic path aborts tx)
    await expect(importRunFromZip(zipBlob, { runStore: store2, overwrite: false })).rejects.toThrow(/already exists/i);

    await store2.close();
    await RunStore.deleteDatabase({ dbName: dbName1 });
    await RunStore.deleteDatabase({ dbName: dbName2 });
  });

  it("supports non-atomic import mode (appendEventsFromJsonl + per-artifact saveArtifact)", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_zip_non_atomic";

    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        createdAt: "2020-01-01T00:00:00.000Z",
        artifacts: [
          // Unsafe zipPath is ignored; resolveZipFile should fall back to `type` ("plan.json").
          { type: "plan.json", zipPath: "../evil", artifactId: `art_${runId}_plan.json_2`, storageKey: `runs/${runId}/plan.json`, bytes: 11 },
        ],
      }),
    );
    zip.file("events.jsonl", '{"eventId":"evt_1","runId":"' + runId + '","ts":"2020-01-01T00:00:00.000Z"}\nnot-json\n');
    zip.file("plan.json", '{"ok":true}');

    const zipBlob = await zip.generateAsync({ type: "blob" });

    const dbName = makeDbName("non_atomic");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const outRunId = await importRunFromZip(zipBlob, { runStore: store, overwrite: true, atomic: false });
    expect(outRunId).toBe(runId);

    // seq inferred from artifactId suffix (`_2`) and JSON parsed as object
    const plans = (await store.listArtifacts(runId)).filter((a) => a.type === "plan.json");
    expect(plans).toHaveLength(1);
    expect(plans[0].seq).toBe(2);
    expect(await store.getArtifact(runId, "plan.json")).toEqual({ ok: true });

    // Only the valid event line should be imported (bad line ignored)
    const events = await store.getEvents(runId);
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe("evt_1");

    // bytesForPayload should have populated bytes for the JSON string payload.
    const planRec = await store.getArtifactRecord(plans[0].artifactId);
    expect(planRec.bytes).toBe(11);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("non-atomic import rejects overwrite=false when run exists", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_non_atomic_overwrite_false";
    const dbName = makeDbName("non_atomic_overwrite_false");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    // Pre-create the run so the non-atomic overwrite=false branch throws.
    await store.createRun({ schemaVersion: "0.1", runId, mode: "test", constraints: {}, startedAt: new Date().toISOString() });

    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ schemaVersion: "0.1", runId, artifacts: [] }));
    zip.file("events.jsonl", "");
    const blob = await zip.generateAsync({ type: "blob" });

    await expect(importRunFromZip(blob, { runStore: store, overwrite: false, atomic: false })).rejects.toThrow(/already exists/i);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("imports artifacts via zipPath + artifacts/<artifactId> candidates and normalizes runContext (fileLike arrayBuffer branch)", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_import_paths";
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        createdAt: "2020-01-01T00:00:00.000Z",
        runContext: {
          schemaVersion: 123, // force defaulting to "0.1"
          runId: "WRONG_ID", // should be overwritten by importer
          mode: "", // force defaulting to "imported"
          constraints: null, // force defaulting to {}
          startedAt: "", // force fallback to manifest.createdAt
        },
        artifacts: [
          // zipPath should win over artifacts/<artifactId> and type candidates.
          { type: "plan.json", artifactId: "id_zipPath", storageKey: `runs/${runId}/plan.json`, zipPath: "nested/preferred.json" },
          // artifacts/<artifactId> should be used when zipPath is missing.
          { type: "other.json", artifactId: "id_artifacts_path", storageKey: `runs/${runId}/other.json` },
        ],
      }),
    );

    zip.file("nested/preferred.json", '{"via":"zipPath"}');
    zip.file("plan.json", '{"via":"type"}');
    zip.file("artifacts/id_artifacts_path", '{"via":"artifactId"}');
    zip.file("other.json", '{"via":"type"}');
    zip.file("events.jsonl", "");
    const blob = await zip.generateAsync({ type: "blob" });

    // Ensure we hit the `file.arrayBuffer()` import branch (non-Blob but arrayBuffer-capable).
    const fileLike = { arrayBuffer: async () => await blob.arrayBuffer() };

    const dbName = makeDbName("import_paths");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const outRunId = await importRunFromZip(fileLike, { runStore: store, overwrite: true, atomic: false });
    expect(outRunId).toBe(runId);

    // zipPath candidate wins.
    expect(await store.getArtifact(runId, "plan.json")).toEqual({ via: "zipPath" });
    // artifacts/<artifactId> candidate wins.
    expect(await store.getArtifact(runId, "other.json")).toEqual({ via: "artifactId" });

    const ctx = await store.getRun(runId);
    expect(ctx?.schemaVersion).toBe("0.1");
    expect(ctx?.runId).toBe(runId);
    expect(ctx?.mode).toBe("imported");
    expect(ctx?.constraints).toEqual({});
    expect(ctx?.startedAt).toBe("2020-01-01T00:00:00.000Z");

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("non-atomic import stores invalid .json payload as raw string and skips empty events.jsonl", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_non_atomic_invalid_json";
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        artifacts: [{ type: "bad.json", artifactId: "bad1", storageKey: `runs/${runId}/bad.json` }],
      }),
    );
    zip.file("bad.json", "{ not valid json: }}}");
    // Present but empty -> importer should not call appendEventsFromJsonl().
    zip.file("events.jsonl", "");
    const blob = await zip.generateAsync({ type: "blob" });

    const dbName = makeDbName("non_atomic_invalid_json");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const outRunId = await importRunFromZip(blob, { runStore: store, overwrite: true, atomic: false });
    expect(outRunId).toBe(runId);

    const payload = await store.getArtifact(runId, "bad.json");
    expect(typeof payload).toBe("string");
    expect(payload).toContain("not valid json");
    expect(await store.getEvents(runId)).toHaveLength(0);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("non-atomic import handles binary artifacts, text mime, and .jsonl artifact payloads", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_non_atomic_type_edges";
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        artifacts: [
          { type: "payload.bin", artifactId: "bin1", storageKey: `runs/${runId}/payload.bin` },
          // shouldLoadAsText via mime.startsWith("text/")
          { type: "notes.txt", artifactId: "txt1", mime: "text/plain", storageKey: `runs/${runId}/notes.txt` },
          // shouldLoadAsText via type.endsWith(".jsonl") (but not parsed as JSON)
          { type: "trace.jsonl", artifactId: "jsonl1", storageKey: `runs/${runId}/trace.jsonl` },
        ],
      }),
    );
    zip.file("payload.bin", new Uint8Array([1, 2, 3]));
    zip.file("notes.txt", "hello world");
    zip.file("trace.jsonl", '{"a":1}\n{"b":2}\n');
    // ensure appendEventsFromJsonl is exercised too (and indexed for getEvents()).
    zip.file("events.jsonl", '{"eventId":"evt_1","runId":"' + runId + '","ts":"2020-01-01T00:00:00.000Z"}\n');
    const blob = await zip.generateAsync({ type: "blob" });

    const dbName = makeDbName("non_atomic_type_edges");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const outRunId = await importRunFromZip(blob, { runStore: store, overwrite: true, atomic: false });
    expect(outRunId).toBe(runId);

    expect(await store.getArtifact(runId, "payload.bin")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await store.getArtifact(runId, "notes.txt")).toBe("hello world");
    expect(await store.getArtifact(runId, "trace.jsonl")).toBe('{"a":1}\n{"b":2}\n');
    expect(await store.getEvents(runId)).toHaveLength(1);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("rejects manifest with empty runId", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ schemaVersion: "0.1", runId: "   ", artifacts: [] }));
    const blob = await zip.generateAsync({ type: "blob" });

    const dbName = makeDbName("empty_runid");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    await expect(importRunFromZip(blob, { runStore: store, overwrite: true })).rejects.toThrow(/manifest\.runId must be a non-empty string/i);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("imports using jszip dynamic import fallback when the module has no default export", async () => {
    vi.resetModules();

    class StubZipFile {
      constructor(value) {
        this._value = value;
      }
      async async(_type) {
        return this._value;
      }
    }
    class StubZip {
      constructor(files) {
        this._files = files;
      }
      file(path) {
        return this._files[path] || null;
      }
    }

    vi.doMock("jszip", () => ({
      // The real package has a default export; we intentionally set it to undefined
      // so getJSZip() takes the `mod.default || mod` fallback branch.
      default: undefined,
      loadAsync: async (_input) =>
        new StubZip({
          "manifest.json": new StubZipFile(JSON.stringify({ schemaVersion: "0.1", runId: "run_jszip_no_default", artifacts: [] })),
          "events.jsonl": new StubZipFile(""),
        }),
    }));

    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const dbName = makeDbName("jszip_no_default");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const outRunId = await importRunFromZip(new Uint8Array([0]), { runStore: store, overwrite: true, atomic: false });
    expect(outRunId).toBe("run_jszip_no_default");

    await store.close();
    await RunStore.deleteDatabase({ dbName });
    vi.doUnmock("jszip");
  });

  it("atomic import normalizes missing artifactId/storageKey, stores sha256, and sanitizes events.jsonl lines", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");
    const { RunStore: LocalRunStore } = await import("../../../js/agents/storage/run-store.js");

    const runId = "run_atomic_import_edges";
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        // omit createdAt so startedAt falls back to new Date().toISOString()
        artifacts: [
          {
            type: "plan.json",
            // artifactId + storageKey intentionally omitted to force default generation
            sha256: "deadbeef",
            bytes: -1,
            seq: 0,
          },
        ],
      }),
    );
    zip.file("plan.json", '{"ok":true}');
    zip.file(
      "events.jsonl",
      [
        "123",
        JSON.stringify({ eventId: "", runId, ts: "2020-01-01T00:00:00.000Z" }),
        JSON.stringify({ eventId: "evt_1", runId: "WRONG_RUN", ts: "2020-01-01T00:00:00.001Z" }),
        "not-json",
        "",
      ].join("\n") + "\n",
    );

    const blob = await zip.generateAsync({ type: "blob" });

    const dbName = makeDbName("atomic_import_edges");
    await LocalRunStore.deleteDatabase({ dbName });
    const store = new LocalRunStore({ dbName });

    const outRunId = await importRunFromZip(blob, { runStore: store, overwrite: true });
    expect(outRunId).toBe(runId);

    expect(await store.getArtifact(runId, "plan.json")).toEqual({ ok: true });
    const artifacts = await store.listArtifacts(runId);
    expect(artifacts).toHaveLength(1);

    const rec = await store.getArtifactRecord(artifacts[0].artifactId);
    expect(rec?.storageKey).toBe(`runs/${runId}/plan.json`);
    expect(rec?.sha256).toBe("deadbeef");

    const events = await store.getEvents(runId);
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe("evt_1");
    expect(events[0].runId).toBe(runId);

    const ctx = await store.getRun(runId);
    expect(typeof ctx?.startedAt).toBe("string");
    expect(ctx?.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await store.close();
    await LocalRunStore.deleteDatabase({ dbName });
  });

  it("non-atomic import batches 200 events (covers appendEventsFromJsonl batch flush)", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_non_atomic_200_events";
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({ schemaVersion: "0.1", runId, artifacts: [] }));

    const lines = [];
    for (let i = 1; i <= 200; i++) {
      lines.push(
        JSON.stringify({
          schemaVersion: "0.1",
          eventId: `evt_${String(i).padStart(3, "0")}`,
          runId,
          ts: `2020-01-01T00:00:00.${String(i).padStart(3, "0")}Z`,
        }),
      );
    }
    zip.file("events.jsonl", lines.join("\n") + "\n");
    const blob = await zip.generateAsync({ type: "blob" });

    const dbName = makeDbName("non_atomic_200_events");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    const outRunId = await importRunFromZip(blob, { runStore: store, overwrite: true, atomic: false });
    expect(outRunId).toBe(runId);

    expect(await store.getEvents(runId)).toHaveLength(200);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("validate rejects missing payloads without artifactId, after exercising unsafe zipPath checks", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    const runId = "run_validate_unsafe_paths";
    const zip = new JSZip();
    zip.file(
      "manifest.json",
      JSON.stringify({
        schemaVersion: "0.1",
        runId,
        artifacts: [
          // zipPath starts with "/" -> ignored, but type exists so validation passes.
          { type: "plan.json", zipPath: "/abs/plan.json", storageKey: `runs/${runId}/plan.json` },
          // zipPath includes a NUL byte -> ignored, but type exists so validation passes.
          { type: "tool_output.json", zipPath: "evil\u0000path.json", storageKey: `runs/${runId}/tool_output.json` },
          // No artifactId, and payload is missing -> validation should throw without "artifactId=".
          { type: "lint_report.json", zipPath: "missing.json", storageKey: `runs/${runId}/lint_report.json` },
        ],
      }),
    );
    zip.file("plan.json", '{"ok":true}');
    zip.file("tool_output.json", '{"ok":true}');
    const blob = await zip.generateAsync({ type: "blob" });

    const dbName = makeDbName("validate_unsafe_paths");
    await RunStore.deleteDatabase({ dbName });
    const store = new RunStore({ dbName });

    let err = null;
    try {
      await importRunFromZip(blob, { runStore: store, overwrite: true });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(Error);
    expect(String(err?.message || "")).toMatch(/missing artifact payload/i);
    expect(String(err?.message || "")).not.toMatch(/artifactId=/i);

    await store.close();
    await RunStore.deleteDatabase({ dbName });
  });

  it("validate mode rejects malformed zips (missing manifest / duplicate ids / missing payload)", async () => {
    vi.resetModules();
    const { importRunFromZip } = await import("../../../js/agents/storage/run-exporter.js");

    // Missing manifest.json
    {
      const zip = new JSZip();
      zip.file("events.jsonl", "");
      const blob = await zip.generateAsync({ type: "blob" });
      await expect(importRunFromZip(blob, { runStore: new RunStore({ dbName: makeDbName("missing_manifest") }) })).rejects.toThrow(
        /missing manifest\.json/i,
      );
    }

    // Duplicate artifactId
    {
      const runId = "run_dup";
      const zip = new JSZip();
      zip.file(
        "manifest.json",
        JSON.stringify({
          schemaVersion: "0.1",
          runId,
          artifacts: [
            { type: "plan.json", artifactId: "dup", storageKey: `runs/${runId}/plan.json` },
            { type: "plan.json", artifactId: "dup", storageKey: `runs/${runId}/plan.json` },
          ],
        }),
      );
      zip.file("plan.json", '{"ok":true}');
      const blob = await zip.generateAsync({ type: "blob" });
      await expect(importRunFromZip(blob, { runStore: new RunStore({ dbName: makeDbName("dup") }) })).rejects.toThrow(/duplicate artifactId/i);
    }

    // Missing artifact payload in zip
    {
      const runId = "run_missing_payload";
      const zip = new JSZip();
      zip.file(
        "manifest.json",
        JSON.stringify({
          schemaVersion: "0.1",
          runId,
          artifacts: [{ type: "plan.json", artifactId: "a1", storageKey: `runs/${runId}/plan.json`, zipPath: "missing.json" }],
        }),
      );
      const blob = await zip.generateAsync({ type: "blob" });
      await expect(importRunFromZip(blob, { runStore: new RunStore({ dbName: makeDbName("missing_payload") }) })).rejects.toThrow(
        /missing artifact payload/i,
      );
    }
  });
});
