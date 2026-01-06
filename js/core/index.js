/**
 * @file js/core/index.js
 * @description 核心模块统一导出
 */

// API
export { KeyProvider } from './api/key-provider.js';

// File
export {
  SUPPORTED_EXTENSIONS,
  SUPPORTED_ARCHIVES,
  deriveExtension,
  isSupportedFileExtension,
  isSupportedArchive,
  getFileIdentifier,
  annotateFileMetadata,
  shouldProcessFile,
  getDisplayName
} from './file/file-utils.js';

export {
  extractFilesFromZip,
  extractFilesFromDataTransfer,
  isFromZip,
  getSourceArchive
} from './file/zip-extractor.js';

// Processing
export {
  createSemaphore,
  acquire,
  release,
  updateLimit,
  getStatus,
  Semaphore
} from './processing/semaphore.js';

export { ProcessQueue } from './processing/process-queue.js';
