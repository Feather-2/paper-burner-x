/**
 * UI V2 utility helpers
 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function escapeAttr(value) {
  return escapeHtml(value).replaceAll('\n', ' ').replaceAll('\r', ' ');
}

export function getFileIcon(type) {
  const icons = {
    'history': 'solar:history-bold-duotone',
    'history-report': 'solar:notebook-bold-duotone',
    'history-source': 'solar:database-bold-duotone',
    'history-checkpoint': 'solar:folder-check-bold-duotone',
    'history-document': 'solar:document-text-bold-duotone',
    'url': 'solar:link-circle-bold-duotone',
    'pdf': 'solar:file-bold-duotone',
  };
  return icons[type] || 'solar:document-bold-duotone';
}
