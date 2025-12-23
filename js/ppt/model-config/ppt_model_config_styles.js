/**
 * PPT 模型配置 - 样式
 * IIFE module: window.PPTModelConfig.styles
 */
(function(global) {
  'use strict';

  global.PPTModelConfig = global.PPTModelConfig || {};
  const ns = global.PPTModelConfig;
  ns.styles = ns.styles || {};

  function getStyles() {
    return `
      /* Tabs */
      .pmc-tabs-nav {
        display: flex; gap: 8px;
        padding: 12px 16px;
        background: #fff;
        border-bottom: 1px solid var(--pmc-border);
      }
      .pmc-tab-btn {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 10px 12px;
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 10px;
        color: #334155;
        font-size: 13px;
        cursor: pointer;
        transition: all 0.15s;
      }
      .pmc-tab-btn:hover { border-color: #cbd5e1; background: #f8fafc; }
      .pmc-tab-btn.active {
        border-color: rgba(99, 102, 241, 0.5);
        background: rgba(99, 102, 241, 0.08);
        color: #312e81;
      }
      .pmc-tab-btn iconify-icon { pointer-events: none; }

      .pmc-tabs-content {
        padding: 16px;
      }
      .pmc-tab-panel { display: none; }
      .pmc-tab-panel.active { display: block; }

      /* Tab Layout Helpers */
      .pmc-tab-layout {
        display: grid;
        grid-template-columns: 360px 1fr;
        gap: 16px;
        align-items: start;
      }
      .pmc-tab-layout.pmc-tab-layout-60-40 {
        grid-template-columns: 3fr 2fr;
      }
      .pmc-tab-left, .pmc-tab-right {
        background: #fff;
        border: 1px solid var(--pmc-border);
        border-radius: 12px;
        padding: 16px;
        min-height: 400px;
        max-height: 65vh;
        overflow-y: auto;
      }
      .pmc-panel-title {
        display: flex; align-items: center; gap: 8px;
        font-size: 14px; font-weight: 700; color: var(--pmc-text-main);
        margin-bottom: 12px;
      }
      .pmc-panel-subtitle {
        margin-left: auto;
        font-size: 12px;
        font-weight: 500;
        color: #94a3b8;
      }
      .pmc-subheading {
        font-size: 12px;
        font-weight: 700;
        color: #334155;
        margin: 2px 0 10px 0;
      }
      .pmc-helper-text {
        font-size: 12px;
        color: var(--pmc-text-sub);
        margin-top: 12px;
        line-height: 1.5;
      }
      .pmc-empty {
        padding: 12px;
        font-size: 12px;
        color: #94a3b8;
        text-align: center;
        background: #f8fafc;
        border: 1px dashed #e2e8f0;
        border-radius: 10px;
      }

      .pmc-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 52vh;
        overflow: auto;
        padding-right: 4px;
      }
      .pmc-list-compact { max-height: 42vh; }

      /* Tab1: Source accordion + model list */
      .pmc-accordion {
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow: visible;
        padding-right: 4px;
      }
      .pmc-acc-item {
        border: 1px solid var(--pmc-border);
        border-radius: 12px;
        background: #fff;
        overflow: visible;
        min-height: 48px;
      }
      .pmc-acc-header {
        width: 100%;
        border: none;
        background: #fff;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        text-align: left;
        transition: all 0.15s;
        min-height: 48px;
      }
      .pmc-acc-header:hover { background: #f8fafc; }
      .pmc-acc-chevron { color: #94a3b8; transition: transform 0.15s; }
      .pmc-acc-chevron.open { transform: rotate(90deg); }
      .pmc-acc-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
      .pmc-acc-title-main { font-size: 14px; font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pmc-acc-title-sub { font-size: 12px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pmc-acc-meta { margin-left: auto; display: flex; align-items: center; gap: 8px; }
      .pmc-badge {
        font-size: 11px;
        font-weight: 700;
        color: #334155;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 999px;
        padding: 2px 8px;
        line-height: 16px;
      }
      .pmc-badge-muted { color: #94a3b8; background: #f8fafc; }
      .pmc-badge-primary { color: #312e81; background: rgba(99, 102, 241, 0.12); border-color: rgba(99, 102, 241, 0.35); }
      .pmc-acc-body {
        border-top: 1px solid var(--pmc-border);
        background: #fafbfc;
        padding: 14px 16px 16px;
      }
      .pmc-loading {
        font-size: 12px;
        color: #64748b;
        padding: 8px 10px;
        border: 1px dashed #e2e8f0;
        border-radius: 10px;
        background: #fff;
      }
      .pmc-model-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        overflow: visible;
        padding-right: 4px;
      }
      .pmc-model-item {
        width: 100%;
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 10px;
        padding: 12px 14px;
        cursor: pointer;
        text-align: left;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
        transition: all 0.15s;
      }
      .pmc-model-item:hover { background: #f8fafc; border-color: #cbd5e1; }
      .pmc-model-item.active { border-color: rgba(99, 102, 241, 0.55); background: rgba(99, 102, 241, 0.06); }
      .pmc-model-item-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .pmc-model-item-title { font-size: 14px; font-weight: 600; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pmc-model-item-sub { font-size: 12px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pmc-model-tags { display: flex; align-items: center; gap: 6px; flex-shrink: 0; color: #94a3b8; }
      .pmc-model-tags iconify-icon { opacity: 0.22; }
      .pmc-model-tags iconify-icon.on { opacity: 1; color: var(--pmc-primary); }

      /* Tab1: Tag icons (right panel) */
      .pmc-tags-icons {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      .pmc-tag-icon-btn {
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 14px;
        padding: 14px 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        color: #94a3b8;
        transition: all 0.15s;
      }
      .pmc-tag-icon-btn:hover { background: #f8fafc; border-color: #cbd5e1; color: #334155; }
      .pmc-tag-icon-btn.selected {
        color: var(--pmc-primary);
        border-color: rgba(99, 102, 241, 0.55);
        background: rgba(99, 102, 241, 0.10);
        box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.15);
      }
      .pmc-tag-icon-btn:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      .pmc-list-item {
        width: 100%;
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 10px;
        padding: 10px 10px;
        cursor: pointer;
        text-align: left;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        transition: all 0.15s;
      }
      .pmc-list-item:hover { background: #f8fafc; border-color: #cbd5e1; }
      .pmc-list-item.active { border-color: rgba(99, 102, 241, 0.55); background: rgba(99, 102, 241, 0.06); }
      .pmc-list-item-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .pmc-list-item-title { font-size: 13px; font-weight: 700; color: #0f172a; display:flex; align-items:center; gap:8px; }
      .pmc-list-item-sub { font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .pmc-list-item-meta { font-size: 11px; color: #64748b; flex: 0 0 auto; align-self: center; }

      .pmc-two-col {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .pmc-list-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        border: 1px solid var(--pmc-border);
        border-radius: 10px;
        padding: 10px;
        background: #fff;
      }
      .pmc-list-row-main { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
      .pmc-list-row-title { font-size: 12px; font-weight: 700; color: #0f172a; }
      .pmc-list-row-sub { font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      .pmc-btn-mini {
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 8px;
        font-size: 12px;
        padding: 6px 10px;
        cursor: pointer;
        display: inline-flex; align-items: center; gap: 6px;
        color: #334155;
        transition: all 0.15s;
        flex: 0 0 auto;
      }
      .pmc-btn-mini:hover { border-color: rgba(99, 102, 241, 0.55); color: #312e81; background: rgba(99, 102, 241, 0.06); }
      .pmc-btn-mini:disabled { cursor: not-allowed; opacity: 0.55; }
      .pmc-btn-mini iconify-icon { pointer-events: none; }

      .pmc-tags-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      /* Required: tag chips */
      .pmc-tag-chip {
        display: inline-flex; align-items: center; gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--pmc-border);
        border-radius: 999px;
        background: #fff;
        color: #334155;
        cursor: pointer;
        user-select: none;
        transition: all 0.15s;
      }
      .pmc-tag-chip input { display: none; }
      .pmc-tag-chip.selected {
        border-color: rgba(99, 102, 241, 0.55);
        background: rgba(99, 102, 241, 0.08);
        color: #312e81;
      }

      /* Required: drag items */
      .pmc-dnd-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-height: 180px;
        padding: 10px;
        border: 1px dashed #e2e8f0;
        border-radius: 12px;
        background: #f8fafc;
      }
      .pmc-drag-item {
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 12px;
        padding: 10px 10px;
        cursor: grab;
        display: grid;
        grid-template-columns: 1fr auto;
        grid-template-rows: auto auto;
        gap: 4px 10px;
        align-items: center;
      }
      .pmc-drag-item:active { cursor: grabbing; }
      .pmc-drag-item.dragging { opacity: 0.6; }
      .pmc-drag-item.drag-above { border-top: 2px solid var(--pmc-primary); }
      .pmc-drag-item.drag-below { border-bottom: 2px solid var(--pmc-primary); }
      .drag-above { border-top: 2px solid var(--pmc-primary) !important; }
      .drag-below { border-bottom: 2px solid var(--pmc-primary) !important; }
      .pmc-drag-item-title { font-size: 12px; font-weight: 700; color: #0f172a; grid-column: 1 / 2; }
      .pmc-drag-item-sub { font-size: 11px; color: #94a3b8; grid-column: 1 / 2; }
      .pmc-drag-item-remove {
        grid-column: 2 / 3;
        grid-row: 1 / 3;
        border: 1px solid var(--pmc-border);
        background: #fff;
        width: 36px; height: 36px;
        border-radius: 10px;
        cursor: pointer;
        color: #ef4444;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.15s;
      }
      .pmc-drag-item-remove:hover { background: #fef2f2; border-color: #fecaca; }
      .pmc-drag-item-remove iconify-icon { pointer-events: none; }

      /* Audio */
      .pmc-audio-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        align-items: start;
      }
      .pmc-audio-section {
        background: #fff;
        border: 1px solid var(--pmc-border);
        border-radius: 12px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .pmc-audio-actions {
        grid-column: 1 / -1;
      }

      /* Role Overview */
      .pmc-role-overview {
        background: #fff;
        border: 1px solid var(--pmc-border);
        border-radius: 16px;
        padding: 16px;
        margin-bottom: 16px;
      }
      .pmc-role-overview-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 700;
        color: var(--pmc-text-main);
        margin-bottom: 16px;
      }
      .pmc-role-group {
        margin-bottom: 16px;
      }
      .pmc-role-group:last-child {
        margin-bottom: 0;
      }
      .pmc-role-group-header {
        font-size: 12px;
        font-weight: 600;
        color: #64748b;
        margin-bottom: 10px;
        padding-left: 4px;
      }
      .pmc-role-columns {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .pmc-role-column {
        flex: 1 1 150px;
        min-width: 0;
        background: #f8fafc;
        border: 1px solid var(--pmc-border);
        border-radius: 12px;
        overflow: hidden;
      }
      .pmc-role-column-header {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 12px;
        background: #fff;
        border-bottom: 1px solid var(--pmc-border);
        font-size: 13px;
        font-weight: 600;
        color: var(--pmc-text-main);
      }
      .pmc-role-column-title {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
      }
      .pmc-role-column-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pmc-role-column-count {
        color: #94a3b8;
        font-size: 12px;
        font-weight: 500;
        flex-shrink: 0;
      }
      .pmc-role-config-btn {
        width: 26px;
        height: 26px;
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 6px;
        cursor: pointer;
        color: #94a3b8;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
        flex-shrink: 0;
      }
      .pmc-role-config-btn:hover {
        border-color: var(--pmc-primary);
        color: var(--pmc-primary);
        background: rgba(99, 102, 241, 0.06);
      }
      .pmc-role-column-list {
        padding: 8px;
        min-height: 60px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .pmc-role-column-empty {
        padding: 12px 8px;
        text-align: center;
        font-size: 11px;
        color: #94a3b8;
        cursor: pointer;
        border: 1px dashed #e2e8f0;
        border-radius: 8px;
        transition: all 0.15s;
      }
      .pmc-role-column-empty:hover {
        border-color: var(--pmc-primary);
        color: var(--pmc-primary);
        background: rgba(99, 102, 241, 0.04);
      }
      .pmc-role-column-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        background: #fff;
        border: 1px solid var(--pmc-border);
        border-radius: 8px;
        font-size: 11px;
        cursor: grab;
      }
      .pmc-role-column-item:active { cursor: grabbing; }
      .pmc-role-column-item .priority-num {
        color: var(--pmc-primary);
        font-weight: 700;
        flex-shrink: 0;
      }
      .pmc-role-column-item .model-name {
        color: #334155;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1;
        min-width: 0;
      }
      .pmc-role-column-item .remove-btn {
        width: 20px;
        height: 20px;
        border: none;
        background: transparent;
        border-radius: 4px;
        cursor: pointer;
        color: #94a3b8;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
        flex-shrink: 0;
        opacity: 0;
      }
      .pmc-role-column-item:hover .remove-btn { opacity: 1; }
      .pmc-role-column-item .remove-btn:hover {
        color: #ef4444;
        background: #fef2f2;
      }

      /* Hotspare Config Popup */
      .pmc-hotspare-list {
        display: flex;
        flex-direction: column;
      }
      .pmc-hotspare-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid #f1f5f9;
        background: #fff;
        transition: background 0.15s;
      }
      .pmc-hotspare-item:last-child { border-bottom: none; }
      .pmc-hotspare-item:hover { background: #f8fafc; }
      .pmc-hotspare-item-drag {
        color: #cbd5e1;
        cursor: grab;
        flex-shrink: 0;
      }
      .pmc-hotspare-item-drag:active { cursor: grabbing; }
      .pmc-hotspare-item-num {
        width: 24px;
        height: 24px;
        border-radius: 6px;
        background: rgba(99, 102, 241, 0.1);
        color: var(--pmc-primary);
        font-size: 12px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .pmc-hotspare-item-info {
        flex: 1;
        min-width: 0;
      }
      .pmc-hotspare-item-name {
        font-size: 14px;
        font-weight: 600;
        color: #0f172a;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pmc-hotspare-item-source {
        font-size: 12px;
        color: #94a3b8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .pmc-hotspare-item-remove {
        width: 32px;
        height: 32px;
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 8px;
        cursor: pointer;
        color: #94a3b8;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
        flex-shrink: 0;
      }
      .pmc-hotspare-item-remove:hover {
        color: #ef4444;
        background: #fef2f2;
        border-color: #fecaca;
      }

      /* Capability Button */
      .pmc-cap-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border: 1px solid var(--pmc-border);
        border-radius: 10px;
        background: #fff;
        cursor: pointer;
        color: #64748b;
        transition: all 0.15s;
      }
      .pmc-cap-btn:hover {
        border-color: #cbd5e1;
        background: #f8fafc;
        color: #334155;
      }
      .pmc-cap-btn.selected {
        border-color: rgba(99, 102, 241, 0.5);
        background: rgba(99, 102, 241, 0.08);
        color: var(--pmc-primary);
      }

      /* Role Assign List */
      .pmc-role-assign-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 10px;
      }
      .pmc-role-assign-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid var(--pmc-border);
        border-radius: 10px;
        background: #fff;
      }
      .pmc-role-assign-item label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #334155;
        cursor: pointer;
      }
      .pmc-role-assign-item .pmc-role-check {
        accent-color: var(--pmc-primary);
      }
      .pmc-role-assign-item .pmc-role-priority {
        width: 50px;
        padding: 6px 8px;
        border: 1px solid var(--pmc-border);
        border-radius: 6px;
        font-size: 13px;
        text-align: center;
      }
      .pmc-role-assign-item .pmc-role-priority:disabled {
        background: #f1f5f9;
        color: #94a3b8;
      }

      /* Audio Collapse */
      .pmc-audio-collapse {
        margin: 0 16px 16px;
        border: 1px solid var(--pmc-border);
        border-radius: 12px;
        background: #fff;
        overflow: hidden;
      }
      .pmc-audio-collapse-header {
        width: 100%;
        padding: 14px 16px;
        border: none;
        background: #fff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 14px;
        font-weight: 600;
        color: var(--pmc-text-main);
        transition: background 0.15s;
      }
      .pmc-audio-collapse-header:hover {
        background: #f8fafc;
      }
      .pmc-audio-collapse-chevron {
        color: #94a3b8;
        transition: transform 0.2s;
      }
      .pmc-audio-collapse-body {
        display: none;
        padding: 16px;
        border-top: 1px solid var(--pmc-border);
        background: #fafbfc;
      }
      .pmc-audio-collapse.open .pmc-audio-collapse-body {
        display: block;
      }

      @media (max-width: 1024px) {
        .pmc-tab-layout { grid-template-columns: 1fr; }
        .pmc-two-col { grid-template-columns: 1fr; }
        .pmc-audio-grid { grid-template-columns: 1fr; }
        .pmc-list { max-height: 40vh; }
        .pmc-accordion { max-height: 40vh; }
        .pmc-role-columns { gap: 8px; }
        .pmc-role-column { flex: 1 1 120px; }
        .pmc-role-assign-list { grid-template-columns: 1fr; }
      }
    `;
  }

  function getInjectedCss() {
    return `
      :root {
        --pmc-primary: #6366f1;
        --pmc-primary-hover: #4f46e5;
        --pmc-bg: #f8fafc;
        --pmc-text-main: #0f172a;
        --pmc-text-sub: #64748b;
        --pmc-border: #e2e8f0;
        --pmc-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        --pmc-radius: 12px;
      }

      .pmc-modal-overlay {
        position: fixed; inset: 0; z-index: 70;
        display: none; align-items: center; justify-content: center;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .pmc-overlay-bg {
        position: absolute; inset: 0;
        background: rgba(15, 23, 42, 0.5);
        backdrop-filter: blur(4px);
      }

      .pmc-modal-container {
        position: relative; z-index: 1;
        width: 95vw; max-width: 1200px; height: auto; max-height: 90vh;
        background: #fff;
        border-radius: var(--pmc-radius);
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        display: flex; flex-direction: column;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.1);
      }

      /* Header */
      .pmc-header {
        padding: 20px 24px;
        background: #fff;
        border-bottom: 1px solid var(--pmc-border);
        display: flex; justify-content: space-between; align-items: flex-start;
      }

      .pmc-header-left {
        display: flex; align-items: center; gap: 16px;
      }

      .pmc-header-icon {
        width: 48px; height: 48px;
        border-radius: 12px;
        background: linear-gradient(135deg, #e0e7ff 0%, #eef2ff 100%);
        color: var(--pmc-primary);
        display: flex; align-items: center; justify-content: center;
        box-shadow: inset 0 0 0 1px rgba(99, 102, 241, 0.1);
      }

      .pmc-title {
        font-size: 18px; font-weight: 700; color: var(--pmc-text-main);
        line-height: 1.2; margin-bottom: 4px;
      }

      .pmc-subtitle {
        font-size: 13px; color: var(--pmc-text-sub);
      }

      .pmc-close-btn {
        width: 32px; height: 32px;
        border-radius: 8px; border: none; background: transparent;
        color: #94a3b8; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.2s;
      }
      .pmc-close-btn:hover { background: #f1f5f9; color: #ef4444; }

      /* Body */
      .pmc-scroll-content {
        flex: 1; overflow-y: auto; overflow-x: hidden;
        background: #f8fafc;
        display: flex; flex-direction: column;
        min-height: 0; /* 确保 flex 子元素可以收缩并触发滚动 */
      }

      .pmc-body {
        display: flex; flex-direction: column;
        flex-shrink: 0;
        background: #f8fafc;
        overflow: visible; /* 确保下拉菜单不被裁剪 */
      }

      .pmc-col {
        padding: 24px;
        border-right: 1px solid var(--pmc-border);
        background: #fff;
        display: flex; flex-direction: column; gap: 20px;
        overflow: visible; /* 确保下拉菜单不被裁剪 */
      }
      .pmc-col:last-child { border-right: none; }
      .pmc-col:nth-child(even) { background: #fafbfc; }

      .pmc-section-header {
        display: flex; align-items: center; gap: 10px;
      }

      .pmc-section-icon {
        width: 36px; height: 36px;
        border-radius: 10px;
        background: #f1f5f9;
        display: flex; align-items: center; justify-content: center;
      }
      .text-indigo { color: #6366f1; background: #e0e7ff; }
      .text-purple { color: #a855f7; background: #f3e8ff; }
      .text-cyan { color: #06b6d4; background: #cffafe; }

      .pmc-section-title {
        font-size: 16px; font-weight: 600; color: var(--pmc-text-main);
      }

      .pmc-section-desc {
        font-size: 12px; color: var(--pmc-text-sub); line-height: 1.5;
        margin: -8px 0 0 0; min-height: 36px;
      }

      /* Forms */
      .pmc-form-group {
        display: flex; flex-direction: column; gap: 8px;
      }

      .pmc-label {
        font-size: 13px; font-weight: 500; color: #475569;
        display: flex; justify-content: space-between;
      }
      .pmc-label-sub { color: #94a3b8; font-weight: 400; font-size: 12px; }

      .pmc-input-row {
        display: flex; gap: 8px;
      }

      .pmc-select, .pmc-input {
        flex: 1;
        padding: 10px 12px;
        border: 1px solid var(--pmc-border);
        border-radius: 8px;
        font-size: 14px; color: #1e293b;
        outline: none; background: #fff;
        transition: all 0.2s;
        min-width: 0; /* flex fix */
        width: 100%;
      }
      .pmc-select:focus, .pmc-input:focus {
        border-color: var(--pmc-primary);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
      }
      .pmc-select:disabled, .pmc-input:disabled {
        background: #f1f5f9; color: #94a3b8;
      }

      .pmc-btn-icon {
        width: 42px; padding: 0;
        border: 1px solid var(--pmc-border);
        background: #fff;
        border-radius: 8px;
        color: #64748b; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: all 0.2s;
      }
      .pmc-btn-icon:hover {
        border-color: var(--pmc-primary); color: var(--pmc-primary); background: #f8fafc;
      }

      /* Status & Actions */
      .pmc-status-bar {
        min-height: 24px; display: flex; align-items: center;
      }
      .pmc-model-hint {
        display: flex; align-items: center; gap: 6px;
        font-size: 12px; color: #64748b;
        background: #f1f5f9; padding: 4px 8px; border-radius: 6px;
      }

      .pmc-btn-save {
        margin-top: auto;
        width: 100%; padding: 12px;
        background: var(--pmc-text-main);
        color: #fff;
        border: none; border-radius: 10px;
        font-size: 14px; font-weight: 600;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center; gap: 8px;
        transition: all 0.2s;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }
      .pmc-btn-save:hover {
        background: #1e293b; transform: translateY(-1px);
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      }
      .pmc-btn-save:active { transform: translateY(0); }
      .pmc-btn-save iconify-icon, .pmc-btn-icon iconify-icon { pointer-events: none; }

      /* Footer */
      .pmc-footer {
        padding: 16px 24px;
        border-top: 1px solid var(--pmc-border);
        background: #fff;
        display: flex; justify-content: space-between; align-items: center;
      }

      .pmc-btn-secondary {
        background: #fff;
        border: 1px solid var(--pmc-border);
        color: #475569;
        padding: 8px 16px; border-radius: 8px;
        font-size: 13px; font-weight: 500;
        cursor: pointer;
        display: flex; align-items: center; gap: 8px;
        transition: all 0.2s;
      }
      .pmc-btn-secondary:hover {
        border-color: #cbd5e1; background: #f8fafc; color: #1e293b;
      }
      .pmc-btn-secondary iconify-icon { pointer-events: none; }

      .pmc-stats {
        font-size: 12px; color: #94a3b8; font-family: monospace;
      }

      /* Advanced Settings */
      .pmc-advanced-settings {
        border-top: 1px solid var(--pmc-border);
        background: #fafbfc;
        display: none; /* 默认隐藏 */
        animation: slideDown 0.3s ease;
      }
      @keyframes slideDown { from { opacity:0; transform:translateY(-10px); } to { opacity:1; transform:translateY(0); } }

      .pmc-advanced-header {
        padding: 12px 24px;
        font-size: 13px; font-weight: 600; color: #475569;
        background: #f1f5f9; border-bottom: 1px solid var(--pmc-border);
        display: flex; align-items: center; gap: 8px;
      }

      .pmc-advanced-body {
        padding: 24px;
        display: grid; grid-template-columns: 1fr 1fr; gap: 32px;
      }

      .pmc-radio-group { display: flex; flex-direction: column; gap: 10px; margin-top: 8px; }
      .pmc-radio-item { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; color: #334155; }
      .pmc-radio-item input[type="radio"] { accent-color: var(--pmc-primary); }
      .pmc-hint-text { color: #94a3b8; font-size: 12px; }
      
      .pmc-status-text { 
        font-size: 12px; color: #64748b; margin-top: 12px; 
        padding: 8px 12px; background: #fff; border: 1px solid var(--pmc-border); border-radius: 6px;
      }

      .pmc-form-row { display: flex; gap: 20px; margin-top: 8px; }
      .pmc-range { width: 100%; height: 4px; background: #e2e8f0; border-radius: 2px; outline: none; -webkit-appearance: none; }
      .pmc-range::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; background: var(--pmc-primary); border-radius: 50%; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      .pmc-value-badge { background: #e0e7ff; color: #4338ca; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: monospace; }

      /* Custom Dropdown */
      .pmc-dropdown-wrapper { position: relative; flex: 1; display: flex; }
      .pmc-dropdown-list {
        position: absolute; top: 100%; left: 0; right: 0;
        background: #fff; border: 1px solid var(--pmc-border);
        border-radius: 8px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.15);
        max-height: 280px; overflow-y: auto; z-index: 9999;
        margin-top: 6px;
        display: none;
      }
      .pmc-dropdown-list.active { display: block; animation: fadeIn 0.15s ease; }
      .pmc-dropdown-item {
        padding: 10px 12px; font-size: 13px; color: #334155; cursor: pointer;
        border-bottom: 1px solid #f8fafc; transition: all 0.1s;
      }
      .pmc-dropdown-item:hover { background: #f1f5f9; color: var(--pmc-primary); padding-left: 16px; }
      .pmc-dropdown-item:last-child { border-bottom: none; }
      .pmc-dropdown-empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 12px; }

      /* Responsive */
      @media (max-width: 1024px) {
        .pmc-modal-container { max-height: 90vh; }
        .pmc-advanced-body { grid-template-columns: 1fr; gap: 20px; }
      }

      ${getStyles()}
    `;
  }

  Object.assign(ns.styles, { getStyles, getInjectedCss });
})(typeof window !== 'undefined' ? window : this);
