#!/usr/bin/env node
/**
 * Agent SDK CLI Demo - 带模型调用
 *
 * 配置方式:
 *   1. 复制 config.example.json 为 config.json 并填入 API Key
 *   2. 或设置环境变量 OPENAI_API_KEY
 *
 * 用法:
 *   node js/agents/cli/demo.js --chat "你好"
 *   node js/agents/cli/demo.js --dry-run
 */

import { createAgent, ContextMode } from "../sdk/index.js";
import { CliModelRouter, createAiApiServiceAdapter } from "./model-client.js";

const args = process.argv.slice(2);

// 帮助信息
if (args.includes("--help") || args.includes("-h")) {
    console.log(`
Agent SDK CLI Demo

环境变量:
  OPENAI_API_KEY   API Key (必需，用于 --chat)
  OPENAI_BASE_URL  API 端点 (默认 https://api.deepseek.com/v1)
  OPENAI_MODEL     模型名 (默认 deepseek-chat)

用法:
  node js/agents/cli/demo.js [options] [query]

选项:
  --chat           使用模型进行对话
  --list-skills    列出所有可用技能
  --list-subagents 列出所有子代理类型
  --dry-run        仅构建 Agent，不执行
  --help, -h       显示帮助

示例:
  OPENAI_API_KEY=sk-xxx node js/agents/cli/demo.js --chat "你好"
  node js/agents/cli/demo.js --dry-run
`);
    process.exit(0);
}

// 创建模型路由
function createModelRouter() {
    return new CliModelRouter();
}

// 创建示例 Agent
function buildDemoAgent(router) {
    const redactSensitive = (value, keyPath = []) => {
        if (value === null || value === undefined) return value;
        if (typeof value === "string") {
            // Common API key patterns (best-effort).
            let out = value.replace(/\bsk-[A-Za-z0-9]{16,}\b/g, "sk-REDACTED");
            out = out.replace(/\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi, "Bearer REDACTED");
            return out;
        }
        if (Array.isArray(value)) return value.map((v, i) => redactSensitive(v, [...keyPath, String(i)]));
        if (typeof value === "object") {
            const out = {};
            for (const [k, v] of Object.entries(value)) {
                const lower = String(k).toLowerCase();
                if (/(api[_-]?key|token|secret|authorization|auth|password|passwd|pwd)/i.test(lower)) {
                    out[k] = "REDACTED";
                    continue;
                }
                out[k] = redactSensitive(v, [...keyPath, k]);
            }
            return out;
        }
        return value;
    };

    const safeStringify = (value) => {
        try {
            return JSON.stringify(redactSensitive(value));
        } catch {
            return String(value ?? "");
        }
    };

    const agent = createAgent({ actor: "demo" })
        // 注册 LLM 调用 Skill
        .useSkill("llm_chat", {
            definition: {
                name: "llm_chat",
                description: "调用 LLM 进行对话",
                parameters: {
                    type: "object",
                    properties: {
                        prompt: { type: "string", description: "用户输入" },
                        system: { type: "string", description: "系统提示词" }
                    },
                    required: ["prompt"]
                }
            },
            handler: async ({ prompt, system, role = "worker" }, ctx) => {
                try {
                    const client = router.getClient(role);
                    ctx.emit("demo.llm.start", { prompt, model: client.model });
                    const content = await client.ask(prompt, system);
                    ctx.emit("demo.llm.done", { length: content.length });
                    return { content };
                } catch (err) {
                    return { error: err.message };
                }
            }
        })
        // 注册示例 Skill
        .useSkill("echo", {
            definition: {
                name: "echo",
                description: "回显输入内容",
                parameters: {
                    type: "object",
                    properties: {
                        message: { type: "string", description: "要回显的消息" }
                    },
                    required: ["message"]
                }
            },
            handler: async ({ message }, ctx) => {
                ctx.emit("demo.echo", { message });
                return { echoed: message, timestamp: new Date().toISOString() };
            }
        })
        .useSkill("analyze", {
            definition: {
                name: "analyze",
                description: "分析输入文本",
                parameters: {
                    type: "object",
                    properties: {
                        text: { type: "string" },
                        depth: { type: "string", enum: ["shallow", "deep"] }
                    },
                    required: ["text"]
                }
            },
            handler: async ({ text, depth = "shallow" }, ctx) => {
                const wordCount = text.split(/\s+/).length;
                const charCount = text.length;
                ctx.emit("demo.analyze.done", { wordCount, charCount, depth });
                return {
                    wordCount,
                    charCount,
                    depth,
                    summary: depth === "deep"
                        ? `深度分析: ${wordCount} 词, ${charCount} 字符`
                        : `浅层分析: ${wordCount} 词`
                };
            }
        })
        // 注册示例子代理
        .useSubagent("explorer", async (config) => ({
            run: async () => ({
                result: `Explorer 子代理执行完成, 继承上下文: ${JSON.stringify(config.inheritedContext || {})}`
            })
        }), "探索代码库的子代理")
        // 配置 Cicada 记忆
        .useCicada({ maxTokens: 4000 })
        // 配置 Watchdog
        .useWatchdog({ maxIterations: 20, maxTimeMs: 60000 })
        // 订阅事件
        .onEvent("demo.*", (payload, meta) => {
            // Avoid leaking secrets from tool payloads / model outputs.
            console.log(`[Event] ${meta?.name || "demo.*"}:`, safeStringify(payload?.payload || payload));
        })
        .build();

    return agent;
}

// 主逻辑
async function main() {
    const router = createModelRouter();
    const agent = buildDemoAgent(router);

    // --list-skills
    if (args.includes("--list-skills")) {
        console.log("\n=== 可用技能 ===\n");
        console.log(agent.getSkillCatalogPrompt());
        return;
    }

    // --list-subagents
    if (args.includes("--list-subagents")) {
        console.log("\n=== 子代理类型 ===\n");
        const types = agent.subagentRegistry.getAvailableTypes();
        for (const t of types) {
            const desc = agent.subagentRegistry.getDescription(t);
            console.log(`  - ${t}: ${desc}`);
        }
        return;
    }

    // --dry-run
    if (args.includes("--dry-run")) {
        console.log("\n=== Agent 构建成功 ===");
        console.log("Skills:", Array.from(agent.skills.keys()));
        console.log("Memory:", agent.memory ? "CicadaCompressor" : "无");
        console.log("Backtrack:", agent.backtrack ? "BacktrackManager" : "无");
        console.log("Discovery:", agent.discovery ? "DiscoveryManager" : "无");
        console.log("Models:", router.getAvailableModels().join(", ") || "未配置");
        console.log("Tiers:", JSON.stringify(router.getTierMapping()));
        return;
    }

    const query = args.filter(a => !a.startsWith("--")).join(" ") || "Hello Agent SDK!";
    const context = {
        state: { sharedContext: { query } },
        signal: new AbortController().signal,
    };

    // --chat: 使用模型对话
    if (args.includes("--chat")) {
        const models = router.getAvailableModels();
        if (!models.length) {
            console.error("错误: 请配置 config.json 或设置 OPENAI_API_KEY");
            process.exit(1);
        }
        const client = router.getClient("worker");
        console.log("\n=== LLM 对话 ===");
        console.log("Model:", client.model);
        console.log("Query:", query);
        console.log("");

        const result = await agent.toolExecutor("llm_chat", { prompt: query }, context);
        console.log("\n--- 回复 ---");
        console.log(result.content || result.error);
        return;
    }

    // 默认: 测试框架功能
    console.log("\n=== 执行 Agent ===");
    console.log("Query:", query);

    console.log("\n--- echo ---");
    const echoResult = await agent.toolExecutor("echo", { message: query }, context);
    console.log("Result:", echoResult);

    console.log("\n--- analyze ---");
    const analyzeResult = await agent.toolExecutor("analyze", { text: query, depth: "deep" }, context);
    console.log("Result:", analyzeResult);

    if (agent.skills.has("Task")) {
        console.log("\n--- Task (子代理) ---");
        const taskResult = await agent.toolExecutor("Task", {
            subagent_type: "explorer",
            prompt: "探索项目",
            context_mode: ContextMode.ISOLATED
        }, context);
        console.log("Result:", taskResult);
    }

    console.log("\n=== 完成 ===");
}

main().catch(err => {
    console.error("Error:", err.message || err);
    process.exit(1);
});
