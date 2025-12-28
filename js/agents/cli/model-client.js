/**
 * CLI Model Client - Node.js 环境下的模型调用
 *
 * 支持:
 * - 本地配置文件 (cli-config.json)
 * - 多模型配置
 * - 角色路由 (analyst/planner/writer/reviewer/worker/vision/fast)
 * - 环境变量覆盖
 *
 * 配置优先级: 环境变量 > cli-config.json > 默认值
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, "config.json");
const EXAMPLE_FILE = join(__dirname, "config.example.json");

/** @typedef {{baseUrl: string, model: string, apiKey: string}} ModelConfig */
/** @typedef {{models: Record<string, ModelConfig>, roles: Record<string, string>, default: string}} CliConfig */

/**
 * 加载配置文件
 * @returns {CliConfig|null}
 */
function loadConfig() {
    const configPath = existsSync(CONFIG_FILE) ? CONFIG_FILE : null;
    if (!configPath) return null;

    try {
        const raw = readFileSync(configPath, "utf-8");
        return JSON.parse(raw);
    } catch (err) {
        console.warn(`[CliModelClient] 配置文件解析失败: ${err.message}`);
        return null;
    }
}

/**
 * 多模型路由客户端
 */
export class CliModelRouter {
    constructor() {
        this.config = loadConfig();
        this._clients = new Map();

        if (!this.config && !process.env.OPENAI_API_KEY) {
            console.warn(`[CliModelRouter] 未找到配置。请创建 cli-config.json 或设置 OPENAI_API_KEY`);
            console.warn(`  参考: ${EXAMPLE_FILE}`);
        }
    }

    /**
     * 获取指定角色的模型客户端
     * @param {string} role - agent/planner/writer/designer/codesearch/vision/...
     * @returns {CliModelClient}
     */
    getClient(role = "worker") {
        // 环境变量覆盖
        if (process.env.OPENAI_API_KEY) {
            return this._getEnvClient();
        }

        if (!this.config) {
            throw new Error("未配置模型。请创建 config.json 或设置 OPENAI_API_KEY");
        }

        // 查找角色对应的 tier
        const tierName = this._findTier(role);

        // 缓存客户端
        if (!this._clients.has(tierName)) {
            const modelConfig = this.config.models?.[tierName];
            if (!modelConfig) {
                throw new Error(`未找到模型配置: ${tierName}`);
            }
            this._clients.set(tierName, new CliModelClient(modelConfig));
        }

        return this._clients.get(tierName);
    }

    /**
     * 查找角色对应的 tier
     * @param {string} role
     * @returns {string} tier name (advanced/normal/fast/vision)
     */
    _findTier(role) {
        const tiers = this.config?.tiers || {};
        for (const [tier, roles] of Object.entries(tiers)) {
            if (Array.isArray(roles) && roles.includes(role)) {
                return tier;
            }
        }
        // 兼容旧格式 roles
        if (this.config?.roles?.[role]) {
            return this.config.roles[role];
        }
        return this.config?.default || "normal";
    }

    _getEnvClient() {
        if (!this._clients.has("__env__")) {
            this._clients.set("__env__", new CliModelClient({
                apiKey: process.env.OPENAI_API_KEY,
                baseUrl: process.env.OPENAI_BASE_URL || "https://api.deepseek.com/v1",
                model: process.env.OPENAI_MODEL || "deepseek-chat",
            }));
        }
        return this._clients.get("__env__");
    }

    /**
     * 获取所有可用模型
     * @returns {string[]}
     */
    getAvailableModels() {
        if (process.env.OPENAI_API_KEY) {
            return ["env:" + (process.env.OPENAI_MODEL || "deepseek-chat")];
        }
        if (!this.config?.models) return [];
        return Object.entries(this.config.models)
            .filter(([_, cfg]) => cfg.apiKey)
            .map(([name]) => name);
    }

    /**
     * 获取 tier 映射
     * @returns {Record<string, string[]>}
     */
    getTierMapping() {
        return this.config?.tiers || {};
    }
}

/**
 * 单模型客户端
 */
export class CliModelClient {
    constructor(options = {}) {
        this.apiKey = options.apiKey || "";
        this.baseUrl = (options.baseUrl || "https://api.deepseek.com/v1").replace(/\/$/, "");
        this.model = options.model || "deepseek-chat";
    }

    /**
     * 发送聊天请求
     * @param {Object} options
     * @param {Array} options.messages - [{ role, content }]
     * @param {number} [options.temperature=0.7]
     * @param {number} [options.maxTokens=4096]
     * @returns {Promise<{content: string, model: string, usage: Object}>}
     */
    async chat(options) {
        const { messages, temperature = 0.7, maxTokens = 4096 } = options;

        if (!this.apiKey) {
            throw new Error("API Key 未设置");
        }

        const url = `${this.baseUrl}/chat/completions`;
        const body = {
            model: this.model,
            messages,
            temperature,
            max_tokens: maxTokens,
        };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`API 请求失败 (${response.status}): ${text.slice(0, 200)}`);
        }

        const data = await response.json();
        const choice = data.choices?.[0];

        return {
            content: choice?.message?.content || "",
            model: data.model,
            usage: data.usage,
        };
    }

    /**
     * 简单单轮对话
     * @param {string} prompt
     * @param {string} [systemPrompt]
     * @returns {Promise<string>}
     */
    async ask(prompt, systemPrompt) {
        const messages = [];
        if (systemPrompt) {
            messages.push({ role: "system", content: systemPrompt });
        }
        messages.push({ role: "user", content: prompt });

        const result = await this.chat({ messages });
        return result.content;
    }
}

/**
 * 创建 aiApiService 兼容适配器
 * @param {CliModelRouter} router
 */
export function createAiApiServiceAdapter(router) {
    return {
        async chat(options) {
            const client = router.getClient(options.usage || "worker");
            return client.chat(options);
        },
        getAvailableModels() {
            return router.getAvailableModels().map(name => ({
                id: name,
                name,
                type: "cli",
            }));
        },
    };
}

export default { CliModelClient, CliModelRouter, createAiApiServiceAdapter };
