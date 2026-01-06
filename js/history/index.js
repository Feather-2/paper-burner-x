/**
 * @file js/history/index.js
 * @description History 模块统一入口
 */

export {
  refreshSidebarHistory,
  deleteHistoryRecord,
  showHistoryDetail,
  downloadHistoryRecord,
  retryTranslateRecord
} from './history.js';

export {
  KATEX_CDN,
  EXPORT_LABELS,
  MODE_LABELS,
  BRAND_LINK,
  PBXHistoryExporter,
  preparePayload,
  exportAsHtml,
  exportAsMarkdown,
  exportAsDocx,
  exportAsPdf,
  resolveFileName,
  ensureFileExtension,
  sanitizeFileName,
  buildExportStyles,
  buildMainContent,
  formatTimestamp
} from './history_exporter.js';

import * as HistoryPanel from './history.js';
import * as HistoryExporter from './history_exporter.js';

export default {
  Panel: HistoryPanel,
  Exporter: HistoryExporter
};

