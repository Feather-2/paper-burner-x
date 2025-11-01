// Admin Overview Statistics Module (ESM)
// Depends on globals: axios, Chart, window.API_BASE, window.authToken

let trendChartInstance = null;

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
    const response = await axios.get(`${window.API_BASE}/admin/stats/detailed${range}`, {
      headers: { Authorization: `Bearer ${window.authToken}` }
    });

    const stats = response.data;

    if (document.getElementById('documentsThisWeek')) {
      document.getElementById('documentsThisWeek').textContent = stats.basic.documentsThisWeek || '-';
    }
    if (document.getElementById('documentsThisMonth')) {
      document.getElementById('documentsThisMonth').textContent = stats.basic.documentsThisMonth || '-';
    }
    if (document.getElementById('totalStorageMB')) {
      document.getElementById('totalStorageMB').textContent = (stats.basic.totalStorageMB || 0) + ' MB';
    }

    displayDocumentsByStatus(stats.documentsByStatus || []);
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

  const escapeHtml = (text) => {
    if (!text) return '-';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

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

async function loadTrendsChart() {
  try {
    const s = document.getElementById('statsStartDate')?.value;
    const e = document.getElementById('statsEndDate')?.value;
    let url = `${window.API_BASE}/admin/stats/trends?days=30`;
    if (s || e) {
      const params = new URLSearchParams();
      if (s) params.set('startDate', s);
      if (e) params.set('endDate', e);
      url = `${window.API_BASE}/admin/stats/trends?${params.toString()}`;
    }
    const response = await axios.get(url, { headers: { Authorization: `Bearer ${window.authToken}` } });
    const trends = response.data;

    const ctx = document.getElementById('trendChart');
    if (!ctx) return;
    if (trendChartInstance) trendChartInstance.destroy();

    trendChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: trends.map(t => {
          const date = new Date(t.date);
          return `${date.getMonth() + 1}/${date.getDate()}`;
        }),
        datasets: [
          { label: '总处理量', data: trends.map(t => t.total), borderColor: 'rgb(59, 130, 246)', backgroundColor: 'rgba(59, 130, 246, 0.1)', tension: 0.4 },
          { label: '成功', data: trends.map(t => t.completed), borderColor: 'rgb(34, 197, 94)', backgroundColor: 'rgba(34, 197, 94, 0.1)', tension: 0.4 },
          { label: '失败', data: trends.map(t => t.failed), borderColor: 'rgb(239, 68, 68)', backgroundColor: 'rgba(239, 68, 68, 0.1)', tension: 0.4 },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', intersect: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  } catch (error) {
    console.error('Failed to load trends chart:', error);
  }
}

async function applyStatsRange() {
  await loadDetailedStats();
  await loadTrendsChart();
}

async function clearStatsRange() {
  const s = document.getElementById('statsStartDate');
  const e = document.getElementById('statsEndDate');
  if (s) s.value = '';
  if (e) e.value = '';
  await applyStatsRange();
}

export async function initStats() {
  // 挂到 window 以兼容现有 onclick
  window.applyStatsRange = applyStatsRange;
  window.clearStatsRange = clearStatsRange;
  await loadDetailedStats();
  await loadTrendsChart();
}
