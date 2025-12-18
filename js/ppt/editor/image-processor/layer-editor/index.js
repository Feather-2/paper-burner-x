/**
 * LayerEditor 主入口
 * 整合所有模块，导出 LayerEditor 类
 */

import { UIMixin } from './ui.js';
import { EventsMixin } from './events.js';
import { HistoryMixin } from './history.js';
import { RenderMixin } from './render.js';
import { LayerListMixin } from './layer-list.js';
import { PropertyPanelMixin } from './property-panel.js';
import { TextOverlayMixin } from './text-overlay.js';
import { OcrMixin } from './ocr.js';
import { VectorizeMixin } from './vectorize.js';
import { PathOpsMixin } from './path-ops.js';
import { ElementSelectMixin } from './element-select.js';
import { TransformMixin } from './transform.js';
import { UtilsMixin } from './utils.js';
import { SamMixin } from './sam.js';

/**
 * LayerEditor 图层编辑器类
 * 用于图片的矢量化、OCR 识别、文字覆盖等高级编辑功能
 */
class LayerEditor {
    /**
     * 构造函数
     * @param {Object} options - 配置选项
     * @param {HTMLElement} options.element - 挂载元素
     * @param {Object} options.processor - 图片处理器实例
     * @param {Function} options.onSave - 保存回调
     */
    constructor(options = {}) {
        this.element = options.element;
        this.processor = options.processor;
        this.onSave = options.onSave;

        this._mainEditor = options.editor || window.slideEditor;
        this._elementId =
            options.elementId ||
            options.element?.closest?.('[data-element-id]')?.dataset?.elementId ||
            null;
        this._slideIndex = options.slideIndex ?? this._mainEditor?.currentSlideIndex;
        this._originalAssetId = null;
        this._originalEditHistory = [];
        this._originalLayersParams = null;
        
        // UI 状态
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        this.scale = 1;
        this.minScale = 0.1;
        this.maxScale = 5;
        this.currentTool = 'select';
        
        // 图层状态
        this.processedImage = null;
        this.selectedLayerIndex = -1;
        this.selectedChildIndex = -1;
        this.selectedPathIndex = -1;
        
        // 历史记录
        this.history = [];
        this.historyIndex = -1;
        
        // 交互状态
        this.pathSelectMode = false;
        this.elementSelectMode = false;
        this.drawBboxMode = false;
        this.drawBboxParent = null;
        this._bboxDrawBound = false;
        this._selectedElements = new Set();
        this._elementOverlay = null;
        this._elementSelectLayerId = null;
        
        // 内部状态
        this._loadingOverlay = null;
        this._zoomIndicatorTimeout = null;
        this._textOverlayGroup = null;
    }

    /**
     * 打开编辑器
     */
    async open() {
        // 记录编辑开始前的状态
        if (this._mainEditor?.document && this._elementId) {
            const element = this._mainEditor.document.getElementById(this._elementId);
            this._originalAssetId = element?.assetId;
            this._originalEditHistory = element?.editHistory ? [...element.editHistory] : [];
            this._originalLayersParams = element?.editParams?.layers
                ? JSON.parse(JSON.stringify(element.editParams.layers))
                : null;
        }

        // 创建 UI（内部会调用 _bindEvents）
        this._createUI();
        
        // 加载并处理图片
        await this._loadAndProcess();
        
        // 渲染
        this._render();
        
        // 初始化属性面板（显示 OCR 设置）
        this._updatePropertyPanel();
    }

    /**
     * 加载并处理图片
     */
    async _loadAndProcess() {
        const imgSrc = this.element?.src || this.element?.dataset?.src;
        if (!imgSrc) {
            console.error('[LayerEditor] 没有图片源, element:', this.element);
            this._showToast('没有图片源，无法打开编辑器');
            this.close?.();
            return;
        }
        
        this._showLoading('加载图片中...');
        
        try {
            // 处理图片
            this.processedImage = await this.processor.processImage(imgSrc, {
                vectorize: false,
                ocr: false,
                removeBackground: false
            });
            
            if (!this.processedImage) {
                throw new Error('无法获取图片数据');
            }
            
            // 设置 Canvas 尺寸
            this.canvas.width = this.processedImage.original.width;
            this.canvas.height = this.processedImage.original.height;

            // 尝试恢复已保存的图层数据
            const savedLayers = this._getSavedLayers();
            if (Array.isArray(savedLayers) && savedLayers.length > 0) {
                try {
                    const restoredLayers = JSON.parse(JSON.stringify(savedLayers));
                    const attachOriginalImage = (layers) =>
                        (layers || []).map(layer => {
                            const next = { ...layer };
                            if (next.type === 'original') {
                                next.image = this.processedImage.original.element;
                            }
                            if (Array.isArray(next.children)) {
                                next.children = attachOriginalImage(next.children);
                            }
                            // 清理潜在的不可用 inpaintedBackground（旧数据可能残留）
                            if (next.inpaintedBackground?.canvas && typeof HTMLCanvasElement !== 'undefined') {
                                if (!(next.inpaintedBackground.canvas instanceof HTMLCanvasElement)) {
                                    delete next.inpaintedBackground;
                                }
                            }
                            return next;
                        });

                    this.processedImage.layers = attachOriginalImage(restoredLayers);
                } catch (e) {
                    console.warn('[LayerEditor] 恢复已保存图层失败，回退到默认图层:', e);
                }
            }

            // 添加原始图层（如果还没有）
            if (!this.processedImage.layers.find(l => l.type === 'original')) {
                this.processedImage.layers.unshift({
                    id: 'layer_original',
                    type: 'original',
                    name: '原始图片',
                    image: this.processedImage.original.element,
                    visible: true
                });
            }
            
            // 初始化历史记录
            this._saveHistory();
            
        } catch (error) {
            console.error('[LayerEditor] 加载失败:', error);
            this._showToast('加载失败: ' + error.message);
            throw error;
        } finally {
            this._hideLoading();
        }
    }

    /**
     * 应用更改
     */
    async _apply() {
        // 序列化图层数据（排除不可序列化的 DOM/Canvas 对象）
        const isNonSerializable = (value) => {
            if (value == null) return false;
            if (typeof value === 'function') return true;

            const checks = [
                typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement,
                typeof HTMLElement !== 'undefined' && value instanceof HTMLElement,
                typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement,
                typeof CanvasRenderingContext2D !== 'undefined' && value instanceof CanvasRenderingContext2D,
                typeof ImageData !== 'undefined' && value instanceof ImageData,
                typeof Blob !== 'undefined' && value instanceof Blob,
                typeof File !== 'undefined' && value instanceof File,
                typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer,
            ];

            // TypedArray
            if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function') {
                if (ArrayBuffer.isView(value)) return true;
            }

            return checks.some(Boolean);
        };

        const serializeAny = (value) => {
            if (value == null) return value;
            const t = typeof value;
            if (t === 'string' || t === 'number' || t === 'boolean') return value;
            if (isNonSerializable(value)) return undefined;

            if (Array.isArray(value)) {
                return value
                    .map(serializeAny)
                    .filter(v => v !== undefined);
            }

            if (t === 'object') {
                const out = {};
                for (const [k, v] of Object.entries(value)) {
                    // 兼容旧字段：image 永远不持久化
                    if (k === 'image') continue;
                    const next = serializeAny(v);
                    if (next !== undefined) out[k] = next;
                }
                return out;
            }

            return undefined;
        };

        const layersData = serializeAny(this.processedImage.layers);

        // 更新元素的 editParams.layers
        let oldLayersParams = null;
        if (this._mainEditor?.document && this._elementId) {
            const element = this._mainEditor.document.getElementById(this._elementId);
            if (element) {
                oldLayersParams = element?.editParams?.layers
                    ? JSON.parse(JSON.stringify(element.editParams.layers))
                    : null;
                if (!element.editParams) element.editParams = {};
                element.editParams.layers = layersData;
            }
        }

        // 扁平化所有图层用于导出
        const flatLayers = [];
        
        this.processedImage.layers.forEach(layer => {
            if (layer.type === 'group') {
                if (layer.visible) {
                    layer.children.forEach(child => {
                        if (child.visible) {
                            flatLayers.push(child);
                        }
                    });
                }
            } else {
                flatLayers.push(layer);
            }
        });
        
        // 检查是否有可见的矢量图层
        const visibleVectorLayers = flatLayers.filter(
            l => l.visible && l.type === 'vector'
        );
        
        let result = {
            id: this.processedImage.id,
            layers: flatLayers
        };
        
        if (visibleVectorLayers.length > 0) {
            const mergedSvg = this._mergeVectorLayers(visibleVectorLayers);
            result.svg = mergedSvg;
            result.type = 'svg';
            result.dataUrl = this.canvas.toDataURL('image/png');
        } else {
            result.dataUrl = this.canvas.toDataURL('image/png');
            result.type = 'image';
        }
        
        // 保存处理结果
        await this.processor.saveProcessedImage(this.processedImage);

        // 回调更新 PPT
        const onSaveResult = this.onSave?.(result);
        if (onSaveResult && typeof onSaveResult.then === 'function') {
            await onSaveResult;
        }

        const mainHistory = this._mainEditor?.history;
        if (mainHistory && this._elementId) {
            const element = this._mainEditor?.document?.getElementById(this._elementId);

            mainHistory.beginBatch('图片编辑');
            mainHistory.push({
                type: 'element.update',
                elementId: this._elementId,
                slideIndex: this._slideIndex,
                timestamp: Date.now(),
                changes: [
                    { path: 'assetId', oldValue: this._originalAssetId, newValue: element?.assetId },
                    { path: 'editHistory', oldValue: this._originalEditHistory, newValue: element?.editHistory },
                    { path: 'editParams.layers', oldValue: this._originalLayersParams ?? oldLayersParams, newValue: element?.editParams?.layers }
                ]
            });
            mainHistory.commitBatch();
        }

        this.close();
    }

    /**
     * 获取已保存的图层数据
     */
    _getSavedLayers() {
        if (!this._mainEditor?.document || !this._elementId) return null;
        const element = this._mainEditor.document.getElementById(this._elementId);
        return element?.editParams?.layers || null;
    }
}

// 混入所有模块方法
Object.assign(LayerEditor.prototype, UIMixin);
Object.assign(LayerEditor.prototype, EventsMixin);
Object.assign(LayerEditor.prototype, HistoryMixin);
Object.assign(LayerEditor.prototype, RenderMixin);
Object.assign(LayerEditor.prototype, LayerListMixin);
Object.assign(LayerEditor.prototype, PropertyPanelMixin);
Object.assign(LayerEditor.prototype, TextOverlayMixin);
Object.assign(LayerEditor.prototype, OcrMixin);
Object.assign(LayerEditor.prototype, VectorizeMixin);
Object.assign(LayerEditor.prototype, PathOpsMixin);
Object.assign(LayerEditor.prototype, ElementSelectMixin);
Object.assign(LayerEditor.prototype, TransformMixin);
Object.assign(LayerEditor.prototype, UtilsMixin);
Object.assign(LayerEditor.prototype, SamMixin);

// 导出
export { LayerEditor };
export default LayerEditor;
