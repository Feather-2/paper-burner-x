/**
 * @file js/storage/repositories/results-repository.js
 * @description
 * 处理结果仓库（IndexedDB）。
 *
 * 参考实现：js/storage/storage.js:318-368 的 saveResultToDB/getAllResultsFromDB/getResultFromDB/deleteResultFromDB/clearAllResultsFromDB
 */

import BaseRepository from "./base-repository.js";
import IdbAdapter from "../adapters/idb-adapter.js";

const DB_NAME = "ResultDB";
const DB_VERSION = 3;
const DB_STORE_NAME = "results";
const ANNOTATIONS_STORE_NAME = "annotations";
const SEMANTIC_GROUPS_STORE_NAME = "semantic_groups";

function ensureResultDbSchema({ db, event }) {
  // 兼容 storage.js 的 schema：results(id), annotations(id + docId index), semantic_groups(docId)
  if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
    db.createObjectStore(DB_STORE_NAME, { keyPath: "id" });
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
      // ignore: only available during upgrade transaction
    }
  }

  if (!db.objectStoreNames.contains(SEMANTIC_GROUPS_STORE_NAME)) {
    db.createObjectStore(SEMANTIC_GROUPS_STORE_NAME, { keyPath: "docId" });
  }
}

export class ResultsRepository extends BaseRepository {
  /**
   * @param {import("../adapters/base-adapter.js").BaseStorageAdapter} [adapter]
   */
  constructor(
    adapter = new IdbAdapter({
      dbName: DB_NAME,
      storeName: DB_STORE_NAME,
      version: DB_VERSION,
      storeOptions: { keyPath: "id" },
      onUpgrade: ensureResultDbSchema,
    }),
  ) {
    super(adapter);
  }

  /**
   * 保存处理结果
   * @param {Object} resultObj - 必须包含 id
   * @returns {Promise<void>}
   */
  async saveResultToDB(resultObj) {
    if (!resultObj || typeof resultObj !== "object") {
      throw new Error("ResultsRepository.saveResultToDB: resultObj must be an object");
    }
    if (!resultObj.id) {
      throw new Error("ResultsRepository.saveResultToDB: resultObj.id is required");
    }
    await this.adapter.set(resultObj.id, resultObj);
  }

  /**
   * 获取全部处理结果
   * @returns {Promise<Array<Object>>}
   */
  async getAllResultsFromDB() {
    const ids = await this.adapter.keys();
    if (!Array.isArray(ids) || ids.length === 0) return [];

    const out = [];
    for (const id of ids) {
      const value = await this.adapter.get(id);
      if (value) out.push(value);
    }
    return out;
  }

  /**
   * 获取单条结果
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getResultFromDB(id) {
    return await this.adapter.get(id);
  }

  /**
   * 删除单条结果
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteResultFromDB(id) {
    await this.adapter.remove(id);
  }

  /**
   * 清空全部结果
   * @returns {Promise<void>}
   */
  async clearAllResultsFromDB() {
    await this.adapter.clear();
  }
}

export default ResultsRepository;

