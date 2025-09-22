// process/download.js

/**
 * 将所有成功处理的文档结果打包成一个 ZIP 文件并触发下载。
 *
 * 主要流程：
 * 1. **筛选结果**：从 `allResultsData` 中筛选出没有错误、包含 Markdown 内容且未被跳过的成功处理结果。
 * 2. **空结果检查**：如果没有成功的处理结果，则显示通知并退出。
 * 3. **JSZip 依赖检查**：如果 `JSZip` 库未加载，则显示错误通知并退出。
 * 4. **创建 ZIP 实例**：初始化一个新的 `JSZip` 对象。
 * 5. **遍历并添加文件到 ZIP**：
 *    - 对每个成功的处理结果：
 *      - 根据原始 PDF 文件名创建一个安全的文件夹名 (`safeFolderName`)。
 *      - 在 ZIP 内创建此文件夹。
 *      - 将处理得到的 Markdown 内容保存为 `document.md`。
 *      - 如果存在翻译内容 (`result.translation`)：
 *        - 构建包含免责声明的翻译内容 (`contentToDownload`)。
 *        - 将其保存为 `translation.md`。
 *      - 如果存在图片数据 (`result.images`)：
 *        - 在当前文件夹内创建一个 `images` 子文件夹。
 *        - 遍历图片数据，将每张图片（Base64 编码）保存为 PNG 文件到 `images` 文件夹中。
 *        - 对图片数据进行有效性检查，跳过无效数据并记录日志。
 *        - 捕获并记录添加图片到 ZIP 时的潜在错误。
 * 6. **最终文件数检查**：如果最终没有文件被添加到 ZIP 包 (例如，所有结果都只有文件夹)，则显示警告并退出。
 * 7. **生成并下载 ZIP**：
 *    - 使用 `zip.generateAsync` 以 DEFLATE 压缩方式生成 ZIP 文件的 Blob 数据。
 *    - 生成带时间戳的文件名 (如 `PaperBurner_Results_YYYY-MM-DDTHH-MM-SS-mmmZ.zip`)。
 *    - 使用 `saveAs` 函数 (FileSaver.js 提供) 触发浏览器下载该 Blob。
 *    - 如果 `saveAs` 未定义，则记录错误。
 * 8. **错误处理**：捕获在创建或下载 ZIP 文件过程中可能发生的任何错误，并显示通知。
 * 9. **日志记录**：在关键步骤通过 `addProgressLog` (如果可用) 输出日志。
 *
 * @param {Array<Object>} allResultsData - 包含所有文件处理结果的对象数组。
 *                                       每个对象应包含 `file`, `error`, `markdown`, `translation`, `images`, `skipped` 等属性。
 * @returns {Promise<void>} 函数没有显式返回值，主要副作用是触发文件下载。
 */
function sanitizeFileName(name) {
    return (name || 'document').replace(/[\\/:*?"<>|]/g, '_');
}

function sanitizePath(path) {
    return (path || '').split('/').map(segment => sanitizeFileName(segment)).filter(Boolean).join('/');
}

function removeExtension(name) {
    if (!name) return '';
    const idx = name.lastIndexOf('.');
    return idx === -1 ? name : name.slice(0, idx);
}

function ensureFileName(baseName, ext) {
    const sanitized = sanitizeFileName(baseName || 'document');
    if (!ext) return sanitized;
    if (sanitized.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
        return sanitized;
    }
    return `${sanitized}.${ext}`;
}

async function downloadAllResults(allResultsData) {
    const successfulResults = allResultsData.filter(result => result && !result.error && result.markdown && !result.skipped);

    if (successfulResults.length === 0) {
        if (typeof showNotification === "function") {
            showNotification('没有成功的处理结果可供下载', 'warning');
        }
        return;
    }

    if (typeof addProgressLog === "function") {
        addProgressLog('开始打包下载结果...');
    }

    if (typeof JSZip === 'undefined') {
        if (typeof showNotification === "function") {
            showNotification('JSZip 加载失败，无法打包下载', 'error');
        }
        return;
    }

    const zip = new JSZip();
    let filesAdded = 0;

    for (const result of successfulResults) {
        const relativePath = (result.relativePath || (result.file && result.file.pbxRelativePath) || (result.file && result.file.name) || 'document').replace(/\\/g, '/');
        const dirPath = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
        const baseName = relativePath.includes('/') ? relativePath.slice(relativePath.lastIndexOf('/') + 1) : relativePath;
        const baseWithoutExt = removeExtension(baseName);
        const sanitizedDir = sanitizePath(dirPath);
        const sanitizedBase = sanitizeFileName(baseWithoutExt || 'document').substring(0, 120) || 'document';
        const folderPath = sanitizedDir ? `${sanitizedDir}/${sanitizedBase}` : sanitizedBase;
        const folder = zip.folder(folderPath);

        folder.file('document.md', result.markdown);

        if (result.translation) {
            const currentDate = new Date().toISOString().split('T')[0];
            const headerDeclaration = `> *本文档由 Paper Burner 工具制作 (${currentDate})。内容由 AI 大模型翻译生成，不保证翻译内容的准确性和完整性。*\n\n`;
            const footerDeclaration = `\n\n---\n> *免责声明：本文档内容由大模型API自动翻译生成，Paper Burner 工具不对翻译内容的准确性、完整性和合法性负责。*`;
            const contentToDownload = headerDeclaration + result.translation + footerDeclaration;
            folder.file('translation.md', contentToDownload);
        }

        if (result.images && result.images.length > 0) {
            const imagesFolder = folder.folder('images');
            for (const img of result.images) {
                try {
                    const base64Data = img.data.includes(',') ? img.data.split(',')[1] : img.data;
                    if (base64Data) {
                        imagesFolder.file(`${img.id}.png`, base64Data, { base64: true });
                    } else {
                        console.warn(`Skipping image ${img.id} in ${folderPath} due to missing data.`);
                        if (typeof addProgressLog === "function") {
                            addProgressLog(`警告: 跳过图片 ${img.id} (文件: ${folderPath})，数据缺失。`);
                        }
                    }
                } catch (imgError) {
                    console.error(`Error adding image ${img.id} to zip for ${folderPath}:`, imgError);
                    if (typeof addProgressLog === "function") {
                        addProgressLog(`警告: 打包图片 ${img.id} (文件: ${folderPath}) 时出错: ${imgError.message}`);
                    }
                }
            }
        }
        filesAdded++;
    }

    if (filesAdded === 0) {
        if (typeof showNotification === "function") {
            showNotification('没有成功处理的文件可以打包下载', 'warning');
        }
        if (typeof addProgressLog === "function") {
            addProgressLog('没有可打包的文件。');
        }
        return;
    }

    try {
        if (typeof addProgressLog === "function") {
            addProgressLog(`正在生成包含 ${filesAdded} 个文件结果的 ZIP 包...`);
        }
        const zipBlob = await zip.generateAsync({
            type: 'blob',
            compression: "DEFLATE",
            compressionOptions: { level: 6 }
        });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        if (typeof saveAs === "function") {
            saveAs(zipBlob, `PaperBurner_Results_${timestamp}.zip`);
            if (typeof addProgressLog === "function") {
                addProgressLog('ZIP 文件生成完毕，开始下载。');
            }
        } else {
            console.error('saveAs 函数未定义，无法下载文件');
            if (typeof addProgressLog === "function") {
                addProgressLog('错误: saveAs 函数未定义，无法下载文件');
            }
        }
    } catch (error) {
        console.error('创建或下载 ZIP 文件失败:', error);
        if (typeof showNotification === "function") {
            showNotification('创建 ZIP 文件失败: ' + error.message, 'error');
        }
        if (typeof addProgressLog === "function") {
            addProgressLog('错误: 创建 ZIP 文件失败 - ' + error.message);
        }
    }
}

// 将函数添加到processModule对象
if (typeof processModule !== 'undefined') {
    processModule.downloadAllResults = downloadAllResults;
}
