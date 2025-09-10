/**
 * KeyManagerUI 类负责渲染和管理单个模型的 API Key 池。
 *
 * 主要功能：
 *  - 渲染 API Key 的增删改查界面。
 *  - 支持批量导入/导出特定模型或所有模型的 Key 配置。
 *  - 支持 Key 的优先级调整（上移/下移）、状态标记（untested, testing, valid, invalid）、备注编辑。
 *  - 提供"全部测试"、"单个测试"的 UI 入口，通过回调与外部测试逻辑交互。
 *  - 支持自定义源站点模型的友好显示名称。
 *  - 从 localStorage 加载和保存 Key 数据，并能响应外部对上次成功使用 Key 的记录。
 *
 * 设计说明：
 *  - 该类主要关注 UI 的构建和用户交互，实际的 Key 存储、加载和测试逻辑通过构造函数中传递的回调函数与外部模块（如 app.js, storage.js, api.js）解耦。
 *  - 每个 KeyManagerUI 实例管理一个特定模型（`modelName`）的 Key 池。
 *  - UI 元素动态创建，支持响应式更新（例如，Key 状态变化后仅更新对应条目）。
 *
 * @param {string} modelName - 当前 KeyManagerUI 实例管理的模型名称 (例如 'mistral', 'deepseek', 'custom_source_abcdef123')。
 * @param {HTMLElement} containerElement - Key 池 UI 将被渲染到的父级 DOM 容器元素。
 * @param {function(string, Object): Promise<void>} onTestKey - 测试单个 Key 的异步回调函数。
 *   接收 `modelName` (string) 和 `keyObject` (Object) 作为参数。
 * @param {function(string, Array<Object>): Promise<void>} onTestAllKeys - 测试当前模型所有 Key 的异步回调函数。
 *   接收 `modelName` (string) 和 `keysArray` (Array<Object>) 作为参数。
 * @param {function(string): Array<Object>} loadKeysFunction - 加载指定模型 Key 列表的函数。
 *   接收 `modelName` (string) 作为参数，应返回一个 Key 对象数组。
 * @param {function(string, Array<Object>): void} saveKeysFunction - 保存指定模型 Key 列表的函数。
 *   接收 `modelName` (string) 和 `keysArray` (Array<Object>) 作为参数。
 */
const LAST_SUCCESSFUL_KEYS_LS_KEY_FOR_UI = 'paperBurnerLastSuccessfulKeys'; // 与 app.js 中保持一致

class KeyManagerUI {
    /**
     * 构造函数：初始化 KeyManagerUI 实例。
     *
     * 主要步骤:
     * 1. 保存传入的参数（模型名、容器元素、回调函数等）到实例属性。
     * 2. 调用 `loadKeysFunction` 加载当前模型的 Key 数据，如果不存在则初始化为空数组。
     * 3. 从 localStorage 读取当前模型上次成功使用的 Key ID (如果有记录的话)，用于 UI 高亮显示。
     * 4. 调用 `render` 方法，首次渲染 Key 管理界面。
     *
     * @param {string} modelName - 当前管理的模型名称 (e.g., 'mistral', 'custom')。
     * @param {HTMLElement} containerElement - Key 池 UI 将被渲染到的 DOM 容器元素。
     * @param {function(string, Object)} onTestKey - 测试单个 Key 的回调函数 (参数: modelName, keyObject)。
     * @param {function(string, Array<Object>)} onTestAllKeys - 测试当前模型所有 Key 的回调 (参数: modelName, keysArray)。
     * @param {function(string): Array<Object>} loadKeysFunction - 加载指定模型 Key 的函数。
     * @param {function(string, Array<Object>)} saveKeysFunction - 保存指定模型 Key 的函数。
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
     * 重新加载指定模型的 Key 数据并完全重新渲染 Key 列表 UI。
     * 当外部数据源（例如 localStorage 中的 Key 列表）发生变化，且需要 KeyManagerUI
     * 实例更新其显示时，可以调用此方法。
     *
     * 主要步骤:
     * 1. 调用 `this.loadKeys` (即构造时传入的 `loadKeysFunction`) 重新获取当前模型的 Key 列表。
     * 2. 调用 `this.render()` 方法，用最新的 Key 数据彻底重建 UI。
     */
    refreshKeys() {
        this.keys = this.loadKeys(this.modelName) || [];
        this.render();
    }

    /**
     * 渲染整个 Key 池 UI 到指定的容器元素中。
     * 此方法会先清空容器，然后逐步构建并添加以下区域：
     *  - 按钮操作区：包含"全部测试"、"导出配置"、"导入配置"以及"添加新 Key"的触发按钮。
     *  - 添加新 Key 输入区（初始隐藏）：提供文本域批量输入新 Key 及备注。
     *  - Key 列表区：如果存在 Key，则遍历 `this.keys` 数组，为每个 Key 对象调用 `_createKeyItemElement` 生成对应的 UI 条目并添加到列表中；如果不存在 Key，则显示提示信息。
     *
     * 此方法是 UI 更新的核心，当 Key 列表发生较大变化（如增删、导入）或需要强制刷新时被调用。
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
     * 创建"添加新 Key"区域的 DOM 结构。
     * 该区域允许用户输入一个或多个 API Key（通过文本域，每行一个 Key 被视为一个独立的 Key），
     * 并为这些 Key 添加一个统一的备注。
     *
     * DOM 结构包括:
     * - 区域标题 (根据 `this.modelName` 动态生成，对自定义源站点有特殊显示)。
     * - 一个 `textarea` 用于输入 Key 值(支持批量)。
     * - 一个 `input[type=text]` 用于输入备注。
     * - 一个"添加 Key(s)"按钮，点击后会处理输入、调用 `_addKey` 方法，并清空输入框。
     *
     * @returns {HTMLElement} 包含添加新 Key 表单元素的 `div` 容器。
     * @private
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
     * 为单个 Key 对象创建并返回其在列表中的 DOM 元素表示。
     * 每个 Key 条目 UI 包含以下部分：
     *  - Key 值显示：默认部分隐藏，点击可切换完整显示/隐藏。旁边可能会有"上次成功使用"的星形图标。
     *  - 状态指示器：显示 Key 的当前状态 (untested, testing, valid, invalid)，并根据状态应用不同样式。
     *  - 备注输入框：允许用户编辑和查看 Key 的备注。
     *  - 操作按钮区：
     *    - 上移/下移按钮：调整 Key 在列表中的顺序（优先级）。
     *    - 测试按钮：触发 `onTestKey` 回调以测试当前 Key。
     *    - 删除按钮：调用 `_deleteKey` 方法删除当前 Key。
     *
     * @param {Object} keyObj - 要渲染的 Key 对象。应包含 `id`, `value`, `remark`, `status`, `order` 属性。
     * @param {number} index - Key 对象在 `this.keys` 数组中的当前索引，用于判断是否禁用上移/下移按钮。
     * @returns {HTMLElement} 代表单个 Key 条目的 `div` 元素。
     * @private
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
     * 更新 Key 状态的视觉指示器（DOM 元素）的样式和内容。
     * 根据传入的 `status`，此方法会修改 `indicatorElement` 的文本内容和 CSS 类名，
     * 以便直观地展示 Key 的当前状态。
     *
     * 支持的状态及其对应样式:
     * - `valid`: 绿色背景，表示 Key 有效。
     * - `invalid`: 红色背景，表示 Key 无效。
     * - `testing`: 黄色背景，并显示一个旋转图标，表示 Key 正在测试中。
     * - `untested` (或任何其他未知状态): 灰色背景，表示 Key 尚未测试。
     *
     * @param {HTMLElement} indicatorElement - 要更新的状态指示器 DOM 元素 (通常是一个 `<span>`)。
     * @param {string} status - Key 的当前状态字符串 (e.g., 'valid', 'invalid', 'testing', 'untested')。
     * @private
     */
    _updateKeyStatusIndicator(indicatorElement, status) {
        indicatorElement.textContent = status && status.toUpperCase() || 'UNTESTED'; // 默认显示 UNTESTED
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
     * 向当前模型的 Key 池中添加一个新的 Key 对象。
     * 新 Key 将具有一个唯一生成的 ID (`_generateUUID`)，初始状态为 'untested'，
     * `order` 属性根据其在数组中的位置（末尾）设定。
     * 添加后，会调用 `saveKeys` 保存更新后的 Key 列表，并调用 `render` 刷新整个 UI。
     *
     * @param {string} value - 新 Key 的 API Key 字符串值。
     * @param {string} remark - 新 Key 的备注信息（可选）。
     * @private
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
     * 从当前模型的 Key 池中删除具有指定 ID 的 Key。
     * 删除后，会重新计算剩余 Key 的 `order` 属性以保持连续性，
     * 然后调用 `saveKeys` 保存更改，并调用 `render` 刷新 UI。
     *
     * @param {string} keyId - 要删除的 Key 对象的 `id` 属性。
     * @private
     */
    _deleteKey(keyId) {
        this.keys = this.keys.filter(key => key.id !== keyId);
        // 重新计算 order
        this.keys.forEach((key, index) => key.order = index);
        this.saveKeys(this.modelName, this.keys);
        this.render();
    }

    /**
     * 更新具有指定 ID 的 Key 对象的备注信息。
     * 找到对应的 Key 对象后，修改其 `remark` 属性，并调用 `saveKeys` 保存更改。
     * 此操作通常不会触发完整的 UI `render`，除非备注的显示非常复杂。
     * （当前实现中，由于输入框直接绑定，可能不需要显式 UI 更新，但保存是必要的。）
     *
     * @param {string} keyId - 要更新备注的 Key 对象的 `id` 属性。
     * @param {string} newRemark - 新的备注文本。
     * @private
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
     * 调整指定索引处的 Key 在列表中的顺序（即优先级）。
     * 根据 `direction` 参数，将 Key 向上或向下移动一位。
     * 实现方式是通过交换目标 Key 与相邻 Key 的 `order` 属性值，
     * 然后对整个 `this.keys` 数组按 `order` 重新排序。
     * 操作完成后，调用 `saveKeys` 保存更改，并调用 `render` 刷新 UI。
     *
     * @param {number} index - 要移动的 Key 在 `this.keys` 数组中的当前索引。
     * @param {number} direction - 移动方向：-1 表示上移（提高优先级），1 表示下移（降低优先级）。
     * @private
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
     * 更新具有指定 ID 的 Key 对象的状态，并相应地刷新其在 UI 中的状态指示器。
     * 此方法旨在实现更细粒度的 UI 更新：当 Key 状态改变时，
     * 它会尝试只更新该 Key 对应条目中的状态指示器部分，而不是重新渲染整个列表，以提高性能。
     * 如果找不到对应的 DOM 元素，则会回退到完整的 `render` 调用。
     * 状态更改后会调用 `saveKeys` 保存。
     *
     * @param {string} keyId - 要更新状态的 Key 对象的 `id` 属性。
     * @param {string} newStatus - Key 的新状态 (e.g., 'untested', 'valid', 'invalid', 'testing')。
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
     * 生成一个符合 RFC4122 version 4 的 UUID (Universally Unique Identifier)。
     * 优先尝试使用全局作用域下可能已定义的 `generateUUID` 函数 (例如由 `storage.js` 提供)。
     * 如果全局函数不可用，则使用一个内置的回退算法生成一个随机的 UUID 字符串。
     *
     * @returns {string} 生成的 UUID 字符串，格式如 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'。
     * @private
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
     * 将当前模型 (`this.modelName`) 的所有 Key 配置导出为一个 JSON 文件。
     * JSON 文件内容是 `this.keys` 数组的字符串表示。
     * 文件名格式为 `<modelName>-keys.json`。
     * 通过动态创建 `<a>` 标签并模拟点击来实现浏览器下载。
     * 导出成功后会尝试显示一个通知（如果 `showNotification` 函数可用）。
     *
     * @private
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
     * 导入 Key 配置（覆盖当前模型的 Key）。
     * 支持格式校验与错误提示。
     *
     * 文件内容需为 Key 对象数组。
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
    // 仅导出新版规范字段，保持“干净”
    const translationModelKeys = JSON.parse(localStorage.getItem('translationModelKeys') || '{}');
    const translationModelConfigs = JSON.parse(localStorage.getItem('translationModelConfigs') || '{}');
    const paperBurnerCustomSourceSites = JSON.parse(localStorage.getItem('paperBurnerCustomSourceSites') || '{}');
    const data = { translationModelKeys, translationModelConfigs, paperBurnerCustomSourceSites };
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

                // 1) 容错提取不同历史字段名
                let importedModelKeys = imported.modelKeys 
                    || imported.translationModelKeys 
                    || imported.keys 
                    || imported.keyStore 
                    || {};
                let importedModelConfigs = imported.modelConfigs 
                    || imported.translationModelConfigs 
                    || imported.configs 
                    || imported.modelConfig 
                    || {};
                let importedCustomSourceSites = imported.customSourceSites 
                    || imported.paperBurnerCustomSourceSites 
                    || imported.customSites 
                    || imported.sourceSites 
                    || {};

                // 2) 归一化 modelKeys（数组项可为字符串或对象）
                const genUUID = (function(){
                    if (typeof generateUUID === 'function') return generateUUID;
                    return function(){
                        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                            return v.toString(16);
                        });
                    }
                })();

                const normalizedModelKeys = {};
                if (typeof importedModelKeys === 'object' && importedModelKeys) {
                    Object.keys(importedModelKeys).forEach(modelName => {
                        const arr = Array.isArray(importedModelKeys[modelName]) ? importedModelKeys[modelName] : [];
                        const normArr = arr.map((item, idx) => {
                            if (typeof item === 'string') {
                                return { id: genUUID(), value: item, remark: '', status: 'untested', order: idx };
                            } else if (item && typeof item === 'object') {
                                const value = (typeof item.value === 'string' && item.value) ? item.value
                                              : (typeof item.key === 'string' ? item.key : '');
                                return {
                                    id: typeof item.id === 'string' && item.id ? item.id : genUUID(),
                                    value,
                                    remark: typeof item.remark === 'string' ? item.remark : (item.note || ''),
                                    status: typeof item.status === 'string' ? item.status : 'untested',
                                    order: typeof item.order === 'number' ? item.order : idx
                                };
                            } else {
                                return null;
                            }
                        }).filter(Boolean);
                        normalizedModelKeys[modelName] = normArr;
                    });
                }

                // 3) 归一化 modelConfigs（确保为对象）
                const normalizedModelConfigs = (typeof importedModelConfigs === 'object' && importedModelConfigs) ? importedModelConfigs : {};

                // 4) 归一化 customSourceSites：支持对象或数组
                let normalizedCustomSourceSites = {};
                if (Array.isArray(importedCustomSourceSites)) {
                    importedCustomSourceSites.forEach((site, idx) => {
                        if (!site || typeof site !== 'object') return;
                        const id = (typeof site.id === 'string' && site.id) ? site.id : genUUID();
                        normalizedCustomSourceSites[id] = {
                            id,
                            displayName: site.displayName || site.name || `自定义源站 ${idx+1}`,
                            apiBaseUrl: site.apiBaseUrl || site.baseUrl || site.apiBase || '',
                            modelId: site.modelId || site.defaultModel || '',
                            availableModels: Array.isArray(site.availableModels) ? site.availableModels : [],
                            requestFormat: site.requestFormat || 'openai',
                            temperature: (typeof site.temperature === 'number') ? site.temperature : 0.5,
                            max_tokens: (typeof site.max_tokens === 'number') ? site.max_tokens : 8000
                        };
                    });
                } else if (typeof importedCustomSourceSites === 'object' && importedCustomSourceSites) {
                    // 已是对象结构，尽量保留
                    normalizedCustomSourceSites = importedCustomSourceSites;
                } else {
                    normalizedCustomSourceSites = {};
                }

                // 5) 可选导入 lastSuccessfulKeys（若存在）
                const lastSuccessful = imported.lastSuccessfulKeys 
                    || imported.paperBurnerLastSuccessfulKeys 
                    || imported.lastSuccessful 
                    || null;

                // 6) 写入 localStorage（允许任意子集存在，不再强制三者齐备）
                localStorage.setItem('translationModelKeys', JSON.stringify(normalizedModelKeys));
                localStorage.setItem('translationModelConfigs', JSON.stringify(normalizedModelConfigs));
                localStorage.setItem('paperBurnerCustomSourceSites', JSON.stringify(normalizedCustomSourceSites));
                if (lastSuccessful && typeof lastSuccessful === 'object') {
                    localStorage.setItem('paperBurnerLastSuccessfulKeys', JSON.stringify(lastSuccessful));
                }

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
