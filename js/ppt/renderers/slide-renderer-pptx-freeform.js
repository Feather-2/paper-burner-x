/**
 * PPTX Freeform 渲染方法
 * 包含: 自由布局幻灯片的所有渲染方法
 * 通过 mixin 合并到 PPTXSlideRenderer 类
 */

const PPTXFreeformMixin = {
    async renderFreeform(slide, data) {
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

        for (const el of elements) {
            await this.renderFreeformElementPPTX(slide, el);
        }
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

    async renderFreeformElementPPTX(slide, el) {
        const x = this.parseCoordToInch(el.x, this.SLIDE_W);
        const y = this.parseCoordToInch(el.y, this.SLIDE_H);
        const w = this.parseCoordToInch(el.w, this.SLIDE_W);
        const h = this.parseCoordToInch(el.h, this.SLIDE_H);

        try {
            switch (el.type) {
                case 'text': this.renderFreeformTextPPTX(slide, el, x, y, w, h); break;
                case 'shape': this.renderFreeformShapePPTX(slide, el, x, y, w, h); break;
                case 'image': await this.renderFreeformImagePPTX(slide, el, x, y, w, h); break;
                case 'icon': this.renderFreeformIconPPTX(slide, el, x, y, w, h); break;
                case 'line': this.renderFreeformLinePPTX(slide, el); break;
                case 'chart': this.renderFreeformChartPPTX(slide, el, x, y, w, h); break;
                case 'formula': this.renderFreeformFormulaPPTX(slide, el, x, y, w, h); break;
                case 'group': await this.renderFreeformGroupPPTX(slide, el, x, y, w, h); break;
                case 'card': await this.renderFreeformCardPPTX(slide, el, x, y, w, h); break;
                case 'svg': this.renderFreeformSvgPPTX(slide, el, x, y, w, h); break;
                case 'table': this.renderFreeformTablePPTX(slide, el, x, y, w, h); break;
                case 'list': this.renderFreeformListPPTX(slide, el, x, y, w, h); break;
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
        // px→pt: 标准转换 0.75，之前用 0.82 导致文字过大引起换行
        // 使用 0.75 可以更好地匹配 HTML 预览中的文字宽度
        const fontSize = Math.round(fontSizePx * 0.75);
        const defaultColor = this.safeColor(el.color) || '333333';

        // 解析富文本（支持 <span style="color:xxx"> 等）
        const textRuns = this._parseRichTextToRuns(el.content || '', {
            fontSize,
            fontFace: el.fontFamily || this.fontFace,
            color: defaultColor,
            bold: el.bold || false,
            italic: el.italic || false,
        });

        // 计算高度
        const plainText = textRuns.map(r => r.text).join('');
        const lineCount = (plainText.match(/\n/g) || []).length + 1;
        const estimatedHeight = (fontSize / 72) * lineCount * 1.5;

        const textOptions = {
            x: x || 0, y: y || 0, w: w || 2, h: h || Math.max(estimatedHeight, 0.4),
            align: el.align || 'left',
            valign: el.valign === 'middle' ? 'middle' : el.valign === 'bottom' ? 'bottom' : 'top',
        };

        // 文字装饰（应用到所有 runs）
        if (el.underline) textRuns.forEach(r => r.options.underline = { style: 'sng' });
        if (el.strike) textRuns.forEach(r => r.options.strike = 'sngStrike');
        if (el.superscript) textRuns.forEach(r => r.options.superscript = true);
        if (el.subscript) textRuns.forEach(r => r.options.subscript = true);
        
        // 字符间距 (px → pt，系数 0.75)
        if (el.letterSpacing) {
            const spacing = typeof el.letterSpacing === 'number' ? el.letterSpacing : parseFloat(el.letterSpacing) || 0;
            if (spacing) textRuns.forEach(r => r.options.charSpacing = spacing * 0.75);
        }

        if (el.rotate) textOptions.rotate = el.rotate;
        if (el.opacity !== undefined && el.opacity < 1) textOptions.transparency = Math.round((1 - el.opacity) * 100);
        if (el.bgColor) {
            const bgColor = this.safeColor(el.bgColor);
            if (bgColor) textOptions.fill = { color: bgColor };
        }

        try { this.addText(slide, textRuns, textOptions); }
        catch (e) { console.warn('Failed to add text:', e); }
    },

    /**
     * 解析 HTML 富文本为 PptxGenJS text runs 格式
     * 支持 <span style="color:xxx">, <b>, <strong>, <i>, <em>, <br>
     */
    _parseRichTextToRuns(html, defaultOpts) {
        const runs = [];
        const { fontSize, fontFace, color, bold, italic } = defaultOpts;

        // 预处理：统一换行
        let content = (html || '')
            .replace(/\r?\n/g, ' ')
            .replace(/<br\s*\/?>/gi, '\n');

        // 正则匹配 span/b/strong/i/em 标签
        const tagRegex = /<(span|b|strong|i|em)([^>]*)>(.*?)<\/\1>/gi;
        let lastIndex = 0;
        let match;

        while ((match = tagRegex.exec(content)) !== null) {
            // 添加标签前的普通文本
            if (match.index > lastIndex) {
                const text = this._cleanTextContent(content.slice(lastIndex, match.index));
                if (text) {
                    runs.push({ text, options: { fontSize, fontFace, color, bold, italic } });
                }
            }

            const tagName = match[1].toLowerCase();
            const attrs = match[2];
            const innerText = this._cleanTextContent(match[3]);

            if (innerText) {
                const runOpts = { fontSize, fontFace, color, bold, italic };

                // 解析 style 属性中的 color
                const colorMatch = attrs.match(/style\s*=\s*["'][^"']*color\s*:\s*([^;"']+)/i);
                if (colorMatch) {
                    runOpts.color = this.safeColor(colorMatch[1].trim()) || color;
                }

                // 处理粗体/斜体标签
                if (tagName === 'b' || tagName === 'strong') runOpts.bold = true;
                if (tagName === 'i' || tagName === 'em') runOpts.italic = true;

                // 处理上标/下标属性
                if (attrs.includes('data-superscript="true"') || attrs.includes("data-superscript='true'")) {
                    runOpts.superscript = true;
                }
                if (attrs.includes('data-subscript="true"') || attrs.includes("data-subscript='true'")) {
                    runOpts.subscript = true;
                }

                runs.push({ text: innerText, options: runOpts });
            }

            lastIndex = tagRegex.lastIndex;
        }

        // 添加剩余文本
        if (lastIndex < content.length) {
            const text = this._cleanTextContent(content.slice(lastIndex));
            if (text) {
                runs.push({ text, options: { fontSize, fontFace, color, bold, italic } });
            }
        }

        // 如果没有解析出任何 runs，返回整个文本作为单个 run
        if (runs.length === 0) {
            const text = this._cleanTextContent(content);
            if (text) {
                runs.push({ text, options: { fontSize, fontFace, color, bold, italic } });
            }
        }

        return runs;
    },

    /**
     * 清理文本内容：移除剩余 HTML 标签，解码实体
     */
    _cleanTextContent(text) {
        return (text || '')
            .replace(/<[^>]+>/g, '')  // 移除剩余 HTML 标签
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/[ \t]+/g, ' ')
            .trim();
    },

    /**
     * 渲染 group - 将子元素的相对坐标转换为幻灯片绝对坐标
     * Group 内的子元素坐标是相对于 group 容器的百分比
     */
    async renderFreeformGroupPPTX(slide, groupEl, groupX, groupY, groupW, groupH) {
        const children = groupEl.children || [];
        if (!children.length) return;

        // Group 的尺寸（英寸），用于计算子元素的绝对位置
        const gx = groupX || 0;
        const gy = groupY || 0;
        const gw = groupW || this.SLIDE_W;
        const gh = groupH || this.SLIDE_H;

        for (const child of children) {
            // 克隆子元素，计算绝对坐标
            const absChild = { ...child };

            // 将子元素的相对坐标转换为绝对坐标
            // 子元素 x/y 是相对于 group 的百分比，需要转换为相对于整个幻灯片的位置
            const childX = this.parseCoordToInch(child.x, gw); // 相对于 group 宽度
            const childY = this.parseCoordToInch(child.y, gh); // 相对于 group 高度
            let childW = this.parseCoordToInch(child.w, gw);
            let childH = this.parseCoordToInch(child.h, gh);

            // icon 元素特殊处理：使用 size 作为尺寸
            if (child.type === 'icon') {
                const iconSize = (child.size || 24) / this.styles.dimensions.pxPerInch;
                childW = iconSize;
                childH = iconSize;
            }
            
            // text 元素 h=auto 处理：估算高度
            if (child.type === 'text' && (child.h === 'auto' || childH === null)) {
                const fontSizePx = child.font || 18;
                const fontSize = Math.round(fontSizePx * 0.75);
                const lineCount = ((child.content || '').match(/\n/g) || []).length + 1;
                childH = (fontSize / 72) * lineCount * 1.5;
            }

            // 圆形/椭圆处理：只有当 h 为 auto 或未指定时才强制正圆
            const isCircle = child.type === 'shape' && (child.shape === 'circle' || child.shapeType === 'circle');
            if (isCircle && (child.h === 'auto' || child.h === undefined || child.h === null)) {
                // h 为 auto 时，使用 w 作为高度（正圆）
                childH = childW;
            }
            // 否则保持原始宽高比（允许椭圆）

            // SVG 特殊处理已移到 renderFreeformSvgPPTX 内部处理

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
                await this.renderFreeformGroupPPTX(slide, child, absChild.x, absChild.y, absChild.w, absChild.h);
            } else {
                // 直接渲染，使用已经计算好的绝对坐标
                await this.renderFreeformElementWithAbsCoords(slide, absChild);
            }
        }
    },

    /**
     * 使用已计算的绝对坐标渲染元素（供 group 内部使用）
     */
    async renderFreeformElementWithAbsCoords(slide, el) {
        const x = el.x;
        const y = el.y;
        const w = el.w;
        const h = el.h;

        try {
            switch (el.type) {
                case 'text': this.renderFreeformTextPPTX(slide, el, x, y, w, h); break;
                case 'shape': this.renderFreeformShapePPTX(slide, el, x, y, w, h); break;
                case 'image': await this.renderFreeformImagePPTX(slide, el, x, y, w, h); break;
                case 'icon': this.renderFreeformIconPPTX(slide, el, x, y, w, h); break;
                case 'line': this.renderFreeformLinePPTX(slide, el); break;
                case 'chart': this.renderFreeformChartPPTX(slide, el, x, y, w, h); break;
                case 'formula': this.renderFreeformFormulaPPTX(slide, el, x, y, w, h); break;
                case 'card': await this.renderFreeformCardPPTX(slide, el, x, y, w, h); break;
                case 'svg': this.renderFreeformSvgPPTX(slide, el, x, y, w, h); break;
                case 'table': this.renderFreeformTablePPTX(slide, el, x, y, w, h); break;
                case 'list': this.renderFreeformListPPTX(slide, el, x, y, w, h); break;
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

        // 圆形/椭圆处理：只有当 h 为 auto 或未指定时才强制正圆
        // 否则保持原始宽高比（允许椭圆）
        let finalW = w || 1;
        let finalH = h || 1;
        if (el.shape === 'circle' && (el.h === 'auto' || el.h === undefined || el.h === null)) {
            // h 为 auto 时，使用 w 作为宽高（正圆）
            finalH = finalW;
        }
        // 注意：shapeType 已经是 'ellipse'，PPTX 的 ellipse 支持宽高不等

        const shapeOptions = {
            x: x || 0, y: y || 0, w: finalW, h: finalH,
            fill: { color: this.safeColor(el.fill) || '4f46e5' },
            line: (() => {
                const strokeColor = this.safeColor(el.outline || el.stroke);
                // 无边框时使用 type: 'none'，而不是透明边框（透明边框可能仍然渲染边缘线）
                return strokeColor ? { color: strokeColor, width: el.strokeWidth || 1 } : { type: 'none' };
            })(),
        };

        if (shapeType === 'roundRect' && el.radius) shapeOptions.rectRadius = el.radius / 96;
        if (el.opacity !== undefined && el.opacity < 1) shapeOptions.fill.transparency = Math.round((1 - el.opacity) * 100);
        if (el.rotate) shapeOptions.rotate = el.rotate;
        
        // 阴影效果
        if (el.effect && el.effect.includes('shadow')) {
            shapeOptions.shadow = this._getShadowOptions(el.effect);
        }

        try { slide.addShape(shapeType, shapeOptions); }
        catch (e) { console.warn('Failed to add shape:', e); }
    },

    async renderFreeformImagePPTX(slide, el, x, y, w, h) {
        if (el.src) {
            try {
                const fitMode = el.fit || 'cover';
                // 缓存 key 必须与 preloadImage 一致
                const cacheKey = el.radius ? `${el.src}_r${el.radius}` : el.src;
                let cached = this.imageCache && this.imageCache[cacheKey];
                
                // 对于 data: URL 且没缓存的情况，获取图片尺寸
                const isDataUrl = el.src.startsWith('data:');
                console.log('[renderImage] Check:', { isDataUrl, cached: !!cached, radius: el.radius, srcStart: el.src.slice(0, 30) });
                
                // 没有缓存时，获取图片尺寸信息（data URL 或外部 URL）
                if (!cached) {
                    try {
                        const dimensions = await this._getImageDimensions(el.src);
                        console.log('[renderImage] Got dimensions for uncached:', dimensions, 'src:', el.src.slice(0, 50));
                        cached = { width: dimensions.width, height: dimensions.height, ratio: dimensions.width / dimensions.height };
                        
                        if (isDataUrl) {
                            cached.data = el.src;
                            // 如果有圆角，处理圆角
                            if (el.radius && el.radius > 0) {
                                const processedData = await this._applyRoundedCorners(el.src, dimensions.width, dimensions.height, el.radius, el.w, el.h);
                                cached.data = processedData;
                                cached.hasRadius = true;
                                console.log('[renderImage] Applied radius to data: URL image, radius:', el.radius);
                            }
                        }
                        
                        this.imageCache[cacheKey] = cached;
                    } catch (err) {
                        console.error('[renderImage] Failed to process image:', err);
                    }
                }
                
                // 计算最终位置和尺寸
                let finalX = x || 0, finalY = y || 0, finalW = w || 2, finalH = h;
                
                // 处理 h="auto"：根据图片比例计算高度
                if (finalH === null || finalH === undefined) {
                    if (cached && cached.ratio) {
                        // 使用图片原始比例
                        finalH = finalW / cached.ratio;
                        console.log('[renderImage] Auto height:', el.src, 'w:', finalW.toFixed(2), '→ h:', finalH.toFixed(2));
                    } else {
                        // 没有缓存，假设正方形
                        finalH = finalW;
                    }
                }
                
                // 根据 fit 模式处理图片比例
                if (cached && cached.ratio) {
                    const containerRatio = finalW / finalH;
                    const imgRatio = cached.ratio;
                    
                    if (fitMode === 'contain') {
                        // contain: 图片完整显示，可能有空白
                        if (imgRatio > containerRatio) {
                            const newH = finalW / imgRatio;
                            finalY = finalY + (finalH - newH) / 2;
                            finalH = newH;
                        } else {
                            const newW = finalH * imgRatio;
                            finalX = finalX + (finalW - newW) / 2;
                            finalW = newW;
                        }
                        console.log(`[renderImage] contain calc:`, el.src, 'ratio:', imgRatio.toFixed(2), '→', finalW.toFixed(2), 'x', finalH.toFixed(2));
                    } else if (fitMode === 'cover' && Math.abs(imgRatio - containerRatio) > 0.05) {
                        // cover: 裁剪图片到容器比例（仅当比例差异较大时）
                        try {
                            let imgData = cached.data;
                            // 如果没有 data（外部 URL），需要先获取 base64
                            if (!imgData && !isDataUrl) {
                                imgData = await this._fetchImageAsBase64(el.src);
                                cached.data = imgData;
                            }
                            imgData = imgData || el.src;
                            const croppedData = await this._applyCoverCrop(imgData, cached.width, cached.height, containerRatio);
                            cached = { ...cached, data: croppedData, ratio: containerRatio };
                            console.log(`[renderImage] cover crop:`, el.src.slice(0, 50), 'imgRatio:', imgRatio.toFixed(2), '→ containerRatio:', containerRatio.toFixed(2));
                        } catch (err) {
                            console.warn('[renderImage] cover crop failed:', err);
                        }
                    }
                }
                
                const imgOptions = { x: finalX, y: finalY, w: finalW, h: finalH };
                
                // 设置图片数据：优先使用处理过圆角的缓存数据
                if (cached && cached.data) {
                    imgOptions.data = cached.data;
                } else if (el.src.startsWith('data:')) {
                    imgOptions.data = el.src;
                } else {
                    imgOptions.path = el.src;
                }
                
                if (el.rotate) imgOptions.rotate = el.rotate;
                
                // 圆角处理：
                // - radius 足够大（>= 宽度的一半）时，使用 PptxGenJS 的 rounding:true 显示圆形
                // - 其他情况通过预处理图片添加圆角蒙版（已在 preloadImage 中处理）
                if (el.radius) {
                    const minSize = Math.min(finalW, finalH) * this.styles.dimensions.pxPerInch;
                    const isCircle = el.radius >= minSize / 2;
                    if (isCircle) {
                        imgOptions.rounding = true;
                    }
                    // 非圆形的圆角效果已通过 _applyRoundedCorners 预处理
                }
                
                // 阴影效果
                if (el.effect && el.effect.includes('shadow')) {
                    imgOptions.shadow = this._getShadowOptions(el.effect);
                }
                
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

        // 位置：使用传入的坐标（可能是 0）
        const posX = (x !== undefined && x !== null) ? x : 0;
        const posY = (y !== undefined && y !== null) ? y : 0;


        if (this.iconCache && this.iconCache[iconKey]) {
            slide.addImage({ data: this.iconCache[iconKey], x: posX, y: posY, w: iconSize, h: iconSize });
            return;
        }

        // fallback: 使用 emoji 文本
        const emoji = this.getIconEmoji(el.icon);
        this.addText(slide, emoji, {
            x: posX, y: posY, w: iconSize, h: iconSize,
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
            line: el.stroke ? { color: this.safeColor(el.stroke) || 'E2E8F0', width: el.strokeWidth || 1 } : { type: 'none' },
        };
        if (radius > 0) bgOptions.rectRadius = radius;
        // 阴影效果
        if (el.effect && el.effect.includes('shadow')) {
            bgOptions.shadow = this._getShadowOptions(el.effect);
        }
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
                fill: { color: this.safeColor(el.iconBg) }, line: { type: 'none' }, rectRadius: iconBgSize / 3, // 与 HTML 一致
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
        
        // 对于小卡片（宽度<1英寸），使用更紧凑的布局
        const isSmallCard = innerW < 1;
        const actualIconSize = isSmallCard ? iconSize * 0.8 : iconSize;
        const actualIconBgSize = isSmallCard ? actualIconSize : iconBgSize;
        const actualGap = isSmallCard ? gap * 0.5 : gap;
        
        const iconAreaW = el.icon ? actualIconBgSize + actualGap : 0;
        const textAreaW = innerW - iconAreaW;
        const textX = isIconRight ? innerX : innerX + iconAreaW;
        const iconX = isIconRight ? innerX + textAreaW + actualGap : innerX;

        // 图标背景（小卡片不显示背景）
        if (el.icon && el.iconBg && !isSmallCard) {
            slide.addShape('roundRect', {
                x: iconX, y: innerY + (innerH - actualIconBgSize) / 2, w: actualIconBgSize, h: actualIconBgSize,
                fill: { color: this.safeColor(el.iconBg) }, line: { type: 'none' }, rectRadius: actualIconBgSize / 3,
            });
        }

        if (el.icon) {
            const iconColor = this.safeColor(el.iconColor) || '4f46e5';
            const iconKey = `${el.icon}_${iconColor}`;
            if (this.iconCache && this.iconCache[iconKey]) {
                slide.addImage({ data: this.iconCache[iconKey], x: iconX + (actualIconBgSize - actualIconSize) / 2, y: innerY + (innerH - actualIconSize) / 2, w: actualIconSize, h: actualIconSize });
            } else {
                this.addText(slide, this.getIconEmoji(el.icon), { x: iconX, y: innerY, w: actualIconBgSize, h: innerH, fontSize: Math.round((el.iconSize || 24) * (isSmallCard ? 0.8 : 1)), color: iconColor, align: 'center', valign: 'middle' });
            }
        }

        const hasSubtitle = !!el.subtitle;
        const titleLineH = titleSize / 72 * 1.3;
        const subtitleLineH = subtitleSize / 72 * 1.3;
        const textGap = hasSubtitle ? 4 / this.styles.dimensions.pxPerInch : 0;
        const totalTextH = titleLineH + (hasSubtitle ? textGap + subtitleLineH : 0);
        const textStartY = innerY + (innerH - totalTextH) / 2;

        // 文字使用整个文字区域宽度，允许换行
        if (el.title) this.addText(slide, el.title, { x: textX, y: innerY, w: textAreaW, h: innerH, fontSize: titleSize, color: this.safeColor(el.titleColor) || '1f2937', bold: el.titleBold !== false, align: 'left', valign: 'middle' });
        if (el.subtitle) this.addText(slide, el.subtitle, { x: textX, y: textStartY + titleLineH + textGap, w: textAreaW, h: subtitleLineH, fontSize: subtitleSize, color: this.safeColor(el.subtitleColor) || '6b7280', align: 'left', valign: 'middle' });
    },

    renderFreeformSvgPPTX(slide, el, x, y, w, h) {
        try {
            // 根据 viewBox 调整宽高比，并居中
            let finalX = x || 0;
            let finalY = y || 0;
            let finalW = w || 2;
            let finalH = h || 2;
            const origW = finalW;
            const origH = finalH;
            const content = el.content || '';
            const viewBoxMatch = content.match(/viewBox=["'](-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+)\s+([\d.]+)["']/);
            if (viewBoxMatch) {
                const vbW = parseFloat(viewBoxMatch[3]);
                const vbH = parseFloat(viewBoxMatch[4]);
                const vbRatio = vbW / vbH;
                // 按 viewBox 比例调整，保持在容器内
                if (Math.abs(vbRatio - 1) < 0.01) {
                    // 正方形：取较小值并居中
                    const size = Math.min(finalW, finalH);
                    finalX += (origW - size) / 2;
                    finalY += (origH - size) / 2;
                    finalW = size;
                    finalH = size;
                } else if (finalW / finalH > vbRatio) {
                    const newW = finalH * vbRatio;
                    finalX += (origW - newW) / 2;
                    finalW = newW;
                } else {
                    const newH = finalW / vbRatio;
                    finalY += (origH - newH) / 2;
                    finalH = newH;
                }
                console.log('[SVG PPTX] viewBox ratio:', vbRatio, 'adjusted:', finalW, 'x', finalH, 'at', finalX, finalY);
            }
            
            const key = this._hashString(content);
            const cached = this.svgCache?.[key];
            
            if (!cached) {
                console.warn('[renderFreeformSvgPPTX] SVG not in cache');
                this.addImagePlaceholder(slide, x, y, finalW, finalH, 'SVG');
                return;
            }
            
            // 兼容旧格式（纯 dataUrl）和新格式（对象）
            const graphicsData = typeof cached === 'string' ? cached : cached.graphics;
            const textElements = typeof cached === 'object' ? (cached.texts || []) : [];
            console.log(`[renderSvg] texts: ${textElements.length}, cached type: ${typeof cached}`);
            
            // 1. 渲染图形层
            if (graphicsData) {
                const imgOptions = { data: graphicsData, x: finalX, y: finalY, w: finalW, h: finalH };
                if (el.opacity !== undefined && el.opacity < 1) {
                    imgOptions.transparency = Math.round((1 - el.opacity) * 100);
                }
                slide.addImage(imgOptions);
            }
            
            // 2. 渲染文字层（原生可编辑文字）
            // 注意：xPct/yPct 在预加载时已经包含了 viewBox 居中偏移
            // 所以这里使用原始容器尺寸（x, y, origW, origH），不使用调整后的尺寸
            if (textElements && textElements.length > 0) {
                const containerX = x || 0;
                const containerY = y || 0;
                const containerW = origW;
                const containerH = origH;
                
                textElements.forEach(txt => {
                    // PPTX 字号 pt（标准 0.75 转换）
                    const fontPt = Math.round(txt.fontSize * 0.75);
                    
                    // 文字在容器内的绝对位置
                    const textX = containerX + txt.xPct * containerW;
                    const textY = containerY + txt.yPct * containerH;
                    const textH = txt.hPct ? txt.hPct * containerH : 0.3;
                    
                    // 固定文字框宽度 1.5 英寸（足够容纳大部分文字）
                    const textBoxW = 1.5;
                    
                    // 根据 text-anchor 计算文字框位置
                    let align = 'left';
                    let finalX = textX;
                    
                    if (txt.textAnchor === 'middle') {
                        align = 'center';
                        finalX = textX - textBoxW / 2;
                    } else if (txt.textAnchor === 'end') {
                        align = 'right';
                        finalX = textX - textBoxW;
                    }
                    
                    this.addText(slide, txt.text, {
                        x: finalX,
                        y: textY,
                        w: textBoxW,
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

    renderFreeformListPPTX(slide, el, x, y, w, h) {
        const items = el.items || [];
        if (items.length === 0) return;

        const fontSize = Math.round((el.font || 16) * 0.75);
        const color = this.safeColor(el.color) || '333333';
        const isOrdered = el.listType === 'ol';
        const lineHeight = el.lineHeight || 1.6;

        // 计算每行高度
        const lineHeightInch = (fontSize / 72) * lineHeight;
        
        // 使用 PptxGenJS 的列表功能
        const textItems = items.map((item, i) => ({
            text: item,
            options: {
                fontSize,
                fontFace: this.fontFace,
                color,
                bullet: isOrdered ? { type: 'number', startAt: i + 1 } : { code: '2022' }, // • bullet
                indentLevel: 0,
                paraSpaceAfter: 4,
            }
        }));

        try {
            this.addText(slide, textItems, {
                x: x || 0,
                y: y || 0,
                w: w || 4,
                h: h || (lineHeightInch * items.length + 0.2),
                valign: 'top',
            });
        } catch (e) { console.warn('[renderFreeformListPPTX] Failed:', e); }
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

    /**
     * 根据 effect 属性生成 PptxGenJS shadow 配置
     * 支持 shadow-sm, shadow, shadow-md, shadow-lg, shadow-xl, shadow-2xl
     */
    _getShadowOptions(effect) {
        // 阴影配置 - 模拟 CSS box-shadow 效果
        // angle: 90 = 向下偏移，模拟光源从上方照射
        // CSS box-shadow 通常是向下偏移更多，产生不均匀的自然阴影
        const shadowPresets = {
            'shadow-sm': { type: 'outer', blur: 4, offset: 1, angle: 90, opacity: 0.12, color: '000000' },
            'shadow': { type: 'outer', blur: 6, offset: 2, angle: 90, opacity: 0.15, color: '000000' },
            'shadow-md': { type: 'outer', blur: 10, offset: 3, angle: 90, opacity: 0.18, color: '000000' },
            'shadow-lg': { type: 'outer', blur: 15, offset: 4, angle: 90, opacity: 0.22, color: '000000' },
            'shadow-xl': { type: 'outer', blur: 25, offset: 6, angle: 90, opacity: 0.25, color: '000000' },
            'shadow-2xl': { type: 'outer', blur: 35, offset: 8, angle: 90, opacity: 0.3, color: '000000' },
        };

        // 匹配 effect 字符串中的阴影类型
        for (const [key, preset] of Object.entries(shadowPresets)) {
            if (effect.includes(key)) {
                return preset;
            }
        }

        // 默认使用 shadow-md
        if (effect.includes('shadow')) {
            return shadowPresets['shadow-md'];
        }

        return null;
    },
};

// Global export (legacy scripts + ESM import side-effects).
try {
    if (typeof globalThis !== 'undefined') {
        globalThis.PPTXFreeformMixin = PPTXFreeformMixin;
    }
    if (typeof window !== 'undefined') {
        window.PPTXFreeformMixin = PPTXFreeformMixin;
    }
} catch {
    // ignore
}

// 导出供主类使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PPTXFreeformMixin;
}

// ESM 导出
export { PPTXFreeformMixin };
