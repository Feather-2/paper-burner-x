/**
 * PPT dashboard ESM entry.
 *
 * Loads legacy dashboard modules (which populate `window.PPTDashboard`) and
 * re-exports a stable ESM surface.
 */

import './vditor_adapter.js';
import './report-review-panel.js';
import './ppt_ui_flow_config.js';
import './ppt_dashboard_utils.js';
import './ppt_dashboard_upload.js';
import './ppt_dashboard_history.js';
import './ppt_dashboard_url_input.js';
import './ppt_dashboard_paste.js';
import './ppt_dashboard_modals.js';
import './ppt_dashboard_deepsearch.js';
import './ppt_dashboard_page_layout.js';
import './ppt_dashboard_design_spec.js';
import './ppt_dashboard_outline.js';
import './ppt_dashboard_core.js';

const root = (typeof window !== 'undefined') ? window : globalThis;

// Mirror key namespaces onto globalThis for Node/test shims where `window` is detached.
try {
  if (typeof globalThis !== 'undefined' && globalThis !== root) {
    if (root.PPTDashboard) globalThis.PPTDashboard = root.PPTDashboard;
    if (root.VditorAdapter) globalThis.VditorAdapter = root.VditorAdapter;
    if (root.ReportReviewPanel) globalThis.ReportReviewPanel = root.ReportReviewPanel;
  }
} catch {
  // ignore
}

export const PPTDashboard = root.PPTDashboard ?? globalThis.PPTDashboard;
export const VditorAdapter = root.VditorAdapter ?? globalThis.VditorAdapter;

// Re-export ESM-native helpers from this folder.
export { UIEventAdapter } from './ui-event-adapter.js';
export * from './deepsearch-flow-visualizer.js';

export default {
  PPTDashboard,
  VditorAdapter,
};

