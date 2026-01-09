// js/chatbot/utils/drawio-lite-parser.js

/**
 * DrawioLite DSL Parser
 * 将极简文本语法转换为 Draw.io mxGraph XML
 *
 * 支持功能：
 * - 基本节点和连接
 * - 分组/容器 (swimlane)
 * - 图例 (legend)
 * - 并列子图 (subgraph) - 复杂多图支持
 * - 多页图表 (page) - 复杂多图支持
 *
 * @version 1.1.0 - 支持复杂多图
 * @date 2025-01-16
 */

/**
 * 颜色预设（学术标准）
 */
const COLOR_PRESETS = {
  gray: { fill: '#F7F9FC', stroke: '#2C3E50' },
  blue: { fill: '#dae8fc', stroke: '#3498DB' },
  lightblue: { fill: '#dae8fc', stroke: '#6c8ebf' },
  green: { fill: '#d5e8d4', stroke: '#82b366' },
  yellow: { fill: '#fff2cc', stroke: '#d6b656' },
  red: { fill: '#f8cecc', stroke: '#E74C3C' },
  orange: { fill: '#ffe6cc', stroke: '#d79b00' }
};

/**
 * 形状预设
 */
const SHAPE_PRESETS = {
  rect: 'rounded=1;whiteSpace=wrap;html=1',
  ellipse: 'ellipse;whiteSpace=wrap;html=1',
  diamond: 'rhombus;whiteSpace=wrap;html=1',
  circle: 'ellipse;aspect=fixed;whiteSpace=wrap;html=1',
  cylinder: 'shape=cylinder3;whiteSpace=wrap;html=1',
  hexagon: 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1'
};

/**
 * 解析 DrawioLite DSL
 * @param {string} dsl - DSL 文本
 * @returns {Object} { pages, hasMultiPage, nodes, edges, groups, subgraphs, legend }
 */
export function parseDrawioLite(dsl) {
  // 边界检查
  if (!dsl || typeof dsl !== 'string') {
    console.warn('[DrawioLite] 解析失败：输入为空或非字符串');
    return {
      pages: [],
      hasMultiPage: false,
      nodes: [],
      edges: [],
      groups: [],
      subgraphs: [],
      legend: []
    };
  }

  const lines = dsl.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  // 全局容器
  const result = {
    pages: [],
    hasMultiPage: false,
    nodes: [],
    edges: [],
    groups: [],
    subgraphs: [],
    legend: []
  };

  // 状态追踪
  let currentContext = result; // 当前上下文（全局、页面、子图）
  let inGroup = null;
  let inLegend = false;

  const contextStack = []; // 上下文栈
  const seenNodeIds = new Set(); // 节点 ID 去重

  for (let line of lines) {
    // 1. 多页：page "标题" {
    const pageMatch = line.match(/^page\s+"([^"]+)"\s*\{/);
    if (pageMatch) {
      result.hasMultiPage = true;
      const page = {
        title: pageMatch[1],
        nodes: [],
        edges: [],
        groups: [],
        subgraphs: [],
        legend: []
      };
      result.pages.push(page);
      contextStack.push(currentContext);
      currentContext = page;
      seenNodeIds.clear(); // 重置节点 ID 追踪（每个页面有独立的命名空间）
      continue;
    }

    // 2. 子图：subgraph ID "标题" {
    const subgraphMatch = line.match(/^subgraph\s+(\w+)\s+"([^"]+)"\s*\{/);
    if (subgraphMatch) {
      const [, id, title] = subgraphMatch;
      const subgraph = { id, title, nodes: [], edges: [] };
      currentContext.subgraphs.push(subgraph);
      contextStack.push(currentContext);
      currentContext = subgraph;
      continue;
    }

    // 3. 分组：group ID "标题" {
    const groupMatch = line.match(/^group\s+(\w+)\s+"([^"]+)"\s*\{/);
    if (groupMatch) {
      const [, id, title] = groupMatch;
      inGroup = { id, title, members: [] };
      continue;
    }

    // 4. 图例：legend {
    if (line === 'legend {') {
      inLegend = true;
      continue;
    }

    // 5. 闭合：}
    if (line === '}') {
      if (inGroup) {
        currentContext.groups.push(inGroup);
        inGroup = null;
      } else if (inLegend) {
        inLegend = false;
      } else if (contextStack.length > 0) {
        currentContext = contextStack.pop();
      }
      continue;
    }

    // 6. 节点：node ID "文本" 形状 [颜色]
    const nodeMatch = line.match(/^node\s+(\w+)\s+"([^"]*)"\s+(\w+)(?:\s+(\w+))?/);
    if (nodeMatch) {
      const [, id, label, shape, color = 'gray'] = nodeMatch;

      // 检测 ID 重复
      if (seenNodeIds.has(id)) {
        console.warn(`[DrawioLite] 警告：节点 ID "${id}" 重复，可能导致连接错误`);
      }
      seenNodeIds.add(id);

      // 检测空标签
      if (!label || label.trim() === '') {
        console.warn(`[DrawioLite] 警告：节点 "${id}" 标签为空`);
      }

      currentContext.nodes.push({ id, label: label || id, shape, color });
      continue;
    }

    // 7. 连接：A -> B ["标签"]  或 S1.A -> S2.B "跨子图"
    const edgeMatch = line.match(/^([\w.]+)\s*->\s*([\w.]+)(?:\s+"([^"]+)")?/);
    if (edgeMatch) {
      const [, from, to, label = ''] = edgeMatch;
      currentContext.edges.push({ from, to, label });
      continue;
    }

    // 8. 分组成员：A, B, C
    if (inGroup && line.match(/^[\w\s,]+$/)) {
      const members = line.split(',').map(m => m.trim()).filter(m => m);
      inGroup.members.push(...members);
      continue;
    }

    // 9. 图例项：形状 颜色 "说明"
    if (inLegend) {
      const legendMatch = line.match(/^(\w+)\s+(\w+)\s+"([^"]+)"/);
      if (legendMatch) {
        const [, shape, color, text] = legendMatch;
        currentContext.legend.push({ shape, color, text });
      }
      continue;
    }
  }

  return result;
}

/**
 * 生成单个图表页面的 XML
 */
function generatePageXml(pageData, pageId, cellIdStart) {
  const { nodes, edges, groups, subgraphs, legend } = pageData;
  let cellId = cellIdStart;
  const nodeIdMap = new Map();

  let xml = '';

  // 0. 预处理：识别哪些节点属于 group
  const nodeToGroup = new Map(); // 节点ID -> group ID
  groups.forEach(group => {
    group.members.forEach(memberId => {
      nodeToGroup.set(memberId, group.id);
    });
  });

  // 1. 处理子图（并列布局）
  if (subgraphs.length > 0) {
    let offsetX = 50;
    subgraphs.forEach(subgraph => {
      // 子图容器
      const containerCellId = cellId++;
      xml += `        <mxCell id="${containerCellId}" value="${escapeXml(subgraph.title)}" style="swimlane;fontStyle=1;align=center;verticalAlign=top;startSize=30;fillColor=#F7F9FC;strokeColor=#2C3E50;fontSize=14;fontFamily=Arial;" vertex="1" parent="${pageId}">
          <mxGeometry x="${offsetX}" y="50" width="300" height="400" as="geometry"/>
        </mxCell>
`;

      // 子图内的节点
      let nodeY = 80;
      subgraph.nodes.forEach(node => {
        const { id, label, shape, color } = node;

        // 颜色 fallback 检查
        if (!COLOR_PRESETS[color]) {
          console.warn(`[DrawioLite] 未知颜色 "${color}"，使用默认 gray`);
        }
        const colors = COLOR_PRESETS[color] || COLOR_PRESETS.gray;

        // 形状 fallback 检查
        if (!SHAPE_PRESETS[shape]) {
          console.warn(`[DrawioLite] 未知形状 "${shape}"，使用默认 rect`);
        }
        const shapeStyle = SHAPE_PRESETS[shape] || SHAPE_PRESETS.rect;

        const style = `${shapeStyle};fillColor=${colors.fill};strokeColor=${colors.stroke};strokeWidth=2;fontSize=12;fontFamily=Arial;`;

        const mxCellId = cellId++;
        nodeIdMap.set(`${subgraph.id}.${id}`, mxCellId);
        nodeIdMap.set(id, mxCellId); // 也支持简写

        const width = shape === 'diamond' ? 140 : 120;
        const height = shape === 'diamond' ? 100 : 60;

        xml += `        <mxCell id="${mxCellId}" value="${escapeXml(label)}" style="${style}" vertex="1" parent="${containerCellId}">
          <mxGeometry x="80" y="${nodeY}" width="${width}" height="${height}" as="geometry"/>
        </mxCell>
`;
        nodeY += height + 60;
      });

      // 子图内的连接
      subgraph.edges.forEach(edge => {
        const { from, to, label } = edge;
        const sourceId = nodeIdMap.get(from) || nodeIdMap.get(`${subgraph.id}.${from}`);
        const targetId = nodeIdMap.get(to) || nodeIdMap.get(`${subgraph.id}.${to}`);

        if (!sourceId || !targetId) {
          console.warn(`[DrawioLite] 跳过无效连接: ${from} -> ${to}`);
          return;
        }

        const mxCellId = cellId++;
        const style = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#2C3E50;strokeWidth=2;fontSize=10;fontFamily=Arial;endArrow=classicBlock;';

        xml += `        <mxCell id="${mxCellId}" value="${escapeXml(label)}" style="${style}" edge="1" parent="${pageId}" source="${sourceId}" target="${targetId}">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
`;
      });

      offsetX += 350; // 下一个子图的横向偏移
    });
  } else {
    // 2. 普通节点（无子图）- 使用改进的初始布局

    // 2.1 先创建 group 容器（如果有）
    const groupContainers = new Map(); // group ID -> 容器 mxCell ID
    groups.forEach(group => {
      const containerCellId = cellId++;
      groupContainers.set(group.id, containerCellId);

      // 创建 group 容器（初始尺寸，后面会调整）
      xml += `        <mxCell id="${containerCellId}" value="${escapeXml(group.title)}" style="swimlane;fontStyle=0;align=center;verticalAlign=top;startSize=30;fillColor=#F7F9FC;strokeColor=#2C3E50;fontSize=12;fontFamily=Arial;" vertex="1" parent="${pageId}">
          <mxGeometry x="50" y="50" width="400" height="300" as="geometry"/>
        </mxCell>
`;
    });

    // 2.2 渲染节点
    let nodeX = 80;  // 初始 X 坐标
    let nodeY = 80;  // 初始 Y 坐标
    const columnWidth = 200;  // 每列的宽度
    const rowHeight = 140;    // 每行的高度
    const nodesPerRow = 4;    // 每行最多节点数

    // 按 group 分组节点
    const groupedNodes = new Map(); // group ID -> nodes[]
    const ungroupedNodes = [];

    nodes.forEach(node => {
      const groupId = nodeToGroup.get(node.id);
      if (groupId) {
        if (!groupedNodes.has(groupId)) {
          groupedNodes.set(groupId, []);
        }
        groupedNodes.get(groupId).push(node);
      } else {
        ungroupedNodes.push(node);
      }
    });

    // 2.3 渲染不属于 group 的节点
    ungroupedNodes.forEach((node, index) => {
      const { id, label, shape, color } = node;

      // 颜色 fallback 检查
      if (!COLOR_PRESETS[color]) {
        console.warn(`[DrawioLite] 未知颜色 "${color}"，使用默认 gray`);
      }
      const colors = COLOR_PRESETS[color] || COLOR_PRESETS.gray;

      // 形状 fallback 检查
      if (!SHAPE_PRESETS[shape]) {
        console.warn(`[DrawioLite] 未知形状 "${shape}"，使用默认 rect`);
      }
      const shapeStyle = SHAPE_PRESETS[shape] || SHAPE_PRESETS.rect;

      const style = `${shapeStyle};fillColor=${colors.fill};strokeColor=${colors.stroke};strokeWidth=2;fontSize=12;fontFamily=Arial;`;

      const mxCellId = cellId++;
      nodeIdMap.set(id, mxCellId);

      const width = shape === 'diamond' ? 140 : 120;
      const height = shape === 'diamond' ? 100 : 60;

      // 计算当前节点的位置（网格布局）
      const row = Math.floor(index / nodesPerRow);
      const col = index % nodesPerRow;
      const x = nodeX + col * columnWidth;
      const y = nodeY + row * rowHeight;

      xml += `        <mxCell id="${mxCellId}" value="${escapeXml(label)}" style="${style}" vertex="1" parent="${pageId}">
          <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/>
        </mxCell>
`;
    });

    // 2.4 渲染属于 group 的节点（相对于容器坐标）
    groups.forEach(group => {
      const groupNodes = groupedNodes.get(group.id) || [];
      const containerCellId = groupContainers.get(group.id);

      let groupNodeY = 60; // 起始Y（容器内相对坐标，标题下方）

      groupNodes.forEach(node => {
        const { id, label, shape, color } = node;

        // 颜色 fallback 检查
        if (!COLOR_PRESETS[color]) {
          console.warn(`[DrawioLite] 未知颜色 "${color}"，使用默认 gray`);
        }
        const colors = COLOR_PRESETS[color] || COLOR_PRESETS.gray;

        // 形状 fallback 检查
        if (!SHAPE_PRESETS[shape]) {
          console.warn(`[DrawioLite] 未知形状 "${shape}"，使用默认 rect`);
        }
        const shapeStyle = SHAPE_PRESETS[shape] || SHAPE_PRESETS.rect;

        const style = `${shapeStyle};fillColor=${colors.fill};strokeColor=${colors.stroke};strokeWidth=2;fontSize=12;fontFamily=Arial;`;

        const mxCellId = cellId++;
        nodeIdMap.set(id, mxCellId);

        const width = shape === 'diamond' ? 140 : 120;
        const height = shape === 'diamond' ? 100 : 60;

        xml += `        <mxCell id="${mxCellId}" value="${escapeXml(label)}" style="${style}" vertex="1" parent="${containerCellId}">
          <mxGeometry x="80" y="${groupNodeY}" width="${width}" height="${height}" as="geometry"/>
        </mxCell>
`;
        groupNodeY += height + 60;
      });
    });

    // 3. 连接（包括跨子图连接）
    edges.forEach(edge => {
      const { from, to, label } = edge;
      const sourceId = nodeIdMap.get(from);
      const targetId = nodeIdMap.get(to);

      if (!sourceId || !targetId) {
        console.warn(`[DrawioLite] 跳过无效连接: ${from} -> ${to}`);
        return;
      }

      const mxCellId = cellId++;
      const style = 'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#2C3E50;strokeWidth=2;fontSize=10;fontFamily=Arial;endArrow=classicBlock;';

      xml += `        <mxCell id="${mxCellId}" value="${escapeXml(label)}" style="${style}" edge="1" parent="${pageId}" source="${sourceId}" target="${targetId}">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
`;
    });
  }

  // 4. 图例 - 动态计算位置避免重叠
  if (legend.length > 0) {
    // 估算图表的最大范围
    let maxX = 0;

    if (subgraphs.length > 0) {
      // 有子图：每个子图宽度约350px
      maxX = 100 + subgraphs.length * 350;
    } else {
      // 网格布局：4列 * 200px列宽 + 节点宽度 + 起始X
      const numNodes = nodes.length;
      const nodesPerRow = 4;
      const columnWidth = 200;
      const maxNodeWidth = 140; // diamond 最宽
      maxX = 80 + Math.min(numNodes, nodesPerRow) * columnWidth + maxNodeWidth;
    }

    // 图例放在图表右侧，留100px间距
    const legendX = maxX + 100;
    const legendY = 80; // 与节点起始Y对齐

    legend.forEach((item, index) => {
      const { shape, color, text } = item;

      // 图例项验证
      if (!COLOR_PRESETS[color]) {
        console.warn(`[DrawioLite] 图例中未知颜色 "${color}"，使用默认 gray`);
      }
      if (!SHAPE_PRESETS[shape]) {
        console.warn(`[DrawioLite] 图例中未知形状 "${shape}"，使用默认 rect`);
      }

      const colors = COLOR_PRESETS[color] || COLOR_PRESETS.gray;
      const shapeStyle = SHAPE_PRESETS[shape] || SHAPE_PRESETS.rect;
      const yOffset = index * 40;

      const shapeCellId = cellId++;
      xml += `        <mxCell id="${shapeCellId}" value="" style="${shapeStyle};fillColor=${colors.fill};strokeColor=${colors.stroke};strokeWidth=2;" vertex="1" parent="${pageId}">
          <mxGeometry x="${legendX}" y="${legendY + yOffset}" width="30" height="30" as="geometry"/>
        </mxCell>
`;

      const textCellId = cellId++;
      xml += `        <mxCell id="${textCellId}" value="${escapeXml(text)}" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;whiteSpace=wrap;fontSize=10;fontFamily=Arial;" vertex="1" parent="${pageId}">
          <mxGeometry x="${legendX + 40}" y="${legendY + yOffset}" width="150" height="30" as="geometry"/>
        </mxCell>
`;
    });
  }

  return { xml, nextCellId: cellId };
}

/**
 * 将 DrawioLite AST 转换为 Draw.io XML
 */
export function drawioLiteToXml(ast) {
  const { pages, hasMultiPage } = ast;

  let xml = '<mxfile>\n';
  let cellId = 2;

  if (hasMultiPage && pages.length > 0) {
    // 多页模式
    pages.forEach((page, index) => {
      const pageId = `page-${index + 1}`;
      xml += `  <diagram id="${pageId}" name="${escapeXml(page.title)}">
    <mxGraphModel dx="1422" dy="794" grid="1" gridSize="10">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
`;
      const result = generatePageXml(page, '1', cellId);
      xml += result.xml;
      cellId = result.nextCellId;

      xml += `      </root>
    </mxGraphModel>
  </diagram>
`;
    });
  } else {
    // 单页模式
    xml += `  <diagram id="drawio-lite-diagram" name="Page-1">
    <mxGraphModel dx="1422" dy="794" grid="1" gridSize="10">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
`;
    const result = generatePageXml(ast, '1', cellId);
    xml += result.xml;

    xml += `      </root>
    </mxGraphModel>
  </diagram>
`;
  }

  xml += '</mxfile>';
  return xml;
}

/**
 * XML 特殊字符转义
 */
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 验证 AST 的有效性
 * @param {Object} ast - 解析后的抽象语法树
 * @returns {Object} { valid: boolean, warnings: string[] }
 */
function validateAST(ast) {
  const warnings = [];

  // 检查是否有内容（包括多页图表）
  let totalNodes = ast.nodes.length + ast.subgraphs.reduce((sum, sg) => sum + sg.nodes.length, 0);
  let totalEdges = ast.edges.length + ast.subgraphs.reduce((sum, sg) => sum + sg.edges.length, 0);

  // 如果是多页图表，统计所有页面的节点和边
  if (ast.hasMultiPage && ast.pages) {
    ast.pages.forEach(page => {
      totalNodes += page.nodes.length + page.subgraphs.reduce((sum, sg) => sum + sg.nodes.length, 0);
      totalEdges += page.edges.length + page.subgraphs.reduce((sum, sg) => sum + sg.edges.length, 0);
    });
  }

  if (totalNodes === 0) {
    warnings.push('图表中没有节点');
  }

  if (totalEdges === 0 && totalNodes > 1) {
    warnings.push('图表中没有连接线，节点可能孤立');
  }

  // 检查连接密度（对多页图表放宽要求）
  if (totalNodes > 0) {
    const ratio = totalEdges / totalNodes;
    const threshold = ast.hasMultiPage ? 0.1 : 0.3; // 多页图表连接密度要求更低
    if (ratio < threshold) {
      warnings.push(`连接密度过低 (${ratio.toFixed(2)})，建议增加连接`);
    }
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * 主转换函数：DrawioLite → Draw.io XML（带自动布局）
 */
export function convertDrawioLite(dslText) {
  try {
    console.log('[DrawioLite] 🎯 开始解析 DSL...');

    const ast = parseDrawioLite(dslText);
    console.log('[DrawioLite] ✅ 解析完成:', ast);

    // 验证 AST
    const validation = validateAST(ast);
    if (validation.warnings.length > 0) {
      console.warn('[DrawioLite] ⚠️ 发现问题:', validation.warnings.join('; '));
    }

    let xml = drawioLiteToXml(ast);
    console.log('[DrawioLite] ✅ XML 生成完成');

    // 应用 Dagre 自动布局（现已支持多页图表）
    if (typeof window !== 'undefined' && window.DrawioLayoutOptimizer) {
      console.log('[DrawioLite] 🎨 应用自动布局优化（多页支持）...');
      xml = window.DrawioLayoutOptimizer.optimizeDrawioLayout(xml, {
        dagreLayout: true,     // 使用 Dagre 算法
        gridAlignment: true,   // 网格对齐
        connections: true,     // 连接优化
        spacing: false,        // 禁用间距优化（Dagre 已处理）
        styles: false,         // 保留 DSL 定义的颜色
        layoutDirection: 'TB'  // 使用 TB（从上到下）布局，更紧凑
      });
      console.log('[DrawioLite] ✅ 布局优化完成');
    } else {
      console.warn('[DrawioLite] ⚠️ DrawioLayoutOptimizer 未加载，跳过布局优化');
    }

    return xml;

  } catch (error) {
    console.error('[DrawioLite] ❌ 转换失败:', error);
    throw error;
  }
}

export const DrawioLiteParser = {
  parseDrawioLite,
  drawioLiteToXml,
  convertDrawioLite
};

// 向后兼容：暴露到 window
if (typeof window !== 'undefined') {
  window.DrawioLiteParser = DrawioLiteParser;
  console.log('[DrawioLite] ✅ Parser 已加载（v1.1.0 - 支持复杂多图）');
}
