/**
 * 属性面板
 * 显示和编辑选中元素的属性
 * 支持多选批量编辑
 */
class PropertyPanel extends EventEmitter {
    constructor(editor, containerId) {
        super();
        this.editor = editor;
        this.container = document.getElementById(containerId);
        this.currentElement = null;
        this.selectedElements = []; // 所有选中的元素

        if (!this.container) {
            console.warn('[PropertyPanel] 容器不存在:', containerId);
            return;
        }

        // 监听选择变化
        this.editor.selection.on('change', (data) => {
            this.selectedElements = data.elements || [];
            this.currentElement = this.selectedElements[0] || null;
            this.refresh();
        });
    }

    /**
     * 刷新面板
     */
    refresh() {
        if (this.selectedElements.length === 0) {
            this.container.innerHTML = this._renderEmpty();
            return;
        }

        if (this.selectedElements.length > 1) {
            // 多选模式
            this.container.innerHTML = this._renderMultiSelect();
        } else {
            // 单选模式
            this.container.innerHTML = this._renderElement(this.currentElement);
        }
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

    /**
     * 渲染多选编辑面板
     */
    _renderMultiSelect() {
        const count = this.selectedElements.length;
        const types = [...new Set(this.selectedElements.map(e => e.type))];
        const sameType = types.length === 1;
        
        // 获取共同属性的当前值（如果相同则显示，否则显示混合）
        const getCommonValue = (prop, defaultVal) => {
            const values = this.selectedElements.map(e => e[prop]);
            const firstVal = values[0];
            return values.every(v => v === firstVal) ? (firstVal ?? defaultVal) : null;
        };
        
        const opacity = getCommonValue('opacity', 1);
        
        let typeSpecificHtml = '';
        
        // 如果所有元素类型相同，显示类型特定属性
        if (sameType) {
            const type = types[0];
            if (type === 'text' || type === 'formula') {
                const fontSize = getCommonValue('fontSize', null) || getCommonValue('font', 24);
                const color = getCommonValue('color', '#1f2937');
                typeSpecificHtml = `
                    <div class="property-section">
                        <div class="property-section-title">文本样式</div>
                        <div class="property-row">
                            <label>字号</label>
                            <input type="number" data-prop="fontSize" value="${fontSize || ''}" placeholder="混合" min="8" max="200">
                            <span>px</span>
                        </div>
                        <div class="property-row">
                            <label>颜色</label>
                            <input type="color" data-prop="color" value="${color || '#000000'}">
                        </div>
                    </div>
                `;
            } else if (type === 'image' || type === 'shape') {
                typeSpecificHtml = `
                    <div class="property-section">
                        <div class="property-section-title">外观</div>
                        <div class="property-row">
                            <label>填充</label>
                            <input type="color" data-prop="fill" value="${getCommonValue('fill', '#ffffff') || '#ffffff'}">
                        </div>
                    </div>
                `;
            }
        }
        
        return `
            <div class="property-panel-content">
                <div class="property-section">
                    <div class="property-section-title">
                        多选编辑 <span style="color: #6b7280; font-weight: normal;">(${count} 个元素)</span>
                    </div>
                    <p style="color: #9ca3af; font-size: 12px; margin: 8px 0;">
                        ${sameType ? `类型: ${types[0]}` : `混合类型: ${types.join(', ')}`}
                    </p>
                </div>
                <div class="property-section">
                    <div class="property-section-title">通用属性</div>
                    <div class="property-row">
                        <label>透明度</label>
                        <input type="range" data-prop="opacity" value="${(opacity ?? 1) * 100}" min="0" max="100">
                        <span>${Math.round((opacity ?? 1) * 100)}%</span>
                    </div>
                </div>
                ${typeSpecificHtml}
                <div class="property-section">
                    <div class="property-section-title">批量操作</div>
                    <div class="property-row" style="flex-direction: column; gap: 8px;">
                        <button class="property-btn" data-action="delete-selected" style="width: 100%; background: #fee2e2; color: #dc2626;">
                            删除选中 (${count})
                        </button>
                    </div>
                </div>
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

        const shadowEffects = [
            { value: '', label: '无阴影' },
            { value: 'shadow-sm', label: '小阴影 (SM)' },
            { value: 'shadow-md', label: '中阴影 (MD)' },
            { value: 'shadow-lg', label: '大阴影 (LG)' },
            { value: 'shadow-xl', label: '特大阴影 (XL)' },
            { value: 'shadow-2xl', label: '超大阴影 (2XL)' },
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
                <label>阴影效果</label>
                <select data-prop="effect">
                    ${shadowEffects.map(s => `<option value="${s.value}" ${el.effect === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
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
            case 'list':
                return this._renderListProperties(element);
            default:
                return '';
        }
    }

    _renderTextProperties(el) {
        // 兼容旧的 font 属性
        const fontSizeVal = el.fontSize || el.font || 24;
        const letterSpacingVal = parseFloat(el.letterSpacing) || 0;
        const lineHeightVal = el.lineHeight || 1.4;
        
        // 常用字体列表
        const fonts = [
            { value: '', label: '默认' },
            { value: 'Arial', label: 'Arial' },
            { value: 'Arial Black', label: 'Arial Black' },
            { value: 'Georgia', label: 'Georgia' },
            { value: 'Times New Roman', label: 'Times New Roman' },
            { value: 'Courier New', label: 'Courier New' },
            { value: 'Verdana', label: 'Verdana' },
            { value: 'Impact', label: 'Impact' },
            { value: 'Microsoft YaHei', label: '微软雅黑' },
            { value: 'SimHei', label: '黑体' },
            { value: 'SimSun', label: '宋体' },
            { value: 'KaiTi', label: '楷体' },
        ];
        
        return `
            <div class="property-section">
                <div class="property-section-title">文本</div>
                <div class="property-row">
                    <label>字号</label>
                    <input type="number" data-prop="fontSize" value="${fontSizeVal}" min="8" max="200">
                    <span>px</span>
                </div>
                <div class="property-row">
                    <label>颜色</label>
                    <input type="color" data-prop="color" value="${el.color || '#1f2937'}">
                </div>
                <div class="property-row">
                    <label>字体</label>
                    <select data-prop="fontFamily">
                        ${fonts.map(f => `<option value="${f.value}" ${el.fontFamily === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}
                    </select>
                </div>
                <div class="property-row">
                    <label>粗细</label>
                    <select data-prop="fontWeight">
                        <option value="normal" ${el.fontWeight === 'normal' ? 'selected' : ''}>正常</option>
                        <option value="bold" ${el.fontWeight === 'bold' || el.bold ? 'selected' : ''}>粗体</option>
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
                <div class="property-row">
                    <label>字间距</label>
                    <input type="number" data-prop="letterSpacing" value="${letterSpacingVal}" min="-5" max="20" step="0.5">
                    <span>px</span>
                </div>
                <div class="property-row">
                    <label>行高</label>
                    <input type="number" data-prop="lineHeight" value="${lineHeightVal}" min="0.8" max="3" step="0.1">
                </div>
                <div class="property-row" style="gap: 12px;">
                    <label>装饰</label>
                    <label class="checkbox-label" title="下划线">
                        <input type="checkbox" data-prop="underline" ${el.underline ? 'checked' : ''}>
                        <span style="text-decoration: underline;">U</span>
                    </label>
                    <label class="checkbox-label" title="删除线">
                        <input type="checkbox" data-prop="strike" ${el.strike ? 'checked' : ''}>
                        <span style="text-decoration: line-through;">S</span>
                    </label>
                    <label class="checkbox-label" title="斜体">
                        <input type="checkbox" data-prop="italic" ${el.italic ? 'checked' : ''}>
                        <span style="font-style: italic;">I</span>
                    </label>
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
        const fontSize = el.fontSize || 18;
        return `
            <div class="property-section">
                <div class="property-section-title">公式</div>
                <div class="property-row">
                    <label>字号</label>
                    <input type="number" data-prop="fontSize" value="${fontSize}" min="8" max="100">
                    <span>px</span>
                </div>
                <div class="property-row">
                    <label>颜色</label>
                    <input type="color" data-prop="color" value="${el.color || '#1e293b'}">
                </div>
                <div class="property-row">
                    <label>显示模式</label>
                    <select data-prop="displayMode">
                        <option value="true" ${el.displayMode !== false ? 'selected' : ''}>块级</option>
                        <option value="false" ${el.displayMode === false ? 'selected' : ''}>行内</option>
                    </select>
                </div>
                <div class="property-row full-width">
                    <label>LaTeX 代码</label>
                    <textarea data-prop="latex" rows="3">${el.latex || el.content || ''}</textarea>
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

    _renderListProperties(el) {
        const itemsStr = Array.isArray(el.items) ? el.items.join('\n') : '';
        return `
            <div class="property-section">
                <div class="property-section-title">列表</div>
                <div class="property-row">
                    <label>类型</label>
                    <select data-prop="listType">
                        <option value="ul" ${el.listType === 'ul' ? 'selected' : ''}>无序列表 (●)</option>
                        <option value="ol" ${el.listType === 'ol' ? 'selected' : ''}>有序列表 (1.)</option>
                    </select>
                </div>
                <div class="property-row">
                    <label>字号</label>
                    <input type="number" data-prop="font" value="${el.font || 16}" min="8" max="72">
                    <span>px</span>
                </div>
                <div class="property-row">
                    <label>颜色</label>
                    <input type="color" data-prop="color" value="${el.color || '#333333'}">
                </div>
                <div class="property-row">
                    <label>符号颜色</label>
                    <input type="color" data-prop="bulletColor" value="${el.bulletColor || el.color || '#333333'}">
                </div>
                <div class="property-row">
                    <label>行高</label>
                    <input type="number" data-prop="lineHeight" value="${el.lineHeight || 1.6}" min="1" max="3" step="0.1">
                </div>
                <div class="property-row">
                    <label>缩进</label>
                    <input type="number" data-prop="indent" value="${el.indent || 24}" min="0" max="100">
                    <span>px</span>
                </div>
                <div class="property-row full-width">
                    <label>列表项 (每行一项)</label>
                    <textarea data-prop="items" rows="5" placeholder="每行输入一个列表项">${itemsStr}</textarea>
                </div>
            </div>
        `;
    }

    _bindEvents() {
        if (!this.container || this.selectedElements.length === 0) return;

        const isMultiSelect = this.selectedElements.length > 1;

        // 输入框变化
        this.container.querySelectorAll('input, select, textarea').forEach(input => {
            const prop = input.dataset.prop;
            if (!prop) return;

            const handler = (e) => {
                let value = input.type === 'checkbox' ? input.checked : input.value;

                // 类型转换
                if (input.type === 'number' || input.type === 'range') {
                    value = parseFloat(value);
                    if (isNaN(value)) return; // 空值不更新
                }
                if (prop === 'opacity') {
                    value = value / 100;
                }
                if (prop === 'blur') {
                    value = value > 0 ? `blur(${value}px)` : '';
                    // 批量更新
                    for (const el of this.selectedElements) {
                        this.editor.updateElement(el.id, { filter: value });
                    }
                    return;
                }
                if (prop === 'displayMode') {
                    value = value === 'true';
                }
                // 列表项：换行分隔转数组
                if (prop === 'items') {
                    value = value.split('\n').map(s => s.trim()).filter(Boolean);
                }

                // 批量更新所有选中元素
                for (const el of this.selectedElements) {
                    this.editor.updateElement(el.id, { [prop]: value });
                }
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
                if (action === 'delete-selected') {
                    // 批量删除
                    for (const el of this.selectedElements) {
                        this.editor.removeElement(el.id);
                    }
                    this.editor.selection.deselectAll();
                } else {
                    this.emit('action', { action, element: this.currentElement, elements: this.selectedElements });
                }
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
