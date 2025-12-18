/**
 * LayerEditor CSS 样式
 * 从 layer-editor.js 拆分出的样式模块
 */

export const EDITOR_STYLES = `
    :root {
        --ie-primary: #4f46e5;
        --ie-primary-hover: #4338ca;
        --ie-bg: #f8fafc;
        --ie-surface: #ffffff;
        --ie-border: #e2e8f0;
        --ie-text: #1e293b;
        --ie-text-secondary: #64748b;
        --ie-hover: #f1f5f9;
        --ie-radius: 6px;
        --ie-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    }
    /* Global Reset for Editor */
    .image-editor-container * {
        box-sizing: border-box;
    }
    .image-editor-container iconify-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        vertical-align: middle;
    }
    
    .image-editor-container {
        position: fixed;
        inset: 0;
        z-index: 10000;
        background-color: var(--ie-bg);
        display: flex;
        flex-direction: column;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: var(--ie-text);
        animation: ie-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    
    @keyframes ie-slide-in {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }

    /* Header */
    .image-editor-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0 16px;
        height: 56px;
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--ie-border);
        z-index: 20;
        flex-shrink: 0;
    }
    
    .image-editor-header-left {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    /* Body Layout */
    .image-editor-body {
        flex: 1;
        display: flex;
        overflow: hidden;
        position: relative;
    }
    
    /* Toolbar */
    .image-editor-toolbar {
        width: 56px;
        background: var(--ie-surface);
        border-right: 1px solid var(--ie-border);
        padding: 16px 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        z-index: 10;
        flex-shrink: 0;
    }
    
    .tool-btn {
        width: 36px;
        height: 36px;
        border-radius: var(--ie-radius);
        border: 1px solid transparent;
        background: transparent;
        color: var(--ie-text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 20px;
        transition: all 0.2s;
    }
    .tool-btn:hover {
        background: var(--ie-hover);
        color: var(--ie-text);
    }
    .tool-btn.active {
        background: var(--ie-primary);
        color: #fff;
        box-shadow: 0 2px 5px rgba(79, 70, 229, 0.3);
    }
    .toolbar-divider {
        width: 24px;
        height: 1px;
        background: var(--ie-border);
        margin: 4px 0;
    }
    
    /* Panels (Left & Right) */
    .image-editor-panel {
        width: 240px; 
        background: var(--ie-surface);
        display: flex;
        flex-direction: column;
        z-index: 10;
        flex-shrink: 0;
        transition: opacity 0.3s; 
    }
    
    .panel-left { border-right: 1px solid var(--ie-border); }
    .panel-right { border-left: 1px solid var(--ie-border); width: 280px; }
    
    /* Resizer */
    .sidebar-resizer-v {
        width: 1px;
        background: transparent;
        cursor: col-resize;
        z-index: 30;
        position: relative;
        flex-shrink: 0;
        transition: background 0.2s;
        /* Hit area expansion */
        padding: 0 4px; 
        margin: 0 -4px;
        background-clip: content-box;
    }
    .sidebar-resizer-v:hover, .sidebar-resizer-v.dragging {
        background-color: var(--ie-primary);
    }

    .panel-header {
        height: 40px;
        padding: 0 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--ie-border);
        background: #fcfcfc;
        flex-shrink: 0;
    }
    
    .panel-header h4 {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
        color: var(--ie-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    
    /* Canvas Area */
    .image-editor-canvas-wrap {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f1f5f9;
        background-image: radial-gradient(#cbd5e1 1px, transparent 1px);
        background-size: 20px 20px;
        overflow: hidden;
        position: relative;
        user-select: none;
    }
    
    .image-editor-viewport {
        position: relative;
        box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.2);
        background: #fff;
        transition: transform 0.1s cubic-bezier(0, 0, 0.2, 1);
    }

    .image-editor-svg-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
    }
    
    .zoom-indicator {
        position: absolute;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0,0,0,0.75);
        color: white;
        padding: 4px 12px;
        border-radius: 100px;
        font-size: 12px;
        font-weight: 500;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s;
        backdrop-filter: blur(4px);
    }
    .zoom-indicator.visible { opacity: 1; }
    
    /* Layer List */
    .layer-list-container {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 8px;
    }
    
    .layer-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--ie-radius);
        cursor: pointer;
        color: var(--ie-text);
        font-size: 13px;
        transition: all 0.15s;
        user-select: none;
        margin-bottom: 2px;
        height: 44px; /* Slightly taller for better touch */
    }
    
    .layer-item:hover { background: var(--ie-hover); }
    
    .layer-item.selected {
        background: #eff6ff;
        border-color: #dbeafe;
        color: var(--ie-primary);
    }
    
    .layer-preview {
        width: 30px;
        height: 30px;
        border-radius: 4px;
        background: #f1f5f9;
        border: 1px solid rgba(0,0,0,0.06);
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        color: #94a3b8;
        overflow: hidden;
    }
    .layer-preview img { width: 100%; height: 100%; object-fit: contain; }
    .layer-preview.color-preview { box-shadow: inset 0 0 0 1px rgba(0,0,0,0.1); }
    
    .layer-name {
        flex: 1;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0; /* Flexbox overflow fix */
    }
    
    /* Child Layer Styling */
    .layer-item.child-layer {
        height: 32px;
        padding-left: 0; /* Reset padding, margin handled by container */
        margin-left: 2px;
        border-left: 2px solid transparent;
        border-radius: 0 var(--ie-radius) var(--ie-radius) 0;
    }
    .layer-item.child-layer .layer-preview {
        width: 20px;
        height: 20px;
        font-size: 12px;
    }
    .layer-item.child-layer.selected {
        border-left-color: var(--ie-primary);
    }

    .child-layer-container {
        padding-left: 24px;
        position: relative;
    }
    .child-layer-container::before {
        content: '';
        position: absolute;
        left: 14px;
        top: 0;
        bottom: 12px;
        width: 2px;
        background: var(--ie-border);
        opacity: 0.5;
    }
    
    /* Child Layer Action Buttons */
    .layer-action-btn {
        background: transparent;
        border: none;
        padding: 4px;
        cursor: pointer;
        color: var(--ie-text-secondary);
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s;
    }
    .layer-action-btn:hover {
        background: var(--ie-hover);
        color: var(--ie-text);
    }
    .layer-action-btn.danger:hover {
        background: #fef2f2;
        color: #ef4444;
    }
    .layer-action-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }
    .layer-action-btn iconify-icon {
        font-size: 14px;
    }
    
    /* Path Selection Mode */
    .path-select-mode path {
        transition: opacity 0.15s, stroke 0.15s;
    }
    .path-select-mode path:hover {
        opacity: 0.7;
        stroke: #ef4444 !important;
        stroke-width: 2px !important;
    }
    
    /* Danger Button Style */
    .btn-action.danger {
        background: #fef2f2;
        color: #ef4444;
        border-color: #fecaca;
    }
    .btn-action.danger:hover {
        background: #fee2e2;
        border-color: #f87171;
    }
    
    /* Property Panel */
    .property-panel-container {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        background: #fff;
    }
    
    .property-group {
        margin-bottom: 24px;
        border-bottom: 1px solid var(--ie-border);
        padding-bottom: 16px;
    }
    .property-group:last-child { border-bottom: none; }
    
    .property-group-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--ie-text-secondary);
        text-transform: uppercase;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    
    .property-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
        gap: 12px;
    }
    .property-row.block {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
    }
    
    .property-label {
        font-size: 13px;
        color: var(--ie-text);
    }
    
    .property-input, .property-select {
        width: 100%;
        padding: 8px;
        border: 1px solid var(--ie-border);
        border-radius: var(--ie-radius);
        font-size: 13px;
        background: #fff;
        transition: border-color 0.2s;
    }
    .property-input:focus, .property-select:focus {
        border-color: var(--ie-primary);
        outline: none;
        box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.1);
    }
    
    /* Header Buttons */
    .image-editor-back { 
        width: 32px; height: 32px; padding: 0; background: transparent; 
        border: 1px solid var(--ie-border); color: var(--ie-text-secondary); 
        border-radius: var(--ie-radius); display: flex; align-items: center; justify-content: center;
        cursor: pointer; transition: all 0.2s;
    }
    .image-editor-back:hover { background: var(--ie-hover); color: var(--ie-text); border-color: var(--ie-text-secondary); }
    
    .image-editor-title { 
        font-size: 15px;
        font-weight: 600;
        color: var(--ie-text); 
        margin-left: 8px;
    }
    
    .image-editor-actions { display: flex; gap: 8px; }
    
    .btn-cancel { 
        padding: 8px 16px; 
        background: transparent; 
        border: 1px solid transparent; 
        color: var(--ie-text-secondary); 
        font-size: 13px;
        font-weight: 500;
        border-radius: var(--ie-radius);
        cursor: pointer;
        transition: all 0.2s;
    }
    .btn-cancel:hover { background: var(--ie-hover); color: var(--ie-text); }
    
    .btn-apply { 
        padding: 8px 16px; 
        background: var(--ie-primary);
        border: 1px solid transparent;
        color: white;
        font-size: 13px;
        font-weight: 500;
        border-radius: var(--ie-radius);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s;
        box-shadow: 0 2px 4px rgba(79, 70, 229, 0.2);
    }
    .btn-apply:hover { 
        background: var(--ie-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 4px 6px rgba(79, 70, 229, 0.3);
    }
    
    .btn-action { 
        width: 100%; padding: 10px; 
        background: #fff; color: var(--ie-text); 
        border: 1px solid var(--ie-border); 
        border-radius: var(--ie-radius); 
        font-size: 13px; font-weight: 500; 
        cursor: pointer; margin-top: 8px; 
        display: flex; align-items: center; justify-content: center; gap: 6px; 
        transition: all 0.2s;
    }
    .btn-action:hover { border-color: var(--ie-primary); color: var(--ie-primary); background: #fdfdff; }
    
    /* Sliders */
    .range-wrap { width: 100%; display: flex; align-items: center; gap: 12px; }
    .range-input { flex: 1; height: 6px; background: var(--ie-hover); border-radius: 3px; appearance: none; border: 1px solid var(--ie-border); }
    .range-input::-webkit-slider-thumb { appearance: none; width: 16px; height: 16px; border-radius: 50%; background: #fff; border: 2px solid var(--ie-primary); cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: transform 0.1s; }
    .range-input::-webkit-slider-thumb:hover { transform: scale(1.1); }
    .range-value { font-size: 12px; font-family: monospace; color: var(--ie-text-secondary); width: 32px; text-align: right; }
    
    .layer-visibility { 
        width: 28px; height: 28px; border: none; background: transparent; cursor: pointer; 
        font-size: 16px; color: var(--ie-text-secondary); border-radius: 4px; 
        display: flex; align-items: center; justify-content: center; opacity: 0.6; transition: all 0.2s; 
    }
    .layer-visibility:hover, .layer-item:hover .layer-visibility { background: rgba(0,0,0,0.05); color: var(--ie-text); opacity: 1; }
    
    /* Utility */
    .btn-icon-sm {
        width: 28px; height: 28px;
        display: flex; align-items: center; justify-content: center;
        border: none; background: transparent; border-radius: 4px;
        color: var(--ie-text-secondary); cursor: pointer;
        transition: all 0.2s;
    }
    .btn-icon-sm:hover { background: var(--ie-hover); color: var(--ie-primary); }
    
    .empty-state {
        padding: 40px 0;
        text-align: center;
        color: var(--ie-text-secondary);
        font-size: 13px;
    }
    
    /* Toast 动画 */
    @keyframes ie-toast-in {
        from { opacity: 0; transform: translateX(-50%) translateY(10px); }
        to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes ie-toast-out {
        from { opacity: 1; transform: translateX(-50%) translateY(0); }
        to { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    }
`;

/**
 * 注入样式到文档
 */
export function injectStyles() {
    if (document.getElementById('image-editor-styles')) return;

    const style = document.createElement('style');
    style.id = 'image-editor-styles';
    style.textContent = EDITOR_STYLES;
    document.head.appendChild(style);
}
