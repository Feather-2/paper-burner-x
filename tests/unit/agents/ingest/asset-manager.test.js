import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../js/agents/stages/textprep/normalize.js", async () => {
  const actual = await vi.importActual("../../../../js/agents/stages/textprep/normalize.js");
  return { ...actual, normalizeText: vi.fn(actual.normalizeText) };
});

import { AssetManager } from "../../../../js/agents/ingest/asset-manager.js";
import { normalizeText } from "../../../../js/agents/stages/textprep/normalize.js";
import { AssetMimeType } from "../../../../js/agents/ingest/constants.js";

const makeAsset = (overrides = {}) => ({
  docId: "doc-1",
  type: "image",
  data: "data:image/png;base64,AAAA",
  mimeType: "image/png",
  source: "extracted",
  reusable: true,
  ...overrides,
});

const makeLargeBase64 = (len) => "A".repeat(len - (len % 4));

describe("AssetManager", () => {
  let manager;

  beforeEach(() => {
    manager = new AssetManager();
    vi.clearAllMocks();
  });

  describe("addAsset", () => {
    it("throws for invalid assets and missing docId", () => {
      const invalid = [null, undefined, "", [], 0];
      for (const value of invalid) {
        expect(() => manager.addAsset(value)).toThrow(TypeError);
      }
      expect(() => manager.addAsset({})).toThrow(/docId/);
      expect(() => manager.addAsset({ docId: "   ", type: "image", data: "data:image/png;base64,AAAA" })).toThrow(/docId/);
    });

    it("accepts numeric boundary docIds/assetIds and normalizes mimeType", () => {
      const id0 = manager.addAsset(
        makeAsset({ docId: 0, assetId: 0, mimeType: "image/jpg", data: "data:image/jpg;base64,AAAA" })
      );
      expect(id0).toBe("0");
      const asset0 = manager.getAsset(id0);
      expect(asset0.docId).toBe(0);
      expect(asset0.mimeType).toBe(AssetMimeType.JPEG);

      const idNeg = manager.addAsset(makeAsset({ docId: -1, assetId: -1, data: "data:image/png;base64,AAAB" }));
      expect(idNeg).toBe("-1");

      const max = Number.MAX_SAFE_INTEGER;
      const idMax = manager.addAsset(makeAsset({ docId: max, assetId: max, data: "data:image/png;base64,AAAC" }));
      expect(idMax).toBe(String(max));
    });

    it("deduplicates identical assets and records doc references", () => {
      const asset = makeAsset({ docId: "doc-1", data: "data:image/png;base64,AAAA" });
      const id1 = manager.addAsset(asset);
      const id2 = manager.addAsset({ ...asset, assetId: "custom-id" });

      expect(id2).toBe(id1);
      expect(manager.count()).toBe(1);
      expect(manager.getAssetIdsForDoc("doc-1")).toEqual([id1]);

      const id3 = manager.addAsset({ ...asset, docId: "doc-2" });
      expect(id3).toBe(id1);
      expect(manager.getAssetIdsForDoc("doc-2")).toEqual([id1]);
    });

    it("avoids assetId collisions by generating a new id", () => {
      const id1 = manager.addAsset(makeAsset({ assetId: "custom", data: "data:image/png;base64,AAAA" }));
      const id2 = manager.addAsset(makeAsset({ assetId: "custom", data: "data:image/png;base64,AAAB" }));

      expect(id1).toBe("custom");
      expect(id2).not.toBe("custom");
      expect(id2).toMatch(/^asset_[0-9a-f]{12}_c2$/);
      expect(manager.count()).toBe(2);
    });

    it("handles concurrent and rapid addAsset calls", async () => {
      const asset = makeAsset({ docId: "doc-rapid", data: "data:image/png;base64,AAAA" });
      const ids = await Promise.all(
        Array.from({ length: 5 }, () => Promise.resolve().then(() => manager.addAsset(asset)))
      );
      expect(new Set(ids).size).toBe(1);
      expect(manager.count()).toBe(1);

      for (let i = 0; i < 10; i++) {
        manager.addAsset(makeAsset({ docId: `doc-${i}`, data: `data:image/png;base64,AA${String(i).padStart(2, "0")}` }));
      }
      expect(manager.count()).toBe(11);
    });

    it("stores distinct assets when sampling hash collides", () => {
      const payloadLen = 6000;
      const data1 = `data:image/png;base64,${"A".repeat(payloadLen)}`;
      const mutateAt = 3000;
      const data2 = data1.slice(0, mutateAt) + "B" + data1.slice(mutateAt + 1);

      const id1 = manager.addAsset(makeAsset({ docId: "doc-1", data: data1 }));
      const id2 = manager.addAsset(makeAsset({ docId: "doc-1", data: data2 }));

      expect(id1).not.toBe(id2);
      expect(manager.count()).toBe(2);
      expect(manager.getAsset(id1).data).toBe(data1);
      expect(manager.getAsset(id2).data).toBe(data2);
    });

    it("stores large data as bytes and materializes data_uri on read", () => {
      const base64 = makeLargeBase64(8192);
      const data = `data:image/png;base64,${base64}`;
      const id = manager.addAsset(makeAsset({ docId: "doc-large", data }));

      const stored = manager.assetsById.get(id);
      expect(stored.dataBytes).toBeInstanceOf(Uint8Array);
      expect(stored.dataFormat).toBe("data_uri");
      expect(stored.data).toBeUndefined();

      const materialized = manager.getAsset(id);
      expect(materialized.data).toBe(data);
      expect(materialized.dataBytes).toBeUndefined();
      expect(materialized.dataFormat).toBeUndefined();
      expect(materialized._hash).toBeUndefined();
      expect(materialized._collisionSig).toBeUndefined();
    });

    it("stores large base64 payloads without data URI and materializes on read", () => {
      const base64 = makeLargeBase64(8192);
      const id = manager.addAsset(makeAsset({ docId: "doc-base64", data: base64 }));

      const stored = manager.assetsById.get(id);
      expect(stored.dataBytes).toBeInstanceOf(Uint8Array);
      expect(stored.dataFormat).toBe("base64");

      const materialized = manager.getAsset(id);
      expect(materialized.data).toBe(base64);
      expect(materialized.data.startsWith("data:")).toBe(false);
    });

    it("tracks long docIds and deep metadata", () => {
      const longDocId = `doc_${"x".repeat(10000)}`;
      const deepMeta = { a: { b: { c: { d: { e: { f: "g" } } } } } };
      const id = manager.addAsset(makeAsset({ docId: longDocId, metadata: deepMeta, data: "data:image/png;base64,AAAD" }));

      expect(manager.getAssetIdsForDoc(longDocId)).toEqual([id]);
      const asset = manager.getAsset(id);
      expect(asset.metadata).toEqual(deepMeta);
    });
  });

  describe("addAssets", () => {
    it("throws when assets is not an array", () => {
      expect(() => manager.addAssets({})).toThrow(TypeError);
    });

    it("returns empty array for empty input", () => {
      const ids = manager.addAssets([]);
      expect(ids).toEqual([]);
      expect(manager.count()).toBe(0);
    });

    it("adds multiple assets and preserves order", () => {
      const assets = [
        makeAsset({ docId: "doc-a", data: "data:image/png;base64,AAAA" }),
        makeAsset({ docId: "doc-b", data: "data:image/png;base64,AAAB" }),
      ];
      const ids = manager.addAssets(assets);
      expect(ids).toHaveLength(2);
      expect(ids[0]).not.toBe(ids[1]);
      expect(manager.count()).toBe(2);
    });
  });

  describe("getAsset", () => {
    it("returns null for invalid or missing ids", () => {
      expect(manager.getAsset(null)).toBeNull();
      expect(manager.getAsset(undefined)).toBeNull();
      expect(manager.getAsset("")).toBeNull();
      expect(manager.getAsset("   ")).toBeNull();
      expect(manager.getAsset(0)).toBeNull();
      expect(manager.getAsset(-1)).toBeNull();
      expect(manager.getAsset(Number.MAX_SAFE_INTEGER)).toBeNull();
    });

    it("materializes assets without leaking internal fields", () => {
      const id = manager.addAsset(makeAsset({ data: "data:image/png;base64,AAAA" }));
      const asset = manager.getAsset(id);

      expect(asset._hash).toBeUndefined();
      expect(asset._collisionSig).toBeUndefined();
      expect(asset.dataBytes).toBeUndefined();
      expect(asset.dataFormat).toBeUndefined();
      expect(asset.assetId).toBe(id);
    });
  });

  describe("getAssetIdsForDoc", () => {
    it("returns [] for invalid docIds", () => {
      expect(manager.getAssetIdsForDoc(null)).toEqual([]);
      expect(manager.getAssetIdsForDoc(undefined)).toEqual([]);
      expect(manager.getAssetIdsForDoc("")).toEqual([]);
      expect(manager.getAssetIdsForDoc("   ")).toEqual([]);
    });

    it("accepts numeric and string docIds interchangeably", () => {
      const id = manager.addAsset(makeAsset({ docId: 123, data: "data:image/png;base64,AAAA" }));
      expect(manager.getAssetIdsForDoc(123)).toEqual([id]);
      expect(manager.getAssetIdsForDoc("123")).toEqual([id]);
    });
  });

  describe("listAssets", () => {
    it("returns materialized assets", () => {
      const base64 = makeLargeBase64(8192);
      const id = manager.addAsset(makeAsset({ docId: "doc-list", data: `data:image/png;base64,${base64}` }));

      const list = manager.listAssets();
      expect(list).toHaveLength(1);
      expect(list[0].assetId).toBe(id);
      expect(list[0].data).toBe(`data:image/png;base64,${base64}`);
      expect(list[0].dataBytes).toBeUndefined();
      expect(list[0].dataFormat).toBeUndefined();
    });
  });

  describe("count", () => {
    it("reports asset count accurately", () => {
      expect(manager.count()).toBe(0);
      manager.addAsset(makeAsset({ docId: "doc-1", data: "data:image/png;base64,AAAA" }));
      manager.addAsset(makeAsset({ docId: "doc-2", data: "data:image/png;base64,AAAB" }));
      expect(manager.count()).toBe(2);
    });
  });

  it("calls normalizeText for hashing", () => {
    manager.addAsset(makeAsset({ docId: "doc-hash", data: "data:image/png;base64,AAAA" }));
    expect(normalizeText).toHaveBeenCalled();
  });
});
