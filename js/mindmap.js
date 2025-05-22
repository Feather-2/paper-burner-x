// mindmap.js - 思维导图渲染器

/**
 * @file js/mindmap.js
 * @description 提供将 Markdown 文本解析为思维导图数据结构，并在 HTML Canvas 上将其可视化的功能。
 *
 * 主要功能包括：
 * - 定义思维导图节点的视觉样式（`MINDMAP_CONFIG`）。
 * - 从 Markdown 文本（主要基于标题层级）解析出层级化的思维导图数据（`parseMindMapFromMarkdown`）。
 * - 在指定的 HTML 容器内创建 Canvas 并渲染思维导图（`renderMindMap`）。
 * - 动态计算各节点的大小和布局位置（`calculateNodeLayout`）。
 * - 递归绘制思维导图的节点和连接线（`drawMindMap`, `drawNode`, `drawConnection`）。
 * - 提供辅助绘图函数，如绘制圆角矩形（`roundRect`）。
 * - 提供将 Canvas 内容导出为 PNG 图片的功能（`addExportButton`）。
 * - 通过 `window.MindMap` 对象暴露 `parse` 和 `render` 方法作为公共 API。
 */

/**
 * @constant {Object} MINDMAP_CONFIG
 * @description 定义思维导图渲染时的全局样式和布局参数。
 * 包括根节点、各级子节点（level1至level3）以及默认节点的填充色、文本颜色、字体大小、内边距和圆角半径。
 * 同时还定义了连接线的颜色、宽度，以及节点间的水平和垂直间距，并控制是否开启动画效果（当前版本动画未具体实现）。
 */
const MINDMAP_CONFIG = {
  rootNode: {
    fillColor: '#4299e1',
    textColor: '#ffffff',
    fontSize: 16,
    padding: 12,
    borderRadius: 8
  },
  level1Node: {
    fillColor: '#3182ce',
    textColor: '#ffffff',
    fontSize: 14,
    padding: 10,
    borderRadius: 6
  },
  level2Node: {
    fillColor: '#63b3ed',
    textColor: '#ffffff',
    fontSize: 13,
    padding: 8,
    borderRadius: 6
  },
  level3Node: {
    fillColor: '#90cdf4',
    textColor: '#1a365d',
    fontSize: 12,
    padding: 8,
    borderRadius: 5
  },
  defaultNode: {
    fillColor: '#bee3f8',
    textColor: '#2a4365',
    fontSize: 12,
    padding: 6,
    borderRadius: 4
  },
  lineColor: '#718096',
  lineWidth: 2,
  horizontalSpacing: 60,
  verticalSpacing: 40,
  animation: true
};

/**
 * 从 Markdown 文本中解析出层级化的思维导图数据结构。
 *
 * 解析逻辑:
 * 1. **预处理**: 将 Markdown 文本按行分割，并去除空行和首尾空格。
 * 2. **根节点确定**: 查找第一个以 `#` 开头的行作为根节点文本。如果找不到，则默认使用文本的第一行。
 * 3. **纯文本处理 (特殊情况)**: 如果在根节点之后没有找到任何其他以 `#` 开头的标题行，则认为可能是纯文本响应。
 *    此时，会尝试从后续行中提取最多10个较长的、非代码块、非标题的行作为根节点的直接子节点，每行截取前50个字符。
 * 4. **标题层级解析 (主要逻辑)**:
 *    - 遍历根节点标题行之后的每一行。
 *    - 如果行以 `#` 开头，则计算其标题级别 (例如 `###` 为3级)。
 *    - 提取标题文本。
 *    - 创建新节点对象。
 *    - 使用一个栈 (`nodeStack`) 来维护当前的父节点路径。根据当前行标题级别与栈顶节点级别的比较，
 *      弹出栈中级别大于或等于当前级别的节点，以找到正确的父节点。
 *    - 将新节点添加为找到的父节点的子节点，并将新节点推入栈中。
 * 5. **返回结果**: 返回构建好的思维导图数据对象 (根节点及其嵌套的 `children` 数组)。
 *
 * @param {string} markdown - 包含 Markdown 标题的文本内容。
 * @returns {Object | null} 解析后的思维导图数据对象 (包含 `id`, `text`, `children` 属性)，如果输入为空或无法解析则返回 `null`。
 */
function parseMindMapFromMarkdown(markdown) {
  if (!markdown) return null;

  // 首先尝试找到包含 # 的行作为标题
  const lines = markdown.split('\n').filter(line => line.trim());
  if (lines.length === 0) return null;

  // 查找第一个标题行
  let rootLineIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#')) {
      rootLineIndex = i;
      break;
    }
  }

  // 如果没有找到标题行，使用第一行作为根节点
  let rootText = rootLineIndex < lines.length
    ? lines[rootLineIndex].replace(/^#+\s*/, '').trim()
    : lines[0].trim();

  // 创建思维导图数据结构
  const mindMapData = {
    id: 'root',
    text: rootText,
    children: []
  };

  // 如果没有有效的标题格式，直接返回根节点
  let foundValidHeadings = false;
  for (let i = rootLineIndex + 1; i < lines.length; i++) {
    if (lines[i].match(/^#+\s/)) {
      foundValidHeadings = true;
      break;
    }
  }

  if (!foundValidHeadings) {
    // 可能是纯文本响应，将其转换为简单的思维导图结构
    // 尝试提取关键点作为子节点
    const keyPoints = lines.slice(1).filter(line =>
      line.trim() &&
      !line.startsWith('```') &&
      line.length > 10 &&
      !line.startsWith('#')
    ).slice(0, 10); // 最多取10个关键点

    if (keyPoints.length > 0) {
      mindMapData.children = keyPoints.map((point, idx) => ({
        id: `auto-${idx}`,
        text: point.trim().substring(0, 50) + (point.length > 50 ? '...' : ''),
        children: []
      }));
    }

    return mindMapData;
  }

  // 临时存储各级节点，方便构建层级关系
  const nodeStack = [{
    level: 0,
    node: mindMapData
  }];

  // 从标题行之后开始解析
  for (let i = rootLineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('#')) continue; // 跳过非标题行

    // 计算当前标题级别
    let level = 0;
    while (level < line.length && line[level] === '#') level++;

    // 提取标题文本
    const text = line.substring(level).trim();
    if (!text) continue; // 跳过空标题

    // 创建新节点
    const newNode = {
      id: `node-${i}`,
      text: text,
      children: []
    };

    // 查找合适的父节点
    while (nodeStack.length > 1 && nodeStack[nodeStack.length - 1].level >= level) {
      nodeStack.pop();
    }

    // 将新节点添加到父节点
    const parentEntry = nodeStack[nodeStack.length - 1];
    if (parentEntry && parentEntry.node) {
      parentEntry.node.children.push(newNode);

      // 将新节点入栈
      nodeStack.push({
        level: level,
        node: newNode
      });
    }
  }

  return mindMapData;
}

/**
 * 将解析后的思维导图数据渲染到指定的 HTML 容器内的 Canvas 元素上。
 *
 * 主要步骤:
 * 1. **参数校验**: 检查 `mindMapData` 是否有效，以及容器元素是否存在。
 * 2. **容器准备**: 清空指定的容器元素，并创建一个新的 Canvas 元素加入其中。
 * 3. **Canvas 上下文**: 获取 2D 渲染上下文。如果浏览器不支持 Canvas，则显示错误信息。
 * 4. **布局计算**: 调用 `calculateNodeLayout` 递归计算所有节点的大小和相对位置，得到包含布局信息的根节点对象。
 * 5. **Canvas 尺寸调整**: 根据计算出的思维导图总宽度和总高度，调整 Canvas 的 `width` 和 `height` 属性，并增加一些内边距，确保内容完整显示且至少保持一定高度（如600px）。
 * 6. **背景绘制**: 使用浅色填充整个 Canvas 作为背景。
 * 7. **定位与绘制**: 计算根节点的起始绘制坐标，使其在 Canvas 中大致居中，然后调用 `drawMindMap` 开始递归绘制整个思维导图。
 * 8. **导出按钮**: 调用 `addExportButton` 在容器中添加一个"导出思维导图"的按钮。
 * 9. **错误处理**: 如果在渲染过程中（特别是布局计算或数据有效性检查时）发生错误，则在容器中显示错误信息。
 *
 * @param {string} containerId - 用于容纳 Canvas 的 HTML 元素的 ID。
 * @param {Object} mindMapData - 通过 `parseMindMapFromMarkdown` 解析得到的思维导图数据对象。
 */
function renderMindMap(containerId, mindMapData) {
  if (!mindMapData) {
    console.warn('没有有效的思维导图数据');
    return;
  }

  const container = document.getElementById(containerId);
  if (!container) {
    console.warn('找不到容器元素:', containerId);
    return;
  }

  // 清空容器
  container.innerHTML = '';

  // 创建Canvas
  const canvas = document.createElement('canvas');
  canvas.width = container.clientWidth || 800;
  canvas.height = 600; // 默认高度，后续会根据内容动态调整
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    container.innerHTML = '<div style="padding:20px;color:#e53e3e;text-align:center;">您的浏览器不支持Canvas，无法渲染思维导图</div>';
    return;
  }

  try {
    // 计算节点尺寸和位置
    const rootNode = calculateNodeLayout(mindMapData, 0);

    // 检查思维导图大小
    if (rootNode.totalWidth < 50 || rootNode.totalHeight < 50) {
      throw new Error('思维导图数据无效或太小');
    }

    // 调整Canvas大小以适应思维导图，至少保持600px高度
    const padding = 80; // 四周留出空间
    canvas.height = Math.max(600, rootNode.totalHeight + padding * 2);
    canvas.width = Math.max(canvas.width, rootNode.totalWidth + padding * 2);

    // 清空画布
    ctx.fillStyle = '#f8fafc'; // 浅蓝色背景
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 将根节点居中
    const startX = (canvas.width - rootNode.totalWidth) / 2 + 40;
    const startY = (canvas.height - rootNode.totalHeight) / 2 + 40;

    // 绘制思维导图
    drawMindMap(ctx, rootNode, startX, startY);

    // 添加导出按钮
    addExportButton(container, canvas);
  } catch (e) {
    console.error('渲染思维导图时出错:', e);
    container.innerHTML = `
      <div style="padding:20px;color:#e53e3e;text-align:center;">
        思维导图渲染失败: ${e.message}<br>
        <small>请重试或使用其他格式查看</small>
      </div>
    `;
  }
}

/**
 * 递归计算思维导图中每个节点及其子树的布局信息。
 * 对于每个节点，此函数会计算其自身的宽度、高度，以及包含其所有子孙节点在内的整个子树所占据的总宽度和总高度。
 *
 * 计算逻辑:
 * 1. **节点自身尺寸**: 根据节点的文本内容和对应层级的样式（字体大小、内边距），计算出节点的实际渲染宽度和高度。
 *    - 文本宽度通过 `measureTextWidth` 测量。
 *    - 节点宽度 = 文本宽度 + 左右内边距总和 + 额外空间。
 *    - 节点高度 = 字体大小 + 上下内边距总和。
 * 2. **叶子节点**: 如果节点没有子节点 (`children` 数组为空或不存在)，则其 `totalWidth` 和 `totalHeight` 就等于其自身宽度和高度。
 * 3. **非叶子节点**: 如果节点有子节点：
 *    a. **递归计算子节点**: 对每个子节点递归调用 `calculateNodeLayout`，传入 `level + 1`。
 *    b. **子树总高度**: 所有子节点的 `totalHeight` 之和，加上子节点之间的垂直间距 (`MINDMAP_CONFIG.verticalSpacing`)。
 *       节点的 `totalHeight` 取自身高度与子树总高度中的较大值。
 *    c. **子树总宽度**: 节点自身宽度，加上最宽子节点的 `totalWidth`（如果存在子节点），再加上它们之间的水平间距 (`MINDMAP_CONFIG.horizontalSpacing`)。
 * 4. **错误处理**: 包含对无效 `node` 数据的防御性检查，如果输入节点无效或计算过程中出错，会返回一个表示错误的默认节点布局对象。
 * 5. **返回**: 返回一个增强的节点对象，该对象除了原有属性外，还包含 `width`, `height`, `totalWidth`, `totalHeight`, `level` 以及经过布局计算的 `children` 数组。
 *
 * @param {Object} node - 当前需要计算布局的节点对象 (应包含 `text` 和可选的 `children` 属性)。
 * @param {number} level - 当前节点在思维导图中的层级（根节点为 0）。
 * @returns {Object} 包含布局信息（`width`, `height`, `totalWidth`, `totalHeight`, `level`）的节点对象。
 */
function calculateNodeLayout(node, level) {
  try {
    // 防御性检查
    if (!node || typeof node !== 'object') {
      return {
        id: 'error-node',
        text: '数据错误',
        width: 100,
        height: 30,
        totalWidth: 100,
        totalHeight: 30,
        level: level,
        children: []
      };
    }

    // 确保text属性存在
    const nodeText = node.text || '未命名节点';

    // 测量文本尺寸
    const nodeStyle = getNodeStyle(level);
    const textWidth = measureTextWidth(nodeText, nodeStyle.fontSize);

    // 计算节点宽度和高度
    const nodeWidth = textWidth + nodeStyle.padding * 2 + 10;
    const nodeHeight = nodeStyle.fontSize + nodeStyle.padding * 2;

    // 如果没有子节点，返回叶子节点的尺寸
    if (!node.children || !Array.isArray(node.children) || node.children.length === 0) {
      return {
        ...node,
        text: nodeText,
        width: nodeWidth,
        height: nodeHeight,
        totalWidth: nodeWidth,
        totalHeight: nodeHeight,
        level
      };
    }

    // 递归计算所有子节点的尺寸和位置
    const childrenWithLayout = node.children.map(child => calculateNodeLayout(child, level + 1));

    // 计算所有子节点所需的总高度
    const totalChildrenHeight = childrenWithLayout.reduce(
      (sum, child) => sum + child.totalHeight, 0
    );

    // 计算子节点之间的垂直间距
    const totalSpacing = Math.max(0, childrenWithLayout.length - 1) * MINDMAP_CONFIG.verticalSpacing;

    // 子树的总高度
    const subtreeHeight = Math.max(nodeHeight, totalChildrenHeight + totalSpacing);

    // 找出子节点中最宽的一个
    const maxChildWidth = childrenWithLayout.length > 0
      ? Math.max(...childrenWithLayout.map(child => child.totalWidth))
      : 0;

    // 计算子树的总宽度
    const subtreeWidth = nodeWidth + (maxChildWidth > 0 ? MINDMAP_CONFIG.horizontalSpacing + maxChildWidth : 0);

    return {
      ...node,
      text: nodeText,
      children: childrenWithLayout,
      width: nodeWidth,
      height: nodeHeight,
      totalWidth: subtreeWidth,
      totalHeight: subtreeHeight,
      level
    };
  } catch (e) {
    console.error('计算节点布局时出错:', e, node);
    // 返回一个安全的默认节点
    return {
      id: 'error-node',
      text: '布局错误',
      width: 100,
      height: 30,
      totalWidth: 100,
      totalHeight: 30,
      level: level,
      children: []
    };
  }
}

/**
 * 递归地在 Canvas 上绘制整个思维导图结构。
 *
 * 绘制逻辑:
 * 1. **绘制当前节点**: 调用 `drawNode` 方法，根据当前节点的文本、计算好的位置 (`x`, `y`) 和层级样式进行绘制。
 * 2. **绘制连接线**: 如果 `parentX` 和 `parentY` (父节点的连接点坐标) 被提供，则调用 `drawConnection` 方法绘制从父节点到当前节点的连接线。
 * 3. **递归绘制子节点**: 如果当前节点有子节点 (`node.children`):
 *    a. **计算子节点起始 Y 坐标**: 根据所有子节点的总高度和它们之间的间距，计算第一个子节点应该开始绘制的垂直位置，以确保所有子节点相对于当前节点垂直居中对齐。
 *    b. **遍历子节点**: 对每个子节点：
 *        i.  调整 `currentY` 以定位当前子节点的中心。
 *        ii. 计算子节点的 X 坐标：当前节点 X 坐标 + 当前节点宽度的一半 + 水平间距。
 *        iii.递归调用 `drawMindMap` 绘制该子节点及其子树。父节点的连接点设为当前节点的右边缘中心 (`x + node.width`, `y`)。
 *        iv. 更新 `currentY`，为下一个子节点在其下方留出空间（子节点自身高度 + 垂直间距）。
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 的 2D 渲染上下文。
 * @param {Object} node - 当前要绘制的节点对象 (应已通过 `calculateNodeLayout` 处理，包含布局信息如 `width`, `height`, `totalHeight`, `level`, `text`, `children`)。
 * @param {number} x - 当前节点文本内容的起始 X 坐标。
 * @param {number} y - 当前节点文本内容的中心 Y 坐标。
 * @param {number} [parentX] - (可选) 父节点连接线的结束点 X 坐标。
 * @param {number} [parentY] - (可选) 父节点连接线的结束点 Y 坐标。
 */
function drawMindMap(ctx, node, x, y, parentX, parentY) {
  const nodeStyle = getNodeStyle(node.level);

  // 绘制当前节点
  drawNode(ctx, node.text, x, y, nodeStyle);

  // 如果有父节点，绘制连接线
  if (parentX !== undefined && parentY !== undefined) {
    drawConnection(ctx, parentX, parentY, x, y);
  }

  // 如果没有子节点，结束
  if (!node.children || node.children.length === 0) return;

  // 计算所有子节点的总高度
  const totalChildrenHeight = node.children.reduce(
    (sum, child) => sum + child.totalHeight, 0
  );

  // 计算子节点之间的间距
  const verticalSpacing = MINDMAP_CONFIG.verticalSpacing;
  const totalSpacingHeight = (node.children.length - 1) * verticalSpacing;

  // 计算子节点的起始Y坐标
  let currentY = y - (totalChildrenHeight + totalSpacingHeight) / 2;

  // 绘制所有子节点
  for (const child of node.children) {
    // 调整currentY，使子节点居中
    currentY += child.totalHeight / 2;

    // 计算子节点X坐标
    const childX = x + node.width / 2 + MINDMAP_CONFIG.horizontalSpacing;

    // 递归绘制子节点
    drawMindMap(ctx, child, childX, currentY, x + node.width, y);

    // 更新Y坐标，为下一个子节点留出空间
    currentY += child.totalHeight / 2 + verticalSpacing;
  }
}

/**
 * 在 Canvas 上绘制单个思维导图节点。
 * 节点由一个带圆角的矩形背景和居中的文本组成。
 *
 * 绘制步骤:
 * 1. **保存上下文状态**: `ctx.save()`。
 * 2. **绘制背景**: 根据提供的样式 (`style.fillColor`, `style.borderRadius`)，使用 `roundRect` 函数绘制圆角矩形背景。
 *    矩形的位置和大小根据文本内容 (`text`)、字体大小 (`style.fontSize`) 和内边距 (`style.padding`) 计算得出，以确保文本能完全容纳在内。
 * 3. **绘制文本**: 设置字体 (`style.fontSize`, `Arial, sans-serif`)、文本颜色 (`style.textColor`)、对齐方式 (`textAlign = 'left'`) 和基线 (`textBaseline = 'middle'`)。
 *    然后使用 `ctx.fillText()` 在指定位置 (`x`, `y`) 绘制文本。
 * 4. **恢复上下文状态**: `ctx.restore()`。
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 的 2D 渲染上下文。
 * @param {string} text - 要在节点中显示的文本。
 * @param {number} x - 节点文本的起始 X 坐标。
 * @param {number} y - 节点文本的中心 Y 坐标。
 * @param {Object} style - 节点的样式对象 (来自 `MINDMAP_CONFIG`，例如 `rootNode`, `level1Node` 等)，
 *                         应包含 `fillColor`, `textColor`, `fontSize`, `padding`, `borderRadius`。
 */
function drawNode(ctx, text, x, y, style) {
  ctx.save();

  // 绘制圆角矩形背景
  ctx.fillStyle = style.fillColor;
  roundRect(
    ctx,
    x - style.padding,
    y - style.fontSize/2 - style.padding,
    measureTextWidth(text, style.fontSize) + style.padding * 2,
    style.fontSize + style.padding * 2,
    style.borderRadius
  );
  ctx.fill();

  // 绘制文本
  ctx.font = `${style.fontSize}px Arial, sans-serif`;
  ctx.fillStyle = style.textColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);

  ctx.restore();
}

/**
 * 在 Canvas 上绘制连接两个节点的贝塞尔曲线。
 * 这条线通常从父节点的右侧边缘中心连接到子节点的左侧边缘中心（具体由传入的x1,y1,x2,y2决定）。
 *
 * 绘制步骤:
 * 1. **保存上下文状态**: `ctx.save()`。
 * 2. **设置线条样式**: 设置描边颜色 (`MINDMAP_CONFIG.lineColor`) 和线宽 (`MINDMAP_CONFIG.lineWidth`)。
 * 3. **计算控制点**: 为了绘制平滑的贝塞尔曲线，计算两个控制点。
 *    - `controlPoint1X`: 从起点 `x1` 向终点 `x2` 方向偏移三分之一距离处的 X 坐标，Y 坐标与起点相同。
 *    - `controlPoint2X`: 从起点 `x1` 向终点 `x2` 方向偏移三分之二距离处的 X 坐标，Y 坐标与终点相同。
 *    这会产生一条水平开始，然后弯向目标 Y，最后水平结束的 S 形曲线（如果 Y 不同）。
 * 4. **绘制路径**: 使用 `ctx.beginPath()`, `ctx.moveTo()`, `ctx.bezierCurveTo()`, 和 `ctx.stroke()` 来定义并绘制贝塞尔曲线。
 * 5. **恢复上下文状态**: `ctx.restore()`。
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 的 2D 渲染上下文。
 * @param {number} x1 - 连接线的起始点 X 坐标。
 * @param {number} y1 - 连接线的起始点 Y 坐标。
 * @param {number} x2 - 连接线的结束点 X 坐标。
 * @param {number} y2 - 连接线的结束点 Y 坐标。
 */
function drawConnection(ctx, x1, y1, x2, y2) {
  ctx.save();

  ctx.strokeStyle = MINDMAP_CONFIG.lineColor;
  ctx.lineWidth = MINDMAP_CONFIG.lineWidth;

  // 绘制贝塞尔曲线
  const controlPoint1X = x1 + (x2 - x1) / 3;
  const controlPoint2X = x1 + (x2 - x1) * 2 / 3;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(
    controlPoint1X, y1,
    controlPoint2X, y2,
    x2, y2
  );
  ctx.stroke();

  ctx.restore();
}

/**
 * 在 Canvas 上绘制一个圆角矩形路径。
 * 此函数定义路径，但不进行填充或描边，调用者需要在之后调用 `ctx.fill()` 或 `ctx.stroke()`。
 *
 * @param {CanvasRenderingContext2D} ctx - Canvas 的 2D 渲染上下文。
 * @param {number} x - 矩形左上角的 X 坐标。
 * @param {number} y - 矩形左上角的 Y 坐标。
 * @param {number} width - 矩形的宽度。
 * @param {number} height - 矩形的高度。
 * @param {number} radius - 圆角的半径。如果半径过大，实际行为可能因浏览器而异或被裁剪。
 */
function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * 根据节点在思维导图中的层级返回对应的样式配置对象。
 * 层级 0 对应根节点，层级 1、2、3 分别对应 `level1Node`、`level2Node`、`level3Node` 的样式。
 * 其他或未定义的层级将返回 `defaultNode` 样式。
 *
 * @param {number} level - 节点的层级（0 表示根节点）。
 * @returns {Object} 对应层级的节点样式对象 (来自 `MINDMAP_CONFIG`)。
 */
function getNodeStyle(level) {
  switch(level) {
    case 0: return MINDMAP_CONFIG.rootNode;
    case 1: return MINDMAP_CONFIG.level1Node;
    case 2: return MINDMAP_CONFIG.level2Node;
    case 3: return MINDMAP_CONFIG.level3Node;
    default: return MINDMAP_CONFIG.defaultNode;
  }
}

/**
 * 测量给定文本在指定字体大小下的渲染宽度。
 * 此函数通过创建一个临时的离屏 Canvas 并使用其 2D 上下文的 `measureText` 方法来实现。
 * 假定使用 'Arial, sans-serif' 字体族进行测量。
 *
 * @param {string} text - 需要测量宽度的文本字符串。
 * @param {number} fontSize - 文本的字体大小 (单位: px)。
 * @returns {number} 文本在指定字体大小下的渲染宽度 (单位: px)。
 */
function measureTextWidth(text, fontSize) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px Arial, sans-serif`;
  return ctx.measureText(text).width;
}

/**
 * 在指定的 HTML 容器中动态添加一个"导出思维导图"的按钮。
 * 点击该按钮会将传入的 Canvas 内容转换为 PNG 图片数据，并触发浏览器下载。
 * 下载的文件名为 "思维导图.png"。
 *
 * @param {HTMLElement} container - 将要添加导出按钮的 HTML 容器元素。
 * @param {HTMLCanvasElement} canvas - 包含已渲染思维导图的 Canvas 元素。
 */
function addExportButton(container, canvas) {
  const exportBtn = document.createElement('button');
  exportBtn.textContent = '导出思维导图';
  exportBtn.style.marginTop = '16px';
  exportBtn.style.padding = '8px 16px';
  exportBtn.style.backgroundColor = '#3182ce';
  exportBtn.style.color = 'white';
  exportBtn.style.border = 'none';
  exportBtn.style.borderRadius = '4px';
  exportBtn.style.cursor = 'pointer';

  exportBtn.onclick = function() {
    const link = document.createElement('a');
    link.download = '思维导图.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  container.appendChild(exportBtn);
}

/**
 * @global
 * @namespace MindMap
 * @description 全局暴露的思维导图 API 对象。
 * 提供了 `parse` 方法用于从 Markdown 解析数据，以及 `render` 方法用于在 Canvas 上渲染思维导图。
 */
window.MindMap = {
  /**
   * @function MindMap.parse
   * @description 从 Markdown 文本解析思维导图数据的快捷方式。
   * @param {string} markdown - Markdown 文本。
   * @returns {Object | null} 解析后的思维导图数据或 null。
   * @see parseMindMapFromMarkdown
   */
  parse: parseMindMapFromMarkdown,
  /**
   * @function MindMap.render
   * @description 将思维导图数据渲染到指定容器的快捷方式。
   * @param {string} containerId - 目标容器的 ID。
   * @param {Object} mindMapData - 思维导图数据。
   * @see renderMindMap
   */
  render: renderMindMap
};