/**
 * @file js/core/file/file-utils.js
 * @description 文件处理工具函数
 */

/**
 * 支持的文件扩展名列表
 */
export const SUPPORTED_EXTENSIONS = [
  'pdf', 'md', 'txt', 'docx', 'pptx', 'html', 'htm',
  'epub', 'yaml', 'yml', 'json', 'csv', 'ini', 'cfg', 'log', 'tex'
];

/**
 * 支持的压缩包扩展名列表
 */
export const SUPPORTED_ARCHIVES = ['zip'];

/**
 * 从文件名提取扩展名
 * @param {string} filename - 文件名
 * @returns {string} 小写扩展名
 */
export function deriveExtension(filename) {
  if (!filename || typeof filename !== 'string') return '';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

/**
 * 检查是否为支持的文件扩展名
 * @param {string} ext - 扩展名
 * @returns {boolean}
 */
export function isSupportedFileExtension(ext) {
  if (!ext) return false;
  return SUPPORTED_EXTENSIONS.includes(ext.toLowerCase());
}

/**
 * 检查是否为支持的压缩包扩展名
 * @param {string} ext - 扩展名
 * @returns {boolean}
 */
export function isSupportedArchive(ext) {
  if (!ext) return false;
  return SUPPORTED_ARCHIVES.includes(ext.toLowerCase());
}

/**
 * 生成文件唯一标识符
 * @param {File} file - 文件对象
 * @returns {string} 文件标识符
 */
export function getFileIdentifier(file) {
  if (!file) return '';
  return `${file.name}_${file.size}_${file.lastModified}`;
}

/**
 * 为文件添加元数据
 * @param {File} file - 文件对象
 * @param {string} [relativePath] - 相对路径
 */
export function annotateFileMetadata(file, relativePath) {
  if (!file) return;
  try {
    file.relativePath = relativePath || file.name;
  } catch {
    // File 对象可能是只读的，忽略错误
  }
}

/**
 * 检查文件是否应该被处理
 * @param {File} file - 文件对象
 * @param {Set<string>} [excludedExtensions] - 被排除的扩展名集合
 * @returns {boolean}
 */
export function shouldProcessFile(file, excludedExtensions = new Set()) {
  if (!file) return false;
  const ext = deriveExtension(file.name);
  if (excludedExtensions.has(ext)) return false;
  return isSupportedFileExtension(ext) || isSupportedArchive(ext);
}

/**
 * 获取文件的显示名称
 * @param {File} file - 文件对象
 * @returns {string}
 */
export function getDisplayName(file) {
  if (!file) return '';
  return file.relativePath || file.name;
}

// 默认导出
export default {
  SUPPORTED_EXTENSIONS,
  SUPPORTED_ARCHIVES,
  deriveExtension,
  isSupportedFileExtension,
  isSupportedArchive,
  getFileIdentifier,
  annotateFileMetadata,
  shouldProcessFile,
  getDisplayName
};
