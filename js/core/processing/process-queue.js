/**
 * @file js/core/processing/process-queue.js
 * @description 文件处理队列，支持并发控制、重试和进度回调
 */

import { KeyProvider } from '../api/key-provider.js';
import { getFileIdentifier } from '../file/file-utils.js';
import { Semaphore } from './semaphore.js';

/**
 * 文件处理队列
 */
export class ProcessQueue {
  /**
   * @param {Object} options - 配置选项
   * @param {number} [options.concurrency=3] - 最大并发数
   * @param {number} [options.maxRetries=3] - 最大重试次数
   * @param {Function} [options.onProgress] - 进度回调
   * @param {Function} [options.onFileComplete] - 单文件完成回调
   * @param {Function} [options.onError] - 错误回调
   * @param {Function} [options.processor] - 文件处理函数
   */
  constructor(options = {}) {
    this._concurrency = options.concurrency || 3;
    this._maxRetries = options.maxRetries || 3;
    this._onProgress = options.onProgress || (() => {});
    this._onFileComplete = options.onFileComplete || (() => {});
    this._onError = options.onError || (() => {});
    this._processor = options.processor || null;

    this._queue = [];
    this._results = [];
    this._retryAttempts = new Map();
    this._isProcessing = false;
    this._isStopped = false;
    this._semaphore = new Semaphore(this._concurrency);
  }

  /**
   * 添加文件到队列
   * @param {File[]} files - 文件列表
   */
  addFiles(files) {
    files.forEach((file, index) => {
      this._queue.push({
        file,
        index: this._queue.length,
        identifier: getFileIdentifier(file)
      });
    });
  }

  /**
   * 清空队列
   */
  clear() {
    this._queue = [];
    this._results = [];
    this._retryAttempts.clear();
  }

  /**
   * 开始处理
   * @param {Object} config - 处理配置
   * @returns {Promise<Array>} 处理结果
   */
  async start(config) {
    if (this._isProcessing) {
      throw new Error('Queue is already processing');
    }

    this._isProcessing = true;
    this._isStopped = false;
    this._results = new Array(this._queue.length).fill(null);

    const { translationModel, processedFilesRecord = {} } = config;

    // 初始化密钥提供者
    let keyProvider = null;
    if (translationModel && translationModel !== 'none') {
      keyProvider = new KeyProvider(translationModel);
      await keyProvider.init();
    }

    // 过滤已处理的文件
    const pendingItems = this._queue.filter(item => {
      return !processedFilesRecord[item.identifier];
    });

    // 并发处理
    const promises = pendingItems.map(item => this._processItem(item, config, keyProvider));

    await Promise.allSettled(promises);

    this._isProcessing = false;
    return this._results.filter(Boolean);
  }

  /**
   * 处理单个项目
   * @private
   */
  async _processItem(item, config, keyProvider) {
    if (this._isStopped) return;

    return this._semaphore.run(async () => {
      if (this._isStopped) return;

      const attempts = this._retryAttempts.get(item.index) || 0;

      try {
        let result;

        if (this._processor) {
          // 使用自定义处理器
          const keyObj = keyProvider ? await keyProvider.getNextKey() : null;
          result = await this._processor(item.file, keyObj, config);
        } else {
          // 使用全局 processSinglePdf（兼容旧代码）
          if (typeof window !== 'undefined' && typeof window.processSinglePdf === 'function') {
            const keyObj = keyProvider ? await keyProvider.getNextKey() : null;
            result = await window.processSinglePdf(item.file, keyObj, config);
          } else {
            throw new Error('No processor available');
          }
        }

        // 检查密钥是否失效
        if (result?.keyInvalid && keyProvider) {
          await keyProvider.markKeyAsInvalid(result.keyInvalid.keyId);
          throw new Error('API key invalid');
        }

        // 记录成功
        if (keyProvider && result?.usedKeyId) {
          await keyProvider.recordSuccess(result.usedKeyId);
        }

        this._results[item.index] = result;
        this._onFileComplete(result, item.file, item.index);
        this._onProgress(this._getProgress());

        return result;
      } catch (error) {
        if (attempts < this._maxRetries && !this._isStopped) {
          this._retryAttempts.set(item.index, attempts + 1);
          console.warn(`[ProcessQueue] Retrying ${item.file.name} (${attempts + 1}/${this._maxRetries})`);
          return this._processItem(item, config, keyProvider);
        }

        this._results[item.index] = { error: error.message, file: item.file };
        this._onError(error, item.file, item.index);
        this._onProgress(this._getProgress());

        return null;
      }
    });
  }

  /**
   * 获取进度信息
   * @private
   */
  _getProgress() {
    const completed = this._results.filter(r => r !== null).length;
    const errors = this._results.filter(r => r?.error).length;
    return {
      completed,
      errors,
      total: this._queue.length,
      active: this._semaphore.active,
      percentage: Math.round((completed / this._queue.length) * 100) || 0
    };
  }

  /**
   * 停止处理
   */
  stop() {
    this._isStopped = true;
  }

  /**
   * 是否正在处理
   */
  get isProcessing() {
    return this._isProcessing;
  }

  /**
   * 获取结果
   */
  get results() {
    return this._results;
  }

  /**
   * 获取队列长度
   */
  get length() {
    return this._queue.length;
  }

  /**
   * 更新并发数
   * @param {number} concurrency - 新的并发数
   */
  setConcurrency(concurrency) {
    this._concurrency = concurrency;
    this._semaphore.limit = concurrency;
  }
}

// 默认导出
export default ProcessQueue;
