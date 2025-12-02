/**
 * PPTGenerator 导出模块 - 特效烘焙
 * 包含: 特效检测、分层烘焙、图片预加载
 * 
 * 依赖: ppt_generator_export_image.js
 */

const PPTGeneratorExportBaking = {
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
        const groups = [];
        let currentGroup = null;
        
        for (const el of sortedElements) {
            const needsBaking = this._elementNeedsBaking(el) && visualTypes.includes(el.type);
            
            if (needsBaking) {
                if (!currentGroup || currentGroup.type !== 'effect') {
                    currentGroup = { type: 'effect', elements: [] };
                    groups.push(currentGroup);
                }
                currentGroup.elements.push(el);
            } else {
                if (!currentGroup || currentGroup.type !== 'normal') {
                    currentGroup = { type: 'normal', elements: [] };
                    groups.push(currentGroup);
                }
                currentGroup.elements.push(el);
            }
        }
        
        const processedElements = [];
        for (const group of groups) {
            if (group.type === 'normal') {
                processedElements.push(...group.elements);
            } else {
                const minZ = Math.min(...group.elements.map(el => el.z || 0));
                const minOriginalIndex = Math.min(...group.elements.map(el => el._originalIndex ?? Infinity));
                const bakedEl = await this._bakeElementGroupToImage(
                    group.elements, 
                    renderer, 
                    container, 
                    [],
                    'transparent'
                );
                if (bakedEl) {
                    bakedEl.z = minZ;
                    bakedEl._originalIndex = minOriginalIndex;
                    processedElements.push(bakedEl);
                } else {
                    processedElements.push(...group.elements);
                }
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

            let dataUrl = null;
            if (canvas) {
                dataUrl = canvas.toDataURL('image/png');
                canvas.width = 0;
                canvas.height = 0;
            }
            if (!dataUrl) return null;

            return {
                type: 'baked_element',
                image: dataUrl,
                x: '0%',
                y: '0%',
                w: '100%',
                h: '100%',
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

Object.assign(PPTGenerator.prototype, PPTGeneratorExportBaking);
