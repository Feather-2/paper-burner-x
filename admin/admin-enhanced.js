// Paper Burner X - 管理员面板增强功能
// 包含：配额管理、详细统计、趋势图表、活动日志

// ==================== 详细统计 ====================

async function loadDetailedStats() {
    try {
        const response = await axios.get(`${API_BASE}/admin/stats/detailed`, {
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
        const response = await axios.get(`${API_BASE}/admin/stats/trends?days=30`, {
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

// ==================== 配额管理 ====================

async function populateUserSelect() {
    try {
        const response = await axios.get(`${API_BASE}/admin/users`, {
            headers: { Authorization: `Bearer ${authToken}` }
        });

        const users = response.data;

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

    // 根据标签页加载数据
    if (tab === 'overview') {
        loadDetailedStats();
        loadTrendsChart();
    } else if (tab === 'quotas') {
        populateUserSelect();
    } else if (tab === 'activity') {
        populateUserSelect();
    }
}

// ==================== 初始化增强 ====================

// 扩展原有的 showAdminPanel 函数
const originalShowAdminPanel = window.showAdminPanel;
window.showAdminPanel = async function(user) {
    if (originalShowAdminPanel) {
        await originalShowAdminPanel(user);
    }

    // 加载详细统计
    await loadDetailedStats();

    // 如果在概览标签，加载趋势图
    const currentTab = document.querySelector('.tab-button.border-blue-500')?.id;
    if (currentTab === 'tab-overview') {
        await loadTrendsChart();
    }
};

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', function() {
    console.log('Admin panel enhancements loaded');
});
