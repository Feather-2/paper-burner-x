/**
 * @file js/index.js
 * @description
 * 主 UI 初始化和模块管理脚本。
 * 该文件负责:
 *  - 初始化全局 `window.ui`命名空间，用于挂载各个 UI 模块的功能。
 *  - 定义 UI 模块的注册机制 (`window.ui.registerModule`)。
 *  - 管理模块加载状态 (`window.ui.moduleStatus`, `EXPECTED_UI_MODULES`, `_allModulesReady`)。
 *  - 提供一个就绪回调队列 (`window.ui.onReady`, `_pendingInitializations`)，确保在所有模块加载完毕且 DOM 就绪后执行初始化代码。
 *  - 包含核心的 UI 初始化逻辑 (`initializeAllUI_internal`)，用于绑定全局事件监听器、初始化特定 UI 组件等。
 *  - 处理特定 UI 元素的动态显隐和交互，如翻译模型选择相关的 UI (`updateTranslationUIVisibility`, `handleCustomModelSelection`)。
 *  - 监听 `DOMContentLoaded` 事件以启动整个 UI 初始化流程。
 */

if (typeof window.ui === 'undefined') {
  console.log('DEBUG index.js: Initializing window.ui object');
  window.ui = {};
} else {
  console.log('DEBUG index.js: window.ui object already exists.');
}

if (typeof window.ui.moduleStatus === 'undefined') {
  console.log('DEBUG index.js: Initializing window.ui.moduleStatus');
  window.ui.moduleStatus = {};
} else {
  console.log('DEBUG index.js: window.ui.moduleStatus already exists.');
}

// Placeholders for core methods - ensures they exist if called early by other scripts
window.ui.registerModule = window.ui.registerModule || function(name, funcs) {
    console.warn(`UI: Placeholder registerModule called for ${name}. Functions will not be registered globally yet.`);
    // Basic status update
    if (window.ui && window.ui.moduleStatus) {
        window.ui.moduleStatus[name] = true; // Mark as loaded for _allModulesReady check
        console.log(`UI模块 (via placeholder) 已记录: ${name}`);
    }
     // Try to execute pending initializations if this was the last expected module according to a basic check
    if (typeof _allModulesReady === 'function' && _allModulesReady() && typeof _executePendingInitializations === 'function') {
        console.warn("Placeholder registerModule: All modules might be ready, attempting to execute initializations.");
        _executePendingInitializations();
    }
};
window.ui.onReady = window.ui.onReady || function(cb) {
    console.warn(`UI: Placeholder onReady called. Executing callback.`);
    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(cb, 0); // Execute async if DOM is somewhat ready
    } else {
        document.addEventListener('DOMContentLoaded', () => setTimeout(cb, 0)); // Otherwise wait for DOM
    }
};
// END OF VERY TOP INITIALIZATION

const EXPECTED_UI_MODULES = ['helpers', 'form', 'fileList', 'progress', 'notification', 'sourceSite', 'keyHandlers', 'keyManager'];
// Initialize moduleStatus for expected modules if not already set by placeholders or previous runs
EXPECTED_UI_MODULES.forEach(name => {
    if (typeof window.ui.moduleStatus[name] === 'undefined' || window.ui.moduleStatus[name] === false) { // Check if false to allow re-init logic
        window.ui.moduleStatus[name] = false;
    }
});

/**
 * 根据是否选择自定义翻译模型，更新相关 UI 元素的可见性和状态。
 * 当用户在翻译模型下拉菜单中选择 "custom" 或从 "custom" 切换到其他模型时，此函数被调用。
 *
 * 主要操作:
 * - 显示或隐藏自定义源站点容器 (`customSourceSiteContainer`)。
 * - 启用或禁用自定义源站点选择下拉框 (`customSourceSiteSelect`)，并在隐藏时清空其选择。
 * - 显示或隐藏自定义源站点信息区域 (`customSourceSiteInfo`)，并在隐藏时清空其内容。
 *
 * @param {boolean} showCustomUI - 如果为 `true`，则显示自定义模型相关的 UI 部分；否则隐藏它们。
 */
function updateTranslationUIVisibility(showCustomUI) {
    // console.log(`UI::updateTranslationUIVisibility, showCustom: ${showCustomUI}`); // Original log
    console.log(`DEBUG index.js: updateTranslationUIVisibility CALLED with showCustom: ${showCustomUI}`);
    if (typeof window.updateTranslationUIVisibility === 'function' && window.updateTranslationUIVisibility !== updateTranslationUIVisibility) {
        window.updateTranslationUIVisibility(showCustomUI);
        return;
    }
    const customSourceSiteContainer = document.getElementById('customSourceSiteContainer');
    const customSourceSiteSelect = document.getElementById('customSourceSiteSelect');
    const customSourceSiteInfo = document.getElementById('customSourceSiteInfo');

    if (customSourceSiteContainer) {
        customSourceSiteContainer.classList.toggle('hidden', !showCustomUI);
    }

    if (customSourceSiteSelect) {
        customSourceSiteSelect.disabled = !showCustomUI;
        if (!showCustomUI) {
            customSourceSiteSelect.value = ''; // Clear selection when hiding
        }
    }

    if (customSourceSiteInfo) {
        customSourceSiteInfo.classList.toggle('hidden', !showCustomUI);
        if (!showCustomUI) {
            customSourceSiteInfo.innerHTML = ''; // Clear info when hiding
        }
    }
}
// CORRECTED SPELLING HERE
window.ui.updateTranslationUIVisibility = updateTranslationUIVisibility;
console.log('DEBUG index.js: Assigned window.ui.updateTranslationUIVisibility. Type is now:', typeof window.ui.updateTranslationUIVisibility);
if (typeof window.ui.updateTranslationUIVisibility !== 'function') {
    console.error('CRITICAL DEBUG index.js: updateTranslationUIVisibility IS NOT A FUNCTION immediately after assignment!');
}

let _pendingInitializations = [];
let _modulesReadyStatus = {}; // This will be populated by the actual registerModule
let _domReady = false;
let _initializationExecuted = false; // Flag to prevent multiple executions


/**
 * 检查所有在 `EXPECTED_UI_MODULES` 中定义的预期 UI 模块是否都已注册并标记为就绪。
 * 它遍历 `EXPECTED_UI_MODULES` 数组，并检查 `window.ui.moduleStatus` 中对应模块的状态。
 *
 * @returns {boolean} 如果所有预期模块都已就绪，则返回 `true`；否则返回 `false`。
 * @private
 */
function _allModulesReady() {
    for (const moduleName of EXPECTED_UI_MODULES) {
        if (!window.ui.moduleStatus[moduleName]) {
            // console.log(`DEBUG index.js: _allModulesReady - Module not ready: ${moduleName}`);
            return false;
        }
    }
    console.log("DEBUG index.js: _allModulesReady - All expected UI modules are ready.");
    return true;
}

/**
 * (全局 `window.ui` 接口)
 * 注册一个 UI 模块及其提供的功能函数到全局 `window.ui` 对象上。
 * 每个模块通过调用此函数来声明自身已加载，并将其公开的接口挂载到 `window.ui`。
 *
 * 主要步骤:
 * 1. 参数校验：确保 `moduleName` 和 `functions` 对象有效。
 * 2. 函数挂载：遍历 `functions` 对象中的每个函数，将其赋值给 `window.ui[funcName]`。
 *    如果发生命名冲突（覆盖已有的非核心 `window.ui` 属性），会打印警告。
 * 3. 状态更新：将 `window.ui.moduleStatus[moduleName]` 设置为 `true`，标记该模块已加载。
 * 4. 触发初始化：调用 `_executePendingInitializations` 尝试执行待处理的初始化任务，
 *    因为一个新模块的加载可能满足了所有初始化条件。
 *
 * @param {string} moduleName - 要注册的模块的名称 (应与 `EXPECTED_UI_MODULES` 中的条目对应)。
 * @param {Object} functions -一个对象，其键是函数名，值是函数本身。这些函数将被添加到 `window.ui`。
 */
window.ui.registerModule = function(moduleName, functions) {
    console.log('DEBUG index.js: registerModule - START. Module:', moduleName, 'Functions:', Object.keys(functions));
    if (!moduleName || typeof moduleName !== 'string') {
        console.error('UI: registerModule - moduleName is invalid.', moduleName);
        return;
    }
    if (!functions || typeof functions !== 'object') {
        console.error(`UI: registerModule - functions for module '${moduleName}' is invalid.`, functions);
        return;
    }

    Object.keys(functions).forEach(funcName => {
        if (window.ui.hasOwnProperty(funcName) &&
            funcName !== 'registerModule' &&
            funcName !== 'onReady' &&
            funcName !== 'moduleStatus' &&
            funcName !== 'updateTranslationUIVisibility' &&
            funcName !== 'handleCustomModelSelection' &&
            funcName !== 'showNotification' &&
            !EXPECTED_UI_MODULES.includes(funcName)
        ) {
            // console.warn(`UI: Module '${moduleName}' is overwriting existing ui function '${funcName}'.`);
        }
        window.ui[funcName] = functions[funcName];
    });

    window.ui.moduleStatus[moduleName] = true;
    console.log(`UI模块已注册: ${moduleName}`);

    // 检查是否所有模块都已加载完成，并且DOM已准备好
    if (typeof _executePendingInitializations === 'function') {
        _executePendingInitializations();
    } else {
         console.error("DEBUG index.js: registerModule - _executePendingInitializations is not defined when trying to call it after module registration.");
    }
};

/**
 * 执行所有通过 `window.ui.onReady` 排队的待处理初始化回调函数。
 * 此函数仅在以下所有条件都满足时才会实际执行回调：
 *  - DOM 已加载完成 (`_domReady` 为 `true`)。
 *  - 所有预期的 UI 模块都已注册 (`_allModulesReady()` 返回 `true`)。
 *  - 初始化流程尚未执行过 (`_initializationExecuted` 为 `false`)。
 *
 * 执行时，它会：
 * 1. 设置 `_initializationExecuted = true` 防止重入。
 * 2. 依次执行 `_pendingInitializations` 队列中的所有回调函数。
 * 3. 调用核心的 `initializeAllUI_internal()` 函数来完成最终的 UI 设置。
 * @private
 */
function _executePendingInitializations() {
    console.log(`DEBUG index.js: _executePendingInitializations called. DOM Ready: ${_domReady}, All Modules Ready: ${typeof _allModulesReady === 'function' ? _allModulesReady() : 'unknown'}, Executed: ${_initializationExecuted}`);
    if (_initializationExecuted) {
        console.log("DEBUG index.js: _executePendingInitializations - Already executed, skipping.");
        return;
    }

    if (_domReady && typeof _allModulesReady === 'function' && _allModulesReady()) {
        console.log('DEBUG index.js: All conditions met, executing pending initializations...');
        _initializationExecuted = true; // Set flag
        while (_pendingInitializations.length > 0) {
            const cb = _pendingInitializations.shift();
            try {
                console.log("DEBUG index.js: Executing a pending initialization callback.");
                cb();
            } catch (e) {
                console.error("Error executing pending initialization:", e);
            }
        }
        console.log("DEBUG index.js: All pending initializations executed.");

        // 确保核心的 initializeAllUI_internal 被调用
        if (typeof initializeAllUI_internal === 'function') {
            console.log("DEBUG index.js: Calling initializeAllUI_internal from _executePendingInitializations.");
            initializeAllUI_internal();
        } else {
            console.error("DEBUG index.js: initializeAllUI_internal is not defined when trying to call from _executePendingInitializations.");
        }

    } else {
        console.log("DEBUG index.js: _executePendingInitializations - Conditions not yet met (or _allModulesReady not defined).");
    }
}

/**
 * (全局 `window.ui` 接口)
 * 注册一个回调函数，该函数将在整个 UI（包括所有模块和 DOM）完全准备就绪后执行。
 * 如果调用此函数时 UI 已经就绪，则回调会几乎立即异步执行。
 * 否则，回调会被添加到一个队列 (`_pendingInitializations`) 中，等待所有条件满足后由 `_executePendingInitializations` 统一执行。
 *
 * @param {function} callback - 当 UI 完全就绪时要执行的回调函数。
 */
window.ui.onReady = function(callback) {
    console.log("DEBUG index.js: window.ui.onReady called with a callback.");
    if (typeof callback !== 'function') {
        console.error('UI: onReady callback is not a function.');
        return;
    }
    if (_domReady && typeof _allModulesReady === 'function' && _allModulesReady() && _initializationExecuted) {
        console.log("DEBUG index.js: onReady - UI already fully initialized, executing callback immediately.");
        setTimeout(callback, 0); // 执行回调，异步以避免栈溢出
    } else {
        console.log("DEBUG index.js: onReady - UI not yet fully initialized or initializations not run, queueing callback.");
        _pendingInitializations.push(callback);
        // 如果DOM已就绪但初始化尚未运行（可能模块仍在加载），尝试运行一次
        if (_domReady && typeof _executePendingInitializations === 'function' && !_initializationExecuted) {
            console.log("DEBUG index.js: onReady - DOM ready, trying to execute pending initializations.");
            _executePendingInitializations();
        }
    }
};

/**
 * 处理当翻译模型下拉框选择发生变化时的逻辑，特别是针对"自定义模型"选项。
 * 当用户选择或取消选择 "custom" 模型时，此函数负责：
 *  1. 调用 `window.ui.updateTranslationUIVisibility` 来切换相关 UI 元素的显隐。
 *  2. 如果选择了 "custom" 模型：
 *     - 尝试调用 `window.ui.tryPopulateCustomSourceSitesDropdown` 来填充自定义源站点下拉列表。
 *     - 自动展开自定义源站点设置区域（如果该区域存在且当前是折叠状态）。
 * @private
 */
function handleCustomModelSelection() {
    console.log("DEBUG index.js: handleCustomModelSelection: 处理自定义模式选择");
    const isCustomModel = document.getElementById('translationModel').value === 'custom';

    if (typeof window.ui.updateTranslationUIVisibility === 'function') {
        window.ui.updateTranslationUIVisibility(isCustomModel);
    } else {
        console.warn("DEBUG index.js: handleCustomModelSelection - updateTranslationUIVisibility is not available on window.ui.");
    }

    if (isCustomModel) {
        console.log("DEBUG index.js: Custom model selected. Attempting to populate dropdown and expand section.");
        if (typeof window.ui.tryPopulateCustomSourceSitesDropdown === 'function') {
            console.log("DEBUG index.js: Calling window.ui.tryPopulateCustomSourceSitesDropdown...");
            window.ui.tryPopulateCustomSourceSitesDropdown();
        } else {
            console.warn("DEBUG index.js: window.ui.tryPopulateCustomSourceSitesDropdown is not available.");
        }
        // 自动展开自定义源站点设置区域
        const customSourceSiteDiv = document.getElementById('customSourceSite');
        const customSourceSiteToggleIconEl = document.getElementById('customSourceSiteToggleIcon');
        if (customSourceSiteDiv && customSourceSiteDiv.classList.contains('hidden')) {
            customSourceSiteDiv.classList.remove('hidden');
            if (customSourceSiteToggleIconEl) {
                customSourceSiteToggleIconEl.setAttribute('icon', 'carbon:chevron-up');
            }
            console.log("DEBUG index.js: Custom source site section expanded.");
        }
    }
}
window.ui.handleCustomModelSelection = handleCustomModelSelection;


/**
 * 核心的内部 UI 初始化函数。
 * 此函数在所有模块加载完毕且 DOM 就绪后，由 `_executePendingInitializations` 调用。
 * 主要职责包括：
 *  - 调用 `window.ui.registerGlobalUIEventListeners` (如果由模块提供) 来注册全局性的事件监听器 (如键盘快捷键)。
 *  - 调用 `window.ui.registerSourceSiteListeners` (如果由模块提供) 来注册与自定义源站点相关的事件监听器。
 *  - 调用 `window.ui.initKeyManagerDisplay` (如果由模块提供) 来初始化 API Key 管理器的显示。
 *  - 检查初始的翻译模型选择状态，并调用 `updateTranslationUIVisibility` 和/或 `handleCustomModelSelection` 以确保 UI 正确显示。
 * @private
 */
function initializeAllUI_internal() {
    console.log("DEBUG index.js: Executing initializeAllUI_internal (event listeners, etc.)...");

    // 全局UI事件 (例如键盘快捷键、弹窗关闭等)
    if (typeof window.ui.registerGlobalUIEventListeners === 'function') {
        window.ui.registerGlobalUIEventListeners();
        console.log("DEBUG index.js: Registered global UI event listeners (from window.ui).");
    } else if (typeof registerGlobalUIEventListeners_internal === 'function') {
        // Fallback to a locally defined one if modules didn't provide it (e.g. if helpers.js moved it here)
        // registerGlobalUIEventListeners_internal(); // This function is no longer defined in index.js
        console.warn("DEBUG index.js: window.ui.registerGlobalUIEventListeners not found. Global listeners might not be set up by helpers.js.");
    }


    // 源站点特定的事件 (例如选择自定义源站点时的行为)
    if (typeof window.ui.registerSourceSiteListeners === 'function') {
        window.ui.registerSourceSiteListeners();
        console.log("DEBUG index.js: Registered source site specific event listeners.");
    } else {
        console.warn("DEBUG index.js: window.ui.registerSourceSiteListeners is not available. Custom source site interactions might be limited.");
    }

    // 初始化Key管理器UI（如果它作为一个模块提供了初始化函数）
    if (typeof window.ui.initKeyManagerDisplay === 'function') {
        window.ui.initKeyManagerDisplay();
        console.log("DEBUG index.js: Initialized Key Manager UI display.");
    } else {
        console.warn("DEBUG index.js: window.ui.initKeyManagerDisplay is not available. Key manager UI might not initialize correctly.");
    }

    // 检查初始翻译模型选择，并相应地更新UI
    const initialTranslationModel = document.getElementById('translationModel');
    if (initialTranslationModel) {
        console.log(`DEBUG index.js: Initial translation model value: ${initialTranslationModel.value}`);
        if (typeof window.ui.updateTranslationUIVisibility === 'function') {
            window.ui.updateTranslationUIVisibility(initialTranslationModel.value === 'custom');
            console.log("DEBUG index.js: Initial call to updateTranslationUIVisibility in initializeAllUI_internal done.");
        } else {
            console.warn("DEBUG index.js: updateTranslationUIVisibility function not available in initializeAllUI_internal for initial UI setup.");
        }
        // 如果初始模型是 'custom'，确保自定义源站点下拉列表已填充
        if (initialTranslationModel.value === 'custom') {
             if (typeof window.ui.handleCustomModelSelection === 'function') {
                //  window.ui.handleCustomModelSelection(); // This will also call updateTranslationUIVisibility
                 console.log("DEBUG index.js: Initial model is custom, handleCustomModelSelection should have run or will run via onReady.");
             } else {
                 console.warn("DEBUG index.js: window.ui.handleCustomModelSelection not available for initial custom model check.");
             }
        }
    } else {
        console.warn("DEBUG index.js: Translation model select element not found during initializeAllUI_internal.");
    }
    console.log("DEBUG index.js: initializeAllUI_internal finished.");
}


/**
 * DOMContentLoaded 事件的监听器回调。
 * 当 HTML 文档完全加载并解析完成后（不等待样式表、图像和子框架），此函数被触发。
 *
 * 主要操作:
 * 1. 设置全局标志 `_domReady = true`。
 * 2. 调用 `_executePendingInitializations()` 尝试启动待处理的初始化任务。
 *    （如果此时模块尚未全部加载，`_executePendingInitializations` 内部逻辑会等待）。
 * 3. 为翻译模型选择器 (`#translationModel`) 绑定 `change` 事件监听器：
 *    - 当选择变化时，调用 `window.ui.handleCustomModelSelection` 更新相关 UI。
 *    - (注释中提及) `saveCurrentSettings` 应由 `app.js` 处理，以避免逻辑冲突。
 * 4. (注释中提及) 初始的自定义模型检查和 UI 更新会由 `initializeAllUI_internal` 通过 `onReady` 流程处理，
 *    此处不再直接触发 `handleCustomModelSelection`。
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log('DEBUG index.js: DOMContentLoaded event fired.');
    _domReady = true;
    // 尝试执行初始化。如果模块尚未全部注册，_executePendingInitializations 内部会等待。
    if (typeof _executePendingInitializations === 'function') {
        _executePendingInitializations();
    } else {
        console.error('DEBUG index.js: _executePendingInitializations is not defined at DOMContentLoaded!');
    }

    // 为翻译模型选择器绑定事件 (如果存在)
    const translationModelSelect = document.getElementById('translationModel');
    if (translationModelSelect) {
        console.log("DEBUG index.js: Found translation model selector, adding change event listener.");
        translationModelSelect.addEventListener('change', function() {
            const selectedValue = this.value;
            console.log(`DEBUG index.js: Translation model changed to: ${selectedValue}`);

            // 先保存设置
            if (typeof saveCurrentSettings === 'function') {
                saveCurrentSettings();
                console.log("DEBUG index.js: Settings saved after translation model change.");
            } else {
                console.warn("DEBUG index.js: saveCurrentSettings function not found.");
            }

            // 调用 handleCustomModelSelection 来处理UI联动，它内部会调用 updateTranslationUIVisibility
            if (typeof window.ui.handleCustomModelSelection === 'function') {
                window.ui.handleCustomModelSelection();
            } else {
                 console.warn('DEBUG index.js: window.ui.handleCustomModelSelection function not available during translation model change.');
                 // Fallback: direct call if handleCustomModelSelection is missing
                 if (typeof window.ui.updateTranslationUIVisibility === 'function') {
                    window.ui.updateTranslationUIVisibility(selectedValue === 'custom');
                } else {
                    console.warn('DEBUG index.js: updateTranslationUIVisibility function also not available on window.ui during translation model change (fallback).');
                }
            }

            // 触发验证状态更新（在设置保存后）- 直接调用全局刷新函数
            if (typeof window.refreshValidationState === 'function') {
                setTimeout(() => {
                    console.log('[DEBUG] Triggering refreshValidationState after settings save');
                    window.refreshValidationState();
                }, 100);
            } else {
                console.warn('[DEBUG] window.refreshValidationState not available');
            }
        });

        // 触发一次初始检查，以防页面加载时已选择了 "custom"
        // 这将由 initializeAllUI_internal -> onReady -> _executePendingInitializations -> initializeAllUI_internal 处理
        // if (typeof window.ui.handleCustomModelSelection === 'function') {
        //    console.log("DEBUG index.js: Triggering initial handleCustomModelSelection check post DOMContentLoaded and listener setup.");
        //    // window.ui.handleCustomModelSelection(); // Avoid direct call, let initialization flow handle it.
        // }

    } else {
        console.warn("DEBUG index.js: Translation model select element not found after DOMContentLoaded.");
    }
});

console.log("DEBUG index.js: End of script. Waiting for module registrations and DOMContentLoaded.");