/**
 * LayerEditor SAM 分割模块
 * - 本地模式：SAM3 ONNX（需用户下载模型到 models/sam3/）
 * - 在线模式：SlimSAM（自动降级）
 * - 背景修复：LaMa Inpainting
 */

// 动态导入 samSegmenter
let _samSegmenter = null;
async function getSamSegmenter() {
    if (_samSegmenter) return _samSegmenter;

    // 优先检查全局对象（如果已经加载过）
    if (window.samSegmenter) {
        _samSegmenter = window.samSegmenter;
        return _samSegmenter;
    }

    // 动态加载脚本
    const scriptPath = 'js/ppt/editor/image-processor/sam-segmenter.js';

    try {
        // 尝试 ES module import
        const module = await import('/' + scriptPath);
        _samSegmenter = module.default || window.samSegmenter;
        return _samSegmenter;
    } catch (e) {
        console.warn('[SamMixin] ES import 失败，尝试 script 标签:', e);
    }

    // 回退：使用 script 标签加载
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.type = 'module';
        script.src = scriptPath;
        script.onload = () => {
            if (window.samSegmenter) {
                _samSegmenter = window.samSegmenter;
                resolve(_samSegmenter);
            } else {
                reject(new Error('sam-segmenter.js 加载后未找到 samSegmenter'));
            }
        };
        script.onerror = () => reject(new Error('加载 sam-segmenter.js 失败'));
        document.head.appendChild(script);
    });
}

// 动态导入 lamaInpainter
let _lamaInpainter = null;
async function getLamaInpainter() {
    if (_lamaInpainter) return _lamaInpainter;

    if (window.lamaInpainter) {
        _lamaInpainter = window.lamaInpainter;
        return _lamaInpainter;
    }

    const scriptPath = 'js/ppt/editor/image-processor/lama-inpainter.js';

    try {
        const module = await import('/' + scriptPath);
        _lamaInpainter = module.default || window.lamaInpainter;
        return _lamaInpainter;
    } catch (e) {
        console.warn('[SamMixin] LaMa ES import 失败，尝试 script 标签:', e);
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.type = 'module';
        script.src = scriptPath;
        script.onload = () => {
            if (window.lamaInpainter) {
                _lamaInpainter = window.lamaInpainter;
                resolve(_lamaInpainter);
            } else {
                reject(new Error('lama-inpainter.js 加载后未找到 lamaInpainter'));
            }
        };
        script.onerror = () => reject(new Error('加载 lama-inpainter.js 失败'));
        document.head.appendChild(script);
    });
}

export const SamMixin = {
    /**
     * 初始化 SAM 分割模式
     */
    async _initSamMode() {
        // 选择分割方式
        const mode = await this._showSamModeSelector();
        if (!mode) return; // 用户取消

        console.log('[SamMixin] 选择模式:', mode);
        this.samSegmentMode = mode; // 'point' | 'box' | 'auto' | 'brush'

        // 退出已有模式，避免事件/状态冲突
        if (this.brushMode) {
            this._exitBrushMode();
        }
        if (this.samMode) {
            this._exitSamMode();
        }

        // brush 模式不需要加载 SAM
        if (mode !== 'brush') {
            // 显示加载提示
            this._showLoading('正在加载 AI 分割模块...');

            // 让 UI 有机会更新
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        }

        try {
            if (mode === 'brush') {
                this._showToast('涂抹要去除的区域，完成后点击"应用"');
                try {
                    this._initBrushMode();
                } catch (error) {
                    console.error('[SamMixin] 画笔模式初始化失败:', error);
                    this._showToast('画笔模式初始化失败: ' + (error?.message || error));
                } finally {
                    this._hideLoading();
                }
                return;
            }

            console.log('[SamMixin] 加载 sam-segmenter...');
            const segmenter = await getSamSegmenter();

            // 设置降级回调：当本地模型不可用时提示用户
            let usedFallback = false;
            segmenter._onFallback = () => {
                usedFallback = true;
            };

            console.log('[SamMixin] sam-segmenter 加载成功');

            // 让 UI 更新
            await new Promise(r => requestAnimationFrame(r));

            console.log('[SamMixin] 初始化模型...');
            await segmenter.init((message, percent) => {
                console.log(`[SamMixin] 进度: ${message} (${percent}%)`);
                this._showLoading(`${message} (${percent}%)`);
            });

            this._hideLoading();

            // 显示使用的模型信息
            if (segmenter.useLocalModel) {
                this._showToast('使用本地 SAM3 模型（高精度）', 3000);
            } else if (usedFallback) {
                this._showSamFallbackNotice();
            }

            // 进入 SAM 模式
            this.samMode = true;
            this.samPoints = [];
            this.samLabels = [];
            this.samBox = null;

            // 根据模式处理
            if (mode === 'auto') {
                // 自动分割模式：直接执行
                await this._runAutoSegmentation();
            } else {
                // 更新 UI
                this._updateSamModeUI(true);

                // 绑定事件
                if (mode === 'point') {
                    this._showToast('点击图片添加分割点（左键=前景，右键=背景）');
                    this._bindSamClickEvents();
                } else {
                    this._showToast('拖动鼠标框选要分割的区域');
                    this._bindSamBoxEvents();
                }
            }

        } catch (error) {
            this._hideLoading();
            console.error('[SamMixin] SAM 初始化失败:', error);
            this._showToast('AI 模型加载失败: ' + (error.message || error));
        }
    },

    /**
     * 显示分割方式选择对话框
     */
    _showSamModeSelector() {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.className = 'sam-mode-selector-overlay';
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
                <div class="sam-mode-dialog" style="
                    background: var(--ie-surface, #fff);
                    border-radius: 12px;
                    padding: 24px;
                    min-width: 320px;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
                ">
                    <h3 style="margin: 0 0 16px; color: var(--ie-text, #1e293b); font-size: 16px; font-weight: 600;">
                        选择分割方式
                    </h3>

                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <button class="sam-mode-btn" data-mode="auto" style="
                            display: flex;
                            align-items: center;
                            gap: 12px;
                            padding: 14px 16px;
                            border: 2px solid #4f46e5;
                            border-radius: 8px;
                            background: rgba(79, 70, 229, 0.05);
                            cursor: pointer;
                            text-align: left;
                        ">
                            <iconify-icon icon="carbon:ibm-watson-discovery" style="font-size: 24px; color: #4f46e5;"></iconify-icon>
                            <div>
                                <div style="font-weight: 500; font-size: 14px; color: var(--ie-text, #1e293b);">
                                    自动分割 <span style="color: #4f46e5; font-size: 11px;">推荐</span>
                                </div>
                                <div style="font-size: 12px; color: var(--ie-text-secondary, #64748b);">
                                    一键识别所有对象，生成多个图层
                                </div>
                            </div>
                        </button>

                        <button class="sam-mode-btn" data-mode="box" style="
                            display: flex;
                            align-items: center;
                            gap: 12px;
                            padding: 14px 16px;
                            border: 2px solid var(--ie-border, #e2e8f0);
                            border-radius: 8px;
                            background: transparent;
                            cursor: pointer;
                            text-align: left;
                        ">
                            <iconify-icon icon="carbon:select-window" style="font-size: 24px; color: var(--ie-text-secondary, #64748b);"></iconify-icon>
                            <div>
                                <div style="font-weight: 500; font-size: 14px; color: var(--ie-text, #1e293b);">
                                    框选分割
                                </div>
                                <div style="font-size: 12px; color: var(--ie-text-secondary, #64748b);">
                                    拖动鼠标框选目标区域
                                </div>
                            </div>
                        </button>

                        <button class="sam-mode-btn" data-mode="point" style="
                            display: flex;
                            align-items: center;
                            gap: 12px;
                            padding: 14px 16px;
                            border: 2px solid var(--ie-border, #e2e8f0);
                            border-radius: 8px;
                            background: transparent;
                            cursor: pointer;
                            text-align: left;
                        ">
                            <iconify-icon icon="carbon:touch-1" style="font-size: 24px; color: var(--ie-text-secondary, #64748b);"></iconify-icon>
                            <div>
                                <div style="font-weight: 500; font-size: 14px; color: var(--ie-text, #1e293b);">
                                    点选分割
                                </div>
                                <div style="font-size: 12px; color: var(--ie-text-secondary, #64748b);">
                                    点击添加前景/背景点
                                </div>
                            </div>
                        </button>

                        <button class="sam-mode-btn" data-mode="brush" style="
                            display: flex;
                            align-items: center;
                            gap: 12px;
                            padding: 14px 16px;
                            border: 2px solid var(--ie-border, #e2e8f0);
                            border-radius: 8px;
                            background: transparent;
                            cursor: pointer;
                            text-align: left;
                        ">
                            <iconify-icon icon="carbon:paint-brush" style="font-size: 24px; color: var(--ie-text-secondary, #64748b);"></iconify-icon>
                            <div>
                                <div style="font-weight: 500; font-size: 14px; color: var(--ie-text, #1e293b);">
                                    画笔擦除
                                </div>
                                <div style="font-size: 12px; color: var(--ie-text-secondary, #64748b);">
                                    涂抹要去除的区域
                                </div>
                            </div>
                        </button>
                    </div>

                    <button class="sam-cancel-btn" style="
                        width: 100%;
                        margin-top: 12px;
                        padding: 10px;
                        border: 1px solid var(--ie-border, #e2e8f0);
                        border-radius: 6px;
                        background: transparent;
                        color: var(--ie-text-secondary, #64748b);
                        cursor: pointer;
                        font-size: 13px;
                    ">取消</button>
                </div>
            `;

            // 绑定按钮事件
            overlay.querySelectorAll('.sam-mode-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    overlay.remove();
                    resolve(btn.dataset.mode);
                });
            });

            overlay.querySelector('.sam-cancel-btn').addEventListener('click', () => {
                overlay.remove();
                resolve(null);
            });

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.remove();
                    resolve(null);
                }
            });

            document.body.appendChild(overlay);
        });
    },

    /**
     * 显示 SAM 降级提示（本地模型不可用）
     */
    _showSamFallbackNotice() {
        const notice = document.createElement('div');
        notice.className = 'sam-fallback-notice';
        notice.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            z-index: 10001;
            max-width: 420px;
            font-size: 13px;
            line-height: 1.5;
        `;

        notice.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <iconify-icon icon="carbon:information" style="font-size: 20px; color: #60a5fa; flex-shrink: 0; margin-top: 2px;"></iconify-icon>
                <div>
                    <div style="font-weight: 600; margin-bottom: 6px;">使用在线轻量模型 (SlimSAM)</div>
                    <div style="color: rgba(255,255,255,0.8); font-size: 12px;">
                        本地 SAM3 模型未检测到。如需高精度分割，请下载模型到 <code style="background: rgba(255,255,255,0.15); padding: 2px 6px; border-radius: 4px;">models/sam3/</code> 目录
                    </div>
                    <a href="https://huggingface.co/wkentaro/sam3-onnx-models" target="_blank"
                       style="display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; color: #60a5fa; text-decoration: none; font-size: 12px;">
                        <iconify-icon icon="carbon:download"></iconify-icon>
                        下载 SAM3 模型 (约 2GB)
                    </a>
                </div>
                <button class="sam-notice-close" style="
                    background: transparent;
                    border: none;
                    color: rgba(255,255,255,0.6);
                    cursor: pointer;
                    padding: 4px;
                    margin: -4px -4px -4px 0;
                ">
                    <iconify-icon icon="carbon:close" style="font-size: 16px;"></iconify-icon>
                </button>
            </div>
        `;

        notice.querySelector('.sam-notice-close').addEventListener('click', () => {
            notice.remove();
        });

        document.body.appendChild(notice);

        // 10 秒后自动消失
        setTimeout(() => {
            if (notice.parentNode) {
                notice.style.transition = 'opacity 0.3s, transform 0.3s';
                notice.style.opacity = '0';
                notice.style.transform = 'translateX(-50%) translateY(10px)';
                setTimeout(() => notice.remove(), 300);
            }
        }, 10000);
    },

    /**
     * 更新 SAM 模式 UI
     */
    _updateSamModeUI(enabled) {
        const samBtn = this.container.querySelector('[data-action="sam-segment"]');
        if (samBtn) {
            samBtn.classList.toggle('active', enabled);
        }

        // 显示/隐藏 SAM 工具栏
        let samToolbar = this.container.querySelector('.sam-toolbar');

        if (enabled) {
            if (!samToolbar) {
                samToolbar = document.createElement('div');
                samToolbar.className = 'sam-toolbar';
                samToolbar.innerHTML = `
                    <div class="sam-toolbar-content">
                        <span class="sam-hint">
                            <iconify-icon icon="carbon:information"></iconify-icon>
                            左键点击添加前景点，右键点击添加背景点
                        </span>
                        <div class="sam-actions">
                            <button class="sam-btn" data-sam-action="apply" title="应用分割">
                                <iconify-icon icon="carbon:checkmark"></iconify-icon>
                                应用
                            </button>
                            <button class="sam-btn" data-sam-action="clear" title="清除点">
                                <iconify-icon icon="carbon:reset"></iconify-icon>
                                清除
                            </button>
                            <button class="sam-btn" data-sam-action="cancel" title="取消">
                                <iconify-icon icon="carbon:close"></iconify-icon>
                                取消
                            </button>
                        </div>
                    </div>
                `;
                samToolbar.style.cssText = `
                    position: absolute;
                    bottom: 20px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(0, 0, 0, 0.85);
                    color: white;
                    padding: 12px 20px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    gap: 16px;
                    z-index: 100;
                    backdrop-filter: blur(8px);
                    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                `;

                // 注入样式
                if (!this.container.querySelector('#sam-toolbar-styles')) {
                    const style = document.createElement('style');
                    style.id = 'sam-toolbar-styles';
                    style.textContent = `
                        .sam-toolbar-content {
                            display: flex;
                            align-items: center;
                            gap: 20px;
                        }
                        .sam-hint {
                            font-size: 13px;
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            color: rgba(255,255,255,0.9);
                        }
                        .sam-actions {
                            display: flex;
                            gap: 8px;
                        }
                        .sam-btn {
                            display: flex;
                            align-items: center;
                            gap: 4px;
                            padding: 6px 12px;
                            border: none;
                            border-radius: 6px;
                            background: rgba(255,255,255,0.15);
                            color: white;
                            font-size: 12px;
                            cursor: pointer;
                            transition: all 0.2s;
                        }
                        .sam-btn:hover {
                            background: rgba(255,255,255,0.25);
                        }
                        .sam-btn[data-sam-action="apply"] {
                            background: #4f46e5;
                        }
                        .sam-btn[data-sam-action="apply"]:hover {
                            background: #4338ca;
                        }
                        .sam-point-marker {
                            position: absolute;
                            width: 12px;
                            height: 12px;
                            border-radius: 50%;
                            transform: translate(-50%, -50%);
                            pointer-events: none;
                            box-shadow: 0 0 4px rgba(0,0,0,0.5);
                            z-index: 50;
                        }
                        .sam-point-marker.foreground {
                            background: #22c55e;
                            border: 2px solid white;
                        }
                        .sam-point-marker.background {
                            background: #ef4444;
                            border: 2px solid white;
                        }
                        .sam-preview-mask {
                            position: absolute;
                            top: 0;
                            left: 0;
                            width: 100%;
                            height: 100%;
                            pointer-events: none;
                            opacity: 0.5;
                        }
                    `;
                    this.container.appendChild(style);
                }

                // 绑定按钮事件
                samToolbar.querySelector('[data-sam-action="apply"]')?.addEventListener('click', () => {
                    this._applySamSegmentation();
                });
                samToolbar.querySelector('[data-sam-action="clear"]')?.addEventListener('click', () => {
                    this._clearSamPoints();
                });
                samToolbar.querySelector('[data-sam-action="cancel"]')?.addEventListener('click', () => {
                    this._exitSamMode();
                });

                this.container.querySelector('.image-editor-canvas-wrap').appendChild(samToolbar);
            }
            samToolbar.style.display = 'block';
        } else {
            if (samToolbar) {
                samToolbar.style.display = 'none';
            }
        }
    },

    /**
     * 初始化画笔擦除模式
     */
    _initBrushMode() {
        this.brushMode = true;
        this.brushSize = 30; // 默认画笔大小

        // 确保 SAM UI 不显示
        this._updateSamModeUI(false);

        // 创建 mask canvas（覆盖在图片上）
        this._createBrushMaskCanvas();

        // 显示画笔工具栏
        this._showBrushToolbar();

        // 绑定画笔事件
        this._bindBrushEvents();
    },

    /**
     * 创建画笔 mask canvas
     */
    _createBrushMaskCanvas() {
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        if (!svgContainer) {
            throw new Error('未找到 SVG 容器');
        }

        // 清理旧的 mask canvas
        if (this.brushMaskCanvas) {
            this.brushMaskCanvas.remove();
        }

        this.brushMaskCanvas = document.createElement('canvas');
        this.brushMaskCanvas.className = 'brush-mask-canvas';
        this.brushMaskCanvas.width = this.canvas.width;
        this.brushMaskCanvas.height = this.canvas.height;
        this.brushMaskCanvas.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            opacity: 0.5;
            z-index: 90;
        `;

        this.brushMaskCtx = this.brushMaskCanvas.getContext('2d');
        svgContainer.appendChild(this.brushMaskCanvas);
    },

    /**
     * 显示画笔工具栏
     */
    _showBrushToolbar() {
        let toolbar = this.container.querySelector('.brush-toolbar');
        if (toolbar) toolbar.remove();

        toolbar = document.createElement('div');
        toolbar.className = 'brush-toolbar';
        toolbar.style.cssText = `
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.85);
            color: white;
            padding: 12px 20px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            gap: 16px;
            z-index: 100;
            backdrop-filter: blur(8px);
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;

        toolbar.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
                <iconify-icon icon="carbon:paint-brush" style="font-size: 16px;"></iconify-icon>
                <span style="font-size: 13px;">画笔大小:</span>
                <input type="range" class="brush-size-slider" min="5" max="100" value="${this.brushSize}"
                       style="width: 80px; accent-color: #4f46e5;">
                <span class="brush-size-value" style="font-size: 12px; min-width: 30px;">${this.brushSize}px</span>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="brush-btn" data-action="apply" style="
                    padding: 6px 12px;
                    border: none;
                    border-radius: 6px;
                    background: #4f46e5;
                    color: white;
                    font-size: 12px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                ">
                    <iconify-icon icon="carbon:checkmark"></iconify-icon>
                    应用擦除
                </button>
                <button class="brush-btn" data-action="clear" style="
                    padding: 6px 12px;
                    border: none;
                    border-radius: 6px;
                    background: rgba(255,255,255,0.15);
                    color: white;
                    font-size: 12px;
                    cursor: pointer;
                ">清除</button>
                <button class="brush-btn" data-action="cancel" style="
                    padding: 6px 12px;
                    border: none;
                    border-radius: 6px;
                    background: rgba(255,255,255,0.15);
                    color: white;
                    font-size: 12px;
                    cursor: pointer;
                ">取消</button>
            </div>
        `;

        toolbar.querySelector('.brush-size-slider').addEventListener('input', (e) => {
            this.brushSize = parseInt(e.target.value, 10);
            toolbar.querySelector('.brush-size-value').textContent = this.brushSize + 'px';
        });

        toolbar.querySelector('[data-action="apply"]').addEventListener('click', () => {
            this._applyBrushInpaint();
        });

        toolbar.querySelector('[data-action="clear"]').addEventListener('click', () => {
            this._clearBrushMask();
        });

        toolbar.querySelector('[data-action="cancel"]').addEventListener('click', () => {
            this._exitBrushMode();
        });

        this.container.querySelector('.image-editor-canvas-wrap').appendChild(toolbar);
    },

    /**
     * 绑定画笔事件
     */
    _bindBrushEvents() {
        let isDrawing = false;
        let lastX = 0;
        let lastY = 0;

        const getCoords = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            return {
                x: (e.clientX - rect.left) * scaleX,
                y: (e.clientY - rect.top) * scaleY
            };
        };

        this._brushMouseDown = (e) => {
            if (!this.brushMode) return;
            if (e.button !== 0) return;

            e.preventDefault();
            e.stopPropagation();

            isDrawing = true;
            const coords = getCoords(e);
            lastX = coords.x;
            lastY = coords.y;
            this._drawBrushStroke(coords.x, coords.y, coords.x, coords.y);
        };

        this._brushMouseMove = (e) => {
            if (!this.brushMode || !isDrawing) return;

            e.preventDefault();

            const coords = getCoords(e);
            this._drawBrushStroke(lastX, lastY, coords.x, coords.y);
            lastX = coords.x;
            lastY = coords.y;
        };

        this._brushMouseUp = () => {
            isDrawing = false;
        };

        this._brushContextMenu = (e) => {
            if (this.brushMode) {
                e.preventDefault();
            }
        };

        this._brushKeyDown = (e) => {
            if (!this.brushMode) return;
            if (e.key !== 'Escape') return;
            e.preventDefault();
            this._exitBrushMode();
        };

        this.canvas.addEventListener('mousedown', this._brushMouseDown);
        document.addEventListener('mousemove', this._brushMouseMove);
        document.addEventListener('mouseup', this._brushMouseUp);
        this.canvas.addEventListener('contextmenu', this._brushContextMenu);
        document.addEventListener('keydown', this._brushKeyDown);

        this.canvas.style.cursor = 'crosshair';
    },

    /**
     * 绘制画笔笔触
     */
    _drawBrushStroke(x1, y1, x2, y2) {
        const ctx = this.brushMaskCtx;
        if (!ctx) return;

        ctx.strokeStyle = '#ef4444';
        ctx.fillStyle = '#ef4444';
        ctx.lineWidth = this.brushSize;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x2, y2, this.brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
    },

    /**
     * 清除画笔 mask
     */
    _clearBrushMask() {
        if (!this.brushMaskCtx || !this.brushMaskCanvas) return;
        this.brushMaskCtx.clearRect(0, 0, this.brushMaskCanvas.width, this.brushMaskCanvas.height);
    },

    /**
     * 应用画笔擦除（LaMa Inpainting）
     */
    async _applyBrushInpaint() {
        if (!this.brushMode || !this.brushMaskCtx || !this.brushMaskCanvas) return;

        // 检查是否有绘制内容
        const maskData = this.brushMaskCtx.getImageData(0, 0, this.brushMaskCanvas.width, this.brushMaskCanvas.height);
        let hasContent = false;
        for (let i = 3; i < maskData.data.length; i += 4) {
            if (maskData.data[i] > 0) {
                hasContent = true;
                break;
            }
        }

        if (!hasContent) {
            this._showToast('请先涂抹要去除的区域');
            return;
        }

        this._showLoading('正在擦除...');

        try {
            const mask = this._brushCanvasToMask();

            console.log('[SamMixin] 加载 LaMa Inpainter...');
            const inpainter = await getLamaInpainter();

            let usedFallback = false;
            inpainter._onFallback = () => {
                usedFallback = true;
            };

            await inpainter.init((message, percent) => {
                console.log(`[SamMixin] LaMa: ${message} (${percent}%)`);
                this._showLoading(`${message} (${percent}%)`);
            });

            if (usedFallback) {
                this._showLamaFallbackNotice();
            }

            this._showLoading('正在修复...');
            const imageElement = this.processedImage.original.element;
            const inpaintedData = await inpainter.inpaint(imageElement, mask);

            const resultCanvas = document.createElement('canvas');
            resultCanvas.width = inpaintedData.width;
            resultCanvas.height = inpaintedData.height;
            resultCanvas.getContext('2d').putImageData(inpaintedData, 0, 0);

            const timestamp = Date.now();
            const newLayer = {
                id: `layer_inpaint_brush_${timestamp}`,
                type: 'sam-layer',
                name: '擦除结果',
                canvas: resultCanvas,
                visible: true,
            };

            const originalIdx = this.processedImage.layers.findIndex(l => l.type === 'original');
            if (originalIdx >= 0) {
                this.processedImage.layers.splice(originalIdx + 1, 0, newLayer);
            } else {
                this.processedImage.layers.unshift(newLayer);
            }

            const originalLayer = this.processedImage.layers.find(l => l.type === 'original');
            if (originalLayer) {
                originalLayer.visible = false;
            }

            this._saveHistory();
            this._exitBrushMode();
            this._render();
            this._updateLayerList();

            this._showToast('擦除完成');
        } catch (error) {
            console.error('[SamMixin] 画笔擦除失败:', error);
            this._showToast('擦除失败: ' + (error?.message || error));
        } finally {
            this._hideLoading();
        }
    },

    /**
     * 将画笔 canvas 转换为 mask 格式
     */
    _brushCanvasToMask() {
        const width = this.brushMaskCanvas.width;
        const height = this.brushMaskCanvas.height;
        const imageData = this.brushMaskCtx.getImageData(0, 0, width, height);
        const maskData = new Uint8Array(width * height);

        for (let i = 0; i < maskData.length; i++) {
            maskData[i] = imageData.data[i * 4 + 3] > 0 ? 1 : 0;
        }

        return { data: maskData, width, height };
    },

    /**
     * 退出画笔模式
     */
    _exitBrushMode() {
        this.brushMode = false;

        if (this.brushMaskCanvas) {
            this.brushMaskCanvas.remove();
            this.brushMaskCanvas = null;
            this.brushMaskCtx = null;
        }

        const toolbar = this.container.querySelector('.brush-toolbar');
        if (toolbar) toolbar.remove();

        if (this._brushMouseDown) {
            this.canvas.removeEventListener('mousedown', this._brushMouseDown);
        }
        if (this._brushMouseMove) {
            document.removeEventListener('mousemove', this._brushMouseMove);
        }
        if (this._brushMouseUp) {
            document.removeEventListener('mouseup', this._brushMouseUp);
        }
        if (this._brushContextMenu) {
            this.canvas.removeEventListener('contextmenu', this._brushContextMenu);
        }
        if (this._brushKeyDown) {
            document.removeEventListener('keydown', this._brushKeyDown);
        }

        this._brushMouseDown = null;
        this._brushMouseMove = null;
        this._brushMouseUp = null;
        this._brushContextMenu = null;
        this._brushKeyDown = null;

        this.canvas.style.cursor = '';

        // 与 SAM 状态解耦：确保不会残留分割 UI
        this.samMode = false;
        this._updateSamModeUI(false);
    },

    /**
     * 绑定 SAM 点击事件
     */
    _bindSamClickEvents() {
        if (this._samClickBound) return;
        this._samClickBound = true;

        const canvas = this.canvas;
        console.log('[SamMixin] 绑定点击事件到 canvas');

        // 点击添加点
        this._samClickHandler = async (e) => {
            if (!this.samMode) return;

            e.preventDefault();
            e.stopPropagation();

            // 获取 canvas 的位置信息
            const canvasRect = this.canvas.getBoundingClientRect();

            // 计算点击在 canvas 上的实际位置（考虑缩放）
            const clickX = e.clientX - canvasRect.left;
            const clickY = e.clientY - canvasRect.top;

            // 转换为图片坐标（考虑 canvas 显示尺寸与实际尺寸的比例）
            const scaleX = this.canvas.width / canvasRect.width;
            const scaleY = this.canvas.height / canvasRect.height;

            const x = clickX * scaleX;
            const y = clickY * scaleY;

            // 边界检查
            if (x < 0 || x > this.canvas.width || y < 0 || y > this.canvas.height) {
                console.log('[SamMixin] 点击在图片外部，忽略');
                return;
            }

            // 左键 = 前景 (1)，右键 = 背景 (0)
            const label = e.button === 2 ? 0 : 1;

            console.log(`[SamMixin] 添加点: img(${x.toFixed(0)}, ${y.toFixed(0)}), 标签: ${label === 1 ? '前景' : '背景'}`);

            this.samPoints.push([x, y]);
            this.samLabels.push(label);

            // 显示点标记（使用相对于 canvas 的位置，放在 viewport 内跟随缩放）
            // 注意：这里传的是 canvas 内的像素位置（未缩放前的）
            this._showSamPointMarker(x, y, label);

            this._showToast(`已添加 ${this.samPoints.length} 个点，点击"应用"开始分割`);
        };

        // 禁用右键菜单
        this._samContextHandler = (e) => {
            if (this.samMode) {
                e.preventDefault();
            }
        };

        canvas.addEventListener('click', this._samClickHandler);
        canvas.addEventListener('contextmenu', this._samContextHandler);
        canvas.addEventListener('mousedown', (e) => {
            if (this.samMode && e.button === 2) {
                this._samClickHandler(e);
            }
        });
    },

    /**
     * 显示点标记
     * @param {number} x - 图片坐标 X
     * @param {number} y - 图片坐标 Y
     * @param {number} label - 1=前景, 0=背景
     */
    _showSamPointMarker(x, y, label) {
        // 放到 svg-container 内，这样会跟随 viewport 缩放
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        if (!svgContainer) return;

        const marker = document.createElement('div');
        marker.className = `sam-point-marker ${label === 1 ? 'foreground' : 'background'}`;

        // 使用图片坐标定位（svg-container 与 canvas 尺寸相同）
        marker.style.cssText = `
            position: absolute;
            left: ${x}px;
            top: ${y}px;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            transform: translate(-50%, -50%);
            pointer-events: none;
            z-index: 100;
            box-shadow: 0 2px 8px rgba(0,0,0,0.5);
            background: ${label === 1 ? '#22c55e' : '#ef4444'};
            border: 3px solid white;
        `;

        svgContainer.appendChild(marker);
    },

    /**
     * 清除点标记
     */
    _clearSamPointMarkers() {
        // 从 svg-container 中清除标记
        const svgContainer = this.container.querySelector('.image-editor-svg-container');
        if (svgContainer) {
            svgContainer.querySelectorAll('.sam-point-marker').forEach(m => m.remove());
        }

        const previewMask = this.container.querySelector('.sam-preview-mask');
        if (previewMask) previewMask.remove();
    },

    /**
     * 预览分割结果
     */
    async _previewSamSegmentation() {
        if (this.samPoints.length === 0) return;

        console.log('[SamMixin] 开始分割预览, 点数:', this.samPoints.length);

        try {
            const segmenter = await getSamSegmenter();
            const imageElement = this.processedImage.original.element;

            console.log('[SamMixin] 调用 segmentByPoints...');
            const result = await segmenter.segmentByPoints(
                imageElement,
                this.samPoints,
                this.samLabels
            );
            console.log('[SamMixin] 分割完成, scores:', result.scores);

            // 显示预览 mask
            this._showSamPreviewMask(result.masks[result.selectedMaskIndex], result.width, result.height);

            // 保存结果供后续使用
            this._samResult = result;

            this._showToast(`分割完成 (置信度: ${Math.round(result.scores[result.selectedMaskIndex] * 100)}%)`);

        } catch (error) {
            console.error('[SamMixin] 分割预览失败:', error);
        }
    },

    /**
     * 显示预览 mask
     */
    _showSamPreviewMask(mask, width, height) {
        let previewCanvas = this.container.querySelector('.sam-preview-mask');

        if (!previewCanvas) {
            previewCanvas = document.createElement('canvas');
            previewCanvas.className = 'sam-preview-mask';
            this.container.querySelector('.image-editor-svg-container').appendChild(previewCanvas);
        }

        previewCanvas.width = width;
        previewCanvas.height = height;
        const ctx = previewCanvas.getContext('2d');

        // 将 mask 转换为半透明蓝色覆盖
        const imageData = ctx.createImageData(width, height);
        const maskData = mask.data;

        for (let i = 0; i < maskData.length; i++) {
            const idx = i * 4;
            if (maskData[i]) {
                imageData.data[idx] = 79;      // R (indigo)
                imageData.data[idx + 1] = 70;  // G
                imageData.data[idx + 2] = 229; // B
                imageData.data[idx + 3] = 128; // A (半透明)
            }
        }

        ctx.putImageData(imageData, 0, 0);
    },

    /**
     * 应用分割结果，创建新图层
     */
    async _applySamSegmentation() {
        if (this.samPoints.length === 0) {
            this._showToast('请先点击图片添加分割点');
            return;
        }

        this._showLoading('正在执行 AI 分割...');

        try {
            // 先执行分割
            console.log('[SamMixin] 开始分割, 点数:', this.samPoints.length);
            const segmenter = await getSamSegmenter();
            const imageElement = this.processedImage.original.element;

            // 让 UI 更新
            await new Promise(r => requestAnimationFrame(r));

            const result = await segmenter.segmentByPoints(
                imageElement,
                this.samPoints,
                this.samLabels
            );
            console.log('[SamMixin] 分割完成, scores:', result.scores);

            const selectedMask = result.masks[result.selectedMaskIndex];

            // 生成前景图层（带透明通道）
            const foregroundData = segmenter.applyMaskToImage(imageElement, selectedMask);

            // 创建前景 canvas
            const fgCanvas = document.createElement('canvas');
            fgCanvas.width = result.width;
            fgCanvas.height = result.height;
            fgCanvas.getContext('2d').putImageData(foregroundData, 0, 0);

            // 生成背景图层（使用 LaMa Inpainting）
            this._showLoading('正在修复背景...');
            const bgCanvas = await this._generateInpaintedBackground(imageElement, selectedMask, result.width, result.height);

            // 添加图层到 processedImage
            const timestamp = Date.now();
            const score = result.scores[result.selectedMaskIndex];

            // 创建分割组
            const segmentGroup = {
                id: `layer_sam_group_${timestamp}`,
                type: 'group',
                name: `AI 分割 (${Math.round(score * 100)}%)`,
                visible: true,
                samGroup: true,
                children: [
                    {
                        id: `layer_sam_fg_${timestamp}`,
                        type: 'sam-layer',
                        name: '前景',
                        canvas: fgCanvas,
                        visible: true,
                        isForeground: true
                    },
                    {
                        id: `layer_sam_bg_${timestamp}`,
                        type: 'sam-layer',
                        name: '背景 (已修复)',
                        canvas: bgCanvas,
                        visible: true, // 默认显示修复后的背景
                        isForeground: false
                    }
                ]
            };

            // 在原始图层之后插入
            const originalIdx = this.processedImage.layers.findIndex(l => l.type === 'original');
            this.processedImage.layers.splice(originalIdx + 1, 0, segmentGroup);

            // 隐藏原始图层
            const originalLayer = this.processedImage.layers.find(l => l.type === 'original');
            if (originalLayer) {
                originalLayer.visible = false;
            }

            // 保存历史
            this._saveHistory();

            // 退出 SAM 模式
            this._exitSamMode();

            // 重新渲染
            this._render();
            this._updateLayerList();

            this._showToast(`分割完成，置信度: ${Math.round(score * 100)}%`);

        } catch (error) {
            console.error('[SamMixin] 应用分割失败:', error);
            this._showToast('分割应用失败: ' + error.message);
        } finally {
            this._hideLoading();
        }
    },

    /**
     * 生成修复后的背景（使用 LaMa Inpainting）
     * @param {HTMLImageElement} imageElement - 原始图片
     * @param {Object} mask - 前景 mask { data, width, height }
     * @param {number} width - 图片宽度
     * @param {number} height - 图片高度
     * @returns {Promise<HTMLCanvasElement>} 修复后的背景 canvas
     */
    async _generateInpaintedBackground(imageElement, mask, width, height) {
        const bgCanvas = document.createElement('canvas');
        bgCanvas.width = width;
        bgCanvas.height = height;
        const bgCtx = bgCanvas.getContext('2d');

        try {
            // 尝试使用 LaMa Inpainting
            console.log('[SamMixin] 加载 LaMa Inpainter...');
            const inpainter = await getLamaInpainter();

            // 设置降级回调
            let usedFallback = false;
            inpainter._onFallback = () => {
                usedFallback = true;
            };

            // 初始化 inpainter（首次会下载模型）
            await inpainter.init((message, percent) => {
                console.log(`[SamMixin] LaMa: ${message} (${percent}%)`);
                this._showLoading(`${message} (${percent}%)`);
            });

            if (usedFallback) {
                this._showLamaFallbackNotice();
            }

            // 执行 inpainting
            this._showLoading('正在修复背景...');
            const inpaintedData = await inpainter.inpaint(imageElement, mask);

            // 将结果绘制到 canvas
            bgCtx.putImageData(inpaintedData, 0, 0);
            console.log('[SamMixin] 背景修复完成');

        } catch (error) {
            console.warn('[SamMixin] LaMa Inpainting 失败，使用简单填充:', error);
            this._showToast('背景修复失败，使用原图', 2000);

            // 回退：使用原图（前景区域透明）
            bgCtx.drawImage(imageElement, 0, 0);
            const bgImageData = bgCtx.getImageData(0, 0, width, height);
            const maskData = mask.data;

            for (let i = 0; i < maskData.length; i++) {
                if (maskData[i]) {
                    bgImageData.data[i * 4 + 3] = 0;
                }
            }
            bgCtx.putImageData(bgImageData, 0, 0);
        }

        return bgCanvas;
    },

    /**
     * 显示 LaMa 降级提示
     */
    _showLamaFallbackNotice() {
        const notice = document.createElement('div');
        notice.className = 'lama-fallback-notice';
        notice.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
            color: white;
            padding: 16px 20px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            z-index: 10001;
            max-width: 420px;
            font-size: 13px;
            line-height: 1.5;
        `;

        notice.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 12px;">
                <iconify-icon icon="carbon:information" style="font-size: 20px; color: #60a5fa; flex-shrink: 0; margin-top: 2px;"></iconify-icon>
                <div>
                    <div style="font-weight: 600; margin-bottom: 6px;">使用在线 LaMa 模型</div>
                    <div style="color: rgba(255,255,255,0.8); font-size: 12px;">
                        本地 LaMa 模型未检测到。如需更快速度，请下载模型到 <code style="background: rgba(255,255,255,0.15); padding: 2px 6px; border-radius: 4px;">models/lama/</code> 目录
                    </div>
                    <a href="https://huggingface.co/Carve/LaMa-ONNX" target="_blank"
                       style="display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; color: #60a5fa; text-decoration: none; font-size: 12px;">
                        <iconify-icon icon="carbon:download"></iconify-icon>
                        下载 LaMa 模型 (约 208MB)
                    </a>
                </div>
                <button class="lama-notice-close" style="
                    background: transparent;
                    border: none;
                    color: rgba(255,255,255,0.6);
                    cursor: pointer;
                    padding: 4px;
                    margin: -4px -4px -4px 0;
                ">
                    <iconify-icon icon="carbon:close" style="font-size: 16px;"></iconify-icon>
                </button>
            </div>
        `;

        notice.querySelector('.lama-notice-close').addEventListener('click', () => {
            notice.remove();
        });

        document.body.appendChild(notice);

        setTimeout(() => {
            if (notice.parentNode) {
                notice.style.transition = 'opacity 0.3s, transform 0.3s';
                notice.style.opacity = '0';
                notice.style.transform = 'translateX(-50%) translateY(10px)';
                setTimeout(() => notice.remove(), 300);
            }
        }, 8000);
    },

    /**
     * 清除 SAM 点
     */
    _clearSamPoints() {
        this.samPoints = [];
        this.samLabels = [];
        this._samResult = null;
        this._clearSamPointMarkers();
    },

    /**
     * 退出 SAM 模式
     */
    _exitSamMode() {
        this.samMode = false;
        this._clearSamPoints();
        this._updateSamModeUI(false);

        // 移除事件监听
        if (this._samClickHandler) {
            this.canvas.removeEventListener('click', this._samClickHandler);
        }
        if (this._samContextHandler) {
            this.canvas.removeEventListener('contextmenu', this._samContextHandler);
        }
        this._samClickBound = false;
    },

    /**
     * 渲染 SAM 图层
     */
    _renderSamLayer(layer) {
        if (!layer.canvas || !layer.visible) return;
        this.ctx.drawImage(layer.canvas, 0, 0);
    },

    /**
     * 自动分割 - 在图片上均匀采样点来生成多个 mask
     */
    async _runAutoSegmentation() {
        this._showLoading('正在自动分析图片...');

        try {
            const segmenter = await getSamSegmenter();
            const imageElement = this.processedImage.original.element;
            const width = imageElement.naturalWidth || imageElement.width;
            const height = imageElement.naturalHeight || imageElement.height;

            // 生成采样点网格（3x3 或 4x4）
            const gridSize = 3;
            const samplePoints = [];
            const stepX = width / (gridSize + 1);
            const stepY = height / (gridSize + 1);

            for (let row = 1; row <= gridSize; row++) {
                for (let col = 1; col <= gridSize; col++) {
                    samplePoints.push([Math.round(col * stepX), Math.round(row * stepY)]);
                }
            }

            console.log('[SamMixin] 自动分割采样点:', samplePoints.length);

            // 对每个采样点执行分割
            const allMasks = [];
            const allScores = [];

            for (let i = 0; i < samplePoints.length; i++) {
                this._showLoading(`分析区域 ${i + 1}/${samplePoints.length}...`);

                try {
                    const result = await segmenter.segmentByPoints(
                        imageElement,
                        [samplePoints[i]],
                        [1]
                    );

                    // 取最佳 mask
                    const bestIdx = result.selectedMaskIndex;
                    if (result.scores[bestIdx] > 0.7) { // 只保留置信度高的
                        allMasks.push({
                            mask: result.masks[bestIdx],
                            score: result.scores[bestIdx],
                            point: samplePoints[i],
                            width: result.width,
                            height: result.height
                        });
                    }
                } catch (e) {
                    console.warn('[SamMixin] 采样点分割失败:', samplePoints[i], e);
                }
            }

            console.log('[SamMixin] 有效 mask 数量:', allMasks.length);

            if (allMasks.length === 0) {
                this._showToast('未能识别出有效区域');
                this._hideLoading();
                this.samMode = false;
                return;
            }

            // 合并相似的 mask（去重）
            const mergedMasks = this._mergeSimilarMasks(allMasks);
            console.log('[SamMixin] 去重后 mask 数量:', mergedMasks.length);

            // 生成图层
            this._showLoading('生成图层...');
            await this._createLayersFromMasks(mergedMasks, imageElement);

            this._hideLoading();
            this.samMode = false;
            this._showToast(`自动分割完成，生成 ${mergedMasks.length} 个图层`);

        } catch (error) {
            console.error('[SamMixin] 自动分割失败:', error);
            this._showToast('自动分割失败: ' + error.message);
            this._hideLoading();
            this.samMode = false;
        }
    },

    /**
     * 合并相似的 mask（基于 IoU）
     */
    _mergeSimilarMasks(masks) {
        if (masks.length <= 1) return masks;

        const iouThreshold = 0.5; // IoU 阈值
        const kept = [];

        // 按分数排序
        masks.sort((a, b) => b.score - a.score);

        for (const maskObj of masks) {
            let isDuplicate = false;

            for (const keptMask of kept) {
                const iou = this._calculateMaskIoU(maskObj.mask, keptMask.mask);
                if (iou > iouThreshold) {
                    isDuplicate = true;
                    break;
                }
            }

            if (!isDuplicate) {
                kept.push(maskObj);
            }
        }

        return kept;
    },

    /**
     * 计算两个 mask 的 IoU
     */
    _calculateMaskIoU(mask1, mask2) {
        const data1 = mask1.data;
        const data2 = mask2.data;

        let intersection = 0;
        let union = 0;

        for (let i = 0; i < data1.length; i++) {
            const a = data1[i] ? 1 : 0;
            const b = data2[i] ? 1 : 0;
            intersection += a & b;
            union += a | b;
        }

        return union > 0 ? intersection / union : 0;
    },

    /**
     * 从多个 mask 创建图层
     */
    async _createLayersFromMasks(masks, imageElement) {
        const segmenter = await getSamSegmenter();
        const timestamp = Date.now();

        // 创建分割组
        const segmentGroup = {
            id: `layer_sam_auto_${timestamp}`,
            type: 'group',
            name: `自动分割 (${masks.length} 个对象)`,
            visible: true,
            samGroup: true,
            children: []
        };

        // 为每个 mask 创建图层
        for (let i = 0; i < masks.length; i++) {
            const maskObj = masks[i];
            const foregroundData = segmenter.applyMaskToImage(imageElement, maskObj.mask);

            const canvas = document.createElement('canvas');
            canvas.width = maskObj.width;
            canvas.height = maskObj.height;
            canvas.getContext('2d').putImageData(foregroundData, 0, 0);

            segmentGroup.children.push({
                id: `layer_sam_obj_${timestamp}_${i}`,
                type: 'sam-layer',
                name: `对象 ${i + 1} (${Math.round(maskObj.score * 100)}%)`,
                canvas: canvas,
                visible: true,
                isForeground: true
            });
        }

        // 在原始图层之后插入
        const originalIdx = this.processedImage.layers.findIndex(l => l.type === 'original');
        this.processedImage.layers.splice(originalIdx + 1, 0, segmentGroup);

        // 隐藏原始图层
        const originalLayer = this.processedImage.layers.find(l => l.type === 'original');
        if (originalLayer) {
            originalLayer.visible = false;
        }

        // 保存历史
        this._saveHistory();

        // 重新渲染
        this._render();
        this._updateLayerList();
    },

    /**
     * 绑定框选分割事件
     */
    _bindSamBoxEvents() {
        if (this._samBoxBound) return;
        this._samBoxBound = true;

        const canvas = this.canvas;
        let isDrawing = false;
        let startX, startY;
        let boxElement = null;

        const getImageCoords = (e) => {
            const canvasRect = canvas.getBoundingClientRect();
            const clickX = e.clientX - canvasRect.left;
            const clickY = e.clientY - canvasRect.top;
            const scaleX = canvas.width / canvasRect.width;
            const scaleY = canvas.height / canvasRect.height;
            return {
                x: clickX * scaleX,
                y: clickY * scaleY,
                screenX: clickX,
                screenY: clickY
            };
        };

        this._samBoxMouseDown = (e) => {
            if (!this.samMode || this.samSegmentMode !== 'box') return;
            e.preventDefault();

            isDrawing = true;
            const coords = getImageCoords(e);
            startX = coords.x;
            startY = coords.y;

            // 创建选框元素
            const svgContainer = this.container.querySelector('.image-editor-svg-container');
            boxElement = document.createElement('div');
            boxElement.className = 'sam-box-selector';
            boxElement.style.cssText = `
                position: absolute;
                border: 2px dashed #4f46e5;
                background: rgba(79, 70, 229, 0.1);
                pointer-events: none;
                z-index: 100;
            `;
            svgContainer.appendChild(boxElement);
        };

        this._samBoxMouseMove = (e) => {
            if (!isDrawing || !boxElement) return;

            const coords = getImageCoords(e);
            const x = Math.min(startX, coords.x);
            const y = Math.min(startY, coords.y);
            const w = Math.abs(coords.x - startX);
            const h = Math.abs(coords.y - startY);

            boxElement.style.left = `${x}px`;
            boxElement.style.top = `${y}px`;
            boxElement.style.width = `${w}px`;
            boxElement.style.height = `${h}px`;
        };

        this._samBoxMouseUp = async (e) => {
            if (!isDrawing) return;
            isDrawing = false;

            const coords = getImageCoords(e);
            const x1 = Math.min(startX, coords.x);
            const y1 = Math.min(startY, coords.y);
            const x2 = Math.max(startX, coords.x);
            const y2 = Math.max(startY, coords.y);

            // 移除选框
            if (boxElement) {
                boxElement.remove();
                boxElement = null;
            }

            // 检查框是否有效
            if (x2 - x1 < 10 || y2 - y1 < 10) {
                this._showToast('框选区域太小');
                return;
            }

            this.samBox = { x1, y1, x2, y2 };
            console.log('[SamMixin] 框选区域:', this.samBox);

            // 执行框选分割
            await this._applyBoxSegmentation();
        };

        canvas.addEventListener('mousedown', this._samBoxMouseDown);
        canvas.addEventListener('mousemove', this._samBoxMouseMove);
        canvas.addEventListener('mouseup', this._samBoxMouseUp);
    },

    /**
     * 应用框选分割
     */
    async _applyBoxSegmentation() {
        if (!this.samBox) return;

        this._showLoading('正在分割...');

        try {
            const segmenter = await getSamSegmenter();
            const imageElement = this.processedImage.original.element;

            const result = await segmenter.segmentByBox(imageElement, this.samBox);
            console.log('[SamMixin] 框选分割完成, scores:', result.scores);

            const selectedMask = result.masks[result.selectedMaskIndex];

            // 生成前景图层
            const foregroundData = segmenter.applyMaskToImage(imageElement, selectedMask);
            const fgCanvas = document.createElement('canvas');
            fgCanvas.width = result.width;
            fgCanvas.height = result.height;
            fgCanvas.getContext('2d').putImageData(foregroundData, 0, 0);

            // 生成背景图层（使用 LaMa Inpainting）
            this._showLoading('正在修复背景...');
            const bgCanvas = await this._generateInpaintedBackground(imageElement, selectedMask, result.width, result.height);

            // 创建图层
            const timestamp = Date.now();
            const score = result.scores[result.selectedMaskIndex];

            const segmentGroup = {
                id: `layer_sam_box_${timestamp}`,
                type: 'group',
                name: `框选分割 (${Math.round(score * 100)}%)`,
                visible: true,
                samGroup: true,
                children: [
                    {
                        id: `layer_sam_box_fg_${timestamp}`,
                        type: 'sam-layer',
                        name: '前景',
                        canvas: fgCanvas,
                        visible: true,
                        isForeground: true
                    },
                    {
                        id: `layer_sam_box_bg_${timestamp}`,
                        type: 'sam-layer',
                        name: '背景 (已修复)',
                        canvas: bgCanvas,
                        visible: true,
                        isForeground: false
                    }
                ]
            };

            const originalIdx = this.processedImage.layers.findIndex(l => l.type === 'original');
            this.processedImage.layers.splice(originalIdx + 1, 0, segmentGroup);

            const originalLayer = this.processedImage.layers.find(l => l.type === 'original');
            if (originalLayer) {
                originalLayer.visible = false;
            }

            this._saveHistory();
            this._exitSamMode();
            this._render();
            this._updateLayerList();

            this._showToast(`框选分割完成，置信度: ${Math.round(score * 100)}%`);

        } catch (error) {
            console.error('[SamMixin] 框选分割失败:', error);
            this._showToast('框选分割失败: ' + error.message);
        } finally {
            this._hideLoading();
        }
    }
};
