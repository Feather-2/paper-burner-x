// js/ui/ui-key-manager-modal.js
// 管理翻译模型自定义源站点与模型 Key 弹窗的交互逻辑。
(function(global) {
    'use strict';

// 表单元素创建工具 (NEW - for renderSourceSiteForm)
// ---------------------
/**
 * 创建并返回一个包含标签（label）和输入框（input）的完整配置项组件。
 * 该组件通常用于动态生成的表单中，用于收集用户输入。
 *
 * @param {string} id - 输入框元素的 HTML `id` 属性，同时用于标签的 `for` 属性。
 * @param {string} labelText - 显示在输入框上方的标签文本内容。
 * @param {string|number} value - 输入框的初始值。
 * @param {string} [type='text'] - 输入框的类型 (例如：`text`, `url`, `number`, `password`)。
 * @param {string} [placeholder=''] - 输入框的占位提示文本。
 * @param {function} [onChangeCallback] - (可选) 当输入框的值发生改变 (通常是 `change` 或 `input` 事件) 时被调用的回调函数。
 * @param {Object} [attributes={}] - (可选) 一个包含额外 HTML 属性的对象，这些属性将被直接设置到输入框元素上。
 *                                   对于 `type='number'`，可以包含 `min`, `max`, `step`。
 * @returns {HTMLElement} 返回一个 `div` 元素，该元素包装了创建的标签和输入框。
 */
function createConfigInput(id, labelText, value, type = 'text', placeholder = '', onChangeCallback, attributes = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3'; // Add some margin for spacing

    const label = document.createElement('label');
    label.htmlFor = id;
    label.className = 'block text-xs font-medium text-gray-600 mb-1';
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = type;
    input.id = id;
    input.name = id;
    input.value = value;
    input.placeholder = placeholder;
    input.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';

    if (type === 'number') {
        if (attributes.min !== undefined) input.min = attributes.min;
        if (attributes.max !== undefined) input.max = attributes.max;
        if (attributes.step !== undefined) input.step = attributes.step;
    }
    for (const key in attributes) {
        if (key !== 'min' && key !== 'max' && key !== 'step') { // Avoid re-setting handled attributes
            input.setAttribute(key, attributes[key]);
        }
    }

    if (onChangeCallback && typeof onChangeCallback === 'function') {
        input.addEventListener('change', onChangeCallback);
        input.addEventListener('input', onChangeCallback); // For more responsive updates if needed
    }

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return wrapper;
}

/**
 * 创建并返回一个包含标签（label）和下拉选择框（select）的完整配置项组件。
 * 该组件用于提供一组预定义的选项供用户选择。
 *
 * @param {string} id - 下拉选择框元素的 HTML `id` 属性，同时用于标签的 `for` 属性。
 * @param {string} labelText - 显示在下拉选择框上方的标签文本内容。
 * @param {string} selectedValue - 需要被预选中的选项的值。
 * @param {Array<Object>} optionsArray - 一个对象数组，用于生成下拉选项。每个对象应包含：
 *   @param {string} optionsArray[].value - 选项的实际值。
 *   @param {string} optionsArray[].text - 选项的显示文本。
 * @param {function} [onChangeCallback] - (可选) 当下拉选择框的值发生改变时被调用的回调函数。
 * @returns {HTMLElement} 返回一个 `div` 元素，该元素包装了创建的标签和下拉选择框。
 */
function createConfigSelect(id, labelText, selectedValue, optionsArray, onChangeCallback) {
    const wrapper = document.createElement('div');
    wrapper.className = 'mb-3';

    const label = document.createElement('label');
    label.htmlFor = id;
    label.className = 'block text-xs font-medium text-gray-600 mb-1';
    label.textContent = labelText;

    const select = document.createElement('select');
    select.id = id;
    select.name = id;
    select.className = 'w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors';

    optionsArray.forEach(opt => {
        const optionElement = document.createElement('option');
        optionElement.value = opt.value;
        optionElement.textContent = opt.text;
        if (opt.value === selectedValue) {
            optionElement.selected = true;
        }
        select.appendChild(optionElement);
    });

    if (onChangeCallback && typeof onChangeCallback === 'function') {
        select.addEventListener('change', onChangeCallback);
    }

    wrapper.appendChild(label);
    wrapper.appendChild(select);
    return wrapper;
}

global.createConfigInput = createConfigInput;
global.createConfigSelect = createConfigSelect;

// ---------------------
// 自定义源站点下拉列表填充
// ---------------------
function populateCustomSourceSitesDropdown_ui(selectedSiteIdToSet = null) {
    const dropdown = global.document.getElementById('customSourceSiteSelect');
    if (!dropdown) {
        console.warn('populateCustomSourceSitesDropdown_ui: customSourceSiteSelect dropdown not found.');
        return;
    }

    dropdown.innerHTML = '';
    dropdown.classList.remove('hidden');
    dropdown.disabled = false;

    let sites = {};
    if (typeof global.loadAllCustomSourceSites === 'function') {
        sites = global.loadAllCustomSourceSites();
    } else {
        console.error('populateCustomSourceSitesDropdown_ui: loadAllCustomSourceSites function is not available.');
        const errorOption = document.createElement('option');
        errorOption.value = '';
        errorOption.textContent = '错误:无法加载源站点';
        dropdown.appendChild(errorOption);
        dropdown.disabled = true;
        return;
    }

    const siteIds = Object.keys(sites);

    if (!selectedSiteIdToSet) {
        const settings = typeof global.loadSettings === 'function' ? global.loadSettings() : {};
        selectedSiteIdToSet = settings.selectedCustomSourceSiteId || null;
    }

    if (siteIds.length === 0) {
        const noSitesOption = document.createElement('option');
        noSitesOption.value = '';
        noSitesOption.textContent = '无自定义源站点';
        dropdown.appendChild(noSitesOption);
        dropdown.disabled = true;
    } else {
        dropdown.disabled = false;

        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = '-- 请选择源站点 --';
        dropdown.appendChild(placeholderOption);

        siteIds.forEach(id => {
            const site = sites[id];
            const option = document.createElement('option');
            option.value = id;
            option.textContent = site.displayName || `源站 (ID: ${id.substring(0, 8)}...)`;
            dropdown.appendChild(option);
        });

        if (selectedSiteIdToSet && sites[selectedSiteIdToSet]) {
            dropdown.value = selectedSiteIdToSet;
        } else {
            dropdown.value = '';
        }
    }

    refreshCustomSourceSiteInfo({ autoSelect: !dropdown.value });
}

global.populateCustomSourceSitesDropdown_ui = populateCustomSourceSitesDropdown_ui;

const EMPTY_SOURCE_SITE_HINT = `<div class="p-4 text-center text-red-500 text-sm font-semibold">您还没设置自定义源站点，请您先手动进行设置...<br>如果您已进行设置，请尝试刷新</div>`;

function refreshCustomSourceSiteInfo({ autoSelect = false, persistSelection = true } = {}) {
    const select = global.document.getElementById('customSourceSiteSelect');
    if (!select) return;

    const infoContainer = global.document.getElementById('customSourceSiteInfo');
    const manageKeyBtn = global.document.getElementById('manageSourceSiteKeyBtn');
    const availableOptions = Array.from(select.options || []).filter(opt => opt.value);

    if (availableOptions.length === 0) {
        if (infoContainer) {
            infoContainer.classList.remove('hidden');
            infoContainer.innerHTML = EMPTY_SOURCE_SITE_HINT;
        }
        if (manageKeyBtn) manageKeyBtn.classList.add('hidden');
        return;
    }

    let selectionChanged = false;
    if (!select.value || !availableOptions.some(opt => opt.value === select.value)) {
        if (autoSelect) {
            select.value = availableOptions[0].value;
            selectionChanged = true;
        } else {
            if (infoContainer) {
                infoContainer.classList.remove('hidden');
                infoContainer.innerHTML = EMPTY_SOURCE_SITE_HINT;
            }
            if (manageKeyBtn) manageKeyBtn.classList.add('hidden');
            return;
        }
    }

    if (selectionChanged && persistSelection) {
        const settings = typeof global.loadSettings === 'function' ? (global.loadSettings() || {}) : {};
        settings.selectedCustomSourceSiteId = select.value;
        if (typeof global.saveSettings === 'function') {
            global.saveSettings(settings);
        } else {
            (global.localStorage || localStorage).setItem('paperBurnerSettings', JSON.stringify(settings));
        }
    }

    if (typeof global.updateCustomSourceSiteInfo === 'function') {
        global.updateCustomSourceSiteInfo(select.value);
    }
}

function updateTranslationUIVisibility(isProcessing) {
    const translationSelect = global.document.getElementById('translationModel');
    const translationModelValue = translationSelect ? translationSelect.value : '';
    const sourceSiteContainer = global.document.getElementById('customSourceSiteContainer');
    const sourceSiteSelect = global.document.getElementById('customSourceSiteSelect');

    if (translationModelValue === 'custom') {
        const modelSelector = document.getElementById('customModelId');
        const modelInput = document.getElementById('customModelIdInput');

        if (modelSelector && modelInput) {
            const hasAvailableModels = modelSelector.options.length > 1;
            if (hasAvailableModels) {
                if (modelSelector.value === 'manual-input') {
                    modelInput.style.display = 'block';
                } else {
                    modelInput.style.display = 'none';
                }
            } else {
                modelSelector.style.display = 'none';
                modelInput.style.display = 'block';
            }
        }
    }

    if (sourceSiteContainer && sourceSiteSelect) {
        const detailsWrapper = global.document.getElementById('customSourceSite');
        const toggleIconEl = global.document.getElementById('customSourceSiteToggleIcon');
        if (translationModelValue === 'custom') {
            sourceSiteContainer.classList.remove('hidden');
            sourceSiteSelect.disabled = false;
            sourceSiteSelect.classList.remove('hidden');
            if (detailsWrapper && detailsWrapper.classList.contains('hidden')) {
                detailsWrapper.classList.remove('hidden');
            }
            if (toggleIconEl) {
                toggleIconEl.setAttribute('icon', 'carbon:chevron-up');
            }
            if (typeof global.populateCustomSourceSitesDropdown_ui === 'function') {
                global.populateCustomSourceSitesDropdown_ui();
            } else {
                console.warn('populateCustomSourceSitesDropdown_ui function not found on window.');
                sourceSiteSelect.innerHTML = '<option value="">加载函数错误</option>';
            }
            refreshCustomSourceSiteInfo({ autoSelect: !sourceSiteSelect.value });
            setTimeout(() => {
                const selectEl = global.document.getElementById('customSourceSiteSelect');
                if (!selectEl) return;
                const hasUsableOption = Array.from(selectEl.options || []).some(opt => opt.value);
                if (!hasUsableOption) {
                    const sites = typeof global.loadAllCustomSourceSites === 'function' ? global.loadAllCustomSourceSites() : {};
                    const storedSettings = typeof global.loadSettings === 'function' ? global.loadSettings() : {};
                    if (sites && Object.keys(sites).length > 0) {
                        global.populateCustomSourceSitesDropdown_ui(storedSettings ? storedSettings.selectedCustomSourceSiteId || null : null);
                    }
                }
                refreshCustomSourceSiteInfo({ autoSelect: !selectEl.value });
            }, 250);
        } else {
            sourceSiteContainer.classList.add('hidden');
            sourceSiteSelect.innerHTML = '';
            sourceSiteSelect.disabled = true;
            sourceSiteSelect.classList.add('hidden');

            const infoContainer = document.getElementById('customSourceSiteInfo');
            const manageKeyBtn = document.getElementById('manageSourceSiteKeyBtn');
            if (infoContainer) infoContainer.classList.add('hidden');
            if (manageKeyBtn) manageKeyBtn.classList.add('hidden');
            if (detailsWrapper && !detailsWrapper.classList.contains('hidden')) {
                detailsWrapper.classList.add('hidden');
            }
            if (toggleIconEl) {
                toggleIconEl.setAttribute('icon', 'carbon:chevron-down');
            }
        }
    }

    const glossarySection = document.getElementById('glossaryManagerSection');
    if (glossarySection) {
        if (translationModelValue === 'none') {
            glossarySection.classList.add('hidden');
        } else {
            glossarySection.classList.remove('hidden');
        }
    }

    const togglePanel = (elementId, shouldShow, renderer) => {
        const el = document.getElementById(elementId);
        if (!el) return;
        if (shouldShow) {
            el.classList.remove('hidden');
            if (renderer) {
                try { renderer(); } catch (e) { console.error(e); }
            }
        } else {
            el.classList.add('hidden');
        }
    };

    togglePanel('geminiModelInfo', translationModelValue === 'gemini', global.renderGeminiInfoPanel);
    togglePanel('deepseekModelInfo', translationModelValue === 'deepseek', global.renderDeepseekInfoPanel);
    togglePanel('tongyiModelInfo', translationModelValue === 'tongyi', global.renderTongyiInfoPanel);
    togglePanel('volcanoModelInfo', translationModelValue === 'volcano', global.renderVolcanoInfoPanel);
    togglePanel('deeplxModelInfo', translationModelValue === 'deeplx', global.renderDeeplxInfoPanel);
}

global.updateTranslationUIVisibility = updateTranslationUIVisibility;

global.ui = global.ui || {};
global.ui.createConfigInput = createConfigInput;
global.ui.createConfigSelect = createConfigSelect;
global.ui.populateCustomSourceSitesDropdown_ui = populateCustomSourceSitesDropdown_ui;
global.ui.updateTranslationUIVisibility = updateTranslationUIVisibility;
global.refreshCustomSourceSiteInfo = refreshCustomSourceSiteInfo;
global.ui.refreshCustomSourceSiteInfo = refreshCustomSourceSiteInfo;

function tryPopulateCustomSourceSitesDropdown() {
    const settings = typeof global.loadSettings === 'function' ? global.loadSettings() : {};
    const presetId = settings ? settings.selectedCustomSourceSiteId || null : null;
    if (typeof global.populateCustomSourceSitesDropdown_ui === 'function') {
        global.populateCustomSourceSitesDropdown_ui(presetId);
    }
    refreshCustomSourceSiteInfo({ autoSelect: true });
    setTimeout(() => {
        const select = global.document.getElementById('customSourceSiteSelect');
        if (!select) return;
        const hasOption = Array.from(select.options || []).some(opt => opt.value);
        if (hasOption) {
            refreshCustomSourceSiteInfo({ autoSelect: true });
        }
    }, 200);
}

global.tryPopulateCustomSourceSitesDropdown = tryPopulateCustomSourceSitesDropdown;
global.ui.tryPopulateCustomSourceSitesDropdown = tryPopulateCustomSourceSitesDropdown;

})(window);
