/**
 * @file js/storage/index.js
 * @description 存储模块统一导出
 */

// 适配器
export { BaseStorageAdapter } from './adapters/base-adapter.js';
export { LocalStorageAdapter } from './adapters/local-storage-adapter.js';
export { IdbAdapter } from './adapters/idb-adapter.js';
export { MemoryAdapter } from './adapters/memory-adapter.js';

// 仓库
export { BaseRepository } from './repositories/base-repository.js';
export { SettingsRepository } from './repositories/settings-repository.js';
export { ApiKeysRepository } from './repositories/api-keys-repository.js';
export { ResultsRepository } from './repositories/results-repository.js';
export { ProcessedFilesRepository } from './repositories/processed-files-repository.js';
export { AnnotationsRepository } from './repositories/annotations-repository.js';

// 门面
export { storage, default as StorageFacade } from './storage-facade.js';
