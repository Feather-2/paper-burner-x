/**
 * @file js/storage/storage-facade.js
 * @description 统一存储门面，提供所有 Repository 的单一访问点
 */

import { LocalStorageAdapter } from './adapters/local-storage-adapter.js';
import { IdbAdapter } from './adapters/idb-adapter.js';
import { MemoryAdapter } from './adapters/memory-adapter.js';

import { SettingsRepository } from './repositories/settings-repository.js';
import { ApiKeysRepository } from './repositories/api-keys-repository.js';
import { ResultsRepository } from './repositories/results-repository.js';
import { ProcessedFilesRepository } from './repositories/processed-files-repository.js';
import { AnnotationsRepository } from './repositories/annotations-repository.js';

/**
 * 存储门面类
 * 提供所有存储仓库的统一访问接口
 */
class StorageFacade {
  constructor() {
    // 创建适配器
    this._localAdapter = new LocalStorageAdapter('pb_');
    this._idbResultsAdapter = new IdbAdapter('ResultDB', 'results', {
      version: 3,
      storeOptions: { keyPath: 'id' }
    });
    this._idbAnnotationsAdapter = new IdbAdapter('ResultDB', 'annotations', {
      version: 3,
      storeOptions: { keyPath: 'id' },
      onUpgrade: (db, store) => {
        if (!store.indexNames.contains('docId')) {
          store.createIndex('docId', 'docId', { unique: false });
        }
      }
    });

    // 创建仓库
    this.settings = new SettingsRepository(this._localAdapter);
    this.apiKeys = new ApiKeysRepository(this._localAdapter);
    this.results = new ResultsRepository(this._idbResultsAdapter);
    this.processedFiles = new ProcessedFilesRepository(this._localAdapter);
    this.annotations = new AnnotationsRepository(this._idbAnnotationsAdapter);
  }

  /**
   * 创建测试用实例（使用内存适配器）
   * @returns {StorageFacade}
   */
  static createForTesting() {
    const facade = Object.create(StorageFacade.prototype);
    const memAdapter = new MemoryAdapter();

    facade._localAdapter = memAdapter;
    facade._idbResultsAdapter = memAdapter;
    facade._idbAnnotationsAdapter = memAdapter;

    facade.settings = new SettingsRepository(memAdapter);
    facade.apiKeys = new ApiKeysRepository(memAdapter);
    facade.results = new ResultsRepository(memAdapter);
    facade.processedFiles = new ProcessedFilesRepository(memAdapter);
    facade.annotations = new AnnotationsRepository(memAdapter);

    return facade;
  }

  /**
   * 获取所有适配器（用于备份等操作）
   */
  getAdapters() {
    return {
      local: this._localAdapter,
      idbResults: this._idbResultsAdapter,
      idbAnnotations: this._idbAnnotationsAdapter
    };
  }
}

// 导出单例
export const storage = new StorageFacade();

// 默认导出类
export default StorageFacade;
