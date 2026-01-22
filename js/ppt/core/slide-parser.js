// NOTE: This file may be evaluated more than once in some test/bundler setups.
// Using a `var` + global reuse avoids "Identifier has already been declared".
var SlideParser = (typeof globalThis !== 'undefined' &&
    globalThis.SlideParser &&
    typeof globalThis.SlideParser.parse === 'function')
    ? globalThis.SlideParser
    : class SlideParser {
    /**
     * 解析 CSS style 字符串为对象
     * "color: red; font-size: 16px;" => { color: "red", fontSize: "16px" }
     */
    static parseStyleString(styleStr) {
        if (!styleStr) return {};
        const result = {};
        styleStr.split(';').forEach(rule => {
            const [prop, ...valueParts] = rule.split(':');
            if (prop && valueParts.length) {
                // 转换 kebab-case 为 camelCase
                const camelProp = prop.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
                result[camelProp] = valueParts.join(':').trim();
            }
        });
        return result;
    }

    /**
     * 从 CSS 值中提取数字（支持 px, %, em 等单位）
     */
    static parseCSSNumber(value, defaultVal = 0) {
        if (value === undefined || value === null) return defaultVal;
        const num = parseFloat(value);
        return isNaN(num) ? defaultVal : num;
    }

    /**
     * 从 transform 属性解析 rotate 角度
     * "rotate(45deg)" => 45
     */
    static parseRotateFromTransform(transform) {
        if (!transform) return null;
        const match = transform.match(/rotate\(([^)]+)\)/);
        if (match) {
            return parseFloat(match[1]) || 0;
        }
        return null;
    }

    /**
     * 从 border 属性解析颜色
     * "1px solid #333" => "#333"
     */
    static parseBorderColor(border) {
        if (!border) return null;
        const colorMatch = border.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|[a-z]+$/i);
        return colorMatch ? colorMatch[0] : null;
    }

    /**
     * 从 border 属性解析宽度
     * "1px solid #333" => 1
     */
    static parseBorderWidth(border) {
        if (!border) return 0;
        const widthMatch = border.match(/(\d+(?:\.\d+)?)\s*px/);
        return widthMatch ? parseFloat(widthMatch[1]) : 0;
    }

    /**
     * 解析 HTML 字符串或 DOM 元素，返回 SlideSchema 数组
     */
    static parse(htmlInput) {
        console.log('[SlideParser] Starting parse...');
        let container;

        if (typeof htmlInput === 'string') {
            const DOMParserCtor = (typeof DOMParser !== 'undefined' && DOMParser) || (typeof window !== 'undefined' && window.DOMParser);
            if (typeof DOMParserCtor !== 'function') {
                throw new Error('[SlideParser] DOMParser is not available in this environment');
            }
            const parser = new DOMParserCtor();
            const doc = parser.parseFromString(htmlInput, 'text/html');
            container = doc.body || document.createElement('div');
            // linkedom DOMParser('text/html') may leave doc.body empty while doc itself contains nodes
            if (container === doc.body) {
                const hasSectionsInBody = doc.body?.querySelector?.('section[data-type]');
                if (!hasSectionsInBody) {
                    const hasSectionsInDoc = doc.querySelector?.('section[data-type]');
                    if (hasSectionsInDoc) container = doc;
                }
            }
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
     * 简化：统一使用 freeform 解析
     */
    static parseSection(section, index) {
        const baseSlide = {
            id: section.id || `slide-${index}`,
            type: 'freeform',
            elements: [],
        };
        return this.parseFreeform(section, baseSlide);
    }

    /**
     * 解析自由布局幻灯片 - AI 可以精确控制每个元素
     */
    static parseFreeform(section, slide) {
        // 解析幻灯片级别属性
        slide.background = section.dataset.bg || '#ffffff';
        slide.backgroundGradient = section.dataset.gradient || null;
        slide.backgroundImage = section.dataset.bgImage || null;

        // 使用计数器对象确保所有元素（包括 group 子元素）有稳定的解析顺序（用于 z 等默认值）
        const counter = { value: 0 };

        // 解析支持深层 data-el：允许嵌套，优先尊重 data-group 分层
        const elements = section.querySelectorAll('[data-el]');
        const topLevel = Array.from(elements).filter(el => {
            const parentWithEl = el.parentElement?.closest('[data-el]');
            return !parentWithEl; // 只收集顶层 data-el，其子元素由 group 递归解析
        });
        slide.elements = topLevel.map((el) => this.parseElement(el, counter));

        return slide;
    }

    /**
     * 解析单个自由元素
     * 优先级：style 属性 > data-* 属性 > 默认值
     * @param {Element} el - DOM 元素
     * @param {Object} counter - 全局计数器 { value: number }
     */
    static parseElement(el, counter) {
        const index = counter.value++;  // 使用并递增计数器
        const type = el.dataset.el;
        // 解析 style 属性（标准 CSS）
        const css = this.parseStyleString(el.getAttribute('style'));
        // 保留原始 style 字符串，供 HTML 渲染器直接使用
        const rawStyle = el.getAttribute('style') || '';
        
        const base = {
            id: el.id || `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            type,
            // 原始 CSS 样式（HTML 渲染器直接使用）
            rawStyle,
            // 位置和大小：优先从 CSS 读取
            x: css.left || el.dataset.x || '0%',
            y: css.top || el.dataset.y || '0%',
            w: css.width || el.dataset.w || 'auto',
            h: css.height || el.dataset.h || 'auto',
            // 层级
            z: this.parseCSSNumber(css.zIndex, null) ?? (parseInt(el.dataset.z) || index),
            // 旋转（从 transform 解析或 data-rotate）
            rotate: this.parseRotateFromTransform(css.transform) ?? (parseFloat(el.dataset.rotate) || 0),
            // 透明度
            opacity: this.parseCSSNumber(css.opacity, null) ?? parseFloat(el.dataset.opacity) ?? 1,
            // 混合与效果
            blend: css.mixBlendMode || el.dataset.blend || 'normal',
            filter: css.filter || el.dataset.filter || null,
            mask: css.maskImage || css.webkitMaskImage || el.dataset.mask || null,
            outline: el.dataset.outline || null,
            // 预设效果（shadow-sm, shadow-md, shadow-lg 等）
            effect: el.dataset.effect || null,
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
                    // 文字样式：CSS 优先
                    font: this.parseCSSNumber(css.fontSize) || parseFloat(el.dataset.font) || 18,
                    color: css.color || el.dataset.color || '#333333',
                    bold: css.fontWeight === 'bold' || css.fontWeight === '700' || el.dataset.bold === 'true',
                    italic: css.fontStyle === 'italic' || el.dataset.italic === 'true',
                    align: css.textAlign || el.dataset.align || 'left',
                    valign: el.dataset.valign || 'top',
                    lineHeight: this.parseCSSNumber(css.lineHeight) || parseFloat(el.dataset.lineHeight) || 1.4,
                    fontFamily: css.fontFamily || el.dataset.fontFamily || null,
                    letterSpacing: css.letterSpacing || el.dataset.letterSpacing || null,
                    // 文字装饰
                    underline: css.textDecoration?.includes('underline') || el.dataset.underline === 'true',
                    strike: css.textDecoration?.includes('line-through') || el.dataset.strike === 'true',
                    // 上标/下标
                    superscript: el.dataset.superscript === 'true',
                    subscript: el.dataset.subscript === 'true',
                    // 背景
                    bgColor: css.backgroundColor || el.dataset.bgColor || null,
                    bgRadius: this.parseCSSNumber(css.borderRadius) || parseFloat(el.dataset.bgRadius) || 0,
                };

            case 'shape':
                return {
                    ...base,
                    shape: el.dataset.shape || 'rect',
                    // CSS 优先
                    fill: css.background || css.backgroundColor || el.dataset.fill || '#4f46e5',
                    stroke: this.parseBorderColor(css.border) || el.dataset.stroke || null,
                    strokeWidth: this.parseBorderWidth(css.border) || parseFloat(el.dataset.strokeWidth) || 0,
                    radius: this.parseCSSNumber(css.borderRadius) || parseFloat(el.dataset.radius) || 0,
                    gradient: el.dataset.gradient || null,
                    shadow: css.boxShadow ? true : el.dataset.shadow === 'true',
                };

            case 'image':
                return {
                    ...base,
                    src: el.dataset.src || el.getAttribute('src') || '',
                    alt: el.dataset.alt || el.getAttribute('alt') || '图片',
                    fit: css.objectFit || el.dataset.fit || 'cover',
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
                // 递归解析子元素（传递同一个 counter 以保持顺序一致）
                const children = el.querySelectorAll(':scope > [data-el]');
                return {
                    ...base,
                    children: Array.from(children).map((child) => this.parseElement(child, counter)),
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

            case 'svg':
                // 内联 SVG 元素 - AI 可以画复杂图形、表格、流程图等
                return {
                    ...base,
                    // SVG 内容：可以是完整的 SVG 代码或 data-svg 属性
                    content: el.dataset.svg || el.innerHTML?.trim() || '',
                    // 背景色（可选）
                    bgColor: el.dataset.bgColor || null,
                    // 边框圆角
                    radius: parseFloat(el.dataset.radius) || 0,
                    // 保持宽高比
                    preserveAspectRatio: el.dataset.preserveAspectRatio || 'xMidYMid meet',
                };

            case 'table':
                // 表格元素 - 结构化数据，自动生成 SVG 表格
                return {
                    ...base,
                    // 表格数据：JSON 格式 [["Header1", "Header2"], ["Row1Col1", "Row1Col2"], ...]
                    // 容错：支持行内文本格式（每行用换行分隔，每列用逗号分隔）
                    data: (() => {
                        // 1. 优先尝试 JSON 格式
                        if (el.dataset.data) {
                            try {
                                return JSON.parse(el.dataset.data);
                            } catch (e) {
                                console.warn('[SlideParser] Invalid table JSON data:', e);
                            }
                        }
                        // 2. 容错：尝试解析行内文本格式（每行换行分隔，每列逗号分隔）
                        const textContent = el.textContent || el.innerHTML || '';
                        if (textContent.trim()) {
                            const rows = [];
                            // 如果有 headers 属性，先添加表头
                            if (el.dataset.headers) {
                                rows.push(el.dataset.headers.split(',').map(s => s.trim()));
                            }
                            // 解析行内容
                            const lines = textContent.split('\n').map(s => s.trim()).filter(Boolean);
                            lines.forEach(line => {
                                const cells = line.split(',').map(s => s.trim());
                                if (cells.length > 0 && cells.some(c => c)) {
                                    rows.push(cells);
                                }
                            });
                            if (rows.length > 0) return rows;
                        }
                        return [];
                    })(),
                    // 样式（兼容 data-header-fill 和 data-header-bg）
                    headerBg: el.dataset.headerFill || el.dataset.headerBg || '#4f46e5',
                    headerColor: el.dataset.headerColor || '#ffffff',
                    rowBg: el.dataset.rowFill?.split(',')[0]?.trim() || el.dataset.rowBg || '#ffffff',
                    altRowBg: el.dataset.rowFill?.split(',')[1]?.trim() || el.dataset.altRowBg || '#f8fafc',
                    cellColor: el.dataset.cellColor || '#1f2937',
                    borderColor: el.dataset.borderColor || '#e2e8f0',
                    fontSize: parseFloat(el.dataset.cellFont) || parseFloat(el.dataset.fontSize) || 12,
                    headerFontSize: parseFloat(el.dataset.headerFont) || parseFloat(el.dataset.fontSize) || 14,
                    radius: parseFloat(el.dataset.radius) || 8,
                };

            case 'list':
                // 列表元素 - 有序或无序列表
                return {
                    ...base,
                    // 列表类型：ul (无序) / ol (有序)
                    listType: el.dataset.listType || 'ul',
                    // 列表项：JSON 数组 ["Item 1", "Item 2", ...]
                    items: (() => {
                        try {
                            return JSON.parse(el.dataset.items || '[]');
                        } catch (e) {
                            // 如果不是 JSON，尝试用换行分割
                            return (el.innerHTML || '').split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
                        }
                    })(),
                    // 样式
                    font: parseFloat(el.dataset.font) || 16,
                    color: el.dataset.color || '#333333',
                    bulletColor: el.dataset.bulletColor || el.dataset.color || '#333333',
                    bulletSize: parseFloat(el.dataset.bulletSize) || 8,
                    lineHeight: parseFloat(el.dataset.lineHeight) || 1.6,
                    indent: parseFloat(el.dataset.indent) || 24,
                };

            default:
                return base;
        }
    }
};

// 兼容：浏览器全局 + Node.js 单测
if (typeof globalThis !== 'undefined') {
    globalThis.SlideParser = SlideParser;
}
if (typeof window !== 'undefined') {
    window.SlideParser = SlideParser;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { SlideParser };
}

// ============================================================
// 3. HTMLSlideRenderer - 渲染到 HTML (浏览器预览)
// 使用与 PPTX 相同的参数，自动缩放到预览尺寸
// ============================================================

// ESM 导出
export { SlideParser };
