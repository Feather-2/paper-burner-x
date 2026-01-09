/**
 * 变换控制器
 * 处理元素的拖拽、缩放、旋转
 */
import { EventEmitter } from './event-emitter.js';

export class TransformController extends EventEmitter {
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

    _removeListeners() {
        if (typeof document === 'undefined') return;
        document.removeEventListener('mousemove', this._onMouseMove);
        document.removeEventListener('mouseup', this._onMouseUp);
    }

    /**
     * 解析百分比或数字值
     */
    _parseValue(val, defaultVal = 0) {
        if (val === undefined || val === null || val === 'auto') return defaultVal;
        if (typeof val === 'number') return val;
        // 解析百分比字符串如 "8%" -> 8
        const num = parseFloat(val);
        return isNaN(num) ? defaultVal : num;
    }
    
    /**
     * 开始变换
     */
    start(handleType, mousePos) {
        this._removeListeners();
        const selection = this.editor.selection.getSelection();
        if (selection.length === 0) return;

        this.active = true;
        this.handleType = handleType;
        this.startMouse = { ...mousePos };

        // 保存初始状态（解析百分比为数字）
        this.startElements = new Map();
        for (const el of selection) {
            this.startElements.set(el.id, {
                x: this._parseValue(el.x, 0),
                y: this._parseValue(el.y, 0),
                w: this._parseValue(el.w, 10),
                h: this._parseValue(el.h, 10),
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
        let delta = {
            x: mousePos.x - this.startMouse.x,
            y: mousePos.y - this.startMouse.y,
        };

        // 多选移动时，只对偏移量进行一次网格吸附，保持元素间相对位置
        const isMultiMove = this.handleType === TransformController.HANDLE.MOVE && this.startElements.size > 1;
        if (isMultiMove && this.snapToGrid) {
            delta.x = Math.round(delta.x / this.gridSize) * this.gridSize;
            delta.y = Math.round(delta.y / this.gridSize) * this.gridSize;
        }

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

            // 网格吸附（单选时或非移动操作时）
            if (this.snapToGrid && !isMultiMove) {
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
        // 注意：document 是“唯一编辑源”，但拖拽过程中仍需要同步更新 PPTGenerator.slides：
        // - 拖拽期间仅做 _updateDOMPositions（不完全 render）以优化性能
        // - 期间可能有其它逻辑读取 PPTGenerator（例如自动保存/导出/对齐等），如果只更新 document 会读到旧值
        // - 在 _onMouseUp 结束时会调用 renderCurrentSlide() 做一次完整渲染/同步，确保最终一致性
        const slideIndex = this.editor.currentSlideIndex;
        const pptSlide = window.PPTGenerator?.slides?.[slideIndex];
        
        for (const { id, changes } of updates) {
            // 将数字转换为百分比字符串
            const formattedChanges = {
                x: `${changes.x}%`,
                y: `${changes.y}%`,
                w: `${changes.w}%`,
                h: `${changes.h}%`,
                rotation: changes.rotation
            };
            
            // 更新 document（使用当前页数据源，避免跨页同名 ID 冲突）
            const element = this.editor.findElementById(id);
            if (element) {
                Object.assign(element, formattedChanges);
            }
            
            // 更新 PPTGenerator.slides（使用 slideIndex 确保更新正确页面）
            if (pptSlide?.elements) {
                const pptElement = pptSlide.elements.find(el => el.id === id);
                if (pptElement) {
                    Object.assign(pptElement, formattedChanges);
                }
            }
        }

        // 拖拽过程中只更新 DOM 样式，不完全重新渲染（性能优化）
        this._updateDOMPositions(updates);
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

        this._removeListeners();

        // 记录历史操作 - 使用百分比字符串格式
        const slideIndex = this.editor.currentSlideIndex;
        const pptSlide = window.PPTGenerator?.slides?.[slideIndex];
        
        for (const [id, start] of this.startElements) {
            const pptElement = pptSlide?.elements?.find(el => el.id === id);
            if (!pptElement) continue;

            // 转换 start 为百分比字符串格式
            const oldX = `${start.x}%`;
            const oldY = `${start.y}%`;
            const oldW = `${start.w}%`;
            const oldH = `${start.h}%`;

            const elementChanges = [];
            if (oldX !== pptElement.x) elementChanges.push({ path: 'x', oldValue: oldX, newValue: pptElement.x });
            if (oldY !== pptElement.y) elementChanges.push({ path: 'y', oldValue: oldY, newValue: pptElement.y });
            if (oldW !== pptElement.w) elementChanges.push({ path: 'w', oldValue: oldW, newValue: pptElement.w });
            if (oldH !== pptElement.h) elementChanges.push({ path: 'h', oldValue: oldH, newValue: pptElement.h });
            if (start.rotation !== pptElement.rotation) elementChanges.push({ path: 'rotation', oldValue: start.rotation, newValue: pptElement.rotation });

            if (elementChanges.length > 0) {
                this.editor.history.push({
                    type: 'element.update',
                    elementId: id,
                    slideIndex: slideIndex,
                    changes: elementChanges
                });
            }
        }

        // 提交批量操作
        this.editor.history.commitBatch();
        
        // 拖拽结束后做一次完整渲染以确保同步
        this.editor.renderCurrentSlide?.();
        
        // 触发自动保存
        if (typeof window.PPTGenerator?.setAutoSaveNeeded === 'function') {
            window.PPTGenerator.setAutoSaveNeeded();
        }

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

        this._removeListeners();

        // 恢复初始状态
        // 说明：拖拽过程中我们同步更新了 document 与 PPTGenerator.slides；取消时也必须同时回滚两者，
        // 避免后续读取任一数据源时出现不一致，最终再通过 renderCurrentSlide() 统一重绘/同步。
        const slideIndex = this.editor.currentSlideIndex;
        const pptSlide = window.PPTGenerator?.slides?.[slideIndex];

        for (const [id, start] of this.startElements) {
            // 将数字转换为百分比字符串，保持数据格式一致
            const formattedStart = {
                x: `${start.x}%`,
                y: `${start.y}%`,
                w: `${start.w}%`,
                h: `${start.h}%`,
                rotation: start.rotation
            };

            const element = this.editor.findElementById(id);
            if (element) {
                Object.assign(element, formattedStart);
            }

            if (pptSlide?.elements) {
                const pptElement = pptSlide.elements.find(el => el.id === id);
                if (pptElement) {
                    Object.assign(pptElement, formattedStart);
                }
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
     * 直接更新 DOM 元素位置（拖拽时性能优化）
     */
    _updateDOMPositions(updates) {
        const viewport = this.editor.viewport;
        if (!viewport) return;
        
        for (const { id, changes } of updates) {
            // 查找对应的 DOM 元素
            const domEl = viewport.querySelector(`[data-element-id="${id}"]`);
            if (domEl) {
                domEl.style.left = `${changes.x}%`;
                domEl.style.top = `${changes.y}%`;
                domEl.style.width = `${changes.w}%`;
                domEl.style.height = `${changes.h}%`;
                if (changes.rotation !== undefined) {
                    domEl.style.transform = `rotate(${changes.rotation}deg)`;
                }
            }
        }
        
        // 强制浏览器重排，确保 getBoundingClientRect 返回最新值
        viewport.offsetHeight;
        
        // 更新选择覆盖层
        this.editor._updateOverlay?.();
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

// 兼容：全局挂载（给 legacy IIFE/脚本使用）
if (typeof window !== 'undefined') {
    window.TransformController = TransformController;
}
