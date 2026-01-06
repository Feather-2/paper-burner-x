/**
 * @file js/ui/components/notification.js
 * @description 通知组件 - ESM 模块化
 */

/**
 * 通知类型
 */
export const NotificationType = {
  SUCCESS: 'success',
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
};

/**
 * 默认配置
 */
const defaultConfig = {
  duration: 3000,
  position: 'top-right',
  maxVisible: 5,
  containerClass: 'notification-container'
};

let config = { ...defaultConfig };
let container = null;
let activeNotifications = [];

/**
 * 初始化通知容器
 */
function ensureContainer() {
  if (container && document.body.contains(container)) return container;

  container = document.createElement('div');
  container.className = config.containerClass;
  container.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: 10px;
    pointer-events: none;
  `;
  document.body.appendChild(container);
  return container;
}

/**
 * 创建通知元素
 */
function createNotificationElement(message, type, options = {}) {
  const el = document.createElement('div');
  el.className = `notification notification-${type}`;
  el.style.cssText = `
    padding: 12px 16px;
    border-radius: 8px;
    background: ${getBackgroundColor(type)};
    color: ${getTextColor(type)};
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    pointer-events: auto;
    cursor: pointer;
    max-width: 350px;
    word-wrap: break-word;
    animation: slideIn 0.3s ease-out;
    transition: opacity 0.3s, transform 0.3s;
  `;

  el.innerHTML = `
    <div style="display: flex; align-items: flex-start; gap: 10px;">
      <span style="flex-shrink: 0;">${getIcon(type)}</span>
      <span style="flex: 1;">${escapeHtml(message)}</span>
    </div>
  `;

  el.addEventListener('click', () => {
    dismissNotification(el);
  });

  return el;
}

/**
 * 获取背景色
 */
function getBackgroundColor(type) {
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    warning: '#f59e0b',
    info: '#3b82f6'
  };
  return colors[type] || colors.info;
}

/**
 * 获取文本色
 */
function getTextColor(type) {
  return '#ffffff';
}

/**
 * 获取图标
 */
function getIcon(type) {
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  return icons[type] || icons.info;
}

/**
 * 简单 HTML 转义
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 关闭通知
 */
function dismissNotification(el) {
  el.style.opacity = '0';
  el.style.transform = 'translateX(100%)';
  setTimeout(() => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
    activeNotifications = activeNotifications.filter(n => n !== el);
  }, 300);
}

/**
 * 显示通知
 * @param {string} message - 消息内容
 * @param {string} [type='info'] - 通知类型
 * @param {number} [duration] - 显示时长（毫秒）
 * @returns {HTMLElement} 通知元素
 */
export function showNotification(message, type = 'info', duration = config.duration) {
  const container = ensureContainer();

  // 限制最大可见数量
  while (activeNotifications.length >= config.maxVisible) {
    const oldest = activeNotifications.shift();
    if (oldest && oldest.parentNode) {
      oldest.parentNode.removeChild(oldest);
    }
  }

  const el = createNotificationElement(message, type);
  container.appendChild(el);
  activeNotifications.push(el);

  // 自动关闭
  if (duration > 0) {
    setTimeout(() => {
      dismissNotification(el);
    }, duration);
  }

  return el;
}

/**
 * 便捷方法
 */
export const notify = {
  success: (msg, duration) => showNotification(msg, 'success', duration),
  error: (msg, duration) => showNotification(msg, 'error', duration),
  warning: (msg, duration) => showNotification(msg, 'warning', duration),
  info: (msg, duration) => showNotification(msg, 'info', duration)
};

/**
 * 配置通知系统
 */
export function configure(newConfig) {
  config = { ...config, ...newConfig };
}

/**
 * 清除所有通知
 */
export function clearAll() {
  activeNotifications.forEach(el => {
    if (el.parentNode) {
      el.parentNode.removeChild(el);
    }
  });
  activeNotifications = [];
}

// 兼容层：暴露到 window
if (typeof window !== 'undefined') {
  window.showNotification = showNotification;
}

// 默认导出
export default {
  show: showNotification,
  success: notify.success,
  error: notify.error,
  warning: notify.warning,
  info: notify.info,
  configure,
  clearAll,
  NotificationType
};
