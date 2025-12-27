/**
 * Forge Document Component
 */

export class Document {
  constructor(container, options = {}) {
    this._container = container;
    this._eventBus = options.eventBus;
  }

  render() {
    return `
      <div class="document-forge" id="main-draft" data-version="BETA_0.4.2">
          <div class="watermark">内部草稿</div>
          <h1 class="text-[42px] font-black text-slate-900 mb-12 tracking-tight leading-tight">云原生安全市场<br>深度分析报告</h1>
          
          <div class="space-y-16 relative z-10" id="sections-container">
              <section>
                  <h2 class="text-[19px] font-black text-indigo-600 mb-5 flex items-center gap-3">
                      1. 行业概览
                      <iconify-icon icon="carbon:checkmark-filled" class="text-emerald-500 text-[20px]"></iconify-icon>
                  </h2>
                  <p class="text-[15px] text-slate-600 leading-[1.8] text-justify font-medium">
                      随着 2024 年全球数字化转型的深入，云原生架构已成为企业核心 IT 的标配。根据最新检索到的行业数据，API 安全与零信任架构已连续三个季度位居技术支出榜首。
                  </p>
              </section>

              <section class="relative">
                  <h2 class="text-[19px] font-black text-indigo-600 mb-5 flex items-center gap-3" id="section-competitor">
                      2. 核心竞争分析
                      <iconify-icon icon="carbon:circle-dash" class="text-indigo-400 animate-spin text-[20px]"></iconify-icon>
                  </h2>
                  <div class="p-10 border border-indigo-100/80 rounded-2xl bg-indigo-50/10 min-h-[160px] relative overflow-hidden backdrop-blur-[2px]">
                      <div class="absolute top-0 left-0 w-1.5 h-full bg-indigo-500/40"></div>
                      <p class="text-[11px] text-indigo-500 font-black uppercase tracking-[0.2em] mb-5 flex items-center gap-2.5">
                          <span class="w-2 h-2 bg-indigo-500 rounded-full animate-ping"></span>
                          Real-time Synthesis Active
                      </p>
                      <div class="text-[16px] text-slate-800 leading-[1.7] font-semibold typing-content" id="typing-box">
                          正在根据 CP_024 证据块补全：主要市场参与者 A 在 Q3 实现了 24% 的溢价增长...
                      </div>
                  </div>
              </section> section>
          </div>

          <button class="add-section-btn" data-action="addNewSection">
              <iconify-icon icon="carbon:add" width="20"></iconify-icon>
              添加新分析章节
          </button>

          <div class="mt-28 pt-10 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400 font-mono tracking-widest">
              <span class="flex items-center gap-2">
                  <iconify-icon icon="carbon:page-number" width="12"></iconify-icon>
                  PAGE 02 / 12
              </span>
              <span class="bg-slate-50 px-3 py-1 rounded">INTERNAL_USE_STRICTLY_CONFIDENTIAL</span>
          </div>
      </div>
    `;
  }

  mount() {
    this._eventBus.on('forge:typing-update', ({ phrase }) => {
      this.updateTypingContent(phrase);
    });
  }

  updateTypingContent(phrase) {
    const box = this._container.querySelector('#typing-box');
    if (!box) return;
    box.style.opacity = '0';
    setTimeout(() => {
      box.textContent = phrase;
      box.style.opacity = '1';
    }, 500);
  }

  addNewSection() {
    const container = this._container.querySelector('#sections-container');
    const newSec = document.createElement('section');
    newSec.innerHTML = `
        <h2 class="text-[19px] font-black text-indigo-600 mb-5 flex items-center gap-3">
            新分析章节
            <iconify-icon icon="carbon:edit" class="text-slate-300 cursor-pointer hover:text-indigo-600"></iconify-icon>
        </h2>
        <div class="p-6 border-2 border-dashed border-slate-100 rounded-xl text-slate-400 text-sm text-center">
            点击此处或通过 Forge 助手生成内容
        </div>
    `;
    container.appendChild(newSec);
  }
}
