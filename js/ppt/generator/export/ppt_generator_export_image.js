// ESM 导入核心类以确保 mixin 安装时类已存在
import PPTGeneratorCtor from '../ppt_generator_core.js';

/**
 * PPTGenerator 导出模块 - 图片处理
 * 包含: 脚本加载、图片预处理、Mask 烘焙、Canvas 截图
 * 
 * 依赖: 无（基础模块）
 */

const PPTGeneratorExportImage = {
    // ═══════════════════════════════════════════════════════════════
    // 工具函数
    // ═══════════════════════════════════════════════════════════════
    _loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    },

    // ═══════════════════════════════════════════════════════════════
    // 图片加载与预处理
    // ═══════════════════════════════════════════════════════════════
    
    /**
     * 等待容器内所有图片加载完成，并将跨域图片转为 base64。
     * 同时将 CSS filter (如 blur) 烘焙到图片像素，避免 html2canvas 丢失效果。
     */
    async _waitForImagesToLoad(container, timeout = 1500) {
        const images = Array.from(container.querySelectorAll('img'));
        if (images.length === 0) return;

        const loadPromises = images.map(async (img) => {
            try {
                if (img.dataset.filterBaked === 'true') return;

                if (!img.crossOrigin) img.crossOrigin = 'anonymous';
                if (!img.referrerPolicy) img.referrerPolicy = 'no-referrer';

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
                    if (sourceEl) sourceEl.style.filter = 'none';
                    img.dataset.filterBaked = 'true';
                }
            } catch (err) {
                console.warn('[_waitForImagesToLoad] image handling skipped due to error:', err);
            }
        });

        await Promise.all(loadPromises);
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
            if (filter) sourceEl = img.parentElement;
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
                setTimeout(resolve, 50);
            });
        } catch (e) {
            console.warn('[_bakeFilterIntoImage] Failed to apply filter into image:', e);
        }
    },

    // ═══════════════════════════════════════════════════════════════
    // Mask & Clip-path 烘焙
    // ═══════════════════════════════════════════════════════════════
    
    async _bakeMaskIntoElement(el) {
        try {
            const img = el.tagName === 'IMG' ? el : el.querySelector('img');
            if (!img) return;
            
            const style = window.getComputedStyle(el);
            const maskImage = style.maskImage || style.webkitMaskImage;
            const clipPath = style.clipPath;
            
            if ((!maskImage || maskImage === 'none') && (!clipPath || clipPath === 'none')) {
                return;
            }
            
            if (!img.complete) {
                await new Promise(r => { img.onload = r; img.onerror = r; setTimeout(r, 500); });
            }
            
            if (img.src && !img.src.startsWith('data:') && !img.src.startsWith('blob:')) {
                try {
                    const testCanvas = document.createElement('canvas');
                    testCanvas.width = testCanvas.height = 1;
                    testCanvas.getContext('2d').drawImage(img, 0, 0);
                    testCanvas.toDataURL();
                } catch (e) {
                    console.log('[_bakeMaskIntoElement] Converting cross-origin image to base64:', img.src);
                    try {
                        const response = await fetch(img.src);
                        const blob = await response.blob();
                        const base64 = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                        img.src = base64;
                        await new Promise(r => { img.onload = r; setTimeout(r, 100); });
                    } catch (fetchErr) {
                        console.warn('[_bakeMaskIntoElement] Failed to convert cross-origin image:', fetchErr);
                        return;
                    }
                }
            }
            
            const width = img.naturalWidth || img.width || el.offsetWidth || 200;
            const height = img.naturalHeight || img.height || el.offsetHeight || 150;
            if (width <= 0 || height <= 0) return;
            
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            
            if (clipPath && clipPath !== 'none') {
                const path = this._parseClipPathToPath2D(clipPath, width, height);
                if (path) ctx.clip(path);
            }
            
            if (maskImage && maskImage !== 'none') {
                ctx.drawImage(img, 0, 0, width, height);
                
                const maskCanvas = document.createElement('canvas');
                maskCanvas.width = width;
                maskCanvas.height = height;
                const maskCtx = maskCanvas.getContext('2d');
                
                const gradient = this._parseMaskGradient(maskCtx, maskImage, width, height);
                if (gradient) {
                    maskCtx.fillStyle = gradient;
                    maskCtx.fillRect(0, 0, width, height);
                    
                    ctx.globalCompositeOperation = 'destination-in';
                    ctx.drawImage(maskCanvas, 0, 0);
                    ctx.globalCompositeOperation = 'source-over';
                }
            } else {
                ctx.drawImage(img, 0, 0, width, height);
            }
            
            img.src = canvas.toDataURL('image/png');
            el.style.maskImage = 'none';
            el.style.webkitMaskImage = 'none';
            el.style.clipPath = 'none';
            
            await new Promise(r => { img.onload = r; setTimeout(r, 50); });
        } catch (e) {
            console.warn('[_bakeMaskIntoElement] Failed:', e);
        }
    },
    
    _parseClipPathToPath2D(clipPath, width, height) {
        const path = new Path2D();
        
        const circleMatch = clipPath.match(/circle\(([^)]+)\)/);
        if (circleMatch) {
            const params = circleMatch[1].split(/\s+at\s+/);
            const radius = parseFloat(params[0]) / 100 * Math.min(width, height);
            let cx = width / 2, cy = height / 2;
            if (params[1]) {
                const pos = params[1].split(/\s+/);
                cx = pos[0] === 'center' ? width / 2 : parseFloat(pos[0]) / 100 * width;
                cy = pos[1] === 'center' ? height / 2 : parseFloat(pos[1] || pos[0]) / 100 * height;
            }
            path.arc(cx, cy, radius, 0, Math.PI * 2);
            return path;
        }
        
        const ellipseMatch = clipPath.match(/ellipse\(([^)]+)\)/);
        if (ellipseMatch) {
            const params = ellipseMatch[1].split(/\s+at\s+/);
            const radii = params[0].split(/\s+/);
            const rx = parseFloat(radii[0]) / 100 * width;
            const ry = parseFloat(radii[1] || radii[0]) / 100 * height;
            let cx = width / 2, cy = height / 2;
            path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            return path;
        }
        
        const polygonMatch = clipPath.match(/polygon\(([^)]+)\)/);
        if (polygonMatch) {
            const points = polygonMatch[1].split(',').map(p => {
                const [x, y] = p.trim().split(/\s+/);
                return [parseFloat(x) / 100 * width, parseFloat(y) / 100 * height];
            });
            if (points.length > 0) {
                path.moveTo(points[0][0], points[0][1]);
                for (let i = 1; i < points.length; i++) {
                    path.lineTo(points[i][0], points[i][1]);
                }
                path.closePath();
            }
            return path;
        }
        
        const insetMatch = clipPath.match(/inset\(([^)]+)\)/);
        if (insetMatch) {
            const inset = parseFloat(insetMatch[1]) / 100;
            const x = inset * width;
            const y = inset * height;
            path.rect(x, y, width - 2 * x, height - 2 * y);
            return path;
        }
        
        return null;
    },
    
    _parseMaskGradient(ctx, maskImage, width, height) {
        const linearMatch = maskImage.match(/linear-gradient\((.+)\)/s);
        if (linearMatch) {
            const params = linearMatch[1];
            let x0 = 0, y0 = 0, x1 = width, y1 = 0;
            
            if (params.includes('to right')) { x0 = 0; y0 = 0; x1 = width; y1 = 0; }
            else if (params.includes('to left')) { x0 = width; y0 = 0; x1 = 0; y1 = 0; }
            else if (params.includes('to bottom')) { x0 = 0; y0 = 0; x1 = 0; y1 = height; }
            else if (params.includes('to top')) { x0 = 0; y0 = height; x1 = 0; y1 = 0; }
            
            const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
            
            const stopPattern = /(transparent|black|white|rgba?\s*\([^)]+\))\s*(\d+%)?/gi;
            const stops = [];
            let match;
            while ((match = stopPattern.exec(params)) !== null) {
                const color = this._normalizeColor(match[1]);
                const pos = match[2] ? parseFloat(match[2]) / 100 : null;
                stops.push({ color, pos });
            }
            
            stops.forEach((s, i) => {
                if (s.pos === null) s.pos = i / Math.max(stops.length - 1, 1);
            });
            
            stops.forEach(s => gradient.addColorStop(s.pos, s.color));
            return gradient;
        }
        
        const radialMatch = maskImage.match(/radial-gradient\((.+)\)/s);
        if (radialMatch) {
            const params = radialMatch[1];
            const gradient = ctx.createRadialGradient(width/2, height/2, 0, width/2, height/2, Math.max(width, height) * 0.7);
            
            const stopPattern = /(transparent|black|white|rgba?\s*\([^)]+\))\s*(\d+%)?/gi;
            const stops = [];
            let match;
            while ((match = stopPattern.exec(params)) !== null) {
                const color = this._normalizeColor(match[1]);
                const pos = match[2] ? parseFloat(match[2]) / 100 : null;
                stops.push({ color, pos });
            }
            
            stops.forEach((s, i) => {
                if (s.pos === null) s.pos = i / Math.max(stops.length - 1, 1);
            });
            
            stops.forEach(s => gradient.addColorStop(s.pos, s.color));
            return gradient;
        }
        
        return null;
    },
    
    _normalizeColor(color) {
        if (!color) return 'black';
        const c = color.trim().toLowerCase();
        if (c === 'transparent') return 'rgba(0,0,0,0)';
        if (c === 'black') return 'rgba(0,0,0,1)';
        if (c === 'white') return 'rgba(255,255,255,1)';
        return color.replace(/\s+/g, '');
    },

    // ═══════════════════════════════════════════════════════════════
    // Canvas 截图
    // ═══════════════════════════════════════════════════════════════
    
    async _captureToCanvas(target, options, fallbackOptions) {
        const attempts = [];
        
        if (options?.foreignObjectRendering) {
            attempts.push({
                ...options,
                foreignObjectRendering: true,
                allowTaint: true,
            });
        }
        
        attempts.push({
            ...options,
            foreignObjectRendering: false,
            allowTaint: true,
            useCORS: true,
            logging: false,
            imageTimeout: 3000,
            removeContainer: true,
        });
        
        if (fallbackOptions) {
            attempts.push({ ...options, ...fallbackOptions, foreignObjectRendering: false });
        }

        for (let i = 0; i < attempts.length; i++) {
            try {
                const canvas = await html2canvas(target, attempts[i]);
                if (canvas && canvas.width > 0 && canvas.height > 0) return canvas;
            } catch (err) { /* try next */ }
        }

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

    // Canvas blend 模式映射
    _canvasBlendMap: {
        'screen': 'screen', 'multiply': 'multiply', 'overlay': 'overlay',
        'darken': 'darken', 'lighten': 'lighten', 'color-dodge': 'color-dodge',
        'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light',
        'difference': 'difference', 'exclusion': 'exclusion', 'hue': 'hue',
        'saturation': 'saturation', 'color': 'color', 'luminosity': 'luminosity',
    },

    async _captureWithBlend(container, elements, backgroundFill, scale = 1.5) {
        const width = 960;
        const height = 540;
        
        const backdropEls = elements.filter(el => !el.blend || el.blend === 'normal');
        const blendEls = elements.filter(el => el.blend && el.blend !== 'normal');
        
        const renderer = new HTMLSlideRenderer();
        
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = width * scale;
        finalCanvas.height = height * scale;
        const ctx = finalCanvas.getContext('2d');
        ctx.scale(scale, scale);
        
        // 1. 填充背景
        if (backgroundFill && backgroundFill !== 'transparent') {
            if (backgroundFill.includes('gradient')) {
                container.innerHTML = `<div style="width: ${width}px; height: ${height}px; background: ${backgroundFill};"></div>`;
                const bgCanvas = await this._captureToCanvas(container.firstChild, { scale, backgroundColor: null, foreignObjectRendering: false });
                if (bgCanvas) {
                    ctx.drawImage(bgCanvas, 0, 0, width, height);
                    bgCanvas.width = 0; bgCanvas.height = 0;
                }
            } else {
                ctx.fillStyle = backgroundFill;
                ctx.fillRect(0, 0, width, height);
            }
        }
        
        // 2. 渲染 backdrop 元素
        const blurEls = backdropEls.filter(el => el.filter && el.filter.includes('blur'));
        const normalEls = backdropEls.filter(el => !el.filter || !el.filter.includes('blur'));
        
        // 2a. 带 blur 的元素（底层）
        for (const el of blurEls) {
            const blurMatch = el.filter.match(/blur\((\d+)px\)/);
            const blurPx = blurMatch ? parseInt(blurMatch[1]) : 0;
            
            const elWithoutBlur = { ...el, filter: el.filter.replace(/blur\([^)]+\)/g, '').trim() || undefined };
            container.innerHTML = `<div style="width: ${width}px; height: ${height}px; overflow: visible; background: transparent;">${renderer.render({ type: 'freeform', background: 'transparent', elements: [elWithoutBlur] }, 0)}</div>`;
            
            const elCanvas = await this._captureToCanvas(container.firstChild, { scale, backgroundColor: null, foreignObjectRendering: false, allowTaint: true });
            if (elCanvas) {
                ctx.save();
                ctx.filter = `blur(${blurPx}px)`;
                ctx.drawImage(elCanvas, 0, 0, width, height);
                ctx.restore();
                elCanvas.width = 0; elCanvas.height = 0;
            }
        }
        
        // 2b. 普通 backdrop 元素（上层）
        if (normalEls.length > 0) {
            container.innerHTML = `<div style="width: ${width}px; height: ${height}px; overflow: visible; background: transparent;">${renderer.render({ type: 'freeform', background: 'transparent', elements: normalEls }, 0)}</div>`;
            await Promise.all([this._waitForIconsToLoad(container), this._waitForImagesToLoad(container)]);
            
            const normalCanvas = await this._captureToCanvas(container.firstChild, { scale, backgroundColor: null, foreignObjectRendering: false, allowTaint: true });
            if (normalCanvas) {
                ctx.drawImage(normalCanvas, 0, 0, width, height);
                normalCanvas.width = 0; normalCanvas.height = 0;
            }
        }
        
        // 3. 并发预渲染 blend 元素
        const blendCanvases = await Promise.all(blendEls.map(async (el) => {
            const tempContainer = document.createElement('div');
            tempContainer.style.cssText = 'position: fixed; left: -9999px; top: 0; width: 960px; height: 540px;';
            document.body.appendChild(tempContainer);
            
            try {
                tempContainer.innerHTML = `<div style="width: ${width}px; height: ${height}px; overflow: visible; background: transparent;">${renderer.render({ type: 'freeform', background: 'transparent', elements: [{ ...el, blend: 'normal' }] }, 0)}</div>`;
                await Promise.all([this._waitForIconsToLoad(tempContainer), this._waitForImagesToLoad(tempContainer)]);
                
                const canvas = await this._captureToCanvas(tempContainer.firstChild, { scale, backgroundColor: null, foreignObjectRendering: false, allowTaint: true });
                return { canvas, blend: el.blend };
            } finally {
                document.body.removeChild(tempContainer);
            }
        }));
        
        // 4. 合成 blend 效果
        for (const { canvas, blend } of blendCanvases) {
            if (canvas) {
                ctx.globalCompositeOperation = this._canvasBlendMap[blend] || 'source-over';
                ctx.drawImage(canvas, 0, 0, width, height);
                ctx.globalCompositeOperation = 'source-over';
                canvas.width = 0; canvas.height = 0;
            }
        }
        
        return finalCanvas;
    },
};

// Mixin install (legacy scripts + ESM entrypoints).
(() => {
    try {
        const g = (typeof globalThis !== 'undefined') ? globalThis : null;
        const w = (typeof window !== 'undefined') ? window : null;
        const ctor =
            (g && g.PPTGenerator?.prototype) ? g.PPTGenerator :
            (w && w.PPTGenerator?.prototype) ? w.PPTGenerator :
            (g && g.PPTGeneratorCtor?.prototype) ? g.PPTGeneratorCtor :
            (w && w.PPTGeneratorCtor?.prototype) ? w.PPTGeneratorCtor :
            (PPTGeneratorCtor?.prototype) ? PPTGeneratorCtor :
            null;

        if (!ctor?.prototype) return;
        Object.assign(ctor.prototype, PPTGeneratorExportImage);
    } catch {
        // ignore
    }
})();
