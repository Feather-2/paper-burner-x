// process/download.js

/**
 * 下载所有处理结果
 * @param {Array<Object>} allResultsData - 所有处理结果的数据
 * @returns {Promise<void>}
 */
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
        const pdfName = result.file.name.replace(/\.pdf$/i, '');
        const safeFolderName = pdfName.replace(/[/\\:*?"<>|]/g, '_').substring(0, 100);
        const folder = zip.folder(safeFolderName);

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
                        console.warn(`Skipping image ${img.id} in ${safeFolderName} due to missing data.`);
                        if (typeof addProgressLog === "function") {
                            addProgressLog(`警告: 跳过图片 ${img.id} (文件: ${safeFolderName})，数据缺失。`);
                        }
                    }
                } catch (imgError) {
                    console.error(`Error adding image ${img.id} to zip for ${safeFolderName}:`, imgError);
                    if (typeof addProgressLog === "function") {
                        addProgressLog(`警告: 打包图片 ${img.id} (文件: ${safeFolderName}) 时出错: ${imgError.message}`);
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