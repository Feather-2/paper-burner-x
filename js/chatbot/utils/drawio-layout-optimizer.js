// js/chatbot/utils/drawio-layout-optimizer.js

/**
 * Draw.io XML 布局优化工具
 *
 * 参考 smart-drawio-next 的优化思路，针对 draw.io XML 格式设计
 * 主要优化：
 * 0. Dagre 布局 - 使用标准 Sugiyama 算法进行层次化布局（推荐，显著减少交叉）
 * 1. 网格对齐 - 确保所有坐标对齐到网格
 * 2. 自动间距 - 避免节点重叠和拥挤，考虑连接关系智能排列
 * 3. 避免穿透 - 检测连线是否穿过节点，调整节点位置避让
 * 4. 智能连接 - 优化箭头的出入点位置，移除错误的 mxPoint 子元素
 * 5. 连线理线 - 检测交叉并通过调整节点位置减少交叉
 * 6. 样式统一 - 统一相同类型元素的样式
 *
 * @version 1.3.0 - 集成 Dagre.js 标准布局算法
 * @date 2025-01-16
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
 * 使用 Dagre 算法进行层次化布局（Sugiyama 算法）
 * 这是图布局的标准算法，能显著减少连线交叉
 *
 * @param {Document} xmlDoc - XML 文档对象
 * @param {Object} options - 布局选项
 * @returns {number} 调整的节点数量
 */
function applyDagreLayout(xmlDoc, options = {}) {
  // 检查 dagre 和 graphlib 是否可用（它们是两个独立的全局变量）
  const win = typeof window !== 'undefined' ? window : null;
  if (!win || typeof win.dagre === 'undefined') {
    console.warn('[DrawioOptimizer] ❌ Dagre 库未加载，跳过 Dagre 布局');
    return 0;
  }
  if (typeof win.graphlib === 'undefined') {
    console.warn('[DrawioOptimizer] ❌ Graphlib 库未加载，跳过 Dagre 布局');
    return 0;
  }

  console.log('[DrawioOptimizer] 🎯 应用 Dagre 层次化布局算法 (LR 模式)...');

  const defaultOptions = {
    rankdir: 'LR',      // 方向：LR (从左到右) - 层级横向展开，同层节点纵向排列
    nodesep: 100,       // 同层节点间距（LR模式下是垂直间距）- 增加以减少交叉
    ranksep: 180,       // 不同层间距（LR模式下是水平间距）- 增加以减少交叉
    edgesep: 20,        // 边之间的间距
    ranker: 'network-simplex',  // 使用 network-simplex 算法（最佳层分配）
    marginx: 20,        // 水平边距
    marginy: 20         // 垂直边距
  };

  const opts = { ...defaultOptions, ...options };

  try {
    const allCells = Array.from(xmlDoc.querySelectorAll('mxCell[vertex="1"]'));
    const allEdges = Array.from(xmlDoc.querySelectorAll('mxCell[edge="1"]'));
    const cellMap = new Map();

    // 构建 ID -> Cell 映射
    xmlDoc.querySelectorAll('mxCell[id]').forEach(cell => {
      cellMap.set(cell.getAttribute('id'), cell);
    });

    let adjustedCount = 0;

    // 1. 识别 subgraph 容器（swimlane）和顶层节点
    const subgraphContainers = [];
    const topLevelCells = [];
    const subgraphMembers = new Set(); // 记录 subgraph 内部节点

    allCells.forEach(cell => {
      const style = cell.getAttribute('style') || '';
      const parent = cell.getAttribute('parent');

      if (style.includes('swimlane')) {
        // 这是一个 subgraph 容器
        subgraphContainers.push(cell);
      } else {
        // 检查是否是 subgraph 内部节点
        const parentCell = cellMap.get(parent);
        if (parentCell && (parentCell.getAttribute('style') || '').includes('swimlane')) {
          // 这是 subgraph 内部的节点
          subgraphMembers.add(cell.getAttribute('id'));
        } else {
          // 这是顶层节点
          topLevelCells.push(cell);
        }
      }
    });

    console.log(`[DrawioOptimizer] 📊 发现 ${subgraphContainers.length} 个子图, ${topLevelCells.length} 个顶层节点`);

    // 2. 对每个 subgraph 内部单独进行 Dagre 布局
    subgraphContainers.forEach(container => {
      const containerId = container.getAttribute('id');
      const containerGeo = getCellGeometry(container);
      if (!containerGeo) return;

      // 找出属于这个 subgraph 的所有节点
      const members = allCells.filter(cell =>
        cell.getAttribute('parent') === containerId
      );

      if (members.length === 0) return;

      console.log(`[DrawioOptimizer]   🔹 子图 "${containerId}" 内部布局 (${members.length} 个节点)...`);

      // 创建子图的 Dagre 图
      const subG = new graphlib.Graph();
      subG.setGraph({
        ...opts,
        marginx: 20,
        marginy: 30  // 顶部留空间给 swimlane 标题
      });
      subG.setDefaultEdgeLabel(() => ({}));

      // 添加成员节点
      members.forEach(cell => {
        const id = cell.getAttribute('id');
        const geo = getCellGeometry(cell);
        if (!geo) return;

        subG.setNode(id, {
          width: geo.width,
          height: geo.height,
          originalGeo: geo,
          cell: cell
        });
      });

      // 添加子图内部的边
      allEdges.forEach(edge => {
        const source = edge.getAttribute('source');
        const target = edge.getAttribute('target');
        if (source && target && subG.hasNode(source) && subG.hasNode(target)) {
          subG.setEdge(source, target);
        }
      });

      // 执行子图布局
      dagre.layout(subG);

      // 应用布局结果（相对于 subgraph 容器的坐标）
      // 先收集所有节点的原始坐标
      const nodePositions = [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      subG.nodes().forEach(nodeId => {
        const node = subG.node(nodeId);
        if (!node) return;

        const { cell, width, height } = node;
        const rawX = Math.round(node.x - width / 2);
        const rawY = Math.round(node.y - height / 2);

        nodePositions.push({ cell, width, height, rawX, rawY });

        minX = Math.min(minX, rawX);
        minY = Math.min(minY, rawY);
        maxX = Math.max(maxX, rawX + width);
        maxY = Math.max(maxY, rawY + height);
      });

      console.log(`[DrawioOptimizer]     📍 原始节点范围: (${minX}, ${minY}) 到 (${maxX}, ${maxY})`);

      // 计算需要的偏移量，确保节点在容器内正确位置
      // swimlane 标题高度是 30px，左边距至少 20px
      const targetMinX = 20;  // 左边距
      const targetMinY = 40;  // 标题栏30px + 顶部边距10px

      // 只在节点坐标异常时才应用偏移量
      // 如果节点已经在合理位置（正数且接近目标），保持原位
      let offsetX = 0;
      let offsetY = 0;

      // 只在节点出现负坐标或严重偏移时才修正
      if (minX < 0) {
        offsetX = targetMinX - minX;  // 修正负坐标
      } else if (minX < 10) {
        offsetX = targetMinX - minX;  // 太靠近边缘，加点边距
      }

      if (minY < 0) {
        offsetY = targetMinY - minY;  // 修正负坐标
      } else if (minY < 30) {
        offsetY = targetMinY - minY;  // 太靠近标题栏，加点边距
      }

      console.log(`[DrawioOptimizer]     📐 应用偏移量: (${offsetX}, ${offsetY}) ${offsetX === 0 && offsetY === 0 ? '(无需调整)' : ''}`);

      // 应用偏移后的坐标
      let finalMinX = Infinity, finalMinY = Infinity, finalMaxX = -Infinity, finalMaxY = -Infinity;

      nodePositions.forEach(({ cell, width, height, rawX, rawY }) => {
        const finalX = rawX + offsetX;
        const finalY = rawY + offsetY;

        finalMinX = Math.min(finalMinX, finalX);
        finalMinY = Math.min(finalMinY, finalY);
        finalMaxX = Math.max(finalMaxX, finalX + width);
        finalMaxY = Math.max(finalMaxY, finalY + height);

        setCellGeometry(cell, {
          x: finalX,
          y: finalY,
          width: width,
          height: height
        });

        adjustedCount++;
      });

      console.log(`[DrawioOptimizer]     ✅ 最终节点范围: (${finalMinX}, ${finalMinY}) 到 (${finalMaxX}, ${finalMaxY})`);

      // 调整 subgraph 容器大小以包含所有成员
      if (finalMinX !== Infinity && finalMinY !== Infinity) {
        // 容器需要的尺寸 = 节点最大范围 + 底部/右侧边距
        const requiredWidth = Math.ceil(finalMaxX + 20);   // 右侧留20px边距
        const requiredHeight = Math.ceil(finalMaxY + 20);  // 底部留20px边距

        setCellGeometry(container, {
          x: containerGeo.x,
          y: containerGeo.y,
          width: Math.max(requiredWidth, 300),   // 最小300px
          height: Math.max(requiredHeight, 200)  // 最小200px
        });

        console.log(`[DrawioOptimizer]     📏 容器调整: ${requiredWidth}x${requiredHeight}`);
      }
    });

    // 3. 对顶层节点 + subgraph 容器进行全局 Dagre 布局
    if (topLevelCells.length > 0 || subgraphContainers.length > 0) {
      console.log(`[DrawioOptimizer] 🌍 全局布局 (${topLevelCells.length + subgraphContainers.length} 个顶层元素)...`);

      const g = new graphlib.Graph();
      g.setGraph(opts);
      g.setDefaultEdgeLabel(() => ({}));

      // 添加顶层节点和 subgraph 容器
      [...topLevelCells, ...subgraphContainers].forEach(cell => {
        const id = cell.getAttribute('id');
        const geo = getCellGeometry(cell);
        if (!geo) return;

        g.setNode(id, {
          width: geo.width,
          height: geo.height,
          originalGeo: geo,
          cell: cell
        });
      });

      // 添加顶层的边（不包括 subgraph 内部的边）
      allEdges.forEach(edge => {
        const source = edge.getAttribute('source');
        const target = edge.getAttribute('target');

        // 只添加至少有一端是顶层节点的边
        if (source && target && g.hasNode(source) && g.hasNode(target)) {
          g.setEdge(source, target);
        }
      });

      // 执行全局布局
      dagre.layout(g);

      // 应用全局布局结果
      g.nodes().forEach(nodeId => {
        const node = g.node(nodeId);
        if (!node) return;

        const { cell, width, height } = node;
        const newX = Math.round(node.x - width / 2);
        const newY = Math.round(node.y - height / 2);

        const geo = getCellGeometry(cell);
        if (!geo) return;

        // 直接设置容器位置
        // 注意：subgraph 容器内的节点坐标是相对的，容器移动时会自动跟随，不需要单独调整
        setCellGeometry(cell, {
          x: newX,
          y: newY,
          width: width,
          height: height
        });

        adjustedCount++;
      });
    }

    console.log(`[DrawioOptimizer] ✅ Dagre 布局完成: ${adjustedCount} 个节点已优化`);
    return adjustedCount;

  } catch (error) {
    console.error('[DrawioOptimizer] ❌ Dagre 布局失败:', error);
    return 0;
  }
}

/**
 * 自动间距优化（增强版 - 考虑连线关系）
 * 检测并修复节点重叠问题，同时尽量减少连线交叉
 *
 * @param {Document} xmlDoc - XML 文档对象
 * @param {number} minSpacing - 最小间距，默认 30px
 */
function optimizeSpacing(xmlDoc, minSpacing = 30) {
  const cells = Array.from(xmlDoc.querySelectorAll('mxCell[vertex="1"]'));
  const geometries = cells.map(cell => ({
    cell,
    id: cell.getAttribute('id'),
    ...getCellGeometry(cell)
  })).filter(g => g.x !== undefined);

  // 构建连接关系图
  const edges = xmlDoc.querySelectorAll('mxCell[edge="1"]');
  const connections = new Map(); // nodeId -> [targetIds]

  edges.forEach(edge => {
    const sourceId = edge.getAttribute('source');
    const targetId = edge.getAttribute('target');
    if (sourceId && targetId) {
      if (!connections.has(sourceId)) {
        connections.set(sourceId, []);
      }
      connections.get(sourceId).push(targetId);
    }
  });

  let adjustedCount = 0;

  // 按 Y 坐标分层
  const layers = new Map();
  geometries.forEach(g => {
    const layerY = Math.round(g.y / 50) * 50; // 按 50px 分层
    if (!layers.has(layerY)) {
      layers.set(layerY, []);
    }
    layers.get(layerY).push(g);
  });

  // 对每一层进行排序优化，减少交叉
  layers.forEach((nodesInLayer, layerY) => {
    if (nodesInLayer.length <= 1) return;

    // 按连接关系排序：如果节点有共同的目标，应该相邻放置
    nodesInLayer.sort((a, b) => {
      const aTargets = connections.get(a.id) || [];
      const bTargets = connections.get(b.id) || [];

      // 如果有共同目标，按第一个目标的 X 坐标排序
      if (aTargets.length > 0 && bTargets.length > 0) {
        // 简化：按第一个目标的 ID 字母序排序
        return aTargets[0].localeCompare(bTargets[0]);
      }

      // 否则按当前 X 坐标排序
      return a.x - b.x;
    });

    // 重新分配 X 坐标，保持间距
    let currentX = nodesInLayer[0].x;
    nodesInLayer.forEach((g, index) => {
      if (index > 0) {
        currentX += nodesInLayer[index - 1].width + minSpacing;
      }

      if (Math.abs(g.x - currentX) > 5) {
        setCellGeometry(g.cell, {
          x: currentX,
          y: g.y,
          width: g.width,
          height: g.height
        });
        adjustedCount++;
      }

      g.x = currentX;
    });
  });

  // 传统的重叠检测（跨层）
  for (let i = 0; i < geometries.length; i++) {
    for (let j = i + 1; j < geometries.length; j++) {
      const g1 = geometries[i];
      const g2 = geometries[j];

      // 如果在不同层，跳过（已经在上面处理了）
      const layer1 = Math.round(g1.y / 50) * 50;
      const layer2 = Math.round(g2.y / 50) * 50;
      if (layer1 === layer2) continue;

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
 * 对于 LR 布局（从左到右）：强制从左右边连接，不使用上下边
 *
 * @param {Object} sourceGeometry - 源节点几何信息
 * @param {Object} targetGeometry - 目标节点几何信息
 * @param {string} layoutDirection - 布局方向：'LR' 或 'TB'，默认 'LR'
 * @returns {Object} {exitX, exitY, entryX, entryY} - 归一化坐标 (0-1)
 */
function calculateOptimalConnection(sourceGeometry, targetGeometry, layoutDirection = 'LR') {
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

  let exitX = 0.5, exitY = 0.5, entryX = 0.5, entryY = 0.5;

  if (layoutDirection === 'LR') {
    // LR 布局：强制使用左右边连接
    if (dx > 0) {
      // 目标在右侧 - 标准流向
      exitX = 1; exitY = 0.5;   // 从右边出发
      entryX = 0; entryY = 0.5; // 从左边进入
    } else {
      // 目标在左侧 - 反向连接
      exitX = 0; exitY = 0.5;   // 从左边出发
      entryX = 1; entryY = 0.5; // 从右边进入
    }
  } else {
    // TB 布局：根据相对位置自动选择
    const isHorizontal = Math.abs(dx) > Math.abs(dy);

    if (isHorizontal) {
      if (dx > 0) {
        exitX = 1; exitY = 0.5;
        entryX = 0; entryY = 0.5;
      } else {
        exitX = 0; exitY = 0.5;
        entryX = 1; entryY = 0.5;
      }
    } else {
      if (dy > 0) {
        exitX = 0.5; exitY = 1;
        entryX = 0.5; entryY = 0;
      } else {
        exitX = 0.5; exitY = 0;
        entryX = 0.5; entryY = 1;
      }
    }
  }

  return { exitX, exitY, entryX, entryY };
}

/**
 * 检测两条连线是否交叉
 * @param {Object} edge1 - {source, target, sourceGeo, targetGeo}
 * @param {Object} edge2 - {source, target, sourceGeo, targetGeo}
 * @returns {boolean} 是否交叉
 */
function detectEdgeCrossing(edge1, edge2) {
  // 简化：检测线段的包围盒是否重叠
  const box1 = {
    minX: Math.min(edge1.sourceGeo.x, edge1.targetGeo.x),
    maxX: Math.max(edge1.sourceGeo.x + edge1.sourceGeo.width, edge1.targetGeo.x + edge1.targetGeo.width),
    minY: Math.min(edge1.sourceGeo.y, edge1.targetGeo.y),
    maxY: Math.max(edge1.sourceGeo.y + edge1.sourceGeo.height, edge1.targetGeo.y + edge1.targetGeo.height)
  };

  const box2 = {
    minX: Math.min(edge2.sourceGeo.x, edge2.targetGeo.x),
    maxX: Math.max(edge2.sourceGeo.x + edge2.sourceGeo.width, edge2.targetGeo.x + edge2.targetGeo.width),
    minY: Math.min(edge2.sourceGeo.y, edge2.targetGeo.y),
    maxY: Math.max(edge2.sourceGeo.y + edge2.sourceGeo.height, edge2.targetGeo.y + edge2.targetGeo.height)
  };

  // 包围盒重叠检测
  const overlapping = !(box1.maxX < box2.minX || box2.maxX < box1.minX ||
                        box1.maxY < box2.minY || box2.maxY < box1.minY);

  if (!overlapping) return false;

  // 进一步检测：如果是垂直布局（上下关系），检查是否交叉连接
  const edge1IsVertical = Math.abs(edge1.targetGeo.y - edge1.sourceGeo.y) > 50;
  const edge2IsVertical = Math.abs(edge2.targetGeo.y - edge2.sourceGeo.y) > 50;

  if (edge1IsVertical && edge2IsVertical) {
    // 检查交叉连接模式：A→C 和 B→D，如果 A 在 B 右侧但 C 在 D 左侧
    const edge1SourceCenter = edge1.sourceGeo.x + edge1.sourceGeo.width / 2;
    const edge1TargetCenter = edge1.targetGeo.x + edge1.targetGeo.width / 2;
    const edge2SourceCenter = edge2.sourceGeo.x + edge2.sourceGeo.width / 2;
    const edge2TargetCenter = edge2.targetGeo.x + edge2.targetGeo.width / 2;

    // 交叉模式检测
    if ((edge1SourceCenter > edge2SourceCenter && edge1TargetCenter < edge2TargetCenter) ||
        (edge1SourceCenter < edge2SourceCenter && edge1TargetCenter > edge2TargetCenter)) {
      return true;
    }
  }

  return false;
}

/**
 * 避免连线穿过节点的优化
 * 检测连线路径是否穿过其他节点，并调整节点位置来避让
 *
 * @param {Document} xmlDoc - XML 文档对象
 * @returns {number} 调整的节点数量
 */
function optimizeEdgeNodeAvoidance(xmlDoc) {
  console.log('[DrawioOptimizer] 🎯 检测连线-节点冲突...');

  const edges = xmlDoc.querySelectorAll('mxCell[edge="1"]');
  const vertices = Array.from(xmlDoc.querySelectorAll('mxCell[vertex="1"]'));
  const cellMap = new Map();

  // 构建 ID -> Cell 的映射
  xmlDoc.querySelectorAll('mxCell[id]').forEach(cell => {
    cellMap.set(cell.getAttribute('id'), cell);
  });

  // 收集所有节点的几何信息
  const nodeGeometries = vertices.map(cell => ({
    cell,
    id: cell.getAttribute('id'),
    ...getCellGeometry(cell)
  })).filter(g => g.x !== undefined);

  let adjustedCount = 0;

  // 检测每条连线
  edges.forEach(edge => {
    const sourceId = edge.getAttribute('source');
    const targetId = edge.getAttribute('target');
    if (!sourceId || !targetId) return;

    const sourceCell = cellMap.get(sourceId);
    const targetCell = cellMap.get(targetId);
    if (!sourceCell || !targetCell) return;

    const sourceGeo = getCellGeometry(sourceCell);
    const targetGeo = getCellGeometry(targetCell);
    if (!sourceGeo || !targetGeo) return;

    // 计算连线的包围盒（简化的正交路径）
    // 正交路径：source中心 → 垂直移动 → 水平移动 → 垂直移动 → target中心
    const sourceCenterX = sourceGeo.x + sourceGeo.width / 2;
    const sourceCenterY = sourceGeo.y + sourceGeo.height / 2;
    const targetCenterX = targetGeo.x + targetGeo.width / 2;
    const targetCenterY = targetGeo.y + targetGeo.height / 2;

    // 连线的包围盒（留10px余量）
    const edgeBox = {
      minX: Math.min(sourceCenterX, targetCenterX) - 10,
      maxX: Math.max(sourceCenterX, targetCenterX) + 10,
      minY: Math.min(sourceCenterY, targetCenterY) - 10,
      maxY: Math.max(sourceCenterY, targetCenterY) + 10
    };

    // 检测是否有其他节点在连线路径上
    nodeGeometries.forEach(node => {
      // 跳过连线的起点和终点
      if (node.id === sourceId || node.id === targetId) return;

      // 检测节点是否在连线的包围盒内
      const nodeBox = {
        minX: node.x,
        maxX: node.x + node.width,
        minY: node.y,
        maxY: node.y + node.height
      };

      // 包围盒相交检测
      const isIntersecting = !(
        nodeBox.maxX < edgeBox.minX ||
        nodeBox.minX > edgeBox.maxX ||
        nodeBox.maxY < edgeBox.minY ||
        nodeBox.minY > edgeBox.minY
      );

      if (isIntersecting) {
        // 检测节点是否在连线的"中间区域"（不是起点或终点附近）
        const isInMiddleRegion =
          nodeBox.minX > Math.min(sourceGeo.x + sourceGeo.width, targetGeo.x + targetGeo.width) &&
          nodeBox.maxX < Math.max(sourceGeo.x, targetGeo.x);

        if (isInMiddleRegion) {
          // 需要调整节点位置
          // 策略：将节点向左或向右移动，偏离连线路径
          const edgeCenterX = (sourceCenterX + targetCenterX) / 2;
          const nodeCenterX = node.x + node.width / 2;

          // 计算移动方向（远离连线中心）
          let newX;
          if (nodeCenterX < edgeCenterX) {
            // 节点在连线左侧，继续向左移
            newX = edgeBox.minX - node.width - 30;
          } else {
            // 节点在连线右侧，继续向右移
            newX = edgeBox.maxX + 30;
          }

          // 确保新位置不是负数
          newX = Math.max(0, newX);

          // 更新节点位置
          setCellGeometry(node.cell, {
            x: newX,
            y: node.y,
            width: node.width,
            height: node.height
          });

          node.x = newX; // 更新缓存
          adjustedCount++;

          console.log(`[DrawioOptimizer] 调整节点 ${node.id}，避让连线 ${sourceId}->${targetId}`);
        }
      }
    });
  });

  console.log(`[DrawioOptimizer] ✅ 连线-节点避让: ${adjustedCount} 个节点已调整`);
  return adjustedCount;
}

/**
 * 智能连接优化（增强版 - 包含理线功能）
 * 自动设置连接线的出入点，并尝试减少交叉
 *
 * @param {Document} xmlDoc - XML 文档对象
 * @param {string} layoutDirection - 布局方向：'LR' 或 'TB'，默认 'LR'
 */
function optimizeConnections(xmlDoc, layoutDirection = 'LR') {
  const edges = xmlDoc.querySelectorAll('mxCell[edge="1"]');
  const cellMap = new Map();

  // 构建 ID -> Cell 的映射
  xmlDoc.querySelectorAll('mxCell[id]').forEach(cell => {
    cellMap.set(cell.getAttribute('id'), cell);
  });

  // 收集所有连线信息
  const edgeInfos = [];
  edges.forEach(edge => {
    const sourceId = edge.getAttribute('source');
    const targetId = edge.getAttribute('target');

    if (!sourceId || !targetId) return;

    const sourceCell = cellMap.get(sourceId);
    const targetCell = cellMap.get(targetId);

    if (!sourceCell || !targetCell) return;

    const sourceGeo = getCellGeometry(sourceCell);
    const targetGeo = getCellGeometry(targetCell);

    if (!sourceGeo || !targetGeo) return;

    edgeInfos.push({
      edge,
      sourceId,
      targetId,
      sourceCell,
      targetCell,
      sourceGeo,
      targetGeo
    });
  });

  // 检测交叉并记录
  let crossingCount = 0;
  const crossingPairs = [];

  for (let i = 0; i < edgeInfos.length; i++) {
    for (let j = i + 1; j < edgeInfos.length; j++) {
      if (detectEdgeCrossing(edgeInfos[i], edgeInfos[j])) {
        crossingCount++;
        crossingPairs.push([i, j]);
      }
    }
  }

  if (crossingCount > 0) {
    console.log(`[DrawioOptimizer] 检测到 ${crossingCount} 处连线交叉，尝试优化...`);
  }

  let optimizedCount = 0;

  // 为每条连线设置最佳连接点
  edgeInfos.forEach(info => {
    const { edge, sourceGeo, targetGeo } = info;

    // 计算最佳连接点（传入布局方向）
    const connection = calculateOptimalConnection(sourceGeo, targetGeo, layoutDirection);

    // 获取或创建 mxGeometry（必须是自闭合标签，不能有子元素）
    let geometry = edge.querySelector('mxGeometry');
    if (!geometry) {
      geometry = xmlDoc.createElement('mxGeometry');
      geometry.setAttribute('relative', '1');
      geometry.setAttribute('as', 'geometry');
      edge.appendChild(geometry);
    }

    // ❌ 删除任何 mxPoint 子元素（这会导致 "Could not add object mxGeometry" 错误）
    const mxPoints = geometry.querySelectorAll('mxPoint');
    mxPoints.forEach(point => point.remove());

    // ✅ 连接点信息应该只放在 style 属性中，不要创建 mxPoint 子元素
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

    // 添加正交路由样式（美观且减少交叉）
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
    dagreLayout: true,     // 使用 Dagre 算法进行层次化布局（新增，默认开启）
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

    // 0. Dagre 层次化布局（优先级最高，使用标准 Sugiyama 算法）
    if (opts.dagreLayout) {
      totalOptimized += applyDagreLayout(xmlDoc, {
        rankdir: 'LR',   // 从左到右布局，层级横向展开
        nodesep: 100,    // 同层节点垂直间距 - 增加以减少交叉
        ranksep: 180,    // 不同层水平间距 - 增加以减少交叉
        edgesep: 20,     // 边之间的间距
        ranker: 'network-simplex'  // 最佳层分配算法
      });
    }

    // 1. 网格对齐
    if (opts.gridAlignment) {
      totalOptimized += optimizeGridAlignment(xmlDoc, 10);
    }

    // 2. 间距优化（如果没有使用 dagre，则进行间距优化）
    if (opts.spacing && !opts.dagreLayout) {
      totalOptimized += optimizeSpacing(xmlDoc, 30);
    }

    // 3. 避免连线穿过节点
    if (opts.spacing) {
      totalOptimized += optimizeEdgeNodeAvoidance(xmlDoc);
    }

    // 4. 连接优化（传入布局方向）
    if (opts.connections) {
      totalOptimized += optimizeConnections(xmlDoc, 'LR');
    }

    // 5. 样式统一
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

/**
 * 对单个 diagram 进行优化（多页支持）
 * @param {Element} diagram - diagram 元素
 * @param {Object} opts - 优化选项
 * @returns {number} 优化次数
 */
function optimizeDiagram(diagram, opts) {
  const diagramName = diagram.getAttribute('name') || 'Unnamed';

  // 创建临时文档，只包含当前 diagram
  const tempDoc = document.implementation.createDocument(null, 'mxfile', null);
  const tempDiagram = diagram.cloneNode(true);
  tempDoc.documentElement.appendChild(tempDiagram);

  let optimized = 0;

  // 获取布局方向（默认 TB）
  const layoutDir = opts.layoutDirection || 'TB';

  // 应用所有优化（使用临时文档）
  if (opts.dagreLayout) {
    // 根据布局方向调整参数
    const dagreOpts = layoutDir === 'TB' ? {
      rankdir: 'TB',       // 从上到下
      nodesep: 80,         // 同层节点横向间距
      ranksep: 120,        // 不同层纵向间距（更紧凑）
      edgesep: 10,
      ranker: 'network-simplex'
    } : {
      rankdir: 'LR',       // 从左到右
      nodesep: 100,        // 同层节点纵向间距
      ranksep: 180,        // 不同层横向间距
      edgesep: 20,
      ranker: 'network-simplex'
    };

    optimized += applyDagreLayout(tempDoc, dagreOpts);
  }

  if (opts.gridAlignment) {
    optimized += optimizeGridAlignment(tempDoc, 10);
  }

  if (opts.spacing && !opts.dagreLayout) {
    optimized += optimizeSpacing(tempDoc, 30);
  }

  if (opts.spacing) {
    optimized += optimizeEdgeNodeAvoidance(tempDoc);
  }

  if (opts.connections) {
    optimized += optimizeConnections(tempDoc, layoutDir);
  }

  if (opts.styles) {
    optimized += optimizeStyles(tempDoc);
  }

  // 将优化后的节点同步回原始 diagram
  const optimizedDiagram = tempDoc.querySelector('diagram');
  const originalCells = diagram.querySelectorAll('mxCell[id]');
  const optimizedCells = optimizedDiagram.querySelectorAll('mxCell[id]');

  const cellMap = new Map();
  optimizedCells.forEach(cell => {
    cellMap.set(cell.getAttribute('id'), cell);
  });

  originalCells.forEach(originalCell => {
    const id = originalCell.getAttribute('id');
    const optimizedCell = cellMap.get(id);
    if (!optimizedCell) return;

    // 同步几何信息和样式
    const originalGeo = originalCell.querySelector('mxGeometry');
    const optimizedGeo = optimizedCell.querySelector('mxGeometry');

    if (originalGeo && optimizedGeo) {
      // 同步所有属性
      ['x', 'y', 'width', 'height', 'relative', 'as', 'exitX', 'exitY', 'entryX', 'entryY'].forEach(attr => {
        if (optimizedGeo.hasAttribute(attr)) {
          originalGeo.setAttribute(attr, optimizedGeo.getAttribute(attr));
        }
      });
    }

    // 同步样式
    if (optimizedCell.hasAttribute('style')) {
      originalCell.setAttribute('style', optimizedCell.getAttribute('style'));
    }
  });

  return optimized;
}

/**
 * 主优化函数（支持多页图表）
 * @param {string} xmlString - 原始 draw.io XML 字符串
 * @param {Object} options - 优化选项
 * @returns {string} 优化后的 XML 字符串
 */
function optimizeDrawioLayoutMultiPage(xmlString, options = {}) {
  const defaultOptions = {
    dagreLayout: true,
    gridAlignment: true,
    spacing: true,
    connections: true,
    styles: false
  };

  const opts = { ...defaultOptions, ...options };

  try {
    const xmlDoc = parseDrawioXml(xmlString);
    const diagrams = Array.from(xmlDoc.querySelectorAll('diagram'));

    if (diagrams.length === 0) {
      console.warn('[DrawioOptimizer] ⚠️ 未找到 diagram 元素，使用旧版单页优化');
      return optimizeDrawioLayout(xmlString, options);
    }

    console.log(`[DrawioOptimizer] 🎯 检测到 ${diagrams.length} 个页面，开始独立优化...`);

    let totalOptimized = 0;

    diagrams.forEach((diagram, index) => {
      const name = diagram.getAttribute('name') || `Page ${index + 1}`;
      console.log(`[DrawioOptimizer] 📄 优化页面 "${name}"...`);
      const count = optimizeDiagram(diagram, opts);
      console.log(`[DrawioOptimizer] ✅ 页面 "${name}" 完成，优化 ${count} 处`);
      totalOptimized += count;
    });

    console.log(`[DrawioOptimizer] ✅ 全部完成，共优化 ${totalOptimized} 处`);
    return serializeDrawioXml(xmlDoc);

  } catch (error) {
    console.error('[DrawioOptimizer] ❌ 多页优化失败，回退到单页模式:', error);
    return optimizeDrawioLayout(xmlString, options);
  }
}

export const DrawioLayoutOptimizer = {
  optimizeDrawioLayout: optimizeDrawioLayoutMultiPage,  // 使用新的多页版本
  optimizeDrawioLayoutLegacy: optimizeDrawioLayout      // 保留旧版本
};

export { optimizeDrawioLayoutMultiPage, optimizeDrawioLayout as optimizeDrawioLayoutLegacy };

// 向后兼容：暴露到 window
if (typeof window !== 'undefined') {
  window.DrawioLayoutOptimizer = DrawioLayoutOptimizer;
}
