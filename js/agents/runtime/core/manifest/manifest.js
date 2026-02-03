/**
 * Skill/Stage Manifest - 声明式元数据系统
 *
 * 每个插件导出声明式的 Metadata（名称、版本、Schema、所需权限），
 * 支持 UI 层的快速发现与权限预审。
 */

/**
 * Manifest 版本
 */
export const MANIFEST_VERSION = "1.0.0";

/**
 * Manifest 校验错误
 * @extends Error
 */
export class ManifestValidationError extends Error {
  /**
   * @param {string} message - 错误消息
   * @param {string} [field] - 出错字段名
   */
  constructor(message, field) {
    super(message);
    this.name = "ManifestValidationError";
    /** @type {string|undefined} 出错字段 */
    this.field = field;
  }
}

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
 * 权限作用域 - 用于精细化权限控制
 * @typedef {Object} PermissionScope
 * @property {string[]} [mounts] - 允许的挂载点/目录 (用于 READ_FILE/WRITE_FILE)
 * @property {string[]} [globs] - 允许的文件模式 (如 "**\/*.md")
 * @property {string[]} [allowHosts] - 允许的主机名 (用于 NETWORK)
 * @property {boolean} [denyPrivateIp] - 是否拒绝私有 IP (用于 NETWORK)
 * @property {string[]} [allowCommands] - 允许的命令模式 (用于 EXECUTE)
 * @property {string[]} [allowTools] - 允许的 MCP 工具名 (用于 MCP)
 */

/**
 * 带作用域的权限声明
 * @typedef {Object} ScopedPermission
 * @property {PermissionValue} type - 权限类型
 * @property {PermissionScope} [scope] - 权限作用域（可选，不提供则表示完全权限）
 */

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
 * 依赖项类型
 * @typedef {'plugin' | 'service' | 'tool' | 'stage'} DependencyKind
 */

/**
 * 结构化依赖声明
 * @typedef {Object} ManifestDependency
 * @property {DependencyKind} kind - 依赖类型
 * @property {string} id - 依赖标识符
 * @property {string} [version] - 版本约束 (semver range)
 * @property {boolean} [optional] - 是否可选依赖
 */

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
 * @property {(PermissionValue | ScopedPermission)[]} [permissions] - 所需权限（字符串或带作用域对象）
 * @property {Object} [parameters] - 参数 JSON Schema
 * @property {Object} [output] - 输出 JSON Schema
 * @property {Object} [input] - 输入 JSON Schema（Stage）
 * @property {ManifestDependency[] | Record<string, string>} [dependencies] - 依赖（结构化数组或 {id: version} 简写）
 * @property {Object} [config] - 配置选项
 * @property {Object} [metadata] - 扩展元数据（优先级、激活条件等）
 */

/**
 * 创建 Tool Manifest
 * @param {Object} options - 工具配置选项
 * @param {string} options.name - 工具名称
 * @param {string} [options.version="1.0.0"] - 版本号 (semver)
 * @param {string} options.description - 工具描述
 * @param {Object} [options.parameters] - 参数定义（简化格式或 JSON Schema）
 * @param {Object} [options.output] - 输出 JSON Schema
 * @param {PermissionValue[]} [options.permissions=[]] - 所需权限
 * @param {string[]} [options.keywords=[]] - 关键词
 * @param {number} [options.priority] - 优先级
 * @param {number} [options.layer] - 层级
 * @param {Object} [options.activation] - 激活条件
 * @returns {ManifestSchema} 创建的 Tool Manifest
 * @throws {ManifestValidationError} 缺少必需字段时抛出
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

  if (!name) throw new ManifestValidationError("Manifest requires name", "name");
  if (!description) throw new ManifestValidationError("Manifest requires description", "description");

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
 * @param {Object} options - 技能配置选项
 * @param {string} options.name - 技能名称
 * @param {string} [options.version="1.0.0"] - 版本号 (semver)
 * @param {string} options.description - 技能描述
 * @param {string[]} [options.keywords=[]] - 关键词
 * @param {string[]} [options.keywordsAll=[]] - 必须全部匹配的关键词
 * @param {string} [options.allowedTools] - 允许调用的工具
 * @param {PermissionValue[]} [options.permissions=[]] - 所需权限
 * @param {number} [options.priority] - 优先级
 * @param {string} [options.scope] - 作用域 (repo/user/system)
 * @param {string[]} [options.tags] - 标签
 * @param {Object} [options.traits] - 特征
 * @returns {ManifestSchema} 创建的 Skill Manifest
 * @throws {ManifestValidationError} 缺少必需字段时抛出
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

  if (!name) throw new ManifestValidationError("Manifest requires name", "name");
  if (!description) throw new ManifestValidationError("Manifest requires description", "description");

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
 * @param {Object} options - 阶段配置选项
 * @param {string} options.name - 阶段名称
 * @param {string} [options.version="1.0.0"] - 版本号 (semver)
 * @param {string} options.description - 阶段描述
 * @param {PermissionValue[]} [options.permissions=[]] - 所需权限
 * @param {Object} [options.dependencies={}] - 依赖声明
 * @param {Object} [options.config={}] - 配置选项
 * @param {Object} [options.input] - 输入 JSON Schema
 * @param {Object} [options.output] - 输出 JSON Schema
 * @returns {ManifestSchema} 创建的 Stage Manifest
 * @throws {ManifestValidationError} 缺少必需字段时抛出
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

  if (!name) throw new ManifestValidationError("Manifest requires name", "name");
  if (!description) throw new ManifestValidationError("Manifest requires description", "description");

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
 * @param {Object} options - 中间件配置选项
 * @param {string} options.name - 中间件名称
 * @param {string} [options.version="1.0.0"] - 版本号 (semver)
 * @param {string} options.description - 中间件描述
 * @param {PermissionValue[]} [options.permissions=[]] - 所需权限
 * @param {number} [options.order=0] - 执行顺序
 * @param {string[]} [options.phases=["before","after"]] - 执行阶段
 * @returns {ManifestSchema} 创建的 Middleware Manifest
 * @throws {ManifestValidationError} 缺少必需字段时抛出
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

  if (!name) throw new ManifestValidationError("Manifest requires name", "name");
  if (!description) throw new ManifestValidationError("Manifest requires description", "description");

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

/** @private 危险键黑名单，防止原型污染 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * 将简化参数定义转换为 JSON Schema
 * @private
 * @param {Object|null|undefined} parameters - 参数定义（简化格式或 JSON Schema）
 * @returns {Object|null} 归一化后的 JSON Schema，或 null
 */
function normalizeParameterSchema(parameters) {
  if (!parameters) return null;

  // 已经是 JSON Schema 格式 - 校验基本结构
  if (parameters.type === "object" || parameters.properties) {
    // 清洗 properties 中的危险键
    if (parameters.properties && typeof parameters.properties === "object") {
      for (const key of Object.keys(parameters.properties)) {
        if (DANGEROUS_KEYS.has(key)) {
          delete parameters.properties[key];
        }
      }
    }
    return parameters;
  }

  // 简化格式转换 - 使用 null 原型对象防止原型污染
  const properties = Object.create(null);
  const required = [];

  for (const [key, value] of Object.entries(parameters)) {
    // 拒绝危险键
    if (DANGEROUS_KEYS.has(key)) {
      continue;
    }
    if (typeof value === "string") {
      const isRequired = value.includes("必需") || value.includes("required");
      properties[key] = {
        type: "string",
        description: value,
      };
      if (isRequired) required.push(key);
    } else if (typeof value === "object" && value !== null) {
      properties[key] = value;
      if (value.required) required.push(key);
    }
  }

  return {
    type: "object",
    properties: { ...properties }, // 转回普通对象以便序列化
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
 * @private
 * @param {Object} definition - Tool definition
 * @returns {PermissionValue[]} 权限列表
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
 * @private
 * @param {Object} metadata - Skill metadata
 * @returns {PermissionValue[]} 权限列表
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
   * @param {ManifestSchema} manifest - Manifest 数据
   * @returns {ManifestRegistry} 当前 registry
   * @throws {Error} Manifest 校验失败时抛出
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
   * @param {ManifestSchema[]} manifests - Manifest 列表
   * @returns {ManifestRegistry} 当前 registry
   */
  registerAll(manifests) {
    for (const m of manifests) {
      this.register(m);
    }
    return this;
  }

  /**
   * 获取 Manifest
   * @param {string} name - Manifest 名称
   * @returns {ManifestSchema|null} 找到的 Manifest
   */
  get(name) {
    return this._manifests.get(name) || null;
  }

  /**
   * 按类型获取
   * @param {PluginTypeValue} type - 插件类型
   * @returns {ManifestSchema[]} 匹配的 Manifest 列表
   */
  getByType(type) {
    return Array.from(this._manifests.values()).filter(m => m.type === type);
  }

  /**
   * 按权限过滤
   * @param {PermissionValue} permission - 权限
   * @returns {ManifestSchema[]} 匹配的 Manifest 列表
   */
  filterByPermission(permission) {
    return Array.from(this._manifests.values()).filter(
      m => m.permissions?.includes(permission)
    );
  }

  /**
   * 获取所有 Manifest
   * @returns {ManifestSchema[]} 所有已注册的 Manifest
   */
  getAll() {
    return Array.from(this._manifests.values());
  }

  /**
   * 导出为 JSON
   * @returns {{ version: string, manifests: ManifestSchema[] }} 序列化数据
   */
  toJSON() {
    return {
      version: MANIFEST_VERSION,
      manifests: this.getAll(),
    };
  }

  /**
   * 从 JSON 导入
   * @param {{ version?: string, manifests?: ManifestSchema[] }} json - 序列化数据
   * @returns {ManifestRegistry} registry 实例
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
   * @returns {void}
   */
  clear() {
    this._manifests.clear();
  }

  /**
   * 数量
   * @returns {number} 已注册数量
   */
  get size() {
    return this._manifests.size;
  }
}

export default {
  MANIFEST_VERSION,
  ManifestValidationError,
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
