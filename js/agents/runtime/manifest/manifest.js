/**
 * Skill/Stage Manifest - 声明式元数据系统
 *
 * 每个插件导出声明式的 Metadata（名称、版本、Schema、所需权限），
 * 支持 UI 层的快速发现与权限预审。
 *
 * 参考 agentsdk-go 的 plugin.json 设计。
 */

/**
 * Manifest 版本
 */
export const MANIFEST_VERSION = "1.0.0";

/**
 * 权限类型
 */
export const PermissionType = Object.freeze({
  READ_FILE: "read_file",       // 读取文件
  WRITE_FILE: "write_file",     // 写入文件
  EXECUTE: "execute",           // 执行命令
  NETWORK: "network",           // 网络访问
  MCP: "mcp",                   // MCP 工具调用
  LLM: "llm",                   // LLM API 调用
  USER_INPUT: "user_input",     // 用户输入
  MEMORY: "memory",             // 内存/状态访问
});

/**
 * 插件类型
 */
export const PluginType = Object.freeze({
  TOOL: "tool",           // 工具
  SKILL: "skill",         // 技能
  STAGE: "stage",         // 阶段
  MIDDLEWARE: "middleware", // 中间件
});

/**
 * @typedef {typeof PluginType[keyof typeof PluginType]} PluginTypeValue
 * @typedef {typeof PermissionType[keyof typeof PermissionType]} PermissionValue
 */

/**
 * @typedef {Object} ManifestSchema
 * @property {string} manifestVersion - Manifest 版本
 * @property {string} name - 插件名称
 * @property {string} version - 版本号 (semver)
 * @property {PluginTypeValue} type - 插件类型
 * @property {string} description - 描述
 * @property {string} [author] - 作者
 * @property {string} [license] - 许可证
 * @property {string[]} [keywords] - 关键词
 * @property {PermissionValue[]} [permissions] - 所需权限
 * @property {Object} [parameters] - 参数 JSON Schema
 * @property {Object} [output] - 输出 JSON Schema
 * @property {Object} [input] - 输入 JSON Schema（Stage）
 * @property {Object} [dependencies] - 依赖
 * @property {Object} [config] - 配置选项
 * @property {Object} [metadata] - 扩展元数据（优先级、激活条件等）
 */

/**
 * 创建 Tool Manifest
 * @param {Object} options
 * @returns {ManifestSchema}
 */
export function createToolManifest(options) {
  const {
    name,
    version = "1.0.0",
    description,
    parameters,
    output,
    permissions = [],
    keywords = [],
    priority,
    layer,
    activation,
  } = options;

  if (!name) throw new Error("Manifest requires name");
  if (!description) throw new Error("Manifest requires description");

  return {
    manifestVersion: MANIFEST_VERSION,
    type: PluginType.TOOL,
    name,
    version,
    description,
    keywords,
    permissions,
    parameters: normalizeParameterSchema(parameters),
    output: output || null,
    metadata: {
      priority: priority ?? 1,
      layer: layer ?? 0,
      activation: activation || null,
    },
  };
}

/**
 * 创建 Skill Manifest
 * @param {Object} options
 * @returns {ManifestSchema}
 */
export function createSkillManifest(options) {
  const {
    name,
    version = "1.0.0",
    description,
    keywords = [],
    keywordsAll = [],
    allowedTools,
    permissions = [],
    priority,
    scope,
    tags,
    traits,
  } = options;

  if (!name) throw new Error("Manifest requires name");
  if (!description) throw new Error("Manifest requires description");

  return {
    manifestVersion: MANIFEST_VERSION,
    type: PluginType.SKILL,
    name,
    version,
    description,
    keywords,
    permissions,
    metadata: {
      keywordsAll,
      allowedTools: allowedTools || null,
      priority: priority ?? 100,
      scope: scope || "repo",
      tags: tags || null,
      traits: traits || null,
    },
  };
}

/**
 * 创建 Stage Manifest
 * @param {Object} options
 * @returns {ManifestSchema}
 */
export function createStageManifest(options) {
  const {
    name,
    version = "1.0.0",
    description,
    permissions = [],
    dependencies = {},
    config = {},
    input,
    output,
  } = options;

  if (!name) throw new Error("Manifest requires name");
  if (!description) throw new Error("Manifest requires description");

  return {
    manifestVersion: MANIFEST_VERSION,
    type: PluginType.STAGE,
    name,
    version,
    description,
    permissions,
    dependencies,
    config,
    input: input || null,
    output: output || null,
  };
}

/**
 * 创建 Middleware Manifest
 * @param {Object} options
 * @returns {ManifestSchema}
 */
export function createMiddlewareManifest(options) {
  const {
    name,
    version = "1.0.0",
    description,
    permissions = [],
    order = 0,
    phases = ["before", "after"],
  } = options;

  if (!name) throw new Error("Manifest requires name");
  if (!description) throw new Error("Manifest requires description");

  return {
    manifestVersion: MANIFEST_VERSION,
    type: PluginType.MIDDLEWARE,
    name,
    version,
    description,
    permissions,
    metadata: {
      order,
      phases,
    },
  };
}

/**
 * 将简化参数定义转换为 JSON Schema
 */
function normalizeParameterSchema(parameters) {
  if (!parameters) return null;

  // 已经是 JSON Schema 格式
  if (parameters.type === "object" || parameters.properties) {
    return parameters;
  }

  // 简化格式转换
  const properties = {};
  const required = [];

  for (const [key, value] of Object.entries(parameters)) {
    if (typeof value === "string") {
      const isRequired = value.includes("必需") || value.includes("required");
      properties[key] = {
        type: "string",
        description: value,
      };
      if (isRequired) required.push(key);
    } else if (typeof value === "object") {
      properties[key] = value;
      if (value.required) required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

/**
 * 验证 Manifest
 * @param {ManifestSchema} manifest
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateManifest(manifest) {
  const errors = [];

  if (!manifest) {
    return { valid: false, errors: ["Manifest is null or undefined"] };
  }

  if (!manifest.name) errors.push("Missing required field: name");
  if (!manifest.type) errors.push("Missing required field: type");
  if (!manifest.description) errors.push("Missing required field: description");

  if (manifest.type && !Object.values(PluginType).includes(manifest.type)) {
    errors.push(`Invalid type: ${manifest.type}`);
  }

  if (manifest.permissions) {
    for (const perm of manifest.permissions) {
      if (!Object.values(PermissionType).includes(perm)) {
        errors.push(`Unknown permission: ${perm}`);
      }
    }
  }

  if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push(`Invalid version format: ${manifest.version}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 从 Tool definition 提取 Manifest
 * @param {Object} definition - Tool definition
 * @returns {ManifestSchema}
 */
export function extractManifestFromTool(definition) {
  if (!definition) return null;

  return createToolManifest({
    name: definition.name,
    version: "1.0.0",
    description: definition.description,
    parameters: definition.parameters,
    priority: definition.priority,
    layer: definition.layer,
    activation: definition.activation,
    permissions: inferPermissions(definition),
  });
}

/**
 * 从 Skill metadata 提取 Manifest
 * @param {Object} metadata - Skill metadata
 * @returns {ManifestSchema}
 */
export function extractManifestFromSkill(metadata) {
  if (!metadata) return null;

  return createSkillManifest({
    name: metadata.name,
    version: "1.0.0",
    description: metadata.description || metadata.shortDescription || "",
    keywords: metadata.keywords || [],
    keywordsAll: metadata.keywordsAll || [],
    allowedTools: metadata.allowedTools,
    priority: metadata.priority,
    scope: metadata.scope,
    tags: metadata.tags,
    traits: metadata.traits,
    permissions: inferSkillPermissions(metadata),
  });
}

/**
 * 推断 Tool 所需权限
 */
function inferPermissions(definition) {
  const permissions = [];
  const name = (definition.name || "").toLowerCase();
  const desc = (definition.description || "").toLowerCase();

  if (name.includes("read") || desc.includes("读取")) {
    permissions.push(PermissionType.READ_FILE);
  }
  if (name.includes("write") || desc.includes("写入") || desc.includes("创建")) {
    permissions.push(PermissionType.WRITE_FILE);
  }
  if (name.includes("search") || desc.includes("搜索") || desc.includes("网络")) {
    permissions.push(PermissionType.NETWORK);
  }
  if (name.includes("ask") || desc.includes("用户")) {
    permissions.push(PermissionType.USER_INPUT);
  }
  if (name.includes("task") || desc.includes("子任务")) {
    permissions.push(PermissionType.LLM);
  }

  return [...new Set(permissions)];
}

/**
 * 推断 Skill 所需权限
 */
function inferSkillPermissions(metadata) {
  const permissions = [];
  const allowedTools = metadata.allowedTools || "";

  if (allowedTools.includes("read")) {
    permissions.push(PermissionType.READ_FILE);
  }
  if (allowedTools.includes("write")) {
    permissions.push(PermissionType.WRITE_FILE);
  }
  if (allowedTools.includes("search") || allowedTools.includes("mcp")) {
    permissions.push(PermissionType.NETWORK);
    permissions.push(PermissionType.MCP);
  }

  return [...new Set(permissions)];
}

/**
 * Manifest Registry - 管理所有已注册的 Manifest
 */
export class ManifestRegistry {
  constructor() {
    this._manifests = new Map();
  }

  /**
   * 注册 Manifest
   */
  register(manifest) {
    const { valid, errors } = validateManifest(manifest);
    if (!valid) {
      throw new Error(`Invalid manifest: ${errors.join(", ")}`);
    }
    this._manifests.set(manifest.name, manifest);
    return this;
  }

  /**
   * 批量注册
   */
  registerAll(manifests) {
    for (const m of manifests) {
      this.register(m);
    }
    return this;
  }

  /**
   * 获取 Manifest
   */
  get(name) {
    return this._manifests.get(name) || null;
  }

  /**
   * 按类型获取
   */
  getByType(type) {
    return Array.from(this._manifests.values()).filter(m => m.type === type);
  }

  /**
   * 按权限过滤
   */
  filterByPermission(permission) {
    return Array.from(this._manifests.values()).filter(
      m => m.permissions?.includes(permission)
    );
  }

  /**
   * 获取所有 Manifest
   */
  getAll() {
    return Array.from(this._manifests.values());
  }

  /**
   * 导出为 JSON
   */
  toJSON() {
    return {
      version: MANIFEST_VERSION,
      manifests: this.getAll(),
    };
  }

  /**
   * 从 JSON 导入
   */
  static fromJSON(json) {
    const registry = new ManifestRegistry();
    if (json.manifests) {
      registry.registerAll(json.manifests);
    }
    return registry;
  }

  /**
   * 清空
   */
  clear() {
    this._manifests.clear();
  }

  /**
   * 数量
   */
  get size() {
    return this._manifests.size;
  }
}

export default {
  MANIFEST_VERSION,
  PermissionType,
  PluginType,
  createToolManifest,
  createSkillManifest,
  createStageManifest,
  createMiddlewareManifest,
  validateManifest,
  extractManifestFromTool,
  extractManifestFromSkill,
  ManifestRegistry,
};
