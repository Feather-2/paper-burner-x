// Admin Quotas Module (ESM)
// Depends on globals: axios, window.API_BASE, window.authToken

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function populateQuotaUserSelect() {
  try {
    const resp = await axios.get(`${window.API_BASE}/admin/users`, {
      headers: { Authorization: `Bearer ${window.authToken}` }
    });
    const payload = resp.data || {};
    const users = Array.isArray(payload.items) ? payload.items : [];
    const quotaSelect = document.getElementById('quotaUserId');
    if (quotaSelect) {
      quotaSelect.innerHTML = '<option value="">请选择用户...</option>' +
        users.map(u => `<option value="${u.id}">${escapeHtml(u.email)} - ${escapeHtml(u.name || '未设置姓名')}</option>`).join('');
    }
  } catch (e) {
    console.error('Failed to load users for quota:', e);
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
  if (percentage > 90) { bar.classList.remove('bg-blue-600','bg-yellow-600'); bar.classList.add('bg-red-600'); }
  else if (percentage > 70) { bar.classList.remove('bg-blue-600','bg-red-600'); bar.classList.add('bg-yellow-600'); }
  else { bar.classList.remove('bg-red-600','bg-yellow-600'); bar.classList.add('bg-blue-600'); }
}

async function loadUserQuota() {
  const userId = document.getElementById('quotaUserId')?.value;
  if (!userId) {
    document.getElementById('quotaForm')?.classList.add('hidden');
    return;
  }
  try {
    const res = await axios.get(`${window.API_BASE}/admin/users/${userId}/quota`, { headers: { Authorization: `Bearer ${window.authToken}` } });
    const quota = res.data || {};
    document.getElementById('quotaForm')?.classList.remove('hidden');
    document.getElementById('maxDocumentsPerDay').value = quota.maxDocumentsPerDay;
    document.getElementById('maxDocumentsPerMonth').value = quota.maxDocumentsPerMonth;
    document.getElementById('maxStorageSize').value = quota.maxStorageSize;
    document.getElementById('maxApiKeysCount').value = quota.maxApiKeysCount;
    document.getElementById('documentsThisMonthQuota').textContent = quota.documentsThisMonth;
    document.getElementById('currentStorageUsed').textContent = quota.currentStorageUsed;
    updateProgressBar('documentsProgressBar', quota.documentsThisMonth, quota.maxDocumentsPerMonth);
    updateProgressBar('storageProgressBar', quota.currentStorageUsed, quota.maxStorageSize);
  } catch (e) {
    console.error('Failed to load quota:', e);
    alert('加载配额失败：' + (e.response?.data?.error || e.message));
  }
}

async function saveUserQuota() {
  const userId = document.getElementById('quotaUserId')?.value;
  if (!userId) return alert('请先选择用户');
  const payload = {
    maxDocumentsPerDay: parseInt(document.getElementById('maxDocumentsPerDay').value),
    maxDocumentsPerMonth: parseInt(document.getElementById('maxDocumentsPerMonth').value),
    maxStorageSize: parseInt(document.getElementById('maxStorageSize').value),
    maxApiKeysCount: parseInt(document.getElementById('maxApiKeysCount').value),
  };
  try {
    await axios.put(`${window.API_BASE}/admin/users/${userId}/quota`, payload, { headers: { Authorization: `Bearer ${window.authToken}` } });
    alert('配额保存成功！');
    await loadUserQuota();
  } catch (e) {
    console.error('Failed to save quota:', e);
    alert('保存配额失败：' + (e.response?.data?.error || e.message));
  }
}

async function resetUserQuota() {
  const userId = document.getElementById('quotaUserId')?.value;
  if (!userId) return alert('请先选择用户');
  if (!confirm('确定要重置该用户的使用量吗？')) return;
  try {
    await axios.put(`${window.API_BASE}/admin/users/${userId}/quota`, { documentsThisMonth: 0, currentStorageUsed: 0, lastMonthlyReset: new Date().toISOString() }, { headers: { Authorization: `Bearer ${window.authToken}` } });
    alert('使用量已重置！');
    await loadUserQuota();
  } catch (e) {
    console.error('Failed to reset quota:', e);
    alert('重置失败：' + (e.response?.data?.error || e.message));
  }
}

export async function initQuotas() {
  await populateQuotaUserSelect();
  // 兼容现有 onclick
  window.loadUserQuota = loadUserQuota;
  window.saveUserQuota = saveUserQuota;
  window.resetUserQuota = resetUserQuota;
}
