/**
 * 变换控制器
 * 处理元素的拖拽、缩放、旋转
 */
class TransformController extends EventEmitter {
    // 手柄类型
    static HANDLE = {
        MOVE: 'move',
        N: 'n', S: 's', E: 'e', W: 'w',
        NE: 'ne', NW: 'nw', SE: 'se', SW: 'sw',
        ROTATE: 'rotate',
    };

    constructor(editor) {
        super();
        this.editor = editor;

        // 变换状态
        this.active = false;
        this.handleType = null;
        this.startMouse = null;
        this.startElements = null; // Map<id, {x,y,w,h,rotation}>

        // 约束
        this.snapToGrid = false;
        this.gridSize = 5;
        this.keepAspectRatio = false;
        this.centerOrigin = false;

        // 绑定事件处理
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
    }

    /**
     * 开始变换
     */
    start(handleType, mousePos) {
        const selection = this.editor.selection.getSelection();
        if (selection.length === 0) return;

        this.active = true;
        this.handleType = handleType;
        this.startMouse = { ...mousePos };

        // 保存初始状态
        this.startElements = new Map();
        for (const el of selection) {
            this.startElements.set(el.id, {
                x: el.x,
                y: el.y,
                w: el.w,
                h: el.h,
                rotation: el.rotation || 0,
            });
        }

        // 开始批量操作
        this.editor.history.beginBatch('变换');

        // 监听全局鼠标事件
        document.addEventListener('mousemove', this._onMouseMove);
        document.addEventListener('mouseup', this._onMouseUp);

        this.emit('start', { handleType, elements: selection });
    }

    /**
     * 鼠标移动处理
     */
    _onMouseMove(e) {
        if (!this.active) return;

        const viewport = this.editor.viewport;
        if (!viewport) return;

        const rect = viewport.getBoundingClientRect();
        const mousePos = {
            x: ((e.clientX - rect.left) / rect.width) * 100,
            y: ((e.clientY - rect.top) / rect.height) * 100,
        };

        this._applyTransform(mousePos);
    }

    /**
     * 应用变换
     */
    _applyTransform(mousePos) {
        const delta = {
            x: mousePos.x - this.startMouse.x,
            y: mousePos.y - this.startMouse.y,
        };

        const updates = [];

        for (const [id, start] of this.startElements) {
            let newState = { ...start };

            if (this.handleType === TransformController.HANDLE.MOVE) {
                // 移动
                newState.x = start.x + delta.x;
                newState.y = start.y + delta.y;
            } else if (this.handleType === TransformController.HANDLE.ROTATE) {
                // 旋转（计算角度变化）
                const center = {
                    x: start.x + start.w / 2,
                    y: start.y + start.h / 2,
                };
                const startAngle = Math.atan2(
                    this.startMouse.y - center.y,
                    this.startMouse.x - center.x
                );
                const currentAngle = Math.atan2(
                    mousePos.y - center.y,
                    mousePos.x - center.x
                );
                const deltaAngle = (currentAngle - startAngle) * (180 / Math.PI);
                newState.rotation = start.rotation + deltaAngle;
            } else {
                // 缩放
                newState = this._calculateResize(start, delta, this.handleType);
            }

            // 网格吸附
            if (this.snapToGrid) {
                newState.x = Math.round(newState.x / this.gridSize) * this.gridSize;
                newState.y = Math.round(newState.y / this.gridSize) * this.gridSize;
                newState.w = Math.round(newState.w / this.gridSize) * this.gridSize;
                newState.h = Math.round(newState.h / this.gridSize) * this.gridSize;
            }

            // 最小尺寸限制
            newState.w = Math.max(newState.w, 2);
            newState.h = Math.max(newState.h, 2);

            updates.push({
                id,
                changes: {
                    x: newState.x,
                    y: newState.y,
                    w: newState.w,
                    h: newState.h,
                    rotation: newState.rotation,
                },
            });
        }

        // 批量更新（不记录历史，在 end 时统一记录）
        for (const { id, changes } of updates) {
            const element = this.editor.document.getElementById(id);
            if (element) {
                Object.assign(element, changes);
            }
        }

        // 触发重新渲染
        this.editor.renderCurrentSlide?.();
        this.emit('transform', { updates });
    }

    /**
     * 计算缩放
     */
    _calculateResize(start, delta, handle) {
        let { x, y, w, h, rotation } = start;

        const keepRatio = this.keepAspectRatio;
        const ratio = w / h;

        switch (handle) {
            case TransformController.HANDLE.E:
                w = start.w + delta.x;
                if (keepRatio) h = w / ratio;
                break;

            case TransformController.HANDLE.W:
                w = start.w - delta.x;
                x = start.x + delta.x;
                if (keepRatio) {
                    h = w / ratio;
                    y = start.y + (start.h - h) / 2;
                }
                break;

            case TransformController.HANDLE.S:
                h = start.h + delta.y;
                if (keepRatio) w = h * ratio;
                break;

            case TransformController.HANDLE.N:
                h = start.h - delta.y;
                y = start.y + delta.y;
                if (keepRatio) {
                    w = h * ratio;
                    x = start.x + (start.w - w) / 2;
                }
                break;

            case TransformController.HANDLE.SE:
                w = start.w + delta.x;
                h = start.h + delta.y;
                if (keepRatio) {
                    const scale = Math.max(w / start.w, h / start.h);
                    w = start.w * scale;
                    h = start.h * scale;
                }
                break;

            case TransformController.HANDLE.SW:
                w = start.w - delta.x;
                h = start.h + delta.y;
                x = start.x + delta.x;
                if (keepRatio) {
                    const scale = Math.max(w / start.w, h / start.h);
                    w = start.w * scale;
                    h = start.h * scale;
                    x = start.x + start.w - w;
                }
                break;

            case TransformController.HANDLE.NE:
                w = start.w + delta.x;
                h = start.h - delta.y;
                y = start.y + delta.y;
                if (keepRatio) {
                    const scale = Math.max(w / start.w, h / start.h);
                    w = start.w * scale;
                    h = start.h * scale;
                    y = start.y + start.h - h;
                }
                break;

            case TransformController.HANDLE.NW:
                w = start.w - delta.x;
                h = start.h - delta.y;
                x = start.x + delta.x;
                y = start.y + delta.y;
                if (keepRatio) {
                    const scale = Math.max(w / start.w, h / start.h);
                    w = start.w * scale;
                    h = start.h * scale;
                    x = start.x + start.w - w;
                    y = start.y + start.h - h;
                }
                break;
        }

        return { x, y, w, h, rotation };
    }

    /**
     * 鼠标释放处理
     */
    _onMouseUp(e) {
        if (!this.active) return;

        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mouseup', this._onMouseUp);

        // 记录历史操作
        const changes = [];
        for (const [id, start] of this.startElements) {
            const element = this.editor.document.getElementById(id);
            if (!element) continue;

            const elementChanges = [];
            if (start.x !== element.x) elementChanges.push({ path: 'x', oldValue: start.x, newValue: element.x });
            if (start.y !== element.y) elementChanges.push({ path: 'y', oldValue: start.y, newValue: element.y });
            if (start.w !== element.w) elementChanges.push({ path: 'w', oldValue: start.w, newValue: element.w });
            if (start.h !== element.h) elementChanges.push({ path: 'h', oldValue: start.h, newValue: element.h });
            if (start.rotation !== element.rotation) elementChanges.push({ path: 'rotation', oldValue: start.rotation, newValue: element.rotation });

            if (elementChanges.length > 0) {
                this.editor.history.push(HistoryManager.createUpdateOp(id, elementChanges));
            }
        }

        // 提交批量操作
        this.editor.history.commitBatch();

        this.active = false;
        this.handleType = null;
        this.startMouse = null;
        this.startElements = null;

        this.emit('end');
    }

    /**
     * 取消变换
     */
    cancel() {
        if (!this.active) return;

        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mouseup', this._onMouseUp);

        // 恢复初始状态
        for (const [id, start] of this.startElements) {
            const element = this.editor.document.getElementById(id);
            if (element) {
                Object.assign(element, start);
            }
        }

        this.editor.history.cancelBatch();
        this.editor.renderCurrentSlide?.();

        this.active = false;
        this.handleType = null;
        this.startMouse = null;
        this.startElements = null;

        this.emit('cancel');
    }

    /**
     * 设置约束
     */
    setConstraints(options) {
        if (options.snapToGrid !== undefined) this.snapToGrid = options.snapToGrid;
        if (options.gridSize !== undefined) this.gridSize = options.gridSize;
        if (options.keepAspectRatio !== undefined) this.keepAspectRatio = options.keepAspectRatio;
        if (options.centerOrigin !== undefined) this.centerOrigin = options.centerOrigin;
    }

    /**
     * 获取手柄位置（用于渲染 UI）
     */
    getHandlePositions(bounds) {
        if (!bounds) return null;

        const { x, y, w, h } = bounds;
        const handleSize = 1; // 1%

        return {
            [TransformController.HANDLE.NW]: { x: x - handleSize / 2, y: y - handleSize / 2 },
            [TransformController.HANDLE.N]: { x: x + w / 2 - handleSize / 2, y: y - handleSize / 2 },
            [TransformController.HANDLE.NE]: { x: x + w - handleSize / 2, y: y - handleSize / 2 },
            [TransformController.HANDLE.W]: { x: x - handleSize / 2, y: y + h / 2 - handleSize / 2 },
            [TransformController.HANDLE.E]: { x: x + w - handleSize / 2, y: y + h / 2 - handleSize / 2 },
            [TransformController.HANDLE.SW]: { x: x - handleSize / 2, y: y + h - handleSize / 2 },
            [TransformController.HANDLE.S]: { x: x + w / 2 - handleSize / 2, y: y + h - handleSize / 2 },
            [TransformController.HANDLE.SE]: { x: x + w - handleSize / 2, y: y + h - handleSize / 2 },
            [TransformController.HANDLE.ROTATE]: { x: x + w / 2 - handleSize / 2, y: y - 3 },
        };
    }
}

window.TransformController = TransformController;
