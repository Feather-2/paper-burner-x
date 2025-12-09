/**
 * LayerEditor 工具函数模块
 * 从 layer-editor.js 拆分出的工具方法
 */

/**
 * 工具函数 mixin
 */
export const UtilsMixin = {
    /**
     * 颜色线性插值
     */
    _lerpColor(c1, c2, t) {
        return {
            r: Math.round(c1.r * (1 - t) + c2.r * t),
            g: Math.round(c1.g * (1 - t) + c2.g * t),
            b: Math.round(c1.b * (1 - t) + c2.b * t),
        };
    },
    
    /**
     * 计算颜色的众色（mode）
     */
    _getModeColor(colors) {
        if (!colors || colors.length === 0) return { r: 255, g: 255, b: 255 };
        if (colors.length === 1) return colors[0] || { r: 255, g: 255, b: 255 };
        
        const buckets = {};
        colors.forEach(c => {
            if (!c) return;
            const key = `${Math.floor(c.r / 16)}_${Math.floor(c.g / 16)}_${Math.floor(c.b / 16)}`;
            if (!buckets[key]) buckets[key] = [];
            buckets[key].push(c);
        });
        
        let maxBucket = null;
        let maxCount = 0;
        for (const key in buckets) {
            if (buckets[key].length > maxCount) {
                maxCount = buckets[key].length;
                maxBucket = buckets[key];
            }
        }
        
        if (maxBucket && maxCount > colors.length / 2) {
            return this._avgColorSimple(maxBucket);
        }
        
        const withLuminance = colors.filter(c => c).map(c => ({
            ...c,
            lum: c.r * 0.299 + c.g * 0.587 + c.b * 0.114
        }));
        
        if (withLuminance.length <= 2) {
            return this._avgColorSimple(colors);
        }
        
        withLuminance.sort((a, b) => a.lum - b.lum);
        const trimCount = Math.max(1, Math.floor(withLuminance.length * 0.2));
        const trimmed = withLuminance.slice(trimCount, -trimCount);
        
        if (trimmed.length === 0) {
            return this._avgColorSimple(colors);
        }
        
        return this._avgColorSimple(trimmed);
    },
    
    /**
     * 简单平均颜色
     */
    _avgColorSimple(colors) {
        if (!colors || colors.length === 0) return { r: 255, g: 255, b: 255 };
        const sum = colors.reduce((acc, c) => ({
            r: acc.r + (c?.r || 255),
            g: acc.g + (c?.g || 255),
            b: acc.b + (c?.b || 255)
        }), { r: 0, g: 0, b: 0 });
        return {
            r: Math.round(sum.r / colors.length),
            g: Math.round(sum.g / colors.length),
            b: Math.round(sum.b / colors.length),
        };
    },
    
    /**
     * 平均颜色（带异常点过滤）
     */
    _avgColor(colors) {
        return this._getModeColor(colors);
    },

    /**
     * 将颜色转换为十六进制格式
     */
    _toHexColor(color) {
        if (!color) return '#000000';
        if (color.startsWith('#')) return color;
        
        const rgbMatch = color.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
        if (rgbMatch) {
            const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
            const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
            const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
            return `#${r}${g}${b}`;
        }
        
        return color;
    },

    /**
     * 点是否在矩形内
     */
    _pointInRect(px, py, rx, ry, rw, rh) {
        return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
    },

    /**
     * 解析路径 d 属性，提取坐标点用于边界框计算
     */
    _getPathBounds(d) {
        const coords = [];
        const numRegex = /[-+]?[\d.]+/g;
        const nums = d.match(numRegex) || [];
        
        for (let i = 0; i < nums.length - 1; i += 2) {
            coords.push({
                x: parseFloat(nums[i]),
                y: parseFloat(nums[i + 1])
            });
        }
        
        if (coords.length === 0) return null;
        
        const xs = coords.map(c => c.x);
        const ys = coords.map(c => c.y);
        
        return {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys)
        };
    },
    
    /**
     * 检查 bounds1 是否完全包含 bounds2
     */
    _boundsContains(outer, inner) {
        if (!outer || !inner) return false;
        return outer.minX <= inner.minX && 
               outer.maxX >= inner.maxX && 
               outer.minY <= inner.minY && 
               outer.maxY >= inner.maxY;
    },
    
    /**
     * 将子路径按包含关系分组（保留孔洞）
     */
    _groupPathsByContainment(subPaths) {
        if (subPaths.length <= 1) return [subPaths];
        
        const pathsWithBounds = subPaths.map((d, idx) => ({
            d: d.trim(),
            bounds: this._getPathBounds(d),
            idx
        }));
        
        pathsWithBounds.sort((a, b) => {
            if (!a.bounds || !b.bounds) return 0;
            const areaA = (a.bounds.maxX - a.bounds.minX) * (a.bounds.maxY - a.bounds.minY);
            const areaB = (b.bounds.maxX - b.bounds.minX) * (b.bounds.maxY - b.bounds.minY);
            return areaB - areaA;
        });
        
        const groups = [];
        const assigned = new Set();
        
        for (let i = 0; i < pathsWithBounds.length; i++) {
            if (assigned.has(i)) continue;
            
            const outer = pathsWithBounds[i];
            const group = [outer.d];
            assigned.add(i);
            
            for (let j = i + 1; j < pathsWithBounds.length; j++) {
                if (assigned.has(j)) continue;
                
                const inner = pathsWithBounds[j];
                if (this._boundsContains(outer.bounds, inner.bounds)) {
                    group.push(inner.d);
                    assigned.add(j);
                }
            }
            
            groups.push(group);
        }
        
        return groups;
    },
    
    /**
     * 统计 SVG 中可炸开的独立形状数量
     */
    _countPaths(svg) {
        if (!svg) return 0;
        
        const pathElements = svg.match(/<path/g) || [];
        
        if (pathElements.length === 1) {
            const dMatch = svg.match(/\bd="([^"]+)"/);
            if (dMatch) {
                const d = dMatch[1];
                const subPathRegex = /M[^M]+/gi;
                const subPaths = d.match(subPathRegex) || [];
                
                if (subPaths.length > 1) {
                    const groups = this._groupPathsByContainment(subPaths);
                    return groups.length;
                }
                return subPaths.length;
            }
        }
        
        return pathElements.length;
    },

    /**
     * 获取预设列表
     */
    _getPresets() {
        return {
            'logo': 'Logo / 图标',
            'illustration': '插画',
            'lineart': '线稿',
            'photo': '照片',
            'pixel': '像素化',
            'simple': '简化'
        };
    },

    /**
     * 重新生成图层 SVG
     */
    _regenerateLayerSvg(layer) {
        if (!layer.paths || layer.paths.length === 0) return '';
        
        const viewBoxMatch = layer.svg?.match(/viewBox="([^"]+)"/);
        const sizeMatch = layer.svg?.match(/width="(\d+)" height="(\d+)"/);
        
        const viewBox = viewBoxMatch ? viewBoxMatch[1] : '0 0 100 100';
        const width = sizeMatch ? sizeMatch[1] : '100';
        const height = sizeMatch ? sizeMatch[2] : '100';
        
        const pathsStr = layer.paths.map(p => {
            const fillRule = p.fillRule ? ` fill-rule="${p.fillRule}"` : '';
            return `<path d="${p.d}" fill="${p.fill}"${fillRule} stroke="${p.stroke || 'none'}" stroke-width="${p.strokeWidth || 0}"/>`;
        }).join('\n');
        
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">\n${pathsStr}\n</svg>`;
    },

    /**
     * 合并多个矢量图层为一个 SVG
     */
    _mergeVectorLayers(layers) {
        if (layers.length === 0) return null;
        
        const firstSvg = layers[0].svg;
        const widthMatch = firstSvg.match(/width="([^"]+)"/);
        const heightMatch = firstSvg.match(/height="([^"]+)"/);
        const viewBoxMatch = firstSvg.match(/viewBox="([^"]+)"/);
        
        const width = widthMatch ? widthMatch[1] : this.canvas.width;
        const height = heightMatch ? heightMatch[1] : this.canvas.height;
        const viewBox = viewBoxMatch ? viewBoxMatch[1] : `0 0 ${width} ${height}`;
        
        const allPaths = [];
        for (const layer of layers) {
            if (!layer.svg) continue;
            const pathMatches = layer.svg.match(/<path[^>]*\/?>(?:<\/path>)?/g);
            if (pathMatches) {
                allPaths.push(...pathMatches);
            }
        }
        
        return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}">
${allPaths.join('\n')}
</svg>`;
    },

    /**
     * 自动检测图片类型，选择合适的矢量化预设
     */
    _detectPreset(imageObj) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const sampleSize = Math.min(100, imageObj.width, imageObj.height);
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        ctx.drawImage(imageObj.element, 0, 0, sampleSize, sampleSize);
        
        const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
        const data = imageData.data;
        
        const colorSet = new Set();
        for (let i = 0; i < data.length; i += 4) {
            const r = Math.floor(data[i] / 32);
            const g = Math.floor(data[i + 1] / 32);
            const b = Math.floor(data[i + 2] / 32);
            colorSet.add(`${r},${g},${b}`);
        }
        
        const uniqueColors = colorSet.size;
        console.log(`[LayerEditor] 检测到约 ${uniqueColors} 种颜色（粗量化）`);
        
        if (uniqueColors <= 8) {
            return 'lineart';
        } else if (uniqueColors <= 24) {
            return 'logo';
        } else {
            return 'illustration';
        }
    },

    /**
     * 获取图层缩略图内容
     */
    _getLayerThumbnail(layer) {
        switch (layer.type) {
            case 'original':
                return `<iconify-icon icon="carbon:image"></iconify-icon>`;
            case 'vector':
                return layer.color 
                    ? `<div style="width:100%;height:100%;background:${layer.color};border-radius:2px;"></div>`
                    : `<iconify-icon icon="carbon:bezier-curve"></iconify-icon>`;
            case 'group':
                return `<iconify-icon icon="carbon:folder"></iconify-icon>`;
            case 'text-overlay':
                return `<iconify-icon icon="carbon:text-font"></iconify-icon>`;
            default:
                return `<iconify-icon icon="carbon:layers"></iconify-icon>`;
        }
    },

    /**
     * 切换图层可见性
     */
    _toggleLayerVisibility(index) {
        const layer = this.processedImage.layers[index];
        layer.visible = !layer.visible;
        this._updateLayerList();
        this._render();
    },

    /**
     * 高亮显示选中的图层
     */
    _highlightSelectedLayer() {
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        
        // 移除旧的高亮
        const oldHighlight = svgContainer.querySelector('.layer-highlight');
        if (oldHighlight) oldHighlight.remove();
        
        if (this.selectedLayerIndex < 0) return;
        
        const layer = this.processedImage.layers[this.selectedLayerIndex];
        if (!layer) return;
        
        // 如果是文字覆盖组的子图层
        if (layer.type === 'group' && layer.textOverlayConfig && this.selectedChildIndex >= 0) {
            const child = layer.children?.[this.selectedChildIndex];
            if (child && child.bbox) {
                const imgWidth = this.canvas.width;
                const imgHeight = this.canvas.height;
                
                const x = child.bbox.left * imgWidth;
                const y = child.bbox.top * imgHeight;
                const w = child.bbox.width * imgWidth;
                const h = child.bbox.height * imgHeight;
                
                const highlight = document.createElement('div');
                highlight.className = 'layer-highlight';
                highlight.style.cssText = `
                    position: absolute;
                    left: ${x}px;
                    top: ${y}px;
                    width: ${w}px;
                    height: ${h}px;
                    border: 2px solid #4f46e5;
                    pointer-events: none;
                    z-index: 50;
                `;
                svgContainer.appendChild(highlight);
            }
        }
    },

    /**
     * 检测点击位置与 bbox 的关系
     */
    _hitTestBbox(pos, layer) {
        if (!layer.bbox) return null;
        
        const imgWidth = this.canvas.width;
        const imgHeight = this.canvas.height;
        
        const x = layer.bbox.left * imgWidth;
        const y = layer.bbox.top * imgHeight;
        const w = layer.bbox.width * imgWidth;
        const h = layer.bbox.height * imgHeight;
        
        const handleSize = 8;
        const half = handleSize / 2;
        
        // 检查8个调整手柄
        const handles = [
            { type: 'nw', cx: x, cy: y },
            { type: 'n', cx: x + w/2, cy: y },
            { type: 'ne', cx: x + w, cy: y },
            { type: 'w', cx: x, cy: y + h/2 },
            { type: 'e', cx: x + w, cy: y + h/2 },
            { type: 'sw', cx: x, cy: y + h },
            { type: 's', cx: x + w/2, cy: y + h },
            { type: 'se', cx: x + w, cy: y + h }
        ];
        
        for (const handle of handles) {
            if (Math.abs(pos.x - handle.cx) <= half + 2 && Math.abs(pos.y - handle.cy) <= half + 2) {
                return { type: 'resize', handle: handle.type, layer };
            }
        }
        
        // 检查是否在 bbox 内部
        if (pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h) {
            return { type: 'move', layer };
        }
        
        return null;
    },

    /**
     * 绘制调整手柄
     */
    _drawResizeHandles(x, y, w, h) {
        const size = 6;
        const half = size / 2;
        
        this.ctx.fillStyle = '#fff';
        this.ctx.strokeStyle = '#4f46e5';
        this.ctx.lineWidth = 1;
        
        const handles = [
            [x - half, y - half],
            [x + w/2 - half, y - half],
            [x + w - half, y - half],
            [x - half, y + h/2 - half],
            [x + w - half, y + h/2 - half],
            [x - half, y + h - half],
            [x + w/2 - half, y + h - half],
            [x + w - half, y + h - half]
        ];
        
        for (const [hx, hy] of handles) {
            this.ctx.fillRect(hx, hy, size, size);
            this.ctx.strokeRect(hx, hy, size, size);
        }
    },

    /**
     * 文字换行辅助函数
     */
    _wrapTextForRender(text, maxWidth) {
        if (!text) return [];
        
        const lines = [];
        const paragraphs = text.split('\n');
        
        for (const paragraph of paragraphs) {
            if (!paragraph.trim()) {
                lines.push('');
                continue;
            }
            
            let currentLine = '';
            const chars = paragraph.split('');
            
            for (const char of chars) {
                const testLine = currentLine + char;
                const metrics = this.ctx.measureText(testLine);
                
                if (metrics.width > maxWidth && currentLine.length > 0) {
                    lines.push(currentLine);
                    currentLine = char;
                } else {
                    currentLine = testLine;
                }
            }
            
            if (currentLine) {
                lines.push(currentLine);
            }
        }
        
        return lines;
    },

    /**
     * 获取当前选中的子图层
     */
    _getSelectedChildLayer() {
        if (this.selectedLayerIndex < 0 || this.selectedChildIndex < 0) return null;
        const layer = this.processedImage.layers[this.selectedLayerIndex];
        if (!layer || !layer.children) return null;
        return layer.children[this.selectedChildIndex] || null;
    },

    /**
     * 渲染文字覆盖到指定 Context
     */
    _renderTextOverlayToContext(ctx, region, imgWidth, imgHeight) {
        const { bbox, content, style } = region;
        
        const x = bbox.left * imgWidth;
        const y = bbox.top * imgHeight;
        const w = bbox.width * imgWidth;
        const h = bbox.height * imgHeight;
        
        const displayText = content?.displayText || content?.originalText || '';
        if (!displayText) return;
        
        const fontSize = style?.fontSize || 14;
        const fontFamily = style?.fontFamily || '"Noto Sans CJK SC", "Microsoft YaHei", Arial, sans-serif';
        const color = style?.color || '#000000';
        const textAlign = style?.textAlign || 'left';
        
        ctx.save();
        ctx.font = `${fontSize}px ${fontFamily}`;
        ctx.fillStyle = color;
        ctx.textAlign = textAlign;
        ctx.textBaseline = 'top';
        
        const lineHeight = fontSize * 1.3;
        const padding = fontSize * 0.1;
        const maxTextWidth = w - padding * 2;
        
        // 自动换行
        const lines = [];
        const paragraphs = displayText.split('\n');
        for (const paragraph of paragraphs) {
            if (!paragraph.trim()) {
                lines.push('');
                continue;
            }
            let currentLine = '';
            for (const char of paragraph) {
                const testLine = currentLine + char;
                if (ctx.measureText(testLine).width > maxTextWidth && currentLine.length > 0) {
                    lines.push(currentLine);
                    currentLine = char;
                } else {
                    currentLine = testLine;
                }
            }
            if (currentLine) lines.push(currentLine);
        }
        
        // 计算起始 Y 位置（垂直居中）
        const totalHeight = lines.length * lineHeight;
        let startY = y + (h - totalHeight) / 2;
        
        // 绘制文字
        for (let i = 0; i < lines.length; i++) {
            let textX;
            if (textAlign === 'center') {
                textX = x + w / 2;
            } else if (textAlign === 'right') {
                textX = x + w - padding;
            } else {
                textX = x + padding;
            }
            
            ctx.fillText(lines[i], textX, startY + i * lineHeight);
        }
        
        ctx.restore();
    }
};
