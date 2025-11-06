// Paper Burner X - 管理员面板增强功能
// 包含：配额管理、详细统计、趋势图表、活动日志

// ==================== 全局网络与提示（超时/拦截/离线提示） ====================

// 统一超时
axios.defaults.timeout = 15000; // 15s

// 简易 Toast 实现
function ensureToastContainer() {
    let c = document.getElementById('toast-container');
    if (!c) {
        c = document.createElement('div');
        c.id = 'toast-container';
        c.style.position = 'fixed';
        c.style.top = '12px';
        c.style.right = '12px';
        c.style.zIndex = '9999';
        c.style.display = 'flex';
        c.style.flexDirection = 'column';
        c.style.gap = '8px';
        document.body.appendChild(c);
    }
    return c;
}

function showToast(message, type = 'info', duration = 3000) {
    const c = ensureToastContainer();
    const el = document.createElement('div');
    const base = 'px-3 py-2 rounded shadow text-sm text-white';
    const color = type === 'error' ? 'bg-red-600' : type === 'warn' ? 'bg-yellow-600' : 'bg-gray-800';
    el.className = `${base} ${color}`;
    el.textContent = message;
    c.appendChild(el);
    setTimeout(() => { try { c.removeChild(el); } catch {} }, duration);
}

// 离线横幅
function ensureOfflineBanner() {
    let b = document.getElementById('offline-banner');
    if (!b) {
        b = document.createElement('div');
        b.id = 'offline-banner';
        b.className = 'w-full text-center text-sm text-white bg-red-600 py-2 hidden';
        b.textContent = '当前处于离线状态，部分功能不可用；请检查网络连接。';
        document.body.prepend(b);
    }
    return b;
}

function updateOfflineBanner() {
    const b = ensureOfflineBanner();
    if (navigator.onLine) {
        b.classList.add('hidden');
    } else {
        b.classList.remove('hidden');
    }
}

window.addEventListener('online', () => {
    updateOfflineBanner();
    showToast('网络已恢复', 'info', 1500);
});
window.addEventListener('offline', () => {
    updateOfflineBanner();
    showToast('网络连接断开', 'warn');
});

// Axios 响应错误统一处理 + GET 一次自动重试
axios.interceptors.response.use(
    (res) => res,
    async (error) => {
        const config = error?.config || {};
        const isGet = (config.method || 'get').toLowerCase() === 'get';
        const transient = !error.response; // 网络/超时等
        const code = error.code || '';

        // 自动重试：仅 GET，且网络错误/超时，最多 1 次
        if (isGet && transient && !config.__retried) {
            config.__retried = true;
            await new Promise(r => setTimeout(r, 800));
            try { return await axios(config); } catch (e) { /* fallthrough */ }
        }

        // 统一提示
        if (transient || code === 'ECONNABORTED') {
            showToast('网络连接中断或超时，请稍后重试', 'warn');
        } else if (error.response) {
            const msg = error.response?.data?.error || `请求失败 (${error.response.status})`;
            showToast(msg, 'error');
        } else {
            showToast('请求失败，请检查网络或稍后再试', 'error');
        }

        return Promise.reject(error);
    }
);

// ================ URL Hash 持久化日期筛选 ================
function persistRangeToHash() {
    try {
        const s = document.getElementById('statsStartDate')?.value || '';
        const e = document.getElementById('statsEndDate')?.value || '';
        const params = new URLSearchParams(location.hash.replace(/^#/, ''));
        if (s) params.set('startDate', s); else params.delete('startDate');
        if (e) params.set('endDate', e); else params.delete('endDate');
        const next = params.toString();
        location.hash = next ? `#${next}` : '';
    } catch {}
}

function restoreRangeFromHash() {
    try {
        const params = new URLSearchParams(location.hash.replace(/^#/, ''));
        const s = params.get('startDate') || '';
        const e = params.get('endDate') || '';
        const sd = document.getElementById('statsStartDate');
        const ed = document.getElementById('statsEndDate');
        if (sd) sd.value = s;
        if (ed) ed.value = e;
    } catch {}
}

function persistTabToHash(tab) {
    try {
        const params = new URLSearchParams(location.hash.replace(/^#/, ''));
        if (tab) params.set('tab', tab); else params.delete('tab');
        const next = params.toString();
        location.hash = next ? `#${next}` : '';
    } catch {}
}

function restoreTabFromHash() {
    try {
        const params = new URLSearchParams(location.hash.replace(/^#/, ''));
        const tab = params.get('tab');
        if (tab) {
            // 若 hash 指向的 tab 存在，则切换；否则保持默认
            const known = ['overview','users','quotas','activity','models','system'];
            if (known.includes(tab)) {
                // 直接调用增强后的切换函数（会触发加载与持久化）
                switchTab(tab);
                return true;
            }
        }
    } catch {}
    return false;
}

// ==================== 详细统计 ====================

function getStatsRangeParams() {
    const s = document.getElementById('statsStartDate')?.value || '';
    const e = document.getElementById('statsEndDate')?.value || '';
    const params = new URLSearchParams();
    if (s) params.set('startDate', s);
    if (e) params.set('endDate', e);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

function updateStatsRangeHint() {
    const s = document.getElementById('statsStartDate')?.value || '';
    const e = document.getElementById('statsEndDate')?.value || '';
    const el = document.getElementById('statsRangeHint');
    if (!el) return;
    if (!s && !e) {
        el.textContent = '当前筛选：全部';
        return;
    }
    if (s && e) {
        el.textContent = `当前筛选：${s} - ${e}`;
    } else if (s) {
        el.textContent = `当前筛选：自 ${s} 起`; 
    } else {
        el.textContent = `当前筛选：截至 ${e}`;
    }
}

async function loadDetailedStats() {
    try {
        const range = getStatsRangeParams();
        const response = await axios.get(`${API_BASE}/admin/stats/detailed${range}`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        const stats = response.data;

        // 更新额外统计卡片
        if (document.getElementById('documentsThisWeek')) {
            document.getElementById('documentsThisWeek').textContent = stats.basic.documentsThisWeek || '-';
        }
        if (document.getElementById('documentsThisMonth')) {
            document.getElementById('documentsThisMonth').textContent = stats.basic.documentsThisMonth || '-';
        }
        if (document.getElementById('totalStorageMB')) {
            document.getElementById('totalStorageMB').textContent = (stats.basic.totalStorageMB || 0) + ' MB';
        }

        // 显示文档状态分布
        displayDocumentsByStatus(stats.documentsByStatus || []);

        // 显示 Top 用户
        displayTopUsers(stats.topUsers || []);

        updateStatsRangeHint();
    } catch (error) {
        console.error('Failed to load detailed stats:', error);
    }
}

function displayDocumentsByStatus(statusData) {
    const container = document.getElementById('documentsByStatus');
    if (!container) return;

    const statusColors = {
        'PENDING': 'bg-gray-100 text-gray-800',
        'PROCESSING': 'bg-blue-100 text-blue-800',
        'OCR_COMPLETED': 'bg-yellow-100 text-yellow-800',
        'TRANSLATION_COMPLETED': 'bg-purple-100 text-purple-800',
        'COMPLETED': 'bg-green-100 text-green-800',
        'FAILED': 'bg-red-100 text-red-800'
    };

    const statusNames = {
        'PENDING': '待处理',
        'PROCESSING': '处理中',
        'OCR_COMPLETED': 'OCR完成',
        'TRANSLATION_COMPLETED': '翻译完成',
        'COMPLETED': '已完成',
        'FAILED': '失败'
    };

    container.innerHTML = statusData.map(item => `
        <div class="p-4 rounded-lg border ${statusColors[item.status] || 'bg-gray-100'}">
            <div class="text-xs font-medium mb-1">${statusNames[item.status] || item.status}</div>
            <div class="text-2xl font-bold">${item.count}</div>
        </div>
    `).join('');
}

function displayTopUsers(topUsers) {
    const tbody = document.getElementById('topUsersList');
    if (!tbody) return;

    if (topUsers.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-4 text-center text-gray-500">暂无数据</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = topUsers.map((user, index) => `
        <tr>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
                <span class="inline-flex items-center justify-center w-6 h-6 rounded-full ${index < 3 ? 'bg-yellow-100 text-yellow-800 font-bold' : 'bg-gray-100 text-gray-800'}">
                    ${index + 1}
                </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">${escapeHtml(user.name || '-')}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">${escapeHtml(user.email)}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-semibold">${user.documentCount}</td>
        </tr>
    `).join('');
}

// ==================== 趋势图表 ====================

let trendChartInstance = null;

async function loadTrendsChart() {
    try {
        // 直接传递 startDate/endDate（若存在）；否则默认 days=30
        const s = document.getElementById('statsStartDate')?.value;
        const e = document.getElementById('statsEndDate')?.value;
        let url = `${API_BASE}/admin/stats/trends?days=30`;
        if (s || e) {
            const params = new URLSearchParams();
            if (s) params.set('startDate', s);
            if (e) params.set('endDate', e);
            url = `${API_BASE}/admin/stats/trends?${params.toString()}`;
        }
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        const trends = response.data;

        const ctx = document.getElementById('trendChart');
        if (!ctx) return;

        // 销毁旧图表
        if (trendChartInstance) {
            trendChartInstance.destroy();
        }

        // 创建新图表
        trendChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: trends.map(t => {
                    const date = new Date(t.date);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                }),
                datasets: [
                    {
                        label: '总处理量',
                        data: trends.map(t => t.total),
                        borderColor: 'rgb(59, 130, 246)',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: '成功',
                        data: trends.map(t => t.completed),
                        borderColor: 'rgb(34, 197, 94)',
                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                        tension: 0.4
                    },
                    {
                        label: '失败',
                        data: trends.map(t => t.failed),
                        borderColor: 'rgb(239, 68, 68)',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        tension: 0.4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });

    } catch (error) {
        console.error('Failed to load trends chart:', error);
    }
}

// 应用/清除日期范围并刷新
async function applyStatsRange() {
    persistRangeToHash();
    await loadDetailedStats();
    await loadTrendsChart();
}
async function clearStatsRange() {
    const s = document.getElementById('statsStartDate');
    const e = document.getElementById('statsEndDate');
    if (s) s.value = '';
    if (e) e.value = '';
    persistRangeToHash();
    await applyStatsRange();
}

window.applyStatsRange = applyStatsRange;
window.clearStatsRange = clearStatsRange;

// ==================== 配额管理 ====================

async function populateUserSelect() {
    try {
        const response = await axios.get(`${API_BASE}/admin/users`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        // 后端 /admin/users 返回 { total, page, pageSize, items }
        const payload = response.data || {};
        const users = Array.isArray(payload.items) ? payload.items : Array.isArray(payload) ? payload : [];

        // 填充配额管理的用户选择器
        const quotaSelect = document.getElementById('quotaUserId');
        if (quotaSelect) {
            quotaSelect.innerHTML = '<option value="">请选择用户...</option>' +
                users.map(user => `
                    <option value="${user.id}">${escapeHtml(user.email)} - ${escapeHtml(user.name || '未设置姓名')}</option>
                `).join('');
        }

        // 填充活动日志的用户选择器
        const activitySelect = document.getElementById('activityUserId');
        if (activitySelect) {
            activitySelect.innerHTML = '<option value="">请选择用户...</option>' +
                users.map(user => `
                    <option value="${user.id}">${escapeHtml(user.email)} - ${escapeHtml(user.name || '未设置姓名')}</option>
                `).join('');
        }

    } catch (error) {
        console.error('Failed to load users:', error);
    }
}

async function loadUserQuota() {
    const userId = document.getElementById('quotaUserId').value;
    if (!userId) {
        document.getElementById('quotaForm').classList.add('hidden');
        return;
    }

    try {
        const response = await axios.get(`${API_BASE}/admin/users/${userId}/quota`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        const quota = response.data;

        // 显示表单
        document.getElementById('quotaForm').classList.remove('hidden');

        // 填充配额数据
        document.getElementById('maxDocumentsPerDay').value = quota.maxDocumentsPerDay;
        document.getElementById('maxDocumentsPerMonth').value = quota.maxDocumentsPerMonth;
        document.getElementById('maxStorageSize').value = quota.maxStorageSize;
        document.getElementById('maxApiKeysCount').value = quota.maxApiKeysCount;

        // 显示当前使用量
        document.getElementById('documentsThisMonthQuota').textContent = quota.documentsThisMonth;
        document.getElementById('currentStorageUsed').textContent = quota.currentStorageUsed;

        // 更新进度条
        updateProgressBar('documentsProgressBar', quota.documentsThisMonth, quota.maxDocumentsPerMonth);
        updateProgressBar('storageProgressBar', quota.currentStorageUsed, quota.maxStorageSize);

    } catch (error) {
        console.error('Failed to load quota:', error);
        alert('加载配额失败：' + (error.response?.data?.error || error.message));
    }
}

function updateProgressBar(elementId, current, max) {
    const bar = document.getElementById(elementId);
    if (!bar) return;

    if (max <= 0) {
        bar.style.width = '0%';
        bar.classList.remove('bg-red-600');
        bar.classList.add('bg-blue-600');
        return;
    }

    const percentage = Math.min((current / max) * 100, 100);
    bar.style.width = `${percentage}%`;

    // 根据使用率改变颜色
    if (percentage > 90) {
        bar.classList.remove('bg-blue-600', 'bg-yellow-600');
        bar.classList.add('bg-red-600');
    } else if (percentage > 70) {
        bar.classList.remove('bg-blue-600', 'bg-red-600');
        bar.classList.add('bg-yellow-600');
    } else {
        bar.classList.remove('bg-red-600', 'bg-yellow-600');
        bar.classList.add('bg-blue-600');
    }
}

async function saveUserQuota() {
    const userId = document.getElementById('quotaUserId').value;
    if (!userId) {
        alert('请先选择用户');
        return;
    }

    const quotaData = {
        maxDocumentsPerDay: parseInt(document.getElementById('maxDocumentsPerDay').value),
        maxDocumentsPerMonth: parseInt(document.getElementById('maxDocumentsPerMonth').value),
        maxStorageSize: parseInt(document.getElementById('maxStorageSize').value),
        maxApiKeysCount: parseInt(document.getElementById('maxApiKeysCount').value)
    };

    try {
        await axios.put(`${API_BASE}/admin/users/${userId}/quota`, quotaData, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        alert('配额保存成功！');
        await loadUserQuota(); // 重新加载以显示更新后的数据

    } catch (error) {
        console.error('Failed to save quota:', error);
        alert('保存配额失败：' + (error.response?.data?.error || error.message));
    }
}

async function resetUserQuota() {
    const userId = document.getElementById('quotaUserId').value;
    if (!userId) {
        alert('请先选择用户');
        return;
    }

    if (!confirm('确定要重置该用户的使用量吗？')) {
        return;
    }

    try {
        await axios.put(`${API_BASE}/admin/users/${userId}/quota`, {
            documentsThisMonth: 0,
            currentStorageUsed: 0,
            lastMonthlyReset: new Date().toISOString()
        }, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        alert('使用量已重置！');
        await loadUserQuota();

    } catch (error) {
        console.error('Failed to reset quota:', error);
        alert('重置失败：' + (error.response?.data?.error || error.message));
    }
}

// ==================== 活动日志 ====================

async function loadUserActivity() {
    const userId = document.getElementById('activityUserId').value;
    const limit = document.getElementById('activityLimit').value;
    const tbody = document.getElementById('activityLogsList');

    if (!userId) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-4 text-center text-gray-500">
                    请选择用户查看活动日志
                </td>
            </tr>
        `;
        return;
    }

    try {
        const response = await axios.get(`${API_BASE}/admin/users/${userId}/activity?limit=${limit}`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        const logs = response.data;

        if (logs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="px-6 py-4 text-center text-gray-500">
                        该用户暂无活动记录
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = logs.map(log => `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${new Date(log.createdAt).toLocaleString('zh-CN')}
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm">
                    <span class="px-2 py-1 text-xs font-medium rounded-full ${getActionBadgeClass(log.action)}">
                        ${formatActionName(log.action)}
                    </span>
                </td>
                <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">
                    ${log.resourceId ? log.resourceId.substring(0, 8) + '...' : '-'}
                </td>
                <td class="px-6 py-4 text-sm text-gray-500">
                    ${formatMetadata(log.metadata)}
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('Failed to load activity logs:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-4 text-center text-red-500">
                    加载失败：${error.message}
                </td>
            </tr>
        `;
    }
}

function getActionBadgeClass(action) {
    const classes = {
        'document_create': 'bg-blue-100 text-blue-800',
        'document_delete': 'bg-red-100 text-red-800',
        'ocr': 'bg-purple-100 text-purple-800',
        'translate': 'bg-green-100 text-green-800'
    };
    return classes[action] || 'bg-gray-100 text-gray-800';
}

function formatActionName(action) {
    const names = {
        'document_create': '创建文档',
        'document_delete': '删除文档',
        'ocr': 'OCR 处理',
        'translate': '翻译'
    };
    return names[action] || action;
}

function formatMetadata(metadata) {
    if (!metadata) return '-';
    if (typeof metadata === 'string') return metadata;

    const obj = typeof metadata === 'object' ? metadata : {};
    const parts = [];

    if (obj.fileName) parts.push(`文件: ${obj.fileName}`);
    if (obj.fileType) parts.push(`类型: ${obj.fileType}`);

    return parts.length > 0 ? parts.join(', ') : JSON.stringify(obj).substring(0, 50);
}

// ==================== 标签页切换增强 ====================

async function initOverviewStatsModule() {
    try {
        const mod = await import('./modules/stats.js');
        await mod.initStats();
    } catch (e) {
        console.error('Failed to init stats module:', e);
    }
}

function switchTab(tab) {
    // 更新选项卡样式
    document.querySelectorAll('.tab-button').forEach(btn => {
        btn.classList.remove('border-blue-500', 'text-blue-600');
        btn.classList.add('border-transparent', 'text-gray-500');
    });
    const activeTab = document.getElementById(`tab-${tab}`);
    if (activeTab) {
        activeTab.classList.add('border-blue-500', 'text-blue-600');
        activeTab.classList.remove('border-transparent', 'text-gray-500');
    }

    // 切换内容
    const tabs = ['overview', 'users', 'quotas', 'activity', 'models', 'system'];
    tabs.forEach(t => {
        const content = document.getElementById(`content-${t}`);
        if (content) {
            content.classList.toggle('hidden', t !== tab);
        }
    });

    // 持久化到 URL hash
    persistTabToHash(tab);

    // 根据标签页加载数据
    if (tab === 'overview') {
        initOverviewStatsModule();
    } else if (tab === 'quotas') {
        (async () => { try { const m = await import('./modules/quotas.js'); await m.initQuotas(); } catch(e){ console.error(e);} })();
    } else if (tab === 'activity') {
        (async () => { try { const m = await import('./modules/activity.js'); await m.initActivity(); } catch(e){ console.error(e);} })();
    } else if (tab === 'system') {
        // 进入系统设置页时加载代理配置（动态导入模块）
        (async () => { try { const m = await import('./modules/system.js'); await m.initSystem(); } catch(e){ console.error(e);} })();
    } else if (tab === 'models') {
        loadSourceSites();
    }
}

// ==================== 初始化增强 ====================

// 扩展原有的 showAdminPanel 函数
const originalShowAdminPanel = window.showAdminPanel;
window.showAdminPanel = async function(user) {
    if (originalShowAdminPanel) {
        await originalShowAdminPanel(user);
    }
    // 初始化概览统计模块（动态导入，失败不影响其它功能）
    await initOverviewStatsModule();
};

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log('Admin panel enhancements loaded');
    // 恢复 URL hash 中的日期筛选
    restoreRangeFromHash();
    // 若 URL 指定 tab，则切换到指定 tab
    restoreTabFromHash();
    // 绑定模型配置的导入/导出按钮
    const importBtn = document.getElementById('importSourceSitesBtn');
    const importFile = document.getElementById('importSourceSitesFile');
    const exportBtn = document.getElementById('exportSourceSitesBtn');
    if (importBtn && importFile) {
        importBtn.addEventListener('click', () => importFile.click());
        importFile.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const json = JSON.parse(text);
                await importSourceSites(json);
                await loadSourceSites();
                alert('导入完成');
            } catch (err) {
                console.error('Import failed:', err);
                alert('导入失败：' + err.message);
            } finally {
                e.target.value = '';
            }
        });
    }
    if (exportBtn) {
        exportBtn.addEventListener('click', exportSourceSites);
    }
});

// ==================== 代理设置（系统设置） ====================

async function loadProxySettings() {
    try {
        const resp = await axios.get(`${API_BASE}/admin/config`, { headers: { Authorization: `Bearer ${authToken}` } });
        const cfg = resp.data || {};
        // 回显
        // 通用系统设置
        setSelectValue('allowRegistration', (cfg.ALLOW_REGISTRATION || 'false').toString());
        setInputValue('maxUploadSize', cfg.MAX_UPLOAD_SIZE_MB || '100');

        // 代理与下载相关
        setInputValue('proxyWhitelistDomains', cfg.PROXY_WHITELIST_DOMAINS || '');
        setInputValue('workerProxyDomains', cfg.WORKER_PROXY_DOMAINS || '');
        setSelectValue('allowHttpProxy', (cfg.ALLOW_HTTP_PROXY || 'false').toString());
        setInputValue('ocrUpstreamTimeoutMs', cfg.OCR_UPSTREAM_TIMEOUT_MS || '30000');
        setInputValue('maxProxyDownloadMb', cfg.MAX_PROXY_DOWNLOAD_MB || '100');

        // 读取有效配置与来源拆解并渲染
        const eff = await axios.get(`${API_BASE}/admin/proxy-settings/effective`, { headers: { Authorization: `Bearer ${authToken}` } });
        renderEffectiveProxySettings(eff.data);
    } catch (e) {
        console.error('Failed to load proxy settings:', e);
    }
}
// 保存通用系统设置（允许注册、最大上传大小）
async function saveSystemSettings() {
    try {
        const entries = [
            { key: 'ALLOW_REGISTRATION', value: getSelectValue('allowRegistration') },
            { key: 'MAX_UPLOAD_SIZE_MB', value: String(parseInt(getInputValue('maxUploadSize') || '100')) },
        ];
        for (const item of entries) {
            await axios.put(`${API_BASE}/admin/config`, item, { headers: { Authorization: `Bearer ${authToken}` } });
        }
        alert('系统设置已保存');
    } catch (e) {
        console.error('Failed to save system settings:', e);
        alert('保存失败：' + (e.response?.data?.error || e.message));
    }
}


async function saveProxySettings() {
    try {
        const entries = [
            { key: 'PROXY_WHITELIST_DOMAINS', value: getInputValue('proxyWhitelistDomains') },
            { key: 'WORKER_PROXY_DOMAINS', value: getInputValue('workerProxyDomains') },
            { key: 'ALLOW_HTTP_PROXY', value: getSelectValue('allowHttpProxy') },
            { key: 'OCR_UPSTREAM_TIMEOUT_MS', value: String(parseInt(getInputValue('ocrUpstreamTimeoutMs') || '30000')) },
            { key: 'MAX_PROXY_DOWNLOAD_MB', value: String(parseInt(getInputValue('maxProxyDownloadMb') || '100')) },
        ];

        for (const item of entries) {
            await axios.put(`${API_BASE}/admin/config`, item, { headers: { Authorization: `Bearer ${authToken}` } });
        }
        alert('已保存，约 60 秒内生效');
    } catch (e) {
        console.error('Failed to save proxy settings:', e);
        alert('保存失败：' + (e.response?.data?.error || e.message));
    }
}

function setInputValue(id, val) { const el = document.getElementById(id); if (el) el.value = val ?? ''; }
function getInputValue(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function setSelectValue(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
function getSelectValue(id) { const el = document.getElementById(id); return el ? el.value : ''; }

// ==================== 自定义源站（模型配置） ====================

async function loadSourceSites() {
    try {
        const resp = await axios.get(`${API_BASE}/admin/source-sites`, { headers: { Authorization: `Bearer ${authToken}` } });
        renderSourceSitesList(resp.data || []);
    } catch (e) {
        console.error('Failed to load source sites:', e);
        const list = document.getElementById('sourceSitesList');
        if (list) list.innerHTML = `<div class="text-sm text-red-600">加载失败：${e.message}</div>`;
    }
}

function renderSourceSitesList(sites) {
    const list = document.getElementById('sourceSitesList');
    if (!list) return;
    if (!Array.isArray(sites) || sites.length === 0) {
        list.innerHTML = `<div class="text-gray-500 text-sm">暂无自定义源站。</div>`;
        return;
    }
    list.innerHTML = sites.map(site => `
        <div class="bg-white border rounded-lg p-4">
            <div class="flex items-center justify-between">
                <div>
                    <div class="text-base font-medium">${escapeHtml(site.displayName || '-')}</div>
                    <div class="text-xs text-gray-600 mt-1">${escapeHtml(site.apiBaseUrl || '-')}</div>
                    <div class="text-xs text-gray-500 mt-1">格式: ${escapeHtml(site.requestFormat || 'openai')} · 温度: ${site.temperature ?? 0.5} · MaxTokens: ${site.maxTokens ?? 8000}</div>
                </div>
                <div class="flex items-center gap-3">
                    <button class="text-blue-600 hover:text-blue-800" onclick="editSourceSite('${site.id}')">编辑</button>
                    <button class="text-red-600 hover:text-red-800" onclick="deleteSourceSite('${site.id}')">删除</button>
                </div>
            </div>
            <div class="text-xs text-gray-500 mt-2">提示：该域将自动加入代理白名单。</div>
        </div>
    `).join('');
}

async function addSourceSite() {
    try {
        const displayName = prompt('源站名称：'); if (!displayName) return;
        const apiBaseUrl = prompt('API 基础地址（https://...）：'); if (!apiBaseUrl) return;
        const requestFormat = prompt('请求格式（openai/anthropic/custom，默认 openai）：') || 'openai';
        const temperature = parseFloat(prompt('温度（0.0~2.0，默认 0.5）：') || '0.5');
        const maxTokens = parseInt(prompt('最大 Tokens（默认 8000）：') || '8000');
        const modelsCsv = prompt('可用模型（逗号分隔，可留空）：') || '';
        const availableModels = modelsCsv ? modelsCsv.split(',').map(s => s.trim()).filter(Boolean) : [];

        const payload = { displayName, apiBaseUrl, requestFormat, temperature, maxTokens, availableModels };
        await axios.post(`${API_BASE}/admin/source-sites`, payload, { headers: { Authorization: `Bearer ${authToken}` } });
        await loadSourceSites();
        alert('已添加');
    } catch (e) {
        alert('添加失败：' + (e.response?.data?.error || e.message));
    }
}

async function editSourceSite(id) {
    try {
        // 获取当前项
        const resp = await axios.get(`${API_BASE}/admin/source-sites`, { headers: { Authorization: `Bearer ${authToken}` } });
        const site = (resp.data || []).find(s => s.id === id);
        if (!site) return alert('未找到该源站');

        const displayName = prompt('源站名称：', site.displayName || '') ?? site.displayName;
        const apiBaseUrl = prompt('API 基础地址（https://...）：', site.apiBaseUrl || '') ?? site.apiBaseUrl;
        const requestFormat = prompt('请求格式（openai/anthropic/custom）：', site.requestFormat || 'openai') || site.requestFormat;
        const temperature = parseFloat(prompt('温度（0.0~2.0）：', String(site.temperature ?? '0.5')) || site.temperature);
        const maxTokens = parseInt(prompt('最大 Tokens：', String(site.maxTokens ?? '8000')) || site.maxTokens);
        const modelsCsv = prompt('可用模型（逗号分隔）：', Array.isArray(site.availableModels) ? site.availableModels.join(',') : '') || '';
        const availableModels = modelsCsv ? modelsCsv.split(',').map(s => s.trim()).filter(Boolean) : [];

        const payload = { displayName, apiBaseUrl, requestFormat, temperature, maxTokens, availableModels };
        await axios.put(`${API_BASE}/admin/source-sites/${id}`, payload, { headers: { Authorization: `Bearer ${authToken}` } });
        await loadSourceSites();
        alert('已保存');
    } catch (e) {
        alert('保存失败：' + (e.response?.data?.error || e.message));
    }
}

async function deleteSourceSite(id) {
    if (!confirm('确定要删除该源站？')) return;
    try {
        await axios.delete(`${API_BASE}/admin/source-sites/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
        await loadSourceSites();
        alert('已删除');
    } catch (e) {
        alert('删除失败：' + (e.response?.data?.error || e.message));
    }
}

// 暴露到全局（index.html 的按钮会调用）
window.addSourceSite = addSourceSite;
window.editSourceSite = editSourceSite;
window.deleteSourceSite = deleteSourceSite;

// 导入/导出源站点 JSON
async function importSourceSites(data) {
    // 支持对象或数组格式
    let items = [];
    if (Array.isArray(data)) {
        items = data;
    } else if (data && typeof data === 'object') {
        // 兼容 { items: [...] } 或 { customSourceSites: {...} }
        if (Array.isArray(data.items)) {
            items = data.items;
        } else if (Array.isArray(data.customSourceSites)) {
            items = data.customSourceSites;
        } else if (data.customSourceSites && typeof data.customSourceSites === 'object') {
            // 对象转数组
            items = Object.values(data.customSourceSites);
        } else {
            items = Object.values(data);
        }
    }
    if (!Array.isArray(items)) throw new Error('无效的导入格式');

    // 逐条创建（后端已做校验/截断）
    for (const raw of items) {
        const payload = normalizeSitePayload(raw);
        if (!payload) continue;
        try {
            await axios.post(`${API_BASE}/admin/source-sites`, payload, { headers: { Authorization: `Bearer ${authToken}` } });
        } catch (e) {
            console.warn('Skip one item due to error:', e.response?.data || e.message);
        }
    }
}

function normalizeSitePayload(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const displayName = raw.displayName || raw.name || '';
    const apiBaseUrl = raw.apiBaseUrl || raw.baseUrl || raw.endpoint || '';
    if (!displayName || !apiBaseUrl) return null;
    const requestFormat = raw.requestFormat || 'openai';
    const temperature = Number.isFinite(raw.temperature) ? Number(raw.temperature) : 0.5;
    const maxTokens = Number.isFinite(raw.maxTokens) ? Number(raw.maxTokens) : 8000;
    const availableModels = Array.isArray(raw.availableModels) ? raw.availableModels : [];
    return { displayName, apiBaseUrl, requestFormat, temperature, maxTokens, availableModels };
}

async function exportSourceSites() {
    try {
        const resp = await axios.get(`${API_BASE}/admin/source-sites`, { headers: { Authorization: `Bearer ${authToken}` } });
        const items = resp.data || [];
        const blob = new Blob([JSON.stringify({ items }, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `source-sites-${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('Export failed:', e);
        alert('导出失败：' + (e.response?.data?.error || e.message));
    }
}

function renderEffectiveProxySettings(d) {
    const containerId = 'effectiveProxySettings';
    let container = document.getElementById(containerId);
    if (!container) {
        const sys = document.getElementById('content-system');
        if (!sys) return;
        container = document.createElement('div');
        container.id = containerId;
        container.className = 'mt-6 bg-gray-50 border rounded-md p-4';
        sys.appendChild(container);
    }
    try {
        const sources = d?.sources || {};
        const eff = d?.effective || {};
        const nl = arr => Array.isArray(arr) && arr.length ? arr.map(x => `<code class="px-1 py-0.5 bg-white border rounded">${escapeHtml(String(x))}</code>`).join(' ') : '<span class="text-gray-400">(空)</span>';
        container.innerHTML = `
            <h4 class="text-sm font-medium text-gray-800 mb-2">当前生效的代理设置（合并 + 来源）</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div class="bg-white rounded border p-3">
                    <div class="font-medium text-gray-700 mb-1">合并后白名单</div>
                    <div class="space-x-1">${nl(eff.whitelist)}</div>
                </div>
                <div class="bg-white rounded border p-3">
                    <div class="font-medium text-gray-700 mb-1">开关与限制</div>
                    <div class="text-gray-600">允许 HTTP：${eff.allowHttp ? '是' : '否'}</div>
                    <div class="text-gray-600">上游超时：${eff.timeoutMs} ms</div>
                    <div class="text-gray-600">下载上限：${Math.round((eff.maxDownloadBytes||0)/1024/1024)} MB</div>
                </div>
                <div class="bg-white rounded border p-3 md:col-span-2">
                    <div class="font-medium text-gray-700 mb-1">来源拆解</div>
                    <div class="mt-1"><span class="text-gray-600">默认域：</span>${nl(sources.defaults)}</div>
                    <div class="mt-1"><span class="text-gray-600">手动白名单：</span>${nl(sources.manualWhitelist)}</div>
                    <div class="mt-1"><span class="text-gray-600">Workers 域：</span>${nl(sources.workerDomains)}</div>
                    <div class="mt-1"><span class="text-gray-600">自定义源站域：</span>${nl(sources.customSiteDomains)}</div>
                </div>
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<div class="text-sm text-red-600">无法渲染有效配置：${e.message}</div>`;
    }
}

async function refreshEffectiveProxySettings() {
    try {
        const eff = await axios.get(`${API_BASE}/admin/proxy-settings/effective`, { headers: { Authorization: `Bearer ${authToken}` } });
        renderEffectiveProxySettings(eff.data);
    } catch (e) {
        alert('刷新失败：' + (e.response?.data?.error || e.message));
    }
}

window.refreshEffectiveProxySettings = refreshEffectiveProxySettings;

async function applyProxySettingsNow() {
    try {
        await axios.post(`${API_BASE}/admin/proxy-settings/apply-now`, {}, { headers: { Authorization: `Bearer ${authToken}` } });
        await refreshEffectiveProxySettings();
        alert('已立即应用配置（缓存清空）');
    } catch (e) {
        alert('操作失败：' + (e.response?.data?.error || e.message));
    }
}

async function clearProxyDomains() {
    if (!confirm('确定清空“代理白名单域（手动）”与“Workers 代理域”吗？')) return;
    try {
        const entries = [
            { key: 'PROXY_WHITELIST_DOMAINS', value: '' },
            { key: 'WORKER_PROXY_DOMAINS', value: '' },
        ];
        for (const item of entries) {
            await axios.put(`${API_BASE}/admin/config`, item, { headers: { Authorization: `Bearer ${authToken}` } });
        }
        await applyProxySettingsNow();
        // 同步表单显示
        setInputValue('proxyWhitelistDomains', '');
        setInputValue('workerProxyDomains', '');
    } catch (e) {
        alert('清空失败：' + (e.response?.data?.error || e.message));
    }
}

window.applyProxySettingsNow = applyProxySettingsNow;
window.clearProxyDomains = clearProxyDomains;
