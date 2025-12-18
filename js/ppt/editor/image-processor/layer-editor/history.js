/**
 * LayerEditor 历史记录模块
 * 从 layer-editor.js 拆分出的历史记录方法
 */

/**
 * 历史记录 mixin
 */
export const HistoryMixin = {
    /**
     * 提取不可序列化对象的引用
     */
    _extractNonSerializable(layers) {
        const refs = new Map();

        const extract = (obj, path) => {
            if (!obj || typeof obj !== 'object') return;

            // Canvas 对象
            if (obj.canvas && typeof HTMLCanvasElement !== 'undefined' && obj.canvas instanceof HTMLCanvasElement) {
                refs.set(path + '.canvas', obj.canvas);
                if (obj.ctx) refs.set(path + '.ctx', obj.ctx);
            }

            // Image 对象
            if (obj.element && typeof HTMLImageElement !== 'undefined' && obj.element instanceof HTMLImageElement) {
                refs.set(path + '.element', obj.element);
            }
            if (obj.image && typeof HTMLImageElement !== 'undefined' && obj.image instanceof HTMLImageElement) {
                refs.set(path + '.image', obj.image);
            }

            // 递归处理
            if (Array.isArray(obj)) {
                obj.forEach((item, i) => extract(item, `${path}[${i}]`));
            } else {
                for (const key in obj) {
                    if (obj.hasOwnProperty(key) && typeof obj[key] === 'object') {
                        extract(obj[key], `${path}.${key}`);
                    }
                }
            }
        };

        layers.forEach((layer, i) => extract(layer, `[${i}]`));
        return refs;
    },

    /**
     * 恢复不可序列化对象的引用
     */
    _restoreNonSerializable(layers, refs) {
        if (!refs || refs.size === 0) return;

        const setByPath = (obj, path, value) => {
            const parts = path.match(/\[(\d+)\]|\.(\w+)/g);
            if (!parts) return;

            let current = { root: obj };
            let parentKey = 'root';

            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                const key = part.startsWith('[') ? parseInt(part.slice(1, -1)) : part.slice(1);
                current = current[parentKey];
                if (!current) return;
                parentKey = key;
            }

            const lastPart = parts[parts.length - 1];
            const lastKey = lastPart.startsWith('[') ? parseInt(lastPart.slice(1, -1)) : lastPart.slice(1);
            if (current[parentKey]) {
                current[parentKey][lastKey] = value;
            }
        };

        refs.forEach((value, path) => {
            setByPath(layers, path, value);
        });
    },

    /**
     * 保存历史记录
     */
    _saveHistory() {
        // 提取不可序列化对象
        const refs = this._extractNonSerializable(this.processedImage.layers);

        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push({
            json: JSON.stringify(this.processedImage.layers),
            refs: refs
        });
        this.historyIndex = this.history.length - 1;
    },

    /**
     * 撤销
     */
    _undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            const entry = this.history[this.historyIndex];
            // 兼容旧格式（纯字符串）
            if (typeof entry === 'string') {
                this.processedImage.layers = JSON.parse(entry);
            } else {
                this.processedImage.layers = JSON.parse(entry.json);
                this._restoreNonSerializable(this.processedImage.layers, entry.refs);
            }
            this._updateLayerList?.();
            this._updatePropertyPanel?.();
            this._render();
        }
    },

    /**
     * 重做
     */
    _redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            const entry = this.history[this.historyIndex];
            // 兼容旧格式（纯字符串）
            if (typeof entry === 'string') {
                this.processedImage.layers = JSON.parse(entry);
            } else {
                this.processedImage.layers = JSON.parse(entry.json);
                this._restoreNonSerializable(this.processedImage.layers, entry.refs);
            }
            this._updateLayerList?.();
            this._updatePropertyPanel?.();
            this._render();
        }
    }
};
