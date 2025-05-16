// process/ocr.js

/**
 * 处理 OCR 返回的结构，生成 markdown 文本和图片数据数组
 * @param {Object} ocrResponse - OCR API 返回的 JSON
 * @returns {Object} { markdown, images }
 */
function processOcrResults(ocrResponse) {
    let markdownContent = '';
    let imagesData = [];

    try {
        for (const page of ocrResponse.pages) {
            const pageImages = {};

            if (page.images && Array.isArray(page.images)) {
                for (const img of page.images) {
                    if (img.id && img.image_base64) {
                        const imgId = img.id;
                        const imgData = img.image_base64;
                        imagesData.push({ id: imgId, data: imgData });
                        // 记录图片 ID 到 markdown 路径的映射
                        pageImages[imgId] = `images/${imgId}.png`;
                    }
                }
            }

            let pageMarkdown = page.markdown || '';

            // 修正正则表达式转义，所有 \\ 都要写成 \\\\，否则括号不匹配
            for (const [imgName, imgPath] of Object.entries(pageImages)) {
                // 使用全局函数 escapeRegex
                const escapedImgName = typeof escapeRegex === 'function' ?
                                        escapeRegex(imgName) :
                                        imgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

                const imgRegex = new RegExp(`!\\[([^\\]]*?)\\]\\(${escapedImgName}\\)`, 'g');
                pageMarkdown = pageMarkdown.replace(imgRegex, (match, altText) => {
                    const finalAltText = altText || imgName;
                    return `![${finalAltText}](${imgPath})`;
                });
            }

            markdownContent += pageMarkdown + '\n\n';
        }

        return { markdown: markdownContent.trim(), images: imagesData };
    } catch (error) {
        console.error('处理OCR结果时出错:', error);
        if (typeof addProgressLog === "function") {
            addProgressLog(`错误：处理 OCR 结果失败 - ${error.message}`);
        }
        return { markdown: `[错误：处理OCR结果时发生错误 - ${error.message}]`, images: [] };
    }
}

// 将函数添加到processModule对象
if (typeof processModule !== 'undefined') {
    processModule.processOcrResults = processOcrResults;
}