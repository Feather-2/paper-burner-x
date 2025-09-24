// js/ui/ui-model-search.js
// 封装通用模型搜索弹窗及其集成逻辑。
(function(global) {
    'use strict';

    const overlayState = {
        initialized: false,
        overlayEl: null,
        titleEl: null,
        inputEl: null,
        listEl: null,
        emptyEl: null,
        closeBtn: null,
        items: [],
        currentValue: '',
        onSelect: null,
        emptyMessage: '暂无可选项'
    };

    function initializeModelSearchOverlay() {
        if (overlayState.initialized) return overlayState;

        const overlay = document.getElementById('modelSearchOverlay');
        const titleEl = document.getElementById('modelSearchTitle');
        const inputEl = document.getElementById('modelSearchInput');
        const listEl = document.getElementById('modelSearchList');
        const emptyEl = document.getElementById('modelSearchEmpty');
        const closeBtn = document.getElementById('modelSearchCloseBtn');

        if (!overlay || !titleEl || !inputEl || !listEl || !emptyEl || !closeBtn) {
            console.warn('[ModelSearchOverlay] 必需的DOM元素缺失，搜索弹窗未初始化。');
            return overlayState;
        }

        overlayState.overlayEl = overlay;
        overlayState.titleEl = titleEl;
        overlayState.inputEl = inputEl;
        overlayState.listEl = listEl;
        overlayState.emptyEl = emptyEl;
        overlayState.closeBtn = closeBtn;
        overlayState.initialized = true;

        const handleBackgroundClick = (event) => {
            if (event.target === overlay) {
                closeModelSearchOverlay();
            }
        };

        const handleKeydown = (event) => {
            if (event.key === 'Escape' && !overlay.classList.contains('hidden')) {
                closeModelSearchOverlay();
            }
        };

        overlay.addEventListener('click', handleBackgroundClick);
        closeBtn.addEventListener('click', closeModelSearchOverlay);
        inputEl.addEventListener('input', () => renderModelSearchResults(inputEl.value));
        document.addEventListener('keydown', handleKeydown);

        return overlayState;
    }

    function openModelSearchOverlay({
        title = '选择模型',
        items = [],
        currentValue = '',
        placeholder = '搜索模型...',
        emptyMessage = '暂无可选项',
        onSelect = null
    }) {
        const state = initializeModelSearchOverlay();
        if (!state.initialized) return;

        state.items = (items || []).map(item => {
            const value = item.value || '';
            const label = item.label || value;
            const description = item.description || '';
            return {
                value,
                label,
                description,
                searchText: `${value} ${label} ${description}`.toLowerCase()
            };
        });
        state.currentValue = currentValue || '';
        state.onSelect = typeof onSelect === 'function' ? onSelect : null;
        state.emptyMessage = emptyMessage || '暂无可选项';

        state.titleEl.textContent = title;
        state.inputEl.value = '';
        state.inputEl.placeholder = placeholder;

        state.overlayEl.classList.remove('hidden');
        document.body.classList.add('overflow-hidden');

        renderModelSearchResults('');

        setTimeout(() => {
            state.inputEl.focus();
            state.inputEl.select();
        }, 50);
    }

    function closeModelSearchOverlay() {
        if (!overlayState.initialized) return;
        overlayState.overlayEl.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
        overlayState.items = [];
        overlayState.currentValue = '';
        overlayState.onSelect = null;
    }

    function renderModelSearchResults(keyword) {
        if (!overlayState.initialized) return;
        const filter = (keyword || '').trim().toLowerCase();
        const { listEl, emptyEl, items, currentValue, onSelect, emptyMessage } = overlayState;

        listEl.innerHTML = '';

        const matched = filter
            ? items.filter(item => item.searchText.includes(filter))
            : items.slice();

        if (matched.length === 0) {
            emptyEl.textContent = emptyMessage;
            emptyEl.classList.remove('hidden');
            return;
        }

        emptyEl.classList.add('hidden');
        listEl.scrollTop = 0;

        matched.forEach(item => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'w-full text-left px-3 py-2 border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500';

            if (item.value === currentValue) {
                button.classList.add('bg-blue-50', 'border-blue-200', 'text-blue-700', 'font-semibold');
            } else {
                button.classList.add('border-transparent', 'hover:bg-gray-50', 'text-gray-700');
            }

            const labelHtml = highlightKeyword(item.label || item.value, filter);
            const descHtml = item.description && item.description !== item.label
                ? highlightKeyword(item.description, filter)
                : '';
            const labelSpan = document.createElement('span');
            labelSpan.className = 'block text-sm';
            labelSpan.innerHTML = labelHtml;
            button.appendChild(labelSpan);

            if (descHtml) {
                const descSpan = document.createElement('span');
                descSpan.className = 'block text-xs text-gray-500 mt-0.5';
                descSpan.innerHTML = descHtml;
                button.appendChild(descSpan);
            }

            button.addEventListener('click', () => {
                if (typeof onSelect === 'function') {
                    onSelect(item.value, item);
                }
                closeModelSearchOverlay();
            });

            listEl.appendChild(button);
        });
    }

    const caches = {};
    const controllers = {};

    function getModelSearchCache(key) {
        return caches[key] || [];
    }

    function setModelSearchCache(key, items) {
        caches[key] = Array.isArray(items) ? items : [];
        const controller = controllers[key];
        if (controller && typeof controller.update === 'function') {
            controller.update();
        }
    }

    function registerModelSearchIntegration({
        key,
        selectEl,
        buttonEl,
        title = '选择模型',
        placeholder = '搜索模型...',
        emptyMessage = '暂无可选项',
        onEmpty,
        onSelect
    }) {
        if (!key || !buttonEl || !selectEl) return;

        const controller = controllers[key] || {};
        controller.key = key;
        controller.selectEl = selectEl;
        controller.buttonEl = buttonEl;
        controller.title = title;
        controller.placeholder = placeholder;
        controller.emptyMessage = emptyMessage;
        controller.onSelect = typeof onSelect === 'function'
            ? onSelect
            : (value) => {
                if (!selectEl || value == null) return;
                if (selectEl.value !== value) {
                    selectEl.value = value;
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                }
            };
        controller.onEmpty = typeof onEmpty === 'function' ? onEmpty : null;
        controller.maybeDetect = (items) => {
            if (Array.isArray(items) && items.length <= 1) {
                if (typeof controller.onEmpty === 'function') controller.onEmpty();
                return true;
            }
            return false;
        };
        controller.update = () => {
            const hasItems = (getModelSearchCache(key) || []).length > 0;
            buttonEl.disabled = !hasItems;
        };

        if (buttonEl.dataset.modelSearchRegistered !== 'true') {
            buttonEl.addEventListener('click', () => {
                const items = getModelSearchCache(key);
                if (!items.length) {
                    if (controller.onEmpty) {
                        controller.onEmpty();
                    } else if (typeof global.showNotification === 'function') {
                        global.showNotification('请先检测可用模型', 'info');
                    }
                    return;
                }
                if (controller.maybeDetect(items)) {
                    return;
                }
                const currentValue = controller.selectEl ? controller.selectEl.value : '';
                openModelSearchOverlay({
                    title: controller.title,
                    items,
                    currentValue,
                    placeholder: controller.placeholder,
                    emptyMessage: controller.emptyMessage,
                    onSelect: controller.onSelect
                });
            });
            buttonEl.dataset.modelSearchRegistered = 'true';
        }

        controllers[key] = controller;
        controller.update();
        return controller;
    }

    global.initializeModelSearchOverlay = initializeModelSearchOverlay;
    global.openModelSearchOverlay = openModelSearchOverlay;
    global.closeModelSearchOverlay = closeModelSearchOverlay;
    global.renderModelSearchResults = renderModelSearchResults;
    global.getModelSearchCache = getModelSearchCache;
    global.setModelSearchCache = setModelSearchCache;
    global.registerModelSearchIntegration = registerModelSearchIntegration;
})(window);
