/**
 * Outline review view
 */

import BaseView from './base-view.js';
import { escapeHtml, escapeAttr } from '../core/ui-utils.js';
import { getPptGeneratorAdapter } from '../adapters/agent-adapter.js';

const DEFAULT_OUTLINE = [
  { title: '项目背景与痛点', subs: ['当前文档处理效率低下', '非结构化数据提取困难'] },
  { title: '核心解决方案', subs: ['AI 深度阅读引擎', '多智能体协同架构'] },
  { title: '技术优势', subs: ['上下文语义理解', '跨文档知识融合'] },
  { title: '商业价值', subs: ['降低 80% 人力成本', '提升 40% 准确率'] }
];

export class OutlineReviewView extends BaseView {
  constructor(options = {}) {
    super(options);
    this._adapter = options.adapter || getPptGeneratorAdapter();
    this._outlineUiCleanup = null;
    this._isMarkdownMode = false;
    this._draggedItemIndex = null;
    this._outlineRenderTimer = null;
    this._activeContextNodeId = null;
    this._activeContextNodeText = '';
    this._closeContextMenuHandler = this._closeContextMenuHandler.bind(this);
  }

  onMount() {
    this._adapter?.syncFromGenerator?.();
    this._ensureOutlineData();
    this._refresh();
    this.subscribeState((event) => {
      if (!this._mounted) return;
      if (event.path === '' || event.path.startsWith('data.outline')) {
        this._refresh();
      }
    });
  }

  onUnmount() {
    this._cleanupInteractions();
    if (this._outlineRenderTimer) {
      clearTimeout(this._outlineRenderTimer);
      this._outlineRenderTimer = null;
    }
  }

  render() {
    return this._renderOutlineReview();
  }

  _refresh() {
    if (!this._mounted) return;
    this._cleanupInteractions();
    this._container.innerHTML = this.render();
    this._outlineUiCleanup = this._bindOutlineInteractions();
    if (this._isMarkdownMode) {
      this.updateMindMapPreview();
    }
  }

  _cleanupInteractions() {
    if (typeof this._outlineUiCleanup === 'function') {
      try { this._outlineUiCleanup(); } catch { /* ignore */ }
    }
    this._outlineUiCleanup = null;
  }

  _getOutline() {
    const stored = this.getState('data.outline');
    if (Array.isArray(stored)) return stored;
    const data = this._adapter?.getWorkflowData?.();
    return Array.isArray(data?.outline) ? data.outline : [];
  }

  _ensureOutlineData() {
    let outline = this._getOutline();
    if (!outline || outline.length === 0) {
      outline = DEFAULT_OUTLINE.map(item => ({
        title: item.title,
        subs: Array.isArray(item.subs) ? [...item.subs] : []
      }));
      this._adapter?.setOutline?.(outline);
    }
    return outline;
  }

  _outlineToMarkdown(outline) {
    return outline.map(item => {
      const title = String(item?.title ?? '').trim();
      const subs = Array.isArray(item?.subs) ? item.subs : [];
      const head = title ? `# ${title}` : '# 未命名章节';
      const lines = subs.map(sub => `- ${String(sub ?? '').trim()}`);
      return [head, ...lines].join('\n');
    }).join('\n\n');
  }

  _renderOutlineReview() {
    const outline = this._ensureOutlineData();
    const markdownValue = this._isMarkdownMode ? this._outlineToMarkdown(outline) : '';
    const visualHidden = this._isMarkdownMode ? 'hidden' : '';
    const markdownHidden = this._isMarkdownMode ? '' : 'hidden';
    const markdownDisplay = this._isMarkdownMode ? 'flex' : 'none';

    return `
      <div class="ppt-outline-root">
        <div class="ppt-question-form">
          <div class="form-header" style="padding-bottom: 16px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <iconify-icon icon="carbon:tree-view-alt" style="font-size: 20px; color: var(--ppt-primary);"></iconify-icon>
                <h3 style="margin: 0; font-size: 18px;">大纲确认</h3>
                <span style="font-size: 13px; color: var(--ppt-text-muted);">请确认或调整</span>
              </div>
              <div style="display: flex; gap: 8px;">
                <button class="ppt-btn-secondary" data-action="addOutlineItem" style="font-size: 12px; padding: 6px 12px;">
                  <iconify-icon icon="carbon:add-alt"></iconify-icon> 添加章节
                </button>
                <button class="ppt-btn-secondary" data-action="toggleOutlineEditMode" style="font-size: 12px; padding: 6px 12px;">
                  <iconify-icon icon="carbon:edit"></iconify-icon> Markdown
                </button>
              </div>
            </div>
          </div>
          <div class="form-body custom-scrollbar">
            <div id="pptOutlineVisualEditor" class="ppt-outline-editor ${visualHidden}" style="padding-bottom: 100px;">
              ${outline.map((item, i) => `
                <div class="outline-node-card" draggable="true" data-index="${i}" style="margin-bottom: 16px; padding: 16px; border: 1px solid var(--ppt-border); border-radius: 8px; position: relative; cursor: grab;">
                  <button class="ppt-icon-btn" data-action="removeOutlineItem" data-index="${i}" title="删除章节" style="position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; padding: 4px; z-index: 10;">
                    <iconify-icon icon="carbon:trash-can"></iconify-icon>
                  </button>
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; padding-right: 30px;">
                    <span style="font-weight: 600; color: var(--ppt-accent); cursor: move;"><iconify-icon icon="carbon:draggable"></iconify-icon> ${i + 1}.</span>
                    <input type="text" class="ppt-input-field" value="${escapeAttr(item?.title ?? '')}" style="flex: 1; min-width: 0; font-weight: 600;" data-action="updateOutlineTitle" data-event="change" data-index="${i}">
                  </div>
                  <div style="padding-left: 24px;">
                    ${(Array.isArray(item?.subs) ? item.subs : []).map((sub, j) => `
                      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                        <iconify-icon icon="carbon:dot-mark" style="color: var(--ppt-text-muted); font-size: 10px;"></iconify-icon>
                        <input type="text" class="ppt-input-field" value="${escapeAttr(sub ?? '')}" style="flex: 1; min-width: 0; font-size: 13px; padding: 6px 8px;" data-action="updateOutlineSub" data-event="change" data-index="${i}" data-sub-index="${j}">
                        <button class="ppt-icon-btn" data-action="removeOutlineSub" data-index="${i}" data-sub-index="${j}" title="删除子项" style="padding: 4px; width: 24px; height: 24px; flex-shrink: 0;">
                          <iconify-icon icon="carbon:close"></iconify-icon>
                        </button>
                      </div>
                    `).join('')}
                    <button class="ppt-btn-secondary" data-action="addOutlineSub" data-index="${i}" style="margin-top: 8px; padding: 4px 12px; font-size: 12px;">
                      <iconify-icon icon="carbon:add"></iconify-icon> 添加子项
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>

            <div id="pptOutlineMarkdownEditor" class="${markdownHidden}" style="flex: 1; min-height: 0; gap: 20px; display: ${markdownDisplay};">
              <div style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
                <textarea id="pptOutlineMarkdownInput" class="w-full p-4 border border-slate-200 rounded-lg font-mono text-sm" style="flex: 1; resize: none; margin-bottom: 8px;" placeholder="# 章节标题&#10;- 子项内容" data-action="updateMindMapPreview" data-event="input">${escapeHtml(markdownValue)}</textarea>
                <div style="text-align: right; flex-shrink: 0;">
                  <button class="ppt-btn-primary" data-action="saveMarkdownOutline">
                    <iconify-icon icon="carbon:save"></iconify-icon> 保存并返回
                  </button>
                </div>
              </div>
              <div class="mindmap-preview" style="flex: 2; border: 1px solid var(--ppt-border); border-radius: 8px; background: #f8fafc; overflow: hidden; display: flex; flex-direction: column; min-height: 0;">
                <div style="padding: 8px 12px; background: white; border-bottom: 1px solid var(--ppt-border); font-size: 12px; font-weight: 600; color: var(--ppt-text-secondary);">
                  <iconify-icon icon="carbon:mindmap"></iconify-icon> 思维导图预览
                </div>
                <div id="pptMindMapContainer" style="flex: 1; overflow: auto; padding: 20px; position: relative;">
                  <div style="color: var(--ppt-text-muted); font-size: 12px; text-align: center; margin-top: 40px;">输入内容以生成预览</div>
                </div>
                <div style="padding: 8px 12px; background: #f1f5f9; border-top: 1px solid var(--ppt-border); font-size: 11px; color: var(--ppt-text-secondary); display: flex; justify-content: space-between;">
                  <span><iconify-icon icon="carbon:mouse-right-click"></iconify-icon> 右键点击节点可添加/删除</span>
                  <span><iconify-icon icon="carbon:touch-1"></iconify-icon> 左键点击编辑文本</span>
                </div>
              </div>
            </div>
          </div>
          <div class="form-footer">
            <button class="ppt-btn-secondary" data-action="regenerateOutline">
              <iconify-icon icon="carbon:renew"></iconify-icon> 重新生成
            </button>
            <button class="ppt-btn-primary" data-action="confirmOutline">
              确认大纲 <iconify-icon icon="carbon:arrow-right"></iconify-icon>
            </button>
          </div>
        </div>

        <div id="pptMindMapContextMenu" class="ppt-context-menu">
          <div class="ppt-context-menu-item" data-action="triggerContextAction" data-context="edit">
            <iconify-icon icon="carbon:edit"></iconify-icon> 编辑内容
          </div>
          <div class="ppt-context-menu-item" data-action="triggerContextAction" data-context="add">
            <iconify-icon icon="carbon:add-alt"></iconify-icon> 添加子节点
          </div>
          <div class="ppt-context-menu-divider"></div>
          <div class="ppt-context-menu-item danger" data-action="triggerContextAction" data-context="delete">
            <iconify-icon icon="carbon:trash-can"></iconify-icon> 删除节点
          </div>
        </div>
      </div>
    `;
  }

  _bindOutlineInteractions() {
    const cleanupFns = [];
    const root = this._container;

    const visualEditor = root?.querySelector?.('#pptOutlineVisualEditor') || document.getElementById('pptOutlineVisualEditor');
    if (visualEditor) {
      const onDragStart = (e) => {
        const card = e.target?.closest?.('.outline-node-card');
        if (!card) return;
        const idx = Number.parseInt(card.dataset.index || '', 10);
        if (!Number.isFinite(idx)) return;
        this.handleDragStart(e, idx);
      };
      const onDragOver = (e) => {
        if (!e.target?.closest?.('.outline-node-card')) return;
        this.handleDragOver(e);
      };
      const onDrop = (e) => {
        const card = e.target?.closest?.('.outline-node-card');
        if (!card) return;
        const idx = Number.parseInt(card.dataset.index || '', 10);
        if (!Number.isFinite(idx)) return;
        this.handleDrop(e, idx);
      };
      visualEditor.addEventListener('dragstart', onDragStart);
      visualEditor.addEventListener('dragover', onDragOver);
      visualEditor.addEventListener('drop', onDrop);
      cleanupFns.push(() => {
        visualEditor.removeEventListener('dragstart', onDragStart);
        visualEditor.removeEventListener('dragover', onDragOver);
        visualEditor.removeEventListener('drop', onDrop);
      });
    }

    const mindMapContainer = root?.querySelector?.('#pptMindMapContainer') || document.getElementById('pptMindMapContainer');
    if (mindMapContainer) {
      const onClick = (e) => {
        const node = e.target?.closest?.('.ppt-mindmap-node');
        if (!node) return;
        this.handleMindMapNodeClick(node.dataset.nodeId, node.dataset.nodeText || '');
      };
      const onContextMenu = (e) => {
        const node = e.target?.closest?.('.ppt-mindmap-node');
        if (!node) return;
        this.handleMindMapContextMenu(e, node.dataset.nodeId, node.dataset.nodeText || '');
      };
      mindMapContainer.addEventListener('click', onClick);
      mindMapContainer.addEventListener('contextmenu', onContextMenu);
      cleanupFns.push(() => {
        mindMapContainer.removeEventListener('click', onClick);
        mindMapContainer.removeEventListener('contextmenu', onContextMenu);
      });
    }

    document.addEventListener('click', this._closeContextMenuHandler);
    cleanupFns.push(() => document.removeEventListener('click', this._closeContextMenuHandler));

    return () => {
      cleanupFns.forEach((fn) => {
        try { fn(); } catch { /* ignore */ }
      });
    };
  }

  _closeContextMenuHandler(e) {
    const menu = this.$('#pptMindMapContextMenu') || document.getElementById('pptMindMapContextMenu');
    if (menu && !menu.contains(e.target)) {
      menu.style.display = 'none';
    }
  }

  handleDragStart(e, index) {
    this._draggedItemIndex = index;
    if (e?.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    const card = e.target?.closest?.('.outline-node-card') || e.target;
    if (card?.style) card.style.opacity = '0.5';
  }

  handleDragOver(e) {
    e.preventDefault();
    if (e?.dataTransfer) e.dataTransfer.dropEffect = 'move';
    return false;
  }

  handleDrop(e, targetIndex) {
    e.stopPropagation();
    const draggedIndex = this._draggedItemIndex;

    const cards = this._container?.querySelectorAll?.('.outline-node-card') || [];
    if (cards[draggedIndex]) cards[draggedIndex].style.opacity = '1';

    if (draggedIndex !== targetIndex) {
      const outline = this._getOutline().map(item => ({
        title: String(item?.title ?? ''),
        subs: Array.isArray(item?.subs) ? [...item.subs] : []
      }));
      const item = outline[draggedIndex];
      if (item) {
        outline.splice(draggedIndex, 1);
        outline.splice(targetIndex, 0, item);
        this._adapter?.setOutline?.(outline);
      }
    }
    return false;
  }

  updateMindMapPreview() {
    const input = this.$('#pptOutlineMarkdownInput') || document.getElementById('pptOutlineMarkdownInput');
    const container = this.$('#pptMindMapContainer') || document.getElementById('pptMindMapContainer');
    if (!input || !container) return;

    const text = input.value;
    if (!text.trim()) {
      container.innerHTML = '<div style="color: var(--ppt-text-muted); font-size: 12px;">输入内容以生成预览</div>';
      return;
    }

    const lines = text.split('\n');
    const nodes = [];
    let currentParent = null;
    const rootTitle = this._getProjectTitle() || '演示文稿';

    nodes.push({ id: 'root', text: rootTitle, level: 0, children: [] });

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) {
        const title = trimmed.replace(/^#+\s*/, '');
        const node = { id: `h-${idx}`, text: title, level: 1, children: [] };
        nodes[0].children.push(node);
        currentParent = node;
      } else if ((trimmed.startsWith('-') || trimmed.startsWith('*')) && currentParent) {
        const sub = trimmed.replace(/^[-*]\s*/, '');
        currentParent.children.push({ id: `s-${idx}`, text: sub, level: 2 });
      }
    });

    const svg = this._generateMindMapSVG(nodes[0]);
    container.innerHTML = svg;
  }

  _generateMindMapSVG(root) {
    const nodeHeight = 30;
    const nodeWidth = 120;
    const xGap = 180;
    const yGap = 15;
    const escapeAttrLocal = (value) => escapeAttr(value);
    const escapeHtmlLocal = (value) => escapeHtml(value);

    function calculateHeight(node) {
      if (!node.children || node.children.length === 0) {
        node.subtreeHeight = nodeHeight + yGap;
        return node.subtreeHeight;
      }
      let h = 0;
      node.children.forEach(child => {
        h += calculateHeight(child);
      });
      node.subtreeHeight = h;
      return h;
    }

    calculateHeight(root);

    let maxX = 0;
    let maxY = 0;

    function layout(node, x, y) {
      node.x = x;
      node.y = y + node.subtreeHeight / 2 - nodeHeight / 2;

      if (x + nodeWidth > maxX) maxX = x + nodeWidth;
      if (y + node.subtreeHeight > maxY) maxY = y + node.subtreeHeight;

      let currentChildY = y;
      if (node.children) {
        node.children.forEach(child => {
          layout(child, x + xGap, currentChildY);
          currentChildY += child.subtreeHeight;
        });
      }
    }

    layout(root, 20, 20);

    const width = maxX + 50;
    const height = maxY + 40;

    let svgContent = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="font-family: sans-serif; font-size: 12px; background-color: #f8fafc;">`;

    function drawLines(node) {
      let lines = '';
      if (node.children) {
        node.children.forEach(child => {
          const startX = node.x + nodeWidth;
          const startY = node.y + nodeHeight / 2;
          const endX = child.x;
          const endY = child.y + nodeHeight / 2;

          const cp1X = startX + (endX - startX) / 2;
          const cp1Y = startY;
          const cp2X = startX + (endX - startX) / 2;
          const cp2Y = endY;

          const path = `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
          lines += `<path d="${path}" stroke="#cbd5e1" stroke-width="1.5" fill="none" />`;
          lines += drawLines(child);
        });
      }
      return lines;
    }
    svgContent += drawLines(root);

    function drawNodes(node) {
      let nodesSvg = '';
      const color = node.level === 0 ? '#4f46e5' : node.level === 1 ? '#0ea5e9' : '#64748b';
      const bgColor = node.level === 0 ? '#e0e7ff' : node.level === 1 ? '#e0f2fe' : '#ffffff';
      const textColor = node.level === 0 ? '#312e81' : node.level === 1 ? '#0369a1' : '#334155';
      const strokeWidth = node.level === 0 ? 2 : 1;

      const maxChars = 14;
      const rawText = String(node.text ?? '');
      const displayText = rawText.length > maxChars ? rawText.substring(0, maxChars) + '...' : rawText;
      const safeDisplayText = escapeHtmlLocal(displayText);
      const safeText = escapeHtmlLocal(rawText);

      nodesSvg += `
        <g class="ppt-mindmap-node" data-node-id="${escapeAttrLocal(node.id)}" data-node-text="${escapeAttrLocal(rawText)}" transform="translate(${node.x}, ${node.y})" style="cursor: pointer;">
          <rect width="${nodeWidth}" height="${nodeHeight}" rx="6" fill="${bgColor}" stroke="${color}" stroke-width="${strokeWidth}" filter="drop-shadow(0 1px 2px rgb(0 0 0 / 0.05))" />
          <text x="${nodeWidth / 2}" y="19" text-anchor="middle" fill="${textColor}" style="pointer-events: none; font-weight: ${node.level === 0 ? '600' : '400'}">${safeDisplayText}</text>
          <title>${safeText} (左键编辑，右键菜单)</title>
        </g>
      `;
      if (node.children) {
        node.children.forEach(child => { nodesSvg += drawNodes(child); });
      }
      return nodesSvg;
    }

    svgContent += drawNodes(root);
    svgContent += '</svg>';
    return svgContent;
  }

  handleMindMapContextMenu(e, nodeId, nodeText) {
    e.preventDefault();
    e.stopPropagation();

    this._activeContextNodeId = nodeId;
    this._activeContextNodeText = nodeText || '';

    const menu = this.$('#pptMindMapContextMenu') || document.getElementById('pptMindMapContextMenu');
    if (!menu) return;

    let x = e.clientX;
    let y = e.clientY;

    if (x + 150 > window.innerWidth) x -= 150;
    if (y + 120 > window.innerHeight) y -= 120;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.display = 'block';
  }

  triggerContextAction(action) {
    const menu = this.$('#pptMindMapContextMenu') || document.getElementById('pptMindMapContextMenu');
    if (menu) menu.style.display = 'none';

    if (!this._activeContextNodeId) return;

    if (action === 'edit') {
      this.handleMindMapNodeClick(this._activeContextNodeId, this._activeContextNodeText || '');
    } else if (action === 'add') {
      this.addMindMapChild(this._activeContextNodeId);
    } else if (action === 'delete') {
      this.deleteMindMapNode(this._activeContextNodeId);
    }
  }

  addMindMapChild(parentId) {
    const mdInput = this.$('#pptOutlineMarkdownInput') || document.getElementById('pptOutlineMarkdownInput');
    if (!mdInput) return;

    const newText = '新节点';
    const lines = mdInput.value.split('\n');

    if (parentId === 'root') {
      lines.push(`\n# ${newText}`);
    } else if (parentId.startsWith('h-')) {
      const lineIndex = parseInt(parentId.split('-')[1]);
      let insertIndex = lineIndex + 1;
      while (insertIndex < lines.length && !lines[insertIndex].trim().startsWith('#')) {
        insertIndex++;
      }
      lines.splice(insertIndex, 0, `- ${newText}`);
    } else {
      alert('暂不支持三级嵌套');
      return;
    }

    mdInput.value = lines.join('\n');
    this.updateMindMapPreview();
  }

  deleteMindMapNode(nodeId) {
    if (nodeId === 'root') {
      alert('不能删除根节点');
      return;
    }

    if (nodeId.startsWith('h-')) {
      if (!confirm('确定要删除此章节及其所有子项吗？')) return;
    }

    const mdInput = this.$('#pptOutlineMarkdownInput') || document.getElementById('pptOutlineMarkdownInput');
    if (!mdInput) return;

    const lineIndex = parseInt(nodeId.split('-')[1]);
    const lines = mdInput.value.split('\n');

    if (nodeId.startsWith('s-')) {
      lines.splice(lineIndex, 1);
    } else if (nodeId.startsWith('h-')) {
      let count = 1;
      while (lineIndex + count < lines.length && !lines[lineIndex + count].trim().startsWith('#')) {
        count++;
      }
      lines.splice(lineIndex, count);
    }

    mdInput.value = lines.join('\n');
    this.updateMindMapPreview();
  }

  handleMindMapNodeClick(nodeId, currentText) {
    const newText = prompt('编辑节点内容:', currentText);
    if (newText !== null && newText !== currentText) {
      const mdInput = this.$('#pptOutlineMarkdownInput') || document.getElementById('pptOutlineMarkdownInput');
      if (!mdInput) return;

      const lineIndex = parseInt(nodeId.split('-')[1]);
      const lines = mdInput.value.split('\n');

      if (lines[lineIndex]) {
        if (nodeId.startsWith('h-')) {
          lines[lineIndex] = lines[lineIndex].replace(/^#+\s*.*/, `# ${newText}`);
        } else if (nodeId.startsWith('s-')) {
          lines[lineIndex] = lines[lineIndex].replace(/^([-*])\s*.*/, `$1 ${newText}`);
        }
        mdInput.value = lines.join('\n');
        this.updateMindMapPreview();
      }
    }
  }

  _getProjectTitle() {
    return this._adapter?.getProjectTitle?.() || '';
  }

  _debouncedRefresh() {
    clearTimeout(this._outlineRenderTimer);
    this._outlineRenderTimer = setTimeout(() => {
      this._refresh();
    }, 100);
  }

  _onAddOutlineItem() {
    this._adapter?.addOutlineItem?.();
  }

  _onRemoveOutlineItem({ payload }) {
    const index = Number(payload?.index);
    if (!Number.isFinite(index)) return;
    this._adapter?.removeOutlineItem?.(index);
  }

  _onToggleOutlineEditMode() {
    this._isMarkdownMode = !this._isMarkdownMode;
    this._refresh();
  }

  _onUpdateOutlineTitle({ payload, value }) {
    const index = Number(payload?.index);
    if (!Number.isFinite(index)) return;
    this._adapter?.updateOutlineTitle?.(index, value);
  }

  _onUpdateOutlineSub({ payload, value }) {
    const index = Number(payload?.index);
    const subIndex = Number(payload?.subIndex);
    if (!Number.isFinite(index) || !Number.isFinite(subIndex)) return;
    this._adapter?.updateOutlineSub?.(index, subIndex, value);
  }

  _onRemoveOutlineSub({ payload }) {
    const index = Number(payload?.index);
    const subIndex = Number(payload?.subIndex);
    if (!Number.isFinite(index) || !Number.isFinite(subIndex)) return;
    this._adapter?.removeOutlineSub?.(index, subIndex);
  }

  _onAddOutlineSub({ payload }) {
    const index = Number(payload?.index);
    if (!Number.isFinite(index)) return;
    this._adapter?.addOutlineSub?.(index);
  }

  _onUpdateMindMapPreview() {
    this.updateMindMapPreview();
  }

  _onSaveMarkdownOutline() {
    const mdInput = this.$('#pptOutlineMarkdownInput') || document.getElementById('pptOutlineMarkdownInput');
    if (!mdInput) return;

    const text = mdInput.value;
    const lines = text.split('\n');
    const newOutline = [];
    let currentItem = null;

    lines.forEach(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('#')) {
        if (currentItem) newOutline.push(currentItem);
        currentItem = { title: trimmed.replace(/^#+\s*/, ''), subs: [] };
      } else if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
        if (currentItem) {
          currentItem.subs.push(trimmed.replace(/^[-*]\s*/, ''));
        }
      } else if (trimmed.length > 0 && currentItem) {
        currentItem.subs.push(trimmed);
      }
    });
    if (currentItem) newOutline.push(currentItem);

    this._adapter?.setOutline?.(newOutline);
    this._isMarkdownMode = false;
    this._refresh();
  }

  _onRegenerateOutline() {
    this._adapter?.regenerateOutline?.();
  }

  _onConfirmOutline() {
    this._adapter?.confirmOutline?.();
  }

  _onTriggerContextAction({ payload }) {
    if (!payload?.context) return;
    this.triggerContextAction(payload.context);
  }
}

export default OutlineReviewView;
