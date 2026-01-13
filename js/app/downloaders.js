// downloaders.js - PDF 下载功能

/**
 * 从 URL 下载 PDF（支持 arXiv 链接识别和 failback 机制）
 * @param {string} url - PDF URL 或 arXiv 链接
 * @returns {Promise<File>} - 下载的文件对象
 */
export async function downloadPdfFromUrl(url) {
    const parsedUrl = parseArxivUrl(url);
    const pdfUrl = parsedUrl.pdfUrl || url;
    const filename = parsedUrl.filename || extractFilenameFromUrl(url);

    console.log(`[URL Import] Downloading: ${pdfUrl}`);

    try {
        const file = await downloadPdfDirect(pdfUrl, filename);
        console.log(`[URL Import] Direct download successful: ${filename}`);
        return file;
    } catch (directError) {
        console.warn(`[URL Import] Direct download failed, trying proxy:`, directError.message);

        try {
            const file = await downloadPdfViaProxy(pdfUrl, filename);
            console.log(`[URL Import] Proxy download successful: ${filename}`);
            return file;
        } catch (proxyError) {
            console.error(`[URL Import] Both direct and proxy download failed:`, proxyError.message);
            throw new Error(`下载失败: ${proxyError.message}`);
        }
    }
}

/**
 * 解析 arXiv URL，提取 arXiv ID 并转换为 PDF 下载链接
 * @param {string} url - 输入的 URL
 * @returns {Object} - { pdfUrl, filename, arxivId }
 */
export function parseArxivUrl(url) {
    const arxivAbsPattern = /arxiv\.org\/abs\/([0-9.]+)/i;
    const arxivPdfPattern = /arxiv\.org\/pdf\/([0-9.]+)/i;

    let match = url.match(arxivAbsPattern) || url.match(arxivPdfPattern);
    if (match) {
        const arxivId = match[1];
        return {
            pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
            filename: `arxiv_${arxivId}.pdf`,
            arxivId: arxivId
        };
    }

    return { pdfUrl: null, filename: null, arxivId: null };
}

/**
 * 从 URL 提取文件名
 * @param {string} url - URL
 * @returns {string} - 文件名
 */
export function extractFilenameFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const parts = pathname.split('/').filter(Boolean);
        const lastPart = parts[parts.length - 1];

        if (lastPart && lastPart.endsWith('.pdf')) {
            return lastPart;
        } else if (lastPart) {
            return `${lastPart}.pdf`;
        }

        return `downloaded_${Date.now()}.pdf`;
    } catch (e) {
        return `downloaded_${Date.now()}.pdf`;
    }
}

/**
 * 直接下载 PDF（不通过代理）
 * @param {string} url - PDF URL
 * @param {string} filename - 文件名
 * @returns {Promise<File>} - 文件对象
 */
export async function downloadPdfDirect(url, filename) {
    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/pdf'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get('Content-Type');
    if (!contentType || !contentType.includes('pdf')) {
        throw new Error(`不是 PDF 文件 (Content-Type: ${contentType})`);
    }

    const blob = await response.blob();
    return new File([blob], filename, { type: 'application/pdf' });
}

/**
 * 通过 academic-search-proxy 代理下载 PDF
 * @param {string} url - PDF URL
 * @param {string} filename - 文件名
 * @returns {Promise<File>} - 文件对象
 */
export async function downloadPdfViaProxy(url, filename) {
    const proxyConfig = getAcademicSearchProxyConfig();
    if (!proxyConfig.baseUrl) {
        throw new Error('未配置 Academic Search Proxy');
    }

    const proxyUrl = `${proxyConfig.baseUrl}/api/pdf/download?url=${encodeURIComponent(url)}`;

    const headers = {
        'Accept': 'application/pdf'
    };

    if (proxyConfig.authKey) {
        headers['X-Auth-Key'] = proxyConfig.authKey;
    }

    console.log(`[URL Import] Using proxy: ${proxyUrl}`);

    const response = await fetch(proxyUrl, {
        method: 'GET',
        headers: headers
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`代理下载失败 (HTTP ${response.status}): ${errorText}`);
    }

    const contentType = response.headers.get('Content-Type');
    console.log(`[URL Import] Proxy response Content-Type: ${contentType}`);

    if (contentType && (contentType.includes('json') || contentType.includes('xml'))) {
        const text = await response.text();
        console.error(`[URL Import] Proxy returned non-PDF content:`, text.substring(0, 500));
        throw new Error(`代理返回的不是 PDF 文件 (Content-Type: ${contentType})`);
    }

    const blob = await response.blob();

    if (blob.size < 100) {
        throw new Error(`下载的文件过小 (${blob.size} bytes)，可能不是有效的 PDF`);
    }

    console.log(`[URL Import] Downloaded PDF blob: ${blob.size} bytes`);
    return new File([blob], filename, { type: 'application/pdf' });
}

/**
 * 获取 Academic Search Proxy 配置
 * @returns {Object} - { baseUrl, authKey }
 */
export function getAcademicSearchProxyConfig() {
    const storedConfig = localStorage.getItem('academicSearchProxyConfig');
    if (storedConfig) {
        try {
            const config = JSON.parse(storedConfig);
            return {
                baseUrl: config.baseUrl || '',
                authKey: config.authKey || ''
            };
        } catch (e) {
            console.error('[URL Import] Failed to parse proxy config:', e);
        }
    }

    return { baseUrl: '', authKey: '' };
}
