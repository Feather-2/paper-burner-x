// Admin Activity Module (ESM)
// Depends on globals: axios, window.API_BASE, window.authToken

function escapeHtml(text) {
  if (!text) return '-';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function populateActivityUserSelect() {
  try {
    const resp = await axios.get(`${window.API_BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${window.authToken}` }
    });
    const payload = resp.data || {};
    const users = Array.isArray(payload.items) ? payload.items : [];
    const activitySelect = document.getElementById('activityUserId');
    if (activitySelect) {
      activitySelect.innerHTML = '<option value="">请选择用户...</option>' +
        users.map(u => `<option value="${u.id}">${escapeHtml(u.email)} - ${escapeHtml(u.name || '未设置姓名')}</option>`).join('');
    }
  } catch (e) {
    console.error('Failed to load users for activity:', e);
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
  if (obj.fileName) parts.push(`文件: ${escapeHtml(obj.fileName)}`);
  if (obj.fileType) parts.push(`类型: ${escapeHtml(obj.fileType)}`);
  return parts.length > 0 ? parts.join(', ') : escapeHtml(JSON.stringify(obj).substring(0, 50));
}

async function loadUserActivity() {
  const userId = document.getElementById('activityUserId')?.value;
  const limit = document.getElementById('activityLimit')?.value || '50';
  const tbody = document.getElementById('activityLogsList');
  if (!tbody) return;

  if (!userId) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="px-6 py-4 text-center text-gray-500">请选择用户查看活动日志</td>
      </tr>`;
    return;
  }

  try {
    const resp = await axios.get(`${window.API_BASE}/admin/users/${userId}/activity?limit=${limit}`, {
      headers: { Authorization: `Bearer ${window.authToken}` }
    });
    const logs = resp.data || [];
    if (!logs.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="px-6 py-4 text-center text-gray-500">该用户暂无活动记录</td>
        </tr>`;
      return;
    }
    tbody.innerHTML = logs.map(log => `
      <tr>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${new Date(log.createdAt).toLocaleString('zh-CN')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm">
          <span class="px-2 py-1 text-xs font-medium rounded-full ${getActionBadgeClass(log.action)}">${formatActionName(log.action)}</span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-500">${log.resourceId ? escapeHtml(String(log.resourceId).substring(0,8)) + '...' : '-'}</td>
        <td class="px-6 py-4 text-sm text-gray-500">${formatMetadata(log.metadata)}</td>
      </tr>`).join('');
  } catch (e) {
    console.error('Failed to load activity logs:', e);
    tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-4 text-center text-red-500">加载失败：${escapeHtml(e.message||'')}</td></tr>`;
  }
}

export async function initActivity() {
  await populateActivityUserSelect();
  // 兼容现有 onclick
  window.loadUserActivity = loadUserActivity;
}
