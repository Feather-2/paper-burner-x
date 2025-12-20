/**
 * Skill Filesystem Loader
 *
 * Loads Skills from multiple directories (SKILL.md format)
 * Following agentsdk-go pattern for lazy loading and frontmatter parsing.
 *
 * Supported paths:
 * - .claude/skills/ - user-defined skills
 * - docs/ - project skills
 * - custom paths from .claude/settings.json
 */

const SKILL_NAME_PATTERN = /^[a-z0-9-]{1,64}$/;

// 动态导入 yaml 模块（支持浏览器/Node.js 环境）
let yamlParser = null;

async function getYamlParser() {
  if (yamlParser) return yamlParser;
  try {
    const yaml = await import("yaml");
    yamlParser = yaml.parse || yaml.default?.parse;
    return yamlParser;
  } catch {
    // Fallback: simple key-value parser for basic frontmatter
    yamlParser = (text) => {
      const result = {};
      const lines = text.split("\n");
      for (const line of lines) {
        const match = line.match(/^(\w[\w-]*):\s*(.*)$/);
        if (match) {
          const [, key, value] = match;
          // Handle quoted strings
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            result[key] = value.slice(1, -1);
          } else if (value === "true") {
            result[key] = true;
          } else if (value === "false") {
            result[key] = false;
          } else if (/^\d+$/.test(value)) {
            result[key] = parseInt(value, 10);
          } else {
            result[key] = value;
          }
        }
      }
      return result;
    };
    return yamlParser;
  }
}

/**
 * @typedef {Object} SkillMetadata
 * @property {string} name
 * @property {string} description
 * @property {string} [license]
 * @property {string} [allowedTools]
 * @property {number} [priority]
 * @property {string} [mutexKey]
 * @property {boolean} [disableAutoActivation]
 */

/**
 * @typedef {Object} SkillFile
 * @property {string} name
 * @property {string} path
 * @property {SkillMetadata} metadata
 * @property {string} [body] - Lazy loaded
 * @property {Object<string, string>} [supportFiles]
 */

/**
 * @typedef {Object} SkillRegistration
 * @property {Object} definition
 * @property {Function} handler
 */

/**
 * @typedef {Object} LoadOptions
 * @property {string} projectRoot - 项目根目录
 * @property {string[]} [paths] - 扫描路径列表（支持 glob）
 * @property {boolean} [loadConfig=true] - 是否从 .claude/settings.json 读取路径
 */

/**
 * Parse YAML frontmatter from SKILL.md content
 * @param {string} content
 * @returns {Promise<{ metadata: SkillMetadata, body: string }>}
 */
export async function parseFrontMatter(content) {
  const trimmed = content.replace(/^\uFEFF/, ""); // Remove BOM
  const lines = trimmed.split("\n");

  if (lines.length === 0 || lines[0].trim() !== "---") {
    throw new Error("Missing YAML frontmatter");
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error("Missing closing frontmatter separator");
  }

  const yamlText = lines.slice(1, endIndex).join("\n");
  const parseYaml = await getYamlParser();
  const metadata = parseYaml(yamlText) || {};

  // Normalize field names (yaml uses kebab-case, we use camelCase)
  if (metadata["allowed-tools"]) {
    metadata.allowedTools = metadata["allowed-tools"];
    delete metadata["allowed-tools"];
  }
  if (metadata["disable-auto-activation"]) {
    metadata.disableAutoActivation = metadata["disable-auto-activation"];
    delete metadata["disable-auto-activation"];
  }
  if (metadata["mutex-key"]) {
    metadata.mutexKey = metadata["mutex-key"];
    delete metadata["mutex-key"];
  }

  const body = lines.slice(endIndex + 1).join("\n").replace(/^\n+/, "");

  return { metadata, body };
}

/**
 * Validate skill metadata
 * @param {SkillMetadata} metadata
 * @param {string} path
 */
export function validateMetadata(metadata, path) {
  const name = (metadata.name || "").trim();

  if (!name) {
    throw new Error(`Skill name is required: ${path}`);
  }

  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid skill name "${name}": ${path}`);
  }

  const desc = (metadata.description || "").trim();
  if (!desc) {
    throw new Error(`Skill description is required: ${path}`);
  }

  if (desc.length > 1024) {
    throw new Error(`Skill description exceeds 1024 characters: ${path}`);
  }
}

/**
 * Create a lazy handler that loads body on first execute
 * @param {string} path
 * @param {Function} readFileFn
 * @returns {Function}
 */
function createLazyHandler(path, readFileFn) {
  let cached = null;
  let loadError = null;

  return async function handler(params, context) {
    if (loadError) throw loadError;

    if (!cached) {
      try {
        const content = await readFileFn(path, "utf-8");
        const { body } = await parseFrontMatter(content);
        cached = { body, path };
      } catch (err) {
        loadError = err;
        throw err;
      }
    }

    return {
      skill: context?.skillName,
      output: { body: cached.body },
      metadata: { source: cached.path },
    };
  };
}

/**
 * Load skills from filesystem
 * @param {LoadOptions} options
 * @returns {Promise<{ registrations: SkillRegistration[], errors: Error[] }>}
 */
export async function loadFromFS({ projectRoot, paths, loadConfig = true }) {
  const registrations = [];
  const errors = [];

  // Dynamic import for Node.js fs
  let fs;
  try {
    fs = await import("node:fs/promises");
  } catch {
    // Not in Node.js environment
    return { registrations, errors: [new Error("Filesystem not available")] };
  }

  // Collect all paths to scan
  let scanPaths = paths ? [...paths] : [];

  // Load paths from config if enabled
  if (loadConfig) {
    const configPath = `${projectRoot}/.claude/settings.json`;
    try {
      const configContent = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(configContent);
      const configPaths = config?.skills?.paths || [];
      scanPaths = [...scanPaths, ...configPaths];
    } catch (err) {
      // Config file is optional
      if (err.code !== "ENOENT") {
        errors.push(new Error(`Failed to read config: ${err.message}`));
      }
    }
  }

  // Default paths if none specified
  if (scanPaths.length === 0) {
    scanPaths = [".claude/skills/*", "docs/*"];
  }

  // Deduplicate
  scanPaths = [...new Set(scanPaths)];

  const seen = new Map();

  // Process each path pattern
  for (const pattern of scanPaths) {
    const fullPattern = pattern.startsWith("/") ? pattern : `${projectRoot}/${pattern}`;
    const { dirs, error } = await expandPathPattern(fs, fullPattern);
    if (error) errors.push(error);

    for (const dir of dirs) {
      const result = await loadSkillFromDir(fs, dir, seen);
      if (result.registration) {
        registrations.push(result.registration);
      }
      if (result.error) {
        errors.push(result.error);
      }
    }
  }

  // Sort by name for deterministic order
  registrations.sort((a, b) => a.definition.name.localeCompare(b.definition.name));

  return { registrations, errors };
}

/**
 * Expand path pattern to actual directories
 * @param {Object} fs
 * @param {string} pattern
 * @returns {Promise<{ dirs: string[], error?: Error }>}
 */
async function expandPathPattern(fs, pattern) {
  const dirs = [];

  // Handle simple glob: /path/to/*
  if (pattern.endsWith("/*")) {
    const baseDir = pattern.slice(0, -2);
    try {
      const stat = await fs.stat(baseDir);
      if (!stat.isDirectory()) {
        return { dirs: [], error: new Error(`${baseDir} is not a directory`) };
      }
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push(`${baseDir}/${entry.name}`);
        }
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        return { dirs: [], error: err };
      }
    }
  } else {
    // Direct path
    try {
      const stat = await fs.stat(pattern);
      if (stat.isDirectory()) {
        dirs.push(pattern);
      }
    } catch (err) {
      if (err.code !== "ENOENT") {
        return { dirs: [], error: err };
      }
    }
  }

  return { dirs };
}

/**
 * Load skill from a directory
 * @param {Object} fs
 * @param {string} skillDir
 * @param {Map<string, string>} seen
 * @returns {Promise<{ registration?: SkillRegistration, error?: Error }>}
 */
async function loadSkillFromDir(fs, skillDir, seen) {
  const skillPath = `${skillDir}/SKILL.md`;

  try {
    // Check if SKILL.md exists
    await fs.stat(skillPath);

    // Read frontmatter only (not full body for lazy loading)
    const content = await fs.readFile(skillPath, "utf-8");
    const { metadata } = await parseFrontMatter(content);

    // Use directory name if no name in frontmatter
    const dirName = skillDir.split("/").pop();
    if (!metadata.name) {
      metadata.name = dirName;
    }

    validateMetadata(metadata, skillPath);

    // Check for duplicates
    if (seen.has(metadata.name)) {
      return {
        error: new Error(
          `Duplicate skill "${metadata.name}" at ${skillPath} (already from ${seen.get(metadata.name)})`
        ),
      };
    }
    seen.set(metadata.name, skillPath);

    // Create registration
    const definition = {
      name: metadata.name,
      description: metadata.description,
      priority: metadata.priority || 0,
      mutexKey: metadata.mutexKey || null,
      disableAutoActivation: metadata.disableAutoActivation || false,
      metadata: {
        source: skillPath,
        ...(metadata.allowedTools && { allowedTools: metadata.allowedTools }),
        ...(metadata.license && { license: metadata.license }),
      },
    };

    return {
      registration: {
        definition,
        handler: createLazyHandler(skillPath, fs.readFile.bind(fs)),
      },
    };
  } catch (err) {
    if (err.code === "ENOENT") {
      // SKILL.md doesn't exist, skip silently
      return {};
    }
    return { error: new Error(`Failed to load skill from ${skillDir}: ${err.message}`) };
  }
}

/**
 * Load support files for a skill
 * @param {string} skillDir
 * @returns {Promise<{ files: Object<string, string>, errors: Error[] }>}
 */
export async function loadSupportFiles(skillDir) {
  const files = {};
  const errors = [];

  let fs;
  try {
    fs = await import("node:fs/promises");
  } catch {
    return { files, errors: [new Error("Filesystem not available")] };
  }

  // Optional files
  for (const name of ["reference.md", "examples.md"]) {
    try {
      const content = await fs.readFile(`${skillDir}/${name}`, "utf-8");
      files[name] = content;
    } catch (err) {
      if (err.code !== "ENOENT") {
        errors.push(err);
      }
    }
  }

  // Subdirectories: scripts/, templates/
  for (const subdir of ["scripts", "templates"]) {
    const subdirPath = `${skillDir}/${subdir}`;
    try {
      const stat = await fs.stat(subdirPath);
      if (!stat.isDirectory()) continue;

      const walkDir = async (dir, prefix) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`;
          const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await walkDir(fullPath, relPath);
          } else {
            try {
              const content = await fs.readFile(fullPath, "utf-8");
              files[`${subdir}/${relPath}`] = content;
            } catch (err) {
              errors.push(err);
            }
          }
        }
      };

      await walkDir(subdirPath, "");
    } catch (err) {
      if (err.code !== "ENOENT") {
        errors.push(err);
      }
    }
  }

  return { files, errors };
}

export default { loadFromFS, loadSupportFiles, parseFrontMatter, validateMetadata };
