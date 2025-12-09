/**
 * 图层编辑器 - 兼容层
 * 
 * 实际实现已模块化拆分至 layer-editor/ 目录
 * 原始文件备份为 layer-editor.legacy.js
 * 
 * 如果模块化版本有问题，设置 USE_LEGACY = true 使用旧版
 */

const USE_LEGACY = false; // 设为 true 可切换到 legacy 版本

// 获取当前脚本路径
const _leScript = document.currentScript;
const _leDir = _leScript ? _leScript.src.substring(0, _leScript.src.lastIndexOf('/') + 1) : '';

// 提供一个 Promise 供外部等待
window.LayerEditorReady = (async function() {
    if (USE_LEGACY) {
        // 直接使用 legacy 版本
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = _leDir + 'layer-editor.legacy.js';
            script.onload = () => {
                console.log('[LayerEditor] Legacy 版本加载成功');
                resolve(window.LayerEditor);
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    try {
        const module = await import(_leDir + 'layer-editor/index.js');
        window.LayerEditor = module.LayerEditor;
        console.log('[LayerEditor] 模块化版本加载成功');
        return window.LayerEditor;
    } catch (error) {
        console.error('[LayerEditor] 模块加载失败，回退到 legacy:', error);
        // 回退：加载 legacy 版本
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = _leDir + 'layer-editor.legacy.js';
            script.onload = () => resolve(window.LayerEditor);
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
})();
