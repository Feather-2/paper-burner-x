/**
 * 根据 Markdown 文本生成思维导图的静态 HTML 预览（虚影效果）。
 *
 * 主要功能与实现逻辑：
 * 1. 解析 Markdown 为树结构（parseTree）：
 *    - 按行分割 Markdown 文本。
 *    - 识别 #、##、### 标题，构建多级节点树。
 *    - 返回包含 text 和 children 的树状对象。
 * 2. 递归渲染树节点（renderNode）：
 *    - 根据层级渲染不同样式的节点（背景色、圆点、字体等）。
 *    - 通过绝对定位和缩进实现层级视觉。
 *    - 递归渲染所有子节点。
 * 3. 入口与返回：
 *    - 先 parseTree，再 renderNode。
 *    - 若无内容，返回"暂无结构化内容"。
 *
 * @param {string} md - Markdown 格式的思维导图文本。
 * @returns {string} 生成的思维导图预览 HTML 字符串。
 */
function renderMindmapShadowInternal(md) {
  /**
   * 解析 Markdown 文本为树结构。
   *
   * @param {string} md - Markdown 文本。
   * @returns {object} 树结构对象。
   */
  function parseTree(md) {
    const lines = md.split(/\r?\n/).filter(l => l.trim());
    const root = { text: '', children: [] };
    let last1 = null, last2 = null;
    lines.forEach(line => {
      let m1 = line.match(/^# (.+)/);
      let m2 = line.match(/^## (.+)/);
      let m3 = line.match(/^### (.+)/);
      if (m1) {
        last1 = { text: m1[1], children: [] };
        root.children.push(last1);
        last2 = null;
      } else if (m2 && last1) {
        last2 = { text: m2[1], children: [] };
        last1.children.push(last2);
      } else if (m3 && last2) {
        last2.children.push({ text: m3[1], children: [] });
      }
    });
    return root;
  }

  /**
   * 递归渲染树节点为 HTML。
   *
   * @param {object} node - 当前节点。
   * @param {number} level - 当前层级。
   * @param {boolean} isLast - 是否为同级最后一个节点。
   * @returns {string} HTML 字符串。
   */
  function renderNode(node, level = 0, isLast = true) {
    if (!node.text && node.children.length === 0) return '';
    if (!node.text) {
      // 根节点
      return `<div class=\"mindmap-shadow-root\">${node.children.map((c,i,a)=>renderNode(c,0,i===a.length-1)).join('')}</div>`;
    }
    // 节点样式定义
    const colors = [
      'rgba(59,130,246,0.13)', // 主节点
      'rgba(59,130,246,0.09)', // 二级
      'rgba(59,130,246,0.06)'  // 三级
    ];
    const dotColors = [
      'rgba(59,130,246,0.35)',
      'rgba(59,130,246,0.22)',
      'rgba(59,130,246,0.15)'
    ];
    let html = `<div class=\"mindmap-shadow-node level${level}\" style=\"position:relative;margin-left:${level*28}px;padding:3px 8px 3px 12px;background:${colors[level]||colors[2]};border-radius:8px;min-width:60px;max-width:260px;margin-bottom:2px;opacity:0.7;border:1px dashed rgba(59,130,246,0.2);\">`;
    // 圆点
    html += `<span style=\"position:absolute;left:-10px;top:50%;transform:translateY(-50%);width:7px;height:7px;border-radius:4px;background:${dotColors[level]||dotColors[2]};box-shadow:0 0 0 1px #e0e7ef;\"></span>`;
    // 连接线（非根节点且非最后一个兄弟）
    if (level > 0) {
      html += `<span style=\"position:absolute;left:-6px;top:0;height:100%;width:1.5px;background:linear-gradient(to bottom,rgba(59,130,246,0.10),rgba(59,130,246,0.03));z-index:0;\"></span>`;
    }
    html += `<span style=\"color:#2563eb;font-weight:${level===0?'bold':'normal'};font-size:${level===0?'1.08em':'1em'};\">${window.ChatbotUtils.escapeHtml(node.text)}</span>`;
    if (node.children && node.children.length > 0) {
      html += `<div class=\"mindmap-shadow-children\" style=\"margin-top:4px;\">${node.children.map((c,i,a)=>renderNode(c,level+1,i===a.length-1)).join('')}</div>`;
    }
    html += '</div>';
    return html;
  }

  // 入口：解析并渲染
  const tree = parseTree(md);
  const html = renderNode(tree);
  return html || '<div style=\"color:#94a3b8;opacity:0.5;\">暂无结构化内容</div>';
}

// 挂载到全局命名空间
if (typeof window.ChatbotRenderingUtils === 'undefined') {
  window.ChatbotRenderingUtils = {};
}
window.ChatbotRenderingUtils.renderMindmapShadow = renderMindmapShadowInternal;