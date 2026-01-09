import './glossary-ui.js';

export function openGlossaryImportModal(...args) {
  return globalThis.window?.openGlossaryImportModal?.(...args);
}

export function openGlossaryExportModal(...args) {
  return globalThis.window?.openGlossaryExportModal?.(...args);
}

export default globalThis.window?.glossaryUI;

