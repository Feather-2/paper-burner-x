/**
 * 图片处理设置面板
 */

class ImageProcessorSettings {
    constructor() {
        this.modal = null;
    }

    open() {
        if (this.modal) {
            this.modal.style.display = 'flex';
            return;
        }

        this._createModal();
        this._loadSettings();
        this._bindEvents();
    }

    close() {
        if (this.modal) {
            this.modal.style.display = 'none';
        }
    }

    _createModal() {
        this.modal = document.createElement('div');
        this.modal.className = 'image-processor-settings-modal';
        this.modal.innerHTML = `
            <div class="ips-backdrop"></div>
            <div class="ips-content">
                <div class="ips-header">
                    <h3>图片智能处理设置</h3>
                    <button class="ips-close">×</button>
                </div>
                <div class="ips-body">
                    <div class="ips-section">
                        <h4>OCR 引擎</h4>
                        <div class="ips-option">
                            <label>
                                <input type="radio" name="ocr-priority" value="mineru">
                                <span>MinerU 优先</span>
                            </label>
                            <p class="ips-hint">精确的 bbox 定位，适合保留格式翻译</p>
                        </div>
                        <div class="ips-option">
                            <label>
                                <input type="radio" name="ocr-priority" value="vlm">
                                <span>视觉模型优先</span>
                            </label>
                            <p class="ips-hint">更灵活，支持复杂排版，但可能不够精确</p>
                        </div>
                        <div class="ips-option">
                            <label>
                                <input type="radio" name="ocr-priority" value="auto">
                                <span>自动选择</span>
                            </label>
                            <p class="ips-hint">优先 MinerU，不可用时自动切换到视觉模型</p>
                        </div>
                        <div class="ips-status" id="ips-ocr-status"></div>
                    </div>

                    <div class="ips-section">
                        <h4>矢量化预设</h4>
                        <select id="ips-vectorize-preset" class="ips-select">
                            <option value="logo">Logo / 图标</option>
                            <option value="illustration">插画</option>
                            <option value="lineart">线稿</option>
                            <option value="photo">照片</option>
                            <option value="simple">简化</option>
                        </select>
                    </div>

                    <div class="ips-section">
                        <h4>背景去除</h4>
                        <div class="ips-option">
                            <label>
                                边缘检测阈值
                                <input type="range" id="ips-edge-threshold" min="10" max="100" value="30">
                                <span id="ips-edge-threshold-val">30</span>
                            </label>
                        </div>
                        <div class="ips-option">
                            <label>
                                颜色容差
                                <input type="range" id="ips-color-tolerance" min="5" max="50" value="25">
                                <span id="ips-color-tolerance-val">25</span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="ips-footer">
                    <button class="ips-btn-cancel">取消</button>
                    <button class="ips-btn-save">保存设置</button>
                </div>
            </div>
        `;

        this._injectStyles();
        document.body.appendChild(this.modal);
    }

    _injectStyles() {
        if (document.getElementById('ips-styles')) return;

        const style = document.createElement('style');
        style.id = 'ips-styles';
        style.textContent = `
            .image-processor-settings-modal {
                position: fixed;
                inset: 0;
                z-index: 10002;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .ips-backdrop {
                position: absolute;
                inset: 0;
                background: rgba(0,0,0,0.5);
            }
            .ips-content {
                position: relative;
                width: 480px;
                max-height: 80vh;
                background: #fff;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            .ips-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                border-bottom: 1px solid #e5e7eb;
            }
            .ips-header h3 {
                margin: 0;
                font-size: 16px;
                font-weight: 600;
                color: #111827;
            }
            .ips-close {
                background: none;
                border: none;
                font-size: 24px;
                color: #9ca3af;
                cursor: pointer;
            }
            .ips-body {
                padding: 20px;
                overflow-y: auto;
                max-height: calc(80vh - 130px);
            }
            .ips-section {
                margin-bottom: 24px;
            }
            .ips-section h4 {
                margin: 0 0 12px 0;
                font-size: 14px;
                font-weight: 600;
                color: #374151;
            }
            .ips-option {
                margin-bottom: 12px;
            }
            .ips-option label {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                font-size: 14px;
                color: #111827;
            }
            .ips-hint {
                margin: 4px 0 0 24px;
                font-size: 12px;
                color: #6b7280;
            }
            .ips-status {
                margin-top: 12px;
                padding: 10px;
                background: #f3f4f6;
                border-radius: 6px;
                font-size: 12px;
                color: #4b5563;
            }
            .ips-select {
                width: 100%;
                padding: 8px 12px;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                font-size: 14px;
            }
            .ips-footer {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                padding: 16px 20px;
                border-top: 1px solid #e5e7eb;
            }
            .ips-btn-cancel, .ips-btn-save {
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 14px;
                cursor: pointer;
            }
            .ips-btn-cancel {
                background: #f3f4f6;
                border: none;
                color: #374151;
            }
            .ips-btn-save {
                background: #4f46e5;
                border: none;
                color: #fff;
            }
            .ips-btn-save:hover {
                background: #4338ca;
            }
        `;
        document.head.appendChild(style);
    }

    _bindEvents() {
        this.modal.querySelector('.ips-backdrop').onclick = () => this.close();
        this.modal.querySelector('.ips-close').onclick = () => this.close();
        this.modal.querySelector('.ips-btn-cancel').onclick = () => this.close();
        this.modal.querySelector('.ips-btn-save').onclick = () => this._saveSettings();

        // 滑块实时显示值
        const edgeSlider = this.modal.querySelector('#ips-edge-threshold');
        const colorSlider = this.modal.querySelector('#ips-color-tolerance');
        
        edgeSlider.oninput = () => {
            this.modal.querySelector('#ips-edge-threshold-val').textContent = edgeSlider.value;
        };
        colorSlider.oninput = () => {
            this.modal.querySelector('#ips-color-tolerance-val').textContent = colorSlider.value;
        };
    }

    _loadSettings() {
        // 加载当前配置
        const config = window.imageProcessor?.config || {
            ocrPriority: 'mineru',
            vectorizePreset: 'logo'
        };

        // OCR 优先级
        const radio = this.modal.querySelector(`input[value="${config.ocrPriority}"]`);
        if (radio) radio.checked = true;

        // 矢量化预设
        const presetSelect = this.modal.querySelector('#ips-vectorize-preset');
        presetSelect.value = config.vectorizePreset || 'logo';

        // 显示 OCR 可用状态
        this._updateOcrStatus();
    }

    _updateOcrStatus() {
        const statusEl = this.modal.querySelector('#ips-ocr-status');
        if (!window.imageProcessor) {
            statusEl.innerHTML = '⏳ ImageProcessor 未加载';
            return;
        }

        const avail = window.imageProcessor.getOcrAvailability();
        const lines = [];
        
        lines.push(`<strong>MinerU:</strong> ${avail.mineru ? '✅ 可用' : '❌ 未配置'}`);
        lines.push(`<strong>视觉模型:</strong> ${avail.vlm ? '✅ 可用' : '❌ 未配置'}`);
        
        statusEl.innerHTML = lines.join('<br>');
    }

    _saveSettings() {
        const ocrPriority = this.modal.querySelector('input[name="ocr-priority"]:checked')?.value || 'mineru';
        const vectorizePreset = this.modal.querySelector('#ips-vectorize-preset').value;
        const edgeThreshold = parseInt(this.modal.querySelector('#ips-edge-threshold').value);
        const colorTolerance = parseInt(this.modal.querySelector('#ips-color-tolerance').value);

        const config = {
            ocrPriority,
            vectorizePreset,
            bgRemover: { edgeThreshold, colorTolerance }
        };

        // 保存到 ImageProcessor
        if (window.imageProcessor) {
            window.imageProcessor.saveConfig(config);
        }

        // 也保存到 localStorage
        try {
            localStorage.setItem('imageProcessorConfig', JSON.stringify(config));
        } catch (e) {}

        this.close();
    }
}

// 单例 & 导出到全局
const imageProcessorSettings = new ImageProcessorSettings();
window.ImageProcessorSettings = ImageProcessorSettings;
window.imageProcessorSettings = imageProcessorSettings;

// ESM 导出
export { ImageProcessorSettings };
