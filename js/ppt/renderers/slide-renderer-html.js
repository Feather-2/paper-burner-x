function escapeAttr(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

class HTMLSlideRenderer {
    constructor(options = {}) {
        this.styles = SlideStyles;
        // 缩放因子: HTML预览尺寸 / PPTX原始尺寸
        // 现在统一使用 960x540，scale = 1 (无需缩放)
        this.scale = this.styles.htmlScale;
    }

    // 工具方法：将 PPTX pt 转换为 HTML px
    px(pt) { return Math.round(pt * this.scale); }
    // 工具方法：将 PPTX 英寸转换为 HTML px
    inch(val) { return Math.round(val * this.styles.dimensions.pxPerInch * this.scale); }

    // 获取标准 padding (px)
    get padding() { return this.inch(this.styles.padding.normal); }
    get paddingLarge() { return this.inch(this.styles.padding.large); }

    // 字体家族
    get fontFamily() { return this.styles.fontFamily.main; }

    // 字体大小
    get fonts() {
        const f = this.styles.fonts;
        return {
            coverTitle: this.px(f.coverTitle),
            coverSubtitle: this.px(f.coverSubtitle),
            title: this.px(f.title),
            subtitle: this.px(f.subtitle),
            body: this.px(f.body),
            bodySmall: this.px(f.bodySmall),
            caption: this.px(f.caption),
            small: this.px(f.small),
            stat: this.px(f.stat),
        };
    }

    renderAll(slides) {
        return slides.map((slide, i) => this.render(slide, i)).join('');
    }

    render(slide, index = 0) {
        // 统一使用 freeform 渲染
        return this.renderFreeform(slide, index);
    }

    // ═══════════════════════════════════════════════════════════════
    // Freeform 自由布局渲染
    // ═══════════════════════════════════════════════════════════════

    renderFreeform(slide, index) {
        // 防御性检查：slide 未定义时返回空白占位
        if (!slide) {
            return `<div style="position:relative;width:100%;height:100%;background:#f5f5f5;display:flex;align-items:center;justify-content:center;color:#999;">幻灯片数据加载中...</div>`;
        }

        const { htmlWidth, htmlHeight } = this.styles.dimensions;

        // 背景样式（提供默认值）
        let bgStyle = `background: ${slide.background || '#ffffff'};`;
        if (slide.backgroundGradient) {
            bgStyle = `background: ${slide.backgroundGradient};`;
        }
        if (slide.backgroundImage) {
            bgStyle = `background: url('${slide.backgroundImage}') center/cover;`;
        }

        // 渲染所有元素（稳定排序：z 相同时保持原始顺序）
        const elements = (slide.elements || [])
            .map((el, i) => ({ ...el, _originalIndex: i }))
            .sort((a, b) => (a.z || 0) - (b.z || 0) || a._originalIndex - b._originalIndex)
            .map(el => this.renderFreeformElement(el, htmlWidth, htmlHeight))
            .join('');

        return `
            <div style="position: relative; width: 100%; height: 100%; ${bgStyle} overflow: hidden; box-sizing: border-box; font-family: ${this.fontFamily};">
                ${elements}
            </div>
        `;
    }

    /**
     * 解析坐标值，支持 %, px, in
     */
    parseCoord(value, total) {
        if (typeof value === 'number') return value;
        const str = String(value).trim();
        if (str.endsWith('%')) {
            return (parseFloat(str) / 100) * total;
        } else if (str.endsWith('in')) {
            return parseFloat(str) * this.styles.dimensions.pxPerInch * this.scale;
        } else if (str.endsWith('px')) {
            return parseFloat(str) * this.scale;
        } else if (str === 'auto') {
            return 'auto';
        }
        return parseFloat(str) || 0;
    }

    /**
     * 格式化 CSS 值，保留原始单位（百分比/px/auto）
     * 避免转换为像素导致的精度损失
     */
    formatCSSValue(value) {
        if (value === 'auto' || value === undefined || value === null) return 'auto';
        const str = String(value).trim();
        // 已有单位（%, px, in, em, rem 等），直接返回
        if (/(%|px|in|em|rem|vh|vw)$/.test(str)) {
            return str;
        }
        // 纯数字，默认当作像素
        const num = parseFloat(str);
        if (isNaN(num)) return 'auto';
        return num + 'px';
    }

    /**
     * 渲染单个自由元素
     * 优化：直接使用百分比值，让浏览器计算精确位置，避免转换精度损失
     */
    renderFreeformElement(el, containerW, containerH) {
        // 隐藏的元素不渲染
        if (el.hidden) return '';
        
        // 直接使用原始值（百分比/px/auto），不转换
        const x = this.formatCSSValue(el.x);
        const y = this.formatCSSValue(el.y);
        let w = this.formatCSSValue(el.w);
        let h = this.formatCSSValue(el.h);

        // 圆形特殊处理：如果高度为 auto，使用宽度的像素值保持正圆
        // 注意：不能直接用 h = w，因为百分比是相对于不同的基准（宽度 vs 高度）
        if (el.type === 'shape' && el.shape === 'circle' && h === 'auto') {
            // 将宽度转换为像素值，然后用于高度
            const wPx = this.parseCoord(el.w, containerW);
            h = wPx + 'px';
        }

        // 对于公式元素，如果没有指定宽度，根据 x 位置计算合适的宽度以支持居中对齐
        if (el.type === 'formula' && w === 'auto') {
            // 解析 x 值，计算剩余宽度
            const xStr = String(el.x || '0%').trim();
            if (xStr.endsWith('%')) {
                const xPercent = parseFloat(xStr) || 0;
                // 宽度 = 100% - x位置，确保不会超出右边界
                w = `${Math.max(100 - xPercent, 10)}%`;
            } else {
                // 非百分比情况，使用固定宽度
                w = '80%';
            }
        }

        // 构建基础样式
        let baseStyle;
        if (el.rawStyle) {
            // rawStyle 模式：AI 直接写的 CSS，补充定位和效果属性
            const positionStyle = `position: absolute; left: ${x}; top: ${y}; z-index: ${el.z || 0};`;
            // 效果属性追加到末尾（CSS 后写优先）
            let effectStyle = '';
            if (el.blend && el.blend !== 'normal') effectStyle += ` mix-blend-mode: ${el.blend};`;
            if (el.filter) effectStyle += ` filter: ${el.filter};`;
            if (el.mask) effectStyle += ' ' + this._buildMaskStyle(el.mask).replace(/\s+/g, ' ').trim();
            baseStyle = `${positionStyle} ${el.rawStyle}${effectStyle}`;
        } else {
            // 兼容模式：从 data-* 属性构建样式
            const effectStyle = `
                ${el.blend && el.blend !== 'normal' ? `mix-blend-mode: ${el.blend};` : ''}
                ${el.filter ? `filter: ${el.filter};` : ''}
                ${el.mask ? this._buildMaskStyle(el.mask) : ''}
                ${el.outline ? `outline: 2px solid ${el.outline}; outline-offset: 2px;` : ''}
                ${el.effect ? this._buildEffectStyle(el.effect) : ''}
            `;
            baseStyle = `
                position: absolute;
                left: ${x};
                top: ${y};
                ${w !== 'auto' ? `width: ${w};` : ''}
                ${h !== 'auto' ? `height: ${h};` : ''}
                ${el.rotate ? `transform: rotate(${el.rotate}deg);` : ''}
                ${(el.opacity !== undefined && el.opacity !== null && !isNaN(el.opacity) && el.opacity !== 1) ? `opacity: ${el.opacity};` : ''}
                z-index: ${el.z || 0};
                ${effectStyle}
            `.replace(/\s+/g, ' ').trim();
        }

        let html = '';
        switch (el.type) {
            case 'text':
                html = this.renderFreeformText(el, baseStyle); break;
            case 'shape':
                html = this.renderFreeformShape(el, baseStyle); break;
            case 'image':
                html = this.renderFreeformImage(el, baseStyle); break;
            case 'icon':
                html = this.renderFreeformIcon(el, baseStyle); break;
            case 'line':
                html = this.renderFreeformLine(el, containerW, containerH); break;
            case 'chart':
                html = this.renderFreeformChart(el, baseStyle); break;
            case 'formula':
                html = this.renderFreeformFormula(el, baseStyle); break;
            case 'group':
                html = this.renderFreeformGroup(el, baseStyle, containerW, containerH); break;
            case 'card':
                html = this.renderFreeformCard(el, baseStyle); break;
            case 'svg':
                html = this.renderFreeformSvg(el, baseStyle); break;
            case 'table':
                html = this.renderFreeformTable(el, baseStyle); break;
            case 'list':
                html = this.renderFreeformList(el, baseStyle); break;
            default:
                return '';
        }
        // 自动注入 data-element-id（在第一个 > 之前插入）
        if (html && el.id) {
            html = html.replace(/^<(\w+)/, `<$1 data-element-id="${escapeAttr(el.id)}"`);
        }
        return html;
    }

    renderFreeformText(el, baseStyle) {
        // 垂直对齐使用 flexbox，但文字本身不用 flex 布局
        const needsVerticalAlign = el.valign && el.valign !== 'top';

        // 优先使用 fontSize，兼容旧的 font 属性
        const fontSizeVal = el.fontSize || el.font;
        
        // 构建文字装饰
        const textDecorations = [];
        if (el.underline) textDecorations.push('underline');
        if (el.strike) textDecorations.push('line-through');
        const textDecorationStyle = textDecorations.length > 0 
            ? `text-decoration: ${textDecorations.join(' ')};` 
            : '';
        
        // 上标/下标
        const verticalAlign = el.superscript ? 'vertical-align: super; font-size: 0.75em;' 
                            : el.subscript ? 'vertical-align: sub; font-size: 0.75em;' 
                            : '';
        
        const textStyle = `
            ${baseStyle}
            font-size: ${this.px(fontSizeVal)}px;
            color: ${el.color};
            ${el.bold ? 'font-weight: 700;' : ''}
            ${el.italic ? 'font-style: italic;' : ''}
            ${textDecorationStyle}
            ${el.fontFamily ? `font-family: ${el.fontFamily};` : ''}
            ${el.letterSpacing ? `letter-spacing: ${this.formatCSSValue(el.letterSpacing)};` : ''}
            ${verticalAlign}
            text-align: ${el.align || 'left'};
            line-height: ${el.lineHeight || 1.4};
            ${el.bgColor ? `background: ${el.bgColor}; padding: 8px; border-radius: ${el.bgRadius || 0}px;` : ''}
            overflow-wrap: break-word;
            word-break: break-word;
            hyphens: auto;
        `.replace(/\s+/g, ' ').trim();

        // 如果需要垂直对齐，使用嵌套容器避免 flex 影响 <br> 的行为
        if (needsVerticalAlign) {
            const wrapperStyle = `
                ${baseStyle}
                display: flex;
                flex-direction: column;
                justify-content: ${el.valign === 'middle' ? 'center' : 'flex-end'};
            `.replace(/\s+/g, ' ').trim();
            const innerStyle = `font-size: ${this.px(fontSizeVal)}px; color: ${el.color}; ${el.bold ? 'font-weight: 700;' : ''} ${el.italic ? 'font-style: italic;' : ''} ${textDecorationStyle} ${el.fontFamily ? `font-family: ${el.fontFamily};` : ''} ${el.letterSpacing ? `letter-spacing: ${this.formatCSSValue(el.letterSpacing)};` : ''} text-align: ${el.align || 'left'}; line-height: ${el.lineHeight || 1.4};`;
            return `<div style="${wrapperStyle}"><div contenteditable="true" style="${innerStyle}">${this._processRichText(el.content)}</div></div>`;
        }

        return `<div contenteditable="true" style="${textStyle}">${this._processRichText(el.content)}</div>`;
    }

    renderFreeformShape(el, baseStyle) {
        let shapeStyle = baseStyle;

        // 形状类型
        if (el.shape === 'circle') {
            shapeStyle += ' border-radius: 50%;';
        } else if (el.shape === 'rounded' || el.radius) {
            shapeStyle += ` border-radius: ${el.radius || 12}px;`;
        }

        // 填充
        if (el.gradient) {
            shapeStyle += ` background: ${el.gradient};`;
        } else {
            shapeStyle += ` background: ${el.fill};`;
        }

        // 边框
        if (el.stroke) {
            shapeStyle += ` border: ${el.strokeWidth || 1}px solid ${el.stroke};`;
        }

        // 阴影
        if (el.shadow) {
            shapeStyle += ' box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
        }

        return `<div style="${shapeStyle}"></div>`;
    }

    renderFreeformImage(el, baseStyle) {
        // 重要：filter 会创建新的堆叠上下文，阻止 mix-blend-mode 与外部元素混合
        // 解决方案：外层 div 只处理定位/尺寸/blend/opacity，内层 img 处理 filter
        // 这样 blend 可以正确与页面其他元素混合，filter 只影响图片本身

        // 从 baseStyle 中移除 filter，让它只应用在 img 上
        // baseStyle 已经包含了 position, left, top, width, height, z-index, blend, opacity
        let containerStyle = baseStyle;

        // 如果 baseStyle 中包含 filter，需要移除它（filter 应该只在 img 上）
        // 通过正则移除 filter 属性
        containerStyle = containerStyle.replace(/filter:\s*[^;]+;?/gi, '');

        if (el.radius) {
            containerStyle += ` border-radius: ${el.radius}px; overflow: hidden;`;
        }
        if (el.border) {
            containerStyle += ` border: ${el.border};`;
        }

        const fitStyle = el.fit === 'contain' ? 'object-fit: contain;' :
                         el.fit === 'fill' ? 'object-fit: fill;' :
                         'object-fit: cover;';

        // 内层 img 样式：只应用 filter，不应用 blend（blend 在外层容器上生效）
        let innerImgStyle = `width: 100%; height: 100%; ${fitStyle}`;
        if (el.filter) {
            innerImgStyle += ` filter: ${el.filter};`;
        }

        // 检查裁剪参数（非破坏性）
        const crop = el.editParams?.crop;
        if (crop) {
            if (
                (crop.x !== 0 && crop.x !== undefined) ||
                (crop.y !== 0 && crop.y !== undefined) ||
                (crop.w !== 1 && crop.w !== undefined) ||
                (crop.h !== 1 && crop.h !== undefined)
            ) {
                const x = crop.x || 0;
                const y = crop.y || 0;
                const w = crop.w ?? 1;
                const h = crop.h ?? 1;

                const top = y * 100;
                const right = (1 - x - w) * 100;
                const bottom = (1 - y - h) * 100;
                const left = x * 100;

                innerImgStyle += ` clip-path: inset(${top}% ${right}% ${bottom}% ${left}%);`;
            }

            if (crop.rotation) {
                innerImgStyle += ` transform: rotate(${crop.rotation}deg);`;
            }
        }

        if (el.src) {
            return `<div style="${containerStyle}"><img src="${escapeAttr(el.src)}" alt="${escapeAttr(el.alt || '')}" style="${innerImgStyle}"></div>`;
        } else {
            // 占位符
            return `
                <div style="${containerStyle} background: linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%); display: flex; align-items: center; justify-content: center; color: #4f46e5;">
                    <iconify-icon icon="carbon:image" style="font-size: 32px; opacity: 0.5; margin-right: 8px;"></iconify-icon>
                    ${el.alt}
                </div>
            `;
        }
    }

    renderFreeformIcon(el, baseStyle) {
        const iconStyle = `
            ${baseStyle}
            font-size: ${this.px(el.size)}px;
            color: ${el.color};
            display: flex;
            align-items: center;
            justify-content: center;
        `.replace(/\s+/g, ' ').trim();

        return `<div style="${iconStyle}"><iconify-icon icon="${escapeAttr(el.icon)}"></iconify-icon></div>`;
    }

    renderFreeformLine(el, containerW, containerH) {
        // SVG 支持百分比坐标，直接使用原始值
        const x1 = this.formatSVGCoord(el.x1);
        const y1 = this.formatSVGCoord(el.y1);
        const x2 = this.formatSVGCoord(el.x2);
        const y2 = this.formatSVGCoord(el.y2);

        const dashStyle = el.dash ? `stroke-dasharray: ${el.dash};` : '';

        return `
            <svg style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none; z-index: ${el.z || 0};">
                <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
                      stroke="${el.stroke}" stroke-width="${el.strokeWidth}"
                      style="${dashStyle}" />
            </svg>
        `;
    }

    /**
     * 格式化 SVG 坐标值，保留百分比
     */
    formatSVGCoord(value) {
        if (value === undefined || value === null) return '0';
        const str = String(value).trim();
        // 百分比直接返回
        if (str.endsWith('%')) {
            return str;
        }
        // 已有 px 单位，转为纯数字
        if (str.endsWith('px')) {
            return parseFloat(str) || 0;
        }
        // 纯数字
        return parseFloat(str) || 0;
    }

    renderFreeformGroup(el, baseStyle, containerW, containerH) {
        // 计算 group 的实际宽高（供子元素百分比计算使用）
        const groupW = this.parseCoord(el.w, containerW);
        const groupH = this.parseCoord(el.h, containerH);
        
        // 子元素的百分比坐标相对于 group 容器
        // 子元素使用 data-child-of 而不是 data-element-id，确保点击时选中 group 而非子元素
        const children = (el.children || [])
            .map(child => {
                let childHtml = this.renderFreeformElement(child, groupW, groupH);
                // 将子元素的 data-element-id 替换为 data-child-of
                if (childHtml && child.id) {
                    childHtml = childHtml.replace(
                        `data-element-id="${child.id}"`,
                        `data-child-of="${el.id}" data-child-id="${child.id}"`
                    );
                }
                return childHtml;
            })
            .join('');

        // group 容器本身是 absolute 定位，内部子元素的 absolute 会相对于它
        return `<div style="${baseStyle}">${children}</div>`;
    }

    /**
     * 渲染卡片组件 - 自动布局图标+标题+描述
     * 支持三种布局：horizontal(水平), vertical(垂直), icon-right(图标在右)
     * 如果有 content 属性，直接使用该 HTML（支持编辑后保存）
     */
    renderFreeformCard(el, baseStyle) {
        const layout = el.layout || 'horizontal';
        const padding = el.padding || 16;
        const radius = el.radius || 12;

        // 容器样式
        let containerStyle = `
            ${baseStyle}
            background: ${el.fill || '#ffffff'};
            border-radius: ${radius}px;
            padding: ${padding}px;
            box-sizing: border-box;
            ${el.shadow ? 'box-shadow: 0 4px 12px rgba(0,0,0,0.1);' : ''}
            ${el.stroke ? `border: ${el.strokeWidth || 1}px solid ${el.stroke};` : ''}
        `.replace(/\s+/g, ' ').trim();
        
        // 图标部分
        const iconSize = el.iconSize || 24;
        const iconBgSize = iconSize + 12; // 图标背景比图标大一些
        let iconHtml = '';
        if (el.icon) {
            const iconBgStyle = el.iconBg
                ? `background: ${el.iconBg}; width: ${iconBgSize}px; height: ${iconBgSize}px; border-radius: ${iconBgSize / 3}px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;`
                : `width: ${iconSize}px; height: ${iconSize}px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;`;
            iconHtml = `
                <div style="${iconBgStyle}">
                    <iconify-icon icon="${el.icon}" style="font-size: ${iconSize}px; color: ${el.iconColor || '#4f46e5'};"></iconify-icon>
                </div>
            `;
        }

        // 文字部分
        const titleHtml = el.title
            ? `<div style="font-size: ${el.titleSize || 16}px; color: ${el.titleColor || '#1f2937'}; ${el.titleBold !== false ? 'font-weight: 600;' : ''} line-height: 1.3; margin-bottom: ${el.subtitle ? '4px' : '0'};">${el.title}</div>`
            : '';
        const subtitleHtml = el.subtitle
            ? `<div style="font-size: ${el.subtitleSize || 13}px; color: ${el.subtitleColor || '#6b7280'}; line-height: 1.4;">${el.subtitle}</div>`
            : '';
        const textHtml = `<div style="flex: 1; min-width: 0;">${titleHtml}${subtitleHtml}</div>`;

        // 根据布局组织内容
        let innerStyle = '';
        let content = '';
        switch (layout) {
            case 'vertical':
                innerStyle = 'display: flex; flex-direction: column; align-items: center; text-align: center; height: 100%; justify-content: center; gap: 12px;';
                content = `${iconHtml}${textHtml}`;
                break;
            case 'icon-right':
                innerStyle = 'display: flex; flex-direction: row; align-items: center; height: 100%; gap: 12px;';
                content = `${textHtml}${iconHtml}`;
                break;
            case 'horizontal':
            default:
                innerStyle = 'display: flex; flex-direction: row; align-items: center; height: 100%; gap: 12px;';
                content = `${iconHtml}${textHtml}`;
                break;
        }

        return `<div style="${containerStyle}"><div style="${innerStyle}">${content}</div></div>`;
    }

    /**
     * 渲染数学公式 - 使用 KaTeX
     * 注意：公式居中需要确保容器有宽度，且使用 flex 对齐
     */
    renderFreeformFormula(el, baseStyle) {
        // 确定对齐方式，默认居中
        const align = el.align || 'center';
        let justifyContent = 'center';
        if (align === 'left') {
            justifyContent = 'flex-start';
        } else if (align === 'right') {
            justifyContent = 'flex-end';
        }

        // 容器样式 - 使用 flex 布局实现居中
        // 支持 fontSize 和 font 两种属性名
        const fontSize = el.fontSize || el.font || 18;
        const formulaStyle = `
            ${baseStyle}
            display: flex;
            align-items: center;
            justify-content: ${justifyContent};
            color: ${el.color || '#333333'};
            font-size: ${fontSize}px;
            overflow: visible;
        `.replace(/\s+/g, ' ').trim();

        // 尝试使用 KaTeX 渲染
        let formulaHtml = '';
        const latex = el.latex || '';

        if (typeof katex !== 'undefined' && latex) {
            try {
                // 使用 inline 模式渲染，避免 display 模式的额外垂直间距
                formulaHtml = katex.renderToString(latex, {
                    displayMode: false,
                    throwOnError: false,
                    output: 'html',
                });
                // 清除 KaTeX 默认的 margin，确保垂直居中
                formulaHtml = `<span class="formula-wrapper" style="display: inline-block; line-height: 1; margin: 0; padding: 0;">${formulaHtml}</span>`;
            } catch (e) {
                console.warn('[HTMLRenderer] KaTeX render error:', e);
                formulaHtml = `<code style="font-family: 'Times New Roman', serif; font-style: italic;">${latex}</code>`;
            }
        } else {
            formulaHtml = `<code style="font-family: 'Times New Roman', serif; font-style: italic;">${latex}</code>`;
        }

        return `<div style="${formulaStyle}">${formulaHtml}</div>`;
    }

    /**
     * 渲染简单图表 (SVG)
     * 使用 viewBox 实现响应式缩放，图表会自动填满容器
     */
    renderFreeformChart(el, baseStyle) {
        const data = this.parseChartData(el.chartData);
        const colors = (el.colors || '').split(',').map(c => c.trim());
        const chartType = el.chartType || 'bar';
        const labels = el.labels || '';

        // 图表容器 - 使用 flex 布局让 SVG 填满可用空间
        const chartStyle = `
            ${baseStyle}
            display: flex;
            flex-direction: column;
            background: transparent;
            padding: 0;
            overflow: hidden;
        `.replace(/\s+/g, ' ').trim();

        let chartSvg = '';

        if (chartType === 'bar') {
            chartSvg = this.renderBarChart(data, colors, labels);
        } else if (chartType === 'pie' || chartType === 'doughnut') {
            chartSvg = this.renderPieChart(data, colors, chartType === 'doughnut');
        } else if (chartType === 'line') {
            chartSvg = this.renderLineChart(data, colors, labels);
        }

        const titleHtml = el.title ? `<div style="font-size: 14px; font-weight: 600; color: #1e293b; margin-bottom: 8px;">${el.title}</div>` : '';

        return `<div style="${chartStyle}">${titleHtml}${chartSvg}</div>`;
    }

    parseChartData(dataInput) {
        if (!dataInput) return [];
        
        // 如果是新格式的对象 (来自 PPTX 解析)
        if (typeof dataInput === 'object' && dataInput.categories && dataInput.series) {
            // 将 PPTX 格式转换为渲染器格式
            const categories = dataInput.categories || [];
            const series = dataInput.series || [];
            
            // 使用第一个系列的数据
            if (series.length > 0 && series[0].values) {
                return categories.map((cat, i) => ({
                    label: cat,
                    value: series[0].values[i] || 0
                }));
            }
            return [];
        }
        
        // 旧格式的字符串 "label1:value1,label2:value2"
        if (typeof dataInput === 'string') {
            return dataInput.split(',').map(item => {
                const [label, value] = item.split(':');
                return { label: label?.trim() || '', value: parseFloat(value) || 0 };
            });
        }
        
        return [];
    }

    renderBarChart(data, colors, labels = '') {
        if (!data.length) return '<div style="color: #94a3b8;">No data</div>';

        // 使用固定的 viewBox 坐标系，SVG 会自动缩放填满容器
        const viewBoxWidth = 400;
        const viewBoxHeight = 200;
        const padding = { top: 20, right: 20, bottom: 40, left: 50 };
        const chartWidth = viewBoxWidth - padding.left - padding.right;
        const chartHeight = viewBoxHeight - padding.top - padding.bottom;

        const maxValue = Math.max(...data.map(d => d.value));
        const barWidth = Math.min(50, (chartWidth - (data.length - 1) * 10) / data.length);
        const barGap = (chartWidth - barWidth * data.length) / (data.length + 1);

        // Y轴刻度
        const yTicks = 5;
        const yTickStep = maxValue / yTicks;
        let yAxisHtml = '';
        for (let i = 0; i <= yTicks; i++) {
            const value = i * yTickStep;
            const y = padding.top + chartHeight - (i / yTicks) * chartHeight;
            yAxisHtml += `
                <line x1="${padding.left}" y1="${y}" x2="${viewBoxWidth - padding.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="4"/>
                <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6b7280">${Math.round(value)}</text>
            `;
        }

        // Y轴标签
        const yLabelHtml = labels ? `
            <text x="12" y="${viewBoxHeight / 2}" text-anchor="middle" font-size="12" fill="#6b7280" transform="rotate(-90, 12, ${viewBoxHeight / 2})">${labels}</text>
        ` : '';

        const bars = data.map((d, i) => {
            const color = colors[i % colors.length] || '#4f46e5';
            const barHeight = (d.value / maxValue) * chartHeight;
            const x = padding.left + barGap + i * (barWidth + barGap);
            const y = padding.top + chartHeight - barHeight;

            return `
                <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="4"/>
                <text x="${x + barWidth/2}" y="${y - 8}" text-anchor="middle" font-size="11" fill="#374151" font-weight="500">${d.value}</text>
                <text x="${x + barWidth/2}" y="${viewBoxHeight - 10}" text-anchor="middle" font-size="11" fill="#6b7280">${d.label}</text>
            `;
        }).join('');

        return `
            <svg viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: 100%; flex: 1;">
                <!-- Grid and Y-axis -->
                ${yAxisHtml}
                ${yLabelHtml}
                <!-- Bars -->
                ${bars}
            </svg>
        `;
    }

    renderPieChart(data, colors, isDoughnut = false) {
        if (!data.length) return '<div style="color: #94a3b8;">No data</div>';

        const total = data.reduce((sum, d) => sum + d.value, 0);
        // 使用固定的 viewBox，SVG 会自动缩放
        const viewBoxSize = 200;
        const cx = viewBoxSize / 2, cy = viewBoxSize / 2;
        const r = viewBoxSize / 2 - 10;
        const innerR = isDoughnut ? r * 0.6 : 0;

        let startAngle = -90;
        const paths = data.map((d, i) => {
            const color = colors[i % colors.length] || '#4f46e5';
            const angle = (d.value / total) * 360;
            const endAngle = startAngle + angle;

            const start = this.polarToCartesian(cx, cy, r, startAngle);
            const end = this.polarToCartesian(cx, cy, r, endAngle);
            const innerStart = this.polarToCartesian(cx, cy, innerR, startAngle);
            const innerEnd = this.polarToCartesian(cx, cy, innerR, endAngle);

            const largeArc = angle > 180 ? 1 : 0;

            const path = isDoughnut
                ? `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} L ${innerEnd.x} ${innerEnd.y} A ${innerR} ${innerR} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y} Z`
                : `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;

            startAngle = endAngle;
            return `<path d="${path}" fill="${color}"/>`;
        }).join('');

        return `<svg viewBox="0 0 ${viewBoxSize} ${viewBoxSize}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: 100%; max-width: 300px; flex: 1;">${paths}</svg>`;
    }

    polarToCartesian(cx, cy, r, angleDeg) {
        const angleRad = (angleDeg * Math.PI) / 180;
        return {
            x: cx + r * Math.cos(angleRad),
            y: cy + r * Math.sin(angleRad)
        };
    }

    renderLineChart(data, colors, labels = '') {
        if (!data.length) return '<div style="color: #94a3b8;">No data</div>';

        // 使用固定的 viewBox 坐标系，SVG 会自动缩放填满容器
        const viewBoxWidth = 400;
        const viewBoxHeight = 200;
        const padding = { top: 20, right: 30, bottom: 40, left: 50 };
        const chartWidth = viewBoxWidth - padding.left - padding.right;
        const chartHeight = viewBoxHeight - padding.top - padding.bottom;

        const maxValue = Math.max(...data.map(d => d.value));
        const minValue = 0;
        const color = colors[0] || '#6366F1';

        // 计算数据点坐标
        const points = data.map((d, i) => {
            const x = padding.left + (i / (data.length - 1 || 1)) * chartWidth;
            const y = padding.top + chartHeight - ((d.value - minValue) / (maxValue - minValue || 1)) * chartHeight;
            return { x, y, value: d.value, label: d.label };
        });

        // 生成折线路径
        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

        // 生成填充区域路径（带渐变）
        const areaPath = `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`;

        // Y轴刻度
        const yTicks = 5;
        const yTickStep = (maxValue - minValue) / yTicks;
        let yAxisHtml = '';
        for (let i = 0; i <= yTicks; i++) {
            const value = minValue + i * yTickStep;
            const y = padding.top + chartHeight - (i / yTicks) * chartHeight;
            yAxisHtml += `
                <line x1="${padding.left}" y1="${y}" x2="${viewBoxWidth - padding.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1" stroke-dasharray="4"/>
                <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6b7280">${Math.round(value)}</text>
            `;
        }

        // X轴标签
        let xAxisHtml = points.map((p, i) => `
            <text x="${p.x}" y="${viewBoxHeight - 10}" text-anchor="middle" font-size="11" fill="#6b7280">${p.label}</text>
        `).join('');

        // 数据点和悬停效果
        const dotsHtml = points.map((p, i) => `
            <circle cx="${p.x}" cy="${p.y}" r="5" fill="${color}" stroke="white" stroke-width="2"/>
            <text x="${p.x}" y="${p.y - 12}" text-anchor="middle" font-size="11" fill="#374151" font-weight="500">${p.value}</text>
        `).join('');

        // Y轴标签
        const yLabelHtml = labels ? `
            <text x="12" y="${viewBoxHeight / 2}" text-anchor="middle" font-size="12" fill="#6b7280" transform="rotate(-90, 12, ${viewBoxHeight / 2})">${labels}</text>
        ` : '';

        return `
            <svg viewBox="0 0 ${viewBoxWidth} ${viewBoxHeight}" preserveAspectRatio="xMidYMid meet" style="width: 100%; height: 100%; flex: 1;">
                <defs>
                    <linearGradient id="lineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" style="stop-color:${color};stop-opacity:0.3"/>
                        <stop offset="100%" style="stop-color:${color};stop-opacity:0.05"/>
                    </linearGradient>
                </defs>
                <!-- Grid and Y-axis -->
                ${yAxisHtml}
                ${yLabelHtml}
                <!-- Area fill -->
                <path d="${areaPath}" fill="url(#lineGradient)"/>
                <!-- Line -->
                <path d="${linePath}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                <!-- X-axis labels -->
                ${xAxisHtml}
                <!-- Data points -->
                ${dotsHtml}
            </svg>
        `;
        }

    /**
     * 渲染内联 SVG - AI 可以画复杂图形、流程图、示意图等
     */
    renderFreeformSvg(el, baseStyle) {
        // 如果有 preview 栅格图，使用双层结构：栅格图在下，SVG 在上
        const hasPreview = el.preview && el.preview.startsWith('data:');

        let containerStyle = `
            ${baseStyle}
            ${el.bgColor ? `background: ${el.bgColor};` : ''}
            ${el.radius ? `border-radius: ${el.radius}px; overflow: hidden;` : ''}
            ${hasPreview ? `background-image: url("${el.preview}"); background-size: contain; background-repeat: no-repeat; background-position: center;` : ''}
        `.replace(/\s+/g, ' ').trim();

        // SVG 内容可能包含完整的 <svg> 标签，或者只是内部元素
        let svgContent = el.content || '';

        // 如果不是以 <svg 开头，包装一个 svg 标签
        if (!svgContent.trim().toLowerCase().startsWith('<svg')) {
            svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="${el.preserveAspectRatio || 'xMidYMid meet'}">${svgContent}</svg>`;
        } else {
            // 确保 SVG 有正确的尺寸属性
            svgContent = svgContent.replace(/<svg([^>]*)>/, (match, attrs) => {
                if (!attrs.includes('width=')) attrs += ' width="100%"';
                if (!attrs.includes('height=')) attrs += ' height="100%"';
                if (!attrs.includes('preserveAspectRatio=')) attrs += ` preserveAspectRatio="${el.preserveAspectRatio || 'xMidYMid meet'}"`;
                return `<svg${attrs}>`;
            });
        }

        return `<div style="${containerStyle}">${svgContent}</div>`;
    }

    /**
     * 渲染表格 - 使用 HTML 原生表格
     * 自动缩放以适应容器
     * 如果有 content 属性（编辑后保存的），直接使用
     */
    renderFreeformTable(el, baseStyle) {
        const radius = el.radius || 12;
        
        // 容器样式 - 添加阴影和圆角
        const containerStyle = `
            ${baseStyle}
            overflow: hidden;
            border-radius: ${radius}px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
            border: 1px solid ${el.borderColor || '#e2e8f0'};
        `.replace(/\s+/g, ' ').trim();
        
        // 如果有 content 属性（编辑后保存的 HTML），直接使用
        if (el.content) {
            return `<div style="${containerStyle}">${el.content}</div>`;
        }
        
        const data = el.data || [];
        if (data.length === 0) {
            return `<div style="${containerStyle}; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 14px;">空表格</div>`;
        }

        const fontSize = el.fontSize || 11;
        const headerFontSize = el.headerFontSize || 13;
        
        // 表格样式 - 100% 宽高，自动适应容器
        const tableStyle = `
            width: 100%;
            height: 100%;
            border-collapse: collapse;
            font-family: system-ui, -apple-system, sans-serif;
            table-layout: fixed;
        `.replace(/\s+/g, ' ').trim();

        // 检测模块分组（第一列相同值）用于视觉区分
        const moduleGroups = {};
        let currentModule = '';
        let groupIndex = 0;
        data.forEach((row, idx) => {
            if (idx === 0) return; // 跳过表头
            const module = row[0] || '';
            if (module !== currentModule) {
                currentModule = module;
                groupIndex++;
            }
            moduleGroups[idx] = groupIndex;
        });

        // 构建表格 HTML
        let tableHtml = `<table style="${tableStyle}">`;
        
        data.forEach((row, rowIndex) => {
            const isHeader = rowIndex === 0;
            const groupIdx = moduleGroups[rowIndex] || 0;
            const isOddGroup = groupIdx % 2 === 1;
            
            // 模块分组交替色
            let bgColor;
            if (isHeader) {
                bgColor = el.headerBg || '#0ea5e9';
            } else {
                bgColor = isOddGroup ? (el.rowBg || '#ffffff') : (el.altRowBg || '#f8fafc');
            }
            
            const textColor = isHeader ? el.headerColor : el.cellColor;
            const fontWeight = isHeader ? '600' : '400';
            const currentFontSize = isHeader ? headerFontSize : fontSize;
            
            tableHtml += `<tr style="background: ${bgColor};">`;
            
            (row || []).forEach((cell, colIndex) => {
                // 第一列（模块）加粗并使用主题色
                const isModuleCol = colIndex === 0 && !isHeader;
                const cellFontWeight = isHeader ? '600' : (isModuleCol ? '500' : '400');
                const cellColor = isHeader ? el.headerColor : (isModuleCol ? '#0369a1' : el.cellColor);
                
                const cellStyle = `
                    padding: 6px 10px;
                    color: ${cellColor};
                    font-weight: ${cellFontWeight};
                    font-size: ${currentFontSize}px;
                    text-align: ${colIndex === 0 ? 'center' : (colIndex === row.length - 1 ? 'left' : 'center')};
                    overflow: hidden;
                    text-overflow: ellipsis;
                    line-height: 1.35;
                    border-right: ${colIndex < row.length - 1 ? `1px solid ${el.borderColor || '#e2e8f0'}` : 'none'};
                    border-bottom: ${rowIndex < data.length - 1 ? `1px solid ${el.borderColor || '#e2e8f0'}` : 'none'};
                    vertical-align: middle;
                `.replace(/\s+/g, ' ').trim();
                
                tableHtml += `<td style="${cellStyle}">${this._escapeHtml(String(cell || ''))}</td>`;
            });
            
            tableHtml += '</tr>';
        });
        
        tableHtml += '</table>';

        return `<div style="${containerStyle}">${tableHtml}</div>`;
    }

    /**
     * 渲染列表元素 - 有序或无序列表
     */
    renderFreeformList(el, baseStyle) {
        const items = el.items || [];
        if (items.length === 0) {
            return `<div style="${baseStyle}; color: #94a3b8; font-size: 14px;">空列表</div>`;
        }

        const fontSize = el.font || 16;
        const color = el.color || '#333333';
        const bulletColor = el.bulletColor || color;
        const lineHeight = el.lineHeight || 1.6;
        const indent = el.indent || 24;
        const isOrdered = el.listType === 'ol';

        const containerStyle = `
            ${baseStyle}
            font-size: ${this.px(fontSize)}px;
            color: ${color};
            line-height: ${lineHeight};
            padding-left: ${indent}px;
        `.replace(/\s+/g, ' ').trim();

        const listItems = items.map((item, i) => {
            const marker = isOrdered 
                ? `<span style="color: ${bulletColor}; font-weight: 600; margin-right: 8px;">${i + 1}.</span>`
                : `<span style="color: ${bulletColor}; margin-right: 8px;">•</span>`;
            return `<div style="display: flex; align-items: baseline; margin-bottom: 4px;">${marker}<span>${this._escapeHtml(item)}</span></div>`;
        }).join('');

        return `<div style="${containerStyle}">${listItems}</div>`;
    }

    /**
     * HTML 转义
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 根据 mask 值构建 CSS mask 片段
     * 支持格式：
     * - #id：引用同页 SVG 元素作为 mask
     * - url(...) 或 data:...：图片作为 mask
     * - circle / circle(50%) / circle(50% at center)：圆形遮罩
     * - ellipse / ellipse(50% 30%)：椭圆遮罩
     * - polygon(...)：多边形遮罩
     * - inset(10%)：内边距矩形遮罩
     * - linear-gradient(...) / radial-gradient(...)：渐变遮罩
     * - fade-left / fade-right / fade-top / fade-bottom：预设渐变方向
     * - fade-center / spotlight：预设径向渐变
     */
    _buildMaskStyle(mask) {
        if (!mask) return '';
        const val = String(mask).trim();
        
        // 1. 引用同页元素 id
        if (val.startsWith('#')) {
            const id = val.slice(1);
            return `
                mask-image: url(#${id});
                -webkit-mask-image: url(#${id});
                mask-size: contain;
                -webkit-mask-size: contain;
                mask-repeat: no-repeat;
                -webkit-mask-repeat: no-repeat;
                mask-position: center;
                -webkit-mask-position: center;
                clip-path: url(#${id});
            `;
        }
        
        // 2. 预设渐变遮罩（快捷方式）- 更强烈的效果
        const presets = {
            'fade-left': 'linear-gradient(to right, transparent 0%, black 60%)',
            'fade-right': 'linear-gradient(to left, transparent 0%, black 60%)',
            'fade-top': 'linear-gradient(to bottom, transparent 0%, black 60%)',
            'fade-bottom': 'linear-gradient(to top, transparent 0%, black 60%)',
            'fade-center': 'radial-gradient(circle, black 0%, black 40%, transparent 70%)',
            'spotlight': 'radial-gradient(ellipse 50% 60% at center, black 0%, black 30%, transparent 70%)',
            'vignette': 'radial-gradient(ellipse at center, black 0%, black 30%, transparent 80%)',
            'fade-edges': 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
        };
        if (presets[val]) {
            return `
                mask-image: ${presets[val]};
                -webkit-mask-image: ${presets[val]};
            `;
        }
        
        // 3. 渐变遮罩
        if (val.includes('gradient(')) {
            return `
                mask-image: ${val};
                -webkit-mask-image: ${val};
            `;
        }
        
        // 4. 预定义形状遮罩（使用 clip-path）
        // circle, ellipse, polygon, inset
        if (val.startsWith('circle') || val.startsWith('ellipse') ||
            val.startsWith('polygon') || val.startsWith('inset')) {
            // 如果只写 "circle" 没有括号，默认 circle(50%)
            let clipValue = val;
            if (val === 'circle') clipValue = 'circle(50%)';
            if (val === 'ellipse') clipValue = 'ellipse(50% 40%)';
            return `clip-path: ${clipValue};`;
        }

        // 圆角遮罩 - 使用 border-radius + overflow
        if (val === 'rounded' || val.startsWith('rounded:')) {
            // 支持 "rounded" 或 "rounded:20" 格式
            const radiusMatch = val.match(/rounded:(\d+)/);
            const radius = radiusMatch ? radiusMatch[1] : '12';
            return `border-radius: ${radius}px; overflow: hidden;`;
        }
        
        // 5. 直接 url 或 base64 图片
        if (val.startsWith('url(') || val.startsWith('data:')) {
            return `
                mask-image: ${val.startsWith('url(') ? val : `url(${val})`};
                -webkit-mask-image: ${val.startsWith('url(') ? val : `url(${val})`};
                mask-size: cover;
                -webkit-mask-size: cover;
                mask-repeat: no-repeat;
                -webkit-mask-repeat: no-repeat;
                mask-position: center;
                -webkit-mask-position: center;
            `;
        }
        
        // 未知格式，不生成 mask
        return '';
    }

    /**
     * 处理富文本内容中的上标/下标标签
     */
    _processRichText(content) {
        if (!content) return '';
        // 将 <span data-superscript="true">x</span> 转为带样式的 span
        let result = content.replace(
            /<span\s+data-superscript="true">([^<]*)<\/span>/gi,
            '<span style="vertical-align: super; font-size: 0.75em;">$1</span>'
        );
        // 将 <span data-subscript="true">x</span> 转为带样式的 span
        result = result.replace(
            /<span\s+data-subscript="true">([^<]*)<\/span>/gi,
            '<span style="vertical-align: sub; font-size: 0.75em;">$1</span>'
        );
        return result;
    }

    /**
     * 根据 effect 值构建 CSS 样式
     * 支持: shadow-sm, shadow-md, shadow-lg, shadow-xl, shadow-2xl, shadow
     */
    _buildEffectStyle(effect) {
        if (!effect) return '';
        const val = String(effect).trim();
        
        const shadows = {
            'shadow-sm': 'box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);',
            'shadow': 'box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);',
            'shadow-md': 'box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);',
            'shadow-lg': 'box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);',
            'shadow-xl': 'box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);',
            'shadow-2xl': 'box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);',
        };
        
        return shadows[val] || '';
    }
}

// ============================================================
// 4. PPTXSlideRenderer - 渲染到 PPTX
// 使用与 HTMLSlideRenderer 相同的 SlideStyles 配置
// ============================================================

// Global export (legacy scripts + ESM import side-effects).
try {
    if (typeof globalThis !== 'undefined') {
        globalThis.HTMLSlideRenderer = HTMLSlideRenderer;
    }
    if (typeof window !== 'undefined') {
        window.HTMLSlideRenderer = HTMLSlideRenderer;
    }
} catch {
    // ignore
}
