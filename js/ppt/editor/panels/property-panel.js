/**
 * 属性面板
 * 显示和编辑选中元素的属性
 */
class PropertyPanel extends EventEmitter {
    constructor(editor, containerId) {
        super();
        this.editor = editor;
        this.container = document.getElementById(containerId);
        this.currentElement = null;

        if (!this.container) {
            console.warn('[PropertyPanel] 容器不存在:', containerId);
            return;
        }

        // 监听选择变化
        this.editor.selection.on('change', (data) => {
            this.refresh(data.elements[0] || null);
        });
    }

    /**
     * 刷新面板
     */
    refresh(element = null) {
        this.currentElement = element;

        if (!element) {
            this.container.innerHTML = this._renderEmpty();
            return;
        }

        this.container.innerHTML = this._renderElement(element);
        this._bindEvents();
    }

    _renderEmpty() {
        return `
            <div class="property-panel-empty">
                <p style="color: #9ca3af; text-align: center; padding: 20px;">
                    选择一个元素以编辑属性
                </p>
            </div>
        `;
    }

    _renderElement(element) {
        const commonProps = this._renderCommonProperties(element);
        const typeProps = this._renderTypeProperties(element);

        return `
            <div class="property-panel-content">
                <div class="property-section">
                    <div class="property-section-title">位置和大小</div>
                    ${commonProps}
                </div>
                ${typeProps}
                <div class="property-section">
                    <div class="property-section-title">效果</div>
                    ${this._renderEffectProperties(element)}
                </div>
            </div>
        `;
    }

    _renderCommonProperties(el) {
        // 解析数值（可能是字符串如 "10%" 或数字）
        const parseNum = (val, def = 0) => {
            if (val === undefined || val === null) return def;
            const num = typeof val === 'string' ? parseFloat(val) : val;
            return isNaN(num) ? def : num;
        };

        const x = parseNum(el.x, 0).toFixed(1);
        const y = parseNum(el.y, 0).toFixed(1);
        const w = parseNum(el.w, 10).toFixed(1);
        const h = parseNum(el.h, 10).toFixed(1);
        const rotation = parseNum(el.rotation, 0);
        const z = parseNum(el.z, 0);

        return `
            <div class="property-row">
                <label>X</label>
                <input type="number" data-prop="x" value="${x}" step="0.5">
                <span>%</span>
            </div>
            <div class="property-row">
                <label>Y</label>
                <input type="number" data-prop="y" value="${y}" step="0.5">
                <span>%</span>
            </div>
            <div class="property-row">
                <label>宽度</label>
                <input type="number" data-prop="w" value="${w}" step="0.5" min="1">
                <span>%</span>
            </div>
            <div class="property-row">
                <label>高度</label>
                <input type="number" data-prop="h" value="${h}" step="0.5" min="1">
                <span>%</span>
            </div>
            <div class="property-row">
                <label>旋转</label>
                <input type="number" data-prop="rotation" value="${rotation}" step="5">
                <span>°</span>
            </div>
            <div class="property-row">
                <label>层级</label>
                <input type="number" data-prop="z" value="${z}" step="1">
            </div>
        `;
    }

    _renderEffectProperties(el) {
        const blendModes = [
            'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
            'color-dodge', 'color-burn', 'hard-light', 'soft-light',
            'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'
        ];

        return `
            <div class="property-row">
                <label>不透明度</label>
                <input type="range" data-prop="opacity" value="${(el.opacity ?? 1) * 100}" min="0" max="100">
                <span>${Math.round((el.opacity ?? 1) * 100)}%</span>
            </div>
            <div class="property-row">
                <label>混合模式</label>
                <select data-prop="blend">
                    ${blendModes.map(m => `<option value="${m}" ${el.blend === m ? 'selected' : ''}>${m}</option>`).join('')}
                </select>
            </div>
            <div class="property-row">
                <label>模糊</label>
                <input type="range" data-prop="blur" value="${this._parseBlur(el.filter)}" min="0" max="20">
                <span>${this._parseBlur(el.filter)}px</span>
            </div>
        `;
    }

    _renderTypeProperties(element) {
        switch (element.type) {
            case 'text':
                return this._renderTextProperties(element);
            case 'image':
                return this._renderImageProperties(element);
            case 'shape':
                return this._renderShapeProperties(element);
            case 'chart':
                return this._renderChartProperties(element);
            case 'formula':
                return this._renderFormulaProperties(element);
            case 'icon':
                return this._renderIconProperties(element);
            default:
                return '';
        }
    }

    _renderTextProperties(el) {
        return `
            <div class="property-section">
                <div class="property-section-title">文本</div>
                <div class="property-row">
                    <label>字号</label>
                    <input type="number" data-prop="fontSize" value="${el.fontSize || 24}" min="8" max="200">
                    <span>px</span>
                </div>
                <div class="property-row">
                    <label>颜色</label>
                    <input type="color" data-prop="color" value="${el.color || '#1f2937'}">
                </div>
                <div class="property-row">
                    <label>粗细</label>
                    <select data-prop="fontWeight">
                        <option value="normal" ${el.fontWeight === 'normal' ? 'selected' : ''}>正常</option>
                        <option value="bold" ${el.fontWeight === 'bold' ? 'selected' : ''}>粗体</option>
                    </select>
                </div>
                <div class="property-row">
                    <label>对齐</label>
                    <select data-prop="align">
                        <option value="left" ${el.align === 'left' ? 'selected' : ''}>左对齐</option>
                        <option value="center" ${el.align === 'center' ? 'selected' : ''}>居中</option>
                        <option value="right" ${el.align === 'right' ? 'selected' : ''}>右对齐</option>
                    </select>
                </div>
                <div class="property-row full-width">
                    <label>内容</label>
                    <textarea data-prop="content" rows="3">${el.content || ''}</textarea>
                </div>
            </div>
        `;
    }

    _renderImageProperties(el) {
        return `
            <div class="property-section">
                <div class="property-section-title">图片</div>
                <div class="property-row">
                    <label>填充方式</label>
                    <select data-prop="objectFit">
                        <option value="cover" ${el.objectFit === 'cover' ? 'selected' : ''}>填充</option>
                        <option value="contain" ${el.objectFit === 'contain' ? 'selected' : ''}>适应</option>
                        <option value="fill" ${el.objectFit === 'fill' ? 'selected' : ''}>拉伸</option>
                    </select>
                </div>
                <div class="property-row">
                    <label>遮罩</label>
                    <select data-prop="mask">
                        <option value="" ${!el.mask ? 'selected' : ''}>无</option>
                        <option value="circle" ${el.mask === 'circle' ? 'selected' : ''}>圆形</option>
                        <option value="rounded" ${el.mask === 'rounded' ? 'selected' : ''}>圆角</option>
                    </select>
                </div>
                <div class="property-row">
                    <button class="property-btn" data-action="replace-image">更换图片</button>
                </div>
            </div>
        `;
    }

    _renderShapeProperties(el) {
        return `
            <div class="property-section">
                <div class="property-section-title">形状</div>
                <div class="property-row">
                    <label>类型</label>
                    <select data-prop="shapeType">
                        <option value="rect" ${el.shapeType === 'rect' ? 'selected' : ''}>矩形</option>
                        <option value="roundRect" ${el.shapeType === 'roundRect' ? 'selected' : ''}>圆角矩形</option>
                        <option value="ellipse" ${el.shapeType === 'ellipse' ? 'selected' : ''}>椭圆</option>
                        <option value="triangle" ${el.shapeType === 'triangle' ? 'selected' : ''}>三角形</option>
                    </select>
                </div>
                <div class="property-row">
                    <label>填充色</label>
                    <input type="color" data-prop="fill" value="${el.fill || '#3b82f6'}">
                </div>
                <div class="property-row">
                    <label>边框色</label>
                    <input type="color" data-prop="stroke" value="${el.stroke || '#000000'}">
                </div>
                <div class="property-row">
                    <label>圆角</label>
                    <input type="number" data-prop="borderRadius" value="${el.borderRadius || 0}" min="0" max="50">
                    <span>%</span>
                </div>
            </div>
        `;
    }

    _renderChartProperties(el) {
        return `
            <div class="property-section">
                <div class="property-section-title">图表</div>
                <div class="property-row">
                    <label>类型</label>
                    <select data-prop="chartType">
                        <option value="bar" ${el.chartType === 'bar' ? 'selected' : ''}>柱状图</option>
                        <option value="line" ${el.chartType === 'line' ? 'selected' : ''}>折线图</option>
                        <option value="pie" ${el.chartType === 'pie' ? 'selected' : ''}>饼图</option>
                        <option value="doughnut" ${el.chartType === 'doughnut' ? 'selected' : ''}>环形图</option>
                    </select>
                </div>
                <div class="property-row">
                    <label>标题</label>
                    <input type="text" data-prop="title" value="${el.title || ''}">
                </div>
                <div class="property-row full-width">
                    <label>数据 (格式: 标签:值,标签:值)</label>
                    <textarea data-prop="chartData" rows="2">${el.chartData || ''}</textarea>
                </div>
                <div class="property-row full-width">
                    <label>颜色 (逗号分隔)</label>
                    <input type="text" data-prop="colors" value="${el.colors || '#3b82f6,#10b981,#f59e0b'}">
                </div>
            </div>
        `;
    }

    _renderFormulaProperties(el) {
        return `
            <div class="property-section">
                <div class="property-section-title">公式</div>
                <div class="property-row full-width">
                    <label>LaTeX 代码</label>
                    <textarea data-prop="latex" rows="3">${el.latex || ''}</textarea>
                </div>
                <div class="property-row">
                    <label>显示模式</label>
                    <select data-prop="displayMode">
                        <option value="true" ${el.displayMode ? 'selected' : ''}>块级</option>
                        <option value="false" ${!el.displayMode ? 'selected' : ''}>行内</option>
                    </select>
                </div>
            </div>
        `;
    }

    _renderIconProperties(el) {
        return `
            <div class="property-section">
                <div class="property-section-title">图标</div>
                <div class="property-row">
                    <label>图标名</label>
                    <input type="text" data-prop="icon" value="${el.icon || 'mdi:star'}">
                </div>
                <div class="property-row">
                    <label>颜色</label>
                    <input type="color" data-prop="color" value="${el.color || '#3b82f6'}">
                </div>
            </div>
        `;
    }

    _bindEvents() {
        if (!this.container || !this.currentElement) return;

        // 输入框变化
        this.container.querySelectorAll('input, select, textarea').forEach(input => {
            const prop = input.dataset.prop;
            if (!prop) return;

            const handler = (e) => {
                let value = input.type === 'checkbox' ? input.checked : input.value;

                // 类型转换
                if (input.type === 'number' || input.type === 'range') {
                    value = parseFloat(value);
                }
                if (prop === 'opacity') {
                    value = value / 100;
                }
                if (prop === 'blur') {
                    value = value > 0 ? `blur(${value}px)` : '';
                    this.editor.updateElement(this.currentElement.id, { filter: value });
                    return;
                }
                if (prop === 'displayMode') {
                    value = value === 'true';
                }

                this.editor.updateElement(this.currentElement.id, { [prop]: value });
            };

            input.addEventListener('change', handler);
            if (input.type === 'range') {
                input.addEventListener('input', handler);
            }
        });

        // 按钮操作
        this.container.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                this.emit('action', { action, element: this.currentElement });
            });
        });
    }

    _parseBlur(filter) {
        if (!filter) return 0;
        const match = filter.match(/blur\((\d+)px\)/);
        return match ? parseInt(match[1]) : 0;
    }
}

window.PropertyPanel = PropertyPanel;
