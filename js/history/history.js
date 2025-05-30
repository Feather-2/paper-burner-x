// js/history.js

// =====================
// 历史记录面板相关逻辑
// =====================

/**
 * 当 HTML 文档完全加载并解析完成后，执行此函数。
 * 主要负责初始化历史记录面板的用户交互：
 *  - 为"显示历史"按钮绑定点击事件，用于打开历史面板并渲染历史列表。
 *  - 为"关闭历史面板"按钮绑定点击事件。
 *  - 为"清空历史记录"按钮绑定点击事件，并在用户确认后清空所有历史数据并刷新列表。
 */
document.addEventListener('DOMContentLoaded', function() {
    // 显示历史面板并渲染历史列表
    document.getElementById('showHistoryBtn').onclick = async function() {
        document.getElementById('historyPanel').classList.remove('hidden');
        await renderHistoryList();
    };
    // 关闭历史面板
    document.getElementById('closeHistoryPanel').onclick = function() {
        document.getElementById('historyPanel').classList.add('hidden');
    };
    // 清空所有历史记录
    document.getElementById('clearHistoryBtn').onclick = async function() {
        if (confirm('确定要清空所有历史记录吗？')) {
            await clearAllResultsFromDB();
            await renderHistoryList();
        }
    };

    // ---------------------
    // 历史记录列表渲染
    // ---------------------
    /**
     * 从 IndexedDB 加载所有历史记录，并将其渲染到历史记录面板的列表中。
     *
     * 主要步骤:
     * 1. 获取用于显示历史列表的 DOM 元素 (`#historyList`)。
     * 2. 调用 `getAllResultsFromDB()` 从 IndexedDB 异步获取所有存储的处理结果。
     * 3. 检查结果：如果无历史记录，则在列表区域显示"暂无历史记录"的提示。
     * 4. 排序：将获取到的历史记录按处理时间 (`time` 字段) 降序排列 (最新的在前)。
     * 5. 生成 HTML：遍历排序后的结果数组，为每条记录生成一个 HTML 片段，
     *    包含文件名、删除按钮、时间戳、OCR 和翻译内容的摘要、以及"查看详情"和"下载"按钮。
     *    每个按钮都绑定了相应的 `window` 上的全局函数 (如 `deleteHistoryRecord`, `showHistoryDetail`, `downloadHistoryRecord`)。
     * 6. 更新 DOM：将生成的 HTML 字符串集合设置为 `#historyList` 的 `innerHTML`。
     *
     * @async
     * @private
     * @returns {Promise<void>} 当列表渲染完成时解决。
     */
    async function renderHistoryList() {
        const listDiv = document.getElementById('historyList');
        const results = await getAllResultsFromDB();
        if (!results || results.length === 0) {
            listDiv.innerHTML = '<div class="text-gray-400 text-center py-8">暂无历史记录</div>';
            return;
        }
        // 按时间倒序排列
        results.sort((a, b) => new Date(b.time) - new Date(a.time));
        listDiv.innerHTML = results.map(r => `
            <div class="border-b py-2">
                <div class="flex justify-between items-center">
                    <span class="font-semibold">${r.name}</span>
                    <button onclick="deleteHistoryRecord('${r.id}')" class="text-xs text-red-400 hover:text-red-600">删除</button>
                </div>
                <div class="text-xs text-gray-500">时间: ${new Date(r.time).toLocaleString()}</div>
                <div class="text-xs text-gray-500">OCR: ${r.ocr ? r.ocr.slice(0, 40).replace(/\\n/g, ' ') + (r.ocr.length > 40 ? '...' : '') : '无'}</div>
                <div class="text-xs text-gray-500">翻译: ${r.translation ? r.translation.slice(0, 40).replace(/\\n/g, ' ') + (r.translation.length > 40 ? '...' : '') : '无'}</div>
                <button onclick="showHistoryDetail('${r.id}')" class="mt-1 text-blue-500 text-xs hover:underline">查看详情</button>
                <button onclick="downloadHistoryRecord('${r.id}')" class="mt-1 text-green-600 text-xs hover:underline ml-2">下载</button>
            </div>
        `).join('');
    }

    // ---------------------
    // 历史记录操作（删除/查看/下载）
    // ---------------------

    /**
     * (全局可调用) 删除指定 ID 的单条历史记录。
     * 操作完成后会重新渲染历史记录列表以反映更改。
     *
     * @async
     * @param {string} id - 要删除的历史记录的唯一 ID (通常是 `result.id`)。
     * @returns {Promise<void>} 当删除和列表刷新完成后解决。
     */
    window.deleteHistoryRecord = async function(id) {
        await deleteResultFromDB(id);
        await renderHistoryList();
    };

    /**
     * (全局可调用) 在新的浏览器标签页或窗口中显示指定历史记录的详细信息。
     * 它通过构建一个指向 `views/history/history_detail.html` 的 URL (包含记录 ID 作为查询参数) 并使用 `window.open` 实现。
     *
     * @param {string} id - 要查看详情的历史记录的唯一 ID。
     */
    window.showHistoryDetail = function(id) {
        window.open('views/history/history_detail.html?id=' + encodeURIComponent(id), '_blank');
    };

    /**
     * (全局可调用) 将指定 ID 的单条历史记录打包成一个 ZIP 文件并触发浏览器下载。
     * ZIP 包中将包含：
     *  - `document.md`: 包含原始 OCR 文本（如果存在）。
     *  - `translation.md`: 包含翻译后的文本（如果存在）。
     *  - `images/` 文件夹: 包含处理过程中提取的所有图片 (PNG格式，从 Base64 数据转换)。
     *
     * 主要步骤:
     * 1. 从 IndexedDB 获取指定 ID 的历史记录数据。
     * 2. 检查 JSZip库是否已加载，未加载则提示错误。
     * 3. 创建一个新的 JSZip 实例。
     * 4. 根据记录名创建一个顶层文件夹（文件名中的非法字符会被替换）。
     * 5. 将 OCR 文本和翻译文本（如果存在）分别存为 Markdown 文件。
     * 6. 如果存在图片数据 (`r.images`)，则创建一个 `images` 子文件夹，并将每张图片（Base64编码）
     *    解码后以 PNG 格式存入该子文件夹。
     * 7. 使用 JSZip 生成 ZIP 文件的 Blob 数据 (DEFLATE 压缩)。
     * 8. 构建文件名 (包含原始文件名和时间戳) 并使用 `saveAs` (FileSaver.js) 触发下载。
     *
     * @async
     * @param {string} id - 要下载的历史记录的唯一 ID。
     * @returns {Promise<void>} 当 ZIP 文件准备好并开始下载时解决，或在发生错误时提前返回。
     */
    window.downloadHistoryRecord = async function(id) {
        const r = await getResultFromDB(id);
        if (!r) return;
        if (typeof JSZip === 'undefined') {
            alert('JSZip 加载失败，无法打包下载');
            return;
        }
        const zip = new JSZip();
        // 文件夹名处理，去除非法字符
        const folder = zip.folder(r.name.replace(/\.pdf$/i, '').replace(/[/\\:*?"<>|]/g, '_').substring(0, 100));
        folder.file('document.md', r.ocr || '');
        if (r.translation) folder.file('translation.md', r.translation);
        if (r.images && r.images.length > 0) {
            const imagesFolder = folder.folder('images');
            for (const img of r.images) {
                // 处理base64图片数据
                const base64Data = img.data.includes(',') ? img.data.split(',')[1] : img.data;
                if (base64Data) {
                    imagesFolder.file(`${img.id}.png`, base64Data, { base64: true });
                }
            }
        }
        // 生成zip并下载
        const zipBlob = await zip.generateAsync({ type: 'blob', compression: "DEFLATE", compressionOptions: { level: 6 } });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        saveAs(zipBlob, `PaperBurner_${r.name}_${timestamp}.zip`);
    };
});
