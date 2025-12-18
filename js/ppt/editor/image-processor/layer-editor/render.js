/**
 * LayerEditor 渲染模块
 * 从 layer-editor.js 拆分出的渲染相关方法
 */

import { ensureFontLoaded } from './text-overlay.js';

/**
 * 渲染 mixin
 */
export const RenderMixin = {
    /**
     * 主渲染方法
     */
    _render() {
        if (!this.processedImage || !this.ctx) return;
        
        const { layers } = this.processedImage;
        
        // 清空 canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // 清空 SVG 容器
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        if (svgContainer) {
            svgContainer.style.pointerEvents = (this.pathSelectMode || this.drawBboxMode) ? 'auto' : 'none';
            svgContainer.innerHTML = '';
        }
        
        // 递归渲染图层函数
        const renderLayer = (layer) => {
            if (layer.visible === false) return;

            if (layer.type === 'group') {
                // 文字识别组：先绘制 inpainted background（如果有且开启）
                if (layer.textOverlayConfig && layer.inpaintedBackground && layer.showInpaintedBg !== false) {
                    const { canvas: bgCanvas } = layer.inpaintedBackground;
                    if (bgCanvas) {
                        this.ctx.drawImage(bgCanvas, 0, 0);
                    }
                }
                // 渲染组内所有子图层
                layer.children?.forEach(child => renderLayer(child));
                return;
            }
            
            if (layer.type === 'subgroup') {
                // 渲染子组内所有图层
                layer.children?.forEach(child => renderLayer(child));
                return;
            }

            switch (layer.type) {
                case 'original':
                    // 使用 processedImage.original.element 绘制原图
                    if (this.processedImage.original?.element) {
                        this.ctx.drawImage(this.processedImage.original.element, 0, 0);
                    } else if (layer.image) {
                        this.ctx.drawImage(layer.image, 0, 0);
                    }
                    break;
                case 'vector':
                    this._renderVectorLayer(layer, svgContainer);
                    break;
                case 'text-overlay':
                    this._drawTextOverlayLayer(layer, svgContainer);
                    break;
                case 'sam-layer':
                    // 渲染 SAM 分割图层
                    if (layer.canvas) {
                        this.ctx.drawImage(layer.canvas, 0, 0);
                    }
                    break;
            }
        };

        // 绘制可见图层
        for (const layer of layers) {
            renderLayer(layer);
        }
        
        // 更新图层列表选中状态
        this._updateLayerList();

        // 元素选择模式覆盖层（render 会清空 svgContainer，需要在末尾重建）
        if (this.elementSelectMode && this._elementSelectLayerId) {
            const layer = this.processedImage.layers?.find?.((l) => l.id === this._elementSelectLayerId);
            if (layer?.elements?.length) {
                this._createElementOverlay?.(layer);
            } else {
                this._exitElementSelectMode?.();
            }
        }
    },

    /**
     * 渲染矢量图层
     */
    _renderVectorLayer(layer, container) {
        if (!layer.svg || !container) return;
        
        const wrapper = document.createElement('div');
        wrapper.className = 'vector-layer-wrapper';
        wrapper.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: ${this.pathSelectMode ? 'all' : 'none'};
        `;
        wrapper.innerHTML = layer.svg;
        
        // 设置 SVG 样式
        const svg = wrapper.querySelector('svg');
        if (svg) {
            svg.style.cssText = `
                width: 100%;
                height: 100%;
                display: block;
            `;
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        }
        
        container.appendChild(wrapper);
    },

    /**
     * 渲染组图层
     */
    _renderGroupLayer(layer, container) {
        if (!layer.children || !container) return;
        
        // 如果是 OCR 文字组，特殊处理
        if (layer.ocrGroup) {
            this._renderOcrGroup(layer, container);
            return;
        }
        
        // 普通矢量组
        for (const child of layer.children) {
            if (!child.visible) continue;
            
            if (child.type === 'vector') {
                this._renderVectorLayer(child, container);
            } else if (child.type === 'subgroup') {
                // 递归渲染子组
                this._renderSubgroup(child, container);
            }
        }
    },

    /**
     * 渲染子组
     */
    _renderSubgroup(subgroup, container) {
        if (!subgroup.children || !subgroup.visible) return;
        
        for (const child of subgroup.children) {
            if (!child.visible) continue;
            
            if (child.type === 'vector') {
                this._renderVectorLayer(child, container);
            }
        }
    },

    /**
     * 渲染 OCR 文字组
     */
    _renderOcrGroup(layer, container) {
        if (!layer.children) return;
        
        for (const child of layer.children) {
            if (!child.visible || child.type !== 'text-overlay') continue;
            
            this._drawTextOverlayLayer(child, container);
        }
    },

    /**
     * 绘制文字覆盖图层
     */
    _drawTextOverlayLayer(layer, container) {
        if (!layer.bbox || !container) return;
        
        const { left, top, width, height } = layer.bbox;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
        
        // 创建文字容器
        const textDiv = document.createElement('div');
        textDiv.className = 'text-overlay-layer';
        textDiv.dataset.regionId = layer.id;
        
        // 计算像素位置
        const pxLeft = left * canvasWidth;
        const pxTop = top * canvasHeight;
        const pxWidth = width * canvasWidth;
        const pxHeight = height * canvasHeight;
        
        // 应用样式
        const style = layer.style || {};
        const bgColor = style.backgroundColor || 'rgba(255, 255, 255, 0.95)';
        const textColor = style.color || '#000000';
        const fontSize = style.fontSize || 14;
        const fontWeight = style.fontWeight || 'normal';
        const textAlign = style.textAlign || 'left';
        const fontFamily = style.fontFamily || 'system-ui, sans-serif';
        
        // 异步加载自定义字体（不阻塞渲染，加载完成后浏览器自动刷新显示）
        if (style.fontFamily) {
            ensureFontLoaded(style.fontFamily).then(() => {
                // 字体加载完成，浏览器会自动用新字体渲染
            });
        }
        
        // 查找父组和子索引
        const parentLayer = this.processedImage.layers.find(l => 
            l.type === 'group' && l.children?.some(c => c.id === layer.id)
        );
        const parentIndex = this.processedImage.layers.indexOf(parentLayer);
        const childIndex = parentLayer?.children?.findIndex(c => c.id === layer.id) ?? -1;
        // 使用 _isChildSelected 检查多选状态
        const isSelected = this._isChildSelected?.(parentIndex, childIndex) ||
            (parentIndex === this.selectedLayerIndex && childIndex === this.selectedChildIndex);
        
        // 禁用鼠标事件，让事件穿透到 canvas 进行拖拽
        textDiv.style.cssText = `
            position: absolute;
            left: ${pxLeft}px;
            top: ${pxTop}px;
            width: ${pxWidth}px;
            height: ${pxHeight}px;
            background: ${layer.inpainted ? 'transparent' : bgColor};
            color: ${textColor};
            font-family: ${fontFamily};
            font-size: ${fontSize}px;
            font-weight: ${fontWeight};
            text-align: ${textAlign};
            display: flex;
            align-items: center;
            justify-content: ${textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start'};
            padding: 4px;
            box-sizing: border-box;
            overflow: hidden;
            word-break: break-word;
            line-height: 1.3;
            pointer-events: none;
            cursor: default;
        `;
        
        // 创建文本内容
        const textContent = document.createElement('span');
        const displayText = layer.content?.displayText || layer.content?.originalText || layer.translatedText || layer.text || '';
        textContent.textContent = displayText;
        textDiv.appendChild(textContent);
        
        // 如果是选中状态，添加边框和调整手柄
        if (isSelected) {
            textDiv.style.outline = '2px solid #4f46e5';
            textDiv.style.outlineOffset = '1px';
            this._addBboxHandles(textDiv, layer);
        }
        
        container.appendChild(textDiv);
    },

    /**
     * 添加 Bbox 调整手柄
     */
    _addBboxHandles(container, layer) {
        const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        
        handles.forEach(pos => {
            const handle = document.createElement('div');
            handle.className = 'bbox-handle';
            handle.dataset.handle = pos;
            handle.dataset.regionId = layer.id;
            
            let top = '50%', left = '50%', cursor = 'move';
            
            switch (pos) {
                case 'nw': top = '0'; left = '0'; cursor = 'nw-resize'; break;
                case 'n': top = '0'; left = '50%'; cursor = 'n-resize'; break;
                case 'ne': top = '0'; left = '100%'; cursor = 'ne-resize'; break;
                case 'e': top = '50%'; left = '100%'; cursor = 'e-resize'; break;
                case 'se': top = '100%'; left = '100%'; cursor = 'se-resize'; break;
                case 's': top = '100%'; left = '50%'; cursor = 's-resize'; break;
                case 'sw': top = '100%'; left = '0'; cursor = 'sw-resize'; break;
                case 'w': top = '50%'; left = '0'; cursor = 'w-resize'; break;
            }
            
            handle.style.cssText = `
                position: absolute;
                width: 8px;
                height: 8px;
                background: #4f46e5;
                border: 1px solid white;
                border-radius: 2px;
                top: ${top};
                left: ${left};
                transform: translate(-50%, -50%);
                cursor: ${cursor};
                z-index: 10;
            `;
            
            container.appendChild(handle);
        });
    },

    /**
     * 检查图层是否被选中
     */
    _isLayerSelected(layer) {
        if (this.selectedLayerIndex < 0) return false;
        const selectedLayer = this.processedImage.layers[this.selectedLayerIndex];
        if (!selectedLayer) return false;
        
        if (selectedLayer.id === layer.id) return true;
        
        // 检查是否是子图层被选中
        if (selectedLayer.children && this.selectedChildIndex >= 0) {
            const child = selectedLayer.children[this.selectedChildIndex];
            return child?.id === layer.id;
        }
        
        return false;
    }
};
