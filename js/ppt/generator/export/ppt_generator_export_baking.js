/**
 * PPTGenerator 导出模块 - 特效烘焙
 * 包含: 特效检测、分层烘焙、图片预加载
 * 
 * 依赖: ppt_generator_export_image.js
 */

const PPTGeneratorExportBaking = {
    // ═══════════════════════════════════════════════════════════════
    // 辅助函数：精确检测透明渐变
    // ═══════════════════════════════════════════════════════════════

    /**
     * 检测颜色是否透明（alpha < 0.1）
     */
    _isTransparentColor(color) {
        if (!color) return false;
        const c = color.trim().toLowerCase();
        if (c === 'transparent') return true;
        const rgbaMatch = c.match(/rgba\s*\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
        if (rgbaMatch) {
            return parseFloat(rgbaMatch[1]) < 0.1;
        }
        return false;
    },

    /**
     * 解析渐变字符串中的颜色停止点
     */
    _parseGradientStops(gradientStr) {
        if (!gradientStr || !gradientStr.includes('gradient')) return [];

        // 提取括号内内容，需要处理嵌套括号（如 rgba()）
        const startIdx = gradientStr.indexOf('(');
        if (startIdx === -1) return [];

        let depth = 0;
        let endIdx = -1;
        for (let i = startIdx; i < gradientStr.length; i++) {
            if (gradientStr[i] === '(') depth++;
            else if (gradientStr[i] === ')') {
                depth--;
                if (depth === 0) {
                    endIdx = i;
                    break;
                }
            }
        }
        if (endIdx === -1) return [];

        const content = gradientStr.slice(startIdx + 1, endIdx);
        const stops = [];
        const colorPattern = /(transparent|#[0-9a-f]{3,8}|rgba?\s*\([^)]+\))\s*(\d+%)?/gi;
        let colorMatch;

        while ((colorMatch = colorPattern.exec(content)) !== null) {
            const color = colorMatch[1];
            const pos = colorMatch[2] ? parseFloat(colorMatch[2]) / 100 : null;
            stops.push({ color, position: pos });
        }

        if (stops.length > 0) {
            if (stops[0].position === null) stops[0].position = 0;
            if (stops[stops.length - 1].position === null) stops[stops.length - 1].position = 1;
        }
        return stops;
    },

    /**
     * 检测渐变是否包含透明色停止点
     */
    _hasTransparentStop(gradientStr) {
        const stops = this._parseGradientStops(gradientStr);
        return stops.some(s => this._isTransparentColor(s.color));
    },

    // ═══════════════════════════════════════════════════════════════
    // 特效烘焙主入口
    // ═══════════════════════════════════════════════════════════════
    
    async _bakeEffectsForPPTX(slides, onProgress, options = {}) {
        // 如果图表模式是 SVG，先转换所有 chart 元素
        console.log('[bakeEffects] chartMode:', options.chartMode);
        if (options.chartMode === 'svg') {
            console.log('[bakeEffects] Converting charts to SVG...');
            slides = this._convertChartsToSvg(slides);
        }
        
        const needsBaking = slides.some(slide => this._slideHasEffects(slide));
        if (!needsBaking) {
            onProgress?.(100, '无需处理特效');
            return slides;
        }
        
        let completed = 0;
        const total = slides.length;

        if (typeof html2canvas === 'undefined') {
            await this._loadScript('https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js');
        }

        const renderer = new HTMLSlideRenderer();
        const startTime = performance.now();
        
        const CONCURRENCY = Math.min(navigator.hardwareConcurrency || 4, 8);
        
        const containerPool = [];
        for (let i = 0; i < CONCURRENCY; i++) {
            const container = document.createElement('div');
            container.style.cssText = `position: fixed; left: -9999px; top: ${i * 550}px; width: 960px; height: 540px; z-index: -9999;`;
            document.body.appendChild(container);
            containerPool.push({ container, inUse: false });
        }
        
        const getContainer = () => {
            const available = containerPool.find(c => !c.inUse);
            if (available) {
                available.inUse = true;
                return available;
            }
            return null;
        };
        
        const releaseContainer = (poolItem) => {
            poolItem.inUse = false;
        };

        const processSlide = async (slide, index) => {
            if (!this._slideHasEffects(slide)) {
                const processedSlide = await this._preloadSlideImages(slide);
                return { index, slide: processedSlide };
            }

            let poolItem;
            while (!(poolItem = getContainer())) {
                await new Promise(r => setTimeout(r, 10));
            }
            const container = poolItem.container;

            try {
                const sortedElements = [...(slide.elements || [])]
                    .map((el, i) => ({ ...el, _originalIndex: i }))
                    .sort((a, b) => (a.z || 0) - (b.z || 0) || a._originalIndex - b._originalIndex);

                const blendElements = sortedElements.filter(el => el.blend && el.blend !== 'normal');
                
                let processedElements;
                
                if (blendElements.length > 0) {
                    processedElements = await this._bakeBlendSlide(slide, sortedElements, blendElements, renderer, container);
                } else {
                    processedElements = await this._bakeFilterSlide(slide, sortedElements, renderer, container, index);
                }
                
                return {
                    index,
                    slide: { ...slide, elements: processedElements }
                };
            } finally {
                releaseContainer(poolItem);
            }
        };

        const results = await Promise.all(
            slides.map(async (slide, index) => {
                const result = await processSlide(slide, index);
                completed++;
                onProgress?.((completed / total) * 100, `处理幻灯片 ${completed}/${total}`);
                return result;
            })
        );
        
        results.sort((a, b) => a.index - b.index);
        const bakedSlides = results.map(r => r.slide);

        containerPool.forEach(p => document.body.removeChild(p.container));
        
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
        console.log(`[Baking] Completed in ${elapsed}s (${CONCURRENCY} concurrent)`);
        
        return bakedSlides;
    },
    
    // ═══════════════════════════════════════════════════════════════
    // Blend 效果烘焙
    // ═══════════════════════════════════════════════════════════════
    
    async _bakeBlendSlide(slide, sortedElements, blendElements, renderer, container) {
        const visualTypes = ['shape', 'image', 'svg', 'line'];
        const maxBlendZ = Math.max(...blendElements.map(el => el.z || 0));
        
        const elementsTosBake = sortedElements.filter(el => 
            (el.z || 0) <= maxBlendZ && visualTypes.includes(el.type)
        );
        const nativeElements = sortedElements.filter(el => 
            (el.z || 0) > maxBlendZ || !visualTypes.includes(el.type)
        );
        
        const effectEls = elementsTosBake.filter(el => this._elementNeedsBaking(el));
        const backdropEls = elementsTosBake.filter(el => !this._elementNeedsBaking(el));
        
        const bakedEl = await this._bakeElementGroupToImage(
            effectEls,
            renderer, 
            container, 
            backdropEls,
            slide.gradient || slide.background
        );
        
        const processedElements = [];
        if (bakedEl) {
            processedElements.push(bakedEl);
        } else {
            processedElements.push(...elementsTosBake);
        }
        processedElements.push(...nativeElements);
        
        return processedElements;
    },
    
    // ═══════════════════════════════════════════════════════════════
    // Filter/Mask 效果烘焙
    // ═══════════════════════════════════════════════════════════════
    
    async _bakeFilterSlide(slide, sortedElements, renderer, container, slideIndex) {
        const visualTypes = ['shape', 'image', 'svg', 'line'];
        const processedElements = [];
        
        for (const el of sortedElements) {
            const needsBaking = this._elementNeedsBaking(el) && visualTypes.includes(el.type);
            
            if (needsBaking) {
                // 每个需要烘焙的元素单独处理，避免边界框过大
                const bakedEl = await this._bakeElementGroupToImage(
                    [el], 
                    renderer, 
                    container, 
                    [],
                    'transparent'
                );
                if (bakedEl) {
                    bakedEl.z = el.z || 0;
                    bakedEl._originalIndex = el._originalIndex;
                    processedElements.push(bakedEl);
                } else {
                    processedElements.push(el);
                }
            } else {
                processedElements.push(el);
            }
        }
        
        return processedElements;
    },

    _groupElementsForBaking(sortedElements) {
        const groups = [];
        let currentGroup = null;

        for (const el of sortedElements) {
            const needsBaking = this._elementNeedsBaking(el);
            const groupType = needsBaking ? 'effect' : 'normal';

            if (!currentGroup || currentGroup.type !== groupType) {
                currentGroup = { type: groupType, elements: [] };
                groups.push(currentGroup);
            }

            currentGroup.elements.push(el);
        }

        return groups;
    },

    // ═══════════════════════════════════════════════════════════════
    // 元素组烘焙
    // ═══════════════════════════════════════════════════════════════

    async _bakeElementGroupToImage(elements, renderer, container, backdropElements = [], backgroundFill = 'transparent') {
        if (!elements || elements.length === 0) return null;

        try {
            const minZ = Math.min(...elements.map(el => el.z || 0));
            const hasBlend = elements.some(el => el.blend && el.blend !== 'normal');

            const combinedElements = [...backdropElements, ...elements].sort((a, b) => (a.z || 0) - (b.z || 0));

            const tempSlide = {
                type: 'freeform',
                background: backgroundFill || 'transparent',
                elements: combinedElements,
            };

            const bgStyle = backgroundFill ? `background: ${backgroundFill};` : 'background: transparent;';
            container.innerHTML = `<div style="width: 960px; height: 540px; overflow: visible; ${bgStyle}">${renderer.render(tempSlide, 0)}</div>`;
            
            const imgDivs = container.querySelectorAll('div > img');
            const maskedElements = [...imgDivs]
                .map(img => img.parentElement)
                .filter(div => {
                    const s = div.getAttribute('style') || '';
                    return s.includes('mask-image') || s.includes('clip-path');
                });
            if (maskedElements.length > 0) {
                console.log(`[_bakeElementGroupToImage] Found ${maskedElements.length} masked elements`);
                await Promise.all(maskedElements.map(el => this._bakeMaskIntoElement(el)));
            }
            
            container.querySelectorAll('svg[style*="width: 0"], svg[style*="height: 0"]').forEach(svg => svg.remove());

            await Promise.all([this._waitForIconsToLoad(container), this._waitForImagesToLoad(container)]);
            
            if (hasBlend) {
                const svgImgs = container.querySelectorAll('img[src^="data:image/svg"]');
                await Promise.all([...svgImgs].map(async img => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth || img.width || 100;
                        canvas.height = img.naturalHeight || img.height || 100;
                        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                        img.src = canvas.toDataURL('image/png');
                        await new Promise(r => { img.onload = r; setTimeout(r, 50); });
                    } catch (e) { /* ignore */ }
                }));
            }
            await this._waitForKatexAndInlineStyles(container);

            const scale = 1.2;
            
            let canvas;
            if (hasBlend) {
                canvas = await this._captureWithBlend(container, combinedElements, backgroundFill, scale);
            } else {
                const hasBlurFilter = elements.some(el => el.filter && el.filter.includes('blur'));
                canvas = await this._captureToCanvas(container.firstChild, {
                    scale,
                    useCORS: true,
                    allowTaint: false,
                    backgroundColor: backgroundFill || null,
                    logging: false,
                    foreignObjectRendering: hasBlurFilter,
                }, {
                    foreignObjectRendering: hasBlurFilter,
                    allowTaint: true,
                });
            }

            // 计算元素的边界框（百分比）
            // 当有 backdrop 元素参与渲染时，边界框应包含所有渲染的元素
            const boundsElements = backdropElements.length > 0 ? combinedElements : elements;
            const bounds = this._calculateElementsBounds(boundsElements);
            const boundsX = this._parsePercent(bounds.x);
            const boundsY = this._parsePercent(bounds.y);
            const boundsW = this._parsePercent(bounds.w);
            const boundsH = this._parsePercent(bounds.h);
            
            let dataUrl = null;
            if (canvas) {
                // 裁剪到边界框区域
                const cropX = Math.round(boundsX / 100 * canvas.width);
                const cropY = Math.round(boundsY / 100 * canvas.height);
                const cropW = Math.round(boundsW / 100 * canvas.width);
                const cropH = Math.round(boundsH / 100 * canvas.height);
                
                if (cropW > 0 && cropH > 0) {
                    // 检测是否有半透明渐变元素，需要裁剪顶部边缘伪影
                    // 使用精确检测：渐变中是否真的包含透明色停止点
                    const hasTransparentGradient = elements.some(el =>
                        el.fill && typeof el.fill === 'string' &&
                        el.fill.includes('gradient') &&
                        this._hasTransparentStop(el.fill)
                    );

                    // 半透明渐变裁剪量：只裁剪顶部（黑线伪影主要出现在透明边缘）
                    const trimLeft = 0;
                    const trimRight = 0;
                    const trimTop = hasTransparentGradient ? 12 : 0;
                    const trimBottom = hasTransparentGradient ? 4 : 0;
                    
                    const adjustedCropX = cropX + trimLeft;
                    const adjustedCropY = cropY + trimTop;
                    const adjustedCropW = Math.max(cropW - trimLeft - trimRight, 1);
                    const adjustedCropH = Math.max(cropH - trimTop - trimBottom, 1);
                    
                    const croppedCanvas = document.createElement('canvas');
                    croppedCanvas.width = adjustedCropW;
                    croppedCanvas.height = adjustedCropH;
                    const ctx = croppedCanvas.getContext('2d');
                    ctx.drawImage(canvas, adjustedCropX, adjustedCropY, adjustedCropW, adjustedCropH, 0, 0, adjustedCropW, adjustedCropH);
                    dataUrl = croppedCanvas.toDataURL('image/png');
                    croppedCanvas.width = 0;
                    croppedCanvas.height = 0;
                    
                    // 调整边界框位置和尺寸补偿裁剪
                    if (trimLeft || trimRight || trimTop || trimBottom) {
                        const trimLeftPct = trimLeft / canvas.width * 100;
                        const trimRightPct = trimRight / canvas.width * 100;
                        const trimTopPct = trimTop / canvas.height * 100;
                        const trimBottomPct = trimBottom / canvas.height * 100;
                        bounds.x = (boundsX + trimLeftPct) + '%';
                        bounds.y = (boundsY + trimTopPct) + '%';
                        bounds.w = (boundsW - trimLeftPct - trimRightPct) + '%';
                        bounds.h = (boundsH - trimTopPct - trimBottomPct) + '%';
                    }
                } else {
                    dataUrl = canvas.toDataURL('image/png');
                }
                canvas.width = 0;
                canvas.height = 0;
            }
            if (!dataUrl) return null;
            
            return {
                type: 'baked_element',
                image: dataUrl,
                x: bounds.x,
                y: bounds.y,
                w: bounds.w,
                h: bounds.h,
                z: minZ,
                originalElements: elements.length,
                originalTypes: elements.map(el => el.type).join(','),
            };
        } catch (e) {
            console.warn('[_bakeElementGroupToImage] Failed to bake element group:', e);
            return null;
        }
    },

    async _renderElementsToCanvas(elements, renderer, container, opts = {}) {
        if (!elements) return null;
        const sanitized = opts.disableBlend ? this._cloneElementsWithoutBlend(elements) : elements;
        const tempSlide = {
            type: 'freeform',
            background: opts.backgroundColor ?? 'transparent',
            elements: sanitized || [],
        };

        const bgStyle = opts.backgroundColor ? `background: ${opts.backgroundColor};` : 'background: transparent;';
        container.innerHTML = `<div style="width: 960px; height: 540px; overflow: visible; ${bgStyle}">${renderer.render(tempSlide, 0)}</div>`;
        await this._waitForIconsToLoad(container);
        await this._waitForImagesToLoad(container);
        await this._waitForKatexAndInlineStyles(container);

        const scale = opts.scale ?? 3;
        const canvas = await this._captureToCanvas(container.firstChild, {
            scale,
            useCORS: true,
            allowTaint: opts.allowTaint ?? false,
            backgroundColor: opts.backgroundColor ?? null,
            logging: false,
            foreignObjectRendering: opts.foreignObjectRendering ?? true,
        }, {
            foreignObjectRendering: false,
            allowTaint: true,
        });

        return canvas;
    },

    _cloneElementsWithoutBlend(elements) {
        return (elements || []).map(el => {
            const cloned = { ...el };
            if (cloned.blend && cloned.blend !== 'normal') {
                cloned._origBlend = cloned.blend;
                cloned.blend = 'normal';
            }
            if (cloned.children) {
                cloned.children = this._cloneElementsWithoutBlend(cloned.children);
            }
            return cloned;
        });
    },

    _mapBlendToComposite(blend) {
        if (!blend || blend === 'normal') return 'source-over';
        const map = {
            multiply: 'multiply',
            screen: 'screen',
            overlay: 'overlay',
            darken: 'darken',
            lighten: 'lighten',
            'color-dodge': 'color-dodge',
            'color-burn': 'color-burn',
            'hard-light': 'hard-light',
            'soft-light': 'soft-light',
            difference: 'difference',
            exclusion: 'exclusion',
        };
        return map[blend] || 'source-over';
    },

    async _manualBlendComposite(elements, backdropElements, renderer, container, scale = 3, backgroundFill = 'transparent') {
        try {
            const width = Math.round(960 * scale);
            const height = Math.round(540 * scale);
            const baseCanvas = document.createElement('canvas');
            baseCanvas.width = width;
            baseCanvas.height = height;
            const ctx = baseCanvas.getContext('2d');
            if (!ctx) return null;

            if (backgroundFill && backgroundFill !== 'transparent') {
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillStyle = backgroundFill;
                ctx.fillRect(0, 0, width, height);
            }

            const backdropCanvas = await this._renderElementsToCanvas(backdropElements, renderer, container, {
                scale,
                backgroundColor: backgroundFill || 'transparent',
                foreignObjectRendering: true,
                allowTaint: false,
            });
            if (backdropCanvas) {
                ctx.globalCompositeOperation = 'source-over';
                ctx.drawImage(backdropCanvas, 0, 0);
            }

            const sorted = [...elements].sort((a, b) => (a.z || 0) - (b.z || 0));
            for (const el of sorted) {
                const elCanvas = await this._renderElementsToCanvas([el], renderer, container, {
                    scale,
                    backgroundColor: null,
                    foreignObjectRendering: true,
                    allowTaint: false,
                    disableBlend: true,
                });
                if (!elCanvas) continue;
                ctx.globalCompositeOperation = this._mapBlendToComposite(el.blend);
                ctx.drawImage(elCanvas, 0, 0);
            }

            ctx.globalCompositeOperation = 'source-over';
            return baseCanvas.toDataURL('image/png');
        } catch (e) {
            console.warn('[_manualBlendComposite] fallback failed:', e);
            return null;
        }
    },

    _calculateGroupBounds(elements) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const el of elements) {
            const x = this._parsePercent(el.x) || 0;
            const y = this._parsePercent(el.y) || 0;
            const w = this._parsePercent(el.w) || 10;
            const h = this._parsePercent(el.h) || 10;

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        }

        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    },

    _parsePercent(value) {
        if (typeof value === 'number') return value;
        const str = String(value).trim();
        if (str.endsWith('%')) return parseFloat(str);
        return parseFloat(str) || 0;
    },

    // ═══════════════════════════════════════════════════════════════
    // 效果检测
    // ═══════════════════════════════════════════════════════════════
    
    _slideHasEffects(slide) {
        if (!slide) return false;
        if (slide.elements && slide.elements.some(el => this._elementNeedsBaking(el))) return true;
        return false;
    },

    _elementNeedsBaking(el) {
        if (!el) return false;
        if (el.blend && el.blend !== 'normal') return true;
        if (el.filter) return true;
        if (el.mask) return true;
        // blur 效果需要烘焙
        if (el.effect && el.effect.includes('blur')) return true;
        // 所有渐变背景都需要烘焙（PPTX 不支持 CSS 渐变语法）
        if (el.fill && typeof el.fill === 'string' && el.fill.includes('gradient')) {
            return true;
        }
        if (el.type === 'svg' && el.content) {
            const content = el.content.toLowerCase();
            if (content.includes('<text')) return false;
            const hasComplexFeatures = content.includes('<pattern') || 
                content.includes('<clippath') || content.includes('<mask') ||
                content.includes('marker-end') || content.includes('marker-start');
            if (hasComplexFeatures) return true;
        }
        if (el.children && el.children.some(child => this._elementNeedsBaking(child))) return true;
        return false;
    },

    _elementHasEffects(el) {
        if (!el) return false;
        if ((el.blend && el.blend !== 'normal') || el.mask || el.filter) return true;
        if (el.children && el.children.some(child => this._elementHasEffects(child))) return true;
        return false;
    },

    /**
     * 计算元素组的边界框
     */
    _calculateElementsBounds(elements) {
        if (!elements || elements.length === 0) {
            return { x: '0%', y: '0%', w: '100%', h: '100%' };
        }
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        elements.forEach(el => {
            const x = this._parsePercent(el.x) || 0;
            const y = this._parsePercent(el.y) || 0;
            const w = this._parsePercent(el.w) || 0;
            const h = this._parsePercent(el.h) || 0;
            
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        });
        
        // 添加一点边距避免裁剪边缘
        const padding = 1;
        minX = Math.max(0, minX - padding);
        minY = Math.max(0, minY - padding);
        maxX = Math.min(100, maxX + padding);
        maxY = Math.min(100, maxY + padding);
        
        return {
            x: minX + '%',
            y: minY + '%',
            w: (maxX - minX) + '%',
            h: (maxY - minY) + '%',
        };
    },
    
    _parsePercent(value) {
        if (typeof value === 'number') return value;
        if (typeof value === 'string' && value.endsWith('%')) {
            return parseFloat(value);
        }
        return 0;
    },

    // ═══════════════════════════════════════════════════════════════
    // 图片预加载
    // ═══════════════════════════════════════════════════════════════

    async _preloadSlideImages(slide) {
        if (!slide.elements) return slide;
        
        const SLIDE_W = 10;
        const SLIDE_H = 5.625;
        
        const processedElements = await Promise.all(slide.elements.map(async (el) => {
            if (el.type === 'image' && el.src && !el.src.startsWith('data:')) {
                try {
                    const response = await fetch(el.src);
                    const blob = await response.blob();
                    const base64 = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                    
                    const img = new Image();
                    await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = reject;
                        img.src = base64;
                    });
                    
                    const fitMode = el.fit || 'cover';
                    
                    if ((fitMode === 'cover' || fitMode === 'contain') && el.w && el.h) {
                        const containerW = parseFloat(el.w) / 100 * SLIDE_W;
                        const containerH = parseFloat(el.h) / 100 * SLIDE_H;
                        const containerRatio = containerW / containerH;
                        const imgRatio = img.naturalWidth / img.naturalHeight;
                        
                        if (Math.abs(imgRatio - containerRatio) > 0.01) {
                            if (fitMode === 'cover') {
                                const canvas = document.createElement('canvas');
                                const ctx = canvas.getContext('2d');
                                
                                let sx, sy, sw, sh;
                                if (imgRatio > containerRatio) {
                                    sh = img.naturalHeight;
                                    sw = sh * containerRatio;
                                    sx = (img.naturalWidth - sw) / 2;
                                    sy = 0;
                                } else {
                                    sw = img.naturalWidth;
                                    sh = sw / containerRatio;
                                    sx = 0;
                                    sy = (img.naturalHeight - sh) / 2;
                                }
                                
                                canvas.width = sw;
                                canvas.height = sh;
                                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
                                
                                const croppedBase64 = canvas.toDataURL('image/png');
                                canvas.width = 0;
                                canvas.height = 0;
                                
                                return { ...el, src: croppedBase64, fit: 'fill' };
                            } else {
                                const elX = parseFloat(el.x) / 100 * SLIDE_W;
                                const elY = parseFloat(el.y) / 100 * SLIDE_H;
                                let newW, newH, newX, newY;
                                
                                if (imgRatio > containerRatio) {
                                    newW = containerW;
                                    newH = containerW / imgRatio;
                                    newX = elX;
                                    newY = elY + (containerH - newH) / 2;
                                } else {
                                    newH = containerH;
                                    newW = containerH * imgRatio;
                                    newX = elX + (containerW - newW) / 2;
                                    newY = elY;
                                }
                                
                                return { 
                                    ...el, 
                                    src: base64,
                                    x: (newX / SLIDE_W * 100) + '%',
                                    y: (newY / SLIDE_H * 100) + '%',
                                    w: (newW / SLIDE_W * 100) + '%',
                                    h: (newH / SLIDE_H * 100) + '%',
                                    fit: 'fill'
                                };
                            }
                        }
                    }
                    
                    return { ...el, src: base64 };
                } catch (e) {
                    console.warn('[_preloadSlideImages] Failed to preload image:', el.src, e);
                    return el;
                }
            }
            return el;
        }));
        
        return { ...slide, elements: processedElements };
    },
};

// Mixin install (legacy scripts + ESM entrypoints).
(() => {
    try {
        const ctor =
            (typeof globalThis !== 'undefined' && globalThis.PPTGeneratorCtor?.prototype)
                ? globalThis.PPTGeneratorCtor
                : ((typeof PPTGenerator !== 'undefined' && PPTGenerator?.prototype) ? PPTGenerator : null);
        if (!ctor?.prototype) return;
        Object.assign(ctor.prototype, PPTGeneratorExportBaking);
    } catch {
        // ignore
    }
})();
