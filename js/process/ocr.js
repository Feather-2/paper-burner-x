// process/ocr.js

/**
 * 处理 OCR (光学字符识别) API 返回的 JSON 响应，从中提取 Markdown 文本和图片数据。
 *
 * 主要逻辑：
 * 1. **遍历页面**：迭代 `ocrResponse.pages` 数组中的每个页面对象。
 * 2. **提取图片**：
 *    - 如果 `page.images` 存在且为数组，则遍历其中的每个图片对象。
 *    - 对于每个图片，如果包含 `id` 和 `image_base64` 数据，则将其作为一个对象 `{ id, data }` 添加到 `imagesData` 数组中。
 *    - 同时，为当前页面创建一个 `pageImages` 映射，键为图片 ID，值为 Markdown 中引用的相对路径 (如 `images/IMAGE_ID.png`)。
 * 3. **处理页面 Markdown**：
 *    - 获取 `page.markdown` 内容。
 *    - **图片路径替换**：遍历 `pageImages` 映射，使用正则表达式将 Markdown 中对原始图片 ID 的引用 (如 `![alt](IMAGE_ID)`)
 *      替换为新的相对路径 (如 `![alt](images/IMAGE_ID.png)`)。这里会使用全局的 `escapeRegex` 函数（如果可用）来确保图片 ID 中的特殊字符被正确转义，
 *      避免正则表达式执行错误。如果 `altText` 为空，则使用图片ID作为默认的 alt 文本。
 * 4. **合并 Markdown**：将处理后的每个页面的 Markdown 内容追加到 `markdownContent` 字符串后，并用两个换行符分隔。
 * 5. **返回结果**：返回一个包含 `markdown` (合并后的完整 Markdown 文本) 和 `images` (提取的图片数据数组) 的对象。
 * 6. **错误处理**：如果在处理过程中发生任何错误，则记录错误日志，并返回一个包含错误信息的 Markdown 内容和空图片数组的对象。
 *
 * @param {Object} ocrResponse - OCR API 返回的原始 JSON 对象。
 *                                通常包含一个 `pages` 数组，每个页面对象包含 `markdown` 文本和可选的 `images` 数组。
 * @returns {Object} 一个包含处理结果的对象，结构为：
 *                   `{ markdown: string, images: Array<{id: string, data: string}> }`。
 *                   `markdown` 是从所有页面提取并处理图片引用后的合并文本。
 *                   `images` 是一个包含所有提取到的图片数据的数组，每个图片对象有 `id` 和 `data` (Base64 编码的图片字符串)。
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