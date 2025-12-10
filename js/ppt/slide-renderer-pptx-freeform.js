/**
 * PPTX Freeform 渲染方法
 * 包含: 自由布局幻灯片的所有渲染方法
 * 通过 mixin 合并到 PPTXSlideRenderer 类
 */

const PPTXFreeformMixin = {
    renderFreeform(slide, data) {
        if (data.backgroundGradient) {
            const gradMatch = data.backgroundGradient.match(/linear-gradient\((\d+)deg,\s*([^,]+?)(?:\s+\d+%)?,\s*([^,)]+?)(?:\s+\d+%)?(?:,\s*([^)]+))?\)/);
            if (gradMatch) {
                slide.background = { color: this.safeColor(gradMatch[2]) || '4f46e5' };
            } else {
                const colorMatch = data.backgroundGradient.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})/);
                slide.background = { color: colorMatch ? colorMatch[1] : 'FFFFFF' };
            }
        } else if (data.backgroundImage) {
            try { slide.background = { path: data.backgroundImage }; }
            catch (e) { slide.background = { color: 'FFFFFF' }; }
        } else {
            slide.background = { color: this.safeColor(data.background) || 'FFFFFF' };
        }

        const elements = (data.elements || [])
            .map((el, i) => ({ ...el, _originalIndex: i }))
            .sort((a, b) => (a.z || 0) - (b.z || 0) || a._originalIndex - b._originalIndex);

        elements.forEach(el => this.renderFreeformElementPPTX(slide, el));
    },

    parseCoordToInch(value, totalInch) {
        if (typeof value === 'number') return value;
        const str = String(value).trim();
        if (str.endsWith('%')) return (parseFloat(str) / 100) * totalInch;
        if (str.endsWith('in')) return parseFloat(str);
        if (str.endsWith('px')) return parseFloat(str) / this.styles.dimensions.pxPerInch;
        if (str === 'auto') return null;
        return parseFloat(str) / this.styles.dimensions.pxPerInch || 0;
    },

    renderFreeformElementPPTX(slide, el) {
        const x = this.parseCoordToInch(el.x, this.SLIDE_W);
        const y = this.parseCoordToInch(el.y, this.SLIDE_H);
        const w = this.parseCoordToInch(el.w, this.SLIDE_W);
        const h = this.parseCoordToInch(el.h, this.SLIDE_H);

        try {
            switch (el.type) {
                case 'text': this.renderFreeformTextPPTX(slide, el, x, y, w, h); break;
                case 'shape': this.renderFreeformShapePPTX(slide, el, x, y, w, h); break;
                case 'image': this.renderFreeformImagePPTX(slide, el, x, y, w, h); break;
                case 'icon': this.renderFreeformIconPPTX(slide, el, x, y, w, h); break;
                case 'line': this.renderFreeformLinePPTX(slide, el); break;
                case 'chart': this.renderFreeformChartPPTX(slide, el, x, y, w, h); break;
                case 'formula': this.renderFreeformFormulaPPTX(slide, el, x, y, w, h); break;
                case 'group': this.renderFreeformGroupPPTX(slide, el, x, y, w, h); break;
                case 'card': this.renderFreeformCardPPTX(slide, el, x, y, w, h); break;
                case 'svg': this.renderFreeformSvgPPTX(slide, el, x, y, w, h); break;
                case 'table': this.renderFreeformTablePPTX(slide, el, x, y, w, h); break;
                case 'baked_element': this.renderBakedElementPPTX(slide, el, x, y, w, h); break;
            }
            if (this._needsEffectHint(el)) this._addEffectHint(slide, el, x, y);
        } catch (e) {
            console.error(`Error rendering freeform element type "${el.type}":`, e);
            throw e;
        }
    },

    renderFreeformTextPPTX(slide, el, x, y, w, h) {
        const fontSizePx = el.font || 18;
        // px→pt: 理论值 0.75，但实际视觉效果需要 ~0.82 才能匹配
        const fontSize = Math.round(fontSizePx * 0.82);

        let textContent = (el.content || '')
            .replace(/\r?\n/g, ' ')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/?(strong|b|em|i)>/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
            .replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();

        const lineCount = (textContent.match(/\n/g) || []).length + 1;
        const estimatedHeight = (fontSize / 72) * lineCount * 1.5;

        const textOptions = {
            x: x || 0, y: y || 0, w: w || 2, h: h || Math.max(estimatedHeight, 0.4),
            fontSize, fontFace: this.fontFace,
            color: this.safeColor(el.color) || '333333',
            bold: el.bold || false, italic: el.italic || false,
            align: el.align || 'left',
            valign: el.valign === 'middle' ? 'middle' : el.valign === 'bottom' ? 'bottom' : 'top',
        };

        if (el.rotate) textOptions.rotate = el.rotate;
        if (el.opacity !== undefined && el.opacity < 1) textOptions.transparency = Math.round((1 - el.opacity) * 100);
        if (el.bgColor) {
            const bgColor = this.safeColor(el.bgColor);
            if (bgColor) textOptions.fill = { color: bgColor };
        }

        try { this.addText(slide, textContent, textOptions); }
        catch (e) { console.warn('Failed to add text:', e); }
    },

    /**
     * 渲染 group - 将子元素的相对坐标转换为幻灯片绝对坐标
     * Group 内的子元素坐标是相对于 group 容器的百分比
     */
    renderFreeformGroupPPTX(slide, groupEl, groupX, groupY, groupW, groupH) {
        const children = groupEl.children || [];
        if (!children.length) return;

        // Group 的尺寸（英寸），用于计算子元素的绝对位置
        const gx = groupX || 0;
        const gy = groupY || 0;
        const gw = groupW || this.SLIDE_W;
        const gh = groupH || this.SLIDE_H;

        children.forEach(child => {
            // 克隆子元素，计算绝对坐标
            const absChild = { ...child };

            // 将子元素的相对坐标转换为绝对坐标
            // 子元素 x/y 是相对于 group 的百分比，需要转换为相对于整个幻灯片的位置
            const childX = this.parseCoordToInch(child.x, gw); // 相对于 group 宽度
            const childY = this.parseCoordToInch(child.y, gh); // 相对于 group 高度
            const childW = this.parseCoordToInch(child.w, gw);
            const childH = this.parseCoordToInch(child.h, gh);

            // 绝对坐标 = group 坐标 + 子元素在 group 内的偏移
            absChild.x = gx + childX;
            absChild.y = gy + childY;
            absChild.w = childW;
            absChild.h = childH;

            // 对于 line 元素，需要转换 x1/y1/x2/y2
            if (child.type === 'line') {
                absChild.x1 = gx + this.parseCoordToInch(child.x1, gw);
                absChild.y1 = gy + this.parseCoordToInch(child.y1, gh);
                absChild.x2 = gx + this.parseCoordToInch(child.x2, gw);
                absChild.y2 = gy + this.parseCoordToInch(child.y2, gh);
                // 标记坐标已经是绝对值（英寸）
                absChild._absCoords = true;
            }

            // 对于嵌套 group，递归处理
            if (child.type === 'group') {
                this.renderFreeformGroupPPTX(slide, child, absChild.x, absChild.y, absChild.w, absChild.h);
            } else {
                // 直接渲染，使用已经计算好的绝对坐标
                this.renderFreeformElementWithAbsCoords(slide, absChild);
            }
        });
    },

    /**
     * 使用已计算的绝对坐标渲染元素（供 group 内部使用）
     */
    renderFreeformElementWithAbsCoords(slide, el) {
        const x = el.x;
        const y = el.y;
        const w = el.w;
        const h = el.h;

        try {
            switch (el.type) {
                case 'text': this.renderFreeformTextPPTX(slide, el, x, y, w, h); break;
                case 'shape': this.renderFreeformShapePPTX(slide, el, x, y, w, h); break;
                case 'image': this.renderFreeformImagePPTX(slide, el, x, y, w, h); break;
                case 'icon': this.renderFreeformIconPPTX(slide, el, x, y, w, h); break;
                case 'line': this.renderFreeformLinePPTX(slide, el); break;
                case 'chart': this.renderFreeformChartPPTX(slide, el, x, y, w, h); break;
                case 'formula': this.renderFreeformFormulaPPTX(slide, el, x, y, w, h); break;
                case 'card': this.renderFreeformCardPPTX(slide, el, x, y, w, h); break;
                case 'svg': this.renderFreeformSvgPPTX(slide, el, x, y, w, h); break;
                case 'table': this.renderFreeformTablePPTX(slide, el, x, y, w, h); break;
                case 'baked_element': this.renderBakedElementPPTX(slide, el, x, y, w, h); break;
            }
            if (this._needsEffectHint(el)) this._addEffectHint(slide, el, x, y);
        } catch (e) {
            console.error(`Error rendering element in group type "${el.type}":`, e);
        }
    },

    renderFreeformShapePPTX(slide, el, x, y, w, h) {
        const shapeTypeMap = { 'rect': 'rect', 'circle': 'ellipse', 'rounded': 'roundRect', 'triangle': 'triangle' };
        let shapeType = shapeTypeMap[el.shape] || 'rect';
        
        // 如果有圆角且是矩形，使用 roundRect
        if (el.radius && (shapeType === 'rect' || el.shape === 'rounded')) {
            shapeType = 'roundRect';
        }

        const shapeOptions = {
            x: x || 0, y: y || 0, w: w || 1, h: h || 1,
            fill: { color: this.safeColor(el.fill) || '4f46e5' },
            line: (() => {
                const strokeColor = this.safeColor(el.outline || el.stroke);
                return strokeColor ? { color: strokeColor, width: el.strokeWidth || 1 } : { color: 'FFFFFF', transparency: 100 };
            })(),
        };

        if (shapeType === 'roundRect' && el.radius) shapeOptions.rectRadius = el.radius / 96;
        if (el.opacity !== undefined && el.opacity < 1) shapeOptions.fill.transparency = Math.round((1 - el.opacity) * 100);
        if (el.rotate) shapeOptions.rotate = el.rotate;

        try { slide.addShape(shapeType, shapeOptions); }
        catch (e) { console.warn('Failed to add shape:', e); }
    },

    renderFreeformImagePPTX(slide, el, x, y, w, h) {
        if (el.src) {
            try {
                const fitMode = el.fit || 'cover';
                const cached = this.imageCache && this.imageCache[el.src];
                
                // 计算最终位置和尺寸
                let finalX = x || 0, finalY = y || 0, finalW = w || 2, finalH = h || 2;
                
                // 如果是 contain 模式且有缓存的尺寸信息，手动计算居中位置
                if (fitMode === 'contain' && cached && cached.ratio) {
                    const containerRatio = (w || 2) / (h || 2);
                    const imgRatio = cached.ratio;
                    
                    if (imgRatio > containerRatio) {
                        // 图片更宽，以宽度为准
                        finalW = w || 2;
                        finalH = finalW / imgRatio;
                        finalY = (y || 0) + ((h || 2) - finalH) / 2;
                    } else {
                        // 图片更高，以高度为准
                        finalH = h || 2;
                        finalW = finalH * imgRatio;
                        finalX = (x || 0) + ((w || 2) - finalW) / 2;
                    }
                    console.log('[renderImage] Contain calc:', el.src, 'ratio:', imgRatio.toFixed(2), '→', finalW.toFixed(2), 'x', finalH.toFixed(2));
                }
                
                const imgOptions = { x: finalX, y: finalY, w: finalW, h: finalH };
                
                // 设置图片数据
                if (el.src.startsWith('data:')) {
                    imgOptions.data = el.src;
                } else if (cached) {
                    imgOptions.data = cached.data;
                } else {
                    imgOptions.path = el.src;
                }
                
                if (el.rotate) imgOptions.rotate = el.rotate;
                if (el.radius) imgOptions.rounding = true;
                
                slide.addImage(imgOptions);
            } catch (e) { this.addImagePlaceholder(slide, x, y, w, h, el.alt); }
        } else {
            this.addImagePlaceholder(slide, x || 0, y || 0, w || 2, h || 2, el.alt);
        }
    },

    // 渲染 baked 元素（预渲染的图片，通常来自 html2canvas）
    renderBakedElementPPTX(slide, el, x, y, w, h) {
        if (el.image) {
            try {
                slide.addImage({ data: el.image, x: x || 0, y: y || 0, w: w || 2, h: h || 2 });
            } catch (e) { console.warn('Failed to add baked element:', e); }
        }
    },

    renderFreeformIconPPTX(slide, el, x, y, w, h) {
        const iconSize = (el.size || 24) / 72;
        const color = this.safeColor(el.color) || '333333';
        const iconKey = `${el.icon}_${color}`;

        if (this.iconCache && this.iconCache[iconKey]) {
            slide.addImage({ data: this.iconCache[iconKey], x: x || 0, y: y || 0, w: iconSize, h: iconSize });
            return;
        }

        const emoji = this.getIconEmoji(el.icon);
        this.addText(slide, emoji, {
            x: x || 0, y: y || 0, w: iconSize * 2, h: iconSize * 2,
            fontSize: el.size || 24, color, align: 'center', valign: 'middle',
        });
    },

    renderFreeformLinePPTX(slide, el) {
        // 如果坐标已经是绝对值（来自 group 内部），直接使用
        let x1, y1, x2, y2;
        if (el._absCoords) {
            x1 = el.x1 || 0;
            y1 = el.y1 || 0;
            x2 = el.x2 || this.SLIDE_W;
            y2 = el.y2 || y1;
        } else {
            x1 = this.parseCoordToInch(el.x1, this.SLIDE_W) || 0;
            y1 = this.parseCoordToInch(el.y1, this.SLIDE_H) || 0;
            x2 = this.parseCoordToInch(el.x2, this.SLIDE_W) || this.SLIDE_W;
            y2 = this.parseCoordToInch(el.y2, this.SLIDE_H) || y1;
        }

        const lineColor = this.safeColor(el.stroke) || 'CCCCCC';
        const lineWidth = el.strokeWidth || 2;
        
        const deltaX = Math.abs(x2 - x1);
        const deltaY = Math.abs(y2 - y1);
        const isHorizontal = deltaY < 0.001 || (deltaX > 0.1 && deltaY / deltaX < 0.05);
        const isVertical = deltaX < 0.001 || (deltaY > 0.1 && deltaX / deltaY < 0.05);
        
        if (isHorizontal) {
            const minX = Math.min(x1, x2);
            const avgY = (y1 + y2) / 2;
            slide.addShape('rect', {
                x: minX, y: avgY - (lineWidth / 72 / 2),
                w: Math.max(deltaX, 0.01), h: lineWidth / 72,
                fill: { color: lineColor }, line: { color: lineColor, width: 0 },
            });
        } else if (isVertical) {
            const minY = Math.min(y1, y2);
            const avgX = (x1 + x2) / 2;
            slide.addShape('rect', {
                x: avgX - (lineWidth / 72 / 2), y: minY,
                w: lineWidth / 72, h: Math.max(deltaY, 0.01),
                fill: { color: lineColor }, line: { color: lineColor, width: 0 },
            });
        } else {
            const needFlipH = x2 < x1;
            const needFlipV = y2 < y1;
            const lineOptions = {
                x: Math.min(x1, x2), y: Math.min(y1, y2), w: deltaX, h: deltaY,
                line: { color: lineColor, width: lineWidth },
                flipH: needFlipH !== needFlipV,
            };
            if (el.dash) lineOptions.line.dashType = 'dash';
            try { slide.addShape('line', lineOptions); }
            catch (e) { console.warn('Failed to add line:', e); }
        }
    },

    renderFreeformChartPPTX(slide, el, x, y, w, h) {
        const data = this.parseChartDataPPTX(el.chartData);
        if (!data.length) return;

        const colors = (el.colors || '#4f46e5,#10b981,#f59e0b,#ec4899,#6366f1')
            .split(',').map(c => this.safeColor(c.trim()) || '4f46e5');
        const chartTypeMap = { 'bar': 'bar', 'line': 'line', 'pie': 'pie', 'doughnut': 'doughnut' };
        const pptxChartType = chartTypeMap[el.chartType] || 'bar';

        const chartData = [{ name: el.title || 'Data', labels: data.map(d => d.label), values: data.map(d => d.value) }];
        const chartOptions = {
            x: x || 0.5, y: y || 0.5, w: w || 4, h: h || 3,
            chartColors: colors, showTitle: !!el.title, title: el.title || '', showLegend: false,
        };

        if (pptxChartType === 'bar') { chartOptions.barDir = 'bar'; chartOptions.barGrouping = 'clustered'; }
        else if (pptxChartType === 'pie' || pptxChartType === 'doughnut') {
            chartOptions.showPercent = true;
            if (pptxChartType === 'doughnut') chartOptions.holeSize = 50;
        }

        try { slide.addChart(pptxChartType, chartData, chartOptions); }
        catch (e) {
            console.warn('Failed to add chart:', e);
            slide.addShape('roundRect', { x: x || 0.5, y: y || 0.5, w: w || 4, h: h || 3, fill: { color: 'F8FAFC' }, line: { color: 'E2E8F0', width: 1 } });
            this.addText(slide, `📊 ${el.title || 'Chart'}`, { x: x || 0.5, y: y || 0.5, w: w || 4, h: h || 3, fontSize: 14, color: '64748B', align: 'center', valign: 'middle' });
        }
    },

    parseChartDataPPTX(dataInput) {
        if (!dataInput) return [];
        
        // 新格式对象 (来自 PPTX 解析)
        if (typeof dataInput === 'object' && dataInput.categories && dataInput.series) {
            const categories = dataInput.categories || [];
            const series = dataInput.series || [];
            if (series.length > 0 && series[0].values) {
                return categories.map((cat, i) => ({
                    label: cat,
                    value: series[0].values[i] || 0
                }));
            }
            return [];
        }
        
        // 旧格式字符串
        if (typeof dataInput === 'string') {
            return dataInput.split(',').map(item => {
                const parts = item.split(':');
                return { label: parts[0]?.trim() || '', value: parseFloat(parts[1]) || 0 };
            });
        }
        
        return [];
    },

    renderFreeformFormulaPPTX(slide, el, x, y, w, h) {
        const fontSizePx = el.font || 24;
        const color = el.color || '#333333';
        const fontSize = Math.round(fontSizePx * 0.75);

        let displayText;
        if (this.formulaRegistry && this.mathConverter) {
            const formulaId = this.formulaRegistry.length;
            this.formulaRegistry.push({ id: formulaId, slideIndex: this.currentSlideIndex, latex: el.latex || '', x, y, w, h, fontSize, color, align: el.align || 'center' });
            displayText = `FORMULA_PLACEHOLDER_${formulaId}`;
        } else {
            displayText = this.latexToUnicode(el.latex || '');
        }

        const textOptions = {
            x: x || 0, y: y || 0, w: w || 2, h: h || 0.5,
            fontSize, fontFace: 'Cambria Math',
            color: this.safeColor(color) || '333333', align: el.align || 'center', valign: 'middle',
        };
        if (el.rotate) textOptions.rotate = el.rotate;
        if (el.opacity !== undefined && el.opacity < 1) textOptions.transparency = Math.round((1 - el.opacity) * 100);

        try { this.addText(slide, displayText, textOptions); }
        catch (e) { console.warn('Failed to add formula:', e); }
    },

    renderFreeformCardPPTX(slide, el, x, y, w, h) {
        const layout = el.layout || 'horizontal';
        const padding = (el.padding || 16) / this.styles.dimensions.pxPerInch;
        const radius = (el.radius || 12) / this.styles.dimensions.pxPerInch;

        const bgOptions = {
            x: x || 0, y: y || 0, w: w || 2, h: h || 1,
            fill: { color: this.safeColor(el.fill) || 'FFFFFF' },
            line: el.stroke ? { color: this.safeColor(el.stroke) || 'E2E8F0', width: el.strokeWidth || 1 } : { color: 'FFFFFF', transparency: 100 },
        };
        if (radius > 0) bgOptions.rectRadius = radius;
        try { slide.addShape(radius > 0 ? 'roundRect' : 'rect', bgOptions); }
        catch (e) { console.warn('Failed to add card background:', e); }

        const innerX = x + padding, innerY = y + padding;
        const innerW = w - padding * 2, innerH = h - padding * 2;
        const iconSize = (el.iconSize || 24) / this.styles.dimensions.pxPerInch;
        const iconBgSize = iconSize + 12 / this.styles.dimensions.pxPerInch; // 与 HTML 一致: iconSize + 12px
        const gap = 12 / this.styles.dimensions.pxPerInch; // 12px gap
        const titleSize = Math.round((el.titleSize || 16) * 0.75);
        const subtitleSize = Math.round((el.subtitleSize || 13) * 0.75);

        if (layout === 'vertical') {
            this._renderVerticalCard(slide, el, innerX, innerY, innerW, innerH, iconSize, iconBgSize, gap, titleSize, subtitleSize);
        } else {
            this._renderHorizontalCard(slide, el, innerX, innerY, innerW, innerH, iconSize, iconBgSize, gap, titleSize, subtitleSize, layout);
        }
    },

    _renderVerticalCard(slide, el, innerX, innerY, innerW, innerH, iconSize, iconBgSize, gap, titleSize, subtitleSize) {
        const titleLineH = titleSize / 72 * 1.3;
        const subtitleLineH = subtitleSize / 72 * 1.3;
        const textGap = 4 / this.styles.dimensions.pxPerInch; // 4px，与 HTML 一致
        const contentH = iconBgSize + gap + titleLineH + (el.subtitle ? textGap + subtitleLineH : 0);
        const startY = innerY + (innerH - contentH) / 2;

        if (el.icon && el.iconBg) {
            slide.addShape('roundRect', {
                x: innerX + (innerW - iconBgSize) / 2, y: startY, w: iconBgSize, h: iconBgSize,
                fill: { color: this.safeColor(el.iconBg) }, line: { color: 'FFFFFF', transparency: 100 }, rectRadius: iconBgSize / 3, // 与 HTML 一致
            });
        }

        if (el.icon) {
            const iconColor = this.safeColor(el.iconColor) || '4f46e5';
            const iconKey = `${el.icon}_${iconColor}`;
            if (this.iconCache && this.iconCache[iconKey]) {
                slide.addImage({ data: this.iconCache[iconKey], x: innerX + (innerW - iconSize) / 2, y: startY + (iconBgSize - iconSize) / 2, w: iconSize, h: iconSize });
            } else {
                this.addText(slide, this.getIconEmoji(el.icon), { x: innerX, y: startY, w: innerW, h: iconBgSize, fontSize: Math.round(el.iconSize || 24), color: iconColor, align: 'center', valign: 'middle' });
            }
        }

        if (el.title) this.addText(slide, el.title, { x: innerX, y: startY + iconBgSize + gap, w: innerW, h: titleLineH, fontSize: titleSize, color: this.safeColor(el.titleColor) || '1f2937', bold: el.titleBold !== false, align: 'center', valign: 'middle' });
        if (el.subtitle) this.addText(slide, el.subtitle, { x: innerX, y: startY + iconBgSize + gap + titleLineH + textGap, w: innerW, h: subtitleLineH, fontSize: subtitleSize, color: this.safeColor(el.subtitleColor) || '6b7280', align: 'center', valign: 'middle' });
    },

    _renderHorizontalCard(slide, el, innerX, innerY, innerW, innerH, iconSize, iconBgSize, gap, titleSize, subtitleSize, layout) {
        const isIconRight = layout === 'icon-right';
        const iconAreaW = el.icon ? iconBgSize + gap : 0;
        const textAreaW = innerW - iconAreaW;
        const textX = isIconRight ? innerX : innerX + iconAreaW;
        const iconX = isIconRight ? innerX + textAreaW + gap : innerX;

        if (el.icon && el.iconBg) {
            slide.addShape('roundRect', {
                x: iconX, y: innerY + (innerH - iconBgSize) / 2, w: iconBgSize, h: iconBgSize,
                fill: { color: this.safeColor(el.iconBg) }, line: { color: 'FFFFFF', transparency: 100 }, rectRadius: iconBgSize / 3, // 与 HTML 一致
            });
        }

        if (el.icon) {
            const iconColor = this.safeColor(el.iconColor) || '4f46e5';
            const iconKey = `${el.icon}_${iconColor}`;
            if (this.iconCache && this.iconCache[iconKey]) {
                slide.addImage({ data: this.iconCache[iconKey], x: iconX + (iconBgSize - iconSize) / 2, y: innerY + (innerH - iconSize) / 2, w: iconSize, h: iconSize });
            } else {
                this.addText(slide, this.getIconEmoji(el.icon), { x: iconX, y: innerY, w: iconBgSize, h: innerH, fontSize: Math.round(el.iconSize || 24), color: iconColor, align: 'center', valign: 'middle' });
            }
        }

        const hasSubtitle = !!el.subtitle;
        const titleLineH = titleSize / 72 * 1.3;
        const subtitleLineH = subtitleSize / 72 * 1.3;
        const textGap = hasSubtitle ? 4 / this.styles.dimensions.pxPerInch : 0; // 4px，与 HTML 一致
        const totalTextH = titleLineH + (hasSubtitle ? textGap + subtitleLineH : 0);
        const textStartY = innerY + (innerH - totalTextH) / 2;

        if (el.title) this.addText(slide, el.title, { x: textX, y: textStartY, w: textAreaW - gap, h: titleLineH, fontSize: titleSize, color: this.safeColor(el.titleColor) || '1f2937', bold: el.titleBold !== false, align: 'left', valign: 'middle' });
        if (el.subtitle) this.addText(slide, el.subtitle, { x: textX, y: textStartY + titleLineH + textGap, w: textAreaW - gap, h: subtitleLineH, fontSize: subtitleSize, color: this.safeColor(el.subtitleColor) || '6b7280', align: 'left', valign: 'middle' });
    },

    renderFreeformSvgPPTX(slide, el, x, y, w, h) {
        try {
            const key = this._hashString(el.content || '');
            const cached = this.svgCache?.[key];
            
            if (!cached) {
                console.warn('[renderFreeformSvgPPTX] SVG not in cache');
                this.addImagePlaceholder(slide, x, y, w, h, 'SVG');
                return;
            }
            
            // 兼容旧格式（纯 dataUrl）和新格式（对象）
            const graphicsData = typeof cached === 'string' ? cached : cached.graphics;
            const textElements = typeof cached === 'object' ? (cached.texts || []) : [];
            console.log(`[renderSvg] texts: ${textElements.length}, cached type: ${typeof cached}`);
            
            // 1. 渲染图形层
            if (graphicsData) {
                const imgOptions = { data: graphicsData, x: x || 0, y: y || 0, w: w || 2, h: h || 2 };
                if (el.opacity !== undefined && el.opacity < 1) {
                    imgOptions.transparency = Math.round((1 - el.opacity) * 100);
                }
                slide.addImage(imgOptions);
            }
            
            // 2. 渲染文字层（原生可编辑文字）
            if (textElements && textElements.length > 0) {
                const containerX = x || 0;
                const containerY = y || 0;
                const containerW = w || 2;
                const containerH = h || 2;
                
                textElements.forEach(txt => {
                    // PPTX 字号 pt（0.82 匹配 HTML 视觉效果）
                    const fontPt = Math.round(txt.fontSize * 0.82);
                    
                    // 使用精确测量的边界框位置
                    let textX = containerX + txt.xPct * containerW;
                    const textY = containerY + txt.yPct * containerH;
                    const textH = txt.hPct ? txt.hPct * containerH : 0.3;
                    
                    // 估算文字宽度（基于字号和字符数）
                    const estCharWidth = fontPt * 0.02;  // 英寸每字符
                    const estTextW = txt.text.length * estCharWidth + 0.1;
                    
                    // 根据 text-anchor 设置对齐和调整位置
                    let align = 'left';
                    let finalX = textX;
                    let finalW = estTextW;
                    
                    if (txt.textAnchor === 'middle') {
                        align = 'center';
                        finalX = textX - estTextW / 2;  // 文字框向左移动半个宽度
                    } else if (txt.textAnchor === 'end') {
                        align = 'right';
                        finalX = textX - estTextW;  // 文字框向左移动整个宽度
                    }
                    
                    this.addText(slide, txt.text, {
                        x: finalX,
                        y: textY,
                        w: finalW,
                        h: textH * 1.2,
                        fontSize: fontPt,
                        color: this.safeColor(txt.color),
                        bold: txt.bold,
                        align: align,
                        valign: 'top',
                        wrap: false,
                        inset: 0,
                    });
                });
            }
        } catch (e) {
            console.warn('[renderFreeformSvgPPTX] Failed:', e);
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
                    bold: isHeader, align: 'center', valign: 'middle',
                    fontSize: Math.round((el.fontSize || 14) * 0.75), fontFace: this.fontFace,
                }
            }));
        });

        try {
            slide.addTable(tableRows, {
                x: x || 0, y: y || 0, w: w || 4,
                colW: Array(cols).fill(colW),
                border: { pt: 1, color: this.safeColor(el.borderColor) || 'E2E8F0' },
                fontFace: this.fontFace,
            });
        } catch (e) { console.warn('[renderFreeformTablePPTX] Failed:', e); }
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
        slide.addText(`[效果降级: ${hints.join(', ')}]`, { x, y: y + 0.05, w: 2.4, h: 0.2, fontSize: 8, color: '999999', italic: true, align: 'left' });
    },
};

// 导出供主类使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PPTXFreeformMixin;
}
