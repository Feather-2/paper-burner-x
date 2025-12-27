/**
 * Logic Layer Component
 * 负责渲染背景知识节点和连线动画
 */

export class LogicLayer {
  constructor(container, options = {}) {
    this._container = container;
    this._eventBus = options.eventBus;
  }

  mount() {
    this._container.innerHTML = '';
    this._eventBus.on('forge:new-node', (data) => this.createNode(data));
  }

  createNode(data) {
    const node = document.createElement('div');
    node.className = 'knowledge-node';
    node.style.left = `${data.x}%`;
    node.style.top = `${data.y}%`;
    node.innerHTML = `
        <div class="flex items-center justify-between mb-2.5">
            <div class="flex items-center gap-2">
                <div class="w-5 h-5 rounded bg-indigo-50 flex items-center justify-center text-indigo-500">
                    <iconify-icon icon="carbon:document-sentiment" width="12"></iconify-icon>
                </div>
                <span class="font-black text-[10px] uppercase tracking-wider text-slate-700">${data.source}</span>
            </div>
            <span class="text-[9px] font-mono text-emerald-500 font-bold bg-emerald-50 px-1.5 py-0.5 rounded">就绪</span>
        </div>
        <div class="text-slate-500 leading-relaxed mb-3 text-[10.5px] italic">"${data.content}"</div>
        <div class="node-progress">
            <div class="node-progress-bar shadow-[0_0_8px_rgba(79,70,229,0.3)]"></div>
        </div>
    `;
    
    this._container.appendChild(node);
    
    // 进场动画
    setTimeout(() => node.classList.add('visible'), 50);

    // 触发连线
    setTimeout(() => this._createLine(node), 1000);
  }

  _createLine(node) {
    const draftEl = document.getElementById('section-competitor');
    if (!draftEl) return;

    const line = document.createElement('div');
    line.className = 'logic-line';
    
    const nodeRect = node.getBoundingClientRect();
    const draftRect = draftEl.getBoundingClientRect();
    
    const startX = nodeRect.left + nodeRect.width / 2;
    const startY = nodeRect.top + nodeRect.height / 2;
    const endX = draftRect.left;
    const endY = draftRect.top + draftRect.height / 2;
    
    const dist = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
    const angle = Math.atan2(endY - startY, endX - startX);
    
    line.style.width = `${dist}px`;
    line.style.left = `${startX}px`;
    line.style.top = `${startY}px`;
    line.style.transform = `rotate(${angle}rad)`;
    
    this._container.appendChild(line);
    
    // 激活状态
    node.classList.add('active');
    line.classList.add('active');
    const bar = node.querySelector('.node-progress-bar');
    if(bar) bar.style.width = '100%';
    
    // 模拟数据传输完成后消失
    setTimeout(() => {
        line.classList.remove('active');
        node.classList.remove('active');
        node.classList.remove('visible');
        setTimeout(() => {
            line.remove();
            node.remove();
        }, 1000);
    }, 3000);
  }
}
