/**
 * Forge Sidebar Component
 */

export class Sidebar {
  constructor(container, options = {}) {
    this._container = container;
    this._eventBus = options.eventBus;
  }

  render() {
    return `
      <div class="flex-1 flex flex-col min-h-0 py-4">
          <div class="sidebar-label">核心来源</div>
          <div class="space-y-0.5" id="evidence-list">
              <div class="nav-item group" data-action="openSource" data-source="Q3_安全报告.pdf">
                  <iconify-icon icon="carbon:pdf-reference" class="text-red-400" width="16"></iconify-icon>
                  <span class="flex-1 truncate">Q3_安全报告.pdf</span>
                  <div class="open-hint">
                      <span>打开</span>
                      <iconify-icon icon="carbon:launch" width="12"></iconify-icon>
                  </div>
              </div>
              <div class="nav-item group" data-action="openSource" data-source="gartner.com/trends">
                  <iconify-icon icon="carbon:link" class="text-indigo-400" width="16"></iconify-icon>
                  <span class="flex-1 truncate">gartner.com/trends</span>
                  <div class="open-hint">
                      <span>访问</span>
                      <iconify-icon icon="carbon:launch" width="12"></iconify-icon>
                  </div>
              </div>
              
              <!-- 处理中的来源 -->
              <div class="nav-item group processing-source">
                  <iconify-icon icon="carbon:document-pdf" class="text-slate-300" width="16"></iconify-icon>
                  <span class="flex-1 truncate text-slate-400">核心架构说明.pdf</span>
                  <span class="processing-tag">处理中</span>
                  <div class="source-progress-container">
                      <div class="source-progress-fill" style="width: 65%"></div>
                  </div>
              </div>
          </div>

          <div class="mt-8 flex-1 flex flex-col min-h-0">
              <div class="sidebar-label flex items-center justify-between cursor-pointer" data-action="toggleExploreFlow">
                  <span>探索流</span>
                  <iconify-icon icon="carbon:chevron-down" class="text-slate-300" id="gap-chevron"></iconify-icon>
              </div>
              <div class="hidden px-2 mt-1" id="gap-list-container">
                  <div class="nav-item !text-[11px] text-slate-400">
                      <iconify-icon icon="carbon:dot-mark" class="text-slate-200" width="12"></iconify-icon>
                      <span>隐私计算分类研究</span>
                  </div>
              </div>
          </div>

          <!-- 统一底部切换器 -->
          <div class="p-4 bg-slate-50/50 border-t border-slate-100">
              <div class="mini-map-container mb-2" data-action="toggleViewMode">
                  <div class="mini-map-view" id="mini-map-content">
                      <iconify-icon icon="carbon:network-4" width="40"></iconify-icon>
                  </div>
                  <div class="view-switcher">
                      <div class="view-btn active" id="btn-doc">文档模式</div>
                      <div class="view-btn" id="btn-flow">知识图谱</div>
                  </div>
              </div>
              <p class="text-[10px] text-center text-slate-400 font-bold uppercase tracking-widest">切换视图模式</p>
          </div>
      </div>
    `;
  }

  toggleExploreFlow() {
    const el = this._container.querySelector('#gap-list-container');
    const chevron = this._container.querySelector('#gap-chevron');
    el.classList.toggle('hidden');
    chevron.style.transform = el.classList.contains('hidden') ? 'none' : 'rotate(180deg)';
  }

  updateViewMode(isFlowMode) {
    const docBtn = this._container.querySelector('#btn-doc');
    const flowBtn = this._container.querySelector('#btn-flow');
    if (isFlowMode) {
      docBtn.classList.remove('active');
      flowBtn.classList.add('active');
    } else {
      docBtn.classList.add('active');
      flowBtn.classList.remove('active');
    }
  }
}
