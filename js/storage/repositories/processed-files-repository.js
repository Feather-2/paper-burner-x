/**
 * @file js/storage/repositories/processed-files-repository.js
 * @description
 * 已处理文件记录仓库（防止重复处理）。
 *
 * 参考实现：js/storage/storage.js:140-188 的 loadProcessedFilesRecord/saveProcessedFilesRecord
 * 默认值需与 storage.js 保持一致。
 */

import BaseRepository from "./base-repository.js";
import LocalStorageAdapter from "../adapters/local-storage-adapter.js";

const PROCESSED_FILES_KEY = "processedFilesRecord";

export class ProcessedFilesRepository extends BaseRepository {
  /**
   * @param {import("../adapters/base-adapter.js").BaseStorageAdapter} [adapter]
   */
  constructor(adapter = new LocalStorageAdapter()) {
    super(adapter);
  }

  /**
   * 加载已处理文件记录
   * @returns {Promise<Object>}
   */
  async loadProcessedFilesRecord() {
    let record = {};
    try {
      const stored = await this.adapter.get(PROCESSED_FILES_KEY);
      if (stored && typeof stored === "object") {
        record = stored;
      }
    } catch (e) {
      console.error("ProcessedFilesRepository.loadProcessedFilesRecord: failed, resetting:", e);
      record = {};
    }
    return record;
  }

  /**
   * 保存已处理文件记录
   * @param {Object} processedFilesRecord
   * @returns {Promise<void>}
   */
  async saveProcessedFilesRecord(processedFilesRecord) {
    try {
      await this.adapter.set(PROCESSED_FILES_KEY, processedFilesRecord);
    } catch (e) {
      console.error("ProcessedFilesRepository.saveProcessedFilesRecord: failed:", e);
    }
  }

  /**
   * 判断文件是否已处理
   * @param {string} fileIdentifier
   * @param {Object} processedFilesRecord
   * @returns {boolean}
   */
  isAlreadyProcessed(fileIdentifier, processedFilesRecord) {
    return Object.prototype.hasOwnProperty.call(processedFilesRecord, fileIdentifier) && processedFilesRecord[fileIdentifier] === true;
  }

  /**
   * 标记文件为已处理（不自动保存）
   * @param {string} fileIdentifier
   * @param {Object} processedFilesRecord
   */
  markFileAsProcessed(fileIdentifier, processedFilesRecord) {
    processedFilesRecord[fileIdentifier] = true;
  }
}

export default ProcessedFilesRepository;

