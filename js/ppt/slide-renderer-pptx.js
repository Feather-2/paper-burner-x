/**
 * PPTX 幻灯片渲染器
 * 核心类 + 模块化 mixin 架构
 * 
 * 模块拆分:
 * - slide-renderer-pptx-templates.js: 预设模板渲染方法
 * - slide-renderer-pptx-freeform.js: 自由布局渲染方法
 */

class PPTXSlideRenderer {
    constructor(options = {}) {
        this.styles = SlideStyles;

        // 图标到 Emoji 的映射表
        this.iconEmoji = {
            'carbon:machine-learning': '🧠',
            'carbon:paint-brush': '🎨',
            'carbon:flash': '⚡',
            'carbon:data-check': '✅',
            'carbon:analytics': '📊',
            'carbon:data-vis-1': '📈',
            'carbon:template': '📋',
            'carbon:security': '🔒',
            'carbon:star': '⭐',
            'carbon:checkmark-filled': '✓',
            'carbon:close-filled': '✕',
            'carbon:quotes': '"',
            'carbon:email': '✉',
            'carbon:image': '🖼',
            'carbon:user': '👤',
            'carbon:bot': '🤖',
            'carbon:add-alt': '+',
            'carbon:edit': '✏',
            'carbon:tree-view-alt': '🌲',
            'carbon:warning-alt': '⚠',
            'carbon:warning-filled': '⚠',
            'default': '●'
        };
    }

    getIconEmoji(iconName) {
        return this.iconEmoji[iconName] || this.iconEmoji['default'];
    }

    // ═══════════════════════════════════════════════════════════════
    // 主渲染入口
    // ═══════════════════════════════════════════════════════════════

    async render(slides, filename = 'presentation.pptx') {
        if (typeof PptxGenJS === 'undefined') {
            throw new Error('PptxGenJS 未加载');
        }

        console.log('[PPTXSlideRenderer] Starting render with', slides.length, 'slides');

        await Promise.all([
            this.preloadAllIcons(slides),
            this.preloadAllFormulas(slides),
            this.preloadAllSvgs(slides),
            this.preloadAllImages(slides),
        ]);

        const pres = new PptxGenJS();
        pres.layout = 'LAYOUT_16x9';
        pres.title = filename.replace('.pptx', '');
        pres.theme = { headFontFace: this.styles.fontFamily.pptx, bodyFontFace: this.styles.fontFamily.pptx };

        slides.forEach((slideData, index) => {
            console.log(`[PPTXSlideRenderer] Rendering slide ${index + 1}/${slides.length}: type="${slideData.type}"`);
            this.renderSlide(pres, slideData);
        });

        console.log('[PPTXSlideRenderer] All slides rendered, writing file...');
        // 使用 blob 方式下载，确保文件名正确
        const blob = await pres.write({ outputType: 'blob' });
        this._downloadBlob(blob, filename);
    }

    async renderWithOMML(slides, filename, mathConverter) {
        if (typeof PptxGenJS === 'undefined') throw new Error('PptxGenJS 未加载');
        if (typeof JSZip === 'undefined') throw new Error('JSZip 未加载');

        console.log('[PPTXSlideRenderer] Starting OMML render with', slides.length, 'slides');

        this.formulaRegistry = [];
        this.mathConverter = mathConverter;

        await Promise.all([
            this.preloadAllIcons(slides),
            this.preloadAllSvgs(slides),
            this.preloadAllImages(slides),
        ]);

        const pres = new PptxGenJS();
        pres.layout = 'LAYOUT_16x9';
        pres.title = filename.replace('.pptx', '');
        pres.theme = { headFontFace: this.styles.fontFamily.pptx, bodyFontFace: this.styles.fontFamily.pptx };

        slides.forEach((slideData, index) => {
            this.currentSlideIndex = index;
            this.renderSlide(pres, slideData);
        });

        const pptxBlob = await pres.write({ outputType: 'blob' });

        if (this.formulaRegistry.length > 0) {
            console.log(`[PPTXSlideRenderer] Post-processing ${this.formulaRegistry.length} formulas...`);
            const processedBlob = await this._postProcessOMML(pptxBlob);
            this._downloadBlob(processedBlob, filename);
        } else {
            this._downloadBlob(pptxBlob, filename);
        }

        console.log('[PPTXSlideRenderer] OMML render complete');
    }

    // ═══════════════════════════════════════════════════════════════
    // OMML 后处理
    // ═══════════════════════════════════════════════════════════════

    async _postProcessOMML(pptxBlob) {
        const zip = await JSZip.loadAsync(pptxBlob);
        const parser = new DOMParser();
        const serializer = new XMLSerializer();

        const formulasBySlide = {};
        for (const formula of this.formulaRegistry) {
            const slideIdx = formula.slideIndex;
            if (!formulasBySlide[slideIdx]) formulasBySlide[slideIdx] = [];
            formulasBySlide[slideIdx].push(formula);
        }

        for (const [slideIdx, formulas] of Object.entries(formulasBySlide)) {
            const slidePath = `ppt/slides/slide${parseInt(slideIdx) + 1}.xml`;
            const slideXml = await zip.file(slidePath)?.async('string');
            if (!slideXml) continue;

            const doc = parser.parseFromString(slideXml, 'text/xml');
            if (doc.querySelector('parsererror')) continue;

            let modified = false;

            for (const formula of formulas) {
                const placeholder = `FORMULA_PLACEHOLDER_${formula.id}`;
                const textNode = this._findTextNodeByContent(doc, placeholder);
                if (!textNode) continue;

                const shape = this._findAncestor(textNode, 'sp');
                if (!shape) continue;

                const omml = this.mathConverter.latexToOMML(formula.latex);
                if (!omml) continue;

                const newShape = this._createOMMLShape(doc, shape, omml, formula);
                if (newShape) {
                    shape.parentNode.replaceChild(newShape, shape);
                    modified = true;
                }
            }

            if (modified) {
                const root = doc.documentElement;
                const NS_MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
                const NS_A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
                const NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
                
                if (!root.hasAttributeNS('http://www.w3.org/2000/xmlns/', 'mc')) {
                    root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:mc', NS_MC);
                }
                if (!root.hasAttributeNS('http://www.w3.org/2000/xmlns/', 'a14')) {
                    root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:a14', NS_A14);
                }
                if (!root.hasAttributeNS('http://www.w3.org/2000/xmlns/', 'm')) {
                    root.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:m', NS_M);
                }
                
                const ignorable = root.getAttribute('mc:Ignorable') || '';
                if (!ignorable.includes('a14')) {
                    root.setAttribute('mc:Ignorable', (ignorable + ' a14').trim());
                }
                
                zip.file(slidePath, serializer.serializeToString(doc));
            }
        }

        await this._ensureOMMLContentType(zip);

        return zip.generateAsync({ 
            type: 'blob', 
            mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' 
        });
    }

    _findTextNodeByContent(doc, content) {
        const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent?.includes(content)) return node;
        }
        return null;
    }

    _findAncestor(node, localName) {
        let current = node.parentNode;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            if (current.localName === localName) return current;
            current = current.parentNode;
        }
        return null;
    }

    _createOMMLShape(doc, originalShape, omml, formula) {
        try {
            const newShape = originalShape.cloneNode(true);
            const txBody = newShape.getElementsByTagNameNS('*', 'txBody')[0];
            if (!txBody) return null;

            const paragraphs = txBody.getElementsByTagNameNS('*', 'p');
            while (paragraphs.length > 0) {
                paragraphs[0].parentNode.removeChild(paragraphs[0]);
            }

            const newParagraph = this._buildOMMLParagraphNode(doc, omml, formula);
            if (newParagraph) txBody.appendChild(newParagraph);

            return newShape;
        } catch (e) {
            console.error('[OMML] Error creating shape:', e);
            return null;
        }
    }

    _buildOMMLParagraphNode(doc, omml, formula) {
        const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
        const NS_A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
        const NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

        const color = (formula.color || '333333').replace('#', '').toUpperCase();
        const fontSize = (formula.fontSize || 18) * 100;

        const p = doc.createElementNS(NS_A, 'a:p');
        
        const pPr = doc.createElementNS(NS_A, 'a:pPr');
        pPr.setAttribute('algn', formula.align || 'ctr');
        
        const defRPr = doc.createElementNS(NS_A, 'a:defRPr');
        defRPr.setAttribute('sz', fontSize.toString());
        
        const solidFill = doc.createElementNS(NS_A, 'a:solidFill');
        const srgbClr = doc.createElementNS(NS_A, 'a:srgbClr');
        srgbClr.setAttribute('val', color);
        solidFill.appendChild(srgbClr);
        defRPr.appendChild(solidFill);
        
        const latin = doc.createElementNS(NS_A, 'a:latin');
        latin.setAttribute('typeface', 'Cambria Math');
        defRPr.appendChild(latin);
        
        pPr.appendChild(defRPr);
        p.appendChild(pPr);

        const a14m = doc.createElementNS(NS_A14, 'a14:m');
        
        const ommlDoc = new DOMParser().parseFromString(
            `<m:oMathPara xmlns:m="${NS_M}" xmlns:a="${NS_A}">
                <m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>
                ${omml}
            </m:oMathPara>`,
            'text/xml'
        );
        
        if (ommlDoc.querySelector('parsererror')) return null;

        const runs = ommlDoc.getElementsByTagNameNS(NS_M, 'r');
        for (const run of runs) {
            let rPr = run.getElementsByTagNameNS(NS_M, 'rPr')[0];
            if (!rPr) {
                rPr = ommlDoc.createElementNS(NS_M, 'm:rPr');
                run.insertBefore(rPr, run.firstChild);
            }
            
            let aRPr = rPr.getElementsByTagNameNS(NS_A, 'rPr')[0];
            if (!aRPr) {
                const aRPrDoc = new DOMParser().parseFromString(
                    `<a:rPr xmlns:a="${NS_A}" sz="${fontSize}">
                        <a:solidFill><a:srgbClr val="${color}"/></a:solidFill>
                        <a:latin typeface="Cambria Math"/>
                    </a:rPr>`,
                    'text/xml'
                );
                aRPr = ommlDoc.importNode(aRPrDoc.documentElement, true);
                rPr.appendChild(aRPr);
            }
        }

        const ommlNode = doc.importNode(ommlDoc.documentElement, true);
        a14m.appendChild(ommlNode);
        p.appendChild(a14m);

        return p;
    }

    async _ensureOMMLContentType(zip) {
        const contentTypesPath = '[Content_Types].xml';
        let contentTypesXml = await zip.file(contentTypesPath)?.async('string');
        if (!contentTypesXml) return;

        const parser = new DOMParser();
        const doc = parser.parseFromString(contentTypesXml, 'text/xml');
        const serializer = new XMLSerializer();
        zip.file(contentTypesPath, serializer.serializeToString(doc));
    }

    _downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ═══════════════════════════════════════════════════════════════
    // 幻灯片分发
    // ═══════════════════════════════════════════════════════════════

    renderSlide(pres, slideData) {
        const slide = pres.addSlide();

        try {
            if (slideData.type === 'baked_image' && slideData.image) {
                this.renderBakedImage(slide, slideData);
            } else {
                // 统一使用 freeform 渲染
                this.renderFreeform(slide, slideData);
            }
        } catch (e) {
            console.error(`Error rendering slide type "${slideData.type}":`, e);
            throw e;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // 辅助方法
    // ═══════════════════════════════════════════════════════════════

    capitalize(str) {
        return str.replace(/_(\w)/g, (_, c) => c.toUpperCase())
                  .replace(/^(\w)/, (_, c) => c.toUpperCase());
    }

    color(name) {
        if (!name) return '333333';
        const c = this.styles.colors[name] || name;
        return String(c).replace('#', '');
    }

    safeColor(value) {
        if (!value) return null;
        if (typeof value === 'object') {
            return value.color ? String(value.color).replace('#', '') : null;
        }
        const color = String(value).trim().replace('#', '');
        return color && /^[0-9a-fA-F]{3,8}$/.test(color) ? color : null;
    }

    get SLIDE_W() { return this.styles.dimensions.width; }
    get SLIDE_H() { return this.styles.dimensions.height; }
    get PADDING() { return this.styles.padding.normal; }
    get PADDING_LARGE() { return this.styles.padding.large; }
    get CONTENT_W() { return this.SLIDE_W - this.PADDING * 2; }
    get fonts() { return this.styles.fonts; }
    get fontFace() { return this.styles.fontFamily.pptx; }

    addText(slide, text, options) {
        // inset: 0 去除默认内边距，使位置与 HTML 一致
        slide.addText(text, { fontFace: this.fontFace, inset: 0, ...options });
    }

    // ═══════════════════════════════════════════════════════════════
    // 预加载方法
    // ═══════════════════════════════════════════════════════════════

    async preloadIcon(iconName, color = '333333') {
        if (!this.iconCache) this.iconCache = {};
        const iconKey = `${iconName}_${color}`;
        if (this.iconCache[iconKey]) return this.iconCache[iconKey];

        try {
            const [prefix, name] = iconName.split(':');
            const svgUrl = `https://api.iconify.design/${prefix}/${name}.svg?color=%23${color}`;
            const response = await fetch(svgUrl);
            if (!response.ok) throw new Error('Failed to fetch icon');

            const svgText = await response.text();
            const base64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
            this.iconCache[iconKey] = base64;
            return base64;
        } catch (e) {
            console.warn(`Failed to preload icon ${iconName}:`, e);
            return null;
        }
    }

    async preloadAllIcons(slides) {
        const iconPromises = [];

        const collectIcons = (elements) => {
            if (!elements) return;
            elements.forEach(el => {
                if (el.type === 'icon' && el.icon) {
                    iconPromises.push(this.preloadIcon(el.icon, this.safeColor(el.color) || '333333'));
                }
                if (el.type === 'card' && el.icon) {
                    iconPromises.push(this.preloadIcon(el.icon, this.safeColor(el.iconColor) || '333333'));
                }
                if (el.children) collectIcons(el.children);
            });
        };

        slides.forEach(slide => {
            if (slide.type === 'freeform' && slide.elements) collectIcons(slide.elements);
        });

        if (iconPromises.length > 0) {
            console.log(`[PPTXSlideRenderer] Preloading ${iconPromises.length} icons...`);
            await Promise.all(iconPromises);
        }
    }

    async preloadAllSvgs(slides) {
        if (!this.svgCache) this.svgCache = {};
        const svgPromises = [];

        const collectSvgs = (elements) => {
            if (!elements) return;
            elements.forEach(el => {
                if (el.type === 'svg' && el.content) svgPromises.push(this.preloadSvg(el));
                if (el.children) collectSvgs(el.children);
            });
        };

        slides.forEach(slide => {
            if (slide.type === 'freeform' && slide.elements) collectSvgs(slide.elements);
        });

        if (svgPromises.length > 0) {
            console.log(`[PPTXSlideRenderer] Preloading ${svgPromises.length} SVGs...`);
            await Promise.all(svgPromises);
        }
    }

    async preloadSvg(el) {
        if (!el.content) return null;
        
        const key = this._hashString(el.content);
        if (this.svgCache[key]) return this.svgCache[key];

        try {
            const w = this._parseSizeToPixels(el.w, false) || 200;
            const h = this._parseSizeToPixels(el.h, true) || 200;
            
            // 分层处理：提取文字，生成无文字的图形层
            let graphicsSvg, textElements;
            try {
                const result = this._extractSvgTexts(el.content, w, h);
                graphicsSvg = result.graphicsSvg;
                textElements = result.textElements;
                console.log(`[preloadSvg] Extracted ${textElements.length} texts from SVG`);
            } catch (e) {
                console.warn('[preloadSvg] Text extraction failed:', e);
                graphicsSvg = el.content;
                textElements = [];
            }
            
            // 图形层转图片
            const dataUrl = await this.svgToBase64(graphicsSvg, w / 96, h / 96);
            
            this.svgCache[key] = {
                graphics: dataUrl,
                texts: textElements,
                viewBox: this._parseSvgViewBox(el.content),
                width: w,
                height: h
            };
            return this.svgCache[key];
        } catch (e) {
            console.warn('[preloadSvg] Failed:', e);
            return null;
        }
    }

    _extractSvgTexts(svgContent, containerW, containerH) {
        const textElements = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgContent, 'image/svg+xml');
        const svg = doc.querySelector('svg');
        
        if (!svg) {
            console.warn('[_extractSvgTexts] No SVG element found');
            return { graphicsSvg: svgContent, textElements: [] };
        }
        
        // 检查原始 text 元素数量
        const originalTextCount = svg.querySelectorAll('text').length;
        console.log(`[_extractSvgTexts] Found ${originalTextCount} text elements, SVG length: ${svgContent.length}, hasText: ${svgContent.includes('<text')}`);
        
        // 如果 SVG 内容本身就没有 text 标签，可能是被 bake 过了
        if (!svgContent.includes('<text') && originalTextCount === 0) {
            console.log('[_extractSvgTexts] SVG has no text elements (may be baked)');
        }
        
        // 解析 viewBox
        const viewBox = svg.getAttribute('viewBox');
        let vbX = 0, vbY = 0, vbWidth = containerW, vbHeight = containerH;
        if (viewBox) {
            const parts = viewBox.split(/[\s,]+/).map(Number);
            if (parts.length >= 4) {
                vbX = parts[0];
                vbY = parts[1];
                vbWidth = parts[2];
                vbHeight = parts[3];
            }
        }
        
        // 考虑 preserveAspectRatio="xMidYMid meet" 的影响
        // 实际缩放比例是 min(scaleX, scaleY)，内容居中显示
        const rawScaleX = containerW / vbWidth;
        const rawScaleY = containerH / vbHeight;
        const scale = Math.min(rawScaleX, rawScaleY);  // meet 模式使用较小的缩放比
        
        // 计算居中偏移
        const scaledW = vbWidth * scale;
        const scaledH = vbHeight * scale;
        const offsetX = (containerW - scaledW) / 2;  // X 方向居中偏移
        const offsetY = (containerH - scaledH) / 2;  // Y 方向居中偏移
        
        // 提取所有 text 元素，使用数学计算位置
        const textNodes = svg.querySelectorAll('text');
        
        textNodes.forEach((textNode) => {
            const text = textNode.textContent || '';
            if (!text.trim()) return;
            
            const fill = textNode.getAttribute('fill') || '#000000';
            const fontSize = parseFloat(textNode.getAttribute('font-size')) || 12;
            const fontWeight = textNode.getAttribute('font-weight') || 'normal';
            const textAnchor = textNode.getAttribute('text-anchor') || 'start';
            
            // 直接从 SVG 属性获取坐标
            let x = parseFloat(textNode.getAttribute('x')) || 0;
            let y = parseFloat(textNode.getAttribute('y')) || 0;
            
            // 处理 transform 属性（如 rotate）
            const transform = textNode.getAttribute('transform');
            let rotation = 0;
            if (transform) {
                const rotateMatch = transform.match(/rotate\(([^)]+)\)/);
                if (rotateMatch) {
                    const rotateParams = rotateMatch[1].split(/[\s,]+/).map(Number);
                    rotation = rotateParams[0] || 0;
                    // 如果有旋转中心点，使用它
                    if (rotateParams.length >= 3) {
                        x = rotateParams[1];
                        y = rotateParams[2];
                    }
                }
            }
            
            // 估算文字尺寸
            const scaledFontSize = fontSize * scale;
            const textHeight = scaledFontSize * 1.2;
            
            // 将 viewBox 坐标转换为容器像素（考虑居中偏移）
            let xPx = offsetX + (x - vbX) * scale;
            let yPx = offsetY + (y - vbY) * scale;
            
            // SVG 的 y 是基线位置，需要向上偏移到顶部
            yPx -= scaledFontSize * 0.85;
            
            textElements.push({
                xPct: xPx / containerW,
                yPct: yPx / containerH,
                wPct: 0,  // 让渲染器自动计算宽度
                hPct: textHeight / containerH,
                text: text.trim(),
                fontSize: scaledFontSize,
                color: fill,
                bold: fontWeight === 'bold',
                textAnchor,
                rotation
            });
            
            // 从 SVG 中移除文字
            textNode.remove();
        });
        
        // 序列化为无文字的 SVG
        const serializer = new XMLSerializer();
        const graphicsSvg = serializer.serializeToString(svg);
        
        return { graphicsSvg, textElements };
    }

    _parseSvgViewBox(svgContent) {
        const match = svgContent.match(/viewBox=["']([^"']+)["']/);
        if (match) {
            const parts = match[1].split(/[\s,]+/).map(Number);
            if (parts.length >= 4) {
                return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
            }
        }
        return null;
    }

    async preloadAllImages(slides) {
        if (!this.imageCache) this.imageCache = {};
        const imagePromises = [];

        const collectImages = (elements) => {
            if (!elements) return;
            elements.forEach(el => {
                if (el.type === 'image' && el.src && !el.src.startsWith('data:')) {
                    imagePromises.push(this.preloadImage(el.src));
                }
                if (el.children) collectImages(el.children);
            });
        };

        slides.forEach(slide => {
            if (slide.type === 'freeform' && slide.elements) collectImages(slide.elements);
        });

        if (imagePromises.length > 0) {
            console.log(`[PPTXSlideRenderer] Preloading ${imagePromises.length} images...`);
            await Promise.all(imagePromises);
        }
    }

    async preloadImage(src) {
        if (this.imageCache[src]) {
            return this.imageCache[src];
        }
        
        console.log('[preloadImage] Loading:', src);
        try {
            const response = await fetch(src);
            if (!response.ok) {
                console.warn('[preloadImage] Fetch failed:', src, response.status);
                return null;
            }
            const blob = await response.blob();
            const base64 = await this._blobToBase64(blob);
            
            // 获取图片原始尺寸
            const dimensions = await this._getImageDimensions(base64);
            
            this.imageCache[src] = {
                data: base64,
                width: dimensions.width,
                height: dimensions.height,
                ratio: dimensions.width / dimensions.height
            };
            console.log('[preloadImage] Cached:', src, dimensions.width, 'x', dimensions.height);
            return this.imageCache[src];
        } catch (e) {
            console.warn('[preloadImage] Failed:', src, e);
            return null;
        }
    }

    _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    _getImageDimensions(base64) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
            img.onerror = () => resolve({ width: 100, height: 100 });
            img.src = base64;
        });
    }

    async preloadAllFormulas(slides) {
        const formulaPromises = [];

        slides.forEach(slide => {
            if (slide.type === 'freeform' && slide.elements) {
                slide.elements.forEach(el => {
                    if (el.type === 'formula' && el.latex) {
                        formulaPromises.push(
                            this.renderFormulaToImage(el.latex, {
                                fontSize: el.font || 24,
                                color: el.color || '#333333',
                                displayMode: el.displayMode !== false,
                            })
                        );
                    }
                });
            }
        });

        if (formulaPromises.length > 0) {
            console.log(`[PPTXSlideRenderer] Preloading ${formulaPromises.length} formulas...`);
            await Promise.all(formulaPromises);
        }
    }

    async renderFormulaToImage(latex, options = {}) {
        const { fontSize = 24, color = '#333333', displayMode = true } = options;
        const cacheKey = `formula_${latex}_${fontSize}_${color}_${displayMode}`;
        
        if (!this.formulaCache) this.formulaCache = {};
        if (this.formulaCache[cacheKey]) return this.formulaCache[cacheKey];

        try {
            if (typeof katex === 'undefined') return null;
            await this.loadHtml2Canvas();

            const katexHtml = katex.renderToString(latex, {
                displayMode: false,
                throwOnError: false,
                output: 'html',
            });

            const container = document.createElement('div');
            container.style.cssText = `
                position: absolute; left: 0; top: 0; background: white;
                font-size: ${fontSize}px; color: ${color};
                display: inline-block; white-space: nowrap; padding: 8px; line-height: 1.2;
            `;
            container.innerHTML = katexHtml;
            document.body.appendChild(container);

            await new Promise(resolve => setTimeout(resolve, 300));

            const scale = 3;
            const canvas = await html2canvas(container, {
                scale, backgroundColor: null, logging: false, useCORS: true, allowTaint: true,
            });

            document.body.removeChild(container);

            const dataUrl = canvas.toDataURL('image/png');
            const actualCanvasW = canvas.width / scale;
            const actualCanvasH = canvas.height / scale;

            const result = {
                data: dataUrl,
                width: actualCanvasW / this.styles.dimensions.pxPerInch,
                height: actualCanvasH / this.styles.dimensions.pxPerInch,
            };

            this.formulaCache[cacheKey] = result;
            return result;
        } catch (e) {
            console.warn('[renderFormulaToImage] Failed:', e);
            return null;
        }
    }

    async loadHtml2Canvas() {
        if (typeof html2canvas !== 'undefined') return html2canvas;

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js';
            script.onload = () => resolve(window.html2canvas);
            script.onerror = () => reject(new Error('Failed to load html2canvas'));
            document.head.appendChild(script);
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // 工具方法
    // ═══════════════════════════════════════════════════════════════

    _hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return 'svg_' + Math.abs(hash).toString(16);
    }

    _parseSizeToPixels(value, isHeight = false) {
        if (!value) return null;
        const str = String(value).trim();
        if (str.endsWith('%')) {
            const base = isHeight ? 540 : 960;
            return (parseFloat(str) / 100) * base;
        } else if (str.endsWith('px')) {
            return parseFloat(str);
        } else if (str.endsWith('in')) {
            return parseFloat(str) * 96;
        }
        return parseFloat(str) || null;
    }

    async svgToBase64(svgContent, width, height) {
        if (!svgContent) return null;

        try {
            const pxWidth = Math.round(width * 96);
            const pxHeight = Math.round(height * 96);
            
            let svg = svgContent.trim();
            if (!svg.toLowerCase().startsWith('<svg')) {
                svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pxWidth}" height="${pxHeight}" viewBox="0 0 ${pxWidth} ${pxHeight}">${svg}</svg>`;
            } else {
                svg = svg.replace(/<svg([^>]*)>/, (match, attrs) => {
                    if (!attrs.includes('xmlns=')) {
                        attrs = ` xmlns="http://www.w3.org/2000/svg"` + attrs;
                    }
                    attrs = attrs.replace(/\s*width\s*=\s*["'][^"']*["']/gi, '');
                    attrs = attrs.replace(/\s*height\s*=\s*["'][^"']*["']/gi, '');
                    attrs += ` width="${pxWidth}" height="${pxHeight}"`;
                    return `<svg${attrs}>`;
                });
            }

            const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);

            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const scale = 2;
                    canvas.width = pxWidth * scale;
                    canvas.height = pxHeight * scale;
                    const ctx = canvas.getContext('2d');
                    ctx.scale(scale, scale);
                    ctx.drawImage(img, 0, 0, pxWidth, pxHeight);
                    URL.revokeObjectURL(url);
                    resolve(canvas.toDataURL('image/png'));
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    resolve(null);
                };
                img.src = url;
            });
        } catch (e) {
            console.warn('[svgToBase64] Failed:', e);
            return null;
        }
    }

    latexToUnicode(latex) {
        if (!latex) return '';

        let result = latex.replace(/\\\\/g, '\\');

        const superscripts = {
            '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
            '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
            '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
            'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ',
        };

        const subscripts = {
            '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
            '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
            '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
        };

        const toSuperscript = (str) => str.split('').map(c => superscripts[c] || c).join('');
        const toSubscript = (str) => str.split('').map(c => subscripts[c] || c).join('');

        const replacements = [
            [/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)'],
            [/\\sqrt\{([^}]*)\}/g, '√($1)'],
            [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\gamma/g, 'γ'], [/\\delta/g, 'δ'],
            [/\\theta/g, 'θ'], [/\\lambda/g, 'λ'], [/\\mu/g, 'μ'], [/\\pi/g, 'π'],
            [/\\sigma/g, 'σ'], [/\\phi/g, 'φ'], [/\\omega/g, 'ω'],
            [/\\infty/g, '∞'], [/\\pm/g, '±'], [/\\times/g, '×'], [/\\div/g, '÷'],
            [/\\leq/g, '≤'], [/\\geq/g, '≥'], [/\\neq/g, '≠'], [/\\approx/g, '≈'],
            [/\\sum/g, '∑'], [/\\prod/g, '∏'], [/\\int/g, '∫'],
            [/\\rightarrow/g, '→'], [/\\leftarrow/g, '←'], [/\\to/g, '→'],
            [/\\text\{([^}]*)\}/g, '$1'],
            [/\\[a-zA-Z]+/g, ''],
        ];

        for (const [pattern, replacement] of replacements) {
            result = result.replace(pattern, replacement);
        }

        result = result.replace(/\^\{([^}]+)\}/g, (_, content) => toSuperscript(content));
        result = result.replace(/\^([0-9a-zA-Z+\-])/g, (_, char) => toSuperscript(char));
        result = result.replace(/_\{([^}]+)\}/g, (_, content) => toSubscript(content));
        result = result.replace(/_([0-9a-zA-Z+\-])/g, (_, char) => toSubscript(char));

        result = result.replace(/\{([^{}]*)\}/g, '$1');
        result = result.replace(/[{}]/g, '');
        result = result.replace(/\s+/g, ' ').trim();

        return result;
    }
}

// ═══════════════════════════════════════════════════════════════
// Mixin 合并: 将模块方法混入主类
// ═══════════════════════════════════════════════════════════════

// Freeform mixin 提供所有元素渲染能力
if (typeof PPTXFreeformMixin !== 'undefined') {
    Object.assign(PPTXSlideRenderer.prototype, PPTXFreeformMixin);
}
