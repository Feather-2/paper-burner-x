// js/chatbot/utils/drawio-layout-optimizer.js

/**
 * Draw.io XML 布局优化工具
 *
 * 参考 smart-drawio-next 的优化思路，针对 draw.io XML 格式设计
 * 主要优化：
 * 1. 网格对齐 - 确保所有坐标对齐到网格
 * 2. 自动间距 - 避免节点重叠和拥挤
 * 3. 智能连接 - 优化箭头的出入点位置
 * 4. 样式统一 - 统一相同类型元素的样式
 *
 * @version 1.0.0
 * @date 2025-01-15
 */

/**
 * 从 XML 字符串解析出 mxCell 节点
 * @param {string} xmlString - draw.io XML 字符串
 * @returns {Document} 解析后的 XML 文档对象
 */
function parseDrawioXml(xmlString) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  // 检查解析错误
  const parserError = xmlDoc.querySelector('parsererror');
  if (parserError) {
    throw new Error('XML 解析失败: ' + parserError.textContent);
  }

  return xmlDoc;
}

/**
 * 将 XML 文档序列化回字符串
 * @param {Document} xmlDoc - XML 文档对象
 * @returns {string} XML 字符串
 */
function serializeDrawioXml(xmlDoc) {
  const serializer = new XMLSerializer();
  return serializer.serializeToString(xmlDoc);
}

/**
 * 获取节点的几何信息
 * @param {Element} cell - mxCell 元素
 * @returns {Object|null} {x, y, width, height} 或 null
 */
function getCellGeometry(cell) {
  const geometry = cell.querySelector('mxGeometry');
  if (!geometry) return null;

  return {
    x: parseFloat(geometry.getAttribute('x')) || 0,
    y: parseFloat(geometry.getAttribute('y')) || 0,
    width: parseFloat(geometry.getAttribute('width')) || 100,
    height: parseFloat(geometry.getAttribute('height')) || 100
  };
}

/**
 * 设置节点的几何信息
 * @param {Element} cell - mxCell 元素
 * @param {Object} geometry - {x, y, width, height}
 */
function setCellGeometry(cell, geometry) {
  let geometryElem = cell.querySelector('mxGeometry');
  if (!geometryElem) {
    geometryElem = cell.ownerDocument.createElement('mxGeometry');
    geometryElem.setAttribute('as', 'geometry');
    cell.appendChild(geometryElem);
  }

  if (geometry.x !== undefined) geometryElem.setAttribute('x', geometry.x);
  if (geometry.y !== undefined) geometryElem.setAttribute('y', geometry.y);
  if (geometry.width !== undefined) geometryElem.setAttribute('width', geometry.width);
  if (geometry.height !== undefined) geometryElem.setAttribute('height', geometry.height);
}

/**
 * 网格对齐优化
 * 确保所有坐标都对齐到网格（默认 10px）
 *
 * @param {Document} xmlDoc - XML 文档对象
 * @param {number} gridSize - 网格大小，默认 10
 */
function optimizeGridAlignment(xmlDoc, gridSize = 10) {
  const cells = xmlDoc.querySelectorAll('mxCell[vertex="1"]');
  let optimizedCount = 0;

  cells.forEach(cell => {
    const geometry = getCellGeometry(cell);
    if (!geometry) return;

    // 对齐到网格
    const alignedX = Math.round(geometry.x / gridSize) * gridSize;
    const alignedY = Math.round(geometry.y / gridSize) * gridSize;

    if (alignedX !== geometry.x || alignedY !== geometry.y) {
      setCellGeometry(cell, {
        x: alignedX,
        y: alignedY,
        width: geometry.width,
        height: geometry.height
      });
      optimizedCount++;
    }
  });

  console.log(`[DrawioOptimizer] 网格对齐: ${optimizedCount} 个节点已优化`);
  return optimizedCount;
}

/**
 * 检测节点重叠
 * @param {Object} rect1 - {x, y, width, height}
 * @param {Object} rect2 - {x, y, width, height}
 * @param {number} minSpacing - 最小间距
 * @returns {boolean} 是否重叠或过近
 */
function isOverlapping(rect1, rect2, minSpacing = 20) {
  return !(
    rect1.x + rect1.width + minSpacing < rect2.x ||
    rect2.x + rect2.width + minSpacing < rect1.x ||
    rect1.y + rect1.height + minSpacing < rect2.y ||
    rect2.y + rect2.height + minSpacing < rect1.y
  );
}

/**
 * 自动间距优化
 * 检测并修复节点重叠问题
 *
 * @param {Document} xmlDoc - XML 文档对象
 * @param {number} minSpacing - 最小间距，默认 30px
 */
function optimizeSpacing(xmlDoc, minSpacing = 30) {
  const cells = Array.from(xmlDoc.querySelectorAll('mxCell[vertex="1"]'));
  const geometries = cells.map(cell => ({
    cell,
    ...getCellGeometry(cell)
  })).filter(g => g.x !== undefined);

  let adjustedCount = 0;

  // 简单的重叠检测和调整（横向推开）
  for (let i = 0; i < geometries.length; i++) {
    for (let j = i + 1; j < geometries.length; j++) {
      const g1 = geometries[i];
      const g2 = geometries[j];

      if (isOverlapping(g1, g2, minSpacing)) {
        // 横向推开第二个节点
        const newX = g1.x + g1.width + minSpacing;
        setCellGeometry(g2.cell, {
          x: newX,
          y: g2.y,
          width: g2.width,
          height: g2.height
        });
        g2.x = newX; // 更新缓存
        adjustedCount++;
      }
    }
  }

  console.log(`[DrawioOptimizer] 间距优化: ${adjustedCount} 个节点已调整`);
  return adjustedCount;
}

/**
 * 计算两个节点的最佳连接边缘
 * 根据相对位置判断应该从哪条边连接
 *
 * @param {Object} sourceGeometry - 源节点几何信息
 * @param {Object} targetGeometry - 目标节点几何信息
 * @returns {Object} {exitX, exitY, entryX, entryY} - 归一化坐标 (0-1)
 */
function calculateOptimalConnection(sourceGeometry, targetGeometry) {
  if (!sourceGeometry || !targetGeometry) {
    return { exitX: 0.5, exitY: 0.5, entryX: 0.5, entryY: 0.5 };
  }

  // 计算中心点
  const sourceCenterX = sourceGeometry.x + sourceGeometry.width / 2;
  const sourceCenterY = sourceGeometry.y + sourceGeometry.height / 2;
  const targetCenterX = targetGeometry.x + targetGeometry.width / 2;
  const targetCenterY = targetGeometry.y + targetGeometry.height / 2;

  // 计算相对位置
  const dx = targetCenterX - sourceCenterX;
  const dy = targetCenterY - sourceCenterY;

  // 判断主要方向（横向 vs 纵向）
  const isHorizontal = Math.abs(dx) > Math.abs(dy);

  let exitX = 0.5, exitY = 0.5, entryX = 0.5, entryY = 0.5;

  if (isHorizontal) {
    if (dx > 0) {
      // 目标在右侧
      exitX = 1; exitY = 0.5;   // 从右边出发
      entryX = 0; entryY = 0.5; // 从左边进入
    } else {
      // 目标在左侧
      exitX = 0; exitY = 0.5;   // 从左边出发
      entryX = 1; entryY = 0.5; // 从右边进入
    }
  } else {
    if (dy > 0) {
      // 目标在下方
      exitX = 0.5; exitY = 1;   // 从底部出发
      entryX = 0.5; entryY = 0; // 从顶部进入
    } else {
      // 目标在上方
      exitX = 0.5; exitY = 0;   // 从顶部出发
      entryX = 0.5; entryY = 1; // 从底部进入
    }
  }

  return { exitX, exitY, entryX, entryY };
}

/**
 * 智能连接优化
 * 自动设置连接线的出入点，使其更美观
 *
 * @param {Document} xmlDoc - XML 文档对象
 */
function optimizeConnections(xmlDoc) {
  const edges = xmlDoc.querySelectorAll('mxCell[edge="1"]');
  const cellMap = new Map();

  // 构建 ID -> Cell 的映射
  xmlDoc.querySelectorAll('mxCell[id]').forEach(cell => {
    cellMap.set(cell.getAttribute('id'), cell);
  });

  let optimizedCount = 0;

  edges.forEach(edge => {
    const sourceId = edge.getAttribute('source');
    const targetId = edge.getAttribute('target');

    if (!sourceId || !targetId) return;

    const sourceCell = cellMap.get(sourceId);
    const targetCell = cellMap.get(targetId);

    if (!sourceCell || !targetCell) return;

    const sourceGeometry = getCellGeometry(sourceCell);
    const targetGeometry = getCellGeometry(targetCell);

    if (!sourceGeometry || !targetGeometry) return;

    // 计算最佳连接点
    const connection = calculateOptimalConnection(sourceGeometry, targetGeometry);

    // 获取或创建 mxGeometry
    let geometry = edge.querySelector('mxGeometry');
    if (!geometry) {
      geometry = xmlDoc.createElement('mxGeometry');
      geometry.setAttribute('relative', '1');
      geometry.setAttribute('as', 'geometry');
      edge.appendChild(geometry);
    }

    // 创建或更新源点和目标点
    let sourcePoint = geometry.querySelector('mxPoint[as="sourcePoint"]');
    if (!sourcePoint) {
      sourcePoint = xmlDoc.createElement('mxPoint');
      sourcePoint.setAttribute('as', 'sourcePoint');
      geometry.appendChild(sourcePoint);
    }
    sourcePoint.setAttribute('x', connection.exitX);
    sourcePoint.setAttribute('y', connection.exitY);

    let targetPoint = geometry.querySelector('mxPoint[as="targetPoint"]');
    if (!targetPoint) {
      targetPoint = xmlDoc.createElement('mxPoint');
      targetPoint.setAttribute('as', 'targetPoint');
      geometry.appendChild(targetPoint);
    }
    targetPoint.setAttribute('x', connection.entryX);
    targetPoint.setAttribute('y', connection.entryY);

    // 更新样式：添加 exitX/exitY/entryX/entryY
    const style = edge.getAttribute('style') || '';
    const styleMap = new Map();
    style.split(';').forEach(pair => {
      const [key, value] = pair.split('=');
      if (key) styleMap.set(key.trim(), value || '');
    });

    styleMap.set('exitX', connection.exitX);
    styleMap.set('exitY', connection.exitY);
    styleMap.set('entryX', connection.entryX);
    styleMap.set('entryY', connection.entryY);

    // 添加正交路由样式（美观）
    if (!styleMap.has('edgeStyle')) {
      styleMap.set('edgeStyle', 'orthogonalEdgeStyle');
    }
    if (!styleMap.has('rounded')) {
      styleMap.set('rounded', '0');
    }

    const newStyle = Array.from(styleMap.entries())
      .map(([k, v]) => v ? `${k}=${v}` : k)
      .join(';');

    edge.setAttribute('style', newStyle);
    optimizedCount++;
  });

  console.log(`[DrawioOptimizer] 连接优化: ${optimizedCount} 条连接线已优化`);
  return optimizedCount;
}

/**
 * 样式统一优化
 * 为相同类型的节点应用一致的样式
 *
 * @param {Document} xmlDoc - XML 文档对象
 */
function optimizeStyles(xmlDoc) {
  const cells = xmlDoc.querySelectorAll('mxCell[vertex="1"]');

  // 按节点类型分组（根据 style 中的 shape 或默认形状）
  const typeGroups = new Map();

  cells.forEach(cell => {
    const style = cell.getAttribute('style') || '';
    let type = 'default';

    // 提取形状类型
    const shapeMatch = style.match(/shape=([^;]+)/);
    if (shapeMatch) {
      type = shapeMatch[1];
    } else if (style.includes('rounded=1')) {
      type = 'rounded';
    } else if (style.includes('ellipse')) {
      type = 'ellipse';
    }

    if (!typeGroups.has(type)) {
      typeGroups.set(type, []);
    }
    typeGroups.get(type).push(cell);
  });

  let optimizedCount = 0;

  // 为每个类型组应用统一样式
  typeGroups.forEach((cells, type) => {
    if (cells.length < 2) return; // 少于2个节点，无需统一

    // 收集第一个节点的样式作为基准
    const referenceStyle = cells[0].getAttribute('style') || '';
    const styleMap = new Map();
    referenceStyle.split(';').forEach(pair => {
      const [key, value] = pair.split('=');
      if (key) styleMap.set(key.trim(), value || '');
    });

    // 确保有基本样式
    if (!styleMap.has('fillColor')) {
      // 根据类型设置默认颜色
      const colors = {
        'default': '#dae8fc',
        'rounded': '#d5e8d4',
        'ellipse': '#ffe6cc',
        'swimlane': '#f5f5f5'
      };
      styleMap.set('fillColor', colors[type] || '#ffffff');
    }

    if (!styleMap.has('strokeColor')) {
      styleMap.set('strokeColor', '#6c8ebf');
    }

    // 应用到所有同类型节点
    const unifiedStyle = Array.from(styleMap.entries())
      .map(([k, v]) => v ? `${k}=${v}` : k)
      .join(';');

    cells.forEach((cell, index) => {
      if (index === 0) return; // 跳过参考节点
      cell.setAttribute('style', unifiedStyle);
      optimizedCount++;
    });
  });

  console.log(`[DrawioOptimizer] 样式统一: ${optimizedCount} 个节点已优化`);
  return optimizedCount;
}

/**
 * 主优化函数
 * 依次执行所有优化步骤
 *
 * @param {string} xmlString - 原始 draw.io XML 字符串
 * @param {Object} options - 优化选项
 * @param {boolean} options.gridAlignment - 是否网格对齐，默认 true
 * @param {boolean} options.spacing - 是否间距优化，默认 true
 * @param {boolean} options.connections - 是否连接优化，默认 true
 * @param {boolean} options.styles - 是否样式统一，默认 false
 * @returns {string} 优化后的 XML 字符串
 */
function optimizeDrawioLayout(xmlString, options = {}) {
  const defaultOptions = {
    gridAlignment: true,
    spacing: true,
    connections: true,
    styles: false // 默认关闭，避免覆盖用户自定义样式
  };

  const opts = { ...defaultOptions, ...options };

  try {
    console.log('[DrawioOptimizer] 开始优化布局...');

    // 解析 XML
    const xmlDoc = parseDrawioXml(xmlString);

    let totalOptimized = 0;

    // 1. 网格对齐
    if (opts.gridAlignment) {
      totalOptimized += optimizeGridAlignment(xmlDoc, 10);
    }

    // 2. 间距优化
    if (opts.spacing) {
      totalOptimized += optimizeSpacing(xmlDoc, 30);
    }

    // 3. 连接优化
    if (opts.connections) {
      totalOptimized += optimizeConnections(xmlDoc);
    }

    // 4. 样式统一
    if (opts.styles) {
      totalOptimized += optimizeStyles(xmlDoc);
    }

    console.log(`[DrawioOptimizer] ✅ 优化完成，共优化 ${totalOptimized} 处`);

    // 序列化回 XML
    return serializeDrawioXml(xmlDoc);

  } catch (error) {
    console.error('[DrawioOptimizer] ❌ 优化失败:', error);
    return xmlString; // 失败时返回原始 XML
  }
}

// 导出到全局
window.DrawioLayoutOptimizer = {
  optimizeDrawioLayout
};
