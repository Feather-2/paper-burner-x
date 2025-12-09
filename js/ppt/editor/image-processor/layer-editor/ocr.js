/**
 * LayerEditor OCR 模块
 * 从 layer-editor.legacy.js 完整复制的 OCR 相关方法
 */

export const OcrMixin = {
    /**
     * 检查 VLM 是否可用
     */
    _checkVlmAvailable() {
        try {
            if (window.aiApiService) {
                const models = window.aiApiService.getAvailableModels();
                return models.length > 0;
            }
            return false;
        } catch {
            return false;
        }
    },

    /**
     * 显示 OCR 设置对话框（仅 VLM + 定位方案选择）
     */
    _showOcrEngineSelector() {
        return new Promise((resolve) => {
            const vlmAvailable = this._checkVlmAvailable();
            
            if (!vlmAvailable) {
                alert('请先配置 AI 视觉模型（在高级设置中添加支持视觉的 AI 模型）');
                resolve(null);
                return;
            }
            
            // 获取当前定位模式
            const currentLocMode = window.ocrExtractor?.config?.vlmLocalizationMode || 'grid';
            
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            `;
            
            overlay.innerHTML = `
                <div style="
                    background: var(--ie-surface, #fff);
                    border-radius: 12px;
                    padding: 24px;
                    min-width: 360px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                ">
                    <h3 style="margin: 0 0 8px; color: var(--ie-text, #1e293b); font-size: 16px; font-weight: 600;">
                        🤖 AI 文字识别
                    </h3>
                    <p style="margin: 0 0 16px; font-size: 13px; color: var(--ie-text-secondary, #64748b);">
                        使用 AI 视觉模型识别图片中的文字
                    </p>
                    
                    <div style="margin-bottom: 16px;">
                        <div style="font-size: 13px; font-weight: 500; margin-bottom: 8px; color: var(--ie-text, #1e293b);">
                            定位方案
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--ie-border, #e2e8f0); border-radius: 8px; cursor: pointer; transition: all 0.2s;" class="loc-option ${currentLocMode === 'grid' ? 'selected' : ''}">
                                <input type="radio" name="locMode" value="grid" ${currentLocMode === 'grid' ? 'checked' : ''} style="margin-top: 2px;">
                                <div>
                                    <div style="font-weight: 500; font-size: 13px;">网格辅助 (推荐)</div>
                                    <div style="font-size: 11px; color: var(--ie-text-secondary, #64748b);">叠加参考网格帮助 AI 定位</div>
                                </div>
                            </label>
                            <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--ie-border, #e2e8f0); border-radius: 8px; cursor: pointer; transition: all 0.2s;" class="loc-option ${currentLocMode === 'native' ? 'selected' : ''}">
                                <input type="radio" name="locMode" value="native" ${currentLocMode === 'native' ? 'checked' : ''} style="margin-top: 2px;">
                                <div>
                                    <div style="font-weight: 500; font-size: 13px;">原生 Grounding</div>
                                    <div style="font-size: 11px; color: var(--ie-text-secondary, #64748b);">使用模型内置定位能力 (Qwen-VL 等)</div>
                                </div>
                            </label>
                            <label style="display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--ie-border, #e2e8f0); border-radius: 8px; cursor: pointer; transition: all 0.2s;" class="loc-option ${currentLocMode === 'auto' ? 'selected' : ''}">
                                <input type="radio" name="locMode" value="auto" ${currentLocMode === 'auto' ? 'checked' : ''} style="margin-top: 2px;">
                                <div>
                                    <div style="font-weight: 500; font-size: 13px;">自动检测</div>
                                    <div style="font-size: 11px; color: var(--ie-text-secondary, #64748b);">根据模型能力自动选择</div>
                                </div>
                            </label>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 8px;">
                        <button class="cancel-btn" style="
                            flex: 1;
                            padding: 10px;
                            border: 1px solid var(--ie-border, #e2e8f0);
                            border-radius: 6px;
                            background: transparent;
                            color: var(--ie-text-secondary, #64748b);
                            cursor: pointer;
                            font-size: 13px;
                        ">取消</button>
                        <button class="start-btn" style="
                            flex: 2;
                            padding: 10px;
                            border: none;
                            border-radius: 6px;
                            background: var(--ie-primary, #4f46e5);
                            color: white;
                            cursor: pointer;
                            font-size: 13px;
                            font-weight: 500;
                        ">开始识别</button>
                    </div>
                </div>
            `;
            
            // 高亮选中的选项
            overlay.querySelectorAll('.loc-option').forEach(label => {
                label.addEventListener('click', () => {
                    overlay.querySelectorAll('.loc-option').forEach(l => {
                        l.style.borderColor = 'var(--ie-border, #e2e8f0)';
                        l.style.background = 'transparent';
                    });
                    label.style.borderColor = 'var(--ie-primary, #4f46e5)';
                    label.style.background = 'rgba(79, 70, 229, 0.05)';
                });
            });
            
            // 初始化选中状态
            const selectedLabel = overlay.querySelector('.loc-option.selected');
            if (selectedLabel) {
                selectedLabel.style.borderColor = 'var(--ie-primary, #4f46e5)';
                selectedLabel.style.background = 'rgba(79, 70, 229, 0.05)';
            }
            
            overlay.querySelector('.start-btn').addEventListener('click', () => {
                const selectedMode = overlay.querySelector('input[name="locMode"]:checked')?.value || 'grid';
                // 保存定位模式设置
                if (window.ocrExtractor) {
                    window.ocrExtractor.config = window.ocrExtractor.config || {};
                    window.ocrExtractor.config.vlmLocalizationMode = selectedMode;
                }
                document.body.removeChild(overlay);
                resolve('vlm');
            });
            
            overlay.querySelector('.cancel-btn').addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(null);
            });
            
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    document.body.removeChild(overlay);
                    resolve(null);
                }
            });
            
            document.body.appendChild(overlay);
        });
    },

    /**
     * 运行 OCR 识别
     */
    async _runOcr() {
        const engine = await this._showOcrEngineSelector();
        if (!engine) return;
        
        // 如果是 VLM 且使用网格辅助模式，显示网格预览
        const locMode = window.ocrExtractor?.config?.vlmLocalizationMode || 'grid';
        if (engine === 'vlm' && locMode === 'grid') {
            this._showOcrGridOverlay(true, '正在使用 AI 识别文字...');
        } else {
            this._showLoading(engine === 'vlm' ? '正在使用 AI 识别文字...' : '正在识别文字...');
        }
        await this._nextFrame();
        
        try {
            const ocrExtractor = await this.processor.loadModule('ocrExtractor');
            const result = await ocrExtractor.extract(this.processedImage.original, { priority: engine });
            
            console.log('[LayerEditor] OCR 结果:', result);
            console.log('[LayerEditor] 原图尺寸:', this.processedImage.original.width, 'x', this.processedImage.original.height);
            console.log('[LayerEditor] Canvas 尺寸:', this.canvas.width, 'x', this.canvas.height);
            
            // 从 raw 响应中重新解析原始坐标
            let rawRegions = [];
            if (result.raw) {
                try {
                    let jsonStr = result.raw;
                    
                    // GLM-4V 特殊标记处理
                    jsonStr = jsonStr.replace(/<\|begin_of_box\|>/g, '');
                    jsonStr = jsonStr.replace(/<\|end_of_box\|>/g, '');
                    
                    // Markdown 代码块提取
                    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
                    if (jsonMatch) {
                        jsonStr = jsonMatch[1].trim();
                    } else {
                        // 提取 JSON 对象
                        const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
                        if (braceMatch) jsonStr = braceMatch[0];
                    }
                    
                    // 修复常见格式错误
                    jsonStr = jsonStr.replace(/"bbox_2d":\s*\[\[/g, '"bbox_2d":[');
                    jsonStr = jsonStr.replace(/"bbox":\s*\[\[/g, '"bbox":[');
                    
                    const parsed = JSON.parse(jsonStr);
                    rawRegions = Array.isArray(parsed) ? parsed : (parsed.regions || parsed.texts || []);
                    console.log('[LayerEditor] 从 raw 解析到', rawRegions.length, '个原始区域');
                } catch (e) {
                    console.warn('[LayerEditor] 解析 raw 失败:', e);
                }
            }
            
            const regions = (result.regions && result.regions.length > 0) ? result.regions : rawRegions;
            
            if (regions.length === 0) {
                alert('未识别到文字区域');
                return;
            }
            
            console.log(`[LayerEditor] OCR 识别到 ${regions.length} 个文字区域`);
            
            // 创建文字覆盖组
            const groupId = `text_group_${Date.now()}`;
            const groupLayer = {
                id: groupId,
                type: 'group',
                name: `文字识别 (${regions.length} 区域)`,
                visible: true,
                textOverlayConfig: {
                    engine: result.engine,
                    processedAt: Date.now(),
                },
                children: [],
                inpaintedBackground: null,
            };
            
            // 确定坐标系统
            let gridX = 10, gridY = 10;
            if (rawRegions.length > 0) {
                const maxX = Math.max(...rawRegions.filter(r => r.x2).map(r => r.x2));
                const maxY = Math.max(...rawRegions.filter(r => r.y2).map(r => r.y2));
                
                if (maxX > 50) {
                    gridX = 100; gridY = 100;
                    console.log('[LayerEditor] 检测到百分比坐标 (0-100)');
                } else if (maxX > 10) {
                    gridX = Math.ceil(maxX); gridY = Math.ceil(maxY);
                    console.log('[LayerEditor] 使用动态网格:', gridX, 'x', gridY);
                } else {
                    console.log('[LayerEditor] 使用标准 10x10 网格');
                }
            }
            
            // 显示红框预览
            if (this.container.querySelector('.ocr-grid-overlay') && rawRegions.length > 0) {
                this._updateOcrGridBboxes(rawRegions, gridX, gridY);
                await new Promise(r => setTimeout(r, 1500));
            }
            
            const imgWidth = this.processedImage.original.width;
            const imgHeight = this.processedImage.original.height;
            
            rawRegions.forEach((rawRegion, idx) => {
                const text = rawRegion.text || rawRegion.text_content || '';
                if (!text.trim()) return;
                
                let bbox = null;
                
                // 格式1: bbox_2d 数组
                if (Array.isArray(rawRegion.bbox_2d) && rawRegion.bbox_2d.length === 4) {
                    const [rx1, ry1, rx2, ry2] = rawRegion.bbox_2d;
                    const maxVal = Math.max(rx1, ry1, rx2, ry2);
                    let x1, y1, x2, y2;
                    
                    if (maxVal > 1000) {
                        x1 = rx1 / imgWidth; y1 = ry1 / imgHeight;
                        x2 = rx2 / imgWidth; y2 = ry2 / imgHeight;
                        console.log(`[LayerEditor] bbox_2d 像素坐标:`, rawRegion.bbox_2d, `/ ${imgWidth}x${imgHeight}`);
                    } else {
                        x1 = rx1 / 1000; y1 = ry1 / 1000;
                        x2 = rx2 / 1000; y2 = ry2 / 1000;
                    }
                    bbox = {
                        left: Math.max(0, Math.min(1, x1)),
                        top: Math.max(0, Math.min(1, y1)),
                        width: Math.max(0.01, Math.min(1, x2 - x1)),
                        height: Math.max(0.01, Math.min(1, y2 - y1))
                    };
                    console.log(`[LayerEditor] 转换 bbox_2d:`, rawRegion.bbox_2d, '→', bbox);
                }
                // 格式2: x1, y1, x2, y2 独立字段
                else if ('x1' in rawRegion && 'y1' in rawRegion && 'x2' in rawRegion && 'y2' in rawRegion) {
                    const x1 = rawRegion.x1 / gridX;
                    const y1 = rawRegion.y1 / gridY;
                    const x2 = rawRegion.x2 / gridX;
                    const y2 = rawRegion.y2 / gridY;
                    bbox = {
                        left: Math.max(0, Math.min(1, x1)),
                        top: Math.max(0, Math.min(1, y1)),
                        width: Math.max(0.01, Math.min(1, x2 - x1)),
                        height: Math.max(0.01, Math.min(1, y2 - y1))
                    };
                    console.log(`[LayerEditor] 转换网格坐标 (${gridX}x${gridY}):`, `(${rawRegion.x1},${rawRegion.y1})-(${rawRegion.x2},${rawRegion.y2})`, '→', bbox);
                }
                // 格式3: bbox 数组 [x1, y1, x2, y2]
                // GLM-4V 使用 0-1000 归一化坐标
                else if (Array.isArray(rawRegion.bbox) && rawRegion.bbox.length === 4) {
                    const [rx1, ry1, rx2, ry2] = rawRegion.bbox;
                    const maxVal = Math.max(rx1, ry1, rx2, ry2);
                    const imgW = this.processedImage.original.width;
                    const imgH = this.processedImage.original.height;
                    let x1, y1, x2, y2;
                    
                    if (maxVal > 1000) {
                        // 像素坐标（大于 1000）
                        x1 = rx1 / imgW; y1 = ry1 / imgH;
                        x2 = rx2 / imgW; y2 = ry2 / imgH;
                        console.log(`[LayerEditor] bbox 像素坐标:`, rawRegion.bbox, `/ ${imgW}x${imgH}`);
                    } else if (maxVal > 100) {
                        // 0-1000 归一化（GLM-4V 标准格式）
                        x1 = rx1 / 1000; y1 = ry1 / 1000;
                        x2 = rx2 / 1000; y2 = ry2 / 1000;
                        console.log(`[LayerEditor] bbox 0-1000 归一化:`, rawRegion.bbox, `→ (${x1.toFixed(3)},${y1.toFixed(3)})-(${x2.toFixed(3)},${y2.toFixed(3)})`);
                    } else if (maxVal > 1) {
                        // 0-100 百分比
                        x1 = rx1 / 100; y1 = ry1 / 100;
                        x2 = rx2 / 100; y2 = ry2 / 100;
                        console.log(`[LayerEditor] bbox 百分比:`, rawRegion.bbox);
                    } else {
                        // 已经是 0-1 归一化
                        x1 = rx1; y1 = ry1;
                        x2 = rx2; y2 = ry2;
                        console.log(`[LayerEditor] bbox 已归一化:`, rawRegion.bbox);
                    }
                    
                    bbox = {
                        left: Math.max(0, Math.min(1, x1)),
                        top: Math.max(0, Math.min(1, y1)),
                        width: Math.max(0.01, Math.min(1, x2 - x1)),
                        height: Math.max(0.01, Math.min(1, y2 - y1))
                    };
                    console.log(`[LayerEditor] 最终 bbox:`, bbox);
                }
                else {
                    console.warn(`[LayerEditor] 区域 ${idx} 无有效坐标，跳过:`, rawRegion);
                    return;
                }
                
                const childLayer = {
                    id: `text_region_${idx}_${Date.now()}`,
                    type: 'text-overlay',
                    name: `文字: ${text.substring(0, 12)}${text.length > 12 ? '...' : ''}`,
                    bbox: bbox,
                    originalBbox: { ...bbox },
                    // 简化属性（供自动估算字号使用）
                    text: text,
                    translatedText: '',
                    // 完整内容对象
                    content: {
                        originalText: text,
                        translatedText: '',
                        displayText: text,
                    },
                    style: {
                        fontSize: 14, // 初始值，稍后自动估算
                        color: rawRegion.color || '#000000',
                        fontWeight: rawRegion.fontWeight || 'normal',
                        textAlign: rawRegion.textAlign || 'left',
                    },
                    inpainted: false,
                    visible: true,
                    parentId: groupId,
                };
                groupLayer.children.push(childLayer);
            });
            
            // 自动估算每个区域的字号
            groupLayer.children.forEach(child => {
                this._autoEstimateFontSize(child);
            });
            
            this.processedImage.layers.push(groupLayer);
            this._textOverlayGroup = groupLayer;
            
            this._saveHistory();
            this._updateLayerList();
            this._render();
            
            const newLayerIndex = this.processedImage.layers.length - 1;
            this.selectedLayerIndex = newLayerIndex;
            this._updateLayerList();
            this._updatePropertyPanel();
            
            this._showTextOverlayActions();
            
        } catch (err) {
            console.error('[LayerEditor] OCR 失败:', err);
            alert('文字识别失败: ' + err.message);
        } finally {
            this._hideLoading();
            this._showOcrGridOverlay(false);
        }
    },

    /**
     * 显示/隐藏 OCR 网格预览覆盖层
     */
    _showOcrGridOverlay(show, message = '') {
        const canvasWrap = this.container.querySelector('.image-editor-canvas-wrap');
        let overlay = canvasWrap.querySelector('.ocr-grid-overlay');
        
        if (!show) {
            overlay?.remove();
            return;
        }
        
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'ocr-grid-overlay';
            overlay.style.cssText = `
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 100;
            `;
            canvasWrap.appendChild(overlay);
        }
        
        const gridX = 10, gridY = 10;
        
        let gridLines = '';
        for (let i = 0; i <= gridX; i++) {
            const x = (i / gridX) * 100;
            gridLines += `<line x1="${x}%" y1="0" x2="${x}%" y2="100%" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>`;
            if (i < gridX) {
                gridLines += `<text x="${x + 5}%" y="3%" fill="white" font-size="12" opacity="0.7">${i + 1}</text>`;
            }
        }
        for (let i = 0; i <= gridY; i++) {
            const y = (i / gridY) * 100;
            gridLines += `<line x1="0" y1="${y}%" x2="100%" y2="${y}%" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>`;
            if (i < gridY) {
                gridLines += `<text x="1%" y="${y + 5}%" fill="white" font-size="12" opacity="0.7">${i + 1}</text>`;
            }
        }
        
        overlay.innerHTML = `
            <svg width="100%" height="100%" style="position:absolute;inset:0;">
                ${gridLines}
            </svg>
            <div style="
                position: absolute;
                top: 10px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.8);
                color: white;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 13px;
                display: flex;
                align-items: center;
                gap: 8px;
            ">
                <div class="ocr-spinner" style="
                    width: 16px;
                    height: 16px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-top-color: white;
                    border-radius: 50%;
                    animation: ie-spin 1s linear infinite;
                "></div>
                VLM OCR 识别中... (${gridX}x${gridY} 参考网格)
            </div>
            <div style="
                position: absolute;
                bottom: 10px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.6);
                color: rgba(255,255,255,0.8);
                padding: 4px 12px;
                border-radius: 4px;
                font-size: 11px;
            ">
                X轴刻度 0-${gridX}，Y轴刻度 0-${gridY}，精度 0.1
            </div>
        `;
        
        if (!document.querySelector('#ie-spin-style')) {
            const style = document.createElement('style');
            style.id = 'ie-spin-style';
            style.textContent = '@keyframes ie-spin { to { transform: rotate(360deg); } }';
            document.head.appendChild(style);
        }
    },

    /**
     * 更新 OCR 网格覆盖层的 bbox 显示
     */
    _updateOcrGridBboxes(regions, gridX = 10, gridY = 10) {
        const overlay = this.container.querySelector('.ocr-grid-overlay');
        if (!overlay) return;
        
        let bboxSvg = '';
        regions.forEach((region, idx) => {
            let left, top, width, height;
            
            if ('x1' in region && 'y1' in region) {
                left = (region.x1 / gridX) * 100;
                top = (region.y1 / gridY) * 100;
                width = ((region.x2 - region.x1) / gridX) * 100;
                height = ((region.y2 - region.y1) / gridY) * 100;
            } else if (Array.isArray(region.bbox_2d) && region.bbox_2d.length === 4) {
                const [x1, y1, x2, y2] = region.bbox_2d;
                const maxVal = Math.max(x1, y1, x2, y2);
                if (maxVal > 1000) {
                    const imgWidth = this.canvas.width;
                    const imgHeight = this.canvas.height;
                    left = (x1 / imgWidth) * 100;
                    top = (y1 / imgHeight) * 100;
                    width = ((x2 - x1) / imgWidth) * 100;
                    height = ((y2 - y1) / imgHeight) * 100;
                } else {
                    left = x1 / 10;
                    top = y1 / 10;
                    width = (x2 - x1) / 10;
                    height = (y2 - y1) / 10;
                }
            } else if (Array.isArray(region.bbox) && region.bbox.length === 4) {
                // bbox 数组 [x1, y1, x2, y2]，GLM-4V 使用 0-1000 归一化
                const [x1, y1, x2, y2] = region.bbox;
                const maxVal = Math.max(x1, y1, x2, y2);
                if (maxVal > 1000) {
                    const imgWidth = this.canvas.width;
                    const imgHeight = this.canvas.height;
                    left = (x1 / imgWidth) * 100;
                    top = (y1 / imgHeight) * 100;
                    width = ((x2 - x1) / imgWidth) * 100;
                    height = ((y2 - y1) / imgHeight) * 100;
                } else if (maxVal > 100) {
                    // 0-1000 归一化
                    left = x1 / 10;
                    top = y1 / 10;
                    width = (x2 - x1) / 10;
                    height = (y2 - y1) / 10;
                } else {
                    // 0-100 百分比
                    left = x1;
                    top = y1;
                    width = x2 - x1;
                    height = y2 - y1;
                }
            } else if (region.bbox && typeof region.bbox === 'object') {
                // bbox 对象 { left, top, width, height }
                left = region.bbox.left * 100;
                top = region.bbox.top * 100;
                width = region.bbox.width * 100;
                height = region.bbox.height * 100;
            } else {
                return;
            }
            
            bboxSvg += `
                <rect x="${left}%" y="${top}%" width="${width}%" height="${height}%"
                    fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="5,3"/>
            `;
        });
        
        let svg = overlay.querySelector('svg');
        if (svg) {
            const oldBboxGroup = svg.querySelector('.ocr-bboxes');
            if (oldBboxGroup) oldBboxGroup.remove();
            
            const bboxGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            bboxGroup.classList.add('ocr-bboxes');
            bboxGroup.innerHTML = bboxSvg;
            svg.appendChild(bboxGroup);
        }
        
        const msgDiv = overlay.querySelector('div[style*="top: 10px"]');
        if (msgDiv) {
            msgDiv.innerHTML = `
                <iconify-icon icon="carbon:checkmark" style="color:#22c55e;font-size:18px;"></iconify-icon>
                识别完成，找到 ${regions.length} 个文字区域
            `;
        }
    },

    /**
     * 显示文字覆盖操作提示
     */
    _showTextOverlayActions() {
        console.log('[LayerEditor] 文字识别完成，可进行以下操作：');
        console.log('  - 点击文字区域编辑内容');
        console.log('  - 使用 "去除原文字" 进行 Inpainting');
        console.log('  - 翻译文字后显示新文字');
    },

    /**
     * 对选中的文字区域进行 Inpainting
     */
    async _inpaintTextRegion(regionId, groupId) {
        const group = this.processedImage.layers.find(l => l.id === groupId);
        if (!group || !group.children) return;
        
        const region = group.children.find(c => c.id === regionId);
        if (!region || region.inpainted) return;
        
        this._showLoading('正在去除原文字...');
        
        try {
            if (!group.inpaintedBackground) {
                const canvas = document.createElement('canvas');
                canvas.width = this.processedImage.original.width;
                canvas.height = this.processedImage.original.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(this.processedImage.original.element, 0, 0);
                group.inpaintedBackground = { canvas, ctx };
            }
            
            const { ctx, canvas } = group.inpaintedBackground;
            const imgWidth = canvas.width;
            const imgHeight = canvas.height;
            
            // 使用当前 bbox（用户可能已调整），而不是 originalBbox
            const bbox = region.bbox;
            
            // 精确按 bbox 清除，不向外扩展（避免采集到边框颜色）
            const x = Math.floor(bbox.left * imgWidth);
            const y = Math.floor(bbox.top * imgHeight);
            const w = Math.ceil(bbox.width * imgWidth);
            const h = Math.ceil(bbox.height * imgHeight);
            
            await this._performInpainting(ctx, x, y, w, h, this.processedImage.original.imageData);
            
            region.inpainted = true;
            
            this._saveHistory();
            this._render();
            
        } catch (err) {
            console.error('[LayerEditor] Inpainting 失败:', err);
        } finally {
            this._hideLoading();
        }
    },

    /**
     * 对所有文字区域进行 Inpainting
     */
    async _inpaintAllTextRegions(groupId) {
        const group = this.processedImage.layers.find(l => l.id === groupId);
        if (!group || !group.children) return;
        
        this._showLoading('正在去除所有原文字...');
        
        for (const region of group.children) {
            if (!region.inpainted) {
                await this._inpaintTextRegion(region.id, groupId);
            }
        }
        
        this._hideLoading();
    },

    /**
     * 执行 Inpainting - 直接在边缘采样 + 选取亮色填充
     */
    async _performInpainting(ctx, x, y, w, h, srcImageData) {
        const imgWidth = srcImageData.width;
        const imgHeight = srcImageData.height;
        const srcData = srcImageData.data;
        
        const getPixel = (px, py) => {
            if (px < 0 || px >= imgWidth || py < 0 || py >= imgHeight) return null;
            const idx = (py * imgWidth + px) * 4;
            if (idx < 0 || idx >= srcData.length - 2) return null;
            return { r: srcData[idx], g: srcData[idx+1], b: srcData[idx+2] };
        };
        
        // 收集四条边上的所有像素
        const allEdgePixels = [];
        
        // 上边和下边
        for (let i = 0; i < w; i++) {
            const top = getPixel(x + i, y);
            const bottom = getPixel(x + i, y + h - 1);
            if (top) allEdgePixels.push(top);
            if (bottom) allEdgePixels.push(bottom);
        }
        
        // 左边和右边
        for (let j = 0; j < h; j++) {
            const left = getPixel(x, y + j);
            const right = getPixel(x + w - 1, y + j);
            if (left) allEdgePixels.push(left);
            if (right) allEdgePixels.push(right);
        }
        
        // 选取最亮的像素作为填充色
        const fillColor = this._avgColor(allEdgePixels);
        
        // 为每个边缘位置准备颜色（用于渐变，但这里简化为统一填充）
        const topEdge = new Array(w).fill(fillColor);
        const bottomEdge = new Array(w).fill(fillColor);
        const leftEdge = new Array(h).fill(fillColor);
        const rightEdge = new Array(h).fill(fillColor);
        const cornerColor = fillColor;
        
        const tempImageData = ctx.getImageData(x, y, w, h);
        const tempData = tempImageData.data;
        
        for (let j = 0; j < h; j++) {
            for (let i = 0; i < w; i++) {
                const tx = i / Math.max(1, w - 1);
                const ty = j / Math.max(1, h - 1);
                
                const leftColor = leftEdge[j] || cornerColor;
                const rightColor = rightEdge[j] || cornerColor;
                const hColor = this._lerpColor(leftColor, rightColor, tx);
                
                const topColor = topEdge[i] || cornerColor;
                const bottomColor = bottomEdge[i] || cornerColor;
                const vColor = this._lerpColor(topColor, bottomColor, ty);
                
                const edgeWeight = Math.min(tx, 1 - tx, ty, 1 - ty) * 4;
                const centerWeight = Math.max(0, 1 - edgeWeight);
                
                const colors = [hColor, vColor];
                if (centerWeight > 0.3) {
                    colors.push(cornerColor);
                }
                const finalColor = this._avgColorSimple(colors);
                
                const idx = (j * w + i) * 4;
                tempData[idx] = finalColor.r;
                tempData[idx + 1] = finalColor.g;
                tempData[idx + 2] = finalColor.b;
                tempData[idx + 3] = 255;
            }
        }
        
        ctx.putImageData(tempImageData, x, y);
    },

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
     * 计算边缘颜色 - 选取较亮的那部分像素平均（排除深色文字）
     */
    _avgColor(colors) {
        if (!colors || colors.length === 0) return { r: 255, g: 255, b: 255 };
        
        // 计算每个颜色的亮度
        const withLuminance = colors.filter(c => c).map(c => ({
            ...c,
            lum: c.r * 0.299 + c.g * 0.587 + c.b * 0.114
        }));
        
        if (withLuminance.length === 0) return { r: 255, g: 255, b: 255 };
        if (withLuminance.length === 1) return withLuminance[0];
        
        // 按亮度排序（从亮到暗）
        withLuminance.sort((a, b) => b.lum - a.lum);
        
        // 选取较亮的前 50%（排除深色的文字像素）
        const halfCount = Math.max(3, Math.ceil(withLuminance.length * 0.5));
        const brightHalf = withLuminance.slice(0, halfCount);
        
        // 返回这些较亮像素的平均值
        return this._avgColorSimple(brightHalf);
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
     * 更新文字区域内容
     */
    updateTextRegionContent(regionId, groupId, newText, isTranslation = false) {
        const group = this.processedImage.layers.find(l => l.id === groupId);
        if (!group || !group.children) return;
        
        const region = group.children.find(c => c.id === regionId);
        if (!region) return;
        
        if (isTranslation) {
            region.content.translatedText = newText;
            region.content.displayText = newText;
        } else {
            region.content.originalText = newText;
            if (!region.content.translatedText) {
                region.content.displayText = newText;
            }
        }
        
        region.name = `文字: ${region.content.displayText.substring(0, 12)}${region.content.displayText.length > 12 ? '...' : ''}`;
        
        this._saveHistory();
        this._updateLayerList();
        this._render();
    },

    /**
     * 批量翻译文字区域
     */
    async translateTextRegions(groupId, translateFn) {
        const group = this.processedImage.layers.find(l => l.id === groupId);
        if (!group || !group.children) return;
        
        this._showLoading('正在翻译文字...');
        
        try {
            for (const region of group.children) {
                if (region.content && region.content.originalText) {
                    try {
                        const translated = await translateFn(region.content.originalText);
                        region.content.translatedText = translated;
                        region.content.displayText = translated;
                        region.name = `文字: ${translated.substring(0, 12)}${translated.length > 12 ? '...' : ''}`;
                    } catch (e) {
                        console.warn(`[LayerEditor] 翻译失败: ${region.id}`, e);
                    }
                }
            }
            
            this._saveHistory();
            this._updateLayerList();
            this._render();
        } finally {
            this._hideLoading();
        }
    },

    /**
     * 显示持久化参考网格
     */
    _showPersistentGrid(layer) {
        const canvasWrap = this.container.querySelector('.image-editor-canvas-wrap');
        let overlay = canvasWrap.querySelector('.ocr-grid-overlay');
        
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'ocr-grid-overlay';
            overlay.style.cssText = `
                position: absolute;
                inset: 0;
                pointer-events: none;
                z-index: 100;
            `;
            canvasWrap.appendChild(overlay);
        }
        
        const gridX = 10, gridY = 10;
        
        let gridLines = '';
        for (let i = 0; i <= gridX; i++) {
            const x = (i / gridX) * 100;
            gridLines += `<line x1="${x}%" y1="0" x2="${x}%" y2="100%" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>`;
            if (i > 0 && i < gridX) {
                gridLines += `<text x="${x - 0.5}%" y="2.5%" fill="rgba(255,255,255,0.6)" font-size="11">${i}</text>`;
            }
        }
        for (let i = 0; i <= gridY; i++) {
            const y = (i / gridY) * 100;
            gridLines += `<line x1="0" y1="${y}%" x2="100%" y2="${y}%" stroke="rgba(255,255,255,0.3)" stroke-width="1"/>`;
            if (i > 0 && i < gridY) {
                gridLines += `<text x="0.5%" y="${y + 2}%" fill="rgba(255,255,255,0.6)" font-size="11">${i}</text>`;
            }
        }
        
        let bboxSvg = '';
        if (layer.children) {
            layer.children.forEach(child => {
                if (child.type !== 'text-overlay' || !child.bbox) return;
                const left = child.bbox.left * 100;
                const top = child.bbox.top * 100;
                const width = child.bbox.width * 100;
                const height = child.bbox.height * 100;
                bboxSvg += `<rect x="${left}%" y="${top}%" width="${width}%" height="${height}%"
                    fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="5,3"/>`;
            });
        }
        
        overlay.innerHTML = `
            <svg width="100%" height="100%" style="position:absolute;inset:0;">
                ${gridLines}
                <g class="ocr-bboxes">${bboxSvg}</g>
            </svg>
            <div style="
                position: absolute;
                bottom: 10px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.6);
                color: rgba(255,255,255,0.8);
                padding: 4px 12px;
                border-radius: 4px;
                font-size: 11px;
            ">
                ${layer.children?.length || 0} 个文字区域 · ${gridX}×${gridY} 参考网格
            </div>
        `;
    },

    /**
     * 隐藏持久化参考网格
     */
    _hidePersistentGrid() {
        const overlay = this.container.querySelector('.ocr-grid-overlay');
        overlay?.remove();
    }
};
