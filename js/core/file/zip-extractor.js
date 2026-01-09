/**
 * @file js/core/file/zip-extractor.js
 * @description ZIP 文件提取工具
 */

import {
  deriveExtension,
  isSupportedFileExtension,
  annotateFileMetadata
} from './file-utils.js';

/**
 * 从 ZIP 文件中提取支持的文件
 * @param {File} zipFile - ZIP 文件
 * @param {Object} [options] - 选项
 * @param {string} [options.pathPrefix] - 路径前缀过滤
 * @param {boolean} [options.stripRoot=true] - 是否去除根目录
 * @returns {Promise<File[]>} 提取的文件列表
 */
export async function extractFilesFromZip(zipFile, options = {}) {
  const { pathPrefix = '', stripRoot = true } = options;

  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip library not loaded');
  }

  const zip = await JSZip.loadAsync(zipFile);
  const entries = [];
  const zipFiles = Object.keys(zip.files).sort();

  for (const key of zipFiles) {
    const entry = zip.files[key];
    if (!entry || entry.dir) continue;

    const normalizedPath = key.replace(/\\/g, '/');

    // 路径前缀过滤
    if (pathPrefix && !normalizedPath.startsWith(pathPrefix)) {
      continue;
    }

    const ext = deriveExtension(normalizedPath);
    if (!isSupportedFileExtension(ext)) continue;

    const blob = await entry.async('blob');
    const segments = normalizedPath.split('/');
    let displayName = segments.pop();
    let relativePath = normalizedPath;

    if (pathPrefix) {
      relativePath = normalizedPath.substring(pathPrefix.length);
      if (relativePath.startsWith('/')) {
        relativePath = relativePath.slice(1);
      }
    } else if (stripRoot && segments.length > 0) {
      segments.shift();
      relativePath = segments.length > 0 ? segments.join('/') + '/' + displayName : displayName;
    }

    const newFile = new File([blob], displayName || normalizedPath, {
      type: blob.type || 'application/octet-stream',
      lastModified: zipFile.lastModified || Date.now()
    });

    annotateFileMetadata(newFile, relativePath || displayName);

    try {
      newFile.virtualSource = 'zip';
      newFile.sourceArchive = zipFile.name;
    } catch {
      // 只读属性，忽略
    }

    entries.push(newFile);
  }

  return entries;
}

/**
 * 从 DataTransfer 中提取文件（支持目录拖放）
 * @param {DataTransfer} dataTransfer - DataTransfer 对象
 * @returns {Promise<File[]>} 提取的文件列表
 */
export async function extractFilesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) return [];

  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  const fallback = dataTransfer.files ? Array.from(dataTransfer.files) : [];

  const firstItem = items[0];
  const hasEntryApi = firstItem?.webkitGetAsEntry;

  if (hasEntryApi) {
    const promises = items
      .map(item => item.webkitGetAsEntry?.())
      .filter(Boolean)
      .map(entry => traverseFileSystemEntry(entry));

    if (promises.length > 0) {
      const results = await Promise.all(promises);
      const flattened = results.flat().filter(Boolean);
      if (flattened.length > 0) return flattened;
    }
  }

  // 回退到普通文件列表
  fallback.forEach(file => annotateFileMetadata(file));
  return fallback;
}

/**
 * 递归遍历文件系统条目
 * @param {FileSystemEntry} entry - 文件系统条目
 * @param {string} [path=''] - 当前路径
 * @returns {Promise<File[]>}
 */
async function traverseFileSystemEntry(entry, path = '') {
  if (entry.isFile) {
    return new Promise(resolve => {
      entry.file(file => {
        annotateFileMetadata(file, path + file.name);
        resolve([file]);
      }, () => resolve([]));
    });
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = await new Promise(resolve => {
      reader.readEntries(resolve, () => resolve([]));
    });

    const promises = entries.map(e =>
      traverseFileSystemEntry(e, path + entry.name + '/')
    );
    const results = await Promise.all(promises);
    return results.flat();
  }

  return [];
}

/**
 * 检查文件是否来自 ZIP
 * @param {File} file - 文件对象
 * @returns {boolean}
 */
export function isFromZip(file) {
  return file?.virtualSource === 'zip';
}

/**
 * 获取文件的源 ZIP 名称
 * @param {File} file - 文件对象
 * @returns {string|null}
 */
export function getSourceArchive(file) {
  return file?.sourceArchive || null;
}

// 默认导出
export default {
  extractFilesFromZip,
  extractFilesFromDataTransfer,
  isFromZip,
  getSourceArchive
};
