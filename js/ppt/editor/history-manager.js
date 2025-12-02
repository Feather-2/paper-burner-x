/**
 * 历史管理器
 * 支持撤销/重做，操作合并，自动快照
 */
class HistoryManager extends EventEmitter {
    static MAX_UNDO_STACK = 100;        // 最大撤销步数
    static SNAPSHOT_INTERVAL = 30000;   // 快照间隔 (30秒)
    static AUTO_SAVE_INTERVAL = 30000;  // 自动保存间隔

    constructor(editor) {
        super();
        this.editor = editor;
        this.undoStack = [];
        this.redoStack = [];
        this.currentBatch = null;       // 当前批量操作
        this.lastSnapshotTime = 0;
        this.dirty = false;             // 是否有未保存的更改

        // 自动保存定时器
        this._autoSaveTimer = null;
    }

    /**
     * 记录操作
     */
    push(operation) {
        // 如果在批量操作中，添加到批量
        if (this.currentBatch) {
            this.currentBatch.operations.push(operation);
            return;
        }

        // 清空重做栈
        this.redoStack = [];

        // 添加到撤销栈
        this.undoStack.push(operation);

        // 限制栈大小
        if (this.undoStack.length > HistoryManager.MAX_UNDO_STACK) {
            this.undoStack.shift();
        }

        this.dirty = true;
        this.emit('change', { canUndo: this.canUndo(), canRedo: this.canRedo() });

        // 检查是否需要创建快照
        this._checkSnapshot();
    }

    /**
     * 开始批量操作（多个操作合并为一个撤销步骤）
     */
    beginBatch(description = '') {
        if (this.currentBatch) {
            console.warn('[HistoryManager] 已有批量操作进行中');
            return;
        }
        this.currentBatch = {
            type: 'batch',
            description,
            timestamp: Date.now(),
            operations: [],
        };
    }

    /**
     * 提交批量操作
     */
    commitBatch() {
        if (!this.currentBatch) return;

        if (this.currentBatch.operations.length > 0) {
            this.redoStack = [];
            this.undoStack.push(this.currentBatch);

            if (this.undoStack.length > HistoryManager.MAX_UNDO_STACK) {
                this.undoStack.shift();
            }

            this.dirty = true;
            this.emit('change', { canUndo: this.canUndo(), canRedo: this.canRedo() });
        }

        this.currentBatch = null;
    }

    /**
     * 取消批量操作
     */
    cancelBatch() {
        if (!this.currentBatch) return;

        // 回滚批量中的所有操作
        for (let i = this.currentBatch.operations.length - 1; i >= 0; i--) {
            this._applyOperation(this.currentBatch.operations[i], true);
        }

        this.currentBatch = null;
    }

    /**
     * 撤销
     */
    undo() {
        if (!this.canUndo()) return false;

        const operation = this.undoStack.pop();
        this._applyOperation(operation, true); // reverse
        this.redoStack.push(operation);

        this.dirty = true;
        this.emit('change', { canUndo: this.canUndo(), canRedo: this.canRedo() });
        this.emit('undo', operation);

        return true;
    }

    /**
     * 重做
     */
    redo() {
        if (!this.canRedo()) return false;

        const operation = this.redoStack.pop();
        this._applyOperation(operation, false); // forward
        this.undoStack.push(operation);

        this.dirty = true;
        this.emit('change', { canUndo: this.canUndo(), canRedo: this.canRedo() });
        this.emit('redo', operation);

        return true;
    }

    canUndo() {
        return this.undoStack.length > 0;
    }

    canRedo() {
        return this.redoStack.length > 0;
    }

    /**
     * 清空历史
     */
    clear() {
        this.undoStack = [];
        this.redoStack = [];
        this.currentBatch = null;
        this.dirty = false;
        this.emit('change', { canUndo: false, canRedo: false });
    }

    /**
     * 标记为已保存
     */
    markSaved() {
        this.dirty = false;
    }

    /**
     * 是否有未保存的更改
     */
    isDirty() {
        return this.dirty;
    }

    /**
     * 应用操作（撤销或重做）
     */
    _applyOperation(operation, reverse = false) {
        if (operation.type === 'batch') {
            const ops = reverse ? [...operation.operations].reverse() : operation.operations;
            for (const op of ops) {
                this._applySingleOperation(op, reverse);
            }
        } else {
            this._applySingleOperation(operation, reverse);
        }

        // 触发重新渲染
        this.editor.renderCurrentSlide?.();
    }

    _applySingleOperation(op, reverse) {
        const doc = this.editor.document;
        if (!doc) return;

        switch (op.type) {
            case 'element.update': {
                const element = doc.getElementById(op.elementId);
                if (!element) return;

                for (const change of op.changes) {
                    const value = reverse ? change.oldValue : change.newValue;
                    this._setByPath(element, change.path, value);
                }
                break;
            }

            case 'element.add': {
                if (reverse) {
                    doc.removeElement(op.slideIndex, op.element.id);
                } else {
                    doc.addElement(op.slideIndex, op.element, op.index);
                }
                break;
            }

            case 'element.delete': {
                if (reverse) {
                    doc.addElement(op.slideIndex, op.element, op.index);
                } else {
                    doc.removeElement(op.slideIndex, op.element.id);
                }
                break;
            }

            case 'element.reorder': {
                const slide = doc.getSlide(op.slideIndex);
                if (!slide) return;

                const fromIndex = reverse ? op.toIndex : op.fromIndex;
                const toIndex = reverse ? op.fromIndex : op.toIndex;

                const [element] = slide.elements.splice(fromIndex, 1);
                slide.elements.splice(toIndex, 0, element);
                break;
            }

            case 'slide.update': {
                const slide = doc.getSlide(op.slideIndex);
                if (!slide) return;

                for (const change of op.changes) {
                    const value = reverse ? change.oldValue : change.newValue;
                    this._setByPath(slide, change.path, value);
                }
                break;
            }

            case 'slide.add': {
                if (reverse) {
                    doc.removeSlide(op.index);
                } else {
                    doc.addSlide(op.slide, op.index);
                }
                break;
            }

            case 'slide.delete': {
                if (reverse) {
                    doc.addSlide(op.slide, op.index);
                } else {
                    doc.removeSlide(op.index);
                }
                break;
            }

            case 'slide.reorder': {
                const fromIndex = reverse ? op.toIndex : op.fromIndex;
                const toIndex = reverse ? op.fromIndex : op.toIndex;
                doc.moveSlide(fromIndex, toIndex);
                break;
            }
        }
    }

    _setByPath(obj, path, value) {
        const parts = path.split('.');
        let current = obj;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);

            if (arrayMatch) {
                current = current[arrayMatch[1]][parseInt(arrayMatch[2])];
            } else {
                current = current[part];
            }

            if (current === undefined) return;
        }

        const lastPart = parts[parts.length - 1];
        if (value === undefined) {
            delete current[lastPart];
        } else {
            current[lastPart] = value;
        }
    }

    _getByPath(obj, path) {
        const parts = path.split('.');
        let current = obj;

        for (const part of parts) {
            const arrayMatch = part.match(/^(\w+)\[(\d+)\]$/);

            if (arrayMatch) {
                current = current[arrayMatch[1]]?.[parseInt(arrayMatch[2])];
            } else {
                current = current?.[part];
            }

            if (current === undefined) return undefined;
        }

        return current;
    }

    /**
     * 检查是否需要创建快照
     */
    async _checkSnapshot() {
        const now = Date.now();
        if (now - this.lastSnapshotTime > HistoryManager.SNAPSHOT_INTERVAL) {
            this.lastSnapshotTime = now;
            await this._createSnapshot();
        }
    }

    async _createSnapshot() {
        if (!this.editor.currentProject || !this.editor.document) return;

        try {
            await storageManager.createSnapshot(
                this.editor.currentProject.id,
                this.editor.document.slides,
                `自动快照 - ${new Date().toLocaleString()}`
            );
            console.log('[HistoryManager] 自动快照已创建');
        } catch (e) {
            console.error('[HistoryManager] 创建快照失败:', e);
        }
    }

    /**
     * 启动自动保存
     */
    startAutoSave() {
        this.stopAutoSave();
        this._autoSaveTimer = setInterval(async () => {
            if (this.dirty && this.editor.currentProject) {
                try {
                    await this.editor.saveProject();
                    console.log('[HistoryManager] 自动保存完成');
                } catch (e) {
                    console.error('[HistoryManager] 自动保存失败:', e);
                }
            }
        }, HistoryManager.AUTO_SAVE_INTERVAL);
    }

    stopAutoSave() {
        if (this._autoSaveTimer) {
            clearInterval(this._autoSaveTimer);
            this._autoSaveTimer = null;
        }
    }

    /**
     * 创建元素更新操作
     */
    static createUpdateOp(elementId, changes) {
        return {
            type: 'element.update',
            timestamp: Date.now(),
            elementId,
            changes, // [{ path, oldValue, newValue }]
        };
    }

    /**
     * 创建元素添加操作
     */
    static createAddOp(slideIndex, element, index) {
        return {
            type: 'element.add',
            timestamp: Date.now(),
            slideIndex,
            element: JSON.parse(JSON.stringify(element)),
            index,
        };
    }

    /**
     * 创建元素删除操作
     */
    static createDeleteOp(slideIndex, element, index) {
        return {
            type: 'element.delete',
            timestamp: Date.now(),
            slideIndex,
            element: JSON.parse(JSON.stringify(element)),
            index,
        };
    }
}

window.HistoryManager = HistoryManager;
