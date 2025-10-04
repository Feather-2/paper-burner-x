// js/process/ocr-adapters/local-adapter.js
// 本地 PDF 解析适配器 - 使用 PDF.js 直接提取 PDF 文本

/**
 * 本地 PDF 解析适配器
 * 特点：
 * - 免费、快速、无需 API Key
 * - 仅适用于文字型 PDF（非扫描件）
 * - 不支持 OCR（扫描图片转文字）
 * - 尽力保留图片和表格的位置顺序
 */
class LocalPdfAdapter extends BaseOcrAdapter {
    constructor() {
        super();
        this.name = 'LocalPDF';

        // 检查 PDF.js 是否加载
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF.js 库未加载，无法使用本地 PDF 解析功能');
        }
    }

    /**
     * 验证配置
     * 本地解析不需要任何配置
     */
    async validateConfig() {
        return { valid: true };
    }

    /**
     * 处理 PDF 文件
     * @param {File} file - PDF 文件对象
     * @param {Function} onProgress - 进度回调 (current, total, message)
     * @returns {Promise<{markdown: string, images: Array}>}
     */
    async processFile(file, onProgress) {
        try {
            onProgress(0, 100, '开始本地解析 PDF...');

            // 读取文件为 ArrayBuffer
            const arrayBuffer = await file.arrayBuffer();

            onProgress(10, 100, '加载 PDF 文档...');

            // 加载 PDF 文档
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const pdf = await loadingTask.promise;

            const numPages = pdf.numPages;
            onProgress(20, 100, `PDF 共 ${numPages} 页，开始提取内容...`);

            const images = [];
            const pageContents = []; // 存储每页的内容片段（文本 + 图片标记）
            const BATCH_SIZE = 50; // 每50页处理一批，避免内存累积
            const totalBatches = Math.ceil(numPages / BATCH_SIZE);

            console.log(`[LocalPDF] 将分 ${totalBatches} 批处理，每批 ${BATCH_SIZE} 页`);

            // 分批处理页面
            for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
                const startPage = batchIdx * BATCH_SIZE + 1;
                const endPage = Math.min((batchIdx + 1) * BATCH_SIZE, numPages);

                console.log(`[LocalPDF] 处理第 ${batchIdx + 1}/${totalBatches} 批：第 ${startPage}-${endPage} 页`);

                // 处理当前批次的页面
                await this._processBatch(pdf, startPage, endPage, numPages, images, pageContents, onProgress);

                // 批次间休息，让浏览器释放内存
                if (batchIdx < totalBatches - 1) {
                    console.log(`[LocalPDF] 第 ${batchIdx + 1} 批完成，休息500ms...`);
                    await this.sleep(500);
                }
            }

            onProgress(90, 100, '启发式文本重建中...');

            // 合并所有页面内容（去掉页间分隔符）
            const mergedText = pageContents.join('\n\n');

            // 启发式文本重建
            const rebuiltText = this._heuristicRebuild(mergedText);

            onProgress(100, 100, '本地解析完成');

            return {
                markdown: rebuiltText,
                images: images,
                metadata: {
                    engine: 'local',
                    source: 'pdfjs',
                    pages: numPages,
                    note: '本地解析提取文本并保留图片位置'
                }
            };
        } catch (error) {
            console.error('[LocalPDF] 处理失败:', error);
            throw new Error(`本地 PDF 解析失败: ${error.message}`);
        }
    }

    /**
     * 处理一批页面
     * @private
     */
    async _processBatch(pdf, startPage, endPage, totalPages, images, pageContents, onProgress) {
        for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
            try {
                onProgress(
                    20 + Math.floor((pageNum / totalPages) * 70),
                    100,
                    `正在解析第 ${pageNum}/${totalPages} 页...`
                );

                console.log(`[LocalPDF] 开始处理第 ${pageNum} 页...`);
                const page = await pdf.getPage(pageNum);

                console.log(`[LocalPDF] 第 ${pageNum} 页：提取文本...`);
                const textContent = await page.getTextContent();
                const pageText = this._extractTextFromPage(textContent);

                console.log(`[LocalPDF] 第 ${pageNum} 页：检测图片...`);
                // 检测图片位置并插入占位符（带超时保护）
                const pageContentWithImages = await Promise.race([
                    this._insertImagePlaceholders(page, pageText, pageNum, images),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('图片提取超时')), 30000) // 30秒超时
                    )
                ]).catch(err => {
                    console.warn(`[LocalPDF] 第 ${pageNum} 页图片提取失败:`, err);
                    return pageText; // 失败时只返回文本
                });

                pageContents.push(pageContentWithImages);

                // 清理页面资源，避免内存泄漏
                page.cleanup();

                // 每10页输出一次进度日志
                if (pageNum % 10 === 0) {
                    console.log(`[LocalPDF] ✓ 已处理 ${pageNum}/${totalPages} 页，已提取 ${images.length} 个图片`);
                    // 每10页强制等待一下，让浏览器释放内存
                    await this.sleep(200);
                }
            } catch (pageError) {
                console.error(`[LocalPDF] ✗ 第 ${pageNum} 页处理失败:`, pageError);
                // 页面失败不中断整体处理，记录错误并继续
                pageContents.push(`\n\n*[第 ${pageNum} 页解析失败: ${pageError.message}]*\n\n`);
            }
        }
    }

    /**
     * 在原页面位置插入图片占位符
     * @private
     */
    async _insertImagePlaceholders(page, pageText, pageNum, images) {
        try {
            const ops = await page.getOperatorList();

            // 收集图片对象名称和位置
            const imageInfos = [];
            for (let i = 0; i < ops.fnArray.length; i++) {
                const fn = ops.fnArray[i];
                if (fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintJpegXObject) {
                    const imgName = ops.argsArray[i][0];
                    imageInfos.push({ name: imgName, opIndex: i });
                }
            }

            if (imageInfos.length === 0) {
                return pageText;
            }

            console.log(`[LocalPDF] 第 ${pageNum} 页检测到 ${imageInfos.length} 个图片对象`);
            let result = pageText;
            let extractedCount = 0;
            let skippedCount = 0;

            // 尝试提取每个图片
            for (let idx = 0; idx < imageInfos.length; idx++) {
                const imageId = `page${pageNum}_img${idx + 1}`;
                const imgInfo = imageInfos[idx];

                try {
                    // 给每个图片的获取操作添加超时
                    // 使用更长的超时时间，但只对前几个图片尝试
                    const timeout = (idx < 3) ? 2000 : 1000; // 前3个图片等2秒，其他等1秒
                    const imgObj = await Promise.race([
                        new Promise((resolve) => {
                            page.objs.get(imgInfo.name, resolve);
                        }),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('获取图片对象超时')), timeout)
                        )
                    ]);

                    if (!imgObj) {
                        console.warn(`[LocalPDF] 图片对象 ${imageId} 为空，跳过`);
                        skippedCount++;
                        continue;
                    }

                    const width = imgObj.width;
                    const height = imgObj.height;

                    // 过滤规则：
                    // 1. 跳过超小图（装饰）：宽或高 < 30px
                    // 2. 保留合理宽高比：0.05 - 20
                    const aspectRatio = width / height;
                    const isTooSmall = width < 30 || height < 30;
                    const isBadAspectRatio = aspectRatio < 0.05 || aspectRatio > 20;

                    if (isTooSmall) {
                        console.log(`[LocalPDF] 跳过超小图片 ${imageId}: ${width}x${height} (可能是图标或装饰)`);
                        skippedCount++;
                        continue;
                    }

                    if (isBadAspectRatio) {
                        console.log(`[LocalPDF] 跳过异常宽高比图片 ${imageId}: ${width}x${height} (ratio: ${aspectRatio.toFixed(2)})`);
                        skippedCount++;
                        continue;
                    }

                    console.log(`[LocalPDF] 提取图片 ${imageId}: ${width}x${height}`);
                    let base64Data = null;

                    // 方法1: ImageBitmap 对象（PDF.js 常见格式）
                    if (imgObj.bitmap && imgObj.bitmap instanceof ImageBitmap) {
                        // 限制图片最大尺寸，进一步降低以减少内存
                        const maxDimension = 600; // 降低到600px
                        let targetWidth = width;
                        let targetHeight = height;

                        if (targetWidth > maxDimension || targetHeight > maxDimension) {
                            const scale = Math.min(maxDimension / targetWidth, maxDimension / targetHeight);
                            targetWidth = Math.floor(targetWidth * scale);
                            targetHeight = Math.floor(targetHeight * scale);
                        }

                        const canvas = document.createElement('canvas');
                        canvas.width = targetWidth;
                        canvas.height = targetHeight;
                        const ctx = canvas.getContext('2d', { willReadFrequently: false });

                        // 使用 drawImage 绘制并缩放 ImageBitmap
                        ctx.drawImage(imgObj.bitmap, 0, 0, targetWidth, targetHeight);
                        base64Data = canvas.toDataURL('image/jpeg', 0.7); // 降低质量到70%

                        // 立即释放资源
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        canvas.width = 0;
                        canvas.height = 0;

                        // 关闭 ImageBitmap
                        if (imgObj.bitmap.close) {
                            imgObj.bitmap.close();
                        }
                    }
                    // 方法2: JPEG 原始数据
                    else if (imgObj.kind === 1 && imgObj.data) {
                        const bytes = imgObj.data;
                        const blob = new Blob([bytes], { type: 'image/jpeg' });
                        base64Data = await this.blobToBase64(blob);
                    }
                    // 方法3: 原始像素数据
                    else if (imgObj.data) {
                        const imgData = imgObj.data;

                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d', { willReadFrequently: false });

                        const imageData = ctx.createImageData(width, height);

                        if (imgData instanceof Uint8ClampedArray || imgData instanceof Uint8Array) {
                            imageData.data.set(imgData);
                        } else if (ArrayBuffer.isView(imgData)) {
                            imageData.data.set(new Uint8ClampedArray(imgData.buffer));
                        } else {
                            throw new Error(`Unsupported image data format: ${imgData.constructor.name}`);
                        }

                        ctx.putImageData(imageData, 0, 0);
                        base64Data = canvas.toDataURL('image/jpeg', 0.7); // 降低质量到70%

                        canvas.width = 0;
                        canvas.height = 0;
                    } else {
                        throw new Error('Unknown image format');
                    }

                    if (base64Data) {
                        images.push({
                            id: imageId,
                            data: base64Data
                        });

                        // 在文本末尾添加图片引用
                        result += `\n\n![图片${extractedCount + 1}](images/${imageId}.png)\n\n`;
                        extractedCount++;
                    }
                } catch (imgError) {
                    // 图片提取失败，静默跳过，只在需要调试时输出
                    if (imgError.message.includes('超时')) {
                        // 超时错误不输出，太多了
                        skippedCount++;
                    } else {
                        console.warn(`[LocalPDF] 提取图片 ${imageId} 失败:`, imgError.message);
                        skippedCount++;
                    }
                }

                // 每处理5个图片休息一下，让浏览器有时间释放内存
                if ((idx + 1) % 5 === 0) {
                    await this.sleep(100);
                }
            }

            console.log(`[LocalPDF] 第 ${pageNum} 页图片处理完成: 提取 ${extractedCount} 个，跳过 ${skippedCount} 个`);
            return result;
        } catch (error) {
            console.warn(`[LocalPDF] 第 ${pageNum} 页图片处理失败:`, error);
            return pageText;
        }
    }

    /**
     * 启发式文本重建
     * @private
     */
    _heuristicRebuild(text) {
        let rebuilt = text;

        // 先保护图片引用，避免被文本处理规则破坏
        const imageRefs = [];
        rebuilt = rebuilt.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match) => {
            const placeholder = `__IMG_PLACEHOLDER_${imageRefs.length}__`;
            imageRefs.push(match);
            return placeholder;
        });

        // 1. 修复被断开的单词（英文）
        // 匹配：字母-空格-换行-字母 -> 字母字母
        rebuilt = rebuilt.replace(/([a-zA-Z])-\s*\n\s*([a-z])/g, '$1$2');

        // 2. 合并被打断的句子
        // 如果行尾不是句号等结束符，且下一行不是大写/数字/特殊字符开头，则合并
        rebuilt = rebuilt.replace(/([^\n.!?。！？])\n([a-z\u4e00-\u9fa5])/g, '$1 $2');

        // 3. 修复标点符号周围的空格
        // 中文标点前后不应有空格
        rebuilt = rebuilt.replace(/\s+([，。！？；：、）】」』])/g, '$1');
        rebuilt = rebuilt.replace(/([（【「『])\s+/g, '$1');

        // 英文标点后应有空格（如果后面是字母）
        rebuilt = rebuilt.replace(/([,.!?;:])([a-zA-Z])/g, '$1 $2');

        // 移除标点前的多余空格
        rebuilt = rebuilt.replace(/\s+([,.!?;:])/g, '$1');

        // 4. 规范化空白字符
        // 多个空格变成一个
        rebuilt = rebuilt.replace(/ {2,}/g, ' ');

        // 保留段落分隔（最多2个换行）
        rebuilt = rebuilt.replace(/\n{3,}/g, '\n\n');

        // 5. 修复常见的格式问题
        // 修复：数字. 后面应该有空格（列表项）
        rebuilt = rebuilt.replace(/(\d+)\.\s*([a-zA-Z\u4e00-\u9fa5])/g, '$1. $2');

        // 修复：括号内不应有首尾空格
        rebuilt = rebuilt.replace(/\(\s+/g, '(');
        rebuilt = rebuilt.replace(/\s+\)/g, ')');

        // 6. 智能段落识别
        // 如果连续的短行可能是同一段落，尝试合并
        const lines = rebuilt.split('\n');
        const paragraphs = [];
        let currentPara = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line === '') {
                if (currentPara) {
                    paragraphs.push(currentPara.trim());
                    currentPara = '';
                }
                continue;
            }

            // 判断是否应该换段
            const shouldBreak =
                // 当前段落为空
                currentPara === '' ||
                // 行以标题标记开头
                /^#{1,6}\s/.test(line) ||
                // 行以列表标记开头
                /^[\-\*\+]\s/.test(line) ||
                /^\d+\.\s/.test(line) ||
                // 上一行以句号等结束且本行首字母大写
                (/[.!?。！？]\s*$/.test(currentPara) && /^[A-Z\u4e00-\u9fa5]/.test(line));

            if (shouldBreak) {
                if (currentPara) {
                    paragraphs.push(currentPara.trim());
                }
                currentPara = line;
            } else {
                currentPara += ' ' + line;
            }
        }

        if (currentPara) {
            paragraphs.push(currentPara.trim());
        }

        rebuilt = paragraphs.join('\n\n');

        // 恢复图片引用
        imageRefs.forEach((ref, idx) => {
            rebuilt = rebuilt.replace(`__IMG_PLACEHOLDER_${idx}__`, ref);
        });

        return rebuilt.trim();
    }

    /**
     * 从 TextContent 中提取文本
     * @private
     */
    _extractTextFromPage(textContent) {
        const items = textContent.items;
        let text = '';
        let lastY = null;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // 检测换行（Y 坐标变化）
            if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
                text += '\n';
            }

            text += item.str;

            // 如果下一个 item 有空格，添加空格
            if (i < items.length - 1) {
                const nextItem = items[i + 1];
                const spaceWidth = item.width * 0.3; // 估算空格宽度
                if (nextItem.transform[4] - item.transform[4] > spaceWidth) {
                    text += ' ';
                }
            }

            lastY = item.transform[5];
        }

        return text.trim();
    }
}

// 注册到全局
if (typeof window !== 'undefined') {
    window.LocalPdfAdapter = LocalPdfAdapter;
}
