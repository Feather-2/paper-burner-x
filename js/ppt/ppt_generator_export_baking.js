/**
 * PPTGeneratorExport 效果烘焙模块
 * 包含: 特效烘焙、图片处理、截图相关方法
 */

const PPTGeneratorExportBaking = {
    /**
     * 智能分层烘焙：将连续的特效元素合并为"智能对象"，保持层叠关系。
     */
    async _bakeEffectsForPPTX(slides) {
        if (typeof html2canvas === 'undefined') {
            await this._loadScript('https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js');
        }

        console.log('[_bakeEffectsForPPTX] Start baking special effects for PPTX export');

        const processedSlides = [];
        const slideContainer = document.createElement('div');
        slideContainer.id = 'pptx-bake-container';
        slideContainer.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 960px; height: 540px; overflow: hidden; background: white;';
        document.body.appendChild(slideContainer);

        const renderer = new HTMLSlideRenderer();

        for (let i = 0; i < slides.length; i++) {
            const slide = JSON.parse(JSON.stringify(slides[i]));

            if (slide.type !== 'freeform' || !slide.elements || slide.elements.length === 0) {
                processedSlides.push(slide);
                continue;
            }

            const hasAnyBakingNeeded = slide.elements.some(el => this._elementNeedsBaking(el));
            
            if (!hasAnyBakingNeeded) {
                processedSlides.push(slide);
                continue;
            }

            console.log(`[_bakeEffectsForPPTX] Slide ${i + 1}: Processing elements with effects`);

            // 简单策略：只烘焙需要特效的元素，保留所有普通元素
            const sortedElements = [...slide.elements].sort((a, b) => (a.z || 0) - (b.z || 0));
            const bakingElements = sortedElements.filter(el => this._elementNeedsBaking(el));
            const normalElements = sortedElements.filter(el => !this._elementNeedsBaking(el));
            
            console.log(`[_bakeEffectsForPPTX] Baking ${bakingElements.length} effect elements, keeping ${normalElements.length} normal elements`);
            
            if (bakingElements.length === 0) {
                processedSlides.push(slide);
                continue;
            }

            slideContainer.innerHTML = '';
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'width: 960px; height: 540px; position: relative; overflow: hidden;';
            
            // 只渲染需要烘焙的元素（带 filter/blend/mask）
            const bakingSlide = { ...slide, elements: bakingElements };
            wrapper.innerHTML = renderer.render(bakingSlide, i);
            slideContainer.appendChild(wrapper);

            await this._waitForIconsToLoad(slideContainer);
            await this._waitForImagesToLoad(slideContainer);
            await this._waitForKatexAndInlineStyles(slideContainer);
            await new Promise(r => setTimeout(r, 200));

            const bakedImage = await this._bakeElementGroup(slideContainer.firstChild, bakingElements, 0, bakingElements.length - 1);
            
            const newElements = [];
            
            // 烘焙后的图片放在最底层
            if (bakedImage) {
                const minZ = Math.min(...bakingElements.map(el => el.z || 0));
                newElements.push({
                    type: 'baked_element',
                    image: bakedImage,
                    z: minZ - 0.5, // 略低于原始特效元素
                });
            }
            
            // 保留所有普通元素（文字、图表等）
            newElements.push(...normalElements);
            newElements.sort((a, b) => (a.z || 0) - (b.z || 0));
            
            slide.elements = newElements;
            processedSlides.push(slide);
        }

        document.body.removeChild(slideContainer);
        console.log('[_bakeEffectsForPPTX] Baking complete');
        return processedSlides;
    },

    async _bakeElementGroup(container, elements, startIdx, endIdx) {
        console.log(`[_bakeElementGroup] Baking ${endIdx - startIdx + 1} elements with effects`);
        
        try {
            const canvas = await this._captureToCanvas(container, {
                scale: 2,
                useCORS: true,
                allowTaint: true,
                backgroundColor: null,
                foreignObjectRendering: true,
            });
            
            return canvas.toDataURL('image/png');
        } catch (e) {
            console.warn('[_bakeElementGroup] Failed to bake element group:', e);
            return null;
        }
    },

    async _captureToCanvas(target, options, fallbackOptions) {
        const attempts = [];
        
        attempts.push({
            ...options,
            foreignObjectRendering: false,
            allowTaint: true,
            useCORS: true,
        });
        
        if (options?.foreignObjectRendering) {
            attempts.push({
                ...options,
                foreignObjectRendering: true,
                allowTaint: true,
            });
        }
        
        if (fallbackOptions) {
            attempts.push({ ...options, ...fallbackOptions, foreignObjectRendering: false });
        }

        for (let i = 0; i < attempts.length; i++) {
            const attempt = attempts[i];
            try {
                const canvas = await html2canvas(target, attempt);
                if (canvas && canvas.width > 0 && canvas.height > 0) {
                    return canvas;
                }
            } catch (err) {
                const hint = err?.target?.src?.substring?.(0, 100) || err?.message || err;
                console.warn(`[html2canvas] capture attempt ${i + 1}/${attempts.length} failed:`, hint);
            }
        }

        console.error('[html2canvas] All capture attempts failed, returning blank canvas');
        const rect = target?.getBoundingClientRect?.();
        const width = Math.max(Math.round(rect?.width || options?.width || 1), 1);
        const height = Math.max(Math.round(rect?.height || options?.height || 1), 1);
        const blank = document.createElement('canvas');
        blank.width = width;
        blank.height = height;
        const ctx = blank.getContext('2d');
        if (ctx && options?.backgroundColor) {
            ctx.fillStyle = options.backgroundColor;
            ctx.fillRect(0, 0, width, height);
        }
        return blank;
    },

    async _waitForImagesToLoad(container, timeout = 10000) {
        const images = Array.from(container.querySelectorAll('img'));
        if (images.length === 0) return;

        const loadPromises = images.map(async (img) => {
            try {
                if (img.dataset.filterBaked === 'true') return;

                if (!img.crossOrigin) {
                    img.crossOrigin = 'anonymous';
                }
                if (!img.referrerPolicy) {
                    img.referrerPolicy = 'no-referrer';
                }

                if (!img.complete || img.naturalHeight === 0) {
                    await new Promise((resolve) => {
                        img.onload = resolve;
                        img.onerror = resolve;
                        setTimeout(resolve, timeout);
                    });
                }

                try {
                    const src = img.src;
                    if (src.startsWith('data:') || src.startsWith('blob:')) return;

                    const imgUrl = new URL(src, window.location.href);
                    if (imgUrl.origin === window.location.origin) return;

                    const response = await fetch(src, { mode: 'cors' });
                    const blob = await response.blob();
                    const base64 = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                    });

                    img.src = base64;
                    await new Promise(resolve => {
                        if (img.complete) resolve();
                        else img.onload = resolve;
                    });
                } catch (e) {
                    console.warn('[_waitForImagesToLoad] Failed to convert image to base64:', img.src, e);
                }

                const { filter, sourceEl } = this._getImageFilterForExport(img);
                if (filter && filter !== 'none') {
                    await this._bakeFilterIntoImage(img, filter);
                    if (sourceEl) {
                        sourceEl.style.filter = 'none';
                    }
                    img.dataset.filterBaked = 'true';
                }
            } catch (err) {
                console.warn('[_waitForImagesToLoad] image handling skipped due to error:', err);
            }
        });

        await Promise.all(loadPromises);
        await new Promise(resolve => setTimeout(resolve, 100));
    },

    _getImageFilterForExport(img) {
        const readFilter = (el) => {
            if (!el) return null;
            const inline = (el.style?.filter || '').trim();
            if (inline && inline !== 'none') return inline;
            const computed = window.getComputedStyle(el).filter;
            if (computed && computed !== 'none') return computed;
            return null;
        };

        let sourceEl = img;
        let filter = readFilter(img);

        if (!filter) {
            filter = readFilter(img.parentElement);
            if (filter) {
                sourceEl = img.parentElement;
            }
        }

        return { filter, sourceEl: filter ? sourceEl : null };
    },

    async _bakeFilterIntoImage(img, filter) {
        if (!filter || filter === 'none') return;

        try {
            const width = Math.max(img.naturalWidth || img.width || 0, 1);
            const height = Math.max(img.naturalHeight || img.height || 0, 1);
            if (!width || !height) return;

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.filter = filter;
            ctx.drawImage(img, 0, 0, width, height);

            img.src = canvas.toDataURL('image/png');

            await new Promise(resolve => {
                if (img.complete) resolve();
                else img.onload = resolve;
                setTimeout(resolve, 200);
            });
        } catch (e) {
            console.warn('[_bakeFilterIntoImage] Failed to apply filter into image:', e);
        }
    },

    async _waitForIconsToLoad(container, timeout = 5000) {
        const icons = Array.from(container.querySelectorAll('iconify-icon'));
        if (icons.length === 0) return;

        for (const icon of icons) {
            const iconName = icon.getAttribute('icon');
            if (!iconName) continue;

            try {
                const computedStyle = window.getComputedStyle(icon);
                const size = computedStyle.fontSize || '24px';
                const color = computedStyle.color || 'currentColor';
                const [prefix, name] = iconName.includes(':') ? iconName.split(':') : ['carbon', iconName];
                const apiUrl = `https://api.iconify.design/${prefix}/${name}.svg?color=${encodeURIComponent(color)}`;

                const response = await fetch(apiUrl);
                if (response.ok) {
                    const svgText = await response.text();
                    const wrapper = document.createElement('span');
                    wrapper.innerHTML = svgText;
                    const svg = wrapper.querySelector('svg');
                    if (svg) {
                        svg.style.width = size;
                        svg.style.height = size;
                        svg.style.display = 'inline-block';
                        svg.style.verticalAlign = 'middle';
                        svg.style.flexShrink = '0';
                        icon.replaceWith(svg);
                        continue;
                    }
                }
            } catch (e) {
                console.warn('Failed to fetch icon from API:', e);
            }

            const startTime = Date.now();
            while (Date.now() - startTime < timeout) {
                const svg = icon.shadowRoot?.querySelector('svg');
                if (svg) {
                    const clonedSvg = svg.cloneNode(true);
                    const computedStyle = window.getComputedStyle(icon);
                    clonedSvg.style.width = computedStyle.fontSize || '1em';
                    clonedSvg.style.height = computedStyle.fontSize || '1em';
                    clonedSvg.style.color = computedStyle.color;
                    clonedSvg.style.fill = 'currentColor';
                    clonedSvg.style.display = 'inline-block';
                    clonedSvg.style.verticalAlign = 'middle';
                    icon.replaceWith(clonedSvg);
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    },

    async _waitForKatexAndInlineStyles(container, timeout = 5000) {
        const katexMathML = container.querySelectorAll('.katex .katex-mathml');
        katexMathML.forEach(el => el.remove());

        const katexEls = container.querySelectorAll('.katex, .katex-display');
        if (katexEls.length === 0) return;

        await new Promise(resolve => setTimeout(resolve, 300));

        container.querySelectorAll('.katex *, .katex').forEach(el => {
            if (el.nodeType !== 1) return;
            const computed = window.getComputedStyle(el);
            const critical = [
                'display', 'position', 'font-size', 'line-height', 'font-family',
                'font-weight', 'font-style', 'margin', 'padding', 'width', 'height',
                'min-width', 'min-height', 'top', 'bottom', 'left', 'right',
                'transform', 'color', 'border-bottom', 'border-color', 'vertical-align'
            ];
            const inlineStyles = [];
            critical.forEach(prop => {
                const value = computed.getPropertyValue(prop);
                if (value && value !== 'auto' && value !== 'normal' && value !== 'none' &&
                    value !== '0px' && value !== 'rgba(0, 0, 0, 0)') {
                    inlineStyles.push(`${prop}: ${value}`);
                }
            });
            if (inlineStyles.length > 0) {
                const existing = el.getAttribute('style') || '';
                el.setAttribute('style', existing + '; ' + inlineStyles.join('; '));
            }
        });

        container.querySelectorAll('.frac-line').forEach(el => {
            el.style.borderBottom = '1px solid currentColor';
            el.style.width = '100%';
        });

        await new Promise(resolve => setTimeout(resolve, 100));
    },

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
        if (el.children && el.children.some(child => this._elementNeedsBaking(child))) return true;
        return false;
    },

    _elementHasEffects(el) {
        if (!el) return false;
        if ((el.blend && el.blend !== 'normal') || el.mask || el.filter) return true;
        if (el.children && el.children.some(child => this._elementHasEffects(child))) return true;
        return false;
    },

    _parsePxOrPercent(str, total) {
        if (typeof str === 'number') return str;
        str = String(str).trim();
        if (str.endsWith('px')) return parseFloat(str);
        if (str.endsWith('%')) return parseFloat(str);
        return parseFloat(str) || 0;
    },
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PPTGeneratorExportBaking;
}
