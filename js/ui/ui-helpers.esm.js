import './ui-helpers.js';

const w = globalThis.window;

export const generateUUID = w?._generateUUID_ui;
export const escapeHtml = w?.escapeHtml;
export const escapeRegExp = w?.escapeRegExp;
export const highlightKeyword = w?.highlightKeyword;
export const buildSearchItemsFromSelect = w?.buildSearchItemsFromSelect;
export const formatFileSize = w?.formatFileSize;
export const getFileDisplayPath = w?.getFileDisplayPath;

export default {
  generateUUID,
  escapeHtml,
  escapeRegExp,
  highlightKeyword,
  buildSearchItemsFromSelect,
  formatFileSize,
  getFileDisplayPath
};

