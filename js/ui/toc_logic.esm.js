import './toc_logic.js';

export function refreshTocList(...args) {
  return globalThis.window?.refreshTocList?.(...args);
}

export function getCurrentTocStructure() {
  return globalThis.window?.getCurrentTocStructure?.() ?? null;
}

export function getTocNodes() {
  return globalThis.window?.getTocNodes?.() ?? [];
}

export default {
  refreshTocList,
  getCurrentTocStructure,
  getTocNodes
};

