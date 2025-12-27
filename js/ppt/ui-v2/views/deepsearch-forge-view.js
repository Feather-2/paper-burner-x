/**
 * DeepSearch Forge View
 * 集成了侧边栏、文档编辑器和 AI 助手的综合视图
 */

import { BaseView } from './base-view.js';
import { Sidebar } from './forge/sidebar.js';
import { Document } from './forge/document.js';
import { Copilot } from './forge/copilot.js';
import { LogicLayer } from './forge/logic-layer.js';
import { DeepSearchAdapter } from '../adapters/deepsearch-adapter.js';

export class DeepSearchForgeView extends BaseView {
  constructor(options = {}) {
    super(options);
    this._isFlowMode = false;
    this._adapter = new DeepSearchAdapter(this._eventBus);
    
    // 资源路径配置
    this._assetPaths = options.assetPaths || {
      logo: 'public/h_with_name.svg'
    };
    
    // 初始化子组件引用
    this._sidebar = null;
    this._document = null;
    this._copilot = null;
    this._logicLayer = null;
  }

  render() {
    return `
      <div id="pptGeneratorOverlay" class="forge-body">
          <header class="app-header flex items-center justify-between px-5 z-40 relative">
              <div class="flex items-center gap-3">
                  <img src="${this._assetPaths.logo}" class="h-8" alt="Logo">
              </div>

              <!-- 通知队列容器 -->
              <div id="notification-queue" class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-50"></div>

              <div class="flex items-center gap-6">
                  <div class="flex items-center gap-3">
                      <span class="text-[11px] font-medium text-slate-400 uppercase tracking-widest">同步状态</span>
                      <div class="flex items-center gap-1.5">
                          <span class="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                          <span class="text-[11px] font-bold text-slate-700">实时连接中</span>
                      </div>
                  </div>
                  <div class="h-4 w-px bg-slate-200"></div>
                  <button class="text-slate-500 hover:text-slate-800 transition-colors">
                      <iconify-icon icon="carbon:settings" width="18"></iconify-icon>
                  </button>
                  <button class="bg-slate-900 text-white px-3 py-1.5 rounded-md text-[11px] font-bold hover:bg-slate-800 transition-all active:scale-95 shadow-sm">
                      导出报告
                  </button>
              </div>
          </header>

          <main class="flex-1 flex overflow-hidden relative">
              <!-- Background Decor -->
              <div class="bg-glow top-[-10%] left-[-10%]"></div>
              <div class="bg-glow bottom-[-10%] right-[-10%]"></div>

              <!-- Logic Layer Container -->
              <div id="logic-layer-container" class="absolute inset-0 z-0 overflow-hidden"></div>

              <!-- Sidebar -->
              <aside id="forge-sidebar-container" class="w-[264px] forge-sidebar flex flex-col flex-shrink-0 z-30 relative"></aside>

              <!-- Document Forge -->
              <section id="forge-document-container" class="flex-1 overflow-y-auto flex flex-col items-center pt-6 pb-20 relative z-10 custom-scrollbar bg-slate-50/30"></section>

              <!-- Copilot Panel -->
              <aside id="forge-copilot-container" class="w-[352px] forge-sidebar flex flex-col flex-shrink-0 z-30 relative bg-white"></aside>
          </main>
      </div>
    `;
  }

  onMount() {
    // 1. 初始化子组件
    this._sidebar = new Sidebar(this.$('#forge-sidebar-container'), { eventBus: this._eventBus });
    this._document = new Document(this.$('#forge-document-container'), { eventBus: this._eventBus });
    this._copilot = new Copilot(this.$('#forge-copilot-container'), { eventBus: this._eventBus });
    this._logicLayer = new LogicLayer(this.$('#logic-layer-container'), { eventBus: this._eventBus });

    // 2. 渲染子组件 HTML
    this.$('#forge-sidebar-container').innerHTML = this._sidebar.render();
    this.$('#forge-document-container').innerHTML = this._document.render();
    this.$('#forge-copilot-container').innerHTML = this._copilot.render();

    // 3. 挂载逻辑
    this._document.mount();
    this._logicLayer.mount();

    // 4. 订阅通知事件
    this.subscribeEvent('forge:notification', (data) => this.showNotification(data.message, data.icon));

    // 5. 启动数据适配器
    this._adapter.start();
  }

  onUnmount() {
    if (this._adapter) {
      this._adapter.stop();
    }
  }

  // --- Action Handlers ---

  _onToggleExploreFlow() {
    this._sidebar.toggleExploreFlow();
  }

  _onToggleViewMode() {
    this._isFlowMode = !this._isFlowMode;
    const overlay = this.$('#pptGeneratorOverlay');
    
    if (this._isFlowMode) {
      overlay.classList.add('view-mode-flow');
      this.showNotification('已切换至知识图谱模式', 'carbon:network-4');
    } else {
      overlay.classList.remove('view-mode-flow');
      this.showNotification('已切换至文档编辑模式', 'carbon:document');
    }
    
    this._sidebar.updateViewMode(this._isFlowMode);
  }

  _onToggleTodo() {
    this._copilot.toggleTodo();
  }

  _onAddNewSection() {
    this._document.addNewSection();
    this.showNotification('已添加新章节', 'carbon:add-alt');
  }

  _onOpenSource(ctx) {
    const sourceName = ctx.element.dataset.source;
    this.showNotification(`正在打开：${sourceName}`, 'carbon:document-view');
  }

  // --- UI Helpers ---

  showNotification(message, icon = 'carbon:information') {
    const queue = this.$('#notification-queue');
    if (!queue) return;

    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.innerHTML = `
        <iconify-icon icon="${icon}" width="20"></iconify-icon>
        <span>${message}</span>
    `;
    queue.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, 4000);
  }
}

export default DeepSearchForgeView;
