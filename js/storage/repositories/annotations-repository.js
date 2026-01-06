/**
 * @file js/storage/repositories/annotations-repository.js
 * @description
 * 批注（高亮）数据仓库（IndexedDB）。
 *
 * 参考实现：js/storage/storage.js:1342-1400 的 saveAnnotationToDB/getAnnotationsForDocFromDB/updateAnnotationInDB/deleteAnnotationFromDB
 */

import BaseRepository from "./base-repository.js";
import IdbAdapter from "../adapters/idb-adapter.js";

const DB_NAME = "ResultDB";
const DB_VERSION = 3;
const ANNOTATIONS_STORE_NAME = "annotations";
const RESULTS_STORE_NAME = "results";
const SEMANTIC_GROUPS_STORE_NAME = "semantic_groups";

function ensureResultDbSchema({ db, event }) {
  if (!db.objectStoreNames.contains(RESULTS_STORE_NAME)) {
    db.createObjectStore(RESULTS_STORE_NAME, { keyPath: "id" });
  }

  if (!db.objectStoreNames.contains(ANNOTATIONS_STORE_NAME)) {
    const annotationsStore = db.createObjectStore(ANNOTATIONS_STORE_NAME, { keyPath: "id" });
    annotationsStore.createIndex("docId", "docId", { unique: false });
  } else {
    try {
      const tx = event?.target?.transaction;
      const store = tx?.objectStore?.(ANNOTATIONS_STORE_NAME);
      if (store && store.indexNames && !store.indexNames.contains("docId")) {
        store.createIndex("docId", "docId", { unique: false });
      }
    } catch {
      // ignore
    }
  }

  if (!db.objectStoreNames.contains(SEMANTIC_GROUPS_STORE_NAME)) {
    db.createObjectStore(SEMANTIC_GROUPS_STORE_NAME, { keyPath: "docId" });
  }
}

export class AnnotationsRepository extends BaseRepository {
  /**
   * @param {import("../adapters/base-adapter.js").BaseStorageAdapter} [adapter]
   */
  constructor(
    adapter = new IdbAdapter({
      dbName: DB_NAME,
      storeName: ANNOTATIONS_STORE_NAME,
      version: DB_VERSION,
      storeOptions: { keyPath: "id" },
      onUpgrade: ensureResultDbSchema,
    }),
  ) {
    super(adapter);
  }

  /**
   * 保存高亮/批注
   * @param {Object} annotation - 必须包含 id, docId
   * @returns {Promise<void>}
   */
  async saveAnnotationToDB(annotation) {
    if (!annotation || typeof annotation !== "object") {
      throw new Error("AnnotationsRepository.saveAnnotationToDB: annotation must be an object");
    }
    if (!annotation.id) {
      throw new Error("AnnotationsRepository.saveAnnotationToDB: annotation.id is required");
    }

    const now = new Date().toISOString();
    const normalized = {
      ...annotation,
      createdAt: annotation.createdAt || now,
      updatedAt: now,
    };

    await this.adapter.set(annotation.id, normalized);
  }

  /**
   * 获取某个文档的全部批注
   * @param {string} docId
   * @returns {Promise<Array<Object>>}
   */
  async getAnnotationsForDocFromDB(docId) {
    const ids = await this.adapter.keys();
    if (!Array.isArray(ids) || ids.length === 0) return [];

    const out = [];
    for (const id of ids) {
      const value = await this.adapter.get(id);
      if (value && value.docId === docId) out.push(value);
    }
    return out;
  }

  /**
   * 更新批注（等同于保存）
   * @param {Object} annotation
   * @returns {Promise<void>}
   */
  async updateAnnotationInDB(annotation) {
    return await this.saveAnnotationToDB(annotation);
  }

  /**
   * 删除批注
   * @param {string} annotationId
   * @returns {Promise<void>}
   */
  async deleteAnnotationFromDB(annotationId) {
    await this.adapter.remove(annotationId);
  }
}

export default AnnotationsRepository;

