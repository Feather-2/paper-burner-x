/**
 * 右键菜单模块
 */

class ContextMenu {
    constructor(editor) {
        this.editor = editor;
        this.menuElement = null;
        this.currentElement = null;
        
        this._createMenu();
        this._bindEvents();
    }

    _createMenu() {
        this.menuElement = document.createElement('div');
        this.menuElement.className = 'editor-context-menu';
        this.menuElement.innerHTML = `
            <div class="context-menu-item" data-action="edit">
                <iconify-icon icon="carbon:edit" class="menu-icon"></iconify-icon>
                <span>编辑</span>
            </div>
            <div class="context-menu-item" data-action="copy">
                <iconify-icon icon="carbon:copy" class="menu-icon"></iconify-icon>
                <span>复制</span>
                <span class="menu-shortcut">Ctrl+C</span>
            </div>
            <div class="context-menu-item" data-action="paste">
                <iconify-icon icon="carbon:paste" class="menu-icon"></iconify-icon>
                <span>粘贴</span>
                <span class="menu-shortcut">Ctrl+V</span>
            </div>
            <div class="context-menu-item" data-action="delete">
                <iconify-icon icon="carbon:trash-can" class="menu-icon"></iconify-icon>
                <span>删除</span>
                <span class="menu-shortcut">Del</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-group-title" data-type="image">图片处理</div>
            <div class="context-menu-item ai-gen" data-action="ai-generate" data-type="image">
                <iconify-icon icon="carbon:magic-wand" class="menu-icon"></iconify-icon>
                <span>AI 生图</span>
            </div>
            <div class="context-menu-item primary" data-action="edit-image" data-type="image">
                <iconify-icon icon="carbon:image-search" class="menu-icon"></iconify-icon>
                <span>智能编辑图片</span>
                <iconify-icon icon="carbon:arrow-right" style="margin-left:auto; opacity:0.5;"></iconify-icon>
            </div>
            <div class="context-menu-item" data-action="revert-original" data-type="editable-image">
                <iconify-icon icon="carbon:reset" class="menu-icon"></iconify-icon>
                <span>回退到原图</span>
            </div>
            <div class="context-menu-item" data-action="remove-bg" data-type="image">
                <iconify-icon icon="carbon:subtract-alt" class="menu-icon"></iconify-icon>
                <span>去除背景</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="bring-front">
                <iconify-icon icon="carbon:bring-to-front" class="menu-icon"></iconify-icon>
                <span>置于顶层</span>
            </div>
            <div class="context-menu-item" data-action="send-back">
                <iconify-icon icon="carbon:send-to-back" class="menu-icon"></iconify-icon>
                <span>置于底层</span>
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item" data-action="group" data-type="multi">
                <iconify-icon icon="carbon:group-objects" class="menu-icon"></iconify-icon>
                <span>编组</span>
                <span class="menu-shortcut">Ctrl+G</span>
            </div>
            <div class="context-menu-item" data-action="ungroup" data-type="group">
                <iconify-icon icon="carbon:ungroup-objects" class="menu-icon"></iconify-icon>
                <span>解组</span>
                <span class="menu-shortcut">Ctrl+Shift+G</span>
            </div>
            <div class="context-menu-item" data-action="enter-group" data-type="group">
                <iconify-icon icon="carbon:enter" class="menu-icon"></iconify-icon>
                <span>进入编辑组</span>
            </div>
        `;
        this.menuElement.style.display = 'none';
        document.body.appendChild(this.menuElement);

        // 注入样式
        this._injectStyles();
    }

    _injectStyles() {
        if (document.getElementById('context-menu-styles')) return;

        const style = document.createElement('style');
        style.id = 'context-menu-styles';
        style.textContent = `
            .editor-context-menu {
                position: fixed;
                z-index: 10001;
                min-width: 180px;
                background: #ffffff;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
                box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04);
                padding: 6px;
                font-family: system-ui, -apple-system, sans-serif;
            }
            .context-menu-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 14px;
                color: #374151;
                font-size: 13px;
                cursor: pointer;
                border-radius: 8px;
                transition: all 0.15s;
            }
            .context-menu-item:hover {
                background: #f3f4f6;
                color: #111827;
            }
            .context-menu-item.primary:hover {
                background: #eef2ff;
                color: #4f46e5;
            }
            .context-menu-item.ai-gen {
                background: linear-gradient(135deg, #f5f3ff, #eef2ff);
                color: #7c3aed;
            }
            .context-menu-item.ai-gen:hover {
                background: linear-gradient(135deg, #ede9fe, #e0e7ff);
                color: #6d28d9;
            }
            .context-menu-item.disabled {
                opacity: 0.4;
                pointer-events: none;
            }
            .context-menu-item .menu-icon {
                width: 18px;
                height: 18px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
            }
            .context-menu-item .menu-shortcut {
                margin-left: auto;
                color: #9ca3af;
                font-size: 11px;
            }
            .context-menu-divider {
                height: 1px;
                background: #e5e7eb;
                margin: 6px 4px;
            }
            .context-menu-group-title {
                padding: 6px 14px 4px;
                font-size: 11px;
                font-weight: 600;
                color: #9ca3af;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
        `;
        document.head.appendChild(style);
    }

    _bindEvents() {
        // 菜单项点击
        this.menuElement.addEventListener('click', (e) => {
            const item = e.target.closest('.context-menu-item');
            if (item && !item.classList.contains('disabled')) {
                const action = item.dataset.action;
                this._executeAction(action);
            }
            this.hide();
        });

        // 点击其他地方关闭
        document.addEventListener('click', (e) => {
            if (!this.menuElement.contains(e.target)) {
                this.hide();
            }
        });

        // ESC 关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.hide();
            }
        });
    }

    /**
     * 显示菜单
     */
    show(x, y, element) {
        this.currentElement = element;

        // 图片或可编辑的 SVG（有原图可回退，或有 layers 可继续编辑）
        const isImage = element?.type === 'image';
        const isEditableSvg = element?.type === 'svg' && (element?.originalAssetId || element?.editParams?.layers);
        const canEditImage = isImage || isEditableSvg;

        // 显示图片编辑菜单
        this.menuElement.querySelectorAll('[data-type="image"]').forEach(item => {
            item.style.display = canEditImage ? '' : 'none';
        });

        // "回退到原图"只在有编辑历史时显示
        const hasEditHistory = element?.originalAssetId &&
            (element?.editHistory?.length > 0 || element?.type === 'svg');
        this.menuElement.querySelectorAll('[data-type="editable-image"]').forEach(item => {
            item.style.display = hasEditHistory ? '' : 'none';
        });
        
        // 隐藏图片处理前的分割线（如果不是图片）
        const dividers = this.menuElement.querySelectorAll('.context-menu-divider');
        if (dividers[1]) {
            dividers[1].style.display = (canEditImage || hasEditHistory) ? '' : 'none';
        }

        // 编组/解组菜单项显示逻辑
        const selectedCount = this.editor.selection.getSelectedIds().length;
        const isGroup = element?.type === 'group';
        
        // 编组：需要选中多个元素
        this.menuElement.querySelectorAll('[data-type="multi"]').forEach(item => {
            item.style.display = selectedCount >= 2 ? '' : 'none';
        });
        
        // 解组/进入编辑组：需要选中一个组
        this.menuElement.querySelectorAll('[data-type="group"]').forEach(item => {
            item.style.display = isGroup ? '' : 'none';
        });

        // 定位
        this.menuElement.style.left = `${x}px`;
        this.menuElement.style.top = `${y}px`;
        this.menuElement.style.display = 'block';

        // 确保不超出屏幕
        const rect = this.menuElement.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            this.menuElement.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            this.menuElement.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    }

    hide() {
        this.menuElement.style.display = 'none';
        this.currentElement = null;
    }

    async _executeAction(action) {
        const element = this.currentElement;
        if (!element && ['edit', 'edit-image', 'revert-original', 'vectorize', 'ocr', 'remove-bg', 'delete'].includes(action)) {
            return;
        }

        switch (action) {
            case 'edit':
                this.editor.emit('element:dblclick', { element });
                break;

            case 'edit-image':
                await this._openImageEditor(element);
                break;

            case 'revert-original':
                await this._revertToOriginal(element);
                break;

            case 'ai-generate':
                this._triggerAiGenerate(element);
                break;

            case 'vectorize':
                await this._vectorizeImage(element);
                break;

            case 'ocr':
                await this._ocrImage(element);
                break;

            case 'remove-bg':
                await this._removeBackground(element);
                break;

            case 'copy':
                this.editor.copySelected?.();
                break;

            case 'paste':
                this.editor.paste?.();
                break;

            case 'delete':
                this.editor.deleteElement?.(element.id);
                break;

            case 'bring-front':
                this.editor.bringToFront?.(element.id);
                break;

            case 'send-back':
                this.editor.sendToBack?.(element.id);
                break;

            case 'group':
                this.editor.groupElements?.();
                break;

            case 'ungroup':
                this.editor.ungroupElements?.();
                break;

            case 'enter-group':
                this.editor.enterGroupEditMode?.(element.id);
                break;
        }
    }

    async _revertToOriginal(element) {
        if (!element?.originalAssetId) {
            alert('该元素没有原始版本');
            return false;
        }

        if (typeof this.editor.revertImageToOriginal !== 'function') {
            alert('回退功能未加载');
            return false;
        }

        const confirmed = confirm('确定要回退到原始图片吗？所有编辑将丢失。');
        if (!confirmed) return false;

        // 合并为一个撤销步骤
        this.editor.history?.beginBatch?.('回退到原图');

        try {
            const success = await this.editor.revertImageToOriginal?.(element.id);
            if (!success) {
                this.editor.history?.cancelBatch?.();
                return false;
            }

            // 如果是 SVG，回退后需要恢复为 image 元素（否则渲染仍走 SVG content）
            const docElement = this.editor?.document?.getElementById?.(element.id);
            if (docElement?.type === 'svg') {
                const oldValues = {
                    type: docElement.type,
                    content: docElement.content,
                    svg: docElement.svg,
                    preview: docElement.preview,
                };

                const updates = {
                    type: 'image',
                    content: docElement.src,
                    svg: null,
                    preview: null,
                };

                this.editor?.document?.updateElement?.(element.id, updates);
                this.editor.history?.push?.({
                    type: 'element.update',
                    elementId: element.id,
                    slideIndex: this.editor.currentSlideIndex,
                    timestamp: Date.now(),
                    changes: [
                        { path: 'type', oldValue: oldValues.type, newValue: updates.type },
                        { path: 'content', oldValue: oldValues.content, newValue: updates.content },
                        { path: 'svg', oldValue: oldValues.svg, newValue: updates.svg },
                        { path: 'preview', oldValue: oldValues.preview, newValue: updates.preview },
                    ],
                });

                this.editor.renderCurrentSlide?.();
            }

            this.editor.history?.commitBatch?.();
            console.log('[ContextMenu] 已回退到原图');
            return true;
        } catch (e) {
            console.warn('[ContextMenu] 回退到原图失败:', e);
            this.editor.history?.cancelBatch?.();
            return false;
        }
    }

    async _openImageEditor(element) {
        // 懒加载 ImageProcessor
        await this._ensureImageProcessor();
        if (!window.imageProcessor) return;

        // 获取图片 DOM
        const elementDom = document.querySelector(`[data-element-id="${element.id}"]`);
        const imgElement = elementDom?.querySelector('img');

        // 获取图片源：优先从 <img> 标签获取，其次从元素数据获取
        // 如果是 SVG，使用原图或 preview 进行编辑
        let imgSrc = imgElement?.src || element?.src || element?.preview;
        if (element?.type === 'svg') {
            if (element?.originalAssetId) {
                // 从原图重新加载
                const storageManager = window.storageManager;
                if (storageManager?.getAssetUrl) {
                    try {
                        imgSrc = await storageManager.getAssetUrl(element.originalAssetId);
                    } catch (e) {
                        console.warn('[ContextMenu] 获取原图失败，回退到预览:', e);
                        imgSrc = element?.preview || imgSrc;
                    }
                }
            } else if (element?.preview) {
                // 无原图但有 preview，使用 preview
                imgSrc = element.preview;
            }
        }
        if (!imgSrc) {
            console.warn('[ContextMenu] 图片元素没有图片源:', element.id);
            alert('该图片没有设置图片源，请先添加图片');
            return;
        }

        // 如果 DOM 中没有 <img>，创建一个临时的带 src 的对象传给编辑器
        // 同时传递 editParams 用于恢复图层状态
        const editorElement = imgElement
            ? { src: imgElement.src, dataset: imgElement.dataset, editParams: element?.editParams }
            : { src: imgSrc, dataset: {}, editParams: element?.editParams };

        // 打开编辑器
        await window.imageProcessor.openEditor(editorElement, async (result) => {
            if (result.type === 'svg' && result.svg) {
                // 矢量结果：替换为 SVG 元素，同时保存 layers 用于继续编辑
                this._replaceWithSvg(element.id, result.svg, result.dataUrl, result.layers);
                return;
            }

            // 栅格结果：持久化并更新引用
            try {
                const operation = 'edit-image';
                const params = {};

                const saved = await window.imageProcessor.saveProcessedImage(
                    { dataUrl: result.dataUrl },
                    element.id,
                    operation,
                    params
                );

                if (saved?.assetId) {
                    this._updateElementImage(element.id, saved.url || result.dataUrl, {
                        assetId: saved.assetId,
                        operation,
                        params
                    });
                } else {
                    this._updateElementImage(element.id, result.dataUrl);
                }
            } catch (e) {
                console.warn('[ContextMenu] 图片保存失败，使用临时结果:', e);
                this._updateElementImage(element.id, result.dataUrl);
            }
        });
    }
    
    /**
     * 将图片元素替换为 SVG
     */
    _replaceWithSvg(elementId, svgString, previewDataUrl, layers) {
        const processedSvg = (typeof svgString === 'string' ? svgString : '').replace(
            /<svg\b([^>]*)>/i,
            (match, attrs) => {
                const widthMatch = attrs.match(/\bwidth\s*=\s*["']([^"']*)["']/i);
                const heightMatch = attrs.match(/\bheight\s*=\s*["']([^"']*)["']/i);

                let newAttrs = attrs
                    .replace(/\s*width\s*=\s*["'][^"']*["']/gi, '')
                    .replace(/\s*height\s*=\s*["'][^"']*["']/gi, '');

                // 如果缺少 viewBox，则尝试用原始 width/height 补一个（让 viewBox 控制比例）
                if (!/\bviewBox\s*=/i.test(newAttrs) && widthMatch && heightMatch) {
                    const w = parseFloat(widthMatch[1]);
                    const h = parseFloat(heightMatch[1]);
                    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
                        newAttrs += ` viewBox="0 0 ${w} ${h}"`;
                    }
                }

                // 确保有 preserveAspectRatio
                if (!/\bpreserveAspectRatio\s*=/i.test(newAttrs)) {
                    newAttrs += ' preserveAspectRatio="xMidYMid meet"';
                }

                return `<svg${newAttrs}>`;
            }
        );

        const updates = {
            type: 'svg',
            svg: processedSvg,
            content: processedSvg,
            preview: previewDataUrl
        };

        // 保存 layers 数据用于继续编辑
        if (layers && layers.length > 0) {
            updates.editParams = { layers };
        }

        // 更新 slides 数据
        const slide = window.PPTGenerator?.slides?.[this.editor.currentSlideIndex];
        const element = slide?.elements?.find(el => el.id === elementId);
        if (element) {
            // 保留原有位置和尺寸
            const { x, y, w, h } = element;

            // 如果原始元素有 assetId，保存为 originalAssetId 以便二次编辑时能从原图开始
            if (element.assetId && !element.originalAssetId) {
                updates.originalAssetId = element.assetId;
            }

            // 保存 SVG 内容
            Object.assign(element, { x, y, w, h, ...updates });
        }

        // 【关键】同步到 document（解决 bug 2 和 3）
        try {
            this.editor?.document?.updateElement?.(elementId, updates);
        } catch (e) {
            console.warn('[ContextMenu] 同步 SVG 到 document 失败:', e);
        }

        // 【关键】重新渲染当前 slide（解决 bug 1）
        // 不要直接操作 DOM，让渲染器统一处理
        this.editor.renderCurrentSlide?.();

        // 标记为已修改
        this.editor.history?.markDirty?.();
        this.editor.emit('element:update', { elementId, type: 'svg' });

        console.log('[ContextMenu] 图片已转换为 SVG 矢量图');
    }

    async _vectorizeImage(element) {
        await this._ensureImageProcessor();
        if (!window.imageProcessor) return;

        const imgSrc = element.src || element.content;
        const vectorizer = await window.imageProcessor.loadModule('vectorizer');
        const imageObj = await window.imageProcessor._loadImage(imgSrc);
        
        // 使用 auto 模式自动分析图片
        const result = await vectorizer.vectorize(imageObj, 'auto');

        console.log('[ContextMenu] 矢量化完成:', result);
        alert('矢量化完成！查看控制台获取 SVG 结果');
    }

    async _ocrImage(element) {
        await this._ensureImageProcessor();
        if (!window.imageProcessor) return;

        const imgSrc = element.src || element.content;
        const ocrExtractor = await window.imageProcessor.loadModule('ocrExtractor');
        const imageObj = await window.imageProcessor._loadImage(imgSrc);
        const result = await ocrExtractor.extract(imageObj);

        console.log('[ContextMenu] OCR 完成:', result);
        // TODO: 显示识别结果
    }

    async _removeBackground(element) {
        await this._ensureImageProcessor();
        if (!window.imageProcessor) return;

        const imgSrc = element.src || element.content;
        const bgRemover = await window.imageProcessor.loadModule('bgRemover');
        const imageObj = await window.imageProcessor._loadImage(imgSrc);
        const result = await bgRemover.remove(imageObj);

        // 导出并更新
        const dataUrl = await bgRemover.exportAsPng(result.foreground);
        this._updateElementImage(element.id, dataUrl);
    }

    /**
     * 确保 ImageProcessor 已加载
     */
    _ensureImageProcessor() {
        return new Promise((resolve) => {
            if (window.imageProcessor) {
                resolve();
                return;
            }

            // 避免重复加载
            if (window.__pptEditorImageProcessorLoading) {
                window.__pptEditorImageProcessorLoading.then(resolve).catch(() => resolve());
                return;
            }

            window.__pptEditorImageProcessorLoading = new Promise((res) => {
                const script = document.createElement('script');
                // ImageProcessor 已迁移为 ESM 子入口
                script.type = 'module';
                script.src = 'js/ppt/editor/image-processor/index.js';
                script.onload = () => {
                    console.log('[ContextMenu] ImageProcessor 加载完成');
                    res();
                };
                script.onerror = () => {
                    console.error('[ContextMenu] ImageProcessor 加载失败');
                    res();
                };
                document.head.appendChild(script);
            });

            window.__pptEditorImageProcessorLoading.then(resolve).catch(() => resolve());
        });
    }

    async _updateElementImage(elementId, dataUrl, options = {}) {
        const slide = window.PPTGenerator?.slides?.[this.editor.currentSlideIndex];
        const element = slide?.elements?.find(el => el.id === elementId);
        if (!element) return;

        // 如果有新的 assetId，更新引用
        if (options.assetId) {
            const oldAssetId = element.assetId;
            element.assetId = options.assetId;

            // 更新编辑历史
            if (!element.editHistory) element.editHistory = [];
            element.editHistory.push({
                assetId: options.assetId,
                timestamp: Date.now(),
                operation: options.operation || 'edit',
                params: options.params || {}
            });

            // 补齐 originalAssetId（兼容旧数据）
            if (!element.originalAssetId) {
                element.originalAssetId = oldAssetId || options.assetId;
            }

            console.log('[ContextMenu] 更新 assetId:', oldAssetId, '->', options.assetId);
        }

        // 更新显示
        element.src = dataUrl;
        element.content = dataUrl;

        // 同步到 document（用于项目保存）
        try {
            this.editor?.document?.updateElement?.(elementId, {
                assetId: element.assetId,
                originalAssetId: element.originalAssetId,
                editHistory: element.editHistory,
                src: dataUrl,
                content: dataUrl
            });
        } catch (e) {
            console.warn('[ContextMenu] 同步到 document 失败:', e);
        }

        // 更新 DOM
        const elementDom = document.querySelector(`[data-element-id="${elementId}"]`);
        const img = elementDom?.querySelector('img');
        if (img) {
            img.src = dataUrl;
        }

        // 标记已修改
        this.editor.history?.markDirty?.();
    }

    /**
     * 触发 AI 生图
     */
    _triggerAiGenerate(element) {
        if (!element || element.type !== 'image') return;
        
        // 调用 PPTGenerator 的 AI 生图方法
        if (window.PPTGenerator?._aiGenerateImage) {
            window.PPTGenerator._aiGenerateImage(element);
        } else {
            alert('AI 生图功能未加载');
        }
    }
}

// 导出到全局
window.ContextMenu = ContextMenu;

// ESM 导出
export { ContextMenu };
