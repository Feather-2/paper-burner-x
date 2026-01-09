/**
 * @file js/ui/components/index.js
 * @description UI 组件统一导出
 */

export {
  showNotification,
  notify,
  configure as configureNotifications,
  clearAll as clearAllNotifications,
  NotificationType
} from './notification.js';

export {
  createProgressBar,
  createLabeledProgressBar,
  createFileProgressBar
} from './progress-bar.js';

export {
  createModal,
  confirm,
  alert,
  getOpenCount as getModalCount,
  closeAll as closeAllModals
} from './modal.js';
