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

                    // 收集需要恢复 inpaintedBackground 的图层
                    const inpaintRestoreTasks = [];

                    const attachOriginalImage = (layers) =>
                        (layers || []).map(layer => {
                            const next = { ...layer };
                            if (next.type === 'original') {
                                next.image = this.processedImage.original.element;
                            }
                            if (Array.isArray(next.children)) {
                                next.children = attachOriginalImage(next.children);
                            }
                            // 从 dataUrl 恢复 inpaintedBackground canvas
                            if (next.inpaintedBackground?.dataUrl) {
                                inpaintRestoreTasks.push({ layer: next, dataUrl: next.inpaintedBackground.dataUrl });
                                // 先清空，等异步加载完成后填充
                                next.inpaintedBackground = null;
                            } else if (next.inpaintedBackground?.canvas && typeof HTMLCanvasElement !== 'undefined') {
                                // 清理无效的 canvas 引用
                                if (!(next.inpaintedBackground.canvas instanceof HTMLCanvasElement)) {
                                    delete next.inpaintedBackground;
                                }
                            }
                            return next;
                        });

                    this.processedImage.layers = attachOriginalImage(restoredLayers);

                    // 异步恢复 inpaintedBackground canvas
                    if (inpaintRestoreTasks.length > 0) {
                        Promise.all(inpaintRestoreTasks.map(async ({ layer, dataUrl }) => {
                            try {
                                const img = new Image();
                                await new Promise((resolve, reject) => {
                                    img.onload = resolve;
                                    img.onerror = reject;
                                    img.src = dataUrl;
                                });
                                const canvas = document.createElement('canvas');
                                canvas.width = img.width;
                                canvas.height = img.height;
                                const ctx = canvas.getContext('2d');
                                ctx.drawImage(img, 0, 0);
                                layer.inpaintedBackground = { canvas, ctx, dataUrl };
                            } catch (e) {
                                console.warn('[LayerEditor] 恢复 inpaintedBackground 失败:', e);
                            }
                        })).then(() => {
                            // 恢复完成后重新渲染
                            this._render();
                        });
                    }
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

        // 生成包含文字层的 dataUrl
        const generateDataUrl = () => {
            // 查找所有 OCR 文字组
            const textGroups = this.processedImage.layers.filter(
                l => l.type === 'group' && (l.textOverlayConfig || l.ocrGroup) && l.visible !== false
            );

            console.log('[LayerEditor] 导出检查 - 文字组数量:', textGroups.length);
            textGroups.forEach(g => {
                console.log('[LayerEditor] 组:', g.name, '子图层:', g.children?.length);
            });

            // 如果没有文字组，直接返回 canvas
            if (textGroups.length === 0) {
                return this.canvas.toDataURL('image/png');
            }

            // 创建临时 canvas 绘制文字层
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = this.canvas.width;
            exportCanvas.height = this.canvas.height;
            const ctx = exportCanvas.getContext('2d');

            // 复制当前 canvas 内容
            ctx.drawImage(this.canvas, 0, 0);

            // 绘制所有文字组的文字
            for (const group of textGroups) {
                if (!group.children) continue;

                for (const child of group.children) {
                    if (child.visible === false || child.type !== 'text-overlay') continue;

                    const { bbox, style } = child;
                    const displayText = child.content?.displayText || child.content?.originalText ||
                                       child.translatedText || child.text || '';

                    console.log('[LayerEditor] 绘制文字:', displayText?.substring(0, 20), 'bbox:', bbox, 'style:', style);

                    if (!displayText || !bbox) continue;

                    const x = bbox.left * exportCanvas.width;
                    const y = bbox.top * exportCanvas.height;
                    const w = bbox.width * exportCanvas.width;
                    const h = bbox.height * exportCanvas.height;

                    // 背景（非 inpainted 时绘制）
                    if (!child.inpainted) {
                        ctx.fillStyle = style?.backgroundColor || 'rgba(255, 255, 255, 0.95)';
                        ctx.fillRect(x, y, w, h);
                    }

                    // 文字
                    ctx.fillStyle = style?.color || '#000000';
                    const fontFamily = style?.fontFamily || 'sans-serif';
                    ctx.font = `${style?.fontWeight || 'normal'} ${style?.fontSize || 14}px ${fontFamily}`;
                    ctx.textAlign = style?.textAlign || 'left';
                    ctx.textBaseline = 'top';

                    // 换行绘制
                    const lineHeight = (style?.fontSize || 14) * 1.3;
                    const words = displayText.split('');
                    let line = '';
                    let lineY = y + 4;

                    for (const char of words) {
                        if (char === '\n') {
                            const drawX = style?.textAlign === 'center' ? x + w / 2 :
                                         style?.textAlign === 'right' ? x + w - 4 : x + 4;
                            ctx.fillText(line, drawX, lineY);
                            line = '';
                            lineY += lineHeight;
                            continue;
                        }
                        const testLine = line + char;
                        const metrics = ctx.measureText(testLine);

                        if (metrics.width > w - 8) {
                            const drawX = style?.textAlign === 'center' ? x + w / 2 :
                                         style?.textAlign === 'right' ? x + w - 4 : x + 4;
                            ctx.fillText(line, drawX, lineY);
                            line = char;
                            lineY += lineHeight;
                        } else {
                            line = testLine;
                        }
                    }

                    if (line) {
                        const drawX = style?.textAlign === 'center' ? x + w / 2 :
                                     style?.textAlign === 'right' ? x + w - 4 : x + 4;
                        ctx.fillText(line, drawX, lineY);
                    }
                }
            }

            return exportCanvas.toDataURL('image/png');
        };

        let result = {
            id: this.processedImage.id,
            layers: layersData  // 使用完整的图层数据（含 group 结构），而非扁平化的 flatLayers
        };

        if (visibleVectorLayers.length > 0) {
            // 合并矢量图层
            let mergedSvg = this._mergeVectorLayers(visibleVectorLayers);

            // 添加文字层到 SVG
            const textGroups = this.processedImage.layers.filter(
                l => l.type === 'group' && (l.textOverlayConfig || l.ocrGroup) && l.visible !== false
            );

            if (textGroups.length > 0 && mergedSvg) {
                const textElements = [];
                const svgWidth = this.canvas.width;
                const svgHeight = this.canvas.height;

                for (const group of textGroups) {
                    if (!group.children) continue;

                    for (const child of group.children) {
                        if (child.visible === false || child.type !== 'text-overlay') continue;

                        const { bbox, style } = child;
                        const displayText = child.content?.displayText || child.content?.originalText ||
                                           child.translatedText || child.text || '';
                        if (!displayText || !bbox) continue;

                        const x = bbox.left * svgWidth;
                        const y = bbox.top * svgHeight;
                        const w = bbox.width * svgWidth;
                        const h = bbox.height * svgHeight;

                        const fontSize = style?.fontSize || 14;
                        const fontFamily = (style?.fontFamily || 'sans-serif').replace(/"/g, "'");
                        const color = style?.color || '#000000';
                        const bgColor = style?.backgroundColor || 'rgba(255,255,255,0.95)';
                        const textAlign = style?.textAlign || 'left';

                        // 背景矩形（非 inpainted 时）
                        if (!child.inpainted) {
                            textElements.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${bgColor}"/>`);
                        }

                        // 文字元素
                        const textAnchor = textAlign === 'center' ? 'middle' : textAlign === 'right' ? 'end' : 'start';
                        const textX = textAlign === 'center' ? x + w / 2 : textAlign === 'right' ? x + w - 4 : x + 4;

                        // 处理多行和自动换行
                        const lines = displayText.split('\n');
                        const lineHeight = fontSize * 1.3;
                        let lineY = y + fontSize + 4;

                        for (const line of lines) {
                            if (line.trim()) {
                                const escapedText = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                textElements.push(`<text x="${textX}" y="${lineY}" font-family="${fontFamily}" font-size="${fontSize}" fill="${color}" text-anchor="${textAnchor}">${escapedText}</text>`);
                            }
                            lineY += lineHeight;
                        }
                    }
                }

                // 在 </svg> 前插入文字元素
                if (textElements.length > 0) {
                    mergedSvg = mergedSvg.replace('</svg>', textElements.join('\n') + '\n</svg>');
                }
            }

            result.svg = mergedSvg;
            result.type = 'svg';
            result.dataUrl = generateDataUrl();
        } else {
            result.dataUrl = generateDataUrl();
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
        // 优先使用传入的 element.editParams（适用于 SVG 等通过临时对象传入的情况）
        if (this.element?.editParams?.layers) {
            return this.element.editParams.layers;
        }
        // 其次从 document 获取（适用于普通图片元素）
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
