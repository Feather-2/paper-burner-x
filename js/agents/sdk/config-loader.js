/**
 * 项目配置加载器 - 支持 .agent/agent.md 项目级自定义指令
 *
 * 配置文件格式：
 * ---
 * skills: [search-docs, write-report]
 * model: gpt-4
 * hooks:
 *   - ./hooks/audit.js
 * ---
 * 自定义系统指令内容...
 */

import { isNodeLike } from "../shared/platform.js";

/**
 * 解析 YAML frontmatter
 * @param {string} content
 * @returns {{frontmatter: Object, body: string}}
 */
function parseFrontmatter(content) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
        return { frontmatter: {}, body: content.trim() };
    }

    const yamlContent = match[1];
    const body = match[2].trim();

    // 简单 YAML 解析（仅支持基本格式）
    const frontmatter = {};
    const lines = yamlContent.split(/\r?\n/);
    let currentKey = null;
    let currentArray = null;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        // 数组项
        if (trimmed.startsWith("- ") && currentKey) {
            if (!currentArray) {
                currentArray = [];
                frontmatter[currentKey] = currentArray;
            }
            currentArray.push(trimmed.slice(2).trim());
            continue;
        }

        // 键值对
        const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
        if (kvMatch) {
            currentKey = kvMatch[1];
            const value = kvMatch[2].trim();
            currentArray = null;

            if (value.startsWith("[") && value.endsWith("]")) {
                // 内联数组
                frontmatter[currentKey] = value
                    .slice(1, -1)
                    .split(",")
                    .map(s => s.trim())
                    .filter(Boolean);
            } else if (value) {
                frontmatter[currentKey] = value;
            }
        }
    }

    return { frontmatter, body };
}

/**
 * 加载项目级 Agent 配置
 * @param {string} projectRoot - 项目根目录
 * @returns {Promise<AgentConfig>}
 */
export async function loadAgentConfig(projectRoot) {
    const defaultConfig = {
        instructions: "",
        skills: [],
        model: null,
        hooks: [],
        _loaded: false,
        _path: "",
    };

    if (!isNodeLike()) {
        return {
            ...defaultConfig,
            _path: `${String(projectRoot || "").replace(/\/$/, "")}/.agent/agent.md`,
        };
    }

    const pathModule = await import("node:path");
    const fs = await import("node:fs/promises");

    const configPath = pathModule.join(projectRoot, ".agent", "agent.md");

    defaultConfig._path = configPath;

    try {
        await fs.access(configPath);

        const content = await fs.readFile(configPath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(content);

        return {
            instructions: body,
            skills: Array.isArray(frontmatter.skills) ? frontmatter.skills : [],
            model: frontmatter.model || null,
            hooks: Array.isArray(frontmatter.hooks) ? frontmatter.hooks : [],
            _loaded: true,
            _path: configPath,
            _raw: frontmatter,
        };
    } catch (err) {
        // Distinguish file-not-found from other errors (parse failure, permission issues)
        const code = err?.code;
        if (code !== "ENOENT" && code !== "ENOTDIR") {
            // Log parse/permission errors for debugging, but still return default
            console.warn?.(`[config-loader] Failed to load ${configPath}: ${err?.message || err}`);
        }
        return defaultConfig;
    }
}

/**
 * 合并配置（项目 > 全局 > 默认）
 * @param {AgentConfig} project
 * @param {AgentConfig} global
 * @returns {AgentConfig}
 */
export function mergeConfigs(project, global) {
    return {
        instructions: project.instructions || global.instructions || "",
        skills: [...new Set([...(project.skills || []), ...(global.skills || [])])],
        model: project.model || global.model || null,
        hooks: [...(global.hooks || []), ...(project.hooks || [])],
    };
}

export default { loadAgentConfig, mergeConfigs, parseFrontmatter };
