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
 * 更新翻译相关UI元素的可见性 (例如自定义源站点部分)
 * @param {boolean} showCustomUI - 如果为 true, 显示自定义UI部分；否则隐藏。
 */
function updateTranslationUIVisibility(showCustomUI) {
    // console.log(`UI::updateTranslationUIVisibility, showCustom: ${showCustomUI}`); // Original log
    console.log(`DEBUG index.js: updateTranslationUIVisibility CALLED with showCustom: ${showCustomUI}`);
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

// 内部函数：处理自定义模型选择的逻辑
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


// 核心UI初始化逻辑，注册事件监听器等
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

            // 保存设置 (app.js 中也有类似逻辑，确保一致或协调)
            if (typeof saveCurrentSettings === 'function') { // saveCurrentSettings is in app.js
                 // saveCurrentSettings(); // Let app.js handle this to avoid conflicts, or ensure it's safe
                 console.log("DEBUG index.js: Translation model changed, saveCurrentSettings (if available in app.js) should handle saving.");
            } else {
                console.warn("DEBUG index.js: saveCurrentSettings function not found (expected in app.js). Settings may not save on model change from here.");
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