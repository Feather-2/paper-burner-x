/**
 * KeyManagerUI 类负责渲染和管理单个模型的 API Key 池。
 */
const LAST_SUCCESSFUL_KEYS_LS_KEY_FOR_UI = 'paperBurnerLastSuccessfulKeys'; // 与 app.js 中保持一致

class KeyManagerUI {
    /**
     * 构造函数
     * @param {string} modelName - 当前管理的模型名称 (e.g., 'mistral', 'custom')
     * @param {HTMLElement} containerElement - Key 池 UI 将被渲染到的 DOM 容器元素
     * @param {function(string, Array<Object>)} onSaveKeys - 保存 Key 数组的回调函数 (modelName, keysArray)
     * @param {function(string, Object)} onTestKey - 测试单个 Key 的回调函数 (modelName, keyObject)
     * @param {function(string, Array<Object>)} onTestAllKeys - 测试当前模型所有 Key 的回调 (modelName, keysArray)
     * @param {function(string): Array<Object>} loadKeysFunction - 加载指定模型Key的函数
     * @param {function(string, Array<Object>)} saveKeysFunction - 保存指定模型Key的函数
     */
    constructor(modelName, containerElement, onTestKey, onTestAllKeys, loadKeysFunction, saveKeysFunction) {
        this.modelName = modelName;
        this.containerElement = containerElement;
        this.onTestKey = onTestKey; // Callback to initiate testing for a single key
        this.onTestAllKeys = onTestAllKeys; // Callback to initiate testing for all keys
        this.loadKeys = loadKeysFunction;
        this.saveKeys = saveKeysFunction;

        this.keys = this.loadKeys(this.modelName) || [];
        // 读取当前模型上次成功使用的 Key ID
        try {
            const records = JSON.parse(localStorage.getItem(LAST_SUCCESSFUL_KEYS_LS_KEY_FOR_UI) || '{}');
            this.lastSuccessfulKeyId = records[this.modelName] || null;
        } catch (e) {
            console.error('KeyManagerUI: Failed to get last successful key ID for model ' + this.modelName, e);
            this.lastSuccessfulKeyId = null;
        }
        this.render();
    }

    /**
     * 重新加载并渲染Key列表
     */
    refreshKeys() {
        this.keys = this.loadKeys(this.modelName) || [];
        this.render();
    }

    /**
     * 渲染整个 Key 池 UI
     */
    render() {
        this.containerElement.innerHTML = ''; // 清空容器

        // Create a header for buttons
        const buttonHeader = document.createElement('div');
        buttonHeader.className = 'flex items-center justify-between mb-3'; // Use flex to align items

        const leftButtons = document.createElement('div');
        leftButtons.className = 'flex items-center space-x-2';

        // 2. "全部测试"按钮 (如果存在Key)
        if (this.keys.length > 0) {
            const testAllButton = document.createElement('button');
            testAllButton.innerHTML = '<iconify-icon icon="carbon:chemistry" class="mr-1"></iconify-icon>全部测试';
            testAllButton.className = 'px-3 py-1.5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors flex items-center';
            testAllButton.addEventListener('click', () => {
                if (this.onTestAllKeys) {
                    this.onTestAllKeys(this.modelName, this.keys);
                }
            });
            leftButtons.appendChild(testAllButton);
        }

        // 导出配置按钮
        const exportButton = document.createElement('button');
        exportButton.innerHTML = '<iconify-icon icon="carbon:export" class="mr-1"></iconify-icon>导出配置';
        exportButton.className = 'px-3 py-1.5 text-sm bg-gray-500 hover:bg-gray-600 text-white rounded transition-colors flex items-center';
        exportButton.addEventListener('click', () => {
            this._exportKeys();
        });
        leftButtons.appendChild(exportButton);

        // 导入配置按钮
        const importButton = document.createElement('button');
        importButton.innerHTML = '<iconify-icon icon="carbon:import" class="mr-1"></iconify-icon>导入配置';
        importButton.className = 'px-3 py-1.5 text-sm bg-gray-500 hover:bg-gray-600 text-white rounded transition-colors flex items-center';
        importButton.addEventListener('click', () => {
            this._importKeys();
        });
        leftButtons.appendChild(importButton);

        buttonHeader.appendChild(leftButtons);

        // "Add New Key" button (plus icon)
        const addNewKeyButton = document.createElement('button');
        addNewKeyButton.innerHTML = '<iconify-icon icon="carbon:add" width="20"></iconify-icon>';
        addNewKeyButton.title = '添加新的 API Key';
        addNewKeyButton.className = 'p-1.5 text-sm bg-green-500 hover:bg-green-600 text-white rounded transition-colors flex items-center';
        buttonHeader.appendChild(addNewKeyButton); // Add to the right part of the header

        this.containerElement.appendChild(buttonHeader);

        // 1. "添加新 Key"区域 (initially hidden)
        const addKeySection = this._createAddKeySection();
        addKeySection.style.display = 'none'; // Initially hidden
        this.containerElement.appendChild(addKeySection);

        addNewKeyButton.addEventListener('click', () => {
            addKeySection.style.display = addKeySection.style.display === 'none' ? 'block' : 'none';
        });

        // 3. Key 列表区域
        const keyListContainer = document.createElement('div');
        keyListContainer.className = 'space-y-3';

        if (this.keys.length === 0) {
            const noKeysMessage = document.createElement('p');
            noKeysMessage.textContent = `${this.modelName} 当前没有已保存的 API Key。`;
            noKeysMessage.className = 'text-sm text-gray-500';
            keyListContainer.appendChild(noKeysMessage);
        } else {
            this.keys.forEach((keyObj, index) => {
                const keyItemElement = this._createKeyItemElement(keyObj, index);
                keyListContainer.appendChild(keyItemElement);
            });
        }
        this.containerElement.appendChild(keyListContainer);
    }

    /**
     * 创建 "添加新 Key" 的 DOM 结构
     * @returns {HTMLElement}
     */
    _createAddKeySection() {
        const section = document.createElement('div');
        section.className = 'mb-4 p-3 border rounded-md bg-gray-50';

        const title = document.createElement('h4');
        let titleText = `为 ${this.modelName} 添加新的 API Key`;
        if (this.modelName && this.modelName.startsWith('custom_source_')) {
            try {
                const sourceSiteId = this.modelName.replace('custom_source_', '');
                if (typeof window.loadAllCustomSourceSites === 'function') {
                    const sites = window.loadAllCustomSourceSites();
                    const site = sites[sourceSiteId];
                    if (site && site.displayName) {
                        titleText = `为 "${site.displayName}" 添加新的 API Key`;
                    } else {
                        titleText = `为源站点 (ID: ...${sourceSiteId.slice(-8)}) 添加新的 API Key`;
                    }
                }
            } catch (e) {
                console.error("Error getting display name for custom source in KeyManagerUI:", e);
            }
        }
        title.textContent = titleText;
        title.className = 'text-md font-semibold mb-2 text-gray-700';
        section.appendChild(title);

        // 将 valueInput 从 input 改为 textarea 以支持批量输入
        const valueTextarea = document.createElement('textarea');
        valueTextarea.rows = 3;
        valueTextarea.placeholder = 'API Key 值 (可每行输入一个实现批量添加)';
        valueTextarea.className = 'w-full px-3 py-2 border border-gray-300 rounded-md mb-2 text-sm focus:ring-blue-500 focus:border-blue-500';

        const remarkInput = document.createElement('input');
        remarkInput.type = 'text';
        remarkInput.placeholder = '备注 (可选, 应用于本批次所有Key)';
        remarkInput.className = 'w-full px-3 py-2 border border-gray-300 rounded-md mb-2 text-sm focus:ring-blue-500 focus:border-blue-500';

        const addButton = document.createElement('button');
        addButton.innerHTML = '<iconify-icon icon="carbon:add" class="mr-1"></iconify-icon>添加 Key(s)';
        addButton.className = 'px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-md text-sm transition-colors flex items-center';

        addButton.addEventListener('click', () => {
            const rawValues = valueTextarea.value.trim();
            const remark = remarkInput.value.trim();

            if (rawValues) {
                const individualKeyValues = rawValues.replace(/,/g, '\n').split('\n').map(k => k.trim()).filter(k => k !== '');
                if (individualKeyValues.length > 0) {
                    individualKeyValues.forEach(keyValue => {
                        this._addKey(keyValue, remark);
                    });
                    valueTextarea.value = ''; // 清空文本域
                    remarkInput.value = '';   // 清空备注

                    // 获取模型显示名称用于通知
                    let modelDisplayNameForNotification = this.modelName;
                    if (this.modelName && this.modelName.startsWith('custom_source_')) {
                        try {
                            const sourceSiteId = this.modelName.replace('custom_source_', '');
                            if (typeof window.loadAllCustomSourceSites === 'function') {
                                const sites = window.loadAllCustomSourceSites();
                                const site = sites[sourceSiteId];
                                if (site && site.displayName) {
                                    modelDisplayNameForNotification = `"${site.displayName}"`;
                                } else {
                                    modelDisplayNameForNotification = `源站点 (ID: ...${sourceSiteId.slice(-8)})`;
                                }
                            }
                        } catch (e) { /* 保持 this.modelName 作为 fallback */ }
                    }

                    if (typeof showNotification === 'function') {
                        showNotification(`${individualKeyValues.length} 个 Key 已为 ${modelDisplayNameForNotification} 添加`, 'success', 3000);
                    }
                } else {
                    alert('请输入至少一个有效的 API Key 值！');
                }
            } else {
                alert('API Key 值不能为空！');
            }
        });

        section.appendChild(valueTextarea); // 修改为 textarea
        section.appendChild(remarkInput);
        section.appendChild(addButton);
        return section;
    }

    /**
     * 创建单个 Key 条目的 DOM 结构
     * @param {Object} keyObj - Key 对象 { id, value, remark, status, order }
     * @param {number} index - Key 在数组中的索引
     * @returns {HTMLElement}
     */
    _createKeyItemElement(keyObj, index) {
        const item = document.createElement('div');
        item.className = 'p-3 border rounded-md shadow-sm bg-white flex flex-col space-y-2';
        item.dataset.keyId = keyObj.id;

        // Key 值显示与操作
        const valueContainer = document.createElement('div');
        valueContainer.className = 'flex items-center justify-between';

        const valueDisplayGroup = document.createElement('div'); // 新增: 用于组合 key value 和 last used 图标
        valueDisplayGroup.className = 'flex items-center flex-grow mr-2';

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'text-sm font-mono cursor-pointer text-gray-700 hover:underline';
        const maskedValue = keyObj.value.length > 8 ? `${keyObj.value.substring(0, 4)}...${keyObj.value.substring(keyObj.value.length - 4)}` : keyObj.value;
        valueDisplay.textContent = maskedValue;
        valueDisplay.title = '点击显示/隐藏完整 Key';
        let isValueVisible = false;
        valueDisplay.addEventListener('click', () => {
            isValueVisible = !isValueVisible;
            valueDisplay.textContent = isValueVisible ? keyObj.value : maskedValue;
        });
        valueDisplayGroup.appendChild(valueDisplay);

        // 检查并添加"上次成功使用"图标
        if (keyObj.id === this.lastSuccessfulKeyId) {
            const lastUsedIcon = document.createElement('iconify-icon');
            lastUsedIcon.setAttribute('icon', 'carbon:star-filled');
            lastUsedIcon.className = 'text-yellow-500 ml-1.5 flex-shrink-0'; // 调整了ml-1到ml-1.5
            lastUsedIcon.title = '此 Key 上次成功使用';
            lastUsedIcon.setAttribute('width', '14'); // 稍微小一点
            lastUsedIcon.setAttribute('height', '14');
            valueDisplayGroup.appendChild(lastUsedIcon);
        }

        // 状态指示器
        const statusIndicator = document.createElement('span');
        statusIndicator.className = 'text-xs px-2 py-0.5 rounded-full ml-2 font-medium key-status-indicator flex-shrink-0'; // 添加 flex-shrink-0
        this._updateKeyStatusIndicator(statusIndicator, keyObj.status);

        valueContainer.appendChild(valueDisplayGroup); // 添加组合元素
        valueContainer.appendChild(statusIndicator);
        item.appendChild(valueContainer);

        // 备注输入框
        const remarkInput = document.createElement('input');
        remarkInput.type = 'text';
        remarkInput.value = keyObj.remark || '';
        remarkInput.placeholder = '添加备注...';
        remarkInput.className = 'w-full px-2 py-1 border border-gray-300 rounded text-xs focus:ring-blue-500 focus:border-blue-500';
        remarkInput.addEventListener('change', (e) => {
            this._updateRemark(keyObj.id, e.target.value);
        });
        item.appendChild(remarkInput);


        // 操作按钮区域
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'flex items-center space-x-2 mt-1 pt-2 border-t border-gray-200';

        const upButton = document.createElement('button');
        upButton.innerHTML = '<iconify-icon icon="carbon:arrow-up" width="16"></iconify-icon>';
        upButton.title = '上移 (提高优先级)';
        upButton.className = 'p-1 text-gray-500 hover:text-blue-600 disabled:opacity-50';
        upButton.disabled = index === 0;
        upButton.addEventListener('click', () => this._moveKey(index, -1));

        const downButton = document.createElement('button');
        downButton.innerHTML = '<iconify-icon icon="carbon:arrow-down" width="16"></iconify-icon>';
        downButton.title = '下移 (降低优先级)';
        downButton.className = 'p-1 text-gray-500 hover:text-blue-600 disabled:opacity-50';
        downButton.disabled = index === this.keys.length - 1;
        downButton.addEventListener('click', () => this._moveKey(index, 1));

        const testButton = document.createElement('button');
        testButton.innerHTML = '<iconify-icon icon="carbon:play-outline" width="16"></iconify-icon>';
        testButton.title = '测试此 Key';
        testButton.className = 'p-1 text-gray-500 hover:text-green-600';
        testButton.addEventListener('click', () => {
            if (this.onTestKey) {
                this.onTestKey(this.modelName, keyObj);
            }
        });

        const deleteButton = document.createElement('button');
        deleteButton.innerHTML = '<iconify-icon icon="carbon:trash-can" width="16"></iconify-icon>';
        deleteButton.title = '删除此 Key';
        deleteButton.className = 'p-1 text-gray-500 hover:text-red-600';
        deleteButton.addEventListener('click', () => this._deleteKey(keyObj.id));

        actionsContainer.appendChild(upButton);
        actionsContainer.appendChild(downButton);
        actionsContainer.appendChild(document.createTextNode(' ')); // 小间隔
        actionsContainer.appendChild(testButton);
        actionsContainer.appendChild(deleteButton);
        item.appendChild(actionsContainer);

        return item;
    }

     /**
     * 更新 Key 状态的视觉指示器
     * @param {HTMLElement} indicatorElement - 状态指示器的 DOM 元素
     * @param {string} status - Key 的状态 ('untested', 'valid', 'invalid', 'testing')
     */
    _updateKeyStatusIndicator(indicatorElement, status) {
        indicatorElement.textContent = status.toUpperCase();
        switch (status) {
            case 'valid':
                indicatorElement.className = 'text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700';
                break;
            case 'invalid':
                indicatorElement.className = 'text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700';
                break;
            case 'testing':
                indicatorElement.className = 'text-xs px-2 py-0.5 rounded-full font-medium bg-yellow-100 text-yellow-700';
                indicatorElement.innerHTML = '<iconify-icon icon="carbon:circle-dash" class="animate-spin"></iconify-icon> ' + status.toUpperCase();
                break;
            case 'untested':
            default:
                indicatorElement.className = 'text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600';
                break;
        }
    }


    /**
     * 添加一个新的 Key
     * @param {string} value - Key 的值
     * @param {string} remark - Key 的备注
     */
    _addKey(value, remark) {
        const newKey = {
            id: this._generateUUID(), // 需要一个 UUID 生成器
            value: value,
            remark: remark,
            status: 'untested',
            order: this.keys.length // 添加到末尾
        };
        this.keys.push(newKey);
        this.saveKeys(this.modelName, this.keys);
        this.render(); // 重新渲染以显示新 Key
    }

    /**
     * 删除一个 Key
     * @param {string} keyId - 要删除的 Key 的 ID
     */
    _deleteKey(keyId) {
        this.keys = this.keys.filter(key => key.id !== keyId);
        // 重新计算 order
        this.keys.forEach((key, index) => key.order = index);
        this.saveKeys(this.modelName, this.keys);
        this.render();
    }

    /**
     * 更新 Key 的备注
     * @param {string} keyId - Key 的 ID
     * @param {string} newRemark - 新的备注内容
     */
    _updateRemark(keyId, newRemark) {
        const key = this.keys.find(k => k.id === keyId);
        if (key) {
            key.remark = newRemark;
            this.saveKeys(this.modelName, this.keys);
            // 不需要完全重新渲染，但如果备注显示区域复杂则可能需要
        }
    }

    /**
     * 移动 Key (调整顺序/优先级)
     * @param {number} index - 当前 Key 的索引
     * @param {number} direction - 移动方向 (-1 表示上移, 1 表示下移)
     */
    _moveKey(index, direction) {
        if (direction === -1 && index === 0) return; // 不能将第一个元素上移
        if (direction === 1 && index === this.keys.length - 1) return; // 不能将最后一个元素下移

        const targetIndex = index + direction;
        const keyToMove = this.keys[index];

        // 交换 order 值
        const tempOrder = this.keys[targetIndex].order;
        this.keys[targetIndex].order = keyToMove.order;
        keyToMove.order = tempOrder;

        // 根据 order 重新排序数组
        this.keys.sort((a, b) => a.order - b.order);

        this.saveKeys(this.modelName, this.keys);
        this.render();
    }

    /**
     * 更新指定 Key 的状态，并重新渲染该 Key 的条目或整个列表
     * @param {string} keyId - Key 的 ID
     * @param {string} newStatus - 新的状态 ('untested', 'valid', 'invalid', 'testing')
     */
    updateKeyStatus(keyId, newStatus) {
        const key = this.keys.find(k => k.id === keyId);
        if (key) {
            key.status = newStatus;
            this.saveKeys(this.modelName, this.keys); // 保存状态变更

            // 优化：只更新特定 key item 的状态显示，而不是整个列表
            const keyItemElement = this.containerElement.querySelector(`div[data-key-id="${keyId}"]`);
            if (keyItemElement) {
                const statusIndicator = keyItemElement.querySelector('.key-status-indicator');
                if (statusIndicator) {
                    this._updateKeyStatusIndicator(statusIndicator, newStatus);
                }
            } else {
                 this.render(); // 如果找不到元素，回退到完整渲染
            }
        }
    }


    /**
     * 生成一个简单的 UUID (如果 storage.js 中的 generateUUID 不可用)
     * @returns {string}
     */
    _generateUUID() {
        // 尝试使用全局的 generateUUID (如果已在 storage.js 中定义并挂载到 window 或通过模块导入)
        if (typeof generateUUID === 'function') {
            return generateUUID();
        }
        // Fallback UUID generator
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * 导出当前模型的 Key 配置为 JSON 文件
     */
    _exportKeys() {
        const dataStr = JSON.stringify(this.keys, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.modelName}-keys.json`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 0);
        if (typeof showNotification === 'function') {
            showNotification('Key 配置已导出', 'success', 2000);
        }
    }

    /**
     * 导入 Key 配置（覆盖当前模型的 Key）
     */
    _importKeys() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const importedKeys = JSON.parse(e.target.result);
                    if (!Array.isArray(importedKeys)) throw new Error('格式错误');
                    // 简单校验每个 key
                    for (const k of importedKeys) {
                        if (typeof k.id !== 'string' || typeof k.value !== 'string') {
                            throw new Error('Key 数据缺失 id 或 value 字段');
                        }
                    }
                    this.keys = importedKeys;
                    this.saveKeys(this.modelName, this.keys);
                    this.render();
                    if (typeof showNotification === 'function') {
                        showNotification('Key 配置已导入并覆盖', 'success', 2000);
                    }
                } catch (err) {
                    alert('导入失败：' + err.message);
                }
            };
            reader.readAsText(file);
        });
        input.click();
    }
}

// 如果希望在全局访问（例如直接在 <script> 标签中使用），可以取消下一行的注释
window.KeyManagerUI = KeyManagerUI;

KeyManagerUI.exportAllModelKeys = function(loadKeysFunc) {
    // 获取所有模型名
    let allModelNames = [];
    try {
        const raw = localStorage.getItem('translationModelKeys');
        if (raw) allModelNames = Object.keys(JSON.parse(raw));
    } catch {}
    // 组装导出对象
    const allKeys = {};
    allModelNames.forEach(model => {
        allKeys[model] = (typeof loadKeysFunc === 'function' ? loadKeysFunc(model) : []);
    });
    // 导出为 JSON
    const dataStr = JSON.stringify(allKeys, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'all-model-keys.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);
    if (typeof showNotification === 'function') {
        showNotification('所有模型 Key 配置已导出', 'success', 2000);
    }
};

KeyManagerUI.importAllModelKeys = function(saveKeysFunc, refreshUIFunc) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                if (typeof imported !== 'object' || Array.isArray(imported)) throw new Error('格式错误');
                for (const model in imported) {
                    if (!Array.isArray(imported[model])) throw new Error(`模型 ${model} 的 Key 列表格式错误`);
                    if (typeof saveKeysFunc === 'function') saveKeysFunc(model, imported[model]);
                }
                if (typeof refreshUIFunc === 'function') refreshUIFunc();
                if (typeof showNotification === 'function') {
                    showNotification('所有模型 Key 配置已导入并覆盖', 'success', 2000);
                }
            } catch (err) {
                alert('导入失败：' + err.message);
            }
        };
        reader.readAsText(file);
    });
    input.click();
};

KeyManagerUI.exportAllModelData = function() {
    const modelKeys = JSON.parse(localStorage.getItem('translationModelKeys') || '{}');
    const modelConfigs = JSON.parse(localStorage.getItem('translationModelConfigs') || '{}');
    const customSourceSites = JSON.parse(localStorage.getItem('paperBurnerCustomSourceSites') || '{}');
    const data = { modelKeys, modelConfigs, customSourceSites };
    const dataStr = JSON.stringify(data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'all-model-data.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 0);
    if (typeof showNotification === 'function') {
        showNotification('所有模型配置和Key已导出', 'success', 2000);
    }
};

KeyManagerUI.importAllModelData = function(refreshUIFunc) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                if (!imported.modelKeys || !imported.modelConfigs || !imported.customSourceSites) throw new Error('文件结构不正确');
                localStorage.setItem('translationModelKeys', JSON.stringify(imported.modelKeys));
                localStorage.setItem('translationModelConfigs', JSON.stringify(imported.modelConfigs));
                localStorage.setItem('paperBurnerCustomSourceSites', JSON.stringify(imported.customSourceSites));
                if (typeof refreshUIFunc === 'function') refreshUIFunc();
                if (typeof showNotification === 'function') {
                    showNotification('所有模型配置和Key已导入并覆盖', 'success', 2000);
                }
            } catch (err) {
                alert('导入失败：' + err.message);
            }
        };
        reader.readAsText(file);
    });
    input.click();
};