import './toc_logic_enhanced.js';

export const EnhancedTocFeature = globalThis.window?.EnhancedTocFeature;

export function refreshTocList(...args) {
  return globalThis.window?.refreshTocList?.(...args);
}

export default EnhancedTocFeature;

