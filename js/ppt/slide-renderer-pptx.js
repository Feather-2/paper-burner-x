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

    async render(slides, filename = 'presentation.pptx') {
        if (typeof PptxGenJS === 'undefined') {
            throw new Error('PptxGenJS 未加载');
        }

        console.log('[PPTXSlideRenderer] Starting render with', slides.length, 'slides');

        // 预加载所有资源（图标、公式、SVG）
        await Promise.all([
            this.preloadAllIcons(slides),
            this.preloadAllFormulas(slides),
            this.preloadAllSvgs(slides),
        ]);

        const pres = new PptxGenJS();
        pres.layout = 'LAYOUT_16x9';
        pres.title = filename.replace('.pptx', '');

        // 设置默认字体为思源黑体
        pres.theme = { headFontFace: this.styles.fontFamily.pptx, bodyFontFace: this.styles.fontFamily.pptx };

        slides.forEach((slideData, index) => {
            console.log(`[PPTXSlideRenderer] Rendering slide ${index + 1}/${slides.length}: type="${slideData.type}", id="${slideData.id}"`);
            this.renderSlide(pres, slideData);
        });

        console.log('[PPTXSlideRenderer] All slides rendered, writing file...');
        return pres.writeFile({ fileName: filename });
    }

    /**
     * 使用原生 OMML 公式渲染 PPTX
     * 1. 先用占位符生成 PPTX
     * 2. 用 JSZip 解压
     * 3. 替换公式占位符为 OMML
     * 4. 重新打包下载
     */
    async renderWithOMML(slides, filename, mathConverter) {
        if (typeof PptxGenJS === 'undefined') {
            throw new Error('PptxGenJS 未加载');
        }
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip 未加载');
        }

        console.log('[PPTXSlideRenderer] Starting OMML render with', slides.length, 'slides');

        // 收集公式信息
        this.formulaRegistry = [];
        this.mathConverter = mathConverter;

        // 预加载资源
        await Promise.all([
            this.preloadAllIcons(slides),
            this.preloadAllSvgs(slides),
        ]);

        const pres = new PptxGenJS();
        pres.layout = 'LAYOUT_16x9';
        pres.title = filename.replace('.pptx', '');
        pres.theme = { headFontFace: this.styles.fontFamily.pptx, bodyFontFace: this.styles.fontFamily.pptx };

        slides.forEach((slideData, index) => {
            this.currentSlideIndex = index;
            console.log(`[PPTXSlideRenderer] Rendering slide ${index + 1}/${slides.length}`);
            this.renderSlide(pres, slideData);
        });

        // 生成 PPTX blob
        const pptxBlob = await pres.write({ outputType: 'blob' });

        // 后处理：替换公式占位符为 OMML
        if (this.formulaRegistry.length > 0) {
            console.log(`[PPTXSlideRenderer] Post-processing ${this.formulaRegistry.length} formulas...`);
            const processedBlob = await this._postProcessOMML(pptxBlob);
            this._downloadBlob(processedBlob, filename);
        } else {
            this._downloadBlob(pptxBlob, filename);
        }

        console.log('[PPTXSlideRenderer] OMML render complete');
    }

    async _postProcessOMML(pptxBlob) {
        const zip = await JSZip.loadAsync(pptxBlob);

        // 遍历所有 slide XML
        for (const formula of this.formulaRegistry) {
            const slidePath = `ppt/slides/slide${formula.slideIndex + 1}.xml`;
            const slideXml = await zip.file(slidePath)?.async('string');
            
            if (!slideXml) continue;

            // 查找占位符并替换为 OMML
            const placeholder = `FORMULA_PLACEHOLDER_${formula.id}`;
            if (slideXml.includes(placeholder)) {
                const omml = this.mathConverter.latexToOMML(formula.latex);
                if (omml) {
                    // 构建完整的 OMML 段落（需要正确的 XML 命名空间）
                    const ommlParagraph = this._buildOMMLParagraph(omml, formula);
                    const newXml = slideXml.replace(
                        new RegExp(`<a:t>${placeholder}</a:t>`, 'g'),
                        `</a:r></a:p>${ommlParagraph}<a:p><a:r><a:t>`
                    );
                    zip.file(slidePath, newXml);
                    console.log(`[OMML] Replaced formula in slide ${formula.slideIndex + 1}`);
                }
            }
        }

        // 更新 Content Types 以支持 OMML
        const contentTypesPath = '[Content_Types].xml';
        let contentTypes = await zip.file(contentTypesPath)?.async('string');
        if (contentTypes && !contentTypes.includes('officeDocument/2006/math')) {
            // 确保 OMML 命名空间被识别
            console.log('[OMML] Content types already valid');
        }

        return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    }

    _buildOMMLParagraph(omml, formula) {
        const align = formula.align || 'ctr';
        return `
            <a:p>
                <a:pPr algn="${align}"/>
                <a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main">
                    <m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
                        <m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr>
                        ${omml}
                    </m:oMathPara>
                </a14:m>
            </a:p>
        `.replace(/\s+/g, ' ').trim();
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

    renderSlide(pres, slideData) {
        const slide = pres.addSlide();
        const method = `render${this.capitalize(slideData.type)}`;

        try {
            if (slideData.type === 'baked_image' && slideData.image) {
                this.renderBakedImage(slide, slideData);
            } else if (typeof this[method] === 'function') {
                this[method](slide, slideData);
            } else {
                this.renderContent(slide, slideData);
            }
        } catch (e) {
            console.error(`Error rendering slide type "${slideData.type}":`, e);
            console.error('Slide data:', JSON.stringify(slideData, null, 2));
            throw e;
        }
    }

    capitalize(str) {
        return str.replace(/_(\w)/g, (_, c) => c.toUpperCase())
                  .replace(/^(\w)/, (_, c) => c.toUpperCase());
    }

    color(name) {
        if (!name) return '333333'; // 默认颜色
        const c = this.styles.colors[name] || name;
        return String(c).replace('#', '');
    }

    /**
     * 安全地转换颜色值为 PPTX 格式 (去掉 # 前缀)
     * 处理各种输入情况：null, undefined, 对象, 字符串
     */
    safeColor(value) {
        if (!value) return null;
        if (typeof value === 'object') {
            // 如果是对象，尝试提取 color 属性
            return value.color ? String(value.color).replace('#', '') : null;
        }
        const color = String(value).trim().replace('#', '');
        // 确保返回有效的颜色值或 null
        return color && /^[0-9a-fA-F]{3,8}$/.test(color) ? color : null;
    }

    // 尺寸常量 - 与 SlideStyles 同步
    get SLIDE_W() { return this.styles.dimensions.width; }
    get SLIDE_H() { return this.styles.dimensions.height; }
    get PADDING() { return this.styles.padding.normal; }
    get PADDING_LARGE() { return this.styles.padding.large; }
    get CONTENT_W() { return this.SLIDE_W - this.PADDING * 2; }

    // 字体大小 - 直接使用 SlideStyles
    get fonts() { return this.styles.fonts; }

    // 字体家族
    get fontFace() { return this.styles.fontFamily.pptx; }

    /**
     * 添加文本到幻灯片（自动应用默认字体）
     */
    addText(slide, text, options) {
        slide.addText(text, {
            fontFace: this.fontFace,
            ...options
        });
    }

    // --- 渲染方法 ---

    renderCover(slide, data) {
        const p = this.PADDING_LARGE;
        const f = this.fonts;

        slide.background = { color: this.color('primary') };

        slide.addShape('rect', {
            x: 0, y: 0, w: '100%', h: '100%',
            fill: { type: 'solid', color: this.color('secondary'), transparency: 50 },
            line: { color: 'FFFFFF', transparency: 100 }
        });

        slide.addShape('ellipse', {
            x: this.SLIDE_W - 3.5, y: -1.4, w: 4.6, h: 4.6,
            fill: { type: 'solid', color: 'FFFFFF', transparency: 90 },
            line: { color: 'FFFFFF', transparency: 100 }
        });

        const startY = this.SLIDE_H * 0.35;
        this.addText(slide, data.title, {
            x: p, y: startY, w: this.SLIDE_W - p * 2, h: 0.8,
            fontSize: f.coverTitle, color: 'FFFFFF', bold: true, align: 'left'
        });
        this.addText(slide, data.subtitle || '', {
            x: p, y: startY + 0.7, w: this.SLIDE_W - p * 2, h: 0.5,
            fontSize: f.coverSubtitle, color: 'FFFFFF', transparency: 20, align: 'left'
        });
        this.addText(slide, 'Generated by Paper Burner X', {
            x: p, y: this.SLIDE_H - 0.5, w: this.SLIDE_W - p * 2, h: 0.3,
            fontSize: f.small, color: 'FFFFFF', transparency: 50, align: 'left'
        });
    }

    renderToc(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        const items = data.items || [];
        const startY = p + 0.7;
        const itemHeight = 0.45;

        items.forEach((item, i) => {
            const y = startY + i * itemHeight;
            slide.addShape('ellipse', {
                x: p, y: y, w: 0.35, h: 0.35,
                fill: { color: this.color('primary') },
                line: { color: 'FFFFFF', transparency: 100 }
            });
            this.addText(slide,String(i + 1), {
                x: p, y: y, w: 0.35, h: 0.35,
                fontSize: f.bodySmall, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle'
            });
            this.addText(slide,item, {
                x: p + 0.5, y: y, w: this.CONTENT_W - 0.5, h: 0.35,
                fontSize: f.body, color: this.color('textSecondary'), valign: 'middle'
            });
        });
    }

    renderStats(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        const stats = data.stats || [];
        const cols = Math.min(stats.length, 4);
        const cardW = (this.CONTENT_W - 0.25 * (cols - 1)) / cols;
        const startY = (this.SLIDE_H - 1.5) / 2;

        stats.forEach((stat, i) => {
            const x = p + i * (cardW + 0.25);
            this.addText(slide,stat.value, {
                x: x, y: startY, w: cardW, h: 0.8,
                fontSize: f.stat, color: this.color('primary'), bold: true, align: 'center', valign: 'bottom'
            });
            this.addText(slide,stat.label, {
                x: x, y: startY + 0.9, w: cardW, h: 0.4,
                fontSize: f.caption, color: this.color('textSecondary'), align: 'center', valign: 'top'
            });
        });
    }

    renderComparison(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        const boxW = (this.CONTENT_W - 0.3) / 2;
        const boxH = this.SLIDE_H - p * 2 - 0.8;
        const boxY = p + 0.65;

        // 左侧
        slide.addShape('roundRect', {
            x: p, y: boxY, w: boxW, h: boxH,
            fill: { color: this.color('dangerBg') },
            line: { color: 'FFFFFF', transparency: 100 },
            rectRadius: 0.12
        });
        this.addText(slide,data.left?.title || '', {
            x: p + 0.2, y: boxY + 0.15, w: boxW - 0.4, h: 0.35,
            fontSize: f.subtitle, color: this.color('danger'), bold: true
        });
        const leftItems = (data.left?.items || []).map(item => ({
            text: '✕  ' + item,
            options: { fontSize: f.bodySmall, color: '991b1b', breakLine: true }
        }));
        this.addText(slide,leftItems, {
            x: p + 0.2, y: boxY + 0.55, w: boxW - 0.4, h: boxH - 0.7,
            lineSpacing: 26, valign: 'top'
        });

        // 右侧
        const rightX = p + boxW + 0.3;
        slide.addShape('roundRect', {
            x: rightX, y: boxY, w: boxW, h: boxH,
            fill: { color: this.color('successBg') },
            line: { color: 'FFFFFF', transparency: 100 },
            rectRadius: 0.12
        });
        this.addText(slide,data.right?.title || '', {
            x: rightX + 0.2, y: boxY + 0.15, w: boxW - 0.4, h: 0.35,
            fontSize: f.subtitle, color: this.color('success'), bold: true
        });
        const rightItems = (data.right?.items || []).map(item => ({
            text: '✓  ' + item,
            options: { fontSize: f.bodySmall, color: '166534', breakLine: true }
        }));
        this.addText(slide,rightItems, {
            x: rightX + 0.2, y: boxY + 0.55, w: boxW - 0.4, h: boxH - 0.7,
            lineSpacing: 26, valign: 'top'
        });
    }

    renderImageText(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        const halfW = (this.CONTENT_W - 0.4) / 2;
        const centerY = this.SLIDE_H / 2;

        this.addText(slide,data.title, {
            x: p, y: centerY - 1, w: halfW, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });
        this.addText(slide,data.content || '', {
            x: p, y: centerY - 0.35, w: halfW, h: 1.2,
            fontSize: f.body, color: this.color('textSecondary'), lineSpacing: 24
        });

        const imgX = p + halfW + 0.4;
        const imgH = 2.5;
        const imgY = (this.SLIDE_H - imgH) / 2;

        if (data.image) {
            try {
                slide.addImage({ path: data.image, x: imgX, y: imgY, w: halfW, h: imgH });
            } catch (e) {
                this.addImagePlaceholder(slide, imgX, imgY, halfW, imgH, data.imagePlaceholder);
            }
        } else {
            this.addImagePlaceholder(slide, imgX, imgY, halfW, imgH, data.imagePlaceholder);
        }
    }

    addImagePlaceholder(slide, x, y, w, h, text) {
        const f = this.fonts;
        slide.addShape('roundRect', {
            x, y, w, h,
            fill: { color: this.color('primaryLight') },
            line: { color: 'FFFFFF', transparency: 100 },
            rectRadius: 0.12
        });
        this.addText(slide,text || '图片', {
            x, y, w, h,
            fontSize: f.bodySmall, color: this.color('primary'), align: 'center', valign: 'middle'
        });
    }

    renderIconGrid(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        const items = data.items || [];
        const cols = Math.min(items.length, 4);
        const cardW = (this.CONTENT_W - 0.2 * (cols - 1)) / cols;
        const cardH = 1.8;
        const startY = p + 0.75;

        items.forEach((item, i) => {
            const x = p + i * (cardW + 0.2);

            slide.addShape('roundRect', {
                x, y: startY, w: cardW, h: cardH,
                fill: { color: this.color('bgSubtle') },
                line: { color: 'FFFFFF', transparency: 100 },
                rectRadius: 0.1
            });

            const iconSize = 0.45;
            const iconX = x + (cardW - iconSize) / 2;
            slide.addShape('roundRect', {
                x: iconX, y: startY + 0.2, w: iconSize, h: iconSize,
                fill: { color: this.color('primaryLight') },
                line: { color: 'FFFFFF', transparency: 100 },
                rectRadius: 0.08
            });

            const emoji = this.getIconEmoji(item.icon);
            this.addText(slide,emoji, {
                x: iconX, y: startY + 0.2, w: iconSize, h: iconSize,
                fontSize: 20, color: this.color('primary'), align: 'center', valign: 'middle'
            });

            this.addText(slide,item.title, {
                x, y: startY + 0.8, w: cardW, h: 0.3,
                fontSize: f.body, color: this.color('textMain'), bold: true, align: 'center'
            });

            this.addText(slide,item.desc, {
                x: x + 0.08, y: startY + 1.15, w: cardW - 0.16, h: 0.5,
                fontSize: f.caption, color: this.color('textSecondary'), align: 'center'
            });
        });
    }

    renderQuote(slide, data) {
        const p = this.PADDING_LARGE;
        const f = this.fonts;
        slide.background = { color: this.color('bgPurple') };

        this.addText(slide,'"', {
            x: p, y: 0.6, w: 0.8, h: 0.8,
            fontSize: 60, color: this.color('primary'), transparency: 70
        });

        this.addText(slide,`"${data.quote}"`, {
            x: p + 0.3, y: (this.SLIDE_H - 1.2) / 2, w: this.CONTENT_W - 0.6, h: 1.2,
            fontSize: f.subtitle, color: this.color('textMain'), align: 'center', valign: 'middle', italic: true
        });

        this.addText(slide,data.author || '', {
            x: p, y: this.SLIDE_H - 1, w: this.CONTENT_W, h: 0.3,
            fontSize: f.body, color: this.color('textMain'), bold: true, align: 'center'
        });
        this.addText(slide,data.company || '', {
            x: p, y: this.SLIDE_H - 0.65, w: this.CONTENT_W, h: 0.25,
            fontSize: f.caption, color: this.color('textSecondary'), align: 'center'
        });
    }


    renderBakedImage(slide, data) {
        slide.addImage({
            data: data.image,
            x: 0,
            y: 0,
            w: this.SLIDE_W,
            h: this.SLIDE_H,
        });
    }

    /**
     * 渲染烘焙后的单个元素（带特效的元素已转为图片）
     * 图片是整个幻灯片尺寸的截图，直接全屏放置即可
     */
    renderBakedElementPPTX(slide, el, x, y, w, h) {
        try {
            slide.addImage({
                data: el.image,
                x: 0,  // 图片是整个幻灯片的截图，从 0,0 开始
                y: 0,
                w: this.SLIDE_W,
                h: this.SLIDE_H,
            });
        } catch (e) {
            console.warn('[renderBakedElementPPTX] Failed to add baked element image:', e);
        }
    }

    renderTimeline(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        const items = data.items || [];
        const cols = items.length;
        const nodeW = this.CONTENT_W / cols;
        const lineY = this.SLIDE_H / 2;

        slide.addShape('rect', {
            x: p, y: lineY - 0.02, w: this.CONTENT_W, h: 0.04,
            fill: { color: this.color('border') },
            line: { color: 'FFFFFF', transparency: 100 }
        });

        items.forEach((item, i) => {
            const centerX = p + nodeW * i + nodeW / 2;
            const circleR = 0.22;

            slide.addShape('ellipse', {
                x: centerX - circleR, y: lineY - circleR, w: circleR * 2, h: circleR * 2,
                fill: { color: this.color('primary') },
                line: { color: 'FFFFFF', transparency: 100 }
            });
            this.addText(slide,item.phase, {
                x: centerX - circleR, y: lineY - circleR, w: circleR * 2, h: circleR * 2,
                fontSize: f.caption, color: 'FFFFFF', bold: true, align: 'center', valign: 'middle'
            });

            this.addText(slide,item.title, {
                x: centerX - nodeW / 2 + 0.05, y: lineY + 0.35, w: nodeW - 0.1, h: 0.3,
                fontSize: f.bodySmall, color: this.color('textMain'), bold: true, align: 'center'
            });

            this.addText(slide,item.desc, {
                x: centerX - nodeW / 2 + 0.05, y: lineY + 0.65, w: nodeW - 0.1, h: 0.35,
                fontSize: f.small, color: this.color('textSecondary'), align: 'center'
            });
        });
    }

    renderEnd(slide, data) {
        const p = this.PADDING_LARGE;
        const f = this.fonts;
        slide.background = { color: this.color('dark') };

        slide.addShape('rect', {
            x: 0, y: 0, w: '100%', h: '100%',
            fill: { type: 'solid', color: this.color('darkSecondary'), transparency: 50 },
            line: { color: 'FFFFFF', transparency: 100 }
        });

        slide.addShape('ellipse', {
            x: this.SLIDE_W - 3.5, y: -1.4, w: 4.6, h: 4.6,
            fill: { type: 'solid', color: 'FFFFFF', transparency: 95 },
            line: { color: 'FFFFFF', transparency: 100 }
        });

        const centerY = this.SLIDE_H * 0.38;
        this.addText(slide,data.title, {
            x: p, y: centerY, w: this.CONTENT_W, h: 0.7,
            fontSize: f.coverTitle, color: 'FFFFFF', bold: true, align: 'left'
        });
        this.addText(slide,data.subtitle || '', {
            x: p, y: centerY + 0.7, w: this.CONTENT_W, h: 0.4,
            fontSize: f.coverSubtitle, color: 'FFFFFF', transparency: 30, align: 'left'
        });
        if (data.email) {
            this.addText(slide,data.email, {
                x: p, y: centerY + 1.2, w: this.CONTENT_W, h: 0.3,
                fontSize: f.bodySmall, color: 'FFFFFF', transparency: 50, align: 'left'
            });
        }
        this.addText(slide,'Generated by Paper Burner X', {
            x: p, y: this.SLIDE_H - 0.5, w: this.CONTENT_W, h: 0.25,
            fontSize: f.small, color: 'FFFFFF', transparency: 60, align: 'left'
        });
    }

    renderList(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        this.addText(slide, data.title, {
            x: p, y: p, w: this.CONTENT_W, h: 0.5,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });

        if (data.items && data.items.length > 0) {
            const listY = p + 0.7;
            const items = data.items.map(item => ({
                text: item,
                options: { fontSize: f.body, color: this.color('textSecondary'), breakLine: true }
            }));
            this.addText(slide,items, {
                x: p, y: listY, w: this.CONTENT_W, h: this.SLIDE_H - listY - p,
                bullet: { type: 'bullet', code: '2022' },
                lineSpacing: 32, valign: 'top'
            });
        }
    }

    renderContent(slide, data) {
        const p = this.PADDING;
        const f = this.fonts;
        slide.background = { color: 'FFFFFF' };

        const titleH = 0.5;
        const contentH = 1.2;
        const totalH = titleH + 0.2 + contentH;
        const startY = (this.SLIDE_H - totalH) / 2;

        this.addText(slide,data.title, {
            x: p, y: startY, w: this.CONTENT_W, h: titleH,
            fontSize: f.title, color: this.color('textMain'), bold: true
        });
        this.addText(slide,data.content || '', {
            x: p, y: startY + titleH + 0.2, w: this.CONTENT_W, h: contentH,
            fontSize: f.body, color: this.color('textSecondary'), lineSpacing: 26
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // Freeform 自由布局渲染 (PPTX)
    // ═══════════════════════════════════════════════════════════════

    renderFreeform(slide, data) {
        // 背景
        if (data.backgroundGradient) {
            // 解析渐变 "linear-gradient(135deg, #ff6b6b 0%, #feca57 100%)"
            // 支持多种格式
            const gradMatch = data.backgroundGradient.match(/linear-gradient\((\d+)deg,\s*([^,]+?)(?:\s+\d+%)?,\s*([^,)]+?)(?:\s+\d+%)?(?:,\s*([^)]+))?\)/);
            if (gradMatch) {
                const angle = parseInt(gradMatch[1]) || 135;
                const color1 = this.safeColor(gradMatch[2]) || '4f46e5';
                const color2 = this.safeColor(gradMatch[3]) || '3b82f6';

                // PptxGenJS 渐变方向映射 (CSS deg → PPTX rotation)
                // CSS: 0deg = 向上, 90deg = 向右, 135deg = 右下
                // PPTX: 0 = 向右, 90 = 向下, 180 = 向左, 270 = 向上
                const cssToOoxml = (cssDeg) => {
                    return (90 - cssDeg + 360) % 360;
                };

                // PptxGenJS 渐变背景格式 - 使用纯色
                slide.background = { color: color1 };
            } else {
                // 解析失败，尝试提取第一个颜色
                const colorMatch = data.backgroundGradient.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/);
                slide.background = { color: colorMatch ? colorMatch[1] : 'FFFFFF' };
            }
        } else if (data.backgroundImage) {
            try {
                slide.background = { path: data.backgroundImage };
            } catch (e) {
                slide.background = { color: 'FFFFFF' };
            }
        } else {
            slide.background = { color: this.safeColor(data.background) || 'FFFFFF' };
        }

        // 按 z-index 排序渲染元素（稳定排序：z 相同时保持原始顺序）
        const elements = (data.elements || [])
            .map((el, i) => ({ ...el, _originalIndex: i }))
            .sort((a, b) => (a.z || 0) - (b.z || 0) || a._originalIndex - b._originalIndex);

        elements.forEach(el => {
            this.renderFreeformElementPPTX(slide, el);
        });
    }

    /**
     * 解析坐标值为英寸 (PPTX 单位)
     */
    parseCoordToInch(value, totalInch) {
        if (typeof value === 'number') return value;
        const str = String(value).trim();
        if (str.endsWith('%')) {
            return (parseFloat(str) / 100) * totalInch;
        } else if (str.endsWith('in')) {
            return parseFloat(str);
        } else if (str.endsWith('px')) {
            return parseFloat(str) / this.styles.dimensions.pxPerInch;
        } else if (str === 'auto') {
            return null;
        }
        return parseFloat(str) / this.styles.dimensions.pxPerInch || 0;
    }

    /**
     * 渲染单个自由元素到 PPTX
     */
    renderFreeformElementPPTX(slide, el) {
        const x = this.parseCoordToInch(el.x, this.SLIDE_W);
        const y = this.parseCoordToInch(el.y, this.SLIDE_H);
        const w = this.parseCoordToInch(el.w, this.SLIDE_W);
        const h = this.parseCoordToInch(el.h, this.SLIDE_H);

        try {
            switch (el.type) {
                case 'text':
                    this.renderFreeformTextPPTX(slide, el, x, y, w, h);
                    break;
                case 'shape':
                    this.renderFreeformShapePPTX(slide, el, x, y, w, h);
                    break;
                case 'image':
                    this.renderFreeformImagePPTX(slide, el, x, y, w, h);
                    break;
                case 'icon':
                    this.renderFreeformIconPPTX(slide, el, x, y, w, h);
                    break;
                case 'line':
                    this.renderFreeformLinePPTX(slide, el);
                    break;
                case 'chart':
                    this.renderFreeformChartPPTX(slide, el, x, y, w, h);
                    break;
                case 'formula':
                    this.renderFreeformFormulaPPTX(slide, el, x, y, w, h);
                    break;
                case 'group':
                    // 递归渲染子元素
                    (el.children || []).forEach(child => {
                        this.renderFreeformElementPPTX(slide, child);
                    });
                    break;
                case 'card':
                    this.renderFreeformCardPPTX(slide, el, x, y, w, h);
                    break;
                case 'svg':
                    this.renderFreeformSvgPPTX(slide, el, x, y, w, h);
                    break;
                case 'table':
                    this.renderFreeformTablePPTX(slide, el, x, y, w, h);
                    break;
                case 'baked_element':
                    // 烘焙后的特效元素，作为图片插入
                    this.renderBakedElementPPTX(slide, el, x, y, w, h);
                    break;
            }
            if (this._needsEffectHint(el)) {
                this._addEffectHint(slide, el, x, y);
            }
        } catch (e) {
            console.error(`Error rendering freeform element type "${el.type}":`, e);
            console.error('Element data:', JSON.stringify(el, null, 2));
            throw e;
        }
    }

    renderFreeformTextPPTX(slide, el, x, y, w, h) {
        // AI 输出的 font 是像素值，需要转换为点 (pt)
        // 标准转换: pt = px * 72 / 96 = px * 0.75
        // 但实测 PPTX 渲染略大，所以用 0.72 微调
        const fontSizePx = el.font || 18;
        const fontSize = Math.round(fontSizePx * 0.72);

        // 处理 HTML 内容，转换为 PptxGenJS 支持的格式
        let textContent = el.content || '';
        textContent = textContent
            .replace(/\r?\n/g, ' ')                  // 先把源码中的换行符替换为空格
            .replace(/<br\s*\/?>/gi, '\n')           // <br> -> 换行
            .replace(/<\/?(strong|b)>/gi, '')        // 移除 strong/b 标签
            .replace(/<\/?(em|i)>/gi, '')            // 移除 em/i 标签
            .replace(/<[^>]+>/g, '')                 // 移除其他 HTML 标签
            .replace(/&nbsp;/g, ' ')                 // HTML 空格
            .replace(/&amp;/g, '&')                  // &
            .replace(/&lt;/g, '<')                   // <
            .replace(/&gt;/g, '>')                   // >
            .replace(/&quot;/g, '"')                 // "
            .replace(/&#39;/g, "'")                  // '
            .replace(/[ \t]+/g, ' ')                 // 多个空格/制表符合并（保留换行）
            .replace(/ ?\n ?/g, '\n')                // 清理换行符周围的空格
            .trim();                                 // 去除首尾空白

        // 计算合适的高度 - 根据字号和行数估算
        const lineCount = (textContent.match(/\n/g) || []).length + 1;
        const estimatedHeight = (fontSize / 72) * lineCount * 1.5; // pt to inch, 1.5 行高

        const textOptions = {
            x: x || 0,
            y: y || 0,
            w: w || 2,
            h: h || Math.max(estimatedHeight, 0.4), // 至少 0.4 英寸
            fontSize: fontSize,
            fontFace: this.fontFace, // 思源黑体
            color: this.safeColor(el.color) || '333333',
            bold: el.bold || false,
            italic: el.italic || false,
            align: el.align || 'left',
            valign: el.valign === 'middle' ? 'middle' : el.valign === 'bottom' ? 'bottom' : 'top',
        };

        // 旋转
        if (el.rotate) {
            textOptions.rotate = el.rotate;
        }

        // 透明度
        if (el.opacity !== undefined && el.opacity < 1) {
            textOptions.transparency = Math.round((1 - el.opacity) * 100);
        }

        // 背景
        if (el.bgColor) {
            const bgColor = this.safeColor(el.bgColor);
            if (bgColor) {
                textOptions.fill = { color: bgColor };
            }
        }

        try {
            this.addText(slide, textContent, textOptions);
        } catch (e) {
            console.warn('Failed to add text:', e, textContent, textOptions);
        }
    }

    renderFreeformShapePPTX(slide, el, x, y, w, h) {
        // 形状类型映射
        const shapeTypeMap = {
            'rect': 'rect',
            'circle': 'ellipse',
            'rounded': 'roundRect',
            'triangle': 'triangle',
        };
        const shapeType = shapeTypeMap[el.shape] || 'rect';

        const shapeOptions = {
            x: x || 0,
            y: y || 0,
            w: w || 1,
            h: h || 1,
            fill: { color: this.safeColor(el.fill) || '4f46e5' },
            line: (() => {
                const strokeColor = this.safeColor(el.outline || el.stroke);
                if (strokeColor) {
                    return { color: strokeColor, width: el.strokeWidth || 1 };
                }
                return { color: 'FFFFFF', transparency: 100 };
            })(),
        };

        // 圆角
        if (shapeType === 'roundRect' && el.radius) {
            shapeOptions.rectRadius = el.radius / 96; // px to inch
        }

        // 透明度
        if (el.opacity !== undefined && el.opacity < 1) {
            shapeOptions.fill.transparency = Math.round((1 - el.opacity) * 100);
        }

        // 旋转
        if (el.rotate) {
            shapeOptions.rotate = el.rotate;
        }

        // 阴影 - 暂时禁用，PptxGenJS shadow 格式可能有问题
        // if (el.shadow) {
        //     shapeOptions.shadow = {
        //         type: 'outer',
        //         blur: 4,
        //         offset: 2,
        //         angle: 45,
        //         color: '000000',
        //         opacity: 30
        //     };
        // }

        try {
            slide.addShape(shapeType, shapeOptions);
        } catch (e) {
            console.warn('Failed to add shape:', e, shapeOptions);
        }
    }

    renderFreeformImagePPTX(slide, el, x, y, w, h) {
        if (el.src) {
            try {
                const imgOptions = {
                    path: el.src,
                    x: x || 0,
                    y: y || 0,
                    w: w || 2,
                    h: h || 2,
                };

                // 旋转
                if (el.rotate) {
                    imgOptions.rotate = el.rotate;
                }

                // 圆角 (通过裁剪实现)
                if (el.radius) {
                    imgOptions.rounding = true;
                }

                slide.addImage(imgOptions);
            } catch (e) {
                // 图片加载失败，添加占位符
                this.addImagePlaceholder(slide, x, y, w, h, el.alt);
            }
        } else {
            // 占位符
            this.addImagePlaceholder(slide, x || 0, y || 0, w || 2, h || 2, el.alt);
        }
    }

    renderFreeformIconPPTX(slide, el, x, y, w, h) {
        const iconSize = (el.size || 24) / 72; // pt to inch
        const color = this.safeColor(el.color) || '333333';

        // 尝试使用 SVG 图标（如果已缓存）
        const iconKey = `${el.icon}_${color}`;
        if (this.iconCache && this.iconCache[iconKey]) {
            slide.addImage({
                data: this.iconCache[iconKey],
                x: x || 0,
                y: y || 0,
                w: iconSize,
                h: iconSize,
            });
            return;
        }

        // Fallback: 使用 emoji
        const emoji = this.getIconEmoji(el.icon);
        this.addText(slide,emoji, {
            x: x || 0,
            y: y || 0,
            w: iconSize * 2,
            h: iconSize * 2,
            fontSize: el.size || 24,
            color: color,
            align: 'center',
            valign: 'middle',
        });
    }

    /**
     * 预加载图标为 Base64 图片
     * @param {string} iconName - 图标名称，如 "carbon:rocket"
     * @param {string} color - 颜色，如 "4f46e5"
     * @returns {Promise<string>} Base64 数据 URL
     */
    async preloadIcon(iconName, color = '333333') {
        if (!this.iconCache) this.iconCache = {};

        const iconKey = `${iconName}_${color}`;
        if (this.iconCache[iconKey]) return this.iconCache[iconKey];

        try {
            // 使用 Iconify API 获取 SVG
            const [prefix, name] = iconName.split(':');
            const svgUrl = `https://api.iconify.design/${prefix}/${name}.svg?color=%23${color}`;

            const response = await fetch(svgUrl);
            if (!response.ok) throw new Error('Failed to fetch icon');

            const svgText = await response.text();

            // 转换 SVG 为 Base64
            const base64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
            this.iconCache[iconKey] = base64;

            return base64;
        } catch (e) {
            console.warn(`Failed to preload icon ${iconName}:`, e);
            return null;
        }
    }

    /**
     * 预加载所有幻灯片中的 SVG 图形
     */
    async preloadAllSvgs(slides) {
        if (!this.svgCache) this.svgCache = {};
        const svgPromises = [];

        const collectSvgs = (elements) => {
            if (!elements) return;
            elements.forEach(el => {
                if (el.type === 'svg' && el.content) {
                    svgPromises.push(this.preloadSvg(el));
                }
                if (el.children) {
                    collectSvgs(el.children);
                }
            });
        };

        slides.forEach(slide => {
            if (slide.type === 'freeform' && slide.elements) {
                collectSvgs(slide.elements);
            }
        });

        if (svgPromises.length > 0) {
            console.log(`[PPTXSlideRenderer] Preloading ${svgPromises.length} SVGs...`);
            await Promise.all(svgPromises);
            console.log('[PPTXSlideRenderer] SVGs preloaded');
        }
    }

    /**
     * 预加载单个 SVG 为 Base64 图片
     */
    async preloadSvg(el) {
        if (!el.content) return null;
        
        // 使用 content 的 hash 作为 key
        const key = this._hashString(el.content);
        if (this.svgCache[key]) return this.svgCache[key];

        try {
            // 获取元素尺寸（转换为像素）
            const w = this._parseSizeToPixels(el.w, false) || 200;
            const h = this._parseSizeToPixels(el.h, true) || 200;
            
            console.log(`[preloadSvg] Converting SVG: ${w}x${h}px`);
            const dataUrl = await this.svgToBase64(el.content, w / 96, h / 96);
            if (dataUrl) {
                this.svgCache[key] = dataUrl;
                console.log(`[preloadSvg] SVG cached: ${key}`);
            } else {
                console.warn(`[preloadSvg] Failed to convert SVG: ${key}`);
            }
            return dataUrl;
        } catch (e) {
            console.warn('[preloadSvg] Failed:', e);
            return null;
        }
    }

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
            // 百分比转换为像素（基于 960x540）
            const base = isHeight ? 540 : 960;
            return (parseFloat(str) / 100) * base;
        } else if (str.endsWith('px')) {
            return parseFloat(str);
        } else if (str.endsWith('in')) {
            return parseFloat(str) * 96;
        }
        return parseFloat(str) || null;
    }

    /**
     * 预加载所有幻灯片中的图标（包括 card 组件中的图标）
     */
    async preloadAllIcons(slides) {
        const iconPromises = [];

        const collectIcons = (elements) => {
            if (!elements) return;
            elements.forEach(el => {
                // icon 元素
                if (el.type === 'icon' && el.icon) {
                    const color = this.safeColor(el.color) || '333333';
                    iconPromises.push(this.preloadIcon(el.icon, color));
                }
                // card 组件中的图标
                if (el.type === 'card' && el.icon) {
                    const color = this.safeColor(el.iconColor) || '333333';
                    iconPromises.push(this.preloadIcon(el.icon, color));
                }
                // group 中的子元素
                if (el.children) {
                    collectIcons(el.children);
                }
            });
        };

        slides.forEach(slide => {
            if (slide.type === 'freeform' && slide.elements) {
                collectIcons(slide.elements);
            }
        });

        if (iconPromises.length > 0) {
            console.log(`[PPTXSlideRenderer] Preloading ${iconPromises.length} icons...`);
            await Promise.all(iconPromises);
            console.log('[PPTXSlideRenderer] Icons preloaded');
        }
    }

    /**
     * 动态加载 html2canvas 库
     */
    async loadHtml2Canvas() {
        if (typeof html2canvas !== 'undefined') {
            return html2canvas;
        }

        // 动态加载
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://gcore.jsdelivr.net/npm/html2canvas-pro@1.5.13/dist/html2canvas-pro.min.js';
            script.onload = () => {
                console.log('[PPTXSlideRenderer] html2canvas loaded');
                resolve(window.html2canvas);
            };
            script.onerror = () => {
                console.warn('[PPTXSlideRenderer] Failed to load html2canvas');
                reject(new Error('Failed to load html2canvas'));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * 内联 KaTeX 样式以确保 html2canvas 正确渲染
     * 复制计算样式到内联样式，修复 vertical-align 问题
     */
    inlineKatexStylesForExport(container) {
        // 处理所有 KaTeX 元素
        const katexElements = container.querySelectorAll('.katex, .katex *');
        katexElements.forEach(el => {
            const computed = window.getComputedStyle(el);
            const critical = [
                'display', 'position',
                'font-size', 'line-height', 'font-family', 'font-weight', 'font-style',
                'margin', 'padding',
                'width', 'height', 'min-width', 'min-height',
                'top', 'bottom', 'left', 'right',
                'transform', 'color', 'border-bottom', 'border-color'
            ];

            const inlineStyles = [];

            // 特殊处理 vertical-align - html2canvas 不支持 em 单位
            const verticalAlign = computed.getPropertyValue('vertical-align');
            if (verticalAlign && verticalAlign.endsWith('em')) {
                const val = parseFloat(verticalAlign);
                if (!isNaN(val) && val !== 0) {
                    inlineStyles.push('position: relative');
                    inlineStyles.push(`top: ${-val * 1.5}em`);
                    inlineStyles.push('vertical-align: baseline');
                }
            } else if (verticalAlign) {
                inlineStyles.push(`vertical-align: ${verticalAlign}`);
            }

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

        // 特殊处理分数线
        const fracLines = container.querySelectorAll('.frac-line');
        fracLines.forEach(el => {
            el.style.borderBottom = '1px solid currentColor';
            el.style.width = '100%';
        });
    }

    /**
     * 将 KaTeX 公式渲染为 Base64 图片
     * 使用 html2canvas 截图方式，确保公式完整渲染
     * @param {string} latex - LaTeX 公式
     * @param {object} options - 渲染选项 { fontSize, color, displayMode }
     * @returns {Promise<{data: string, width: number, height: number}>} Base64 图片数据和尺寸
     */
    async renderFormulaToImage(latex, options = {}) {
        const { fontSize = 24, color = '#333333', displayMode = true } = options;

        // 生成缓存键
        const cacheKey = `formula_${latex}_${fontSize}_${color}_${displayMode}`;
        if (!this.formulaCache) this.formulaCache = {};
        if (this.formulaCache[cacheKey]) {
            return this.formulaCache[cacheKey];
        }

        try {
            // 检查 KaTeX 是否可用
            if (typeof katex === 'undefined') {
                console.warn('[PPTXSlideRenderer] KaTeX not available');
                return null;
            }

            // 确保 html2canvas 已加载
            await this.loadHtml2Canvas();

            // 使用 KaTeX 渲染为 HTML - 使用行内模式，布局更简单
            const katexHtml = katex.renderToString(latex, {
                displayMode: false, // 强制使用行内模式，避免复杂布局
                throwOnError: false,
                output: 'html',
            });

            // 创建渲染容器
            const container = document.createElement('div');
            container.style.cssText = `
                position: absolute;
                left: 0;
                top: 0;
                background: white;
                font-size: ${fontSize}px;
                color: ${color};
                display: inline-block;
                white-space: nowrap;
                padding: 8px;
                line-height: 1.2;
            `;
            container.innerHTML = katexHtml;
            document.body.appendChild(container);

            // 等待 KaTeX 字体加载和渲染
            await new Promise(resolve => setTimeout(resolve, 300));

            // 使用 html2canvas 直接截取整个容器
            const scale = 3;
            const canvas = await html2canvas(container, {
                scale: scale,
                backgroundColor: null,
                logging: false,
                useCORS: true,
                allowTaint: true,
            });

            // 清理容器
            document.body.removeChild(container);

            // 转换为 Base64
            const dataUrl = canvas.toDataURL('image/png');

            // 使用 canvas 实际尺寸计算英寸（考虑 scale）
            const actualCanvasW = canvas.width / scale;
            const actualCanvasH = canvas.height / scale;

            const result = {
                data: dataUrl,
                width: actualCanvasW / this.styles.dimensions.pxPerInch,
                height: actualCanvasH / this.styles.dimensions.pxPerInch,
            };

            this.formulaCache[cacheKey] = result;
            console.log(`[PPTXSlideRenderer] Formula rendered: ${latex.substring(0, 30)}... canvas=${canvas.width}x${canvas.height}px, display=${actualCanvasW}x${actualCanvasH}px, inch=${result.width.toFixed(2)}x${result.height.toFixed(2)}`);

            return result;

        } catch (e) {
            console.warn('[PPTXSlideRenderer] Failed to render formula:', e);
            return null;
        }
    }

    /**
     * 内联 KaTeX 样式用于截图
     * 确保所有关键样式都内联，避免 html2canvas 丢失样式
     */
    inlineKatexStylesForCapture(container) {
        // 递归处理所有元素
        const processElement = (el) => {
            if (el.nodeType !== 1) return; // 只处理元素节点

            const computed = window.getComputedStyle(el);
            const styles = [];

            // 关键样式属性 - 不包含 height, max-height, overflow 等可能导致裁剪的属性
            const props = [
                'display', 'position', 'top', 'left', 'right', 'bottom',
                'width', 'min-width',
                'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
                'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
                'font-family', 'font-size', 'font-weight', 'font-style',
                'line-height', 'text-align', 'vertical-align',
                'color',
                'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
                'border-width', 'border-style', 'border-color',
                'transform', 'opacity',
                'box-sizing',
            ];

            props.forEach(prop => {
                const value = computed.getPropertyValue(prop);
                if (value && value !== 'none' && value !== 'auto' && value !== 'normal' &&
                    value !== '0px' && value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
                    styles.push(`${prop}: ${value}`);
                }
            });

            // 特殊处理 vertical-align（KaTeX 大量使用）
            const va = computed.getPropertyValue('vertical-align');
            if (va && va !== 'baseline') {
                // 将 em 单位转换为 px
                if (va.endsWith('em')) {
                    const emVal = parseFloat(va);
                    const fontSizePx = parseFloat(computed.getPropertyValue('font-size'));
                    const pxVal = emVal * fontSizePx;
                    styles.push(`vertical-align: ${pxVal}px`);
                } else {
                    styles.push(`vertical-align: ${va}`);
                }
            }

            // 应用内联样式
            if (styles.length > 0) {
                el.style.cssText = styles.join('; ') + ';';
            }

            // 递归处理子元素
            Array.from(el.children).forEach(processElement);
        };

        processElement(container);

        // 特殊处理分数线
        container.querySelectorAll('.frac-line').forEach(el => {
            const computed = window.getComputedStyle(el);
            el.style.borderBottomWidth = computed.borderBottomWidth || '1px';
            el.style.borderBottomStyle = 'solid';
            el.style.borderBottomColor = computed.color || 'currentColor';
            el.style.width = '100%';
            el.style.display = 'block';
        });

        // 特殊处理根号
        container.querySelectorAll('.sqrt-line').forEach(el => {
            el.style.borderTopWidth = '1px';
            el.style.borderTopStyle = 'solid';
        });
    }

    /**
     * 预加载所有幻灯片中的公式为图片
     */
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
            console.log('[PPTXSlideRenderer] Formulas preloaded');
        }
    }

    /**
     * 渲染图表到 PPTX (使用 PptxGenJS 原生图表)
     */
    renderFreeformChartPPTX(slide, el, x, y, w, h) {
        const data = this.parseChartDataPPTX(el.chartData);
        if (!data.length) return;

        const colors = (el.colors || '#4f46e5,#10b981,#f59e0b,#ec4899,#6366f1')
            .split(',')
            .map(c => this.safeColor(c.trim()) || '4f46e5');

        const chartType = el.chartType || 'bar';

        // PptxGenJS 图表类型映射
        const chartTypeMap = {
            'bar': 'bar',
            'line': 'line',
            'pie': 'pie',
            'doughnut': 'doughnut',
        };

        const pptxChartType = chartTypeMap[chartType] || 'bar';

        // 构建图表数据
        const chartData = [{
            name: el.title || 'Data',
            labels: data.map(d => d.label),
            values: data.map(d => d.value),
        }];

        const chartOptions = {
            x: x || 0.5,
            y: y || 0.5,
            w: w || 4,
            h: h || 3,
            chartColors: colors,
            showTitle: !!el.title,
            title: el.title || '',
            showLegend: false,
        };

        // 根据图表类型添加特定选项
        if (pptxChartType === 'bar') {
            chartOptions.barDir = 'bar';
            chartOptions.barGrouping = 'clustered';
        } else if (pptxChartType === 'pie' || pptxChartType === 'doughnut') {
            chartOptions.showPercent = true;
            if (pptxChartType === 'doughnut') {
                chartOptions.holeSize = 50;
            }
        }

        try {
            slide.addChart(pptxChartType, chartData, chartOptions);
        } catch (e) {
            console.warn('Failed to add chart, using placeholder:', e);
            // Fallback: 添加占位符
            slide.addShape('roundRect', {
                x: x || 0.5,
                y: y || 0.5,
                w: w || 4,
                h: h || 3,
                fill: { color: 'F8FAFC' },
                line: { color: 'E2E8F0', width: 1 },
            });
            this.addText(slide,`📊 ${el.title || 'Chart'}`, {
                x: x || 0.5,
                y: y || 0.5,
                w: w || 4,
                h: h || 3,
                fontSize: 14,
                color: '64748B',
                align: 'center',
                valign: 'middle',
            });
        }
    }

    parseChartDataPPTX(dataStr) {
        if (!dataStr) return [];
        return dataStr.split(',').map(item => {
            const parts = item.split(':');
            return {
                label: parts[0]?.trim() || '',
                value: parseFloat(parts[1]) || 0
            };
        });
    }

    renderFreeformLinePPTX(slide, el) {
        let x1 = this.parseCoordToInch(el.x1, this.SLIDE_W) || 0;
        let y1 = this.parseCoordToInch(el.y1, this.SLIDE_H) || 0;
        let x2 = this.parseCoordToInch(el.x2, this.SLIDE_W) || this.SLIDE_W;
        let y2 = this.parseCoordToInch(el.y2, this.SLIDE_H) || y1;

        // 确保 w 和 h 非负（PptxGenJS 要求）
        if (x2 < x1) { [x1, x2] = [x2, x1]; }
        if (y2 < y1) { [y1, y2] = [y2, y1]; }

        // 避免零宽度/高度的线条
        const w = Math.max(x2 - x1, 0.01);
        const h = Math.max(y2 - y1, 0.01);

        const lineOptions = {
            x: x1,
            y: y1,
            w: w,
            h: h,
            line: {
                color: this.safeColor(el.stroke) || 'CCCCCC',
                width: el.strokeWidth || 2,
            }
        };

        // 虚线
        if (el.dash) {
            lineOptions.line.dashType = 'dash';
        }

        try {
            slide.addShape('line', lineOptions);
        } catch (e) {
            console.warn('Failed to add line:', e, lineOptions);
        }
    }

    /**
     * 渲染数学公式到 PPTX
     * - 如果启用了 OMML 模式，使用占位符（后处理时替换为原生公式）
     * - 否则使用 Unicode 文本
     */
    renderFreeformFormulaPPTX(slide, el, x, y, w, h) {
        const fontSizePx = el.font || 24;
        const color = el.color || '#333333';
        const fontSize = Math.round(fontSizePx * 0.72);

        let displayText;
        
        // 如果启用了 OMML 模式，注册公式并使用占位符
        if (this.formulaRegistry && this.mathConverter) {
            const formulaId = this.formulaRegistry.length;
            this.formulaRegistry.push({
                id: formulaId,
                slideIndex: this.currentSlideIndex,
                latex: el.latex || '',
                x, y, w, h,
                fontSize,
                color,
                align: el.align || 'center',
            });
            displayText = `FORMULA_PLACEHOLDER_${formulaId}`;
            console.log('[PPTX Formula] Using OMML placeholder:', el.latex?.substring(0, 30));
        } else {
            // Fallback: 使用 Unicode 文本
            displayText = this.latexToUnicode(el.latex || '');
            console.log('[PPTX Formula] Using Unicode:', el.latex?.substring(0, 30), '->', displayText?.substring(0, 30));
        }

        const textOptions = {
            x: x || 0,
            y: y || 0,
            w: w || 2,
            h: h || 0.5,
            fontSize: fontSize,
            fontFace: 'Cambria Math',
            color: this.safeColor(color) || '333333',
            align: el.align || 'center',
            valign: 'middle',
        };

        if (el.rotate) {
            textOptions.rotate = el.rotate;
        }

        if (el.opacity !== undefined && el.opacity < 1) {
            textOptions.transparency = Math.round((1 - el.opacity) * 100);
        }

        try {
            this.addText(slide, displayText, textOptions);
        } catch (e) {
            console.warn('Failed to add formula:', e, displayText);
        }
    }

    /**
     * LaTeX 转 Unicode 映射
     * 用于 PPTX 导出时的显示
     * 使用 Unicode 数学字符尽量还原公式外观
     */
    latexToUnicode(latex) {
        if (!latex) return '';

        let result = latex;

        // 首先标准化反斜杠：将双反斜杠转为单反斜杠
        result = result.replace(/\\\\/g, '\\');

        // Unicode 上标字符映射
        const superscripts = {
            '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
            '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
            '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
            'n': 'ⁿ', 'i': 'ⁱ', 'x': 'ˣ', 'y': 'ʸ',
            'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ',
            'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'j': 'ʲ', 'k': 'ᵏ',
            'l': 'ˡ', 'm': 'ᵐ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ',
            's': 'ˢ', 't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'z': 'ᶻ',
            'N': 'ᴺ', '/': 'ᐟ',
        };

        // Unicode 下标字符映射
        const subscripts = {
            '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
            '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
            '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
            'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ',
            'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ', 'o': 'ₒ',
            'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ',
            'v': 'ᵥ', 'x': 'ₓ',
            'th': 'ₜₕ',
        };

        // 转换上标内容
        const toSuperscript = (str) => {
            return str.split('').map(c => superscripts[c] || c).join('');
        };

        // 转换下标内容
        const toSubscript = (str) => {
            return str.split('').map(c => subscripts[c] || c).join('');
        };

        const replacements = [
            // 量子态 bra-ket 记号
            [/\|([^|⟩\s{}]+)\\rangle/g, '|$1⟩'],
            [/\\langle([^|⟨\s{}]+)\|/g, '⟨$1|'],
            [/\\ket\{([^}]*)\}/g, '|$1⟩'],
            [/\\bra\{([^}]*)\}/g, '⟨$1|'],
            [/\\rangle/g, '⟩'],
            [/\\langle/g, '⟨'],
            [/\\vert/g, '|'],

            // 分数 - 使用斜杠表示
            [/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)'],

            // 根号
            [/\\sqrt\[(\d+)\]\{([^}]*)\}/g, '∜($2)'], // n次根号简化
            [/\\sqrt\{([^}]*)\}/g, '√($1)'],
            [/\\sqrt/g, '√'],

            // 希腊字母（小写）
            [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\gamma/g, 'γ'], [/\\delta/g, 'δ'],
            [/\\epsilon/g, 'ε'], [/\\varepsilon/g, 'ε'], [/\\zeta/g, 'ζ'], [/\\eta/g, 'η'],
            [/\\theta/g, 'θ'], [/\\vartheta/g, 'ϑ'], [/\\iota/g, 'ι'], [/\\kappa/g, 'κ'],
            [/\\lambda/g, 'λ'], [/\\mu/g, 'μ'], [/\\nu/g, 'ν'], [/\\xi/g, 'ξ'],
            [/\\pi/g, 'π'], [/\\varpi/g, 'ϖ'], [/\\rho/g, 'ρ'], [/\\varrho/g, 'ϱ'],
            [/\\sigma/g, 'σ'], [/\\varsigma/g, 'ς'], [/\\tau/g, 'τ'], [/\\upsilon/g, 'υ'],
            [/\\phi/g, 'φ'], [/\\varphi/g, 'φ'], [/\\chi/g, 'χ'], [/\\psi/g, 'ψ'],
            [/\\omega/g, 'ω'],

            // 希腊字母（大写）
            [/\\Gamma/g, 'Γ'], [/\\Delta/g, 'Δ'], [/\\Theta/g, 'Θ'], [/\\Lambda/g, 'Λ'],
            [/\\Xi/g, 'Ξ'], [/\\Pi/g, 'Π'], [/\\Sigma/g, 'Σ'], [/\\Upsilon/g, 'Υ'],
            [/\\Phi/g, 'Φ'], [/\\Psi/g, 'Ψ'], [/\\Omega/g, 'Ω'],

            // 数学运算符
            [/\\infty/g, '∞'], [/\\pm/g, '±'], [/\\mp/g, '∓'],
            [/\\times/g, '×'], [/\\div/g, '÷'], [/\\cdot/g, '·'], [/\\ast/g, '∗'],
            [/\\star/g, '⋆'], [/\\circ/g, '∘'], [/\\bullet/g, '•'],
            [/\\oplus/g, '⊕'], [/\\otimes/g, '⊗'], [/\\odot/g, '⊙'],

            // 关系运算符
            [/\\leq/g, '≤'], [/\\geq/g, '≥'], [/\\neq/g, '≠'], [/\\ne/g, '≠'],
            [/\\approx/g, '≈'], [/\\equiv/g, '≡'], [/\\sim/g, '∼'], [/\\simeq/g, '≃'],
            [/\\cong/g, '≅'], [/\\propto/g, '∝'], [/\\ll/g, '≪'], [/\\gg/g, '≫'],
            [/\\prec/g, '≺'], [/\\succ/g, '≻'], [/\\preceq/g, '⪯'], [/\\succeq/g, '⪰'],

            // 集合运算符
            [/\\subset/g, '⊂'], [/\\supset/g, '⊃'], [/\\subseteq/g, '⊆'], [/\\supseteq/g, '⊇'],
            [/\\in/g, '∈'], [/\\notin/g, '∉'], [/\\ni/g, '∋'],
            [/\\cup/g, '∪'], [/\\cap/g, '∩'], [/\\setminus/g, '∖'],
            [/\\emptyset/g, '∅'], [/\\varnothing/g, '∅'],

            // 逻辑运算符
            [/\\forall/g, '∀'], [/\\exists/g, '∃'], [/\\nexists/g, '∄'],
            [/\\land/g, '∧'], [/\\lor/g, '∨'], [/\\lnot/g, '¬'], [/\\neg/g, '¬'],
            [/\\implies/g, '⟹'], [/\\iff/g, '⟺'],

            // 微积分
            [/\\nabla/g, '∇'], [/\\partial/g, '∂'],
            [/\\sum/g, '∑'], [/\\prod/g, '∏'], [/\\coprod/g, '∐'],
            [/\\int/g, '∫'], [/\\iint/g, '∬'], [/\\iiint/g, '∭'], [/\\oint/g, '∮'],

            // 箭头
            [/\\rightarrow/g, '→'], [/\\leftarrow/g, '←'], [/\\leftrightarrow/g, '↔'],
            [/\\Rightarrow/g, '⇒'], [/\\Leftarrow/g, '⇐'], [/\\Leftrightarrow/g, '⇔'],
            [/\\uparrow/g, '↑'], [/\\downarrow/g, '↓'], [/\\updownarrow/g, '↕'],
            [/\\to/g, '→'], [/\\gets/g, '←'], [/\\mapsto/g, '↦'],
            [/\\longrightarrow/g, '⟶'], [/\\longleftarrow/g, '⟵'],

            // 括号
            [/\\left\(/g, '('], [/\\right\)/g, ')'],
            [/\\left\[/g, '['], [/\\right\]/g, ']'],
            [/\\left\{/g, '{'], [/\\right\}/g, '}'],
            [/\\left\|/g, '‖'], [/\\right\|/g, '‖'],
            [/\\left</g, '⟨'], [/\\right>/g, '⟩'],
            [/\\lfloor/g, '⌊'], [/\\rfloor/g, '⌋'],
            [/\\lceil/g, '⌈'], [/\\rceil/g, '⌉'],

            // 其他符号
            [/\\hbar/g, 'ℏ'], [/\\ell/g, 'ℓ'], [/\\wp/g, '℘'],
            [/\\Re/g, 'ℜ'], [/\\Im/g, 'ℑ'], [/\\aleph/g, 'ℵ'],
            [/\\prime/g, '′'], [/\\angle/g, '∠'], [/\\perp/g, '⊥'],
            [/\\parallel/g, '∥'], [/\\triangle/g, '△'],
            [/\\square/g, '□'], [/\\diamond/g, '◇'],

            // \text{...} 处理
            [/\\text\{([^}]*)\}/g, '$1'],
            [/\\mathrm\{([^}]*)\}/g, '$1'],
            [/\\mathbf\{([^}]*)\}/g, '$1'],
            [/\\mathit\{([^}]*)\}/g, '$1'],

            // 数学函数名
            [/\\log/g, 'log'], [/\\ln/g, 'ln'], [/\\lg/g, 'lg'],
            [/\\sin/g, 'sin'], [/\\cos/g, 'cos'], [/\\tan/g, 'tan'],
            [/\\cot/g, 'cot'], [/\\sec/g, 'sec'], [/\\csc/g, 'csc'],
            [/\\arcsin/g, 'arcsin'], [/\\arccos/g, 'arccos'], [/\\arctan/g, 'arctan'],
            [/\\sinh/g, 'sinh'], [/\\cosh/g, 'cosh'], [/\\tanh/g, 'tanh'],
            [/\\exp/g, 'exp'], [/\\lim/g, 'lim'], [/\\max/g, 'max'], [/\\min/g, 'min'],
            [/\\sup/g, 'sup'], [/\\inf/g, 'inf'], [/\\det/g, 'det'], [/\\dim/g, 'dim'],

            // 移除其他未知 LaTeX 命令
            [/\\[a-zA-Z]+/g, ''],
        ];

        // 应用基本替换
        for (const [pattern, replacement] of replacements) {
            result = result.replace(pattern, replacement);
        }

        // 处理上标 ^{...} 和 ^x
        result = result.replace(/\^\{([^}]+)\}/g, (match, content) => toSuperscript(content));
        result = result.replace(/\^([0-9a-zA-Z+\-])/g, (match, char) => toSuperscript(char));

        // 处理下标 _{...} 和 _x
        result = result.replace(/_\{([^}]+)\}/g, (match, content) => toSubscript(content));
        result = result.replace(/_([0-9a-zA-Z+\-])/g, (match, char) => toSubscript(char));

        // 清理花括号
        result = result.replace(/\{([^{}]*)\}/g, '$1');
        result = result.replace(/[{}]/g, '');

        // 清理多余空格
        result = result.replace(/\s+/g, ' ').trim();

        return result;
    }

    /**
     * 渲染卡片组件到 PPTX - 自动布局图标+标题+描述
     * 将卡片分解为背景形状 + 图标 + 文字元素
     */
    renderFreeformCardPPTX(slide, el, x, y, w, h) {
        const layout = el.layout || 'horizontal';
        const padding = (el.padding || 16) / this.styles.dimensions.pxPerInch; // px to inch
        const radius = (el.radius || 12) / this.styles.dimensions.pxPerInch;

        // 1. 渲染背景形状
        const bgOptions = {
            x: x || 0,
            y: y || 0,
            w: w || 2,
            h: h || 1,
            fill: { color: this.safeColor(el.fill) || 'FFFFFF' },
            line: el.stroke ? {
                color: this.safeColor(el.stroke) || 'E2E8F0',
                width: el.strokeWidth || 1
            } : { color: 'FFFFFF', transparency: 100 },
        };

        if (radius > 0) {
            bgOptions.rectRadius = radius;
        }

        try {
            slide.addShape(radius > 0 ? 'roundRect' : 'rect', bgOptions);
        } catch (e) {
            console.warn('Failed to add card background:', e);
        }

        // 计算内部布局
        const innerX = x + padding;
        const innerY = y + padding;
        const innerW = w - padding * 2;
        const innerH = h - padding * 2;

        const iconSize = (el.iconSize || 24) / this.styles.dimensions.pxPerInch;
        const iconBgSize = iconSize * 1.5;
        const gap = 0.12; // 12px gap in inches

        // px to pt 转换（与 renderFreeformTextPPTX 保持一致）
        const titleSize = Math.round((el.titleSize || 16) * 0.72);
        const subtitleSize = Math.round((el.subtitleSize || 13) * 0.72);

        if (layout === 'vertical') {
            // 垂直布局：图标在上，文字在下，居中
            const titleLineH = titleSize / 72 * 1.3;
            const subtitleLineH = subtitleSize / 72 * 1.3;
            const textGap = 0.05;
            const contentH = iconBgSize + gap + titleLineH + (el.subtitle ? textGap + subtitleLineH : 0);
            const startY = innerY + (innerH - contentH) / 2;

            // 图标背景（如果有）
            if (el.icon && el.iconBg) {
                const iconBgX = innerX + (innerW - iconBgSize) / 2;
                slide.addShape('roundRect', {
                    x: iconBgX,
                    y: startY,
                    w: iconBgSize,
                    h: iconBgSize,
                    fill: { color: this.safeColor(el.iconBg) },
                    line: { color: 'FFFFFF', transparency: 100 },
                    rectRadius: iconBgSize / 4,
                });
            }

            // 图标
            if (el.icon) {
                const iconColor = this.safeColor(el.iconColor) || '4f46e5';
                const iconKey = `${el.icon}_${iconColor}`;
                const iconX = innerX + (innerW - iconSize) / 2;
                
                if (this.iconCache && this.iconCache[iconKey]) {
                    // 使用预加载的 SVG 图标
                    slide.addImage({
                        data: this.iconCache[iconKey],
                        x: iconX,
                        y: startY + (iconBgSize - iconSize) / 2,
                        w: iconSize,
                        h: iconSize,
                    });
                } else {
                    // Fallback: emoji
                    const emoji = this.getIconEmoji(el.icon);
                    this.addText(slide, emoji, {
                        x: innerX,
                        y: startY,
                        w: innerW,
                        h: iconBgSize,
                        fontSize: Math.round(el.iconSize || 24),
                        color: iconColor,
                        align: 'center',
                        valign: 'middle',
                    });
                }
            }

            // 标题
            if (el.title) {
                this.addText(slide, el.title, {
                    x: innerX,
                    y: startY + iconBgSize + gap,
                    w: innerW,
                    h: titleLineH,
                    fontSize: titleSize,
                    color: this.safeColor(el.titleColor) || '1f2937',
                    bold: el.titleBold !== false,
                    align: 'center',
                    valign: 'middle',
                });
            }

            // 副标题
            if (el.subtitle) {
                this.addText(slide, el.subtitle, {
                    x: innerX,
                    y: startY + iconBgSize + gap + titleLineH + textGap,
                    w: innerW,
                    h: subtitleLineH,
                    fontSize: subtitleSize,
                    color: this.safeColor(el.subtitleColor) || '6b7280',
                    align: 'center',
                    valign: 'middle',
                });
            }
        } else {
            // 水平布局（horizontal 或 icon-right）
            const isIconRight = layout === 'icon-right';
            const iconAreaW = el.icon ? iconBgSize + gap : 0;
            const textAreaW = innerW - iconAreaW;
            const textX = isIconRight ? innerX : innerX + iconAreaW;
            const iconX = isIconRight ? innerX + textAreaW + gap : innerX;

            // 图标背景（如果有）
            if (el.icon && el.iconBg) {
                const iconBgY = innerY + (innerH - iconBgSize) / 2;
                slide.addShape('roundRect', {
                    x: iconX,
                    y: iconBgY,
                    w: iconBgSize,
                    h: iconBgSize,
                    fill: { color: this.safeColor(el.iconBg) },
                    line: { color: 'FFFFFF', transparency: 100 },
                    rectRadius: iconBgSize / 4,
                });
            }

            // 图标
            if (el.icon) {
                const iconColor = this.safeColor(el.iconColor) || '4f46e5';
                const iconKey = `${el.icon}_${iconColor}`;
                const iconImgX = iconX + (iconBgSize - iconSize) / 2;
                const iconImgY = innerY + (innerH - iconSize) / 2;
                
                if (this.iconCache && this.iconCache[iconKey]) {
                    // 使用预加载的 SVG 图标
                    slide.addImage({
                        data: this.iconCache[iconKey],
                        x: iconImgX,
                        y: iconImgY,
                        w: iconSize,
                        h: iconSize,
                    });
                } else {
                    // Fallback: emoji
                    const emoji = this.getIconEmoji(el.icon);
                    this.addText(slide, emoji, {
                        x: iconX,
                        y: innerY,
                        w: iconBgSize,
                        h: innerH,
                        fontSize: Math.round(el.iconSize || 24),
                        color: iconColor,
                        align: 'center',
                        valign: 'middle',
                    });
                }
            }

            // 文字区域 - 标题和副标题垂直居中
            const hasSubtitle = !!el.subtitle;
            // 估算文字高度（pt 转 inch: pt / 72）
            const titleLineH = titleSize / 72 * 1.3; // 1.3 行高
            const subtitleLineH = subtitleSize / 72 * 1.3;
            const textGap = hasSubtitle ? 0.05 : 0; // 标题副标题间距
            const totalTextH = titleLineH + (hasSubtitle ? textGap + subtitleLineH : 0);
            
            // 垂直居中起始位置
            const textStartY = innerY + (innerH - totalTextH) / 2;

            // 标题
            if (el.title) {
                this.addText(slide, el.title, {
                    x: textX,
                    y: textStartY,
                    w: textAreaW - gap,
                    h: titleLineH,
                    fontSize: titleSize,
                    color: this.safeColor(el.titleColor) || '1f2937',
                    bold: el.titleBold !== false,
                    align: 'left',
                    valign: 'middle',
                });
            }

            // 副标题
            if (el.subtitle) {
                this.addText(slide, el.subtitle, {
                    x: textX,
                    y: textStartY + titleLineH + textGap,
                    w: textAreaW - gap,
                    h: subtitleLineH,
                    fontSize: subtitleSize,
                    color: this.safeColor(el.subtitleColor) || '6b7280',
                    align: 'left',
                    valign: 'middle',
                });
            }
        }
    }

    /**
     * 判断是否需要效果降级提示
     */
    _needsEffectHint(el) {
        return (el.blend && el.blend !== 'normal') || el.mask || el.filter;
    }

    /**
     * 在 PPTX 中添加轻量提示，说明混合/遮罩/滤镜已降级
     */
    _addEffectHint(slide, el, x = 0, y = 0) {
        const hints = [];
        if (el.blend && el.blend !== 'normal') hints.push(`blend:${el.blend}`);
        if (el.mask) hints.push('mask');
        if (el.filter) hints.push('filter');
        if (hints.length === 0) return;

        slide.addText(`[效果降级: ${hints.join(', ')}]`, {
            x,
            y: y + 0.05,
            w: 2.4,
            h: 0.2,
            fontSize: 8,
            color: '999999',
            italic: true,
            align: 'left',
        });
    }

    /**
     * 渲染 SVG 到 PPTX（使用预加载的缓存）
     */
    renderFreeformSvgPPTX(slide, el, x, y, w, h) {
        try {
            // 从缓存获取预加载的 SVG
            const key = this._hashString(el.content || '');
            const svgDataUrl = this.svgCache?.[key];
            
            if (svgDataUrl) {
                slide.addImage({
                    data: svgDataUrl,
                    x: x || 0,
                    y: y || 0,
                    w: w || 2,
                    h: h || 2,
                });
            } else {
                console.warn('[renderFreeformSvgPPTX] SVG not in cache, key:', key);
                // 降级：添加占位符
                this.addImagePlaceholder(slide, x, y, w, h, 'SVG');
            }
        } catch (e) {
            console.warn('[renderFreeformSvgPPTX] Failed to render SVG:', e);
            this.addImagePlaceholder(slide, x, y, w, h, 'SVG');
        }
    }

    /**
     * 将 SVG 内容转换为 Base64 图片
     */
    async svgToBase64(svgContent, width, height) {
        if (!svgContent) return null;

        try {
            const pxWidth = Math.round(width * 96);
            const pxHeight = Math.round(height * 96);
            
            // 确保 SVG 有正确的尺寸和 xmlns
            let svg = svgContent.trim();
            if (!svg.toLowerCase().startsWith('<svg')) {
                svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pxWidth}" height="${pxHeight}" viewBox="0 0 ${pxWidth} ${pxHeight}">${svg}</svg>`;
            } else {
                // 确保有 xmlns 和正确的尺寸
                svg = svg.replace(/<svg([^>]*)>/, (match, attrs) => {
                    if (!attrs.includes('xmlns=')) {
                        attrs = ` xmlns="http://www.w3.org/2000/svg"` + attrs;
                    }
                    // 移除原有的 width/height，使用新的
                    attrs = attrs.replace(/\s*width\s*=\s*["'][^"']*["']/gi, '');
                    attrs = attrs.replace(/\s*height\s*=\s*["'][^"']*["']/gi, '');
                    attrs += ` width="${pxWidth}" height="${pxHeight}"`;
                    return `<svg${attrs}>`;
                });
            }

            // 创建 Blob 和图片
            const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);

            return new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    // 使用 canvas 转换为 PNG
                    const canvas = document.createElement('canvas');
                    const scale = 2; // 提高清晰度
                    canvas.width = pxWidth * scale;
                    canvas.height = pxHeight * scale;
                    const ctx = canvas.getContext('2d');
                    ctx.scale(scale, scale);
                    ctx.drawImage(img, 0, 0, pxWidth, pxHeight);
                    URL.revokeObjectURL(url);
                    resolve(canvas.toDataURL('image/png'));
                };
                img.onerror = (e) => {
                    console.warn('[svgToBase64] Image load error:', e);
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

    /**
     * 渲染表格到 PPTX
     * 使用 PptxGenJS 原生表格功能
     */
    renderFreeformTablePPTX(slide, el, x, y, w, h) {
        const data = el.data || [];
        if (data.length === 0) return;

        const cols = Math.max(...data.map(row => (row || []).length));
        const colW = w / cols;

        // 构建 PptxGenJS 表格数据
        const tableRows = data.map((row, rowIndex) => {
            const isHeader = rowIndex === 0;
            return (row || []).map(cell => ({
                text: String(cell || ''),
                options: {
                    fill: { color: this.safeColor(isHeader ? el.headerBg : (rowIndex % 2 === 0 ? el.altRowBg : el.rowBg)) },
                    color: this.safeColor(isHeader ? el.headerColor : el.cellColor),
                    bold: isHeader,
                    align: 'center',
                    valign: 'middle',
                    fontSize: Math.round((el.fontSize || 14) * 0.72),
                    fontFace: this.fontFace,
                }
            }));
        });

        try {
            slide.addTable(tableRows, {
                x: x || 0,
                y: y || 0,
                w: w || 4,
                colW: Array(cols).fill(colW),
                border: { pt: 1, color: this.safeColor(el.borderColor) || 'E2E8F0' },
                fontFace: this.fontFace,
            });
        } catch (e) {
            console.warn('[renderFreeformTablePPTX] Failed to render table:', e);
        }
    }
}
