// importers.js - GitHub 和 URL 导入功能

import { deriveExtension, isSupportedFileExtension, annotateFileMetadata } from './file-utils.js';
import { downloadPdfFromUrl } from './downloaders.js';

/**
 * 处理 GitHub 导入
 */
export async function handleGithubImport() {
    const rawUrl = prompt('请输入 GitHub 仓库或目录链接 (例如 https://github.com/user/repo 或 https://github.com/user/repo/tree/branch/path):');
    if (!rawUrl) return;

    const parsed = parseGithubUrl(rawUrl.trim());
    if (!parsed) {
        showNotification && showNotification('无法解析 GitHub 链接，请检查格式。', 'error');
        return;
    }

    const { owner, repo, ref, pathPrefix } = parsed;

    try {
        showNotification && showNotification('正在从 GitHub 获取文件列表，请稍候...', 'info');
        const treeEntries = await fetchGithubTree(owner, repo, ref, pathPrefix);
        if (!treeEntries.length) {
            showNotification && showNotification('在指定路径中未找到可处理的文件。', 'warning');
            return;
        }

        const files = await downloadGithubFiles(owner, repo, ref, treeEntries, pathPrefix);
        if (!files.length) {
            showNotification && showNotification('获取 GitHub 文件失败或没有可处理的文件。', 'warning');
            return;
        }

        if (typeof addFilesToList === 'function') {
            await addFilesToList(files);
        }
        showNotification && showNotification(`已从 ${owner}/${repo} 导入 ${files.length} 个文件`, 'success');
    } catch (error) {
        console.error('GitHub 导入失败:', error);
        showNotification && showNotification(`GitHub 导入失败：${error.message || error}`, 'error');
    }
}

/**
 * 处理 URL 导入（支持 arXiv 和任意 PDF 链接）
 */
export async function handleUrlImport() {
    const rawUrls = prompt('请输入 PDF URL（支持 arXiv 链接），多个链接请用换行分隔:\n\n例如:\nhttps://arxiv.org/abs/2301.12345\nhttps://example.com/paper.pdf');
    if (!rawUrls) return;

    const urls = rawUrls.trim().split('\n').map(u => u.trim()).filter(Boolean);
    if (urls.length === 0) return;

    try {
        showNotification && showNotification(`正在下载 ${urls.length} 个 PDF 文件...`, 'info');
        const downloadResults = await Promise.allSettled(
            urls.map(url => downloadPdfFromUrl(url))
        );

        const successFiles = [];
        const failedUrls = [];

        downloadResults.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value) {
                successFiles.push(result.value);
            } else {
                failedUrls.push({ url: urls[index], error: result.reason?.message || '未知错误' });
            }
        });

        if (successFiles.length > 0 && typeof addFilesToList === 'function') {
            await addFilesToList(successFiles);
        }

        if (failedUrls.length > 0) {
            console.error('部分 URL 下载失败:', failedUrls);
            const failedList = failedUrls.map(f => `${f.url}: ${f.error}`).join('\n');
            showNotification && showNotification(
                `成功导入 ${successFiles.length} 个文件，失败 ${failedUrls.length} 个\n\n失败列表:\n${failedList}`,
                successFiles.length > 0 ? 'warning' : 'error'
            );
        } else {
            showNotification && showNotification(`成功从 URL 导入 ${successFiles.length} 个文件`, 'success');
        }
    } catch (error) {
        console.error('URL 导入失败:', error);
        showNotification && showNotification(`URL 导入失败：${error.message || error}`, 'error');
    }
}

/**
 * 解析 GitHub URL
 * @param {string} rawUrl - GitHub URL
 * @returns {Object|null} - { owner, repo, ref, pathPrefix }
 */
export function parseGithubUrl(rawUrl) {
    try {
        const url = new URL(rawUrl);
        if (!/github\.com$/i.test(url.hostname)) {
            return null;
        }
        const segments = url.pathname.split('/').filter(Boolean);
        if (segments.length < 2) {
            return null;
        }
        const owner = decodeURIComponent(segments[0]);
        const repo = decodeURIComponent(segments[1].replace(/\.git$/i, ''));
        let ref = 'main';
        let pathPrefix = '';

        if (segments[2] === 'tree' || segments[2] === 'blob') {
            if (segments.length >= 4) {
                ref = decodeURIComponent(segments[3]);
                if (segments.length > 4) {
                    pathPrefix = segments.slice(4).map(decodeURIComponent).join('/');
                }
            }
        }

        return { owner, repo, ref, pathPrefix };
    } catch (error) {
        console.warn('parseGithubUrl error:', error);
        return null;
    }
}

/**
 * 获取 GitHub 仓库树
 * @param {string} owner - 仓库所有者
 * @param {string} repo - 仓库名
 * @param {string} ref - 分支/标签
 * @param {string} pathPrefix - 路径前缀
 * @returns {Promise<Array>}
 */
export async function fetchGithubTree(owner, repo, ref, pathPrefix) {
    const encodedRef = encodeURIComponent(ref);
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodedRef}?recursive=1`;
    const response = await fetch(treeUrl, { headers: { 'Accept': 'application/vnd.github+json' } });
    if (response.status === 404) {
        throw new Error('未找到仓库或分支，请检查链接');
    }
    if (response.status === 403) {
        throw new Error('GitHub API 速率限制，请稍后再试');
    }
    if (!response.ok) {
        throw new Error(`GitHub API 返回错误状态 ${response.status}`);
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.tree)) {
        throw new Error('GitHub API 返回数据不完整');
    }

    const prefix = pathPrefix ? pathPrefix.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '') : '';
    const matched = data.tree.filter(item => {
        if (!item || item.type !== 'blob') return false;
        if (!prefix) return true;
        if (!item.path) return false;
        return item.path === prefix || item.path.startsWith(prefix + '/');
    });

    return matched;
}

/**
 * 下载 GitHub 文件
 * @param {string} owner - 仓库所有者
 * @param {string} repo - 仓库名
 * @param {string} ref - 分支/标签
 * @param {Array} treeEntries - 文件入口列表
 * @param {string} pathPrefix - 路径前缀
 * @returns {Promise<File[]>}
 */
export async function downloadGithubFiles(owner, repo, ref, treeEntries, pathPrefix) {
    const files = [];
    const prefix = pathPrefix ? pathPrefix.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '') : '';
    const repoIdentifier = `${owner}/${repo}@${ref}`;

    const queue = treeEntries.slice();
    const concurrency = 4;
    const workers = new Array(concurrency).fill(null).map(async () => {
        while (queue.length > 0) {
            const entry = queue.shift();
            if (!entry || !entry.path) continue;
            let relativePath = entry.path;
            if (prefix) {
                if (!entry.path.startsWith(prefix + '/')) {
                    continue;
                }
                relativePath = entry.path.slice(prefix.length + 1);
            }
            if (!relativePath || relativePath.endsWith('/')) continue;
            const ext = deriveExtension(relativePath);
            if (!isSupportedFileExtension(ext)) continue;

            const rawPathParts = entry.path.split('/').map(encodeURIComponent).join('/');
            const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rawPathParts}`;
            try {
                const fileResponse = await fetch(rawUrl);
                if (!fileResponse.ok) {
                    console.warn(`无法获取 ${rawUrl}: ${fileResponse.status}`);
                    continue;
                }
                const blob = await fileResponse.blob();
                const displayName = relativePath.split('/').pop();
                const file = new File([blob], displayName || 'document', {
                    type: blob.type || 'application/octet-stream',
                    lastModified: Date.now()
                });
                const pathSegments = [repo];
                if (prefix) pathSegments.push(prefix);
                pathSegments.push(relativePath);
                const annotatedPath = pathSegments
                    .filter(Boolean)
                    .join('/')
                    .replace(/\/+/g, '/');
                annotateFileMetadata(file, annotatedPath);
                try {
                    file.virtualSource = 'github';
                    file.sourceArchive = repoIdentifier;
                } catch (_) {}
                files.push(file);
            } catch (error) {
                console.warn('下载 GitHub 文件失败:', error);
            }
        }
    });

    await Promise.all(workers);
    return files;
}
