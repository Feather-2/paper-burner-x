import { BaseView } from './base-view.js';
import { Copilot } from './forge/copilot.js';

/**
 * TimelineReflowView
 * 支持批次生成和时间线流动的视图，集成 Forge UI 规范
 */
export class TimelineReflowView extends BaseView {
    constructor(options = {}) {
        super(options);
        this._assetPaths = options.assetPaths || {
            logo: '../public/h_with_name.svg'
        };
        this._copilot = null;
        this._nodes = Array.from({length: 12}, (_, i) => ({ id: i+1, title: `幻灯片节点 ${i+1}` }));
    }

    render() {
        return `
            <div id="pptTimelineOverlay" class="forge-body flex flex-col h-screen w-full overflow-hidden bg-slate-50">
                <header class="app-header flex items-center justify-between px-5 z-40 relative flex-shrink-0 bg-white border-b border-slate-100 h-[52px]">
                    <div class="flex items-center gap-3">
                        <img src="${this._assetPaths.logo}" class="h-8" alt="Logo">
                    </div>

                    <div id="notification-queue" class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-50"></div>

                    <div class="flex items-center gap-6">
                        <div class="flex items-center gap-3">
                            <span class="text-[11px] font-medium text-slate-400 uppercase tracking-widest">批次状态</span>
                            <div class="flex items-center gap-1.5">
                                <span class="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                                <span class="text-[11px] font-bold text-slate-700" id="status-text">就绪</span>
                            </div>
                        </div>
                        <div class="h-4 w-px bg-slate-200"></div>
                        <button id="btn-run" class="bg-slate-900 text-white px-4 py-1.5 rounded-md text-[11px] font-bold hover:bg-slate-800 transition-all active:scale-95 shadow-sm">
                            启动生产流
                        </button>
                    </div>
                </header>

                <main class="flex-1 flex overflow-hidden relative">
                    <!-- Queue Sidebar (Left) -->
                    <aside id="forge-sidebar-container" class="w-[264px] forge-sidebar flex flex-col flex-shrink-0 z-30 relative transition-all duration-500 border-r border-slate-100 bg-[#f9fafb] overflow-hidden">
                        <div class="h-[52px] flex items-center px-4 border-b border-slate-100 flex-shrink-0 bg-white">
                            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-widest">待处理大纲队列</span>
                        </div>
                        <div class="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3" id="queue-container">
                            <!-- Queue items will be rendered here -->
                        </div>
                    </aside>

                    <!-- Main Stage -->
                    <section class="flex-1 overflow-hidden flex flex-col relative z-10">
                        <div class="h-12 bg-white/80 backdrop-blur-sm border-b border-slate-100 flex items-center px-6 gap-8 overflow-x-auto custom-scrollbar flex-shrink-0" id="timeline-bar">
                            <div class="flex items-center gap-2 text-[11px] font-bold text-slate-400 milestone whitespace-nowrap" id="ms-1">
                                <iconify-icon icon="carbon:batch-job"></iconify-icon>BATCH 1
                            </div>
                            <div class="flex items-center gap-2 text-[11px] font-bold text-slate-400 milestone whitespace-nowrap" id="ms-2">
                                <iconify-icon icon="carbon:batch-job"></iconify-icon>BATCH 2
                            </div>
                            <div class="flex items-center gap-2 text-[11px] font-bold text-slate-400 milestone whitespace-nowrap" id="ms-3">
                                <iconify-icon icon="carbon:batch-job"></iconify-icon>BATCH 3
                            </div>
                        </div>

                        <div class="flex-1 overflow-y-auto p-6 custom-scrollbar bg-slate-50/50 relative" id="slide-viewer">
                            <!-- Default Empty State -->
                            <div id="empty-state" class="absolute inset-0 flex flex-col items-center justify-center text-center p-8 transition-all duration-500">
                                <div class="relative mb-6">
                                    <div class="w-20 h-20 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-500 animate-pulse">
                                        <iconify-icon icon="carbon:document-blank" width="40"></iconify-icon>
                                    </div>
                                    <div class="absolute -bottom-2 -right-2 w-8 h-8 bg-white rounded-lg shadow-sm border border-slate-100 flex items-center justify-center text-emerald-500 animate-bounce">
                                        <iconify-icon icon="carbon:play-filled" width="16"></iconify-icon>
                                    </div>
                                </div>
                                <h3 class="text-[16px] font-bold text-slate-800 mb-2">等待启动生产流</h3>
                                <p class="text-[12px] text-slate-400 max-w-[280px] leading-relaxed">
                                    点击顶栏的“启动生产流”按钮，Design Agent 将开始按批次解析并生成您的幻灯片。
                                </p>
                                <div class="mt-8 flex gap-4">
                                    <div class="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-white px-3 py-1.5 rounded-full border border-slate-100">
                                        <span class="w-1.5 h-1.5 bg-slate-300 rounded-full"></span>
                                        12 待处理节点
                                    </div>
                                    <div class="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest bg-white px-3 py-1.5 rounded-full border border-slate-100">
                                        <span class="w-1.5 h-1.5 bg-slate-300 rounded-full"></span>
                                        3 预设批次
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Batch sections will be added here -->
                        </div>
                    </section>

                    <!-- Copilot (Right) -->
                    <aside id="forge-copilot-container" class="w-[352px] forge-sidebar flex flex-col flex-shrink-0 z-30 relative bg-white border-l border-slate-100 overflow-hidden"></aside>
                </main>
            </div>
            
            <style>
                .milestone { transition: all 0.3s ease; }
                .milestone-active { color: #6366f1 !important; position: relative; }
                .active-indicator { position: absolute; bottom: -14px; left: 0; right: 0; height: 2px; background: #6366f1; border-radius: 2px 2px 0 0; }
                .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
                
                @keyframes bounce-in {
                    0% { transform: scale(0.9); opacity: 0; }
                    70% { transform: scale(1.05); }
                    100% { transform: scale(1); opacity: 1; }
                }
                .animate-bounce-in { animation: bounce-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }
                
                .batch-section-entrance {
                    animation: section-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
                @keyframes section-in {
                    from { opacity: 0; transform: translateY(30px) scale(0.98); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
            </style>
        `;
    }

    onMount() {
        const copilotContainer = this.$('#forge-copilot-container');
        this._copilot = new Copilot(copilotContainer, { eventBus: this._eventBus });
        copilotContainer.innerHTML = this._copilot.render();

        const footerTag = copilotContainer.querySelector('.font-mono.uppercase');
        if (footerTag) {
            footerTag.textContent = 'Powered by Design Agent';
        }

        this._renderQueue();
        this._initCopilotContent();

        // 绑定事件
        this.$('#btn-run').addEventListener('click', () => this.runTimelineFlow());
        
        copilotContainer.addEventListener('click', (e) => {
            const toggleBtn = e.target.closest('[data-action="toggleTodo"]');
            if (toggleBtn) {
                this._copilot.toggleTodo();
            }
            
            const finishBtn = e.target.closest('#btn-finish-design');
            if (finishBtn) {
                this.showNotification('正在切换至精细编辑模式...', 'carbon:edit');
            }
        });
    }

    _initCopilotContent() {
        const history = this.$('#ai-chat-history');
        if (history) {
            history.innerHTML = `
                <div class="space-y-3" id="thought-container">
                    <div class="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                        <iconify-icon icon="carbon:flow-stream" class="text-indigo-400"></iconify-icon>
                        当前流程状态
                    </div>
                    <div class="text-[11px] text-slate-500 leading-relaxed pl-4 border-l-2 border-slate-100 thought-item">
                        系统已就绪，等待启动生产流。待处理节点：12个。
                    </div>
                </div>
            `;
        }
        
        const todoPanel = this.$('#todo-panel');
        if (todoPanel) {
            todoPanel.querySelector('.text-indigo-500').textContent = '0/4';
            const items = this.$('#todo-items');
            items.innerHTML = `
                <div class="flex items-start gap-2.5 group">
                    <div class="w-4 h-4 rounded border-2 border-slate-200 bg-white mt-0.5" id="todo-step-1"></div>
                    <span class="text-[12px] text-slate-600 font-medium leading-tight">Outline Parsing (大纲解析)</span>
                </div>
                <div class="flex items-start gap-2.5 group">
                    <div class="w-4 h-4 rounded border-2 border-slate-200 bg-white mt-0.5" id="todo-step-2"></div>
                    <span class="text-[12px] text-slate-600 font-medium leading-tight">Style Extracting (样式提取)</span>
                </div>
                <div class="flex items-start gap-2.5 group">
                    <div class="w-4 h-4 rounded border-2 border-slate-200 bg-white mt-0.5" id="todo-step-3"></div>
                    <span class="text-[12px] text-slate-600 font-medium leading-tight">Generating (幻灯片生成)</span>
                </div>
                <div class="flex items-start gap-2.5 group">
                    <div class="w-4 h-4 rounded border-2 border-slate-200 bg-white mt-0.5" id="todo-step-4"></div>
                    <span class="text-[12px] text-slate-600 font-medium leading-tight">Reviewing (质量检查)</span>
                </div>
            `;
        }
    }

    _renderQueue() {
        const container = this.$('#queue-container');
        if (!container) return;

        container.innerHTML = this._nodes.map(n => `
            <div class="p-3 bg-white border border-slate-100 rounded-lg shadow-sm transition-all duration-500 outline-item" id="node-${n.id}">
                <div class="text-[11px] font-bold text-slate-700">${n.title}</div>
                <div class="flex items-center gap-1.5 mt-1">
                    <span class="text-[9px] text-slate-400">Claims: CP_0${n.id}</span>
                </div>
            </div>
        `).join('');
    }

    async runTimelineFlow() {
        const btn = this.$('#btn-run');
        const statusText = this.$('#status-text');
        const viewer = this.$('#slide-viewer');
        const sidebar = this.$('#forge-sidebar-container');
        const emptyState = this.$('#empty-state');
        
        btn.style.display = 'none';
        statusText.textContent = '设计中...';
        
        // Hide empty state
        if (emptyState) {
            emptyState.style.opacity = '0';
            emptyState.style.transform = 'scale(0.95)';
            setTimeout(() => emptyState.remove(), 500);
        }

        this.addThought("正在执行 design.phase.transition: outline_parsing", false, "carbon:flow");
        await new Promise(r => setTimeout(r, 800));
        this.updateTodoStep(1, "1/4");

        this.addThought("正在执行 design.phase.transition: style_extracting", false, "carbon:color-palette");
        await new Promise(r => setTimeout(r, 600));
        this.addThought("已完成 design.tokens.ended: 提取到深蓝色系商务主题", true);
        this.updateTodoStep(2, "2/4");

        this.addThought("正在执行 design.phase.transition: generating", false, "carbon:document-add");
        
        for (let b = 0; b < 3; b++) {
            const batchNum = b + 1;
            const batchIds = [b*4+1, b*4+2, b*4+3, b*4+4];
            
            this.updateMilestones(batchNum);
            this.showNotification(`正在开启批次 #${batchNum} 的同步消费...`, 'carbon:batch-job');
            this.addThought(`正在启动批次 #${batchNum} 的生成流程 (design.step.started)`, false, "carbon:activity");

            for (const id of batchIds) {
                const el = this.$(`#node-${id}`);
                if (el) {
                    el.style.background = '#f5f3ff';
                    el.style.borderColor = '#6366f1';
                    await new Promise(r => setTimeout(r, 150));
                    el.style.opacity = '0';
                    el.style.transform = 'translateX(30px)';
                    el.style.maxHeight = '0';
                    el.style.padding = '0';
                    el.style.margin = '0';
                    el.style.border = 'none';
                }
            }

            const section = document.createElement('div');
            section.className = 'mb-12 batch-section-entrance';
            section.innerHTML = `
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-indigo-600 shadow-sm">
                        <iconify-icon icon="carbon:batch-job" width="20"></iconify-icon>
                    </div>
                    <div>
                        <div class="text-[13px] font-bold text-slate-800">批次 #${batchNum} 生成报告</div>
                        <div class="text-[11px] text-slate-400 font-medium">1.2s processed • ${batchIds.length} slides validated</div>
                    </div>
                    <div class="ml-auto bg-emerald-50 text-emerald-600 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-tight">Success</div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5" id="grid-b-${batchNum}"></div>
            `;
            viewer.appendChild(section);

            const grid = this.$(`#grid-b-${batchNum}`);
            for (const id of batchIds) {
                const card = document.createElement('div');
                card.className = 'bg-white rounded-xl border border-slate-100 shadow-sm p-4 hover:shadow-md transition-all duration-300 group';
                card.innerHTML = `
                    <div class="aspect-video bg-slate-50 rounded-lg border border-slate-50 mb-3 overflow-hidden flex items-center justify-center relative">
                        <iconify-icon icon="carbon:image" class="text-slate-200 group-hover:scale-110 transition-transform duration-500" width="32"></iconify-icon>
                        <div class="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                    </div>
                    <div class="text-[11px] font-bold text-slate-800 mb-1 truncate">${this._nodes[id-1].title}</div>
                    <div class="flex items-center justify-between">
                        <span class="text-[9px] font-mono text-slate-400 uppercase tracking-tighter">CP_0${id}</span>
                        <div class="flex items-center gap-1">
                           <span class="text-[9px] font-bold text-emerald-500">READY</span>
                           <iconify-icon icon="carbon:checkmark-filled" class="text-emerald-500" width="14"></iconify-icon>
                        </div>
                    </div>
                `;
                grid.appendChild(card);
                await new Promise(r => setTimeout(r, 150));
            }
            
            this.addThought(`批次 #${batchNum} 已生成完毕 (design.step.completed)`, true);
            viewer.scrollTo({ top: viewer.scrollHeight, behavior: 'smooth' });
            
            if (b === 2) {
                sidebar.style.width = '0px';
                sidebar.style.minWidth = '0px';
                sidebar.style.opacity = '0';
                sidebar.style.borderRight = 'none';
            }
            
            await new Promise(r => setTimeout(r, 600));
        }

        this.updateTodoStep(3, "3/4");
        this.addThought("已完成 design.generate.ended: 共生成 12 张幻灯片", true);

        this.addThought("正在执行 design.phase.transition: reviewing", false, "carbon:microscope");
        await new Promise(r => setTimeout(r, 1000));
        this.addThought("已完成 design.qa.ended: 通过率 100%", true);
        this.updateTodoStep(4, "4/4");

        statusText.textContent = '已完成';
        this.showNotification('所有设计批次已同步至主舞台 (design.ended)', 'carbon:checkmark-done');
        this.addThought('流程全部结束 (design.agent.status.changed: completed)。');

        this.showFinalCTA();
    }

    showFinalCTA() {
        const container = this.$('#thought-container');
        const div = document.createElement('div');
        div.className = 'mt-6 p-4 bg-indigo-600 rounded-xl shadow-lg shadow-indigo-200 animate-bounce-in';
        div.innerHTML = `
            <div class="text-white text-[13px] font-bold mb-3 flex items-center gap-2">
                <iconify-icon icon="carbon:certificate-check" width="20"></iconify-icon>
                设计已初步完成
            </div>
            <button id="btn-finish-design" class="w-full bg-white text-indigo-600 py-2 rounded-lg text-[12px] font-bold hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2">
                验收通过，去编辑（精细）
                <iconify-icon icon="carbon:arrow-right" width="16"></iconify-icon>
            </button>
        `;
        container.appendChild(div);
        
        const history = this.$('#ai-chat-history');
        if (history) {
            requestAnimationFrame(() => {
                history.scrollTo({ top: history.scrollHeight, behavior: 'smooth' });
            });
        }
    }

    updateMilestones(activeNum) {
        this.$$('.milestone').forEach((m, idx) => {
            if (idx + 1 === activeNum) {
                m.classList.remove('text-slate-400');
                m.classList.add('milestone-active');
                const existing = m.querySelector('.active-indicator');
                if (existing) existing.remove();
                const indicator = document.createElement('div');
                indicator.className = 'active-indicator';
                m.appendChild(indicator);
            } else {
                m.classList.remove('milestone-active');
                m.classList.add('text-slate-400');
                const existing = m.querySelector('.active-indicator');
                if (existing) existing.remove();
            }
        });
        
        const bar = this.$('#timeline-bar');
        const active = this.$(`#ms-${activeNum}`);
        if (active) {
            bar.scrollTo({ left: active.offsetLeft - 40, behavior: 'smooth' });
        }
    }

    updateTodoStep(stepNum, countText) {
        const todo = this.$(`#todo-step-${stepNum}`);
        if (todo) {
            todo.classList.remove('border-slate-200', 'bg-white');
            todo.classList.add('border-indigo-500', 'bg-indigo-500', 'flex', 'items-center', 'justify-center', 'text-white');
            todo.innerHTML = '<iconify-icon icon="carbon:checkmark" width="10"></iconify-icon>';
            todo.nextElementSibling.classList.add('line-through', 'text-slate-400');
            
            const count = this.$('#todo-panel .text-indigo-500');
            count.textContent = countText;
        }
    }

    addThought(msg, isHighlight = false, icon = "carbon:flow-stream") {
        const container = this.$('#thought-container');
        if (!container) return;

        const div = document.createElement('div');
        if (isHighlight) {
            div.className = 'bg-indigo-50/30 border border-indigo-100/50 rounded-xl p-3.5 mt-4 relative overflow-hidden text-[12px] text-slate-700 font-medium animate-in fade-in slide-in-from-bottom-2 duration-500';
            div.innerHTML = `
                <div class="absolute top-0 right-0 p-2">
                    <iconify-icon icon="carbon:checkmark-filled" class="text-indigo-400"></iconify-icon>
                </div>
                ${msg}
            `;
        } else {
            div.className = 'text-[11px] text-slate-500 leading-relaxed pl-4 border-l-2 border-slate-100 mt-3 thought-item flex items-start gap-2 animate-in fade-in slide-in-from-left-2 duration-500';
            div.innerHTML = `
                <iconify-icon icon="${icon}" class="mt-0.5 text-slate-300" width="12"></iconify-icon>
                <span>${msg}</span>
            `;
        }
        
        container.appendChild(div);
        
        const history = this.$('#ai-chat-history');
        if (history) {
            requestAnimationFrame(() => {
                history.scrollTo({ top: history.scrollHeight, behavior: 'smooth' });
            });
        }
    }

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
        }, 3000);
    }
}
