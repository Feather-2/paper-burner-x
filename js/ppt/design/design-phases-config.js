/**
 * Design Phases Configuration
 *
 * 统一管理设计阶段标签、进度权重、状态映射
 * 替代 ppt_dashboard_page_layout.js 中的硬编码
 */

/**
 * 设计阶段配置
 */
export const DESIGN_PHASES_CONFIG = Object.freeze({
  idle: {
    label: '待开始',
    labelEn: 'Idle',
    weight: 0,
    order: 0,
  },
  outline_parsing: {
    label: '解析大纲',
    labelEn: 'Parsing Outline',
    weight: 5,
    order: 1,
  },
  outline_confirming: {
    label: '确认大纲',
    labelEn: 'Confirming Outline',
    weight: 5,
    order: 2,
  },
  style_extracting: {
    label: '提取风格',
    labelEn: 'Extracting Style',
    weight: 10,
    order: 3,
  },
  style_confirming: {
    label: '确认风格',
    labelEn: 'Confirming Style',
    weight: 5,
    order: 4,
  },
  generating: {
    label: '生成页面',
    labelEn: 'Generating Pages',
    weight: 40,
    order: 5,
  },
  generating_paused: {
    label: '生成暂停',
    labelEn: 'Generation Paused',
    weight: 40,
    order: 5,
  },
  reviewing: {
    label: '质量审阅',
    labelEn: 'Quality Review',
    weight: 10,
    order: 6,
  },
  fixing: {
    label: '修复页面',
    labelEn: 'Fixing Pages',
    weight: 10,
    order: 7,
  },
  visual_filling: {
    label: '填充视觉',
    labelEn: 'Visual Filling',
    weight: 10,
    order: 8,
  },
  completed: {
    label: '设计完成',
    labelEn: 'Completed',
    weight: 5,
    order: 9,
  },
  failed: {
    label: '设计失败',
    labelEn: 'Failed',
    weight: 0,
    order: 10,
  },
  editing: {
    label: '编辑模式',
    labelEn: 'Editing',
    weight: 0,
    order: 11,
  },
});

/**
 * 获取阶段顺序列表（用于进度条）
 */
export function getDesignPhaseOrder() {
  return Object.entries(DESIGN_PHASES_CONFIG)
    .filter(([key]) => !['idle', 'failed', 'editing'].includes(key))
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, config]) => ({ key, ...config }));
}

/**
 * 计算设计进度百分比
 * @param {string} currentPhase - 当前阶段
 * @param {number} currentSlide - 当前完成的 slide 数
 * @param {number} totalSlides - 总 slide 数
 * @returns {number} 0-100 的进度值
 */
export function calculateDesignProgress(currentPhase, currentSlide = 0, totalSlides = 0) {
  const phases = getDesignPhaseOrder();
  const currentConfig = DESIGN_PHASES_CONFIG[currentPhase];

  if (!currentConfig) return 0;
  if (currentPhase === 'completed') return 100;
  if (currentPhase === 'failed') return 0;

  let baseProgress = 0;
  for (const phase of phases) {
    if (phase.key === currentPhase) break;
    baseProgress += phase.weight;
  }

  if (currentPhase === 'generating' && totalSlides > 0) {
    const slideProgress = (currentSlide / totalSlides) * currentConfig.weight;
    return Math.min(Math.round(baseProgress + slideProgress), 99);
  }

  return Math.min(Math.round(baseProgress), 99);
}

/**
 * 获取阶段标签
 */
export function getDesignPhaseLabel(phase, lang = 'zh') {
  const config = DESIGN_PHASES_CONFIG[phase];
  if (!config) return phase;
  return lang === 'en' ? config.labelEn : config.label;
}

/**
 * 判断阶段是否为终态
 */
export function isDesignPhaseTerminal(phase) {
  return ['completed', 'failed', 'editing'].includes(phase);
}

export default DESIGN_PHASES_CONFIG;
