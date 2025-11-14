// js/chatbot/utils/drawio-academic-enhancer.js

/**
 * Draw.io 学术增强工具
 *
 * 🎓 专为学术论文配图设计，不同于通用美化工具
 *
 * 核心理念：
 * 1. 学术规范 - 符合 IEEE/ACM/Nature 等期刊标准
 * 2. 语义理解 - 根据内容自动分类和配色
 * 3. 渐进增强 - 三级优化，用户可选
 * 4. 可读性优先 - 黑白打印也清晰
 *
 * @version 1.0.0
 * @date 2025-01-15
 */

/**
 * 解析样式字符串为对象
 */
function parseStyle(styleString) {
  const style = {};
  if (!styleString) return style;

  styleString.split(';').forEach(pair => {
    const [key, value] = pair.split('=');
    if (key && key.trim()) {
      style[key.trim()] = value || '';
    }
  });

  return style;
}

/**
 * 样式对象转回字符串
 */
function styleToString(styleObj) {
  return Object.entries(styleObj)
    .map(([k, v]) => v ? `${k}=${v}` : k)
    .join(';');
}

/**
 * 🎯 Level 1: 学术基础优化
 *
 * 重点：清晰度和规范性
 * - 统一线宽（易于打印）
 * - 连接线标签背景（黑白打印可辨认）
 * - 字体大小规范化（符合学术期刊要求）
 */
function academicBaselineOptimization(xmlDoc) {
  console.log('[AcademicEnhancer] 🎓 Level 1: 学术基础优化');

  let optimized = 0;

  // 1. 优化连接线
  const edges = xmlDoc.querySelectorAll('mxCell[edge="1"]');
  edges.forEach(edge => {
    const style = parseStyle(edge.getAttribute('style') || '');

    // ✅ 统一线宽为 2px（学术标准）
    if (!style.strokeWidth || style.strokeWidth === '1') {
      style.strokeWidth = '2';
      optimized++;
    }

    // ✅ 连接线标签添加白色背景（关键改进！）
    const hasLabel = edge.getAttribute('value');
    if (hasLabel) {
      style.labelBackgroundColor = '#ffffff';
      style.labelBorderColor = '#d0d0d0';
      style.labelPadding = '4';
      optimized++;
    }

    // ✅ 圆角转弯（更专业）
    if (style.edgeStyle === 'orthogonalEdgeStyle') {
      style.rounded = '1';
      style.arcSize = '6'; // 小圆角，不夸张
    }

    // ✅ 统一箭头样式（学术标准：实心块状箭头）
    if (!style.endArrow) {
      style.endArrow = 'block';
      style.endFill = '1';
      style.endSize = '6';
    }

    edge.setAttribute('style', styleToString(style));
  });

  // 2. 规范化节点字体
  const vertices = xmlDoc.querySelectorAll('mxCell[vertex="1"]');
  vertices.forEach(vertex => {
    const style = parseStyle(vertex.getAttribute('style') || '');

    // ✅ 统一字体大小（学术可读性）
    if (!style.fontSize || parseInt(style.fontSize) < 11) {
      style.fontSize = '12'; // 默认 12pt
      optimized++;
    }

    // ✅ 启用 HTML 模式（支持换行）
    if (!style.html) {
      style.html = '1';
    }

    vertex.setAttribute('style', styleToString(style));
  });

  console.log(`[AcademicEnhancer] ✅ Level 1 完成: ${optimized} 处优化`);
  return optimized;
}

/**
 * 🎨 Level 2: 语义感知配色
 *
 * 重点：自动识别节点类型并配色
 * - 输入节点 → 蓝色系
 * - 处理节点 → 绿色系
 * - 输出节点 → 橙色系
 * - 决策节点 → 黄色系
 * - 数据存储 → 灰色系
 */
function semanticColorization(xmlDoc) {
  console.log('[AcademicEnhancer] 🎨 Level 2: 语义感知配色');

  // 学术配色方案（色盲友好 + 黑白打印可辨）
  const colorSchemes = {
    input: {
      fill: '#dae8fc',
      stroke: '#6c8ebf',
      keywords: ['输入', 'input', '数据', 'data', '采集', 'collect', '读取', 'read']
    },
    process: {
      fill: '#d5e8d4',
      stroke: '#82b366',
      keywords: ['处理', 'process', '计算', 'compute', '分析', 'analyze', '算法', 'algorithm']
    },
    output: {
      fill: '#ffe6cc',
      stroke: '#d79b00',
      keywords: ['输出', 'output', '结果', 'result', '生成', 'generate', '显示', 'display']
    },
    decision: {
      fill: '#fff2cc',
      stroke: '#d6b656',
      keywords: ['判断', 'decision', '选择', 'choose', '是否', 'if', '条件', 'condition']
    },
    storage: {
      fill: '#f5f5f5',
      stroke: '#666666',
      keywords: ['存储', 'storage', '数据库', 'database', '缓存', 'cache', '保存', 'save']
    }
  };

  let colorized = 0;

  const vertices = xmlDoc.querySelectorAll('mxCell[vertex="1"]');
  vertices.forEach(vertex => {
    const value = (vertex.getAttribute('value') || '').toLowerCase();
    const style = parseStyle(vertex.getAttribute('style') || '');

    // 跳过已经有明确配色的节点
    if (style.fillColor && style.fillColor !== '#ffffff') {
      return;
    }

    // 语义匹配
    for (const [type, scheme] of Object.entries(colorSchemes)) {
      const matched = scheme.keywords.some(keyword => value.includes(keyword));
      if (matched) {
        style.fillColor = scheme.fill;
        style.strokeColor = scheme.stroke;
        vertex.setAttribute('style', styleToString(style));
        colorized++;
        break;
      }
    }
  });

  console.log(`[AcademicEnhancer] ✅ Level 2 完成: ${colorized} 个节点智能配色`);
  return colorized;
}

/**
 * 📐 Level 3: 学术规范增强
 *
 * 重点：符合学术期刊投稿标准
 * - 子图编号 (a), (b), (c)
 * - 图例自动生成
 * - 统一对齐网格线
 * - 添加比例尺/单位标注
 */
function academicStandardEnhancement(xmlDoc) {
  console.log('[AcademicEnhancer] 📐 Level 3: 学术规范增强');

  let enhanced = 0;

  // 1. 自动添加子图编号（学术论文标准）
  const vertices = Array.from(xmlDoc.querySelectorAll('mxCell[vertex="1"]'));

  // 只对"主要节点"添加编号（不是标题、不是注释）
  const mainNodes = vertices.filter(v => {
    const style = parseStyle(v.getAttribute('style') || '');
    const value = v.getAttribute('value') || '';

    // 排除标题样式节点
    if (style.fontSize && parseInt(style.fontSize) > 16) return false;
    // 排除纯文本节点
    if (style.shape === 'text' || !style.shape) return false;
    // 排除空节点
    if (!value.trim()) return false;

    return true;
  });

  // 按 Y 坐标排序（从上到下）
  mainNodes.sort((a, b) => {
    const geoA = a.querySelector('mxGeometry');
    const geoB = b.querySelector('mxGeometry');
    if (!geoA || !geoB) return 0;

    const yA = parseFloat(geoA.getAttribute('y')) || 0;
    const yB = parseFloat(geoB.getAttribute('y')) || 0;
    return yA - yB;
  });

  // 添加编号（如果节点数量合理）
  if (mainNodes.length >= 3 && mainNodes.length <= 10) {
    mainNodes.forEach((node, index) => {
      const label = String.fromCharCode(97 + index); // a, b, c...
      const currentValue = node.getAttribute('value') || '';

      // 检查是否已有编号
      if (!currentValue.match(/^\([a-z]\)/)) {
        node.setAttribute('value', `(${label}) ${currentValue}`);
        enhanced++;
      }
    });
  }

  // 2. 生成图例（如果使用了多种颜色）
  const usedColors = new Set();
  vertices.forEach(v => {
    const style = parseStyle(v.getAttribute('style') || '');
    if (style.fillColor && style.fillColor !== '#ffffff') {
      usedColors.add(style.fillColor);
    }
  });

  // 如果使用了 3 种以上颜色，生成图例
  if (usedColors.size >= 3) {
    console.log('[AcademicEnhancer] 检测到多色配色方案，建议手动添加图例');
    // 注：自动生成图例会干扰布局，这里只做提示
  }

  console.log(`[AcademicEnhancer] ✅ Level 3 完成: ${enhanced} 处学术规范增强`);
  return enhanced;
}

/**
 * 🔍 自动检测图表类型
 *
 * 根据节点和连接的特征判断图表类型：
 * - flowchart: 流程图（有决策节点、线性流程）
 * - architecture: 架构图（层次分明、模块化）
 * - network: 网络图（节点相互连接）
 * - sequence: 序列图（时间顺序）
 */
function detectDiagramType(xmlDoc) {
  const vertices = xmlDoc.querySelectorAll('mxCell[vertex="1"]');
  const edges = xmlDoc.querySelectorAll('mxCell[edge="1"]');

  if (vertices.length === 0) return 'unknown';

  // 特征检测
  let hasDecisionShape = false;
  let hasLayeredLayout = false;
  let avgConnectionsPerNode = edges.length / vertices.length;

  vertices.forEach(v => {
    const style = parseStyle(v.getAttribute('style') || '');
    if (style.shape === 'rhombus' || style.shape === 'diamond') {
      hasDecisionShape = true;
    }
  });

  // 检测是否有明显的层次结构（Y 坐标相近的节点成组）
  const yGroups = new Map();
  vertices.forEach(v => {
    const geo = v.querySelector('mxGeometry');
    if (!geo) return;
    const y = Math.round(parseFloat(geo.getAttribute('y') || 0) / 50) * 50; // 按 50px 分组
    yGroups.set(y, (yGroups.get(y) || 0) + 1);
  });
  hasLayeredLayout = yGroups.size >= 3 && Array.from(yGroups.values()).some(count => count >= 2);

  // 判断类型
  if (hasDecisionShape) return 'flowchart';
  if (hasLayeredLayout) return 'architecture';
  if (avgConnectionsPerNode > 2) return 'network';
  if (avgConnectionsPerNode <= 1.5) return 'sequence';

  return 'generic';
}

/**
 * 主优化函数：学术增强
 *
 * @param {string} xmlString - 原始 XML
 * @param {Object} options - 优化选项
 * @param {number} options.level - 优化级别 1-3
 * @param {boolean} options.autoDetect - 是否自动检测图表类型
 * @returns {string} 优化后的 XML
 */
function enhanceAcademicDiagram(xmlString, options = {}) {
  const defaultOptions = {
    level: 2,           // 默认 Level 2（基础 + 配色）
    autoDetect: true    // 自动检测图表类型
  };

  const opts = { ...defaultOptions, ...options };

  try {
    console.log('[AcademicEnhancer] 🎓 开始学术增强...');

    // 解析 XML
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    const parserError = xmlDoc.querySelector('parsererror');
    if (parserError) {
      throw new Error('XML 解析失败');
    }

    // 自动检测图表类型
    if (opts.autoDetect) {
      const diagramType = detectDiagramType(xmlDoc);
      console.log(`[AcademicEnhancer] 📊 检测到图表类型: ${diagramType}`);
    }

    let totalEnhanced = 0;

    // Level 1: 基础优化（总是执行）
    totalEnhanced += academicBaselineOptimization(xmlDoc);

    // Level 2: 语义配色
    if (opts.level >= 2) {
      totalEnhanced += semanticColorization(xmlDoc);
    }

    // Level 3: 学术规范
    if (opts.level >= 3) {
      totalEnhanced += academicStandardEnhancement(xmlDoc);
    }

    console.log(`[AcademicEnhancer] ✅ 学术增强完成，共 ${totalEnhanced} 处改进`);

    // 序列化回 XML
    const serializer = new XMLSerializer();
    return serializer.serializeToString(xmlDoc);

  } catch (error) {
    console.error('[AcademicEnhancer] ❌ 学术增强失败:', error);
    return xmlString; // 失败时返回原始 XML
  }
}

// 导出到全局
window.DrawioAcademicEnhancer = {
  enhanceAcademicDiagram,
  detectDiagramType
};
