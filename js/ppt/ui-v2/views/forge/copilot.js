/**
 * Forge Copilot Component
 */

export class Copilot {
  constructor(container, options = {}) {
    this._container = container;
    this._eventBus = options.eventBus;
  }

  render() {
    return `
      <div class="h-[52px] flex items-center justify-between px-4 border-b border-slate-100">
          <div class="flex items-center gap-2">
              <iconify-icon icon="carbon:ai-governance" class="text-indigo-600" width="18"></iconify-icon>
              <span class="text-[12px] font-bold text-slate-800">Forge 助手</span>
          </div>
          <div class="flex items-center gap-1">
              <button class="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-md transition-all">
                  <iconify-icon icon="carbon:close" width="16"></iconify-icon>
              </button>
          </div>
      </div>

      <!-- TODOs Section -->
      <div class="todo-section" id="todo-panel">
          <div class="flex items-center justify-between p-3 cursor-pointer hover:bg-slate-50/50 transition-colors" data-action="toggleTodo">
              <div class="flex items-center gap-2">
                  <span class="text-[10px] font-bold text-slate-400 uppercase tracking-tight">任务清单</span>
                  <span class="text-[9px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded">3/5</span>
              </div>
              <iconify-icon icon="carbon:chevron-down" class="text-slate-300 transition-transform" id="todo-chevron"></iconify-icon>
          </div>
          <div class="px-3 pb-3 space-y-2" id="todo-items">
              <div class="flex items-start gap-2.5 group">
                  <div class="w-4 h-4 rounded border-2 border-indigo-500 bg-indigo-500 flex items-center justify-center text-white mt-0.5">
                      <iconify-icon icon="carbon:checkmark" width="10"></iconify-icon>
                  </div>
                  <span class="text-[12px] text-slate-400 line-through leading-tight">分析云原生 market 趋势</span>
              </div>
              <div class="flex items-start gap-2.5 group">
                  <div class="w-4 h-4 rounded border-2 border-slate-200 bg-white mt-0.5 hover:border-indigo-400 transition-colors cursor-pointer"></div>
                  <span class="text-[12px] text-slate-600 font-medium leading-tight">研究供应链安全</span>
              </div>
          </div>
      </div>

      <!-- Chat History -->
      <div class="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-6" id="ai-chat-history">
          <div class="space-y-3">
              <div class="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <iconify-icon icon="carbon:flow-stream" class="text-indigo-400"></iconify-icon>
                  思考过程
              </div>
              <div class="text-[11px] text-slate-500 leading-relaxed pl-4 border-l-2 border-slate-100">
                  正在对比 Gartner 报告与现有的 24% 增长数据，确保论据的权威性。
              </div>
          </div>

          <div class="bg-indigo-50/30 border border-indigo-100/50 rounded-xl p-3.5 relative overflow-hidden group">
              <div class="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <iconify-icon icon="carbon:copy" class="text-indigo-300 hover:text-indigo-500 cursor-pointer"></iconify-icon>
              </div>
              <p class="text-[12px] text-slate-700 leading-relaxed font-medium">
                  章节“核心竞争分析”已补全。已根据证据块 <span class="text-indigo-600 font-bold">CP_024</span> 修正了参与者 A 的数据。
              </p>
          </div>
      </div>

      <!-- Input Area -->
      <div class="p-2 px-3 border-t border-slate-100 bg-white">
          <div class="border border-slate-200 rounded-xl p-2 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-50 transition-all">
              <textarea class="w-full bg-transparent border-none outline-none text-[12px] resize-none py-1 px-1" placeholder="有什么我可以帮您的吗？" rows="1"></textarea>
              <div class="flex items-center justify-between mt-2 pt-2 border-t border-slate-50">
                  <div class="flex gap-1">
                      <button class="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-md transition-all">
                          <iconify-icon icon="carbon:image" width="16"></iconify-icon>
                      </button>
                      <button class="p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 rounded-md transition-all">
                          <iconify-icon icon="carbon:earth" width="16"></iconify-icon>
                      </button>
                  </div>
                  <button class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-sm hover:bg-indigo-700 transition-all flex items-center gap-1.5">
                      发送
                      <iconify-icon icon="carbon:send-alt-filled" width="12"></iconify-icon>
                  </button>
              </div>
          </div>
          <div class="mt-1 text-center">
              <span class="text-[9px] text-slate-400 font-mono uppercase tracking-tighter">Powered by Deepsearch Agent</span>
          </div>
      </div>
    `;
  }

  toggleTodo() {
    const el = this._container.querySelector('#todo-panel');
    const chevron = this._container.querySelector('#todo-chevron');
    el.classList.toggle('collapsed');
    chevron.style.transform = el.classList.contains('collapsed') ? 'rotate(-90deg)' : 'none';
  }
}
