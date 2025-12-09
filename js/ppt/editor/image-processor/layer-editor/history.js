/**
 * LayerEditor 历史记录模块
 * 从 layer-editor.js 拆分出的历史记录方法
 */

/**
 * 历史记录 mixin
 */
export const HistoryMixin = {
    /**
     * 保存历史记录
     */
    _saveHistory() {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(JSON.stringify(this.processedImage.layers));
        this.historyIndex = this.history.length - 1;
    },

    /**
     * 撤销
     */
    _undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.processedImage.layers = JSON.parse(this.history[this.historyIndex]);
            this._render();
        }
    },

    /**
     * 重做
     */
    _redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.processedImage.layers = JSON.parse(this.history[this.historyIndex]);
            this._render();
        }
    }
};
