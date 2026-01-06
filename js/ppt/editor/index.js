/**
 * PPT 编辑器入口
 * 统一入口（ESM）
 * - 显式导入/导出编辑器模块
 * - 保留 window.* 兼容（SlideEditor / ImageProcessor 等）
 */

import { EventEmitter } from './event-emitter.js';
import { StorageManager, storageManager } from './storage-manager.js';
import { SlideDocument } from './document.js';
import { HistoryManager } from './history-manager.js';
import { SelectionManager } from './selection-manager.js';
import { TransformController } from './transform-controller.js';
import { TaskQueue, taskQueue } from './task-queue.js';
import { SlideEditor } from './slide-editor.js';
import { PropertyPanel } from './panels/property-panel.js';
import { LayerPanel } from './panels/layer-panel.js';

export {
    EventEmitter,
    StorageManager,
    storageManager,
    SlideDocument,
    HistoryManager,
    SelectionManager,
    TransformController,
    TaskQueue,
    taskQueue,
    SlideEditor,
    PropertyPanel,
    LayerPanel,
};

/**
 * 兼容：保留旧 API（ESM 下模块已由静态 import 加载）
 */
export async function loadEditorModules() {
    return {
        EventEmitter,
        StorageManager,
        storageManager,
        SlideDocument,
        HistoryManager,
        SelectionManager,
        TransformController,
        TaskQueue,
        taskQueue,
        SlideEditor,
        PropertyPanel,
        LayerPanel,
    };
}

/**
 * 初始化编辑器并集成到 pptGenerator
 */
export async function initSlideEditor(options = {}) {
    await loadEditorModules();

    // 等待存储初始化（仅浏览器环境）
    if (typeof indexedDB !== 'undefined') {
        await storageManager.init();
    }

    // 创建编辑器实例
    const editor = new SlideEditor(options);

    // 如果存在 pptGenerator，集成进去（legacy）
    if (typeof window !== 'undefined' && window.pptGenerator) {
        // 同步数据
        editor.document.on('load', ({ slides }) => {
            window.pptGenerator.slides = slides;
        });

        // 同步当前幻灯片索引
        editor.on('slide:change', ({ index }) => {
            window.pptGenerator.currentSlideIndex = index;
        });

        // 扩展 pptGenerator 方法
        window.pptGenerator.editor = editor;

        // 添加编辑器方法到 pptGenerator
        window.pptGenerator.openEditor = () => editor.init(options.viewportId || 'slide-preview');
        window.pptGenerator.saveToStorage = () => editor.saveProject();
        window.pptGenerator.loadFromStorage = (id) => editor.openProject(id);

        console.log('[Editor] 已集成到 pptGenerator');
    }

    // 全局访问（legacy）
    if (typeof window !== 'undefined') {
        window.slideEditor = editor;
    }

    return editor;
}

/**
 * 创建编辑器 UI
 */
export function createEditorUI(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = `
        <div class="editor-layout">
            <!-- 工具栏 -->
            <div class="editor-toolbar" id="editor-toolbar">
                <div class="editor-toolbar-group">
                    <button class="editor-tool-btn" data-action="new" title="新建项目">
                        <iconify-icon icon="mdi:file-plus"></iconify-icon>
                    </button>
                    <button class="editor-tool-btn" data-action="open" title="打开项目">
                        <iconify-icon icon="mdi:folder-open"></iconify-icon>
                    </button>
                    <button class="editor-tool-btn" data-action="save" title="保存 (Ctrl+S)">
                        <iconify-icon icon="mdi:content-save"></iconify-icon>
                    </button>
                </div>
                
                <div class="editor-toolbar-group">
                    <button class="editor-tool-btn" data-action="undo" title="撤销 (Ctrl+Z)" disabled>
                        <iconify-icon icon="mdi:undo"></iconify-icon>
                    </button>
                    <button class="editor-tool-btn" data-action="redo" title="重做 (Ctrl+Y)" disabled>
                        <iconify-icon icon="mdi:redo"></iconify-icon>
                    </button>
                </div>
                
                <div class="editor-toolbar-group">
                    <button class="editor-tool-btn" data-action="add-text" title="添加文本">
                        <iconify-icon icon="mdi:format-text"></iconify-icon>
                    </button>
                    <button class="editor-tool-btn" data-action="add-image" title="添加图片">
                        <iconify-icon icon="mdi:image-plus"></iconify-icon>
                    </button>
                    <button class="editor-tool-btn" data-action="add-shape" title="添加形状">
                        <iconify-icon icon="mdi:shape-plus"></iconify-icon>
                    </button>
                    <button class="editor-tool-btn" data-action="add-chart" title="添加图表">
                        <iconify-icon icon="mdi:chart-bar"></iconify-icon>
                    </button>
                    <button class="editor-tool-btn" data-action="add-icon" title="添加图标">
                        <iconify-icon icon="mdi:emoticon-plus"></iconify-icon>
                    </button>
                </div>
                
                <div class="editor-toolbar-group">
                    <button class="editor-tool-btn" data-action="ai-generate" title="AI 生成">
                        <iconify-icon icon="mdi:robot"></iconify-icon>
                    </button>
                </div>
                
                <div class="editor-toolbar-group" style="margin-left: auto;">
                    <button class="editor-tool-btn" data-action="export-pptx" title="导出 PPTX">
                        <iconify-icon icon="mdi:file-powerpoint"></iconify-icon>
                    </button>
                    <button class="editor-tool-btn" data-action="export-pdf" title="导出 PDF">
                        <iconify-icon icon="mdi:file-pdf"></iconify-icon>
                    </button>
                </div>
            </div>
            
            <!-- 主体区域 -->
            <div class="editor-main">
                <!-- 左侧：幻灯片列表 -->
                <div class="editor-sidebar-left" id="slide-list-panel">
                    <!-- 幻灯片缩略图列表 -->
                </div>
                
                <!-- 中央：编辑区域 -->
                <div class="editor-center">
                    <div class="editor-viewport-wrapper">
                        <div class="editor-viewport" id="editor-viewport">
                            <!-- 幻灯片内容 -->
                        </div>
                    </div>
                </div>
                
                <!-- 右侧：图层/属性面板 -->
                <div class="editor-sidebar-right">
                    <div class="editor-panel-tabs">
                        <button class="panel-tab active" data-panel="layer">图层</button>
                        <button class="panel-tab" data-panel="property">属性</button>
                    </div>
                    <div class="editor-panel-content">
                        <div id="layer-panel" class="panel-pane active"></div>
                        <div id="property-panel" class="panel-pane"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 添加布局样式
    const style = document.createElement('style');
    style.textContent = `
        .editor-layout {
            display: flex;
            flex-direction: column;
            height: 100%;
            background: #f3f4f6;
        }
        
        .editor-main {
            display: flex;
            flex: 1;
            overflow: hidden;
        }
        
        .editor-sidebar-left {
            width: 180px;
            background: white;
            border-right: 1px solid #e5e7eb;
            overflow-y: auto;
        }
        
        .editor-center {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            overflow: hidden;
        }
        
        .editor-viewport-wrapper {
            width: 100%;
            max-width: 960px;
            aspect-ratio: 16/9;
            background: white;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            border-radius: 4px;
            overflow: hidden;
        }
        
        .editor-viewport {
            width: 100%;
            height: 100%;
            position: relative;
        }
        
        .editor-sidebar-right {
            width: 280px;
            background: white;
            border-left: 1px solid #e5e7eb;
            display: flex;
            flex-direction: column;
        }
        
        .editor-panel-tabs {
            display: flex;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .panel-tab {
            flex: 1;
            padding: 10px;
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 12px;
            color: #6b7280;
            border-bottom: 2px solid transparent;
        }
        
        .panel-tab.active {
            color: #3b82f6;
            border-bottom-color: #3b82f6;
        }
        
        .editor-panel-content {
            flex: 1;
            overflow-y: auto;
        }
        
        .panel-pane {
            display: none;
        }
        
        .panel-pane.active {
            display: block;
        }
    `;
    document.head.appendChild(style);
    
    return {
        toolbar: document.getElementById('editor-toolbar'),
        viewport: document.getElementById('editor-viewport'),
        propertyPanel: document.getElementById('property-panel'),
        layerPanel: document.getElementById('layer-panel'),
    };
}

/**
 * 绑定工具栏事件
 */
export function bindToolbarEvents(editor, toolbar) {
    if (!toolbar) return;
    
    toolbar.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        
        const action = btn.dataset.action;
        
        switch (action) {
            case 'new':
                await editor.newProject();
                break;
            case 'open':
                // TODO: 显示项目列表
                break;
            case 'save':
                await editor.saveProject();
                break;
            case 'undo':
                editor.history.undo();
                break;
            case 'redo':
                editor.history.redo();
                break;
            case 'add-text':
                editor.addElement('text');
                break;
            case 'add-image':
                // 打开文件选择器
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = (e) => {
                    if (e.target.files[0]) {
                        editor.addImageFromFile(e.target.files[0]);
                    }
                };
                input.click();
                break;
            case 'add-shape':
                editor.addElement('shape', { shapeType: 'rect' });
                break;
            case 'add-chart':
                editor.addElement('chart', { chartType: 'bar' });
                break;
            case 'add-icon':
                editor.addElement('icon', { icon: 'mdi:star' });
                break;
            case 'ai-generate':
                // TODO: 打开 AI 对话框
                break;
            case 'export-pptx':
                if (window.pptGenerator) {
                    await window.pptGenerator.exportPPTX();
                }
                break;
            case 'export-pdf':
                if (window.pptGenerator) {
                    await window.pptGenerator._exportPDF();
                }
                break;
        }
    });
    
    // 更新撤销/重做按钮状态
    editor.history.on('change', ({ canUndo, canRedo }) => {
        toolbar.querySelector('[data-action="undo"]').disabled = !canUndo;
        toolbar.querySelector('[data-action="redo"]').disabled = !canRedo;
    });
}

// 兼容：全局挂载（给 legacy IIFE/脚本使用）
if (typeof window !== 'undefined') {
    window.loadEditorModules = loadEditorModules;
    window.initSlideEditor = initSlideEditor;
    window.createEditorUI = createEditorUI;
    window.bindToolbarEvents = bindToolbarEvents;

    window.PPTEditor = Object.assign(window.PPTEditor || {}, {
        EventEmitter,
        StorageManager,
        storageManager,
        SlideDocument,
        HistoryManager,
        SelectionManager,
        TransformController,
        TaskQueue,
        taskQueue,
        SlideEditor,
        PropertyPanel,
        LayerPanel,
    });
}
