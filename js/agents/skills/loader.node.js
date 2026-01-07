/**
 * Skill Loader - 从多路径加载 Skills
 *
 * 加载顺序（优先级从高到低）：
 * 1. repo: .paper-burner/skills/
 * 2. user: ~/.paper-burner/skills/
 * 3. system: 内置 skills
 *
 * 同名 Skill 按优先级去重，保留高优先级版本
 */

import { SkillScope } from "./model.js";

/**
 * @typedef {import("./model.js").SkillMetadata} SkillMetadata
 * @typedef {{ metadata: SkillMetadata, body: (string | null), supportFiles?: Record<string, string> }} SkillContent
 * @typedef {{ skills: SkillContent[], errors: Array<{ path: string, message: string }> }} SkillLoadOutcome
 */

/** @type {string} */
const NODE_FS_PROMISES_SPEC = "node:fs/promises";
/** @type {string} */
const NODE_CRYPTO_SPEC = "node:crypto";
/** @type {string} */
const NODE_PATH_SPEC = "node:path";

/** @type {any} */
const fs = await import(NODE_FS_PROMISES_SPEC);
/** @type {any} */
const { createHash } = await import(NODE_CRYPTO_SPEC);
/** @type {any} */
const path = await import(NODE_PATH_SPEC);

const SKILL_FILENAME = "SKILL.md";
const SKILLS_DIR_NAME = "skills";
const CONFIG_DIR_NAME = ".paper-burner";
const MAX_NAME_LEN = 64;
const MAX_DESCRIPTION_LEN = 1024;

// 指纹缓存：path -> { fingerprint, skill, mtime }
const _fingerprintCache = new Map();

/**
 * 解析 YAML Frontmatter
 */
function extractFrontmatter(contents) {
  // 统一换行符为 LF
  const normalized = contents.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return null;

  const frontmatterLines = [];
  let foundClosing = false;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      foundClosing = true;
      break;
    }
    frontmatterLines.push(lines[i]);
  }

  if (!foundClosing || frontmatterLines.length === 0) return null;
  return frontmatterLines.join("\n");
}

/**
 * 简单的 YAML 解析（支持基本字段和多行值）
 */
function parseSimpleYaml(yaml) {
  const result = {};
  const lines = yaml.split("\n");
  let currentKey = null;
  let currentValue = [];
  let inMultiline = false;
  let multilineIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检查是否是新的键值对
    const match = line.match(/^(\w+(?:-\w+)*):\s*(.*)$/);

    if (match && !inMultiline) {
      // 保存之前的多行值
      if (currentKey && currentValue.length > 0) {
        result[currentKey] = currentValue.join("\n").trim();
        currentValue = [];
      }

      const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      let value = match[2].trim();

      // 检查是否是多行字符串开始
      if (value === "|-" || value === "|" || value === ">-" || value === ">") {
        currentKey = key;
        inMultiline = true;
        multilineIndent = 0;
        continue;
      }

      // 处理引号
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }

      result[key] = value;
      currentKey = null;
    } else if (inMultiline) {
      // 处理多行内容
      const trimmed = line.trimStart();
      const indent = line.length - trimmed.length;

      if (trimmed === "" || indent > 0) {
        if (multilineIndent === 0 && trimmed !== "") {
          multilineIndent = indent;
        }
        currentValue.push(trimmed);
      } else if (trimmed !== "" && indent === 0) {
        // 新的顶级键，结束多行
        if (currentKey) {
          result[currentKey] = currentValue.join(" ").trim();
          currentValue = [];
        }
        inMultiline = false;
        // 重新处理这一行
        i--;
      }
    }
  }

  // 保存最后的多行值
  if (currentKey && currentValue.length > 0) {
    result[currentKey] = currentValue.join(" ").trim();
  }

  return result;
}

/**
 * 解析 Skill 文件
 */
async function parseSkillFile(filePath, scope) {
  const contents = await fs.readFile(filePath, "utf-8");

  // 计算指纹并检查缓存
  const fingerprint = createHash("sha256").update(contents).digest("hex").slice(0, 16);
  const cached = _fingerprintCache.get(filePath);
  if (cached && cached.fingerprint === fingerprint) {
    return cached.skill;
  }

  const frontmatter = extractFrontmatter(contents);

  if (!frontmatter) {
    throw new Error("missing YAML frontmatter delimited by ---");
  }

  const parsed = parseSimpleYaml(frontmatter);

  if (!parsed.name) {
    throw new Error("missing field `name`");
  }
  if (!parsed.description) {
    throw new Error("missing field `description`");
  }

  const name = parsed.name.trim().replace(/\s+/g, " ");
  const description = parsed.description.trim().replace(/\s+/g, " ");

  if (name.length > MAX_NAME_LEN) {
    throw new Error(`name exceeds maximum length of ${MAX_NAME_LEN} characters`);
  }
  if (description.length > MAX_DESCRIPTION_LEN) {
    throw new Error(`description exceeds maximum length of ${MAX_DESCRIPTION_LEN} characters`);
  }

  // 提取关键词（Any 模式）
  const keywords = parsed.keywords
    ? parsed.keywords.split(",").map(k => k.trim()).filter(Boolean)
    : [];

  // 提取必须全部匹配的关键词（All 模式）
  const keywordsAll = parsed.keywordsAll
    ? parsed.keywordsAll.split(",").map(k => k.trim()).filter(Boolean)
    : [];

  // 提取 allowed-tools
  const allowedTools = parsed.allowedTools || null;

  // 提取 tags（格式：key1:value1,key2:value2）
  const tags = {};
  if (parsed.tags) {
    parsed.tags.split(",").forEach(pair => {
      const [k, v] = pair.split(":").map(s => s.trim());
      if (k) tags[k] = v || "";
    });
  }

  // 提取 traits
  const traits = parsed.traits
    ? parsed.traits.split(",").map(t => t.trim()).filter(Boolean)
    : [];

  // 提取正文（frontmatter 之后的内容）
  // 从第4个字符开始找第二个 ---，确保 bodyStart > 3
  const bodyStart = contents.indexOf("---", 4);
  const body = bodyStart > 3 ? contents.slice(bodyStart + 3).trim() : "";

  const skill = {
    metadata: {
      name,
      description,
      shortDescription: parsed.shortDescription || null,
      path: filePath,
      scope,
      keywords,
      keywordsAll,
      allowedTools,
      tags: Object.keys(tags).length > 0 ? tags : null,
      traits: traits.length > 0 ? traits : null,
      priority: parsed.priority ? parseInt(parsed.priority, 10) : 100,
    },
    body,
  };

  // 缓存结果
  _fingerprintCache.set(filePath, { fingerprint, skill });
  return skill;
}

/**
 * 递归发现目录下的 Skills
 */
async function discoverSkillsUnderRoot(rootPath, scope, outcome) {
  try {
    const stat = await fs.stat(rootPath);
    if (!stat.isDirectory()) return;
  } catch {
    return; // 目录不存在
  }

  const queue = [rootPath];

  while (queue.length > 0) {
    const dir = queue.shift();

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (scope !== SkillScope.SYSTEM) {
        outcome.errors.push({
          path: dir,
          message: `Failed to read dir: ${err?.message || err}`,
        });
      }
      continue;
    }

    for (const entry of entries) {
      // 跳过隐藏文件
      if (entry.name.startsWith(".")) continue;

      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name === SKILL_FILENAME) {
        try {
          const skill = await parseSkillFile(fullPath, scope);
          outcome.skills.push(skill);
        } catch (err) {
          // 系统 skills 的错误不报告
          if (scope !== SkillScope.SYSTEM) {
            outcome.errors.push({
              path: fullPath,
              message: err.message,
            });
          }
        }
      }
    }
  }
}

/**
 * 获取 Skill 根目录列表
 */
function getSkillRoots(cwd, homeDir) {
  const roots = [];

  // 1. Repo skills (最高优先级)
  if (cwd) {
    const repoSkillsPath = path.join(cwd, CONFIG_DIR_NAME, SKILLS_DIR_NAME);
    roots.push({ path: repoSkillsPath, scope: SkillScope.REPO });
  }

  // 2. User skills
  if (homeDir) {
    const userSkillsPath = path.join(homeDir, CONFIG_DIR_NAME, SKILLS_DIR_NAME);
    roots.push({ path: userSkillsPath, scope: SkillScope.USER });
  }

  // 3. System skills (内置)
  // 可以从 node_modules 或固定路径加载
  // roots.push({ path: SYSTEM_SKILLS_PATH, scope: SkillScope.SYSTEM });

  return roots;
}

/**
 * 加载所有 Skills
 *
 * @param {Object} options
 * @param {string} [options.cwd] - 当前工作目录
 * @param {string} [options.homeDir] - 用户主目录
 * @returns {Promise<SkillLoadOutcome>}
 */
export async function loadSkills({ cwd, homeDir } = {}) {
  const outcome = {
    skills: [],
    errors: [],
  };

  const roots = getSkillRoots(cwd, homeDir);

  for (const root of roots) {
    await discoverSkillsUnderRoot(root.path, root.scope, outcome);
  }

  // 按名称去重，保留高优先级（先出现的）
  const seen = new Set();
  outcome.skills = outcome.skills.filter(skill => {
    if (seen.has(skill.metadata.name)) return false;
    seen.add(skill.metadata.name);
    return true;
  });

  // 按名称排序
  outcome.skills.sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));

  return outcome;
}

/**
 * 从 MCP-Nexus 加载远程 Skills
 *
 * @param {Object} nexusProvider - NexusSkillProvider 实例
 * @returns {Promise<SkillLoadOutcome>}
 */
export async function loadSkillsFromNexus(nexusProvider) {
  const outcome = {
    skills: [],
    errors: [],
  };

  if (!nexusProvider) {
    return outcome;
  }

  try {
    // 检查 Nexus 是否可用
    const available = await nexusProvider.isAvailable();
    if (!available) {
      return outcome;
    }

    // 获取远程 Skills 列表
    const remoteSkills = await nexusProvider.listSkills();

    for (const skill of remoteSkills) {
      try {
        // 获取 Skill 内容
        const content = await nexusProvider.getSkillContent(skill.name);

        outcome.skills.push({
          metadata: {
            name: skill.name,
            description: skill.description,
            shortDescription: null,
            path: `nexus://${skill.name}`,
            scope: SkillScope.REMOTE,
            keywords: [],
            keywordsAll: [],
            allowedTools: skill.allowedTools?.join(",") || null,
            tags: null,
            traits: null,
            priority: skill.priority || 200, // 远程 Skills 优先级较低
          },
          body: content.body,
          supportFiles: content.supportFiles,
        });
      } catch (err) {
        outcome.errors.push({
          path: `nexus://${skill.name}`,
          message: err.message,
        });
      }
    }
  } catch (err) {
    outcome.errors.push({
      path: "nexus://",
      message: `Failed to connect to Nexus: ${err.message}`,
    });
  }

  return outcome;
}

/**
 * 加载所有 Skills（本地 + 远程）
 *
 * @param {Object} options
 * @param {string} [options.cwd] - 当前工作目录
 * @param {string} [options.homeDir] - 用户主目录
 * @param {Object} [options.nexusProvider] - NexusSkillProvider 实例
 * @returns {Promise<SkillLoadOutcome>}
 */
export async function loadAllSkills({ cwd, homeDir, nexusProvider } = {}) {
  // 加载本地 Skills
  const localOutcome = await loadSkills({ cwd, homeDir });

  // 加载远程 Skills
  const remoteOutcome = await loadSkillsFromNexus(nexusProvider);

  // 合并结果（本地优先）
  const seen = new Set(localOutcome.skills.map(s => s.metadata.name));

  for (const skill of remoteOutcome.skills) {
    if (!seen.has(skill.metadata.name)) {
      localOutcome.skills.push(skill);
      seen.add(skill.metadata.name);
    }
  }

  localOutcome.errors.push(...remoteOutcome.errors);

  return localOutcome;
}

/**
 * 从指定路径加载单个 Skill
 *
 * @param {string} filePath
 * @param {SkillScope} [scope]
 * @returns {Promise<SkillContent>}
 */
export async function loadSkillFromPath(filePath, scope = SkillScope.USER) {
  return parseSkillFile(filePath, scope);
}

export default {
  loadSkills,
  loadSkillFromPath,
  loadSkillsFromNexus,
  loadAllSkills,
};
