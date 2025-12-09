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
import { UtilsMixin } from './utils.js';

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
        this.drawBboxMode = false;
        this.drawBboxParent = null;
        this._bboxDrawBound = false;
        
        // 内部状态
        this._loadingOverlay = null;
        this._zoomIndicatorTimeout = null;
        this._textOverlayGroup = null;
    }

    /**
     * 打开编辑器
     */
    async open() {
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
            console.error('[LayerEditor] 没有图片源');
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
        this.onSave?.(result);

        this.close();
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
Object.assign(LayerEditor.prototype, UtilsMixin);

// 导出
export { LayerEditor };
export default LayerEditor;
