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
import { toNonEmptyString } from "../shared/utils/value-utils.js";
import { estimateTokensCached } from "../shared/utils/token-cache.js";
import { executeWithOverflowRecovery } from "../llm/overflow-recovery.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = join(__dirname, "config.json");
const EXAMPLE_FILE = join(__dirname, "config.example.json");

/** @typedef {{baseUrl: string, model: string, apiKey: string, contextWindow?: number, maxOutputTokens?: number, timeoutMs?: number}} ModelConfig */
/** @typedef {{models: Record<string, ModelConfig>, tiers?: Record<string, string[]>, roles?: Record<string, string>, default: string}} CliConfig */

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

function toTimeoutMs(v, fallback) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.floor(n);
}

function isAbortSignal(signal) {
    return !!signal && typeof signal === "object" && typeof signal.aborted === "boolean" && typeof signal.addEventListener === "function";
}

function mergeAbortSignals(a, b) {
    const signals = [a, b].filter(Boolean).filter(isAbortSignal);
    if (signals.length === 0) return null;
    if (signals.length === 1) return signals[0];
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
        try {
            return AbortSignal.any(signals);
        } catch {
            // ignore
        }
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    for (const s of signals) {
        if (s.aborted) return s;
        s.addEventListener?.("abort", abort, { once: true });
    }
    return controller.signal;
}

async function fetchWithTimeout(url, init = {}, { timeoutMs, signal } = {}) {
    const ms = toTimeoutMs(timeoutMs, 60_000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), ms);
    const mergedSignal = mergeAbortSignals(signal, controller.signal);

    try {
        return await fetch(url, { ...init, signal: mergedSignal || undefined });
    } finally {
        clearTimeout(timer);
    }
}

function estimateMessageTokens(message) {
    if (!message || typeof message !== "object") return 0;
    const content = message.content;
    if (typeof content === "string") return estimateTokensCached(content);
    try {
        return estimateTokensCached(JSON.stringify(content));
    } catch {
        return estimateTokensCached(String(content ?? ""));
    }
}

function estimateMessagesTokens(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}

function extractToolCallIds(message) {
  const m = message && typeof message === "object" ? message : null;
  const toolCalls = Array.isArray(m?.tool_calls) ? m.tool_calls : Array.isArray(m?.toolCalls) ? m.toolCalls : null;
  if (!toolCalls) return [];
  const ids = [];
  for (const tc of toolCalls) {
    const id = typeof tc?.id === "string" ? tc.id : "";
    if (id) ids.push(id);
  }
  return ids;
}

function extractToolMessageCallId(message) {
  const m = message && typeof message === "object" ? message : null;
  const id =
    (typeof m?.tool_call_id === "string" ? m.tool_call_id : "") ||
    (typeof m?.toolCallId === "string" ? m.toolCallId : "") ||
    (typeof m?.call_id === "string" ? m.call_id : "") ||
    (typeof m?.callId === "string" ? m.callId : "");
  return id || "";
}

function isToolRole(message) {
  const role = message && typeof message === "object" ? message.role : null;
  return role === "tool" || role === "function";
}

function isToolCallAssistantMessage(message) {
  const m = message && typeof message === "object" ? message : null;
  if (!m) return false;
  if (m.role !== "assistant") return false;
  if (Array.isArray(m.tool_calls) || Array.isArray(m.toolCalls)) return true;
  if (m.function_call && typeof m.function_call === "object") return true;
  if (m.functionCall && typeof m.functionCall === "object") return true;
  return false;
}

function truncateMessagesToBudget(messages, { maxInputTokens } = {}) {
  if (!Array.isArray(messages)) return [];
  const budget = typeof maxInputTokens === "number" && Number.isFinite(maxInputTokens) ? Math.max(0, Math.floor(maxInputTokens)) : 0;
  if (!budget) return messages;

  const system = [];
  const rest = [];
  for (const m of messages) {
    if (m && typeof m === "object" && m.role === "system") system.push(m);
    else rest.push(m);
  }

  let startIndex = 0;
  while (startIndex < rest.length && estimateMessagesTokens([...system, ...rest.slice(startIndex)]) > budget) {
    const current = rest[startIndex];

    // If dropping an assistant tool-call message, also drop the contiguous tool outputs that follow it.
    if (isToolCallAssistantMessage(current)) {
      startIndex += 1;
      while (startIndex < rest.length && isToolRole(rest[startIndex])) {
        startIndex += 1;
      }
      continue;
    }

    // Never keep a conversation that starts with tool output only.
    if (isToolRole(current)) {
      while (startIndex < rest.length && isToolRole(rest[startIndex])) {
        startIndex += 1;
      }
      continue;
    }

    startIndex += 1;
  }

  let kept = rest.slice(startIndex);

  // Extra cleanup: avoid orphaned tool outputs if tool_call_id references are present.
  const referenced = new Set();
  for (const msg of kept) {
    for (const id of extractToolCallIds(msg)) referenced.add(id);
  }
  if (referenced.size) {
    kept = kept.filter((msg) => {
      if (!isToolRole(msg)) return true;
      const id = extractToolMessageCallId(msg);
      return !id || referenced.has(id);
    });
  }

  // Ensure we never start with a tool message (best-effort).
  while (kept.length && isToolRole(kept[0])) kept = kept.slice(1);

  return [...system, ...kept];
}

async function buildHttpError(response, { url, maxChars = 1500 } = {}) {
    const status = response?.status;
    const endpoint = toNonEmptyString(url) || "";

    try {
        const ctype = response?.headers?.get?.("content-type") || "";
        if (ctype.includes("application/json") && typeof response.json === "function") {
            const data = await response.json().catch(() => null);
            const msg =
                data?.error?.message ||
                data?.message ||
                data?.error ||
                (typeof data === "string" ? data : null) ||
                `HTTP ${status}`;
            const err = new Error(`API 请求失败 (${status})${endpoint ? `: ${endpoint}` : ""}: ${String(msg).slice(0, maxChars)}`);
            err.status = status;
            err.data = data;
            const retryAfter = response?.headers?.get?.("retry-after") || "";
            if (retryAfter) err.retryAfter = retryAfter;
            return err;
        }

        const text = typeof response.text === "function" ? await response.text() : "";
        const err = new Error(`API 请求失败 (${status})${endpoint ? `: ${endpoint}` : ""}: ${String(text).slice(0, maxChars)}`);
        err.status = status;
        err.data = text;
        const retryAfter = response?.headers?.get?.("retry-after") || "";
        if (retryAfter) err.retryAfter = retryAfter;
        return err;
    } catch (e) {
        const err = new Error(`API 请求失败 (${status})${endpoint ? `: ${endpoint}` : ""}`);
        err.status = status;
        err.cause = e instanceof Error ? e : undefined;
        return err;
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
            console.warn(`[CliModelRouter] 未找到配置。请创建 config.json 或设置 OPENAI_API_KEY`);
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
        this.contextWindow = typeof options.contextWindow === "number" ? options.contextWindow : null;
        this.maxOutputTokens = typeof options.maxOutputTokens === "number" ? options.maxOutputTokens : null;
        this.timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : null;
    }

    /**
     * 发送聊天请求
     * @param {Object} options
     * @param {Array} options.messages - [{ role, content }]
     * @param {number} [options.temperature=0.7]
     * @param {number} [options.maxTokens=4096]
     * @param {AbortSignal} [options.signal]
     * @param {number} [options.timeoutMs]
     * @returns {Promise<{content: string, model: string, usage: Object}>}
     */
    async chat(options) {
        const { messages, temperature = 0.7, maxTokens, signal, timeoutMs } = options || {};
        const initialMaxTokens = typeof maxTokens === "number" ? maxTokens : (this.maxOutputTokens || 4096);

        if (!this.apiKey) {
            throw new Error("API Key 未设置");
        }

        const url = `${this.baseUrl}/chat/completions`;
        let safetyBuffer = 512;
        let effectiveContextWindow = typeof this.contextWindow === "number" && this.contextWindow > 0 ? this.contextWindow : null;

        const doRequest = async (maxOutTokens) => {
            // Best-effort input truncation to avoid context overflow.
            let finalMessages = messages;
            const windowTokens = effectiveContextWindow;
            if (windowTokens && Array.isArray(messages)) {
                const budget = Math.max(0, windowTokens - maxOutTokens - safetyBuffer);
                if (budget > 0) {
                    finalMessages = truncateMessagesToBudget(messages, { maxInputTokens: budget });
                }
            }

            const body = {
                model: this.model,
                messages: finalMessages,
                temperature,
                max_tokens: maxOutTokens,
            };

            const response = await fetchWithTimeout(
                url,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${this.apiKey}`,
                    },
                    body: JSON.stringify(body),
                },
                { timeoutMs: toTimeoutMs(timeoutMs ?? this.timeoutMs, 60_000), signal }
            );

            if (!response.ok) {
                throw await buildHttpError(response, { url });
            }

            const data = await response.json();
            const choice = data.choices?.[0];

            return {
                content: choice?.message?.content || "",
                model: data.model,
                usage: data.usage,
            };
        };

        return await executeWithOverflowRecovery(doRequest, {
            initialMaxTokens: initialMaxTokens,
            minTokens: 256,
            bufferTokens: 128,
            maxRetries: 2,
            onOverflow: async ({ info }) => {
                // If the API reports the true context limit, adopt it for subsequent retries.
                if (!effectiveContextWindow && typeof info?.contextLimit === "number" && info.contextLimit > 0) {
                    effectiveContextWindow = Math.floor(info.contextLimit);
                }
                // Increase truncation conservatism after an overflow.
                safetyBuffer = Math.max(safetyBuffer, 1024);
            },
        });
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
