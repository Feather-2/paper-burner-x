/**
 * LayerEditor UI 创建模块
 */

import { injectStyles } from './styles.js';

export function getEditorHTML() {
    return `
        <div class="image-editor-header">
            <div class="image-editor-header-left">
                <button class="image-editor-back" title="返回幻灯片">
                    <iconify-icon icon="carbon:arrow-left"></iconify-icon>
                </button>
                <span class="image-editor-title">图片智能编辑</span>
            </div>
            <div class="image-editor-actions">
                <button class="btn-cancel">取消</button>
                <button class="btn-apply">
                    <iconify-icon icon="carbon:checkmark"></iconify-icon>
                    应用更改
                </button>
            </div>
        </div>
        <div class="image-editor-body">
            <div class="image-editor-toolbar">
                <button class="tool-btn active" data-tool="select" title="选择">
                    <iconify-icon icon="carbon:cursor-1"></iconify-icon>
                </button>
                <button class="tool-btn" data-tool="move" title="移动">
                    <iconify-icon icon="carbon:move"></iconify-icon>
                </button>
                <div class="toolbar-divider"></div>
                <button class="tool-btn" data-action="vectorize" title="矢量化分层">
                    <iconify-icon icon="carbon:data-vis-1"></iconify-icon>
                </button>
                <button class="tool-btn" data-action="ocr" title="识别文字">
                    <iconify-icon icon="carbon:scan-alt"></iconify-icon>
                </button>
                <button class="tool-btn" data-action="remove-bg" title="去除背景">
                    <iconify-icon icon="carbon:erase"></iconify-icon>
                </button>
                <button class="tool-btn" data-action="sam-segment" title="AI 智能分割">
                    <iconify-icon icon="carbon:cut-out"></iconify-icon>
                </button>
                <div class="toolbar-divider"></div>
                <button class="tool-btn" data-action="undo" title="撤销">
                    <iconify-icon icon="carbon:undo"></iconify-icon>
                </button>
                <button class="tool-btn" data-action="redo" title="重做">
                    <iconify-icon icon="carbon:redo"></iconify-icon>
                </button>
            </div>
            <div class="image-editor-panel panel-left" id="ieLayerPanel">
                <div class="panel-header">
                    <h4>图层</h4>
                    <button class="btn-icon-sm" title="添加空白图层">
                        <iconify-icon icon="carbon:add"></iconify-icon>
                    </button>
                </div>
                <div class="layer-list-container">
                    <div class="layer-list"></div>
                </div>
            </div>
            <div class="sidebar-resizer-v" id="ieLeftResizer"></div>
            <div class="image-editor-canvas-wrap">
                <div class="image-editor-viewport">
                    <canvas class="image-editor-canvas"></canvas>
                    <div class="image-editor-svg-container"></div>
                </div>
                <div class="zoom-indicator">100%</div>
            </div>
            <div class="sidebar-resizer-v" id="ieRightResizer"></div>
            <div class="image-editor-panel panel-right" id="iePropertyPanel">
                <div class="panel-header">
                    <h4>属性</h4>
                </div>
                <div class="property-panel-container">
                    <div class="property-panel">
                        <div class="empty-state">选择一个图层以查看属性</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

export const UIMixin = {
    _createUI() {
        this.container = document.createElement('div');
        this.container.className = 'image-editor-container';
        this.container.innerHTML = getEditorHTML();
        injectStyles();
        document.body.appendChild(this.container);
        this.canvas = this.container.querySelector('.image-editor-canvas');
        this.ctx = this.canvas.getContext('2d');
        this._bindEvents();
        this._bindPanelResizer();
        this._bindPropertyPanelBehavior();
    },

    _bindPanelResizer() {
        const leftResizer = this.container.querySelector('#ieLeftResizer');
        const leftPanel = this.container.querySelector('#ieLayerPanel');
        const rightResizer = this.container.querySelector('#ieRightResizer');
        const rightPanel = this.container.querySelector('#iePropertyPanel');
        
        if (leftResizer && leftPanel) {
            let startX, startWidth;
            const onMouseMove = (e) => {
                const deltaX = e.clientX - startX;
                leftPanel.style.width = `${Math.max(180, Math.min(400, startWidth + deltaX))}px`;
            };
            const onMouseUp = () => {
                leftResizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            leftResizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                startX = e.clientX;
                startWidth = leftPanel.offsetWidth;
                leftResizer.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }
        
        if (rightResizer && rightPanel) {
            let startX, startWidth;
            const onMouseMove = (e) => {
                const deltaX = startX - e.clientX;
                rightPanel.style.width = `${Math.max(200, Math.min(450, startWidth + deltaX))}px`;
            };
            const onMouseUp = () => {
                rightResizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            rightResizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                startX = e.clientX;
                startWidth = rightPanel.offsetWidth;
                rightResizer.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        }
    },

    _bindPropertyPanelBehavior() {
        const layerPanel = this.container.querySelector('#ieLayerPanel');
        const propertyPanel = this.container.querySelector('#iePropertyPanel');
        const rightResizer = this.container.querySelector('#ieRightResizer');
        if (!layerPanel || !propertyPanel) return;

        const expandPanel = () => {
            propertyPanel.classList.add('visible');
            if (rightResizer) rightResizer.classList.add('visible');
        };
        const collapsePanel = () => {
            propertyPanel.classList.remove('visible');
            if (rightResizer) rightResizer.classList.remove('visible');
        };

        layerPanel.addEventListener('dblclick', (e) => {
            if (e.target.closest('.layer-item')) expandPanel();
        });
        layerPanel.addEventListener('click', (e) => {
            if (!e.target.closest('.layer-item')) {
                this.selectedLayerIndex = -1;
                this._updateLayerList();
                collapsePanel();
            }
        });
        
        const originalSelectLayer = this._selectLayer.bind(this);
        this._selectLayer = (index) => {
            originalSelectLayer(index);
            if (index === -1) collapsePanel();
        };
    },

    _showLoading(message = '处理中...') {
        if (!this._loadingOverlay) {
            this._loadingOverlay = document.createElement('div');
            this._loadingOverlay.className = 'ie-loading-overlay';
            this._loadingOverlay.innerHTML = `
                <div class="ie-loading-spinner"></div>
                <div class="ie-loading-text">${message}</div>
            `;
            this._loadingOverlay.style.cssText = `
                position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0, 0, 0, 0.6);
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                z-index: 9999; backdrop-filter: blur(2px);
            `;
            const style = document.createElement('style');
            style.textContent = `
                .ie-loading-spinner {
                    width: 40px; height: 40px;
                    border: 3px solid rgba(255,255,255,0.3);
                    border-top-color: #fff; border-radius: 50%;
                    animation: ie-spin 0.8s linear infinite;
                }
                .ie-loading-text { color: #fff; margin-top: 12px; font-size: 14px; }
                @keyframes ie-spin { to { transform: rotate(360deg); } }
            `;
            this._loadingOverlay.appendChild(style);
        }
        const textEl = this._loadingOverlay.querySelector('.ie-loading-text');
        if (textEl) textEl.textContent = message;
        const body = this.container?.querySelector('.image-editor-body');
        if (body && !body.contains(this._loadingOverlay)) {
            body.appendChild(this._loadingOverlay);
        }
    },
    
    _hideLoading() {
        if (this._loadingOverlay && this._loadingOverlay.parentNode) {
            this._loadingOverlay.remove();
        }
    },

    _showToast(message, duration = 2000) {
        const existing = this.container.querySelector('.ie-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.className = 'ie-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: absolute; bottom: 80px; left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8); color: white;
            padding: 10px 20px; border-radius: 8px;
            font-size: 13px; z-index: 1000;
            animation: ie-toast-in 0.3s ease;
        `;
        this.container.querySelector('.image-editor-canvas-wrap').appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'ie-toast-out 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },
    
    _nextFrame() {
        return new Promise(resolve => {
            requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
    },

    _applyScale() {
        const viewport = this.container?.querySelector('.image-editor-viewport');
        if (viewport) {
            viewport.style.transform = `scale(${this.scale})`;
            viewport.style.transformOrigin = 'center center';
            const indicator = this.container.querySelector('.zoom-indicator');
            if (indicator) {
                indicator.textContent = `${Math.round(this.scale * 100)}%`;
                indicator.classList.add('visible');
                clearTimeout(this._zoomIndicatorTimeout);
                this._zoomIndicatorTimeout = setTimeout(() => {
                    indicator.classList.remove('visible');
                }, 1500);
            }
        }
    },

    close() {
        this._hideLoading();
        this.container?.remove();
    }
};
