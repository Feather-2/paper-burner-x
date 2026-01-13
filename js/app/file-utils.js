// file-utils.js - 文件处理工具函数

import { SUPPORTED_FILE_EXTENSIONS, SUPPORTED_ARCHIVE_EXTENSIONS, excludedExtensions } from './state.js';

/**
 * 转义 HTML 特殊字符，防止 XSS 攻击
 * @param {string} str - 需要转义的字符串
 * @returns {string} 转义后的安全字符串
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c];
  });
}

/**
 * 从文件名派生扩展名
 * @param {string} name - 文件名
 * @returns {string} 小写扩展名
 */
export function deriveExtension(name) {
    if (!name || typeof name !== 'string') return '';
    const cleaned = name.split('?')[0].split('#')[0];
    const parts = cleaned.split('.');
    if (parts.length <= 1) return '';
    return parts.pop().trim().toLowerCase();
}

/**
 * 检查扩展名是否被排除
 * @param {string} ext - 扩展名
 * @returns {boolean}
 */
export function isExtensionExcluded(ext) {
    return excludedExtensions.has((ext || '').toLowerCase());
}

/**
 * 检查扩展名是否支持
 * @param {string} ext - 扩展名
 * @returns {boolean}
 */
export function isSupportedFileExtension(ext) {
    return SUPPORTED_FILE_EXTENSIONS.includes((ext || '').toLowerCase());
}

/**
 * 获取文件相对路径
 * @param {File} file - 文件对象
 * @returns {string}
 */
export function getFileRelativePath(file) {
    if (!file) return '';
    return file.pbxRelativePath || file.webkitRelativePath || file.relativePath || file.fullPath || file.name || '';
}

/**
 * 获取文件显示名称
 * @param {File} file - 文件对象
 * @returns {string}
 */
export function getFileDisplayName(file) {
    const rel = getFileRelativePath(file);
    if (!rel) return file && file.name ? file.name : '';
    const normalized = rel.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || rel;
}

/**
 * 为文件对象添加元数据
 * @param {File} file - 文件对象
 * @param {string} [providedPath] - 可选的路径
 */
export function annotateFileMetadata(file, providedPath) {
    if (!file) return;
    const relativePath = providedPath || file.webkitRelativePath || file.relativePath || file.fullPath || file.name || '';
    try {
        file.pbxRelativePath = relativePath;
        file.originalName = file.originalName || file.name;
    } catch (e) {
        // ignore readonly property assignment errors
    }
}

/**
 * 构建文件标识符
 * @param {File} file - 文件对象
 * @returns {string}
 */
export function buildFileIdentifier(file) {
    const rel = getFileRelativePath(file).toLowerCase();
    return `${rel}__${file && typeof file.size === 'number' ? file.size : '0'}`;
}

/**
 * 从 ZIP 提取文件
 * @param {File} zipFile - ZIP 文件
 * @param {Object} [options] - 选项
 * @returns {Promise<File[]>}
 */
export async function extractFilesFromZip(zipFile, options = {}) {
    if (typeof JSZip === 'undefined') {
        showNotification && showNotification('缺少 JSZip 依赖，无法解压 ZIP', 'error');
        return [];
    }
    try {
        const zip = await JSZip.loadAsync(zipFile);
        const entries = [];
        const zipFiles = Object.keys(zip.files);
        const pathPrefix = options.pathPrefix ? options.pathPrefix.replace(/\\/g, '/') : '';
        const stripRoot = options.stripRoot || false;

        for (const key of zipFiles) {
            const entry = zip.files[key];
            if (!entry || entry.dir) continue;
            const normalizedPath = key.replace(/\\/g, '/');

            if (pathPrefix) {
                if (!normalizedPath.startsWith(pathPrefix)) continue;
            }

            const ext = deriveExtension(normalizedPath);
            if (!isSupportedFileExtension(ext)) continue;

            const blob = await entry.async('blob');
            const baseNameParts = normalizedPath.split('/');
            let displayName = baseNameParts.pop();
            let relativePath = normalizedPath;

            if (pathPrefix) {
                relativePath = normalizedPath.substring(pathPrefix.length);
                if (relativePath.startsWith('/')) {
                    relativePath = relativePath.slice(1);
                }
            } else if (stripRoot && baseNameParts.length > 0) {
                const segments = normalizedPath.split('/');
                segments.shift();
                relativePath = segments.join('/');
                displayName = segments.pop() || displayName;
            }

            if (!relativePath) {
                relativePath = displayName;
            }

            const derivedName = displayName || normalizedPath;
            const newFile = new File([blob], derivedName, {
                type: blob.type || 'application/octet-stream',
                lastModified: zipFile.lastModified || Date.now()
            });
            annotateFileMetadata(newFile, relativePath);
            try {
                newFile.virtualSource = 'zip';
                newFile.sourceArchive = zipFile.name;
            } catch (_) {}
            entries.push(newFile);
        }

        return entries;
    } catch (error) {
        console.error('解压 ZIP 文件失败:', error);
        showNotification && showNotification(`解压 "${zipFile && zipFile.name ? zipFile.name : 'ZIP'}" 失败: ${error.message || error}`, 'error');
        return [];
    }
}

/**
 * 从 DataTransfer 提取文件
 * @param {DataTransfer} dataTransfer - DataTransfer 对象
 * @returns {Promise<File[]>}
 */
export async function extractFilesFromDataTransfer(dataTransfer) {
    if (!dataTransfer) return [];
    const itemsSnapshot = dataTransfer.items ? Array.from(dataTransfer.items) : [];
    const fallbackSnapshot = dataTransfer.files ? Array.from(dataTransfer.files) : [];
    const firstItem = itemsSnapshot.length > 0 ? itemsSnapshot[0] : null;
    const hasEntryApi = firstItem && typeof firstItem.webkitGetAsEntry === 'function';

    if (hasEntryApi) {
        const entryPromises = [];
        for (let i = 0; i < itemsSnapshot.length; i++) {
            const item = itemsSnapshot[i];
            if (!item || typeof item.webkitGetAsEntry !== 'function') continue;
            const entry = item.webkitGetAsEntry();
            if (!entry) continue;
            entryPromises.push(traverseFileSystemEntry(entry));
        }

        if (entryPromises.length > 0) {
            const results = await Promise.all(entryPromises);
            const flattened = results.flat().filter(Boolean);
            if (flattened.length > 0) {
                return flattened;
            }
            console.warn('extractFilesFromDataTransfer: FileSystemEntry API returned no files, using fallback.');
        }
    }

    fallbackSnapshot.forEach(file => annotateFileMetadata(file));
    return fallbackSnapshot;
}

/**
 * 遍历文件系统入口
 * @param {FileSystemEntry} entry - 文件系统入口
 * @param {string} [path] - 路径
 * @returns {Promise<File[]>}
 */
export function traverseFileSystemEntry(entry, path = '') {
    return new Promise((resolve) => {
        if (!entry) {
            resolve([]);
            return;
        }

        if (entry.isFile) {
            entry.file(file => {
                const relativePath = path ? `${path}/${file.name}` : file.name;
                annotateFileMetadata(file, relativePath);
                resolve([file]);
            }, () => resolve([]));
        } else if (entry.isDirectory) {
            const directoryReader = entry.createReader();
            const accumulated = [];

            const readEntries = () => {
                directoryReader.readEntries(async batch => {
                    if (!batch.length) {
                        const nestedResults = [];
                        for (const child of accumulated) {
                            const childPath = path ? `${path}/${child.name}` : child.name;
                            const childFiles = await traverseFileSystemEntry(child, childPath);
                            nestedResults.push(...childFiles);
                        }
                        resolve(nestedResults);
                    } else {
                        accumulated.push(...batch);
                        readEntries();
                    }
                }, () => resolve([]));
            };

            readEntries();
        } else {
            resolve([]);
        }
    });
}
