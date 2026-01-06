import './ui-notifications.js';

export function showNotification(...args) {
  return globalThis.window?.showNotification?.(...args);
}

export function closeNotification(...args) {
  return globalThis.window?.closeNotification?.(...args);
}

export default {
  showNotification,
  closeNotification
};

