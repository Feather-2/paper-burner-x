import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { AlertMonitor } from "../../js/agents/sdk/AlertMonitor.js";

/**
 * 创建 mock agent
 * @param {object} [overrides]
 */
function createMockAgent(overrides = {}) {
    const handlers = new Map();
    return {
        on: (event, handler) => {
            if (!handlers.has(event)) handlers.set(event, []);
            handlers.get(event).push(handler);
        },
        emit: (event, payload) => {
            const list = handlers.get(event) || [];
            for (const h of list) h({ payload });
        },
        eventBus: {
            emit: mock.fn(),
        },
        loop: { iteration: 0 },
        _loop: { messages: [] },
        discovery: null,
        ...overrides,
    };
}

/**
 * 创建 mock logger
 */
function createMockLogger() {
    return {
        info: mock.fn(),
        warn: mock.fn(),
        error: mock.fn(),
        debug: mock.fn(),
    };
}

describe("AlertMonitor", () => {
    describe("constructor", () => {
        it("should initialize with default options", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            assert.equal(monitor.auditorModel, "haiku");
            assert.equal(monitor.policy, "advisor");
            assert.equal(monitor._pendingAlerts.length, 0);
            assert.equal(monitor._isFlowActive, false);
        });

        it("should accept custom options", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({
                logger,
                model: "gpt-4o",
                policy: "governor",
            });

            assert.equal(monitor.auditorModel, "gpt-4o");
            assert.equal(monitor.policy, "governor");
        });
    });

    describe("enterQuiet / exitQuiet", () => {
        it("should toggle flow active state", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            assert.equal(monitor._isFlowActive, false);

            monitor.enterQuiet();
            assert.equal(monitor._isFlowActive, true);
            assert.equal(logger.info.mock.callCount(), 1);

            monitor.exitQuiet();
            assert.equal(monitor._isFlowActive, false);
            assert.equal(logger.info.mock.callCount(), 2);
        });
    });

    describe("_triggerAlert", () => {
        let monitor;
        let logger;

        beforeEach(() => {
            logger = createMockLogger();
            monitor = new AlertMonitor({ logger });
        });

        it("should add alert to pending list", () => {
            monitor._triggerAlert({
                type: "suggestion",
                message: "test message",
                severity: "low",
            });

            assert.equal(monitor._pendingAlerts.length, 1);
            assert.equal(monitor._pendingAlerts[0].message, "test message");
        });

        it("should prevent duplicate alerts", () => {
            const alert = { type: "suggestion", message: "same message", severity: "low" };
            monitor._triggerAlert(alert);
            monitor._triggerAlert(alert);

            assert.equal(monitor._pendingAlerts.length, 1);
        });

        it("should discard low confidence alerts in flow mode", () => {
            monitor.enterQuiet();
            monitor._triggerAlert({
                type: "suggestion",
                message: "low confidence",
                confidence: 0.5,
            });

            assert.equal(monitor._pendingAlerts.length, 0);
        });

        it("should keep high confidence alerts in flow mode", () => {
            monitor.enterQuiet();
            monitor._triggerAlert({
                type: "suggestion",
                message: "high confidence",
                confidence: 0.8,
            });

            assert.equal(monitor._pendingAlerts.length, 1);
        });

        it("should trigger force backtrack for critical alerts in governor mode", () => {
            const agent = createMockAgent();
            const governorMonitor = new AlertMonitor({
                agent,
                logger,
                policy: "governor",
            });

            governorMonitor._triggerAlert({
                type: "observation",
                message: "critical issue",
                severity: "critical",
            });

            assert.equal(agent.eventBus.emit.mock.callCount(), 1);
            const [eventName, payload] = agent.eventBus.emit.mock.calls[0].arguments;
            assert.equal(eventName, "alertmonitor.force_backtrack");
            assert.equal(payload.reason, "critical issue");
        });
    });

    describe("drainAlerts", () => {
        it("should return and clear pending alerts", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            monitor._triggerAlert({ type: "suggestion", message: "alert1", severity: "low" });
            monitor._triggerAlert({ type: "notification", message: "alert2", severity: "medium" });

            const drained = monitor.drainAlerts();

            assert.equal(drained.length, 2);
            assert.equal(monitor._pendingAlerts.length, 0);
        });
    });

    describe("_checkPlanningDrift", () => {
        it("should detect repeated tool calls", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            monitor._checkPlanningDrift("search", {});
            monitor._checkPlanningDrift("search", {});
            monitor._checkPlanningDrift("search", {});

            assert.equal(monitor._pendingAlerts.length, 1);
            assert.ok(monitor._pendingAlerts[0].message.includes("重复调用"));
        });

        it("should not trigger for varied tool calls", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            monitor._checkPlanningDrift("search", {});
            monitor._checkPlanningDrift("read", {});
            monitor._checkPlanningDrift("write", {});

            assert.equal(monitor._pendingAlerts.length, 0);
        });
    });

    describe("_onDiscoveryUpdated", () => {
        it("should trigger alert for contradicted discoveries", async () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            await monitor._onDiscoveryUpdated({
                gapId: "gap-123",
                status: "contradicted",
            });

            assert.equal(monitor._pendingAlerts.length, 1);
            assert.ok(monitor._pendingAlerts[0].message.includes("gap-123"));
            assert.equal(monitor._pendingAlerts[0].severity, "high");
        });

        it("should not trigger for suppressed IDs", async () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });
            monitor._suppressedIds.add("gap-123");

            await monitor._onDiscoveryUpdated({
                gapId: "gap-123",
                status: "contradicted",
            });

            assert.equal(monitor._pendingAlerts.length, 0);
        });
    });

    describe("_learnFromFeedback", () => {
        it("should add ID to suppressed set when agent rejects alert", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            const messages = [
                { role: "assistant", content: '项 为 "gap-abc" 误报，已处理' },
            ];

            monitor._learnFromFeedback(messages);

            assert.ok(monitor._suppressedIds.has("gap-abc"));
        });

        it("should handle empty messages", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            monitor._learnFromFeedback([]);

            assert.equal(monitor._suppressedIds.size, 0);
        });
    });

    describe("_filterAlerts", () => {
        let monitor;
        let logger;

        beforeEach(() => {
            logger = createMockLogger();
            monitor = new AlertMonitor({ logger });
        });

        it("should filter out suppressed IDs", () => {
            monitor._suppressedIds.add("gap-1");

            const alerts = [
                { type: "observation", message: 'Issue with "gap-1"', id: "gap-1" },
                { type: "observation", message: 'Issue with "gap-2"', id: "gap-2" },
            ];

            const filtered = monitor._filterAlerts(alerts, []);

            assert.equal(filtered.length, 1);
            assert.equal(filtered[0].id, "gap-2");
        });

        it("should filter status/guidance when agent discusses reports", () => {
            const alerts = [
                { type: "status", message: "Status update" },
                { type: "guidance", message: "Guidance note" },
                { type: "suggestion", message: "Suggestion" },
            ];

            const messages = [
                { role: "assistant", content: "以下是报告总结" },
            ];

            const filtered = monitor._filterAlerts(alerts, messages);

            assert.equal(filtered.length, 1);
            assert.equal(filtered[0].type, "suggestion");
        });

        it("should filter low confidence alerts in long conversations", () => {
            const alerts = [
                { type: "suggestion", message: "Low conf", confidence: 0.6 },
                { type: "suggestion", message: "High conf", confidence: 0.9 },
            ];

            const messages = new Array(25).fill({ role: "user", content: "msg" });

            const filtered = monitor._filterAlerts(alerts, messages);

            assert.equal(filtered.length, 1);
            assert.equal(filtered[0].message, "High conf");
        });

        it("should return empty array for empty input", () => {
            const filtered = monitor._filterAlerts([], []);
            assert.equal(filtered.length, 0);
        });
    });

    describe("getInjectedPrompt", () => {
        let monitor;
        let logger;

        beforeEach(() => {
            logger = createMockLogger();
            monitor = new AlertMonitor({ logger });
        });

        it("should return null when no alerts", () => {
            const prompt = monitor.getInjectedPrompt([]);
            assert.equal(prompt, null);
        });

        it("should format alerts as markdown", () => {
            monitor._triggerAlert({ type: "suggestion", message: "Alert 1", severity: "low" });
            monitor._triggerAlert({ type: "notification", message: "Alert 2", severity: "medium" });

            const prompt = monitor.getInjectedPrompt([]);

            assert.ok(prompt.includes("### 提醒"));
            assert.ok(prompt.includes("- Alert 1"));
            assert.ok(prompt.includes("- Alert 2"));
        });

        it("should only return high/critical in flow mode", () => {
            monitor.enterQuiet();
            monitor._pendingAlerts = [
                { type: "suggestion", message: "Low", severity: "low" },
                { type: "observation", message: "High", severity: "high" },
            ];

            const prompt = monitor.getInjectedPrompt([]);

            assert.ok(prompt.includes("High"));
            assert.ok(!prompt.includes("Low"));

            // low severity should remain in pending
            assert.equal(monitor._pendingAlerts.length, 1);
            assert.equal(monitor._pendingAlerts[0].message, "Low");
        });

        it("should drain alerts after injection (non-flow mode)", () => {
            monitor._triggerAlert({ type: "suggestion", message: "Alert", severity: "low" });

            monitor.getInjectedPrompt([]);

            assert.equal(monitor._pendingAlerts.length, 0);
        });
    });

    describe("_auditGlobalState", () => {
        it("should trigger notification for pending conflicts", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                discovery: {
                    getAllDiscoveries: () => [
                        { id: "1", status: "contradicted" },
                        { id: "2", status: "satisfied" },
                    ],
                },
                loop: { iteration: 1 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            monitor._auditGlobalState();

            assert.ok(monitor._pendingAlerts.some(a => a.message.includes("冲突证据")));
        });

        it("should not duplicate conflict notification if alerts pending", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                discovery: {
                    getAllDiscoveries: () => [
                        { id: "1", status: "contradicted" },
                    ],
                },
                loop: { iteration: 1 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            monitor._pendingAlerts = [{ message: "existing" }];

            monitor._auditGlobalState();

            // 不应新增冲突通知
            assert.equal(monitor._pendingAlerts.length, 1);
        });
    });

    describe("_auditResearchHealth", () => {
        it("should suggest Recall after many iterations", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                loop: { iteration: 10 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            monitor._auditResearchHealth([]);

            assert.ok(monitor._pendingAlerts.some(a => a.message.includes("Recall")));
        });

        it("should suggest Task for many gaps when not in flow mode", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                loop: { iteration: 1 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            const manyGaps = new Array(10).fill({ status: "pending" });

            monitor._auditResearchHealth(manyGaps);

            assert.ok(monitor._pendingAlerts.some(a => a.message.includes("Task")));
        });

        it("should not suggest Task in flow mode", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                loop: { iteration: 1 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            monitor.enterQuiet();
            const manyGaps = new Array(10).fill({ status: "pending" });

            monitor._auditResearchHealth(manyGaps);

            assert.ok(!monitor._pendingAlerts.some(a => a.message.includes("Task")));
        });

        it("should suggest focus when progress is low", () => {
            const logger = createMockLogger();
            const agent = createMockAgent({
                loop: { iteration: 1 },
            });

            const monitor = new AlertMonitor({ agent, logger });
            const gaps = [
                ...new Array(6).fill({ status: "pending" }),
                { status: "satisfied" },
            ];

            monitor._auditResearchHealth(gaps);

            assert.ok(monitor._pendingAlerts.some(a => a.message.includes("聚焦核心路径")));
        });
    });

    describe("event listeners", () => {
        it("should set up listeners when agent provided", async () => {
            const logger = createMockLogger();
            const agent = createMockAgent();

            new AlertMonitor({ agent, logger });

            // 触发 tool.completed 事件
            agent.emit("*.tool.completed", { tool: "search", params: {}, result: {} });

            // 第一次调用不会触发告警（需要3次重复）
            // 只是验证监听器已注册
        });

        it("should respond to discovery update events", async () => {
            const logger = createMockLogger();
            const agent = createMockAgent();

            const monitor = new AlertMonitor({ agent, logger });

            agent.emit("deepsearch.gap.evaluated", {
                gapId: "test-gap",
                status: "contradicted",
            });

            // 等待异步处理
            await new Promise(r => setTimeout(r, 10));

            assert.ok(monitor._pendingAlerts.some(a => a.message.includes("test-gap")));
        });
    });

    describe("_forceBacktrack", () => {
        it("should emit backtrack event on agent eventBus", () => {
            const logger = createMockLogger();
            const agent = createMockAgent();
            const monitor = new AlertMonitor({ agent, logger });

            monitor._forceBacktrack("test reason");

            assert.equal(agent.eventBus.emit.mock.callCount(), 1);
            const [eventName, payload] = agent.eventBus.emit.mock.calls[0].arguments;
            assert.equal(eventName, "alertmonitor.force_backtrack");
            assert.equal(payload.reason, "test reason");
        });

        it("should handle missing agent gracefully", () => {
            const logger = createMockLogger();
            const monitor = new AlertMonitor({ logger });

            // 不应抛错
            monitor._forceBacktrack("test reason");
        });
    });
});
