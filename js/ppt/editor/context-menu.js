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
            <div class="context-menu-item primary" data-action="edit-image" data-type="image">
                <iconify-icon icon="carbon:image-search" class="menu-icon"></iconify-icon>
                <span>智能编辑图片</span>
                <iconify-icon icon="carbon:arrow-right" style="margin-left:auto; opacity:0.5;"></iconify-icon>
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

        // 根据元素类型显示/隐藏图片相关菜单项
        const isImage = element?.type === 'image';
        this.menuElement.querySelectorAll('[data-type="image"]').forEach(item => {
            item.style.display = isImage ? '' : 'none';
        });
        
        // 隐藏图片处理前的分割线（如果不是图片）
        const dividers = this.menuElement.querySelectorAll('.context-menu-divider');
        if (dividers[1]) {
            dividers[1].style.display = isImage ? '' : 'none';
        }

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
        if (!element && ['edit', 'edit-image', 'vectorize', 'ocr', 'remove-bg', 'delete'].includes(action)) {
            return;
        }

        switch (action) {
            case 'edit':
                this.editor.emit('element:dblclick', { element });
                break;

            case 'edit-image':
                await this._openImageEditor(element);
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
        }
    }

    async _openImageEditor(element) {
        // 懒加载 ImageProcessor
        await this._ensureImageProcessor();
        if (!window.imageProcessor) return;

        // 获取图片 DOM
        const elementDom = document.querySelector(`[data-element-id="${element.id}"]`);
        const imgElement = elementDom?.querySelector('img') || elementDom;

        // 打开编辑器
        await window.imageProcessor.openEditor(imgElement, (result) => {
            if (result.type === 'svg' && result.svg) {
                // 矢量结果：替换为 SVG 元素
                this._replaceWithSvg(element.id, result.svg, result.dataUrl);
            } else {
                // 栅格结果：更新图片
                this._updateElementImage(element.id, result.dataUrl);
            }
        });
    }
    
    /**
     * 将图片元素替换为 SVG
     */
    _replaceWithSvg(elementId, svgString, previewDataUrl) {
        // 更新 slides 数据
        const slide = window.PPTGenerator?.slides?.[this.editor.currentSlideIndex];
        const element = slide?.elements?.find(el => el.id === elementId);
        if (element) {
            // 保存 SVG 内容
            element.type = 'svg';
            element.svg = svgString;
            element.content = svgString;
            element.preview = previewDataUrl; // 保留预览图
        }

        // 更新 DOM：替换为 SVG
        const elementDom = document.querySelector(`[data-element-id="${elementId}"]`);
        if (elementDom) {
            const img = elementDom.querySelector('img');
            if (img) {
                // 创建 SVG 容器
                const svgContainer = document.createElement('div');
                svgContainer.innerHTML = svgString;
                const svgElement = svgContainer.querySelector('svg');
                if (svgElement) {
                    svgElement.style.width = '100%';
                    svgElement.style.height = '100%';
                    img.replaceWith(svgElement);
                }
            }
        }

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

            const script = document.createElement('script');
            script.src = 'js/ppt/editor/image-processor/index.js';
            script.onload = () => {
                console.log('[ContextMenu] ImageProcessor 加载完成');
                resolve();
            };
            script.onerror = () => {
                console.error('[ContextMenu] ImageProcessor 加载失败');
                resolve();
            };
            document.head.appendChild(script);
        });
    }

    _updateElementImage(elementId, dataUrl) {
        // 更新 slides 数据
        const slide = window.PPTGenerator?.slides?.[this.editor.currentSlideIndex];
        const element = slide?.elements?.find(el => el.id === elementId);
        if (element) {
            element.src = dataUrl;
            element.content = dataUrl;
        }

        // 更新 DOM
        const elementDom = document.querySelector(`[data-element-id="${elementId}"]`);
        const img = elementDom?.querySelector('img');
        if (img) {
            img.src = dataUrl;
        }

        // 标记为已修改
        this.editor.history?.markDirty?.();
        this.editor.emit('element:update', { elementId });
    }
}

// 导出到全局
window.ContextMenu = ContextMenu;
