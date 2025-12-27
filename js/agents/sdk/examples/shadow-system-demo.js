/**
 * Shadow System (意识/潜意识) 演示示例
 * 
 * 展示影子系统如何在后台监视黑板，并向主 Agent 的思维流中“注入”潜意识提醒。
 */

import { createAgent, DeepSearchAgentLoop } from "../index.js";

async function main() {
    console.log("🚀 Starting Agent with Shadow System (Consciousness/Subconsciousness)...");

    // 1. 创建具备“影子系统”的 Agent
    const agent = createAgent({ actor: "resilient_arranger" })
        .useDiscovery() // 启用黑板
        .useShadow({
            policy: "advisor",
            model: "haiku"
        })
        .onEvent("*.agent.status.changed", (evt) => {
            console.log(`[Status] ${evt.payload.from} -> ${evt.payload.to}`);
        })
        .build();

    // 2. 设置研究 Loop
    const loop = new DeepSearchAgentLoop();
    agent.setLoop(loop);

    // 3. 模拟一个“潜意识”触发场景：
    // 我们在 Agent 运行前，手动向黑板注入一个冲突事实
    console.log("\n[Simulator] 手动模拟黑板冲突 (潜意识素材)...");
    agent.discovery.addEvidence("gap_revenue", {
        sourceId: "doc_1",
        snippet: "2023 Revenue: $10B",
        confidence: 0.9
    });

    // 关键：黑板标记为冲突或需要验证
    agent.discovery.evaluateGap("gap_revenue", {
        status: "contradicted", // 故意设置为冲突状态
        comment: "发现文档 1 与之前的预期不符"
    });

    // 4. 执行 Agent
    console.log("\n[Execute] 运行 Agent，观察潜意识注入...");

    // 我们可以通过拦截 logger 来观察潜意识注入
    const originalInfo = agent.logger.info;
    agent.logger.info = (msg, ...args) => {
        if (msg.includes("[Shadow]")) {
            console.log(`\n🧠 ${msg} ${args[0] || ""}`);
        }
        originalInfo.apply(agent.logger, [msg, ...args]);
    };

    // 运行一个简单的任务
    // 预期：影子系统会发现 gap_revenue 的状态是 contradicted，
    // 然后在第一轮或第二轮迭代时注入 Subconscious Alert。
    await agent.run({
        taskGoal: "核实 2023 年营收数据",
        runId: "shadow_test_001"
    }, {
        stageApi: {
            agent,
            modelRouter: {
                call: async (params) => {
                    const messages = params.messages || params;
                    console.log("\n[Main Consciousness] Thinking...");
                    const lastMsg = messages[messages.length - 1];
                    if (lastMsg.content.includes("影子系统提醒") || lastMsg.content.includes("潜意识提醒")) {
                        console.log("👁️  Main agent detected shadow alert!");
                        return { content: '{ "thought": "我注意到了潜意识里的冲突提醒，需要进行核查。", "action": "complete" }', usage: {} };
                    }
                    return { content: '{ "thought": "正在思考如何核实营收...", "action": "complete" }', usage: {} };
                }
            },
            signal: { aborted: false }
        }
    });

    console.log("\n✅ Shadow System demonstration completed.");

    // 5. 演示“心流状态” (Flow State)
    console.log("\n[Execute] 进入心流状态，低优先级告警将被屏蔽...");
    agent.shadow.enterFlow();

    // 注入一个低优先级的直觉告警
    agent.shadow._triggerAlert({
        type: "intuition",
        message: "这是一个不会干扰你的微弱直觉（心流中被屏蔽）",
        severity: "low"
    });

    await agent.run({
        taskGoal: "心流测试迭代 - 1",
        runId: "flow_test_01"
    }, {
        stageApi: {
            agent,
            modelRouter: {
                call: async (params) => {
                    const messages = params.messages || params;
                    const lastMsg = messages[messages.length - 1];
                    if (lastMsg.content.includes("微弱直觉")) {
                        console.error("❌ 错误：心流状态下不应注入低优先级告警！");
                    } else {
                        console.log("✅ 心流状态正常：低优先级告警已屏蔽。");
                    }
                    return { content: '{ "thought": "专注执行...", "action": "complete" }', usage: {} };
                }
            },
            signal: { aborted: false }
        }
    });

    console.log("\n[Execute] 退出心流状态，观察告警恢复...");
    agent.shadow.exitFlow();

    await agent.run({
        taskGoal: "心流测试迭代 - 2",
        runId: "flow_test_02"
    }, {
        stageApi: {
            agent,
            modelRouter: {
                call: async (params) => {
                    const messages = params.messages || params;
                    const lastMsg = messages[messages.length - 1];
                    if (lastMsg.content.includes("微弱直觉")) {
                        console.log("✅ 恢复正常：退出心流后，之前的低优先级告警成功注入。");
                    }
                    return { content: '{ "thought": "收到延迟的提醒。", "action": "complete" }', usage: {} };
                }
            },
            signal: { aborted: false }
        }
    });

    console.log("\n✅ Shadow System Flow State demonstration completed.");

    console.log("\n[Execute] 演示元认知监控 (双轮迭代验证)...");

    // 注入一个冲突
    agent.discovery.evaluateGap("gap_meta_v2", {
        status: "contradicted"
    });

    let iterCount = 0;
    await agent.run({
        taskGoal: "元认知双轮测试",
        runId: "meta_test_v2"
    }, {
        stageApi: {
            agent,
            modelRouter: {
                call: async (params) => {
                    iterCount++;
                    const messages = params.messages || params;
                    const lastMsg = messages[messages.length - 1];

                    if (iterCount === 1) {
                        // 第一轮：潜意识应该成功注入
                        if (lastMsg.role === "user" && lastMsg.content.includes("gap_meta_v2")) {
                            console.log("✅ 第一轮：潜意识成功提醒（Agent 尚未提及）。");
                        } else {
                            console.error("❌ 第一轮：注入失败！");
                        }
                        return { content: '{ "thought": "我看到了 gap_meta_v2 的矛盾，正在处理。", "action": "none" }', usage: {} };
                    } else {
                        // 第二轮：因为第一轮 Agent 已经提到了，潜意识应该抑制
                        if (lastMsg.role === "user" && lastMsg.content.includes("gap_meta_v2")) {
                            console.error("❌ 第二轮：元认知失效！Agent 已关注，但潜意识仍在重复提醒。");
                        } else {
                            console.log("✅ 第二轮：元认知生效！潜意识抑制了重复提醒，保持上下文纯净。");
                        }
                        return { content: '{ "thought": "处理完毕。", "action": "complete" }', usage: {} };
                    }
                }
            },
            signal: { aborted: false }
        }
    });
    console.log("\n[Execute] 演示错配优化 (反馈学习与忽略)...");

    const mismatchId = "gap_mismatch_test";
    agent.discovery.evaluateGap(mismatchId, { status: "contradicted" });

    // 第一轮：触发提醒，Agent 表示忽略
    await agent.run({ taskGoal: "反馈测试" }, {
        stageApi: {
            agent,
            modelRouter: {
                call: async (params) => {
                    const messages = params.messages || params;
                    const lastMsg = messages[messages.length - 1];
                    if (lastMsg.role === "user" && lastMsg.content.includes(mismatchId)) {
                        console.log("✅ 第一轮：潜意识正常提醒。");
                    }
                    return { content: `{ "thought": "忽略潜意识项 \\"${mismatchId}\\" 已处理/无关。" }`, usage: {} };
                }
            },
            signal: { aborted: false }
        }
    });

    // 第二轮：再次注入同样的冲突，观察是否被抑制
    agent.discovery.evaluateGap(mismatchId, { status: "contradicted" }); // 模拟再次触发
    await agent.run({ taskGoal: "反馈测试" }, {
        stageApi: {
            agent,
            modelRouter: {
                call: async (params) => {
                    const messages = params.messages || params;
                    const lastMsg = messages[messages.length - 1];
                    if (lastMsg.role === "user" && lastMsg.content.includes(mismatchId)) {
                        console.error("❌ 错误：元认知失效，Agent 已显式忽略，不应再提醒。");
                    } else {
                        console.log("✅ 反馈学习成功：潜意识已自发静默被 Agent 拒绝的项。");
                    }
                    return { content: '{ "thought": "一切正常。" }', usage: {} };
                }
            },
            signal: { aborted: false }
        }
    });

    console.log("\n✅ Shadow System Metacognition & Feedback demonstration completed.");
}

main().catch(console.error);
