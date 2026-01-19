/**
 * Structured Plan Types - 结构化规划输出
 *
 * 提供 Agent 规划阶段的结构化输出类型，用于可解析的规划结果。
 * 参考 Claude Code Plan Agent 设计。
 */

import { isPlainObject, toNonEmptyString } from '../../shared/index.js';

/**
 * @typedef {Object} Requirement
 * @property {string} id - 需求 ID
 * @property {'functional' | 'non_functional' | 'constraint'} type - 需求类型
 * @property {string} description - 需求描述
 * @property {'must_have' | 'should_have' | 'nice_to_have'} priority - 优先级
 * @property {string[]} [acceptanceCriteria] - 验收标准
 */

/**
 * @typedef {Object} RequirementsAnalysis
 * @property {Requirement[]} functional - 功能需求
 * @property {Requirement[]} nonFunctional - 非功能需求
 * @property {string[]} assumptions - 假设条件
 * @property {string[]} clarifications - 需要澄清的问题
 * @property {string[]} outOfScope - 超出范围的内容
 */

/**
 * @typedef {Object} ArchitecturalDecision
 * @property {string} id - 决策 ID
 * @property {string} title - 决策标题
 * @property {string} context - 背景描述
 * @property {string} decision - 决策内容
 * @property {string} rationale - 决策理由
 * @property {string[]} alternatives - 备选方案
 * @property {string[]} tradeoffs - 权衡点
 * @property {string[]} consequences - 后果
 */

/**
 * @typedef {Object} PlanStep
 * @property {string} stepId - 步骤 ID
 * @property {string} title - 步骤标题
 * @property {string} description - 详细描述
 * @property {'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed'} status - 状态
 * @property {string[]} dependencies - 依赖的步骤 ID
 * @property {'low' | 'medium' | 'high'} complexity - 复杂度
 * @property {string[]} files - 涉及的文件
 * @property {string[]} tools - 需要的工具
 * @property {string[]} outputs - 预期产出
 */

/**
 * @typedef {Object} Risk
 * @property {string} id - 风险 ID
 * @property {'technical' | 'scope' | 'resource' | 'schedule' | 'external'} category - 风险类别
 * @property {string} description - 风险描述
 * @property {'low' | 'medium' | 'high' | 'critical'} severity - 严重程度
 * @property {'low' | 'medium' | 'high'} likelihood - 发生概率
 * @property {string} mitigation - 缓解措施
 * @property {string} [contingency] - 应急计划
 */

/**
 * @typedef {Object} CriticalFile
 * @property {string} path - 文件路径
 * @property {'create' | 'modify' | 'delete' | 'review'} action - 操作类型
 * @property {string} reason - 原因说明
 * @property {string[]} [changes] - 预期变更
 */

/**
 * @typedef {Object} StructuredPlan
 * @property {string} schemaVersion - 模式版本
 * @property {string} planId - 计划 ID
 * @property {string} title - 计划标题
 * @property {string} summary - 摘要
 * @property {string} createdAt - 创建时间
 * @property {RequirementsAnalysis} requirements - 需求分析
 * @property {ArchitecturalDecision[]} decisions - 架构决策
 * @property {PlanStep[]} steps - 实施步骤
 * @property {Risk[]} risks - 风险评估
 * @property {CriticalFile[]} criticalFiles - 关键文件
 * @property {Record<string, unknown>} [meta] - 元数据 (扩展字段)
 */

export const STRUCTURED_PLAN_SCHEMA_VERSION = '1.0';

/**
 * 创建空的需求分析结构
 * @returns {RequirementsAnalysis}
 */
export function createRequirementsAnalysis() {
  return {
    functional: [],
    nonFunctional: [],
    assumptions: [],
    clarifications: [],
    outOfScope: [],
  };
}

/**
 * 创建需求项
 * @param {Partial<Requirement>} input
 * @returns {Requirement}
 */
export function createRequirement(input = {}) {
  const i = isPlainObject(input) ? input : {};
  return {
    id: toNonEmptyString(i.id) || `req_${Date.now()}`,
    type: ['functional', 'non_functional', 'constraint'].includes(i.type) ? i.type : 'functional',
    description: toNonEmptyString(i.description) || '',
    priority: ['must_have', 'should_have', 'nice_to_have'].includes(i.priority) ? i.priority : 'should_have',
    acceptanceCriteria: Array.isArray(i.acceptanceCriteria) ? i.acceptanceCriteria.filter(s => typeof s === 'string') : [],
  };
}

/**
 * 创建架构决策
 * @param {Partial<ArchitecturalDecision>} input
 * @returns {ArchitecturalDecision}
 */
export function createArchitecturalDecision(input = {}) {
  const i = isPlainObject(input) ? input : {};
  return {
    id: toNonEmptyString(i.id) || `adr_${Date.now()}`,
    title: toNonEmptyString(i.title) || '',
    context: toNonEmptyString(i.context) || '',
    decision: toNonEmptyString(i.decision) || '',
    rationale: toNonEmptyString(i.rationale) || '',
    alternatives: Array.isArray(i.alternatives) ? i.alternatives.filter(s => typeof s === 'string') : [],
    tradeoffs: Array.isArray(i.tradeoffs) ? i.tradeoffs.filter(s => typeof s === 'string') : [],
    consequences: Array.isArray(i.consequences) ? i.consequences.filter(s => typeof s === 'string') : [],
  };
}

/**
 * 创建计划步骤
 * @param {Partial<PlanStep>} input
 * @param {{ fallbackIndex?: number }} [options]
 * @returns {PlanStep}
 */
export function createPlanStep(input = {}, { fallbackIndex = 0 } = {}) {
  const i = isPlainObject(input) ? input : {};
  const validStatuses = ['pending', 'in_progress', 'completed', 'skipped', 'failed'];
  const validComplexities = ['low', 'medium', 'high'];

  return {
    stepId: toNonEmptyString(i.stepId) || `step_${fallbackIndex + 1}`,
    title: toNonEmptyString(i.title) || '',
    description: toNonEmptyString(i.description) || '',
    status: validStatuses.includes(i.status) ? i.status : 'pending',
    dependencies: Array.isArray(i.dependencies) ? i.dependencies.filter(s => typeof s === 'string') : [],
    complexity: validComplexities.includes(i.complexity) ? i.complexity : 'medium',
    files: Array.isArray(i.files) ? i.files.filter(s => typeof s === 'string') : [],
    tools: Array.isArray(i.tools) ? i.tools.filter(s => typeof s === 'string') : [],
    outputs: Array.isArray(i.outputs) ? i.outputs.filter(s => typeof s === 'string') : [],
  };
}

/**
 * 创建风险项
 * @param {Partial<Risk>} input
 * @returns {Risk}
 */
export function createRisk(input = {}) {
  const i = isPlainObject(input) ? input : {};
  const validCategories = ['technical', 'scope', 'resource', 'schedule', 'external'];
  const validSeverities = ['low', 'medium', 'high', 'critical'];
  const validLikelihoods = ['low', 'medium', 'high'];

  return {
    id: toNonEmptyString(i.id) || `risk_${Date.now()}`,
    category: validCategories.includes(i.category) ? i.category : 'technical',
    description: toNonEmptyString(i.description) || '',
    severity: validSeverities.includes(i.severity) ? i.severity : 'medium',
    likelihood: validLikelihoods.includes(i.likelihood) ? i.likelihood : 'medium',
    mitigation: toNonEmptyString(i.mitigation) || '',
    ...(toNonEmptyString(i.contingency) ? { contingency: toNonEmptyString(i.contingency) } : {}),
  };
}

/**
 * 创建关键文件项
 * @param {Partial<CriticalFile>} input
 * @returns {CriticalFile}
 */
export function createCriticalFile(input = {}) {
  const i = isPlainObject(input) ? input : {};
  const validActions = ['create', 'modify', 'delete', 'review'];

  return {
    path: toNonEmptyString(i.path) || '',
    action: validActions.includes(i.action) ? i.action : 'modify',
    reason: toNonEmptyString(i.reason) || '',
    ...(Array.isArray(i.changes) ? { changes: i.changes.filter(s => typeof s === 'string') } : {}),
  };
}

/**
 * 创建结构化计划
 * @param {Partial<StructuredPlan>} input
 * @returns {StructuredPlan}
 */
export function createStructuredPlan(input = {}) {
  const i = isPlainObject(input) ? input : {};
  const now = new Date().toISOString();

  return {
    schemaVersion: STRUCTURED_PLAN_SCHEMA_VERSION,
    planId: toNonEmptyString(i.planId) || `plan_${Date.now()}`,
    title: toNonEmptyString(i.title) || 'Implementation Plan',
    summary: toNonEmptyString(i.summary) || '',
    createdAt: toNonEmptyString(i.createdAt) || now,
    requirements: isPlainObject(i.requirements) ? normalizeRequirementsAnalysis(i.requirements) : createRequirementsAnalysis(),
    decisions: Array.isArray(i.decisions) ? i.decisions.map(d => createArchitecturalDecision(d)) : [],
    steps: Array.isArray(i.steps) ? i.steps.map((s, idx) => createPlanStep(s, { fallbackIndex: idx })) : [],
    risks: Array.isArray(i.risks) ? i.risks.map(r => createRisk(r)) : [],
    criticalFiles: Array.isArray(i.criticalFiles) ? i.criticalFiles.map(f => createCriticalFile(f)) : [],
    ...(isPlainObject(i.meta) ? { meta: i.meta } : {}),
  };
}

/**
 * 规范化需求分析
 * @param {any} input
 * @returns {RequirementsAnalysis}
 */
function normalizeRequirementsAnalysis(input) {
  const i = isPlainObject(input) ? input : {};
  return {
    functional: Array.isArray(i.functional) ? i.functional.map(r => createRequirement({ ...r, type: 'functional' })) : [],
    nonFunctional: Array.isArray(i.nonFunctional) ? i.nonFunctional.map(r => createRequirement({ ...r, type: 'non_functional' })) : [],
    assumptions: Array.isArray(i.assumptions) ? i.assumptions.filter(s => typeof s === 'string') : [],
    clarifications: Array.isArray(i.clarifications) ? i.clarifications.filter(s => typeof s === 'string') : [],
    outOfScope: Array.isArray(i.outOfScope) ? i.outOfScope.filter(s => typeof s === 'string') : [],
  };
}

/**
 * 验证结构化计划
 * @param {any} plan
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStructuredPlan(plan) {
  const errors = [];

  if (!isPlainObject(plan)) {
    return { valid: false, errors: ['Plan must be an object'] };
  }

  if (!toNonEmptyString(plan.planId)) {
    errors.push('planId is required');
  }

  if (!toNonEmptyString(plan.title)) {
    errors.push('title is required');
  }

  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push('At least one step is required');
  }

  // 验证步骤依赖
  if (Array.isArray(plan.steps)) {
    const stepIds = new Set(plan.steps.map(s => s?.stepId));
    for (const step of plan.steps) {
      if (Array.isArray(step?.dependencies)) {
        for (const dep of step.dependencies) {
          if (!stepIds.has(dep)) {
            errors.push(`Step ${step.stepId} has unknown dependency: ${dep}`);
          }
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown 渲染辅助函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 转义 Markdown 特殊字符，防止 XSS 与格式破坏。
 * @private
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeMarkdown(text) {
  if (typeof text !== 'string') return '';
  // 转义 Markdown 特殊字符：\ ` * _ { } [ ] ( ) # + - . ! | < >
  return text.replace(/([\\`*_{}[\]()#+\-.!|<>])/g, '\\$1');
}

/**
 * 转义 Markdown 表格单元格内容。
 * @private
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
 */
function escapeTableCell(text) {
  if (typeof text !== 'string') return '';
  // 表格中需要转义 | 和换行
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * 渲染需求分析 Markdown。
 * @private
 * @param {RequirementsAnalysis} req - 需求分析对象
 * @returns {string[]} Markdown 行数组
 */
function renderRequirements(req) {
  const lines = [];
  if (!req?.functional?.length && !req?.nonFunctional?.length) return lines;

  lines.push('## Requirements');
  lines.push('');

  if (req.functional?.length) {
    lines.push('### Functional');
    for (const r of req.functional) {
      lines.push(`- **[${escapeMarkdown(r.priority)}]** ${escapeMarkdown(r.description)}`);
      if (r.acceptanceCriteria?.length) {
        for (const ac of r.acceptanceCriteria) {
          lines.push(`  - ${escapeMarkdown(ac)}`);
        }
      }
    }
    lines.push('');
  }

  if (req.nonFunctional?.length) {
    lines.push('### Non-Functional');
    for (const r of req.nonFunctional) {
      lines.push(`- **[${escapeMarkdown(r.priority)}]** ${escapeMarkdown(r.description)}`);
    }
    lines.push('');
  }

  if (req.assumptions?.length) {
    lines.push('### Assumptions');
    for (const a of req.assumptions) {
      lines.push(`- ${escapeMarkdown(a)}`);
    }
    lines.push('');
  }

  return lines;
}

/**
 * 渲染架构决策 Markdown。
 * @private
 * @param {ArchitecturalDecision[]} decisions - 决策数组
 * @returns {string[]} Markdown 行数组
 */
function renderDecisions(decisions) {
  const lines = [];
  if (!decisions?.length) return lines;

  lines.push('## Architecture Decisions');
  lines.push('');

  for (const d of decisions) {
    lines.push(`### ${escapeMarkdown(d.title)}`);
    lines.push('');
    if (d.context) lines.push(`**Context:** ${escapeMarkdown(d.context)}`);
    if (d.decision) lines.push(`**Decision:** ${escapeMarkdown(d.decision)}`);
    if (d.rationale) lines.push(`**Rationale:** ${escapeMarkdown(d.rationale)}`);
    if (d.tradeoffs?.length) {
      lines.push('**Trade-offs:**');
      for (const t of d.tradeoffs) {
        lines.push(`- ${escapeMarkdown(t)}`);
      }
    }
    lines.push('');
  }

  return lines;
}

/**
 * 渲染实施步骤 Markdown。
 * @private
 * @param {PlanStep[]} steps - 步骤数组
 * @returns {string[]} Markdown 行数组
 */
function renderSteps(steps) {
  const lines = [];
  if (!steps?.length) return lines;

  const statusIcons = { pending: 'o', in_progress: '~', completed: 'x', skipped: '-', failed: '!' };

  lines.push('## Implementation Steps');
  lines.push('');

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const icon = statusIcons[s.status] || 'o';
    lines.push(`${i + 1}. [${icon}] **${escapeMarkdown(s.title)}** [${escapeMarkdown(s.complexity)}]`);
    if (s.description) lines.push(`   ${escapeMarkdown(s.description)}`);
    if (s.files?.length) lines.push(`   Files: ${s.files.map(escapeMarkdown).join(', ')}`);
    if (s.dependencies?.length) lines.push(`   Depends on: ${s.dependencies.map(escapeMarkdown).join(', ')}`);
  }
  lines.push('');

  return lines;
}

/**
 * 渲染关键文件表格 Markdown。
 * @private
 * @param {CriticalFile[]} files - 关键文件数组
 * @returns {string[]} Markdown 行数组
 */
function renderCriticalFiles(files) {
  const lines = [];
  if (!files?.length) return lines;

  lines.push('## Critical Files');
  lines.push('');
  lines.push('| File | Action | Reason |');
  lines.push('|------|--------|--------|');

  for (const f of files) {
    lines.push(`| \`${escapeTableCell(f.path)}\` | ${escapeTableCell(f.action)} | ${escapeTableCell(f.reason)} |`);
  }
  lines.push('');

  return lines;
}

/**
 * 渲染风险 Markdown。
 * @private
 * @param {Risk[]} risks - 风险数组
 * @returns {string[]} Markdown 行数组
 */
function renderRisks(risks) {
  const lines = [];
  if (!risks?.length) return lines;

  const severityLabels = { low: 'LOW', medium: 'MED', high: 'HIGH', critical: 'CRIT' };

  lines.push('## Risks');
  lines.push('');

  for (const r of risks) {
    const label = severityLabels[r.severity] || 'MED';
    lines.push(`- [${label}] **[${escapeMarkdown(r.category)}]** ${escapeMarkdown(r.description)}`);
    if (r.mitigation) lines.push(`  - Mitigation: ${escapeMarkdown(r.mitigation)}`);
  }
  lines.push('');

  return lines;
}

/**
 * 将结构化计划转换为 Markdown。
 * @param {StructuredPlan} plan - 结构化计划对象
 * @returns {string} Markdown 字符串
 */
export function structuredPlanToMarkdown(plan) {
  const lines = [];

  lines.push(`# ${escapeMarkdown(plan.title || 'Implementation Plan')}`);
  lines.push('');

  if (plan.summary) {
    lines.push(escapeMarkdown(plan.summary));
    lines.push('');
  }

  lines.push(...renderRequirements(plan.requirements));
  lines.push(...renderDecisions(plan.decisions));
  lines.push(...renderSteps(plan.steps));
  lines.push(...renderCriticalFiles(plan.criticalFiles));
  lines.push(...renderRisks(plan.risks));

  return lines.join('\n');
}

export default {
  STRUCTURED_PLAN_SCHEMA_VERSION,
  createRequirementsAnalysis,
  createRequirement,
  createArchitecturalDecision,
  createPlanStep,
  createRisk,
  createCriticalFile,
  createStructuredPlan,
  validateStructuredPlan,
  structuredPlanToMarkdown,
};
