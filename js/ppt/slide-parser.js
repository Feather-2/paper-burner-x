class SlideParser {
    /**
     * 解析 HTML 字符串或 DOM 元素，返回 SlideSchema 数组
     */
    static parse(htmlInput) {
        console.log('[SlideParser] Starting parse...');
        let container;

        if (typeof htmlInput === 'string') {
            container = document.createElement('div');
            container.innerHTML = htmlInput;
            console.log('[SlideParser] Input is string, length:', htmlInput.length);
        } else {
            container = htmlInput;
            console.log('[SlideParser] Input is element');
        }

        const sections = container.querySelectorAll('section[data-type]');
        console.log('[SlideParser] Found', sections.length, 'sections');
        const slides = [];

        sections.forEach((section, index) => {
            const slide = this.parseSection(section, index);
            if (slide) {
                console.log(`[SlideParser] Slide ${index}: type=${slide.type}, elements=${slide.elements?.length || 0}`);
                slides.push(slide);
            }
        });

        console.log('[SlideParser] Total parsed slides:', slides.length);
        return slides;
    }

    /**
     * 解析单个 section 元素
     */
    static parseSection(section, index) {
        const type = section.dataset.type || 'content';
        const baseSlide = {
            id: section.id || `slide-${index}`,
            type,
            elements: [],
        };

        // 根据类型使用不同的解析策略
        switch (type) {
            case 'cover':
                return this.parseCover(section, baseSlide);
            case 'toc':
                return this.parseToc(section, baseSlide);
            case 'stats':
                return this.parseStats(section, baseSlide);
            case 'comparison':
                return this.parseComparison(section, baseSlide);
            case 'image_text':
                return this.parseImageText(section, baseSlide);
            case 'icon_grid':
                return this.parseIconGrid(section, baseSlide);
            case 'quote':
                return this.parseQuote(section, baseSlide);
            case 'timeline':
                return this.parseTimeline(section, baseSlide);
            case 'end':
                return this.parseEnd(section, baseSlide);
            case 'list':
                return this.parseList(section, baseSlide);
            case 'freeform':
                return this.parseFreeform(section, baseSlide);
            default:
                return this.parseContent(section, baseSlide);
        }
    }

    // --- 具体类型解析器 ---

    static parseCover(section, slide) {
        const h1 = section.querySelector('h1');
        const subtitle = section.querySelector('p, .subtitle');

        slide.title = h1?.textContent?.trim() || '';
        slide.subtitle = subtitle?.textContent?.trim() || '';
        slide.background = 'gradient-primary';

        return slide;
    }

    static parseToc(section, slide) {
        const h2 = section.querySelector('h2');
        const items = section.querySelectorAll('li, .toc-item');

        slide.title = h2?.textContent?.trim() || '目录';
        slide.items = Array.from(items).map(li => li.textContent.trim());

        return slide;
    }

    static parseStats(section, slide) {
        const h2 = section.querySelector('h2');
        const statElements = section.querySelectorAll('.stat, [data-stat]');

        slide.title = h2?.textContent?.trim() || '';
        slide.stats = Array.from(statElements).map(el => ({
            value: el.querySelector('.stat-value, .value')?.textContent?.trim() || el.dataset.value || '',
            label: el.querySelector('.stat-label, .label')?.textContent?.trim() || el.dataset.label || '',
        }));

        return slide;
    }

    static parseComparison(section, slide) {
        const h2 = section.querySelector('h2');
        const leftCol = section.querySelector('.left, [data-side="left"]');
        const rightCol = section.querySelector('.right, [data-side="right"]');

        slide.title = h2?.textContent?.trim() || '';
        slide.left = {
            title: leftCol?.querySelector('h3, .title')?.textContent?.trim() || '',
            items: Array.from(leftCol?.querySelectorAll('li') || []).map(li => li.textContent.trim()),
        };
        slide.right = {
            title: rightCol?.querySelector('h3, .title')?.textContent?.trim() || '',
            items: Array.from(rightCol?.querySelectorAll('li') || []).map(li => li.textContent.trim()),
        };

        return slide;
    }

    static parseImageText(section, slide) {
        const h2 = section.querySelector('h2');
        const p = section.querySelector('p:not(.caption)');
        const img = section.querySelector('img, .image-placeholder');

        slide.title = h2?.textContent?.trim() || '';
        slide.content = p?.textContent?.trim() || '';
        slide.image = img?.src || null;
        slide.imagePlaceholder = img?.alt || img?.textContent?.trim() || '图片';

        return slide;
    }

    static parseIconGrid(section, slide) {
        const h2 = section.querySelector('h2');
        const cards = section.querySelectorAll('.card, .grid-item, [data-icon]');

        slide.title = h2?.textContent?.trim() || '';
        slide.items = Array.from(cards).map(card => ({
            icon: card.dataset.icon || card.querySelector('[data-icon]')?.dataset.icon || 'carbon:star',
            title: card.querySelector('h3, h4, .title')?.textContent?.trim() || '',
            desc: card.querySelector('p, .desc')?.textContent?.trim() || '',
        }));

        return slide;
    }

    static parseQuote(section, slide) {
        const blockquote = section.querySelector('blockquote, .quote');
        const author = section.querySelector('.author, cite');
        const company = section.querySelector('.company, .org');

        slide.quote = blockquote?.textContent?.trim()?.replace(/^[""]|[""]$/g, '') || '';
        slide.author = author?.textContent?.trim() || '';
        slide.company = company?.textContent?.trim() || '';
        slide.background = 'purple';

        return slide;
    }

    static parseTimeline(section, slide) {
        const h2 = section.querySelector('h2');
        const nodes = section.querySelectorAll('.timeline-item, [data-phase]');

        slide.title = h2?.textContent?.trim() || '';
        slide.items = Array.from(nodes).map(node => ({
            phase: node.dataset.phase || node.querySelector('.phase')?.textContent?.trim() || '',
            title: node.querySelector('h3, h4, .title')?.textContent?.trim() || '',
            desc: node.querySelector('p, .desc')?.textContent?.trim() || '',
        }));

        return slide;
    }

    static parseEnd(section, slide) {
        const h1 = section.querySelector('h1, h2');
        const subtitle = section.querySelector('p, .subtitle');
        const email = section.querySelector('.email, [data-email]');

        slide.title = h1?.textContent?.trim() || '';
        slide.subtitle = subtitle?.textContent?.trim() || '';
        slide.email = email?.textContent?.trim() || email?.dataset?.email || '';
        slide.background = 'dark';

        return slide;
    }

    static parseList(section, slide) {
        const h2 = section.querySelector('h2');
        const items = section.querySelectorAll('li');

        slide.title = h2?.textContent?.trim() || '';
        slide.items = Array.from(items).map(li => li.textContent.trim());

        return slide;
    }

    static parseContent(section, slide) {
        const h2 = section.querySelector('h2, h1');
        const p = section.querySelector('p');

        slide.title = h2?.textContent?.trim() || '';
        slide.content = p?.textContent?.trim() || '';

        return slide;
    }

    /**
     * 解析自由布局幻灯片 - AI 可以精确控制每个元素
     */
    static parseFreeform(section, slide) {
        // 解析幻灯片级别属性
        slide.background = section.dataset.bg || '#ffffff';
        slide.backgroundGradient = section.dataset.gradient || null;
        slide.backgroundImage = section.dataset.bgImage || null;

        // 只解析直接子元素，避免嵌套元素被重复解析
        const elements = section.querySelectorAll(':scope > [data-el]');
        slide.elements = Array.from(elements).map((el, i) => this.parseElement(el, i));

        return slide;
    }

    /**
     * 解析单个自由元素
     */
    static parseElement(el, index) {
        const type = el.dataset.el;
        const base = {
            id: el.id || `el-${index}`,
            type,
            // 位置和大小 (支持 %, px, in)
            x: el.dataset.x || '0%',
            y: el.dataset.y || '0%',
            w: el.dataset.w || 'auto',
            h: el.dataset.h || 'auto',
            // 层级
            z: parseInt(el.dataset.z) || index,
            // 旋转
            rotate: parseFloat(el.dataset.rotate) || 0,
            // 透明度
            opacity: parseFloat(el.dataset.opacity) ?? 1,
        };

        switch (type) {
            case 'text':
                // 获取 HTML 内容，同时处理可能被转义的标签
                let textContent = el.innerHTML?.trim() || '';
                // 如果内容包含转义的 HTML 实体，反转义它们
                if (textContent.includes('&lt;') || textContent.includes('&gt;')) {
                    const temp = document.createElement('textarea');
                    temp.innerHTML = textContent;
                    textContent = temp.value;
                }
                // DEBUG: 检查解析结果
                if (textContent.includes('GLOBAL') || textContent.includes('br')) {
                    console.log('[SlideParser] Text content:', JSON.stringify(textContent));
                }
                return {
                    ...base,
                    content: textContent,
                    // 文字样式
                    font: parseFloat(el.dataset.font) || 18,
                    color: el.dataset.color || '#333333',
                    bold: el.dataset.bold === 'true',
                    italic: el.dataset.italic === 'true',
                    align: el.dataset.align || 'left',       // left, center, right
                    valign: el.dataset.valign || 'top',      // top, middle, bottom
                    lineHeight: parseFloat(el.dataset.lineHeight) || 1.4,
                    // 背景
                    bgColor: el.dataset.bgColor || null,
                    bgRadius: parseFloat(el.dataset.bgRadius) || 0,
                };

            case 'shape':
                return {
                    ...base,
                    shape: el.dataset.shape || 'rect',       // rect, circle, rounded, triangle
                    fill: el.dataset.fill || '#4f46e5',
                    stroke: el.dataset.stroke || null,
                    strokeWidth: parseFloat(el.dataset.strokeWidth) || 0,
                    radius: parseFloat(el.dataset.radius) || 0,
                    // 渐变支持
                    gradient: el.dataset.gradient || null,   // "linear(#ff0, #f00)" or "radial(...)"
                    // 阴影
                    shadow: el.dataset.shadow === 'true',
                };

            case 'image':
                return {
                    ...base,
                    src: el.dataset.src || '',
                    alt: el.dataset.alt || '图片',
                    fit: el.dataset.fit || 'cover',          // cover, contain, fill
                    radius: parseFloat(el.dataset.radius) || 0,
                    // 边框
                    border: el.dataset.border || null,
                };

            case 'icon':
                return {
                    ...base,
                    icon: el.dataset.icon || 'carbon:star',
                    size: parseFloat(el.dataset.size) || 24,
                    color: el.dataset.color || '#333333',
                };

            case 'line':
                return {
                    ...base,
                    x1: el.dataset.x1 || '0%',
                    y1: el.dataset.y1 || '0%',
                    x2: el.dataset.x2 || '100%',
                    y2: el.dataset.y2 || '0%',
                    stroke: el.dataset.stroke || '#cccccc',
                    strokeWidth: parseFloat(el.dataset.strokeWidth) || 2,
                    dash: el.dataset.dash || null,           // "5,5" for dashed
                };

            case 'chart':
                // 图表类型：支持 bar, line, pie, doughnut
                return {
                    ...base,
                    chartType: el.dataset.chartType || 'bar',
                    // 数据格式: "Label1:Value1,Label2:Value2,..."
                    chartData: el.dataset.chartData || '',
                    // 颜色数组: "#ff0000,#00ff00,#0000ff"
                    colors: el.dataset.colors || '#4f46e5,#10b981,#f59e0b,#ec4899,#6366f1',
                    title: el.textContent?.trim() || '',
                };

            case 'formula':
                // 数学公式 - 使用 KaTeX 渲染
                return {
                    ...base,
                    latex: el.dataset.latex || el.textContent?.trim() || '',
                    font: parseFloat(el.dataset.font) || 24,
                    color: el.dataset.color || '#333333',
                    align: el.dataset.align || 'center',
                    displayMode: el.dataset.displayMode !== 'false', // 默认为 display 模式
                };

            case 'group':
                // 递归解析子元素
                const children = el.querySelectorAll(':scope > [data-el]');
                return {
                    ...base,
                    children: Array.from(children).map((child, i) => this.parseElement(child, i)),
                };

            case 'card':
                // 卡片组件 - 自动布局图标+标题+描述
                return {
                    ...base,
                    layout: el.dataset.layout || 'horizontal', // horizontal, vertical, icon-right
                    fill: el.dataset.fill || '#ffffff',
                    radius: parseFloat(el.dataset.radius) || 12,
                    padding: parseFloat(el.dataset.padding) || 16,
                    shadow: el.dataset.shadow === 'true',
                    // 图标
                    icon: el.dataset.icon || null,
                    iconSize: parseFloat(el.dataset.iconSize) || 24,
                    iconColor: el.dataset.iconColor || '#4f46e5',
                    iconBg: el.dataset.iconBg || null,
                    // 标题
                    title: el.dataset.title || '',
                    titleSize: parseFloat(el.dataset.titleSize) || 16,
                    titleColor: el.dataset.titleColor || '#1f2937',
                    titleBold: el.dataset.titleBold !== 'false', // 默认加粗
                    // 副标题
                    subtitle: el.dataset.subtitle || '',
                    subtitleSize: parseFloat(el.dataset.subtitleSize) || 13,
                    subtitleColor: el.dataset.subtitleColor || '#6b7280',
                    // 边框
                    stroke: el.dataset.stroke || null,
                    strokeWidth: parseFloat(el.dataset.strokeWidth) || 1,
                };

            default:
                return base;
        }
    }
}

// ============================================================
// 3. HTMLSlideRenderer - 渲染到 HTML (浏览器预览)
// 使用与 PPTX 相同的参数，自动缩放到预览尺寸
// ============================================================
