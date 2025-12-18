/**
 * LayerEditor 矢量化模块
 * 从 layer-editor.js 拆分出的矢量化相关方法
 */

function generateElementSvg(element, width, height, viewBoxWidth, viewBoxHeight) {
    return `<svg xmlns="http://www.w3.org/2000/svg" 
                 width="${width}" height="${height}" 
                 viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}">
        <path d="${element.pathD}" fill="${element.color}" fill-rule="evenodd"/>
    </svg>`;
}

/**
 * 矢量化 mixin
 */
export const VectorizeMixin = {

    /**
     * 执行矢量化
     */
    async _vectorize(preset = 'auto', options = {}, groupId = null) {
        this._showLoading('正在矢量化...');
        await this._nextFrame();
        
        try {
            // 加载矢量化模块
            const vectorizer = await this.processor.loadModule('vectorizer');
            
            // 自动检测预设
            let actualPreset = preset;
            if (preset === 'auto') {
                actualPreset = this._detectPreset({
                    element: this.processedImage.original.element,
                    width: this.processedImage.original.width,
                    height: this.processedImage.original.height
                });
            }
            
            console.log(`[LayerEditor] 矢量化: ${actualPreset}, Group: ${groupId || 'new'}`);
            
            // 获取默认配置
            const finalOptions = {
                numColors: 16,
                smoothness: 1,
                ...options
            };

            // 进度回调
            const onProgress = (progress, message) => {
                this._showLoading(message || `矢量化中... ${progress}%`);
            };
            
            // 检查是否有 inpainted background（带有去除文字的底图）
            // 如果有，使用它作为矢量化的源图
            let sourceImage = this.processedImage.original;
            const ocrGroup = this.processedImage.layers.find(
                l => l.type === 'group' && (l.textOverlayConfig || l.ocrGroup) && l.inpaintedBackground?.canvas
            );
            
            if (ocrGroup && ocrGroup.inpaintedBackground?.canvas) {
                console.log('[LayerEditor] 使用去文字底图进行矢量化');
                const bgCanvas = ocrGroup.inpaintedBackground.canvas;
                // 构造与 original 相同格式的对象
                sourceImage = {
                    element: bgCanvas,
                    width: bgCanvas.width,
                    height: bgCanvas.height,
                    imageData: ocrGroup.inpaintedBackground.ctx.getImageData(0, 0, bgCanvas.width, bgCanvas.height)
                };
            }
            
            // 执行矢量化
            const vectorResult = await vectorizer.vectorize(sourceImage, actualPreset, onProgress);
            
            // 按颜色分层
            const colorLayers = vectorizer.splitByColor(vectorResult);
            
            if (!colorLayers || colorLayers.length === 0) {
                this._showToast('矢量化结果为空');
                return;
            }
            
            // 生成 Group ID
            const currentGroupId = groupId || `vec_group_${Date.now()}`;
            
            // 计算已有矢量化分组数量
            const existingGroupCount = this.processedImage.layers.filter(
                l => l.type === 'group' && l.vectorConfig
            ).length;
            const groupNumber = existingGroupCount + 1;
            
            // 预设名称映射
            const presetNames = this._getPresets();
            const presetLabel = presetNames[actualPreset] || actualPreset;

            // elements（元素级选择）
            const displayWidth = vectorResult?.width || sourceImage?.width || this.canvas.width;
            const displayHeight = vectorResult?.height || sourceImage?.height || this.canvas.height;
            const viewBoxWidth = vectorResult?.viewBoxWidth || displayWidth;
            const viewBoxHeight = vectorResult?.viewBoxHeight || displayHeight;

            const elements = Array.isArray(vectorResult?.elements)
                ? vectorResult.elements.map((element) => ({
                    ...element,
                    svg:
                        element.svg ||
                        generateElementSvg(element, displayWidth, displayHeight, viewBoxWidth, viewBoxHeight)
                }))
                : [];
            
            // 创建矢量组
            const groupLayer = {
                id: currentGroupId,
                type: 'group',
                name:
                    elements.length > 0
                        ? `矢量化 ${groupNumber} - ${presetLabel} (${elements.length} 元素, ${colorLayers.length} 颜色)`
                        : `矢量化 ${groupNumber} - ${presetLabel} (${colorLayers.length} 层)`,
                visible: true,
                expanded: true,
                vectorConfig: {
                    preset: actualPreset,
                    numColors: finalOptions.numColors,
                    smoothness: finalOptions.smoothness
                },
                elements,
                children: colorLayers.map((layer) => {
                    const colorElements = elements.filter((e) => e.color === layer.color);
                    return {
                        ...layer,
                        type: 'vector',
                        visible: true,
                        vectorGroupId: currentGroupId,
                        parentId: currentGroupId,
                        elements: colorElements
                    };
                })
            };
            
            // 如果是重新矢量化，替换旧组
            if (groupId) {
                const oldIndex = this.processedImage.layers.findIndex(l => l.id === groupId);
                if (oldIndex !== -1) {
                    this.processedImage.layers[oldIndex] = groupLayer;
                } else {
                    this._insertVectorGroupBeforeTextGroup(groupLayer);
                }
            } else {
                // 将矢量化图层插入到文字识别组的下方（在数组中的位置更靠前）
                this._insertVectorGroupBeforeTextGroup(groupLayer);
            }
            
            this._saveHistory();
            this._updateLayerList();
            
            // 选中新组
            const newIndex = this.processedImage.layers.findIndex(l => l.id === groupLayer.id);
            if (newIndex !== -1) {
                this.selectedLayerIndex = newIndex;
                this.selectedChildIndex = -1;
            }
            
                    this._render();
            
            // 自动选中新生成的组
            if (!groupId) {
                this._updateLayerList();
                this._updatePropertyPanel();
            }
            
            this._showToast(`矢量化完成: ${colorLayers.length} 个颜色图层`);
            
        } catch (error) {
            console.error('[LayerEditor] 矢量化失败:', error);
            this._showToast('矢量化失败: ' + error.message);
        } finally {
            this._hideLoading();
        }
    },

    /**
     * 重新矢量化
     */
    async _reVectorize(layer) {
        if (!layer.vectorConfig) {
            this._showVectorizePresetDialog();
            return;
        }
        
        const { preset, options } = layer.vectorConfig;
        await this._vectorize(preset, options, layer.id);
    },

    /**
     * 应用路径简化（组级别）
     */
    async _applySimplify(layer, level) {
        if (!layer || layer.type !== 'group' || !layer.children) return;
        
        const { simplifyPathD } = await import('../vecburner/path-simplifier.js');
        
        const preset = layer.vectorConfig?.preset || '';
        const preserveStroke = ['logo', 'lineart'].includes(preset);
        const simplifyOptions = { preserveStroke };
        
        for (const child of layer.children) {
            if (child.type === 'vector' && child.svg) {
                if (!child.originalSvg) {
                    child.originalSvg = child.svg;
                }
                
                if (level === 0) {
                    child.svg = child.originalSvg;
                } else {
                    const pathRegex = /<path([^>]*?)d="([^"]+)"([^>]*?)\/?>(?:<\/path>)?/g;
                    child.svg = child.originalSvg.replace(pathRegex, (match, before, d, after) => {
                        const simplified = simplifyPathD(d, level, simplifyOptions);
                        return `<path${before}d="${simplified}"${after}/>`;
                    });
                }
            }
        }
        
        this._render();
    },

    /**
     * 对单个子图层应用路径简化
     */
    async _applyChildSimplify(childLayer, level, parentLayer = null) {
        if (!childLayer || !childLayer.svg) return;
        
        if (!childLayer.originalSvg) {
            childLayer.originalSvg = childLayer.svg;
        }
        
        if (level === 0) {
            childLayer.svg = childLayer.originalSvg;
            childLayer.simplifyLevel = 0;
        } else {
            const { simplifyPathD } = await import('../vecburner/path-simplifier.js');
            
            const preset = parentLayer?.vectorConfig?.preset || '';
            const preserveStroke = ['logo', 'lineart'].includes(preset);
            const simplifyOptions = { preserveStroke };
            
            let svg = childLayer.originalSvg;
            const pathRegex = /<path([^>]*?)d="([^"]+)"([^>]*?)\/?>(?:<\/path>)?/g;
            
            svg = svg.replace(pathRegex, (match, before, d, after) => {
                const simplified = simplifyPathD(d, level, simplifyOptions);
                return `<path${before}d="${simplified}"${after}/>`;
            });
            
            childLayer.svg = svg;
            childLayer.simplifyLevel = level;
        }
        
        this._render();
    },

    /**
     * 去除背景
     */
    async _removeBackground() {
        this._showLoading('正在去除背景...');
        
        try {
            // 简单实现：使用矢量化移除最大面积的颜色
            const { vectorize } = await import('../vecburner/index.js');
            
            const originalLayer = this.processedImage.layers.find(l => l.type === 'original');
            if (!originalLayer?.image) {
                throw new Error('找不到原始图片');
            }
            
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.canvas.width;
            tempCanvas.height = this.canvas.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(originalLayer.image, 0, 0);
            const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
            
            // 使用 2 色矢量化
            const result = await vectorize(imageData, {
                preset: 'simple',
                numColors: 2
            });
            
            if (result?.layers?.length >= 2) {
                // 隐藏面积最大的图层（通常是背景）
                let maxArea = 0;
                let bgIndex = 0;
                
                result.layers.forEach((layer, idx) => {
                    const pathMatch = layer.svg?.match(/d="([^"]+)"/);
                    if (pathMatch) {
                        const pathLength = pathMatch[1].length;
                        if (pathLength > maxArea) {
                            maxArea = pathLength;
                            bgIndex = idx;
                        }
                    }
                });
                
                // 创建组，背景图层默认隐藏
                const vectorGroup = {
                    id: `vector_nobg_${Date.now()}`,
                    type: 'group',
                    name: '去背景结果',
                    visible: true,
                    expanded: true,
                    children: result.layers.map((layer, idx) => ({
                        id: `vector_${Date.now()}_${idx}`,
                        type: 'vector',
                        name: idx === bgIndex ? '背景 (已隐藏)' : '前景',
                        color: layer.color || '#000000',
                        svg: layer.svg,
                        visible: idx !== bgIndex
                    }))
                };
                
                this.processedImage.layers.push(vectorGroup);
                this._saveHistory();
                this._render();
                this._updateLayerList();
                
                this._showToast('背景已去除');
            } else {
                this._showToast('无法识别背景');
            }
            
        } catch (error) {
            console.error('[LayerEditor] 去背景失败:', error);
            this._showToast('去背景失败: ' + error.message);
        } finally {
            this._hideLoading();
        }
    },

    /**
     * 将矢量化图层插入到文字识别组的下方
     * 在渲染顺序中，数组索引越小渲染越早（在下层）
     */
    _insertVectorGroupBeforeTextGroup(vectorGroup) {
        const layers = this.processedImage.layers;
        
        // 查找文字识别组的索引
        const textGroupIndex = layers.findIndex(
            l => l.type === 'group' && (l.textOverlayConfig || l.ocrGroup)
        );
        
        if (textGroupIndex > 0) {
            // 插入到文字识别组的前面（即渲染顺序在其下方）
            layers.splice(textGroupIndex, 0, vectorGroup);
        } else {
            // 没有文字识别组，直接添加到末尾
            layers.push(vectorGroup);
        }
    }
};
