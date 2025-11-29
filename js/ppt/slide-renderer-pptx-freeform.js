/**
 * PPTXSlideRenderer 自由布局渲染方法
 * 包含: freeform 相关的所有渲染方法
 */

const PPTXSlideRendererFreeform = {
    // ═══════════════════════════════════════════════════════════════
    // Freeform 自由布局渲染 (PPTX)
    // ═══════════════════════════════════════════════════════════════

    renderFreeform(slide, data) {
        // 背景
        if (data.backgroundGradient) {
            const gradMatch = data.backgroundGradient.match(/linear-gradient\((\d+)deg,\s*([^,]+?)(?:\s+\d+%)?,\s*([^,)]+?)(?:\s+\d+%)?(?:,\s*([^)]+))?\)/);
            if (gradMatch) {
                const color1 = this.safeColor(gradMatch[2]) || '4f46e5';
                slide.background = { color: color1 };
            } else {
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

        // 按 z-index 排序渲染元素
        const elements = (data.elements || [])
            .map((el, i) => ({ ...el, _originalIndex: i }))
            .sort((a, b) => (a.z || 0) - (b.z || 0) || a._originalIndex - b._originalIndex);

        elements.forEach(el => {
            this.renderFreeformElementPPTX(slide, el);
        });
    },

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
    },

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
    },

    renderFreeformTextPPTX(slide, el, x, y, w, h) {
        const fontSizePx = el.font || 18;
        const fontSize = Math.round(fontSizePx * 0.72);

        let textContent = el.content || '';
        textContent = textContent
            .replace(/\r?\n/g, ' ')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/?(strong|b)>/gi, '')
            .replace(/<\/?(em|i)>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/[ \t]+/g, ' ')
            .replace(/ ?\n ?/g, '\n')
            .trim();

        const lineCount = (textContent.match(/\n/g) || []).length + 1;
        const estimatedHeight = (fontSize / 72) * lineCount * 1.5;

        const textOptions = {
            x: x || 0,
            y: y || 0,
            w: w || 2,
            h: h || Math.max(estimatedHeight, 0.4),
            fontSize: fontSize,
            fontFace: this.fontFace,
            color: this.safeColor(el.color) || '333333',
            bold: el.bold || false,
            italic: el.italic || false,
            align: el.align || 'left',
            valign: el.valign === 'middle' ? 'middle' : el.valign === 'bottom' ? 'bottom' : 'top',
        };

        if (el.rotate) {
            textOptions.rotate = el.rotate;
        }

        if (el.opacity !== undefined && el.opacity < 1) {
            textOptions.transparency = Math.round((1 - el.opacity) * 100);
        }

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
    },

    renderFreeformShapePPTX(slide, el, x, y, w, h) {
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

        if (shapeType === 'roundRect' && el.radius) {
            shapeOptions.rectRadius = el.radius / 96;
        }

        if (el.opacity !== undefined && el.opacity < 1) {
            shapeOptions.fill.transparency = Math.round((1 - el.opacity) * 100);
        }

        if (el.rotate) {
            shapeOptions.rotate = el.rotate;
        }

        try {
            slide.addShape(shapeType, shapeOptions);
        } catch (e) {
            console.warn('Failed to add shape:', e, shapeOptions);
        }
    },

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

                if (el.rotate) {
                    imgOptions.rotate = el.rotate;
                }

                if (el.radius) {
                    imgOptions.rounding = true;
                }

                slide.addImage(imgOptions);
            } catch (e) {
                this.addImagePlaceholder(slide, x, y, w, h, el.alt);
            }
        } else {
            this.addImagePlaceholder(slide, x || 0, y || 0, w || 2, h || 2, el.alt);
        }
    },

    renderFreeformIconPPTX(slide, el, x, y, w, h) {
        const iconSize = (el.size || 24) / 72;
        const color = this.safeColor(el.color) || '333333';

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

        const emoji = this.getIconEmoji(el.icon);
        this.addText(slide, emoji, {
            x: x || 0,
            y: y || 0,
            w: iconSize * 2,
            h: iconSize * 2,
            fontSize: el.size || 24,
            color: color,
            align: 'center',
            valign: 'middle',
        });
    },

    renderFreeformLinePPTX(slide, el) {
        let x1 = this.parseCoordToInch(el.x1, this.SLIDE_W) || 0;
        let y1 = this.parseCoordToInch(el.y1, this.SLIDE_H) || 0;
        let x2 = this.parseCoordToInch(el.x2, this.SLIDE_W) || this.SLIDE_W;
        let y2 = this.parseCoordToInch(el.y2, this.SLIDE_H) || y1;

        if (x2 < x1) { [x1, x2] = [x2, x1]; }
        if (y2 < y1) { [y1, y2] = [y2, y1]; }

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

        if (el.dash) {
            lineOptions.line.dashType = 'dash';
        }

        try {
            slide.addShape('line', lineOptions);
        } catch (e) {
            console.warn('Failed to add line:', e, lineOptions);
        }
    },

    renderFreeformChartPPTX(slide, el, x, y, w, h) {
        const data = this.parseChartDataPPTX(el.chartData);
        if (!data.length) return;

        const colors = (el.colors || '#4f46e5,#10b981,#f59e0b,#ec4899,#6366f1')
            .split(',')
            .map(c => this.safeColor(c.trim()) || '4f46e5');

        const chartType = el.chartType || 'bar';

        const chartTypeMap = {
            'bar': 'bar',
            'line': 'line',
            'pie': 'pie',
            'doughnut': 'doughnut',
        };

        const pptxChartType = chartTypeMap[chartType] || 'bar';

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
            slide.addShape('roundRect', {
                x: x || 0.5,
                y: y || 0.5,
                w: w || 4,
                h: h || 3,
                fill: { color: 'F8FAFC' },
                line: { color: 'E2E8F0', width: 1 },
            });
            this.addText(slide, `📊 ${el.title || 'Chart'}`, {
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
    },

    parseChartDataPPTX(dataStr) {
        if (!dataStr) return [];
        return dataStr.split(',').map(item => {
            const parts = item.split(':');
            return {
                label: parts[0]?.trim() || '',
                value: parseFloat(parts[1]) || 0
            };
        });
    },

    renderFreeformFormulaPPTX(slide, el, x, y, w, h) {
        const fontSizePx = el.font || 24;
        const color = el.color || '#333333';
        const fontSize = Math.round(fontSizePx * 0.72);

        let displayText;
        
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
    },

    renderFreeformCardPPTX(slide, el, x, y, w, h) {
        const layout = el.layout || 'horizontal';
        const padding = (el.padding || 16) / this.styles.dimensions.pxPerInch;
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

        const innerX = x + padding;
        const innerY = y + padding;
        const innerW = w - padding * 2;
        const innerH = h - padding * 2;

        const iconSize = (el.iconSize || 24) / this.styles.dimensions.pxPerInch;
        const iconBgSize = iconSize * 1.5;
        const gap = 0.12;

        const titleSize = Math.round((el.titleSize || 16) * 0.72);
        const subtitleSize = Math.round((el.subtitleSize || 13) * 0.72);

        if (layout === 'vertical') {
            this._renderVerticalCard(slide, el, innerX, innerY, innerW, innerH, iconSize, iconBgSize, gap, titleSize, subtitleSize);
        } else {
            this._renderHorizontalCard(slide, el, layout, innerX, innerY, innerW, innerH, iconSize, iconBgSize, gap, titleSize, subtitleSize);
        }
    },

    _renderVerticalCard(slide, el, innerX, innerY, innerW, innerH, iconSize, iconBgSize, gap, titleSize, subtitleSize) {
        const titleLineH = titleSize / 72 * 1.3;
        const subtitleLineH = subtitleSize / 72 * 1.3;
        const textGap = 0.05;
        const contentH = iconBgSize + gap + titleLineH + (el.subtitle ? textGap + subtitleLineH : 0);
        const startY = innerY + (innerH - contentH) / 2;

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

        if (el.icon) {
            const iconColor = this.safeColor(el.iconColor) || '4f46e5';
            const iconKey = `${el.icon}_${iconColor}`;
            const iconX = innerX + (innerW - iconSize) / 2;
            
            if (this.iconCache && this.iconCache[iconKey]) {
                slide.addImage({
                    data: this.iconCache[iconKey],
                    x: iconX,
                    y: startY + (iconBgSize - iconSize) / 2,
                    w: iconSize,
                    h: iconSize,
                });
            } else {
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
    },

    _renderHorizontalCard(slide, el, layout, innerX, innerY, innerW, innerH, iconSize, iconBgSize, gap, titleSize, subtitleSize) {
        const isIconRight = layout === 'icon-right';
        const iconAreaW = el.icon ? iconBgSize + gap : 0;
        const textAreaW = innerW - iconAreaW;
        const textX = isIconRight ? innerX : innerX + iconAreaW;
        const iconX = isIconRight ? innerX + textAreaW + gap : innerX;

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

        if (el.icon) {
            const iconColor = this.safeColor(el.iconColor) || '4f46e5';
            const iconKey = `${el.icon}_${iconColor}`;
            const iconImgX = iconX + (iconBgSize - iconSize) / 2;
            const iconImgY = innerY + (innerH - iconSize) / 2;
            
            if (this.iconCache && this.iconCache[iconKey]) {
                slide.addImage({
                    data: this.iconCache[iconKey],
                    x: iconImgX,
                    y: iconImgY,
                    w: iconSize,
                    h: iconSize,
                });
            } else {
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

        const hasSubtitle = !!el.subtitle;
        const titleLineH = titleSize / 72 * 1.3;
        const subtitleLineH = subtitleSize / 72 * 1.3;
        const textGap = hasSubtitle ? 0.05 : 0;
        const totalTextH = titleLineH + (hasSubtitle ? textGap + subtitleLineH : 0);
        const textStartY = innerY + (innerH - totalTextH) / 2;

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
    },

    renderFreeformSvgPPTX(slide, el, x, y, w, h) {
        try {
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
                this.addImagePlaceholder(slide, x, y, w, h, 'SVG');
            }
        } catch (e) {
            console.warn('[renderFreeformSvgPPTX] Failed to render SVG:', e);
            this.addImagePlaceholder(slide, x, y, w, h, 'SVG');
        }
    },

    renderFreeformTablePPTX(slide, el, x, y, w, h) {
        const data = el.data || [];
        if (data.length === 0) return;

        const cols = Math.max(...data.map(row => (row || []).length));
        const colW = w / cols;

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
    },

    _needsEffectHint(el) {
        return (el.blend && el.blend !== 'normal') || el.mask || el.filter;
    },

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
    },
};

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PPTXSlideRendererFreeform;
}
