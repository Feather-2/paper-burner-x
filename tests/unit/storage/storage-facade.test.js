/**
 * @file tests/storage/storage-facade.test.js
 * @description StorageFacade 集成测试（使用 MemoryAdapter）
 */

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";

// StorageFacade 模块在顶层会创建单例（依赖 localStorage / indexedDB）。
// Vitest 的 node 环境没有 localStorage，因此这里提供最小 stub 以保证模块可导入。
if (typeof globalThis.localStorage === "undefined") {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
    get length() {
      return storage.size;
    },
    key: (index) => [...storage.keys()][index] ?? null,
  };
}

const loadModules = async () => {
  const { MemoryAdapter } = await import("../../../js/storage/adapters/memory-adapter.js");
  const { default: StorageFacade } = await import("../../../js/storage/storage-facade.js");
  return { MemoryAdapter, StorageFacade };
};

describe("StorageFacade.createForTesting()", () => {
  let StorageFacade;
  let MemoryAdapter;
  let facade;

  beforeEach(async () => {
    const modules = await loadModules();
    StorageFacade = modules.StorageFacade;
    MemoryAdapter = modules.MemoryAdapter;
    facade = StorageFacade.createForTesting();
  });

  it("should create a test instance with all repositories available", () => {
    expect(facade).toBeInstanceOf(StorageFacade);

    expect(facade.settings).toBeDefined();
    expect(facade.apiKeys).toBeDefined();
    expect(facade.results).toBeDefined();
    expect(facade.processedFiles).toBeDefined();
    expect(facade.annotations).toBeDefined();

    expect(facade.settings.loadSettings).toEqual(expect.any(Function));
    expect(facade.settings.saveSettings).toEqual(expect.any(Function));

    expect(facade.apiKeys.loadModelKeys).toEqual(expect.any(Function));
    expect(facade.apiKeys.saveModelKeys).toEqual(expect.any(Function));

    expect(facade.results.saveResultToDB).toEqual(expect.any(Function));
    expect(facade.results.getResultFromDB).toEqual(expect.any(Function));
    expect(facade.results.getAllResultsFromDB).toEqual(expect.any(Function));
    expect(facade.results.deleteResultFromDB).toEqual(expect.any(Function));
    expect(facade.results.clearAllResultsFromDB).toEqual(expect.any(Function));

    expect(facade.annotations.saveAnnotationToDB).toEqual(expect.any(Function));
    expect(facade.annotations.getAnnotationsForDocFromDB).toEqual(expect.any(Function));
    expect(facade.annotations.updateAnnotationInDB).toEqual(expect.any(Function));
    expect(facade.annotations.deleteAnnotationFromDB).toEqual(expect.any(Function));
  });

  it("should use MemoryAdapter for all adapters", () => {
    const adapters = facade.getAdapters();
    expect(adapters).toBeDefined();
    expect(adapters.local).toBeInstanceOf(MemoryAdapter);
    expect(adapters.idbResults).toBeInstanceOf(MemoryAdapter);
    expect(adapters.idbAnnotations).toBeInstanceOf(MemoryAdapter);
    expect(adapters.local).toBe(adapters.idbResults);
    expect(adapters.local).toBe(adapters.idbAnnotations);
  });
});

describe("StorageFacade repository integration", () => {
  let StorageFacade;
  let facade;

  beforeEach(async () => {
    ({ StorageFacade } = await loadModules());
    facade = StorageFacade.createForTesting();
  });

  it("settings.saveSettings / loadSettings should roundtrip and keep defaults", async () => {
    await facade.settings.saveSettings({ targetLanguage: "english", concurrencyLevel: "5" });
    const settings = await facade.settings.loadSettings();

    expect(settings.targetLanguage).toBe("english");
    expect(settings.concurrencyLevel).toBe("5");
    // 确认仍有默认值
    expect(settings.maxTokensPerChunk).toBe("2000");
  });

  it("apiKeys.saveModelKeys / loadModelKeys should roundtrip", async () => {
    const keys = [{ id: "1", value: "sk-test-key", remark: "", status: "untested", order: 0 }];
    await facade.apiKeys.saveModelKeys("openai", keys);

    const loaded = await facade.apiKeys.loadModelKeys("openai");
    expect(loaded).toEqual(keys);
  });

  it("results repository should support CRUD operations", async () => {
    const result1 = { id: "r1", title: "Result 1", data: { ok: true } };
    const result2 = { id: "r2", title: "Result 2", data: { ok: false } };

    await facade.results.saveResultToDB(result1);
    await facade.results.saveResultToDB(result2);

    expect(await facade.results.getResultFromDB("r1")).toEqual(result1);
    expect(await facade.results.getResultFromDB("r2")).toEqual(result2);

    const all = await facade.results.getAllResultsFromDB();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.id)).toEqual(expect.arrayContaining(["r1", "r2"]));

    await facade.results.deleteResultFromDB("r1");
    expect(await facade.results.getResultFromDB("r1")).toBeNull();

    await facade.results.clearAllResultsFromDB();
    expect(await facade.results.getAllResultsFromDB()).toEqual([]);
  });

  it("annotations repository should support save/query/update/delete", async () => {
    const docId = "doc_1";
    const ann1 = { id: "a1", docId, text: "hello" };
    const ann2 = { id: "a2", docId: "doc_2", text: "other doc" };

    await facade.annotations.saveAnnotationToDB(ann1);
    await facade.annotations.saveAnnotationToDB(ann2);

    const doc1Anns = await facade.annotations.getAnnotationsForDocFromDB(docId);
    expect(doc1Anns).toHaveLength(1);
    expect(doc1Anns[0].id).toBe("a1");
    expect(doc1Anns[0].docId).toBe(docId);
    expect(doc1Anns[0].createdAt).toEqual(expect.any(String));
    expect(doc1Anns[0].updatedAt).toEqual(expect.any(String));

    const updated = { ...doc1Anns[0], text: "updated" };
    await facade.annotations.updateAnnotationInDB(updated);
    const afterUpdate = await facade.annotations.getAnnotationsForDocFromDB(docId);
    expect(afterUpdate[0].text).toBe("updated");
    expect(afterUpdate[0].createdAt).toBe(doc1Anns[0].createdAt);

    await facade.annotations.deleteAnnotationFromDB("a1");
    expect(await facade.annotations.getAnnotationsForDocFromDB(docId)).toEqual([]);
  });
});

describe("StorageFacade.getAdapters()", () => {
  let StorageFacade;
  let MemoryAdapter;
  let facade;

  beforeEach(async () => {
    const modules = await loadModules();
    StorageFacade = modules.StorageFacade;
    MemoryAdapter = modules.MemoryAdapter;
    facade = StorageFacade.createForTesting();
  });

  it("should return all adapters", () => {
    const adapters = facade.getAdapters();
    expect(adapters).toEqual(
      expect.objectContaining({
        local: expect.any(MemoryAdapter),
        idbResults: expect.any(MemoryAdapter),
        idbAnnotations: expect.any(MemoryAdapter),
      }),
    );
  });
});

