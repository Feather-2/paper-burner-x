/**
 * 非破坏性裁剪处理器
 * 仅存储裁剪参数，渲染时实时应用
 */
export class CropHandler {
    constructor(element) {
        this.element = element;
        this.crop = element?.editParams?.crop || this.getDefaultCrop();
    }
    
    getDefaultCrop() {
        return { x: 0, y: 0, w: 1, h: 1, rotation: 0 };
    }
    
    /**
     * 更新裁剪参数
     * @param {Object} newCrop - { x, y, w, h, rotation }（百分比 0-1）
     * @returns {Object} 历史操作对象
     */
    updateCrop(newCrop) {
        const oldCrop = { ...this.crop };
        Object.assign(this.crop, newCrop);
        
        // 更新元素
        if (!this.element.editParams) this.element.editParams = {};
        this.element.editParams.crop = { ...this.crop };
        
        return {
            type: 'element.update',
            elementId: this.element.id,
            changes: [
                { path: 'editParams.crop', oldValue: oldCrop, newValue: this.crop }
            ]
        };
    }
    
    /**
     * 获取 CSS clip-path 值
     * @returns {string} CSS clip-path 值（inset 格式）
     */
    getClipPath() {
        const { x, y, w, h } = this.crop;
        if (x === 0 && y === 0 && w === 1 && h === 1) return 'none';
        
        const top = y * 100;
        const right = (1 - x - w) * 100;
        const bottom = (1 - y - h) * 100;
        const left = x * 100;
        
        return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
    }
    
    /**
     * 获取 CSS transform 值（旋转）
     * @returns {string} CSS transform 值
     */
    getTransform() {
        if (!this.crop.rotation) return 'none';
        return `rotate(${this.crop.rotation}deg)`;
    }
    
    /**
     * 重置裁剪
     * @returns {Object} 历史操作对象
     */
    reset() {
        return this.updateCrop(this.getDefaultCrop());
    }
    
    /**
     * 检查是否有裁剪
     * @returns {boolean}
     */
    hasCrop() {
        const { x, y, w, h, rotation } = this.crop;
        return x !== 0 || y !== 0 || w !== 1 || h !== 1 || rotation !== 0;
    }
}

export default CropHandler;

