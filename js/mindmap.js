// mindmap.js - 思维导图渲染器

// 思维导图节点样式配置
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

// 从Markdown层级结构解析思维导图数据
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

// 渲染思维导图到Canvas
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

// 计算节点布局(宽度、高度和子节点位置)
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

// 绘制思维导图
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

// 绘制单个节点
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

// 绘制节点间连接线
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

// 绘制圆角矩形
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

// 获取指定层级节点的样式
function getNodeStyle(level) {
  switch(level) {
    case 0: return MINDMAP_CONFIG.rootNode;
    case 1: return MINDMAP_CONFIG.level1Node;
    case 2: return MINDMAP_CONFIG.level2Node;
    case 3: return MINDMAP_CONFIG.level3Node;
    default: return MINDMAP_CONFIG.defaultNode;
  }
}

// 测量文本宽度
function measureTextWidth(text, fontSize) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `${fontSize}px Arial, sans-serif`;
  return ctx.measureText(text).width;
}

// 添加导出按钮
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

// 公开API
window.MindMap = {
  parse: parseMindMapFromMarkdown,
  render: renderMindMap
};