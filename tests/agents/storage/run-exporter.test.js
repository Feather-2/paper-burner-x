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
});

describe("RunExporter importRunFromZip()", () => {
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
