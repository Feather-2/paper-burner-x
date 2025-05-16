// js/history.js

// =====================
// 历史记录面板相关逻辑
// =====================

/**
 * 页面加载后绑定历史面板相关事件
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
     * 渲染历史记录列表到页面
     * @returns {Promise<void>}
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
     * 删除单条历史记录
     * @param {string} id - 历史记录ID
     * @returns {Promise<void>}
     */
    window.deleteHistoryRecord = async function(id) {
        await deleteResultFromDB(id);
        await renderHistoryList();
    };

    /**
     * 查看历史详情，打开新窗口
     * @param {string} id - 历史记录ID
     */
    window.showHistoryDetail = function(id) {
        window.open('history_detail.html?id=' + encodeURIComponent(id), '_blank');
    };

    /**
     * 下载单条历史记录为zip包
     * @param {string} id - 历史记录ID
     * @returns {Promise<void>}
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
