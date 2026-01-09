import './ui.js';

export function initUI(...args) {
  return globalThis.window?.initUI?.(...args);
}

export default {
  initUI
};

