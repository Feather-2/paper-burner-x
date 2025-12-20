/**
 * Skill Definition Schema
 *
 * Defines the structure for Skills in agent-burner-sdk.
 * Skills are model-invoked capabilities with activation conditions.
 */

export const SkillLayer = Object.freeze({
  /** Layer 0: 浏览器原生（纯 JS，无依赖） */
  NATIVE: 0,
  /** Layer 1: Web Worker 沙盒（Wasm、并行计算） */
  WORKER: 1,
  /** Layer 2: MCP 本地工具（需 CORS 代理） */
  MCP_LOCAL: 2,
  /** Layer 3: MCP-Nexus 增强（需后端） */
  MCP_NEXUS: 3,
  /** Layer 4: 外部沙盒（E2B、Playwright） */
  EXTERNAL: 4,
});

export const SkillStatus = Object.freeze({
  REGISTERED: "registered",
  LOADING: "loading",
  READY: "ready",
  FAILED: "failed",
  DISABLED: "disabled",
});

/**
 * @typedef {Object} SkillActivation
 * @property {string[]} [keywords] - 关键词匹配（用户查询包含则激活）
 * @property {string[]} [tags] - 标签匹配（任务标签匹配则激活）
 * @property {string[]} [traits] - 特征匹配（推断特征匹配则激活）
 * @property {string[]} [phases] - 阶段匹配（特定阶段激活）
 */

/**
 * @typedef {Object} SkillRequirements
 * @property {boolean} [mcpNexus] - 是否需要 MCP-Nexus
 * @property {string[]} [mcpServers] - 需要的 MCP Server 名称
 * @property {string[]} [providers] - 需要的服务提供者
 * @property {number} [minBudget] - 最小预算要求
 */

/**
 * @typedef {Object} SkillDefinition
 * @property {string} name - 唯一标识符（如 "text.process", "web.search"）
 * @property {string} version - 版本号（semver）
 * @property {string} description - 人类可读描述
 * @property {number} layer - 能力层级（0-4）
 * @property {SkillActivation} [activation] - 激活条件
 * @property {SkillRequirements} [requires] - 依赖要求
 * @property {string} [fallback] - 降级 Skill 名称
 * @property {number} [estimatedCost] - 预估成本（0-100）
 * @property {Function} [loader] - 懒加载函数
 * @property {Function} [handler] - 直接处理函数（Layer 0 可内联）
 * @property {Object} [metadata] - 额外元数据
 */

const REQUIRED_FIELDS = ["name", "description", "layer"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidLayer(layer) {
  return typeof layer === "number" && layer >= 0 && layer <= 4;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/**
 * 验证 SkillDefinition
 * @param {SkillDefinition} definition
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSkillDefinition(definition) {
  const errors = [];

  if (!definition || typeof definition !== "object") {
    return { valid: false, errors: ["Definition must be an object"] };
  }

  // Required fields
  if (!isNonEmptyString(definition.name)) {
    errors.push("name is required and must be a non-empty string");
  }

  if (!isNonEmptyString(definition.description)) {
    errors.push("description is required and must be a non-empty string");
  }

  if (!isValidLayer(definition.layer)) {
    errors.push("layer is required and must be a number between 0 and 4");
  }

  // Optional fields validation
  if (definition.version !== undefined && !isNonEmptyString(definition.version)) {
    errors.push("version must be a non-empty string if provided");
  }

  if (definition.fallback !== undefined && !isNonEmptyString(definition.fallback)) {
    errors.push("fallback must be a non-empty string if provided");
  }

  if (definition.estimatedCost !== undefined) {
    const cost = definition.estimatedCost;
    if (typeof cost !== "number" || cost < 0 || cost > 100) {
      errors.push("estimatedCost must be a number between 0 and 100");
    }
  }

  // Activation validation
  if (definition.activation) {
    const act = definition.activation;
    if (act.keywords !== undefined && !isStringArray(act.keywords)) {
      errors.push("activation.keywords must be an array of strings");
    }
    if (act.tags !== undefined && !isStringArray(act.tags)) {
      errors.push("activation.tags must be an array of strings");
    }
    if (act.traits !== undefined && !isStringArray(act.traits)) {
      errors.push("activation.traits must be an array of strings");
    }
    if (act.phases !== undefined && !isStringArray(act.phases)) {
      errors.push("activation.phases must be an array of strings");
    }
  }

  // Requirements validation
  if (definition.requires) {
    const req = definition.requires;
    if (req.mcpNexus !== undefined && typeof req.mcpNexus !== "boolean") {
      errors.push("requires.mcpNexus must be a boolean");
    }
    if (req.mcpServers !== undefined && !isStringArray(req.mcpServers)) {
      errors.push("requires.mcpServers must be an array of strings");
    }
    if (req.providers !== undefined && !isStringArray(req.providers)) {
      errors.push("requires.providers must be an array of strings");
    }
    if (req.minBudget !== undefined && typeof req.minBudget !== "number") {
      errors.push("requires.minBudget must be a number");
    }
  }

  // Loader or handler required for non-metadata-only definitions
  if (definition.layer > 0 && !definition.loader && !definition.handler) {
    errors.push("loader or handler is required for layer > 0 skills");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 创建 SkillDefinition（带默认值）
 * @param {Partial<SkillDefinition>} input
 * @returns {SkillDefinition}
 */
export function createSkillDefinition(input) {
  const validation = validateSkillDefinition(input);
  if (!validation.valid) {
    throw new Error(`Invalid SkillDefinition: ${validation.errors.join(", ")}`);
  }

  return {
    name: input.name,
    version: input.version || "1.0.0",
    description: input.description,
    layer: input.layer,
    activation: {
      keywords: input.activation?.keywords || [],
      tags: input.activation?.tags || [],
      traits: input.activation?.traits || [],
      phases: input.activation?.phases || [],
    },
    requires: {
      mcpNexus: input.requires?.mcpNexus || false,
      mcpServers: input.requires?.mcpServers || [],
      providers: input.requires?.providers || [],
      minBudget: input.requires?.minBudget || 0,
    },
    fallback: input.fallback || null,
    estimatedCost: input.estimatedCost ?? (input.layer * 20),
    loader: input.loader || null,
    handler: input.handler || null,
    metadata: input.metadata || {},
  };
}

/**
 * 生成 Skill 目录 Prompt（供 AI 选择）
 * @param {SkillDefinition[]} skills
 * @returns {string}
 */
export function buildSkillCatalogPrompt(skills) {
  if (!Array.isArray(skills) || skills.length === 0) {
    return "No skills available.";
  }

  const lines = ["## Available Skills", ""];

  const byLayer = new Map();
  for (const skill of skills) {
    const layer = skill.layer ?? 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(skill);
  }

  const layerNames = ["Native (Browser)", "Worker (Wasm)", "MCP Local", "MCP-Nexus", "External Sandbox"];

  for (let layer = 0; layer <= 4; layer++) {
    const layerSkills = byLayer.get(layer);
    if (!layerSkills || layerSkills.length === 0) continue;

    lines.push(`### Layer ${layer}: ${layerNames[layer]}`);
    lines.push("");

    for (const skill of layerSkills) {
      lines.push(`- **${skill.name}**: ${skill.description}`);
      if (skill.activation?.keywords?.length > 0) {
        lines.push(`  - Keywords: ${skill.activation.keywords.join(", ")}`);
      }
      if (skill.fallback) {
        lines.push(`  - Fallback: ${skill.fallback}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export default {
  SkillLayer,
  SkillStatus,
  validateSkillDefinition,
  createSkillDefinition,
  buildSkillCatalogPrompt,
};
